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
 * The stable CDN URL carries a cache validator (AGL-1485).
 *
 * `serve-media-cdn.spec.ts` proves `MEDIA_CDN_STABLE_CACHE_CONTROL` leaves the
 * browser a short enough `max-age` to ask again. That is only half the
 * mechanism: asking again is worthless if the response has nothing to ask
 * against. `Cache-Control` is a string constant and cannot regress silently;
 * the ETag is computed from a DOCUMENT FIELD, and a document is exactly the
 * thing a new write path can get wrong.
 *
 * It did. A legacy fourth upload route created media documents with no
 * `contentHash`, and `etag` is `contentHash ? … : null` — so those assets
 * served with no validator at all, and a replaced asset could never propagate
 * past an edge or a browser that already held the old bytes. Measured on the
 * live favicon in AGL-1464 before the field was written by hand.
 *
 * So the two cases below are a matched pair, and the second is the point: it
 * is not describing a nicety, it is the exact reachable state that route left
 * behind. Which document shapes are reachable is held by
 * `apps/console/specs/media-create-shape.spec.ts`; what the absence COSTS is
 * held here, because a field-coverage test cannot show you a missing header.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage stubbed,
 * the same harness `serve-media-cdn.csp.spec.ts` uses.
 */

import { Readable, Writable } from 'node:stream'
import { serveMediaCdn } from './serve-media-cdn'

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
    createReadStream: () => Readable.from([Buffer.from('PNGBYTES')]),
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
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method: 'GET', query: { path, ...query }, headers } as never,
    res as never,
  )
  return res
}

/**
 * The document every surviving creator writes, reduced to the fields this
 * response depends on. `contentHash` is the one under test.
 */
const FULL_SHAPE = {
  fileName: 'favicon.png',
  contentType: 'image/png',
  sizeBytes: 8,
  storagePath: 'orgs/acme/media/Brand/Marks/m1',
  cdnPath: '/api/media/cdn/org:acme/m1',
  contentHash: '0123456789abcdef',
  variants: [320],
  folderId: 'brand-marks',
  visibleTo: ['org'],
}

/**
 * ...and the shape the deleted fourth creator wrote, verbatim: six fields and
 * the scope stamp AGL-1478 added to it. Kept as a literal rather than derived
 * by deleting keys from the one above, because the value of this case is that
 * it is a real document that really existed.
 */
const LEGACY_SHAPE = {
  fileName: 'favicon.png',
  contentType: 'image/png',
  sizeBytes: 8,
  url: 'https://firebasestorage.googleapis.com/v0/b/b/o/orgs%2Facme%2Fmedia%2Fm1?alt=media&token=t',
  uploadedBy: 'user-1',
  visibleTo: ['org'],
}

beforeEach(() => {
  mockState.doc = { ...FULL_SHAPE }
  mockState.metadata = { contentType: 'image/png', size: 8 }
})

/**
 * A served GET streams the object and never calls `res.status()`, so the
 * bytes are what says "this was a 200" — the same reason the CSP suite reads
 * `res.body` rather than a status on its success cases.
 */
const served = (res: MockRes) => res.statusCode === 0 && res.body === 'PNGBYTES'

describe('AGL-1485 · the stable CDN URL serves a cache validator', () => {
  it('sets an ETag built from the content hash', async () => {
    const res = await serve(['org:acme', 'm1'])
    expect(served(res)).toBe(true)
    expect(res.headers['etag']).toBe('"0123456789abcdef"')
  })

  it('answers 304 to a conditional GET that matches it', async () => {
    const first = await serve(['org:acme', 'm1'])
    const etag = first.headers['etag']
    const second = await serve(['org:acme', 'm1'], {}, { 'if-none-match': etag })
    expect(second.statusCode).toBe(304)
    expect(second.body).toBe('')
  })

  it('changes the validator when the bytes change — a replace propagates', async () => {
    const before = (await serve(['org:acme', 'm1'])).headers['etag']
    mockState.doc = { ...FULL_SHAPE, contentHash: 'fedcba9876543210' }
    const stale = await serve(['org:acme', 'm1'], {}, { 'if-none-match': before })
    // Not 304: the client's stored copy is refused and the new bytes go out.
    expect(served(stale)).toBe(true)
    expect(stale.headers['etag']).not.toBe(before)
  })

  it('varies the validator by representation, not just by URL', async () => {
    // A validator is not scoped to a URL in practice, so the inline and
    // download forms of the same bytes must not share one.
    const inline = (await serve(['org:acme', 'm1'])).headers['etag']
    const download = (await serve(['org:acme', 'm1'], { download: '1' }))
      .headers['etag']
    expect(download).not.toBe(inline)
  })

  describe('the shape the deleted fourth creator wrote', () => {
    beforeEach(() => {
      mockState.doc = { ...LEGACY_SHAPE }
    })

    it('serves with NO ETag at all — this is the regression, stated', async () => {
      const res = await serve(['org:acme', 'm1'])
      // It is a 200. Nothing looks broken: the bytes arrive, the type is
      // right, and the fallback object path resolves. There is simply no
      // validator, so every conditional GET is answered with the whole file
      // and a replaced asset stays replaced only for clients that never
      // cached it.
      expect(served(res)).toBe(true)
      expect(res.headers['etag']).toBeUndefined()
    })

    it('cannot 304, so no cached copy is ever revalidated', async () => {
      const res = await serve(
        ['org:acme', 'm1'],
        {},
        { 'if-none-match': '"0123456789abcdef"' },
      )
      expect(res.statusCode).not.toBe(304)
      expect(served(res)).toBe(true)
    })

    it('still advertises a cache lifetime, which is what hid it', async () => {
      // The response asks to be cached and gives the cache nothing to
      // revalidate against — the combination that makes this silent rather
      // than merely inefficient.
      expect((await serve(['org:acme', 'm1'])).headers['cache-control']).toContain(
        'max-age',
      )
    })
  })
})
