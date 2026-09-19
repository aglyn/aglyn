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
import type {
  MediaDeliveryProvider,
  MediaDeliveryUrlRequest,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import {
  eraseMediaDeliveryScope,
  MEDIA_DELIVERY_DEFAULT_TTL_MS,
  MEDIA_DELIVERY_MAX_TTL_MS,
  MEDIA_DELIVERY_MIN_TTL_MS,
  mediaDeliveryAssetPrefix,
  mediaDeliveryObjectKey,
  mediaDeliveryRedirect,
  mediaDeliveryScopePrefix,
  mediaDeliveryTtlMs,
  parseMediaDeliveryCopies,
  removeMediaDeliveryCopies,
  syncMediaDeliveryCopies,
  withoutMediaDeliveryCopies,
} from './media-delivery'

/**
 * The platform's half of video delivery (AGL-2824): the key grammar, which
 * recorded copies are believed, when a redirect is minted, and the copy flow
 * every ingress path runs — finalize, replace, the rendition producer — with
 * a provider faked in memory. The provider here is a stand-in for any
 * provider; `libs/plugins/video-delivery` runs the same flow against its R2
 * adapter and Worker.
 */

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({ doc: (id: string) => ({ id }) }),
        getAll: async (ref: { id: string }) => [
          { get: (field: string) => (field === 'orgId' ? `org-of-${ref.id}` : undefined) },
        ],
      }),
    }),
  },
}))

let mockFlagOn = true
const mockFlagAsked: Array<string | null> = []
jest.mock('./release-flags', () => ({
  isServerReleaseFlagOnForOrg: async (_key: string, orgId: string | null) => {
    mockFlagAsked.push(orgId)
    return mockFlagOn
  },
}))

const NOW = Date.parse('2026-09-18T12:00:00.000Z')
const MASTER_HASH = '0123456789abcdef'
const NEW_HASH = 'fedcba9876543210'
const ASSET = { collection: 'hosts' as const, scopeId: 'host-1', mediaId: 'med-film' }

/*===========================================================================
 * Doubles.
 *==========================================================================*/

async function readAll(body: ReadableStream<Uint8Array> | Uint8Array): Promise<string> {
  if (body instanceof Uint8Array) return Buffer.from(body).toString()
  const chunks: Buffer[] = []
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString()
}

/** A provider holding its objects in memory. */
function fakeProvider(options: { failPutFor?: string } = {}) {
  const objects = new Map<string, { bytes: string; contentType: string; length: number }>()
  const deleted: string[] = []
  const prefixDeletes: string[] = []
  const minted: MediaDeliveryUrlRequest[] = []
  const provider: MediaDeliveryProvider = {
    isConfigured: () => true,
    async putObject({ key, body, contentLength, contentType }) {
      if (options.failPutFor && key.includes(options.failPutFor)) throw new Error('network')
      const bytes = await readAll(body)
      objects.set(key, { bytes, contentType, length: contentLength })
    },
    async deleteObject(key) {
      deleted.push(key)
      objects.delete(key)
    },
    async deleteObjectsWithPrefix(prefix) {
      prefixDeletes.push(prefix)
      let count = 0
      for (const key of [...objects.keys()]) {
        if (key.startsWith(prefix)) {
          objects.delete(key)
          count += 1
        }
      }
      return count
    },
    async deliveryUrl(request) {
      minted.push(request)
      return `https://delivery.test/${request.key}?until=${request.expiresAtMs}`
    },
  }
  return { provider, objects, deleted, prefixDeletes, minted }
}

type Data = Record<string, unknown> | null

/** A media document and the one transaction shape the copy flow uses. */
function fakeDoc(initial: Data) {
  let data: Data = initial
  const snapshot = () => ({
    exists: data !== null,
    get: (field: string) => (data ? data[field] : undefined),
  })
  const ref = {
    get: async () => snapshot(),
    firestore: {
      runTransaction: async <T>(
        run: (transaction: {
          get: () => Promise<ReturnType<typeof snapshot>>
          update: (target: unknown, patch: Record<string, unknown>) => void
        }) => Promise<T>,
      ) =>
        run({
          get: async () => snapshot(),
          update: (_target, patch) => {
            data = { ...(data ?? {}), ...patch }
          },
        }),
    },
  }
  return {
    ref: ref as never,
    read: () => data,
    replaceWith: (next: Data) => {
      data = next
    },
  }
}

