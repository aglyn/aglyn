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
 * A gated video on the media CDN: no bytes without a signature, on any path
 * (AGL-2814).
 *
 * A members video is a PRIVATE asset, and the commerce stream route hands an
 * entitled buyer a CDN URL signed for one viewing session. That design holds
 * only if EVERY way of asking this route for the asset demands the signature:
 * the master, the negotiated and the named rendition, a byte range, a HEAD, a
 * conditional request, the stale-content-pin redirect, a download, and the
 * poster. Any one exit that answers without it is the leak again, one query
 * parameter away.
 *
 * The emulator suite covers a private PDF; this file is the video, in the
 * default sweep, with real signatures minted by the module the stream route
 * uses. Firestore and Storage are stubbed.
 *
 * ## Why the poster stays behind the signature too
 *
 * A poster is a preview, and it would be safe to serve publicly. It is not,
 * because the private check runs once, before the representation is chosen,
 * and that ordering is what guarantees no later branch can forget it. The
 * gated player shows no poster, so nothing is lost by keeping it that way.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'gated-cdn-spec-secret'

import { Readable, Writable } from 'node:stream'
import {
  GATED_VIDEO_SESSION_TTL_MS,
  MEDIA_SIGNATURE_MAX_TTL_MS,
  mintMediaSignature,
  signMediaAccess,
} from './media-signing'
import { serveMediaCdn } from './serve-media-cdn'

const FILM = 'THE-ENTIRE-PURCHASED-FILM'
const SCOPE = 'org:acme:host-1'
const MEDIA_ID = 'med-film'
const CURRENT_HASH = '0123456789abcdef'

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
      createReadStream: (options: { start?: number; end?: number } = {}) =>
        Readable.from([
          Buffer.from(
            FILM.slice(options.start ?? 0, (options.end ?? FILM.length - 1) + 1),
          ),
        ]),
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

async function serve(options: {
  path?: string[]
  query?: Record<string, string>
  headers?: Record<string, string>
  method?: 'GET' | 'HEAD'
}): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    {
      method: options.method ?? 'GET',
      query: { path: options.path ?? [SCOPE, MEDIA_ID], ...options.query },
      headers: options.headers ?? {},
    } as never,
    res as never,
  )
  return res
}

/** A session signature, exactly as the stream route mints one. */
const session = () => {
  const signature = mintMediaSignature(
    SCOPE,
    MEDIA_ID,
    Date.now(),
    GATED_VIDEO_SESSION_TTL_MS,
  )
  return { exp: String(signature.exp), sig: signature.sig }
}

/** A gated film: private, with a poster and a rendition. */
const GATED_FILM = {
  fileName: 'week-1.mp4',
  contentType: 'video/mp4',
  storagePath: 'orgs/acme/media/Films/med-film',
  contentHash: CURRENT_HASH,
  variants: [],
  visibleTo: ['org'],
  private: true,
  poster: { width: 1920, height: 1080, variants: [320, 640] },
  videoRenditions: [
    {
      key: '720p',
      ext: 'mp4',
      contentType: 'video/mp4',
      width: 1280,
      height: 720,
      sizeBytes: FILM.length,
    },
  ],
}

beforeEach(() => {
  mockState.doc = { ...GATED_FILM }
  mockState.metadata = { contentType: 'video/mp4', size: FILM.length }
  mockState.requested = []
})

/** What a refusal must look like whatever was asked: no bytes, no pointer. */
function expectRefused(res: MockRes) {
  expect(res.statusCode).toBe(404)
  expect(res.body).not.toContain(FILM.slice(0, 8))
  expect(res.headers['location']).toBeUndefined()
  expect(res.headers['content-range']).toBeUndefined()
  expect(res.headers['content-disposition']).toBeUndefined()
  expect(res.headers['etag']).toBeUndefined()
  // A refusal is never kept by a shared cache, or it would outlive a fix.
  expect(res.headers['cache-control']).toBe('private, no-store')
  // Refused before any Storage object is opened.
  expect(mockState.requested).toEqual([])
}

describe('AGL-2814 · an unsigned request for a gated film is refused on every path', () => {
  it.each([
    ['the master', {}],
    ['the negotiated rendition', { query: { r: 'auto' } }],
    ['a named rendition', { query: { r: '720p' } }],
    ['a byte range', { headers: { range: 'bytes=0-4' } }],
    ['an open-ended byte range', { headers: { range: 'bytes=5-' } }],
    ['a HEAD', { method: 'HEAD' as const }],
    ['a download', { query: { download: '1' } }],
    ['the poster', { query: { poster: '1' } }],
    ['a poster width', { query: { poster: '1', w: '640' } }],
    ['a revalidation', { headers: { 'if-none-match': `"${CURRENT_HASH}"` } }],
    ['the current content pin', { path: [SCOPE, MEDIA_ID, CURRENT_HASH] }],
    [
      'a stale content pin, which must not become a redirect',
      { path: [SCOPE, MEDIA_ID, 'staleoldhash000'], query: { r: 'auto' } },
    ],
  ])('%s', async (_label, request) => {
    expectRefused(await serve(request))
  })

  it('under the bare org scope as well as the site-qualified one', async () => {
    expectRefused(await serve({ path: ['org:acme', MEDIA_ID] }))
  })
})

