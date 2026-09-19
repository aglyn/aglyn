/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  mediaDeliveryRedirect,
  removeMediaDeliveryCopies,
  syncMediaDeliveryCopies,
} from '@aglyn/tenant-data-admin/server/media-delivery'
import { createFakeR2Endpoint } from './testing/fake-r2-endpoint'
import { createVideoDeliveryProvider, type VideoDeliverySettings } from './video-delivery-provider'
import type { R2BucketBinding } from './worker/r2-binding'
import { handleVideoRequest } from './worker/video-worker'

/**
 * The whole copy flow, end to end, with no network (AGL-2824): the
 * platform's copy step (`syncMediaDeliveryCopies`, which every ingress path
 * runs) writes through this plugin's provider and its SigV4 client into an
 * in-memory R2 bucket; the platform's redirect mints a URL with the same
 * provider; and the Worker serves that URL from the same bucket.
 *
 * Each ingress path is the same call against a different document state:
 * finalize (a new video), the rendition producer (renditions recorded), a
 * replace (a new content hash), and a delete (the copies removed).
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({}) },
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  isServerReleaseFlagOnForOrg: async () => true,
}))

const NOW = Date.parse('2026-09-18T12:00:00.000Z')
const SETTINGS: VideoDeliverySettings = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-access-key',
  bucket: 'aglyn-video',
  deliveryHost: 'video.example.workers.dev',
  deliverySecret: 's'.repeat(64),
}
const ASSET = { collection: 'orgs' as const, scopeId: 'acme', mediaId: 'med-film' }
const MASTER_PATH = 'orgs/acme/media/Films/med-film'
const RENDITION_PATH = `${MASTER_PATH}__r720p.mp4`
const HASH = '0123456789abcdef'
const NEW_HASH = 'fedcba9876543210'

type Data = Record<string, unknown> | null

function mediaDocument(initial: Data) {
  let data: Data = initial
  const snapshot = () => ({ exists: data !== null, get: (field: string) => data?.[field] })
  const ref = {
    get: async () => snapshot(),
    firestore: {
      runTransaction: async <T>(run: (transaction: unknown) => Promise<T>) =>
        run({
          get: async () => snapshot(),
          update: (_ref: unknown, patch: Record<string, unknown>) => {
            data = { ...(data ?? {}), ...patch }
          },
        }),
    },
  }
  return {
    ref: ref as never,
    read: () => data,
    write: (patch: Record<string, unknown>) => {
      data = { ...(data ?? {}), ...patch }
    },
  }
}

function platformBucket(objects: Record<string, string>) {
  return {
    file: (path: string) => ({
      getMetadata: async () => {
        const bytes = objects[path]
        if (bytes === undefined) throw new Error(`No such object: ${path}`)
        return [
          {
            size: String(Buffer.byteLength(bytes)),
            contentType: 'video/mp4',
            md5Hash: createHash('md5').update(bytes).digest('base64'),
          },
        ]
      },
      createReadStream: () => Readable.from([Buffer.from(objects[path] ?? '')]),
    }),
  }
}

/** The Worker's bucket binding, over the same in-memory bucket. */
function workerBinding(objects: Map<string, { bytes: Uint8Array; contentType: string }>) {
  const meta = (key: string) => {
    const object = objects.get(key)
    return object
      ? { key, size: object.bytes.length, httpEtag: `"${key.length}"`, httpMetadata: { contentType: object.contentType } }
      : null
  }
  const binding: R2BucketBinding = {
    head: async (key) => meta(key),
    get: async (key, options) => {
      const found = meta(key)
      const object = objects.get(key)
      if (!found || !object) return null
      const range = options?.range
      const bytes = range
        ? object.bytes.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length)
        : object.bytes
      return {
        ...found,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
      }
    },
  }
  return binding
}

function setUp(document: Record<string, unknown>, bucketObjects: Record<string, string>) {
  const endpoint = createFakeR2Endpoint({ ...SETTINGS })
  const provider = createVideoDeliveryProvider({
    settings: () => SETTINGS,
    fetch: endpoint.fetch,
    now: () => NOW,
  })
  const media = mediaDocument(document)
  const bucket = platformBucket(bucketObjects)
  const sync = () =>
    syncMediaDeliveryCopies({
      docRef: media.ref,
      asset: ASSET,
      bucket,
      orgId: 'acme',
      provider,
      nowMs: () => NOW,
    })
  /** What a viewer gets for the CDN's redirect: the URL, then the Worker. */
  const watch = async (range?: string) => {
    const redirect = await mediaDeliveryRedirect({
      provider,
      asset: ASSET,
      document: { get: (field: string) => media.read()?.[field] },
      servedType: 'video/mp4',
      claims: { scope: 'org:acme', mediaId: 'med-film', hostId: null },
      orgId: async () => 'acme',
      nowMs: NOW,
    })
    if (!redirect) return null
    return handleVideoRequest(
      new Request(redirect.location, range ? { headers: { range } } : {}),
      {
        VIDEO_BUCKET: workerBinding(endpoint.objects),
        MEDIA_VIDEO_DELIVERY_SECRET: SETTINGS.deliverySecret,
      },
      NOW + 1_000,
    )
  }
  return { endpoint, provider, media, sync, watch }
}

