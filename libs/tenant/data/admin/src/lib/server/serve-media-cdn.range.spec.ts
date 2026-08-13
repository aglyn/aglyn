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
 * Range / 206 support on the media CDN (AGL-1442 S4).
 *
 * The stakes are byte arithmetic: a `Content-Range` that is off by one does
 * not error, it hands a `<video>` element a frame-shifted slice and the
 * player corrupts playback silently. So every 206 case here asserts the
 * BYTES — the body is compared against a literal slice of the fixture, not
 * just the headers — and the stream mock records the `{start, end}` handed
 * to `createReadStream`, because "never over-read from GCS" is a claim about
 * what we ask Storage for, not about what we forward.
 *
 * The If-Range pair is the correctness core: a player that buffered half a
 * video, saw the asset replaced, and then seeks, presents its OLD validator.
 * Honoring that range against the NEW bytes splices two versions of a video
 * into one stream. Mismatch must collapse to a full 200.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage
 * stubbed — the same harness as `serve-media-cdn.etag.spec.ts`.
 */

import { Readable, Writable } from 'node:stream'
import {
  MEDIA_CDN_BASE_CSP,
  MEDIA_CDN_STABLE_CACHE_CONTROL,
  serveMediaCdn,
} from './serve-media-cdn'

/** 8 bytes, size below matches — every slice asserted is cut from this. */
const BYTES = Buffer.from('PNGBYTES')

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** The options each `createReadStream` call was given. */
  streamCalls: Array<{ start?: number; end?: number } | undefined>
} = { doc: null, metadata: null, streamCalls: [] }

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
    // Inclusive `start`/`end`, exactly the GCS contract the handler relies
    // on — a mock that sliced exclusively would hide an off-by-one in the
    // handler behind an equal and opposite one here.
    createReadStream: (options?: { start?: number; end?: number }) => {
      mockState.streamCalls.push(options)
      const start = options?.start ?? 0
      const end = options?.end
      return Readable.from([
        BYTES.subarray(start, end === undefined ? undefined : end + 1),
      ])
    },
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
  method: 'GET' | 'HEAD' = 'GET',
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path, ...query }, headers } as never,
    res as never,
  )
  return res
}

const FULL_SHAPE = {
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 8,
  storagePath: 'orgs/acme/media/Clips/m1',
  cdnPath: '/api/media/cdn/org:acme/m1',
  contentHash: '0123456789abcdef',
  variants: [],
  visibleTo: ['org'],
}

/** The deleted fourth creator's shape: no `contentHash`, so no validator. */
const LEGACY_SHAPE = {
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 8,
  url: 'https://firebasestorage.googleapis.com/v0/b/b/o/orgs%2Facme%2Fmedia%2Fm1?alt=media&token=t',
  uploadedBy: 'user-1',
  visibleTo: ['org'],
}

beforeEach(() => {
  mockState.doc = { ...FULL_SHAPE }
  // `size` is a STRING, because that is what GCS metadata actually carries —
  // the handler's arithmetic has to survive the coercion.
  mockState.metadata = { contentType: 'video/mp4', size: '8' }
  mockState.streamCalls = []
})

/** A full-body 200 never calls `res.status()` — the bytes say it served. */
const servedFull = (res: MockRes) =>
  res.statusCode === 0 && res.body === 'PNGBYTES'

describe('AGL-1442 S4 · single byte-ranges are served as 206', () => {
  it('serves the exact slice, with matching Content-Range and Content-Length', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=2-5' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('GBYT')
    expect(res.headers['content-range']).toBe('bytes 2-5/8')
    expect(res.headers['content-length']).toBe('4')
    // ...and Storage was asked for those bytes and no others.
    expect(mockState.streamCalls).toEqual([{ start: 2, end: 5 }])
  })

  it('runs an open-ended range to EOF', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=4-' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('YTES')
    expect(res.headers['content-range']).toBe('bytes 4-7/8')
  })

  it('serves a suffix range from the tail', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=-3' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('TES')
    expect(res.headers['content-range']).toBe('bytes 5-7/8')
  })

  it('bytes=0- is the whole file, and still a 206', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=0-' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('PNGBYTES')
    expect(res.headers['content-range']).toBe('bytes 0-7/8')
  })

  it('clamps an end past EOF instead of inventing bytes', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=6-999' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('ES')
    expect(res.headers['content-range']).toBe('bytes 6-7/8')
  })

  it('keeps the stable URL cache policy and the validator on a 206', async () => {
    // The edge never stores a ranged response (the request fails Vercel's
    // cacheable criteria), so this header speaks only to the browser — where
    // a 206 under a strong ETag lets a player reuse fetched segments.
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=0-3' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_CACHE_CONTROL)
    expect(res.headers['etag']).toBe('"0123456789abcdef"')
  })

  it('serves ranges on the immutable content-hashed URL too', async () => {
    const res = await serve(
      ['org:acme', 'm1', '0123456789abcdef'],
      {},
      { range: 'bytes=2-5' },
    )
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('GBYT')
    expect(res.headers['cache-control']).toContain('immutable')
  })
})

