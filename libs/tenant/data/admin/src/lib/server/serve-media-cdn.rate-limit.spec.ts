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
 * The media CDN's per-caller limit, end to end (AGL-2812).
 *
 * Driven through the App Router adapter both mounts use, with the real
 * `serveMediaCdn` and the real durable counter, over a Firestore double that
 * applies `increment` and can be broken. The claims are about what a caller
 * receives: deliveries up to the ceiling are served, the one past it is
 * refused before Storage is read or a delivery is counted, and a counter that
 * cannot answer refuses nobody.
 */

import { Readable } from 'node:stream'
import { runLegacyHandler } from '@aglyn/aglyn/server'
import { MEDIA_CDN_NON_IMAGE_RATE_LIMIT } from './media-cdn-rate-limit'
import { resetRateLimitDegradationForTests } from './rate-limit-store'
import { serveMediaCdn } from './serve-media-cdn'

/** 8 bytes, matching the `size` below. */
const BYTES = Buffer.from('PNGBYTES')

const FILM = {
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 8,
  storagePath: 'orgs/acme/media/Clips/m1',
  cdnPath: '/api/media/cdn/org:acme/m1',
  contentHash: '0123456789abcdef',
  variants: [],
  visibleTo: ['org'],
}

/** 1 s into a counter window, so every request lands in one window. */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 1)

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** The rate-limit counters, by document id. */
  counts: Map<string, number>
  counter: 'working' | 'unavailable' | 'contended'
  storageReads: number
  deliveriesCounted: number
} = {
  doc: null,
  metadata: null,
  counts: new Map(),
  counter: 'working',
  storageReads: 0,
  deliveriesCounted: 0,
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
    // The only `set` outside `rateLimits` is the delivery counter's day doc.
    set: async (value: Record<string, unknown>) => {
      if ('media' in value) mockState.deliveriesCounted += 1
    },
  })
  const counterFault = () => {
    if (mockState.counter === 'unavailable') {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 })
    }
    if (mockState.counter === 'contended') {
      throw Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 })
    }
  }
  const counterRef = (id: string) => ({
    set: async (value: { count?: { operand?: number } }) => {
      counterFault()
      mockState.counts.set(
        id,
        (mockState.counts.get(id) ?? 0) + Number(value.count?.operand ?? 0),
      )
    },
    get: async () => {
      counterFault()
      return {
        get: (field: string) =>
          field === 'count' ? mockState.counts.get(id) : undefined,
      }
    },
  })
  const file = () => ({
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [mockState.metadata]
    },
    createReadStream: (options?: { start?: number; end?: number }) => {
      mockState.storageReads += 1
      const source = new Readable({ read: () => undefined })
      source.push(
        BYTES.subarray(options?.start ?? 0, (options?.end ?? BYTES.length - 1) + 1),
      )
      source.push(null)
      return source
    },
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) =>
              name === 'rateLimits' ? counterRef(id) : docRef(),
          }),
          runTransaction: async () => undefined,
        }),
        storage: () => ({ bucket: () => ({ file }) }),
      }),
      firestore: {
        FieldValue: { increment: (operand: number) => ({ operand }) },
      },
    },
  }
})

function serve(
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const path = ['org:acme', 'm1']
  return runLegacyHandler(
    serveMediaCdn,
    new Request(`https://site.test/api/media/cdn/${path.join('/')}`, {
      method: init.method ?? 'GET',
      headers: { 'x-forwarded-for': '203.0.113.7', ...init.headers },
    }),
    { path },
  )
}

/** Statuses of `count` sequential deliveries, each body read to its end. */
async function statusesOf(count: number): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < count; i += 1) {
    const response = await serve()
    statuses.push(response.status)
    await response.arrayBuffer()
  }
  return statuses
}

const environment = {
  vercel: process.env['VERCEL'],
  depth: process.env['AGLYN_TRUSTED_PROXY_COUNT'],
}

