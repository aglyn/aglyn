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
 * A stale content pin redirects instead of 404ing (AGL-2685), driven through
 * the real `serveMediaCdn`.
 *
 * This exit keeps a content-hashed URL that is already out in the world
 * working after its asset is **replaced**: it lands on the current bytes
 * instead of a broken image. It is not what makes a replace reach a page. An
 * edge or a browser holding the immutable response never asks this handler
 * again, which is why no page names that form
 * (`serve-media-cdn.published-reference.spec.ts`, AGL-2798).
 *
 * Firestore and Storage are stubbed (no emulator), so this runs in the
 * default sweep. The private-asset half — that the redirect stays
 * `private, no-store` while carrying a signature in its `Location` — needs a
 * real signature and lives in `serve-media-cdn.emulator.spec.ts`.
 */

import { Readable, Writable } from 'node:stream'
import {
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  mediaCdnForwardedQuery,
  serveMediaCdn,
} from './serve-media-cdn'

const CURRENT = 'abc123def4567890'
const ORG_WIDE = {
  contentType: 'image/png',
  visibleTo: ['org'],
  contentHash: CURRENT,
  variants: [320, 640],
}

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
} = { doc: null, metadata: null }

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
  const file = () => ({
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [mockState.metadata]
    },
    createReadStream: () => Readable.from([Buffer.from('PNG.')]),
  })
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
  path: string[],
  query: Record<string, string> = {},
  method: 'GET' | 'HEAD' = 'GET',
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path, ...query }, headers: {} } as never,
    res as never,
  )
  return res
}

beforeEach(() => {
  mockState.doc = { ...ORG_WIDE, fileName: 'logo.png' }
  mockState.metadata = { contentType: 'image/png', size: 4 }
})

describe('a stale content pin redirects (AGL-2685)', () => {
  it('302s to the stable URL for the same asset', () => {
    return serve(['org:acme', 'm1', 'staleoldhash000']).then((res) => {
      expect(res.statusCode).toBe(302)
      expect(res.headers['location']).toBe('/api/media/cdn/org:acme/m1')
    })
  })

  it('serves the bytes when the pin is CURRENT', async () => {
    // The success path streams and never calls `status()`, so the harness
    // leaves `statusCode` at 0 — the evidence of a serve is the body and the
    // year-long policy, and the absence of a `Location` is what says this is
    // not the redirect under test.
    const res = await serve(['org:acme', 'm1', CURRENT])
    expect(res.body).toBe('PNG.')
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(res.headers['location']).toBeUndefined()
  })

  it('is a 302, never a 301', async () => {
    // A replace reverted to the previous bytes makes a stale hash current
    // again. A permanent redirect is the one browsers will not re-check.
    const res = await serve(['org:acme', 'm1', 'staleoldhash000'])
    expect(res.statusCode).not.toBe(301)
    expect(res.statusCode).not.toBe(308)
  })

  it('carries the redirect at the stable URL’s own cache policy', async () => {
    // Not a shorter one: the redirect is exactly as re-checkable as the
    // resource it points at, and it is the same answer for every caller.
    const res = await serve(['org:acme', 'm1', 'staleoldhash000'])
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
  })

  it('keeps the variant width, so a srcSet candidate is not silently upsized', async () => {
    const res = await serve(['org:acme', 'm1', 'staleoldhash000'], { w: '320' })
    expect(res.headers['location']).toBe('/api/media/cdn/org:acme/m1?w=320')
  })

  it('redirects rather than 404s when the asset carries no hash at all', async () => {
    // A legacy upload has no `contentHash`. Someone who guessed or kept a
    // three-segment URL for it used to get a 404; the asset exists and the
    // stable URL serves it.
    mockState.doc = { ...ORG_WIDE, contentHash: undefined }
    const res = await serve(['org:acme', 'm1', 'anything00000000'])
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/api/media/cdn/org:acme/m1')
  })

  it('answers HEAD the same way', async () => {
    const res = await serve(['org:acme', 'm1', 'staleoldhash000'], {}, 'HEAD')
    expect(res.statusCode).toBe(302)
    expect(res.headers['location']).toBe('/api/media/cdn/org:acme/m1')
  })

  it('still carries the base security headers', async () => {
    // They are set before every exit, and a redirect is an exit.
    const res = await serve(['org:acme', 'm1', 'staleoldhash000'])
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toBeDefined()
  })

  it('cannot become a redirect to somewhere else', async () => {
    // The `Location` is built from segments the handler already validated
    // against SEGMENT, so there is no input that makes this absolute.
    for (const bad of ['//evil.example', 'https://evil.example', '../../x']) {
      const res = await serve(['org:acme', 'm1', 'staleoldhash000'], { w: bad })
      expect(res.statusCode).toBe(302)
      expect(String(res.headers['location'])).toMatch(
        /^\/api\/media\/cdn\/org:acme\/m1(\?|$)/,
      )
    }
  })

  it('does not reach the redirect for a deleted asset', async () => {
    // Ordering: the redirect must sit BEHIND every refusal, or it becomes a
    // way to learn that a gated asset exists.
    mockState.doc = null
    expect((await serve(['org:acme', 'm1', 'staleoldhash000'])).statusCode).toBe(
      404,
    )
  })

  it('does not reach the redirect for an out-of-scope asset', async () => {
    mockState.doc = { ...ORG_WIDE, visibleTo: ['site-other'] }
    expect((await serve(['org:acme', 'm1', 'staleoldhash000'])).statusCode).toBe(
      404,
    )
  })
})

describe('mediaCdnForwardedQuery', () => {
  it('keeps only the four parameters the handler reads', () => {
    expect(
      mediaCdnForwardedQuery({
        w: '320',
        download: '1',
        exp: '99',
        sig: 'abc',
        utm_source: 'x',
        path: ['a', 'b'],
      } as never),
    ).toBe('?w=320&download=1&exp=99&sig=abc')
  })

  it('is empty when there is nothing to carry', () => {
    expect(mediaCdnForwardedQuery({ path: ['a', 'b'] } as never)).toBe('')
    expect(mediaCdnForwardedQuery({ w: '' } as never)).toBe('')
  })

  it('takes the first value of a repeated parameter', () => {
    expect(mediaCdnForwardedQuery({ w: ['320', '640'] } as never)).toBe('?w=320')
  })

  it('percent-encodes, so nothing reaches the header raw', () => {
    // The lock behind the lock: Node would reject a CR or LF outright, and
    // this makes sure such a value could not be assembled in the first place.
    expect(mediaCdnForwardedQuery({ sig: 'a b\r\nX-Evil: 1' } as never)).toBe(
      '?sig=a+b%0D%0AX-Evil%3A+1',
    )
  })
})
