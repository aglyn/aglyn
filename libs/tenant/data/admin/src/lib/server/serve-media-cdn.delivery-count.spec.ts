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
 * What the media CDN counts as a delivery (AGL-176, AGL-2811).
 *
 * `serveMediaCdn` adds to `media.{mediaId}.serves` and `.bytes` on the
 * scope's analytics day document, and those two numbers are the DAM's
 * per-asset delivery figures. So every case here asserts the exact increments
 * written rather than merely that a write happened: a GET adds the object, a
 * ranged GET adds the slice it sent, and the two headers-only answers — a HEAD
 * and a 304 revalidation — add nothing, because no representation left.
 *
 * The HEAD case is the one with a history of being wrong. A HEAD never parses
 * `Range`, so the byte figure it would carry is the WHOLE object: counting it
 * adds a serve and the full size for a response with no body.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage stubbed —
 * the harness of `serve-media-cdn.range.spec.ts`, with every document write
 * recorded along with the path it was addressed to.
 */

import { Readable, Writable } from 'node:stream'
import { serveMediaCdn } from './serve-media-cdn'

/** 8 bytes, matching the `size` below. */
const BYTES = Buffer.from('PNGBYTES')

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** Every `set` the handler made, with the document path it targeted. */
  writes: Array<{ path: string; data: Record<string, unknown> }>
} = { doc: null, metadata: null, writes: [] }

jest.mock('./firebase-admin', () => {
  const snapshot = () => ({
    get exists() {
      return mockState.doc !== null
    },
    get: (field: string) => mockState.doc?.[field],
  })
  const docRef = (path: string): unknown => ({
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
    get: async () => snapshot(),
    set: async (data: Record<string, unknown>) => {
      mockState.writes.push({ path, data })
    },
  })
  const file = () => ({
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [mockState.metadata]
    },
    createReadStream: (options?: { start?: number; end?: number }) => {
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
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) => docRef(`${name}/${id}`),
          }),
        }),
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
  method: 'GET' | 'HEAD',
  headers: Record<string, string> = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path: ['org:acme', 'm1'] }, headers } as never,
    res as never,
  )
  return res
}

/**
 * The analytics day-doc writes, and only those. Filtered by path so a write
 * some other gate might make can neither satisfy nor fail these assertions.
 */
const deliveryWrites = () =>
  mockState.writes.filter((write) => write.path.includes('/analytics/'))

/** The `media` map a delivery write carries for this asset. */
const counted = (serves: number, bytes: number) =>
  expect.objectContaining({
    path: expect.stringMatching(/^orgs\/acme\/analytics\/\d{4}-\d{2}-\d{2}$/),
    data: expect.objectContaining({
      media: {
        m1: { serves: { increment: serves }, bytes: { increment: bytes } },
      },
    }),
  })

beforeEach(() => {
  mockState.doc = {
    fileName: 'clip.mp4',
    contentType: 'video/mp4',
    sizeBytes: 8,
    storagePath: 'orgs/acme/media/Clips/m1',
    cdnPath: '/api/media/cdn/org:acme/m1',
    contentHash: '0123456789abcdef',
    variants: [],
    visibleTo: ['org'],
  }
  // A STRING, as GCS metadata carries it.
  mockState.metadata = { contentType: 'video/mp4', size: '8' }
  mockState.writes = []
})

describe('AGL-2811 · the media CDN counts what it delivers, and nothing else', () => {
  it('a GET counts one serve and every byte of the object', async () => {
    const res = await serve('GET')
    expect(res.body).toBe('PNGBYTES')
    expect(deliveryWrites()).toEqual([counted(1, 8)])
  })

  it('a ranged GET counts the slice it sent, not the object', async () => {
    const res = await serve('GET', { range: 'bytes=2-4' })
    expect(res.statusCode).toBe(206)
    expect(res.body).toBe('GBY')
    expect(deliveryWrites()).toEqual([counted(1, 3)])
  })

  it('a HEAD counts nothing: it answers with the headers and sends no body', async () => {
    const res = await serve('HEAD')
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('')
    // The headers still describe the full representation a GET would send —
    // which is exactly the size the counter must not record.
    expect(res.getHeader('content-length')).toBe('8')
    expect(deliveryWrites()).toEqual([])
  })

  it('a HEAD carrying a Range header counts nothing either', async () => {
    const res = await serve('HEAD', { range: 'bytes=0-3' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('')
    expect(deliveryWrites()).toEqual([])
  })

  it('a revalidation answered 304 counts nothing', async () => {
    const res = await serve('GET', { 'if-none-match': '"0123456789abcdef"' })
    expect(res.statusCode).toBe(304)
    expect(deliveryWrites()).toEqual([])
  })
})