/** A bucket holding objects by path, with the md5 Storage records for each. */
function fakeBucket(objects: Record<string, { bytes: string; contentType: string }>) {
  const reads: string[] = []
  return {
    reads,
    file: (path: string) => ({
      getMetadata: async () => {
        const object = objects[path]
        if (!object) throw new Error(`No such object: ${path}`)
        return [
          {
            size: String(Buffer.byteLength(object.bytes)),
            contentType: object.contentType,
            md5Hash: createHash('md5').update(object.bytes).digest('base64'),
          },
        ]
      },
      createReadStream: () => {
        reads.push(path)
        const object = objects[path]
        return Readable.from([Buffer.from(object?.bytes ?? '')])
      },
    }),
  }
}

const md5Hex = (text: string) => createHash('md5').update(text).digest('hex')

const RENDITION = {
  key: '720p',
  ext: 'mp4',
  contentType: 'video/mp4',
  width: 1280,
  height: 720,
  sizeBytes: 9,
}

function videoDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fileName: 'film.mp4',
    contentType: 'video/mp4',
    contentHash: MASTER_HASH,
    storagePath: 'hosts/host-1/media/Films/med-film',
    video: { durationMs: 60_000 },
    ...overrides,
  }
}

const masterKey = (hash = MASTER_HASH) =>
  `hosts/host-1/med-film/${hash}/master/${hash}`

function recordedMaster(hash = MASTER_HASH) {
  return {
    key: masterKey(hash),
    sourceHash: hash,
    objectHash: hash,
    contentType: 'video/mp4',
    sizeBytes: 11,
    copiedAtMs: NOW - 1,
  }
}

beforeEach(() => {
  mockFlagOn = true
  mockFlagAsked.length = 0
})

/*===========================================================================
 * Keys and records.
 *==========================================================================*/

describe('delivery keys carry the content hash (AGL-2824)', () => {
  it('names a copy by library, asset, source hash, representation and its own hash', () => {
    expect(
      mediaDeliveryObjectKey(ASSET, {
        sourceHash: MASTER_HASH,
        representation: 'master',
        objectHash: MASTER_HASH,
      }),
    ).toBe(masterKey())
    expect(
      mediaDeliveryObjectKey(
        { collection: 'orgs', scopeId: 'acme', mediaId: 'm1' },
        { sourceHash: MASTER_HASH, representation: 'r-720p', objectHash: md5Hex('x') },
      ),
    ).toBe(`orgs/acme/m1/${MASTER_HASH}/r-720p/${md5Hex('x')}`)
  })

  it('refuses any part that could leave the asset or collide with another', () => {
    const copy = { sourceHash: MASTER_HASH, representation: 'master', objectHash: MASTER_HASH }
    expect(mediaDeliveryObjectKey({ ...ASSET, mediaId: '../other' }, copy)).toBeNull()
    expect(mediaDeliveryObjectKey({ ...ASSET, scopeId: 'a/b' }, copy)).toBeNull()
    expect(
      mediaDeliveryObjectKey({ ...ASSET, collection: 'users' as never }, copy),
    ).toBeNull()
    expect(mediaDeliveryObjectKey(ASSET, { ...copy, sourceHash: 'ZZZZ' })).toBeNull()
    expect(mediaDeliveryObjectKey(ASSET, { ...copy, representation: 'poster' })).toBeNull()
    expect(mediaDeliveryObjectKey(ASSET, { ...copy, representation: 'r-../x' })).toBeNull()
  })

  it('gives one asset and one library a prefix no other shares', () => {
    expect(mediaDeliveryAssetPrefix(ASSET)).toBe('hosts/host-1/med-film/')
    expect(mediaDeliveryScopePrefix('orgs', 'acme')).toBe('orgs/acme/')
    expect(mediaDeliveryScopePrefix('orgs', '')).toBeNull()
  })

  it('believes only a record whose key is the one derived for this asset', () => {
    const copied = recordedMaster()
    const parsed = parseMediaDeliveryCopies(
      {
        master: copied,
        // A record carried over from another asset names that asset's key.
        'r-720p': { ...copied, key: 'hosts/host-1/med-other/x/r-720p/y' },
        'r-1080p': 'not a record',
      },
      ASSET,
    )
    expect(parsed).toEqual({ master: copied })
    expect(parseMediaDeliveryCopies({ master: copied }, { ...ASSET, mediaId: 'med-copy' })).toEqual(
      {},
    )
  })

  it('lives twice the film, between fifteen minutes and four hours', () => {
    expect(mediaDeliveryTtlMs(60_000)).toBe(MEDIA_DELIVERY_MIN_TTL_MS)
    expect(mediaDeliveryTtlMs(45 * 60_000)).toBe(90 * 60_000)
    expect(mediaDeliveryTtlMs(10 * 60 * 60_000)).toBe(MEDIA_DELIVERY_MAX_TTL_MS)
    expect(mediaDeliveryTtlMs(undefined)).toBe(MEDIA_DELIVERY_DEFAULT_TTL_MS)
    expect(mediaDeliveryTtlMs(Number.NaN)).toBe(MEDIA_DELIVERY_DEFAULT_TTL_MS)
  })

  it('drops the record from a document a restore puts back', () => {
    expect(withoutMediaDeliveryCopies({ a: 1, deliveryCopies: {} })).toEqual({ a: 1 })
    const untouched = { a: 1 }
    expect(withoutMediaDeliveryCopies(untouched)).toBe(untouched)
  })
})