describe('AGL-1442 S4 · unsatisfiable ranges are refused with 416', () => {
  it('a start past EOF gets 416 with the total-size Content-Range', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=8-' })
    expect(res.statusCode).toBe(416)
    expect(res.headers['content-range']).toBe('bytes */8')
    expect(res.body).toBe('')
    // Nothing was read from Storage for a refusal.
    expect(mockState.streamCalls).toEqual([])
  })

  it('a zero-length suffix gets 416', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=-0' })
    expect(res.statusCode).toBe(416)
    expect(res.headers['content-range']).toBe('bytes */8')
  })

  it('the 416 is uncacheable — it answers a request HEADER, not the URL', async () => {
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=99-' })
    expect(res.headers['cache-control']).toBe('private, no-store')
  })
})

describe('AGL-1442 S4 · shapes the handler declines fall back to a full 200', () => {
  it('a multi-range request — no multipart body, the full file instead', async () => {
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { range: 'bytes=0-1,4-6' },
    )
    expect(servedFull(res)).toBe(true)
    expect(res.headers['content-range']).toBeUndefined()
  })

  it.each(['bytes=5-2', 'items=0-100', 'bytes=', 'bytes=-'])(
    'malformed or foreign range %p is ignored',
    async (range) => {
      const res = await serve(['org:acme', 'm1'], {}, { range })
      expect(servedFull(res)).toBe(true)
      expect(res.headers['content-range']).toBeUndefined()
    },
  )

  it('HEAD ignores Range and reports the full representation', async () => {
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { range: 'bytes=2-5' },
      'HEAD',
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-length']).toBe('8')
    expect(res.headers['content-range']).toBeUndefined()
  })
})

describe('AGL-1442 S4 · If-Range keeps a stale player off the new bytes', () => {
  it('a matching validator lets the range through', async () => {
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { range: 'bytes=2-5', 'if-range': '"0123456789abcdef"' },
    )
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('GBYT')
  })

  it('a stale validator forces the FULL body — never a splice of two versions', async () => {
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { range: 'bytes=2-5', 'if-range': '"fedcba9876543210"' },
    )
    expect(servedFull(res)).toBe(true)
    expect(res.headers['content-range']).toBeUndefined()
  })

  it('an asset with NO validator cannot honor If-Range at all', async () => {
    mockState.doc = { ...LEGACY_SHAPE }
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { range: 'bytes=2-5', 'if-range': '"0123456789abcdef"' },
    )
    expect(servedFull(res)).toBe(true)
  })

  it('...but serves a plain range fine — If-Range is the gated part', async () => {
    mockState.doc = { ...LEGACY_SHAPE }
    const res = await serve(['org:acme', 'm1'], {}, { range: 'bytes=0-3' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('PNGB')
  })
})

describe('AGL-1442 S4 · the existing contracts hold around the new branch', () => {
  it('If-None-Match still wins: a matching conditional GET is 304, range or not', async () => {
    const res = await serve(
      ['org:acme', 'm1'],
      {},
      { range: 'bytes=2-5', 'if-none-match': '"0123456789abcdef"' },
    )
    expect(res.statusCode).toBe(304)
    expect(res.body).toBe('')
  })

  it('the plain ETag/304 path is unchanged — regression pin', async () => {
    const first = await serve(['org:acme', 'm1'])
    expect(first.headers['etag']).toBe('"0123456789abcdef"')
    const second = await serve(
      ['org:acme', 'm1'],
      {},
      { 'if-none-match': '"0123456789abcdef"' },
    )
    expect(second.statusCode).toBe(304)
  })

  it('the full 200 now advertises Accept-Ranges: bytes', async () => {
    const res = await serve(['org:acme', 'm1'])
    expect(servedFull(res)).toBe(true)
    expect(res.headers['accept-ranges']).toBe('bytes')
  })

  it.each([
    ['206', { range: 'bytes=2-5' }],
    ['416', { range: 'bytes=99-' }],
  ])(
    'the CSP is carried on the new %s path (AGL-1474)',
    async (_label, headers) => {
      const res = await serve(['org:acme', 'm1'], {}, headers)
      expect(res.headers['content-security-policy']).toBe(MEDIA_CDN_BASE_CSP)
    },
  )
})