const FILM_DOC = {
  fileName: 'film.mp4',
  contentType: 'video/mp4',
  contentHash: HASH,
  storagePath: MASTER_PATH,
  video: { durationMs: 60_000 },
}

describe('the copy flow, platform to provider to Worker (AGL-2824)', () => {
  it('finalize: the master is copied under its hash, and the Worker serves it, ranges included', async () => {
    const flow = setUp({ ...FILM_DOC }, { [MASTER_PATH]: 'THE-MASTER-FILM' })
    expect(await flow.watch()).toBeNull() // Nothing to redirect to before the copy.
    expect((await flow.sync()).copied).toEqual(['master'])
    expect([...flow.endpoint.objects.keys()]).toEqual([`orgs/acme/med-film/${HASH}/master/${HASH}`])

    const whole = await flow.watch()
    expect(whole?.status).toBe(200)
    expect(await whole?.text()).toBe('THE-MASTER-FILM')
    const ranged = await flow.watch('bytes=4-9')
    expect(ranged?.status).toBe(206)
    expect(ranged?.headers.get('content-range')).toBe('bytes 4-9/15')
    expect(await ranged?.text()).toBe('MASTER')
  })

  it('the rendition producer: each rendition it records is copied too', async () => {
    const flow = setUp({ ...FILM_DOC }, { [MASTER_PATH]: 'MASTER', [RENDITION_PATH]: 'RENDITION' })
    await flow.sync()
    // The producer uploads the encode and records it on the document, then
    // runs the same copy step.
    flow.media.write({
      videoRenditions: [
        { key: '720p', ext: 'mp4', contentType: 'video/mp4', width: 1280, height: 720, sizeBytes: 9 },
      ],
    })
    const result = await flow.sync()
    expect(result).toMatchObject({ copied: ['r-720p'], kept: ['master'] })
    const renditionKey = `orgs/acme/med-film/${HASH}/r-720p/${createHash('md5')
      .update('RENDITION')
      .digest('hex')}`
    expect(new TextDecoder().decode(flow.endpoint.objects.get(renditionKey)?.bytes)).toBe(
      'RENDITION',
    )
  })

  it('replace: the new bytes get a new key, the old key is deleted, and nothing serves the old bytes', async () => {
    const flow = setUp({ ...FILM_DOC }, { [MASTER_PATH]: 'OLD-FILM' })
    await flow.sync()
    const oldKey = `orgs/acme/med-film/${HASH}/master/${HASH}`
    const oldUrl = await mediaDeliveryRedirect({
      provider: flow.provider,
      asset: ASSET,
      document: { get: (field: string) => flow.media.read()?.[field] },
      servedType: 'video/mp4',
      claims: { scope: 'org:acme', mediaId: 'med-film', hostId: null },
      orgId: async () => 'acme',
      nowMs: NOW,
    })

    // The replace route writes the new hash and clears the record, removes
    // the previous copies, then copies the new bytes.
    flow.media.write({ contentHash: NEW_HASH, deliveryCopies: undefined })
    expect(await flow.watch()).toBeNull() // Between the write and the copy: the platform serves.
    await removeMediaDeliveryCopies({ asset: ASSET, provider: flow.provider })
    const bucketAfterReplace = platformBucket({ [MASTER_PATH]: 'NEW-FILM' })
    await syncMediaDeliveryCopies({
      docRef: flow.media.ref,
      asset: ASSET,
      bucket: bucketAfterReplace,
      orgId: 'acme',
      provider: flow.provider,
      nowMs: () => NOW,
    })

    expect([...flow.endpoint.objects.keys()]).toEqual([
      `orgs/acme/med-film/${NEW_HASH}/master/${NEW_HASH}`,
    ])
    expect(await (await flow.watch())?.text()).toBe('NEW-FILM')
    // A URL minted for the old bytes now finds nothing to serve.
    const stale = await handleVideoRequest(
      new Request(String(oldUrl?.location)),
      {
        VIDEO_BUCKET: workerBinding(flow.endpoint.objects),
        MEDIA_VIDEO_DELIVERY_SECRET: SETTINGS.deliverySecret,
      },
      NOW + 1_000,
    )
    expect(stale.status).toBe(404)
    expect(oldUrl?.key).toBe(oldKey)
  })

  it('delete: every copy of the asset goes, and only that asset’s', async () => {
    const flow = setUp({ ...FILM_DOC }, { [MASTER_PATH]: 'FILM' })
    await flow.sync()
    // Another asset in the same library keeps its copy.
    await flow.provider.putObject({
      key: `orgs/acme/med-other/${HASH}/master/${HASH}`,
      body: new TextEncoder().encode('OTHER'),
      contentLength: 5,
      contentType: 'video/mp4',
    })
    expect(await removeMediaDeliveryCopies({ asset: ASSET, provider: flow.provider })).toEqual({
      removed: 1,
      failed: false,
    })
    expect([...flow.endpoint.objects.keys()]).toEqual([`orgs/acme/med-other/${HASH}/master/${HASH}`])
  })
})
