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
 * Audio on the media CDN (AGL-3716): the Music player's tracks.
 *
 * A track is served under its own stored type, so the browser's `<audio>`
 * decodes it, and a seek is a byte range answered 206 from exactly those
 * bytes. Like video it never rides the shared edge: a ranged request served
 * from a full-body edge entry is the AGL-1515 hybrid that corrupts playback.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage
 * stubbed — the same harness as `serve-media-cdn.range.spec.ts`.
 */

import { Readable, Writable } from 'node:stream'
import {
  MEDIA_CDN_BASE_CSP,
  MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL,
  mediaCdnEdgeCacheable,
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

const TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav']

const trackDoc = (contentType: string) => ({
  fileName: 'song',
  contentType,
  sizeBytes: 8,
  storagePath: 'orgs/acme/media/Music/t1',
  cdnPath: '/api/media/cdn/org:acme/t1',
  contentHash: '0123456789abcdef',
  variants: [],
  visibleTo: ['org'],
  rightsConfirmation: { uid: 'user-1', atMs: 1, statement: 'x' },
})

beforeEach(() => {
  mockState.streamCalls = []
})

describe.each(TYPES)('AGL-3716 · %s', (contentType) => {
  beforeEach(() => {
    mockState.doc = trackDoc(contentType)
    mockState.metadata = { contentType, size: '8' }
  })

  it('is served under its own type, inline, with ranges advertised', async () => {
    const res = await serve(['org:acme', 't1'])
    expect(res.statusCode).toBe(0)
    expect(res.body).toBe('PNGBYTES')
    expect(res.headers['content-type']).toBe(contentType)
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(String(res.headers['content-disposition'] ?? 'inline')).toMatch(/^inline/)
    expect(res.headers['content-security-policy']).toBe(MEDIA_CDN_BASE_CSP)
  })

  it('answers a seek with exactly the bytes asked for, as a 206', async () => {
    const res = await serve(['org:acme', 't1'], {}, { range: 'bytes=2-5' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('GBYT')
    expect(res.headers['content-range']).toBe('bytes 2-5/8')
    expect(res.headers['content-type']).toBe(contentType)
    expect(mockState.streamCalls).toEqual([{ start: 2, end: 5 }])
  })

  it('never rides the shared edge', async () => {
    expect(mediaCdnEdgeCacheable(contentType)).toBe(false)
    const res = await serve(['org:acme', 't1'], {}, { range: 'bytes=0-3' })
    expect(res.headers['cache-control']).toBe(MEDIA_CDN_STABLE_EDGE_BYPASS_CACHE_CONTROL)
  })
})
