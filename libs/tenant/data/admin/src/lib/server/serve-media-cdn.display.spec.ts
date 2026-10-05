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
 * AGL-3486 at the CDN: which object each request is answered from, under which
 * validator, and when a stale asset is handed to regeneration.
 *
 * Driven through the real `serveMediaCdn` with Firestore and Storage stubbed,
 * the harness `serve-media-cdn.etag.spec.ts` uses, plus a record of the object
 * path each response streamed.
 */

import { Readable, Writable } from 'node:stream'
import { MEDIA_VARIANT_ENCODER_VERSION } from '@aglyn/aglyn/server'
import { serveMediaCdn } from './serve-media-cdn'

const mockState: {
  doc: Record<string, unknown> | null
  /** Object paths Storage holds, with their metadata. */
  objects: Record<string, Record<string, unknown>>
  streamed: string[]
  scheduled: (() => Promise<void>)[]
} = { doc: null, objects: {}, streamed: [], scheduled: [] }

jest.mock('next/server', () => ({
  after: (task: () => Promise<void>) => {
    mockState.scheduled.push(task)
  },
}))

jest.mock('./media-delivery-regeneration', () => ({
  ...jest.requireActual('./media-delivery-regeneration'),
  regenerateMediaDeliveryCopies: jest.fn(async () => 'regenerated'),
}))

jest.mock('./firebase-admin', () => {
  const snapshot = () => ({
    get exists() {
      return mockState.doc !== null
    },
    get: (field: string) => mockState.doc?.[field],
    ref: { id: 'm1' },
  })
  const docRef = (): unknown => ({
    collection: () => ({ doc: () => docRef() }),
    get: async () => snapshot(),
    set: async () => undefined,
  })
  const file = (path: string) => ({
    getMetadata: async () => {
      const metadata = mockState.objects[path]
      if (!metadata) throw new Error('No such object')
      return [metadata]
    },
    createReadStream: () => {
      mockState.streamed.push(path)
      return Readable.from([Buffer.from('BYTES')])
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
  removeHeader(key: string) {
    delete this.headers[key.toLowerCase()]
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
  override _write(chunk: Buffer | string, _encoding: unknown, done: (error?: Error) => void) {
    this.body += String(chunk)
    done()
  }
}

async function serve(
  query: Record<string, string> = {},
  method = 'GET',
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    { method, query: { path: ['site-a', 'm1'], ...query }, headers: {} } as never,
    res as never,
  )
  return res
}

const BASE = 'hosts/site-a/media/m1'

/** A current-generation photo with a display copy and the finer ladder. */
const CURRENT = {
  fileName: 'photo.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 6_000_000,
  width: 6000,
  storagePath: BASE,
  cdnPath: '/api/media/cdn/site-a/m1',
  contentHash: '0123456789abcdef',
  variants: [160, 320, 640, 1280, 2560],
  variantEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION,
  display: { contentType: 'image/jpeg', width: 2560, height: 1707, sizeBytes: 600_000 },
}

beforeEach(() => {
  mockState.doc = { ...CURRENT }
  mockState.objects = {
    [BASE]: { contentType: 'image/jpeg', size: 6_000_000 },
    [`${BASE}__display`]: { contentType: 'image/jpeg', size: 600_000 },
    [`${BASE}__w640.webp`]: { contentType: 'image/webp', size: 40_000 },
    [`${BASE}__w1280.webp`]: { contentType: 'image/webp', size: 110_000 },
  }
  mockState.streamed = []
  mockState.scheduled = []
})

describe('the display copy answers inline requests (AGL-3486)', () => {
  it('serves the bare URL from the display copy, in the original’s format', async () => {
    const res = await serve()
    expect(mockState.streamed).toEqual([`${BASE}__display`])
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['etag']).toBe(
      `"0123456789abcdef-d-e${MEDIA_VARIANT_ENCODER_VERSION}"`,
    )
  })

  it('serves a width the asset has no variant for from the next larger variant, not the 6 MB original', async () => {
    const res = await serve({ w: '960' })
    expect(mockState.streamed).toEqual([`${BASE}__w1280.webp`])
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['etag']).toBe(
      `"0123456789abcdef-w1280-e${MEDIA_VARIANT_ENCODER_VERSION}"`,
    )
  })

  it('serves a width above every variant from the display copy', async () => {
    await serve({ w: '3000' })
    expect(mockState.streamed).toEqual([`${BASE}__display`])
  })

  it('still serves the ORIGINAL, byte for byte, to ?download=1', async () => {
    const res = await serve({ download: '1' })
    expect(mockState.streamed).toEqual([BASE])
    expect(res.headers['etag']).toBe('"0123456789abcdef-dl"')
  })

  it('serves a variant it has, under a validator that names its encoder generation', async () => {
    const res = await serve({ w: '640' })
    expect(mockState.streamed).toEqual([`${BASE}__w640.webp`])
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['etag']).toBe(
      `"0123456789abcdef-w640-e${MEDIA_VARIANT_ENCODER_VERSION}"`,
    )
  })

  it('falls back to the original when the display object is missing, rather than 404ing a live page', async () => {
    delete mockState.objects[`${BASE}__display`]
    const res = await serve()
    expect(mockState.streamed).toEqual([BASE])
    expect(res.statusCode).toBe(0)
  })

  it('serves an asset with no display record exactly as before', async () => {
    mockState.doc = { ...CURRENT, display: null }
    const res = await serve()
    expect(mockState.streamed).toEqual([BASE])
    expect(res.headers['etag']).toBe('"0123456789abcdef"')
  })

  it('ignores a display record whose type is not an image', async () => {
    mockState.doc = { ...CURRENT, display: { contentType: 'text/html' } }
    await serve()
    expect(mockState.streamed).toEqual([BASE])
  })
})

describe('a stale asset is regenerated after the response (AGL-3486)', () => {
  it('keeps a generation-1 variant’s old validator, serves it, and schedules regeneration', async () => {
    mockState.doc = {
      ...CURRENT,
      variants: [320, 640, 1280, 1920],
      variantEncoderVersion: undefined,
      display: undefined,
    }
    const res = await serve({ w: '640' })
    expect(mockState.streamed).toEqual([`${BASE}__w640.webp`])
    expect(res.headers['etag']).toBe('"0123456789abcdef-w640"')
    expect(mockState.scheduled).toHaveLength(1)

    const { regenerateMediaDeliveryCopies } = jest.requireMock(
      './media-delivery-regeneration',
    ) as { regenerateMediaDeliveryCopies: jest.Mock }
    await mockState.scheduled[0]?.()
    expect(regenerateMediaDeliveryCopies).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: BASE }),
    )
  })

  it('answers a width generation 1 never made (768) from its 1280 variant while it regenerates', async () => {
    mockState.doc = {
      ...CURRENT,
      variants: [320, 640, 1280, 1920],
      variantEncoderVersion: undefined,
      display: undefined,
    }
    const res = await serve({ w: '768' })
    expect(mockState.streamed).toEqual([`${BASE}__w1280.webp`])
    expect(res.headers['etag']).toBe('"0123456789abcdef-w1280"')
    expect(mockState.scheduled).toHaveLength(1)
  })

  it('schedules nothing for an asset already at the current generation', async () => {
    await serve({ w: '640' })
    expect(mockState.scheduled).toHaveLength(0)
  })

  it('schedules nothing for a HEAD, which sends no picture', async () => {
    mockState.doc = { ...CURRENT, variantEncoderVersion: undefined }
    await serve({}, 'HEAD')
    expect(mockState.scheduled).toHaveLength(0)
  })
})