/*===========================================================================
 * The redirect decision.
 *==========================================================================*/

describe('when a video request becomes a delivery redirect (AGL-2824)', () => {
  const redirect = (
    document: Record<string, unknown>,
    options: Partial<Parameters<typeof mediaDeliveryRedirect>[0]> = {},
  ) => {
    const fake = fakeProvider()
    let orgAsked = 0
    const result = mediaDeliveryRedirect({
      provider: fake.provider,
      asset: ASSET,
      document: { get: (field) => document[field] },
      servedType: document['contentType'],
      claims: { scope: 'host-1', mediaId: 'med-film', hostId: 'host-1' },
      orgId: async () => {
        orgAsked += 1
        return 'org-acme'
      },
      nowMs: NOW,
      ...options,
    })
    return { result, fake, orgAsked: () => orgAsked }
  }

  it('mints a URL for a current copy when the flag is on, with the claims', async () => {
    const { result, fake } = redirect(videoDoc({ deliveryCopies: { master: recordedMaster() } }))
    expect(await result).toEqual({
      location: `https://delivery.test/${masterKey()}?until=${NOW + MEDIA_DELIVERY_MIN_TTL_MS}`,
      expiresAtMs: NOW + MEDIA_DELIVERY_MIN_TTL_MS,
      key: masterKey(),
    })
    expect(fake.minted[0]?.claims).toEqual({
      scope: 'host-1',
      mediaId: 'med-film',
      hostId: 'host-1',
      orgId: 'org-acme',
    })
    expect(mockFlagAsked).toEqual(['org-acme'])
  })

  it('never outlives the signature that reached it', async () => {
    const { result } = redirect(videoDoc({ deliveryCopies: { master: recordedMaster() } }), {
      notAfterMs: NOW + 5_000,
    })
    expect((await result)?.expiresAtMs).toBe(NOW + 5_000)
    const unreadable = redirect(videoDoc({ deliveryCopies: { master: recordedMaster() } }), {
      notAfterMs: Number.NaN,
    })
    expect(await unreadable.result).toBeNull()
    const spent = redirect(videoDoc({ deliveryCopies: { master: recordedMaster() } }), {
      notAfterMs: NOW,
    })
    expect(await spent.result).toBeNull()
  })

  it('serves from the platform with no copy, and asks nothing to find that out', async () => {
    const { result, orgAsked } = redirect(videoDoc())
    expect(await result).toBeNull()
    expect(orgAsked()).toBe(0)
    expect(mockFlagAsked).toEqual([])
  })

  it('serves from the platform for a copy of bytes the asset no longer has', async () => {
    const stale = redirect(
      videoDoc({ contentHash: NEW_HASH, deliveryCopies: { master: recordedMaster() } }),
    )
    expect(await stale.result).toBeNull()
  })

  it('serves from the platform while the flag is off for the org', async () => {
    mockFlagOn = false
    const { result, fake } = redirect(videoDoc({ deliveryCopies: { master: recordedMaster() } }))
    expect(await result).toBeNull()
    expect(fake.minted).toEqual([])
  })

  it('redirects a rendition only to that rendition’s own copy', async () => {
    const renditionCopy = {
      key: `hosts/host-1/med-film/${MASTER_HASH}/r-720p/${md5Hex('RENDITION')}`,
      sourceHash: MASTER_HASH,
      objectHash: md5Hex('RENDITION'),
      contentType: 'video/mp4',
      sizeBytes: 9,
      copiedAtMs: NOW - 1,
    }
    const withBoth = videoDoc({
      videoRenditions: [RENDITION],
      deliveryCopies: { master: recordedMaster(), 'r-720p': renditionCopy },
    })
    const { result } = redirect(withBoth, { rendition: RENDITION, servedType: 'video/mp4' })
    expect((await result)?.key).toBe(renditionCopy.key)
    const masterOnly = redirect(videoDoc({ deliveryCopies: { master: recordedMaster() } }), {
      rendition: RENDITION,
      servedType: 'video/mp4',
    })
    expect(await masterOnly.result).toBeNull()
  })

  it('never redirects an image, whatever its document says', async () => {
    const { result } = redirect(
      videoDoc({ deliveryCopies: { master: recordedMaster() } }),
      { servedType: 'image/webp' },
    )
    expect(await result).toBeNull()
    expect(mockFlagAsked).toEqual([])
  })

  it('serves from the platform when the provider cannot mint', async () => {
    const fake = fakeProvider()
    fake.provider.deliveryUrl = async () => {
      throw new Error('misconfigured')
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const document = videoDoc({ deliveryCopies: { master: recordedMaster() } })
    expect(
      await mediaDeliveryRedirect({
        provider: fake.provider,
        asset: ASSET,
        document: { get: (field) => document[field] },
        servedType: 'video/mp4',
        claims: { scope: 'host-1', mediaId: 'med-film', hostId: 'host-1' },
        orgId: async () => 'org-acme',
        nowMs: NOW,
      }),
    ).toBeNull()
    error.mockRestore()
  })
})

/*===========================================================================
 * The copy flow.
 *==========================================================================*/

describe('the copy flow (AGL-2824)', () => {
  const MASTER_PATH = 'hosts/host-1/media/Films/med-film'
  const RENDITION_PATH = `${MASTER_PATH}__r720p.mp4`

  it('finalize: copies the master under its hash and records it, counting nothing twice', async () => {
    const doc = fakeDoc(videoDoc())
    const bucket = fakeBucket({ [MASTER_PATH]: { bytes: 'FILM-MASTER', contentType: 'video/mp4' } })
    const fake = fakeProvider()
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      orgId: 'org-acme',
      provider: fake.provider,
      nowMs: () => NOW,
    })
    expect(result).toEqual({
      status: 'synced',
      copied: ['master'],
      kept: [],
      removed: [],
      failed: [],
    })
    expect(fake.objects.get(masterKey())).toEqual({
      bytes: 'FILM-MASTER',
      contentType: 'video/mp4',
      length: 11,
    })
    expect(doc.read()?.['deliveryCopies']).toEqual({
      master: {
        key: masterKey(),
        sourceHash: MASTER_HASH,
        objectHash: MASTER_HASH,
        contentType: 'video/mp4',
        sizeBytes: 11,
        copiedAtMs: NOW,
      },
    })
    // Only the copy record moved: the byte counts the storage band reads live
    // on the document and the counter, and neither was written.
    expect(Object.keys(doc.read() ?? {}).sort()).toEqual(
      [...Object.keys(videoDoc()), 'deliveryCopies'].sort(),
    )
    expect(mockFlagAsked).toEqual(['org-acme'])
  })

  it('finalize, flag off: copies nothing and reads nothing from the bucket', async () => {
    mockFlagOn = false
    const doc = fakeDoc(videoDoc())
    const bucket = fakeBucket({ [MASTER_PATH]: { bytes: 'FILM', contentType: 'video/mp4' } })
    const fake = fakeProvider()
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      provider: fake.provider,
    })
    expect(result.status).toBe('disabled')
    expect(fake.objects.size).toBe(0)
    expect(bucket.reads).toEqual([])
    expect(doc.read()?.['deliveryCopies']).toBeUndefined()
    // The host library's org was resolved for the flag, not assumed.
    expect(mockFlagAsked).toEqual(['org-of-host-1'])
  })

  it('does nothing at all without a provider, and nothing for an image', async () => {
    const doc = fakeDoc(videoDoc())
    const bucket = fakeBucket({})
    expect(
      (await syncMediaDeliveryCopies({ docRef: doc.ref, asset: ASSET, bucket, provider: null }))
        .status,
    ).toBe('no-provider')
    const image = fakeDoc(videoDoc({ contentType: 'image/png' }))
    expect(
      (
        await syncMediaDeliveryCopies({
          docRef: image.ref,
          asset: ASSET,
          bucket,
          provider: fakeProvider().provider,
        })
      ).status,
    ).toBe('not-video')
    expect(mockFlagAsked).toEqual([])
  })

  it('the rendition producer: copies each rendition under its own digest, keeps the master', async () => {
    const doc = fakeDoc(
      videoDoc({ videoRenditions: [RENDITION], deliveryCopies: { master: recordedMaster() } }),
    )
    const bucket = fakeBucket({
      [MASTER_PATH]: { bytes: 'FILM-MASTER', contentType: 'video/mp4' },
      [RENDITION_PATH]: { bytes: 'RENDITION', contentType: 'video/mp4' },
    })
    const fake = fakeProvider()
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      orgId: 'org-acme',
      provider: fake.provider,
      nowMs: () => NOW,
    })
    const renditionKey = `hosts/host-1/med-film/${MASTER_HASH}/r-720p/${md5Hex('RENDITION')}`
    expect(result).toMatchObject({ copied: ['r-720p'], kept: ['master'], removed: [] })
    expect(fake.objects.get(renditionKey)?.bytes).toBe('RENDITION')
    // The master's current copy cost no Storage read.
    expect(bucket.reads).toEqual([RENDITION_PATH])
    expect(Object.keys(doc.read()?.['deliveryCopies'] as object).sort()).toEqual([
      'master',
      'r-720p',
    ])
  })

  it('a rendition encoded again gets a new key, and its old copy is removed', async () => {
    const oldKey = `hosts/host-1/med-film/${MASTER_HASH}/r-720p/${md5Hex('OLD-ENCODE')}`
    const doc = fakeDoc(
      videoDoc({
        videoRenditions: [RENDITION],
        deliveryCopies: {
          master: recordedMaster(),
          'r-720p': {
            key: oldKey,
            sourceHash: MASTER_HASH,
            objectHash: md5Hex('OLD-ENCODE'),
            contentType: 'video/mp4',
            sizeBytes: 10,
            copiedAtMs: NOW - 1,
          },
        },
      }),
    )
    const bucket = fakeBucket({
      [MASTER_PATH]: { bytes: 'FILM-MASTER', contentType: 'video/mp4' },
      [RENDITION_PATH]: { bytes: 'NEW-ENCODE', contentType: 'video/mp4' },
    })
    const fake = fakeProvider()
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      orgId: 'org-acme',
      provider: fake.provider,
    })
    expect(result).toMatchObject({ copied: ['r-720p'], removed: [oldKey] })
    expect(fake.deleted).toEqual([oldKey])
  })

  it('replace: the new bytes get new keys, and the previous copies are removed', async () => {
    const doc = fakeDoc(
      videoDoc({ contentHash: NEW_HASH, deliveryCopies: { master: recordedMaster() } }),
    )
    const bucket = fakeBucket({ [MASTER_PATH]: { bytes: 'NEW-FILM', contentType: 'video/mp4' } })
    const fake = fakeProvider()
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      orgId: 'org-acme',
      provider: fake.provider,
    })
    expect(result).toMatchObject({ copied: ['master'], removed: [masterKey()] })
    expect(fake.objects.get(masterKey(NEW_HASH))?.bytes).toBe('NEW-FILM')
    expect(fake.deleted).toEqual([masterKey()])
    expect((doc.read()?.['deliveryCopies'] as Record<string, { key: string }>)['master']?.key).toBe(
      masterKey(NEW_HASH),
    )
  })

  it('replace landing mid-copy: nothing is recorded, and the copy just made is removed', async () => {
    const doc = fakeDoc(videoDoc())
    const bucket = fakeBucket({ [MASTER_PATH]: { bytes: 'FILM-MASTER', contentType: 'video/mp4' } })
    const fake = fakeProvider()
    const put = fake.provider.putObject
    fake.provider.putObject = async (request) => {
      await put(request)
      doc.replaceWith(videoDoc({ contentHash: NEW_HASH }))
    }
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      orgId: 'org-acme',
      provider: fake.provider,
    })
    expect(result.status).toBe('replaced')
    expect(doc.read()?.['deliveryCopies']).toBeUndefined()
    expect(fake.objects.size).toBe(0)
    expect(fake.deleted).toEqual([masterKey()])
  })

  it('a copy that fails leaves the others recorded and that representation on the platform', async () => {
    const doc = fakeDoc(videoDoc({ videoRenditions: [RENDITION] }))
    const bucket = fakeBucket({
      [MASTER_PATH]: { bytes: 'FILM-MASTER', contentType: 'video/mp4' },
      [RENDITION_PATH]: { bytes: 'RENDITION', contentType: 'video/mp4' },
    })
    const fake = fakeProvider({ failPutFor: '/r-720p/' })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await syncMediaDeliveryCopies({
      docRef: doc.ref,
      asset: ASSET,
      bucket,
      orgId: 'org-acme',
      provider: fake.provider,
    })
    error.mockRestore()
    expect(result).toMatchObject({ copied: ['master'], failed: ['r-720p'] })
    expect(Object.keys(doc.read()?.['deliveryCopies'] as object)).toEqual(['master'])
  })

  it('delete and takedown: remove every copy under the asset’s prefix, flag or no flag', async () => {
    mockFlagOn = false
    const fake = fakeProvider()
    fake.objects.set(masterKey(), { bytes: 'x', contentType: 'video/mp4', length: 1 })
    fake.objects.set('hosts/host-1/med-other/a/master/a', {
      bytes: 'y',
      contentType: 'video/mp4',
      length: 1,
    })
    expect(await removeMediaDeliveryCopies({ asset: ASSET, provider: fake.provider })).toEqual({
      removed: 1,
      failed: false,
    })
    expect(fake.prefixDeletes).toEqual(['hosts/host-1/med-film/'])
    expect([...fake.objects.keys()]).toEqual(['hosts/host-1/med-other/a/master/a'])
    expect(await removeMediaDeliveryCopies({ asset: ASSET, provider: null })).toBeNull()
  })

  it('erasure: removes a whole library’s copies, and reports rather than throws a failure', async () => {
    const fake = fakeProvider()
    expect(
      await eraseMediaDeliveryScope({ collection: 'orgs', scopeId: 'acme', provider: fake.provider }),
    ).toEqual({ removed: 0, failed: false })
    expect(fake.prefixDeletes).toEqual(['orgs/acme/'])
    fake.provider.deleteObjectsWithPrefix = async () => {
      throw new Error('provider down')
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(
      await eraseMediaDeliveryScope({ collection: 'orgs', scopeId: 'acme', provider: fake.provider }),
    ).toEqual({ removed: 0, failed: true })
    error.mockRestore()
  })
})