describe('AGL-2814 · a signature that does not authorize this request is refused', () => {
  it('an expired one, correctly signed', async () => {
    const exp = Date.now() - 1
    const expired = { exp: String(exp), sig: signMediaAccess(SCOPE, MEDIA_ID, exp) }
    expectRefused(await serve({ query: expired }))
    expectRefused(
      await serve({ query: expired, headers: { range: 'bytes=0-4' } }),
    )
  })

  it('one minted for the bare org scope, presented under the site-qualified URL', async () => {
    const signature = mintMediaSignature('org:acme', MEDIA_ID)
    expectRefused(
      await serve({
        query: { exp: String(signature.exp), sig: signature.sig },
      }),
    )
  })

  it('one minted for a different asset', async () => {
    const signature = mintMediaSignature(SCOPE, 'med-trailer')
    expectRefused(
      await serve({
        query: { exp: String(signature.exp), sig: signature.sig },
      }),
    )
  })

  it('one whose lifetime no minter issues, even with a valid HMAC', async () => {
    const exp = Date.now() + MEDIA_SIGNATURE_MAX_TTL_MS + 5 * 60 * 1000
    expectRefused(
      await serve({
        query: { exp: String(exp), sig: signMediaAccess(SCOPE, MEDIA_ID, exp) },
      }),
    )
  })

  it('one whose expiry was pushed out after signing', async () => {
    const signature = session()
    expectRefused(
      await serve({
        query: { exp: String(Number(signature.exp) + 60_000), sig: signature.sig },
      }),
    )
  })
})

describe('AGL-2814 · an entitled buyer’s signed session plays', () => {
  it('serves the film, kept out of every shared cache', async () => {
    const res = await serve({ query: session() })
    expect(res.body).toBe(FILM)
    expect(res.headers['content-type']).toBe('video/mp4')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('answers a seek with 206 and exactly the requested bytes', async () => {
    const res = await serve({
      query: session(),
      headers: { range: 'bytes=4-9' },
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe(`bytes 4-9/${FILM.length}`)
    expect(res.headers['content-length']).toBe('6')
    expect(res.body).toBe(FILM.slice(4, 10))
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('keeps answering seeks for the whole session, not only the first request', async () => {
    const signature = session()
    for (const range of ['bytes=0-3', 'bytes=10-15', `bytes=${FILM.length - 4}-`]) {
      const res = await serve({ query: signature, headers: { range } })
      expect(res.statusCode).toBe(206)
      expect(res.headers['cache-control']).toBe('private, no-store')
    }
  })

  it('negotiates the rendition under the same signature', async () => {
    const res = await serve({ query: { ...session(), r: 'auto' } })
    expect(mockState.requested).toEqual(['orgs/acme/media/Films/med-film__r720p.mp4'])
    expect(res.headers['vary']).toBe('Accept')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('answers HEAD with the headers and no body', async () => {
    const res = await serve({ query: session(), method: 'HEAD' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('')
    expect(res.headers['content-length']).toBe(String(FILM.length))
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('redirects a stale pin to the stable URL carrying the signature, never cached', async () => {
    const signature = session()
    const res = await serve({
      path: [SCOPE, MEDIA_ID, 'staleoldhash000'],
      query: { ...signature, r: 'auto' },
    })
    expect(res.statusCode).toBe(302)
    const location = new URL(String(res.headers['location']), 'https://shop.example')
    expect(location.pathname).toBe(`/api/media/cdn/${SCOPE}/${MEDIA_ID}`)
    expect(location.searchParams.get('exp')).toBe(signature.exp)
    expect(location.searchParams.get('sig')).toBe(signature.sig)
    expect(location.searchParams.get('r')).toBe('auto')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('withholds the immutable year from the pinned form of a private film', async () => {
    const res = await serve({
      path: [SCOPE, MEDIA_ID, CURRENT_HASH],
      query: session(),
    })
    expect(res.body).toBe(FILM)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('keeps an unsatisfiable range out of every cache', async () => {
    const res = await serve({
      query: session(),
      headers: { range: `bytes=${FILM.length + 10}-` },
    })
    expect(res.statusCode).toBe(416)
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})