beforeAll(() => {
  // Off the platform the rightmost forwarding hop is the caller; pinned so a
  // CI runner's environment cannot change which hop counts.
  delete process.env['VERCEL']
  delete process.env['AGLYN_TRUSTED_PROXY_COUNT']
})

afterAll(() => {
  if (environment.vercel !== undefined) process.env['VERCEL'] = environment.vercel
  if (environment.depth !== undefined) {
    process.env['AGLYN_TRUSTED_PROXY_COUNT'] = environment.depth
  }
})

beforeEach(() => {
  mockState.doc = { ...FILM }
  // A STRING, as GCS metadata carries it.
  mockState.metadata = { contentType: 'video/mp4', size: '8' }
  mockState.counts = new Map()
  mockState.counter = 'working'
  mockState.storageReads = 0
  mockState.deliveriesCounted = 0
  resetRateLimitDegradationForTests()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('AGL-2812 · the CDN refuses a caller past its ceiling', () => {
  it('serves up to the ceiling, then answers 429 without reading Storage or counting a delivery', async () => {
    expect(await statusesOf(MEDIA_CDN_NON_IMAGE_RATE_LIMIT)).toEqual(
      Array(MEDIA_CDN_NON_IMAGE_RATE_LIMIT).fill(200),
    )
    expect(mockState.storageReads).toBe(MEDIA_CDN_NON_IMAGE_RATE_LIMIT)

    const refused = await serve()
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: 'Too many requests' })
    expect(refused.headers.get('retry-after')).toBe('59')
    expect(mockState.storageReads).toBe(MEDIA_CDN_NON_IMAGE_RATE_LIMIT)
    expect(mockState.deliveriesCounted).toBe(MEDIA_CDN_NON_IMAGE_RATE_LIMIT)
  })

  it("carries none of the file's headers on a refusal, and lets no cache keep it", async () => {
    await statusesOf(MEDIA_CDN_NON_IMAGE_RATE_LIMIT)
    const refused = await serve({ headers: { range: 'bytes=0-' } })

    expect(refused.status).toBe(429)
    expect(refused.headers.get('cache-control')).toBe('no-store')
    for (const header of [
      'etag',
      'content-length',
      'content-range',
      'content-disposition',
      'accept-ranges',
    ]) {
      expect(refused.headers.get(header)).toBeNull()
    }
    expect(refused.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    // Set before any exit, so a refusal keeps it too (AGL-1474).
    expect(refused.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    )
  })

  it('keeps a budget per caller, and one for images apart from everything else', async () => {
    await statusesOf(MEDIA_CDN_NON_IMAGE_RATE_LIMIT)
    const refused = await serve()
    expect(refused.status).toBe(429)
    await refused.arrayBuffer()

    const neighbor = await serve({ headers: { 'x-forwarded-for': '198.51.100.20' } })
    expect(neighbor.status).toBe(200)
    await neighbor.arrayBuffer()

    mockState.doc = { ...FILM, fileName: 'logo.png', contentType: 'image/png' }
    mockState.metadata = { contentType: 'image/png', size: '8' }
    const image = await serve()
    expect(image.status).toBe(200)
    expect(await image.text()).toBe('PNGBYTES')
  })

  it('never counts a HEAD or a 304, since neither sends the file', async () => {
    const head = await serve({ method: 'HEAD' })
    expect(head.status).toBe(200)
    const revalidated = await serve({
      headers: { 'if-none-match': '"0123456789abcdef"' },
    })
    expect(revalidated.status).toBe(304)
    expect(mockState.counts.size).toBe(0)
  })
})

describe('AGL-2812 · a counter that cannot answer refuses nobody', () => {
  it.each(['unavailable', 'contended'] as const)(
    'with the counter %s, every delivery past the ceiling is still served',
    async (fault) => {
      mockState.counter = fault
      const count = MEDIA_CDN_NON_IMAGE_RATE_LIMIT + 5
      expect(await statusesOf(count)).toEqual(Array(count).fill(200))
      expect(mockState.storageReads).toBe(count)
    },
  )
})
