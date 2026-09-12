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
 * The media CDN streams what it serves (AGL-2810).
 *
 * Driven end to end through the App Router adapter both mounts use
 * (`runLegacyHandler`) with the real `serveMediaCdn`, so the claims are about
 * the `Response` a client actually receives rather than about a mock
 * response object.
 *
 * Storage is stubbed with a read stream the test controls: it hands over the
 * first half of the requested bytes and holds the rest until the test
 * releases them. A client that already holds bytes while Storage still holds
 * the rest is the proof that the first byte left before the whole body was
 * read — the property the buffering adapter never had.
 */

import { Readable } from 'node:stream'
import { runLegacyHandler } from '@aglyn/aglyn/server'
import { serveMediaCdn } from './serve-media-cdn'

/** 8 bytes, matching the `size` below; every body asserted is cut from this. */
const BYTES = Buffer.from('PNGBYTES')

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** The options each `createReadStream` call was given. */
  streamCalls: Array<{ start?: number; end?: number } | undefined>
  /** Every read stream handed out, in order. */
  sources: Readable[]
  /** Hand over the first half and hold the rest until `releaseRest`. */
  hold: boolean
  /** Fail the read before it produces anything. */
  failAtOpen: boolean
  releaseRest: () => void
} = {
  doc: null,
  metadata: null,
  streamCalls: [],
  sources: [],
  hold: false,
  failAtOpen: false,
  releaseRest: () => undefined,
}

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
    // Inclusive `start`/`end`, the GCS contract the handler relies on.
    createReadStream: (options?: { start?: number; end?: number }) => {
      mockState.streamCalls.push(options)
      const start = options?.start ?? 0
      const end = options?.end ?? BYTES.length - 1
      const slice = BYTES.subarray(start, end + 1)
      const source = new Readable({ read: () => undefined })
      mockState.sources.push(source)
      if (mockState.failAtOpen) {
        process.nextTick(() => source.destroy(new Error('403 from Storage')))
      } else if (mockState.hold) {
        const half = Math.ceil(slice.length / 2)
        source.push(slice.subarray(0, half))
        mockState.releaseRest = () => {
          source.push(slice.subarray(half))
          source.push(null)
        }
      } else {
        source.push(slice)
        source.push(null)
      }
      return source
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

function serve(path: string[], headers: Record<string, string> = {}) {
  return runLegacyHandler(
    serveMediaCdn,
    new Request(`https://site.test/api/media/cdn/${path.join('/')}`, { headers }),
    { path },
  )
}

function readerOf(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) throw new Error('response has no body')
  return response.body.getReader()
}

const text = (bytes: Uint8Array | undefined) => Buffer.from(bytes ?? []).toString()

async function readRest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const parts: Buffer[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(parts).toString()
    parts.push(Buffer.from(value))
  }
}

/** Lets queued stream work run, up to a bound, until `holds` is true. */
async function eventually(holds: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500 && !holds(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  if (!holds()) throw new Error('condition never held')
}

const failuresLogged = (spy: jest.SpyInstance) =>
  spy.mock.calls.filter((call) => call[0] === 'serveMediaCdn failed')

let errorSpy: jest.SpyInstance

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
  mockState.streamCalls = []
  mockState.sources = []
  mockState.hold = false
  mockState.failAtOpen = false
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('AGL-2810 · the first byte leaves before the whole file is read', () => {
  it('a full GET answers while Storage still holds the rest of the file', async () => {
    mockState.hold = true
    const response = await serve(['org:acme', 'm1'])

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('8')
    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('PNGB')
    // Storage has not produced the second half, and the client already has
    // the first.
    expect(mockState.sources[0].readableEnded).toBe(false)

    mockState.releaseRest()
    expect(await readRest(reader)).toBe('YTES')
  })

  it("a player's opening bytes=0- streams too — it is a 206, not a collected file", async () => {
    mockState.hold = true
    const response = await serve(['org:acme', 'm1'], { range: 'bytes=0-' })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-7/8')
    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('PNGB')
    expect(mockState.sources[0].readableEnded).toBe(false)

    mockState.releaseRest()
    expect(await readRest(reader)).toBe('YTES')
  })
})

describe('AGL-2810 · a ranged request streams only its range', () => {
  it('serves exactly the requested slice, and asks Storage for nothing else', async () => {
    const response = await serve(['org:acme', 'm1'], { range: 'bytes=2-5' })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/8')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('GBYT')
    expect(mockState.streamCalls).toEqual([{ start: 2, end: 5 }])
  })

  it('a held ranged read still answers at its first chunk', async () => {
    mockState.hold = true
    const response = await serve(['org:acme', 'm1'], { range: 'bytes=2-5' })

    expect(response.status).toBe(206)
    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('GB')
    mockState.releaseRest()
    expect(await readRest(reader)).toBe('YT')
  })

  it('an unsatisfiable range is a 416 with no body and no Storage read', async () => {
    const response = await serve(['org:acme', 'm1'], { range: 'bytes=8-' })

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */8')
    expect(response.body).toBeNull()
    expect(mockState.streamCalls).toEqual([])
  })
})

describe('AGL-2810 · the stream is torn down in both directions', () => {
  it('a client that stops reading ends the Storage read and is not logged as a failure', async () => {
    mockState.hold = true
    const response = await serve(['org:acme', 'm1'])

    const reader = readerOf(response)
    await reader.read()
    await reader.cancel()

    await eventually(() => mockState.sources[0].destroyed)
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(failuresLogged(errorSpy)).toEqual([])
  })

  it('a Storage failure after the first byte fails the transfer instead of ending it short', async () => {
    mockState.hold = true
    const response = await serve(['org:acme', 'm1'])

    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('PNGB')
    mockState.sources[0].destroy(new Error('socket hang up'))

    await expect(reader.read()).rejects.toThrow('socket hang up')
    await eventually(() => failuresLogged(errorSpy).length === 1)
  })

  it("a Storage failure before any byte answers 500 without the file's headers", async () => {
    mockState.failAtOpen = true
    const response = await serve(['org:acme', 'm1'], { range: 'bytes=2-5' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Delivery failed' })
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-range')).toBeNull()
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(response.headers.get('etag')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    // Set before any exit, so the failure keeps it (AGL-1474).
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    )
    expect(failuresLogged(errorSpy)).toHaveLength(1)
  })
})
