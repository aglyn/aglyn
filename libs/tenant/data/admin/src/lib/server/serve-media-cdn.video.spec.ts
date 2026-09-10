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

/**
 * A video's poster and renditions, and the cache tier each one lands in
 * (AGL-2743).
 *
 * The delivery claim this feature is built on is one sentence: **a poster is
 * edge-cacheable and the video it belongs to is not.** Everything else — the
 * poster generation, the browser probe, the `<video poster>` attribute — is
 * only worth having if that holds, because a poster served origin-only saves
 * a page nothing it could not have saved with `preload="none"`.
 *
 * It holds without touching `mediaCdnEdgeCacheable`, and that is the point of
 * the first suite below: the tier is a pure function of the SERVED type, the
 * handler re-derives it from the authoritative type after the Storage read,
 * and a poster response genuinely is `image/webp`. Asserting it here rather
 * than reasoning about it is what keeps a later refactor of the branch order
 * from quietly moving video onto the shared edge — the AGL-1515 regression,
 * which is silent playback corruption rather than a failed test.
 *
 * The second suite is the other half of the same verdict: a rendition stays
 * `private`. It is the branch most likely to look like an easy win — a 12 MB
 * fixed-size file is well inside Vercel's 10 MB-ish cacheable band, unlike a
 * 200 MB master — and AGL-1515's own note records that the mangling
 * reproduced on a 186 KB asset *because* small ones are the ones that get
 * cached. So the smallness is the argument against, and this spec is where
 * that argument is enforced rather than remembered.
 *
 * Same harness as `serve-media-cdn.etag.spec.ts`, with the requested object
 * path recorded so a test can assert WHICH object answered — the difference
 * between a poster URL serving a poster and a poster URL serving the film.
 */

import { Readable, Writable } from 'node:stream'
import {
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL,
  serveMediaCdn,
} from './serve-media-cdn'

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** Every object path the handler asked the bucket for. */
  requested: string[]
} = { doc: null, metadata: null, requested: [] }

jest.mock('./firebase-admin', () => {
  const snapshot = () => ({
    get exists() {
      return mockState.doc !== null
    },
    get: (field: string) => mockState.doc?.[field],
  })
  const docRef = (): unknown => ({
    collection: () => ({ doc: () => docRef() }),
    get: async () => snapshot(),
    set: async () => undefined,
  })
  const file = (path: string) => {
    mockState.requested.push(path)
    return {
      getMetadata: async () => {
        if (!mockState.metadata) throw new Error('No such object')
        return [mockState.metadata]
      },
      createReadStream: () => Readable.from([Buffer.from('BYTES')]),
    }
  }
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({ collection: () => ({ doc: () => docRef() }) }),
        storage: () => ({ bucket: () => ({ file }) }),
      }),
      firestore: { FieldValue: { increment: (n: number) => ({ increment: n }) } },
    },
  }
})

class MockRes extends Writable {
  headers: Record<string, string> = {}
  statusCode = 0
  headersSent = false
  body = ''

  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = String(value)
    return this
  }
  getHeader(key: string) {
    return this.headers[key.toLowerCase()]
  }
  status(code: number) {
    this.statusCode = code
    this.headersSent = true
    return this
  }
  json(payload: unknown) {
    this.end(JSON.stringify(payload))
    return this
  }
  send(payload: unknown) {
    this.end(String(payload))
    return this
  }
  override _write(
    chunk: Buffer | string,
    _encoding: unknown,
    done: (error?: Error) => void,
  ) {
    this.body += String(chunk)
    done()
  }
}

async function serve(
  query: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    {
      method: 'GET',
      query: { path: ['org:acme', 'v1'], ...query },
      headers,
    } as never,
    res as never,
  )
  return res
}

/** A film with a poster and one rendition — the shape AGL-2742 writes. */
const VIDEO_DOC = {
  fileName: 'product-film.mp4',
  contentType: 'video/mp4',
  sizeBytes: 62_914_560,
  storagePath: 'orgs/acme/media/Film/v1',
  cdnPath: '/api/media/cdn/org:acme/v1',
  contentHash: '0123456789abcdef',
  variants: [],
  visibleTo: ['org'],
  video: { durationMs: 60_000, width: 1920, height: 1080 },
  poster: { width: 1920, height: 1080, variants: [320, 640, 1280] },
  videoRenditions: [
    {
      key: '720p',
      ext: 'mp4',
      contentType: 'video/mp4',
      width: 1280,
      height: 720,
      sizeBytes: 12_582_912,
    },
  ],
}

beforeEach(() => {
  mockState.doc = { ...VIDEO_DOC }
  mockState.metadata = { contentType: 'video/mp4', size: 62_914_560 }
  mockState.requested = []
})

const lastRequested = () => mockState.requested[mockState.requested.length - 1]

describe('AGL-2743 · a poster is an image, so it takes the shared edge policy', () => {
  it('serves the poster object as image/webp under the edge-cacheable policy', async () => {
    const res = await serve({ poster: '1' })
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1__poster.webp')
    expect(res.getHeader('content-type')).toBe('image/webp')
    // The whole delivery argument, in one assertion: `public` + `s-maxage`,
    // which is what puts a ~40 KB still on the edge instead of streaming a
    // 60 MB film from origin to paint a first frame.
    expect(res.getHeader('cache-control')).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('narrows to a generated poster width when one is asked for', async () => {
    const res = await serve({ poster: '1', w: '640' })
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1__poster__w640.webp')
    expect(res.getHeader('content-type')).toBe('image/webp')
  })

  it('falls back to the full poster for a width nothing was generated at', async () => {
    const res = await serve({ poster: '1', w: '999' })
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1__poster.webp')
    expect(res.getHeader('content-type')).toBe('image/webp')
  })

  it('serves the MASTER when the document records no poster', async () => {
    mockState.doc = { ...VIDEO_DOC, poster: undefined }
    const res = await serve({ poster: '1' })
    // A renderer may advertise `?poster=1` without reading the document, so
    // the absence of one has to degrade rather than 404 — the same rule `?w=`
    // has had since AGL-175.
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1')
    expect(res.getHeader('content-type')).toBe('video/mp4')
  })

  it('gives the poster its own validator, so no cache can swap it for the film', async () => {
    const poster = await serve({ poster: '1' })
    const master = await serve()
    expect(poster.getHeader('etag')).not.toBe(master.getHeader('etag'))
    expect(poster.getHeader('etag')).toContain('-poster')
  })
})

describe('AGL-2743 · a rendition is still video, so it stays off the edge', () => {
  it('serves the rendition object with its own type, origin-only', async () => {
    const res = await serve({ r: '720p' })
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1__r720p.mp4')
    expect(res.getHeader('content-type')).toBe('video/mp4')
    // ⛔ `private`. Being SMALL is what makes a rendition eligible for the
    // edge and therefore eligible for the AGL-1515 hybrid — a cached
    // full-body 200 answering a player's `Range` with a 200 + Content-Range +
    // sliced body. The saving a rendition makes is fewer bytes, never a
    // cheaper tier.
    expect(res.getHeader('cache-control')).toBe(
      MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL,
    )
    expect(res.getHeader('accept-ranges')).toBe('bytes')
  })

  it('serves the MASTER for a rendition key the document does not list', async () => {
    await serve({ r: '1080p' })
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1')
  })

  it('refuses a rendition entry whose key would escape the asset prefix', async () => {
    mockState.doc = {
      ...VIDEO_DOC,
      videoRenditions: [
        {
          key: '../../../adminAudit-archive/secret',
          ext: 'mp4',
          contentType: 'video/mp4',
          width: 1280,
          height: 720,
          sizeBytes: 1,
        },
      ],
    }
    await serve({ r: '../../../adminAudit-archive/secret' })
    // A media document is writable by anyone with editor rights on the scope,
    // and this path is composed for an ADMIN-SDK bucket read that Storage
    // rules do not constrain. `parseMediaRendition` is the gate; the fallback
    // to the master is what an invalid entry costs.
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1')
  })

  it('gives each rendition its own validator', async () => {
    const rendition = await serve({ r: '720p' })
    const master = await serve()
    expect(rendition.getHeader('etag')).toContain('-r720p')
    expect(rendition.getHeader('etag')).not.toBe(master.getHeader('etag'))
  })
})

describe('AGL-2743 · the master is unchanged by any of this', () => {
  it('still serves video/mp4 origin-only with Range support', async () => {
    const res = await serve()
    expect(lastRequested()).toBe('orgs/acme/media/Film/v1')
    expect(res.getHeader('cache-control')).toBe(
      MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL,
    )
    expect(res.getHeader('accept-ranges')).toBe('bytes')
  })

  it('leaves an image asset with no video fields behaving exactly as before', async () => {
    mockState.doc = {
      fileName: 'logo.png',
      contentType: 'image/png',
      sizeBytes: 8,
      storagePath: 'orgs/acme/media/logo',
      cdnPath: '/api/media/cdn/org:acme/logo',
      contentHash: 'abc0123456789def',
      variants: [320],
      visibleTo: ['org'],
    }
    mockState.metadata = { contentType: 'image/png', size: 8 }
    const variant = await serve({ w: '320' })
    expect(lastRequested()).toBe('orgs/acme/media/logo__w320.webp')
    expect(variant.getHeader('content-type')).toBe('image/webp')
    expect(variant.getHeader('etag')).toContain('-w320')
    expect(variant.getHeader('cache-control')).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })
})
