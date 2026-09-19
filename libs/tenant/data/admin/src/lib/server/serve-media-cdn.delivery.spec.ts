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
 * The media CDN's delivery redirect (AGL-2824), through the real
 * `serveMediaCdn` with Firestore and Storage stubbed and a delivery provider
 * registered in core's slot.
 *
 * ## The flag-off path is pinned, not described
 *
 * Every "unchanged" case below serves the same request twice — once with no
 * provider registered at all, which is the handler as it was, and once with
 * the provider switch in the named state — and requires the two responses to
 * agree on status, every header, the body and every document write. A
 * difference of one header between them fails, whatever it is.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'cdn-delivery-spec-secret'

import { Readable, Writable } from 'node:stream'
import {
  type MediaDeliveryProvider,
  type MediaDeliveryUrlRequest,
  registerMediaDeliveryProvider,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { mintMediaSignature } from './media-signing'
import { serveMediaCdn } from './serve-media-cdn'

const FILM = Buffer.from('FILM-BYTES-FROM-THE-PLATFORM')
const POSTER = Buffer.from('POSTER-WEBP')

const mockState: {
  doc: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  writes: Array<{ path: string; data: Record<string, unknown> }>
  requested: string[]
} = { doc: null, metadata: null, writes: [], requested: [] }

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
  const file = (path: string) => ({
    getMetadata: async () => {
      if (!mockState.metadata) throw new Error('No such object')
      return [
        path.endsWith('.webp')
          ? { contentType: 'image/webp', size: POSTER.length }
          : mockState.metadata,
      ]
    },
    createReadStream: () => {
      mockState.requested.push(path)
      return Readable.from([path.endsWith('.webp') ? POSTER : FILM])
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

let mockFlagOn = true
const mockFlagAsked: Array<string | null> = []
jest.mock('./release-flags', () => ({
  isServerReleaseFlagOnForOrg: async (_key: string, orgId: string | null) => {
    mockFlagAsked.push(orgId)
    return mockFlagOn
  },
}))

class MockRes extends Writable {
  headers: Record<string, string> = {}
  // Node's default: a body served without `status()` leaves as a 200.
  statusCode = 200
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
  send(payload: unknown) {
    this.end(String(payload))
    return this
  }
  override _write(chunk: Buffer | string, _encoding: unknown, done: (error?: Error) => void) {
    this.body += String(chunk)
    done()
  }
}

const HASH = '0123456789abcdef'
const MASTER_KEY = `orgs/acme/film/${HASH}/master/${HASH}`
const RENDITION_KEY = `orgs/acme/film/${HASH}/r-720p/${'b'.repeat(32)}`

const RENDITION = {
  key: '720p',
  ext: 'mp4',
  contentType: 'video/mp4',
  width: 1280,
  height: 720,
  sizeBytes: 12,
}

function copy(key: string, representation: string, objectHash = HASH) {
  return {
    [representation]: {
      key,
      sourceHash: HASH,
      objectHash,
      contentType: 'video/mp4',
      sizeBytes: FILM.length,
      copiedAtMs: 1,
    },
  }
}

/** A film in the org library, copied to the provider. */
function filmDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fileName: 'film.mp4',
    contentType: 'video/mp4',
    sizeBytes: FILM.length,
    storagePath: 'orgs/acme/media/film',
    contentHash: HASH,
    visibleTo: ['org'],
    video: { durationMs: 60_000 },
    poster: { width: 1280, height: 720, variants: [] },
    videoRenditions: [RENDITION],
    deliveryCopies: {
      ...copy(MASTER_KEY, 'master'),
      ...copy(RENDITION_KEY, 'r-720p', 'b'.repeat(32)),
    },
    ...overrides,
  }
}

let minted: MediaDeliveryUrlRequest[] = []

function provider(configured: boolean): MediaDeliveryProvider {
  return {
    isConfigured: () => configured,
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    deleteObjectsWithPrefix: async () => 0,
    deliveryUrl: async (request) => {
      minted.push(request)
      return `https://video.delivery.test/${request.key}?token=t-${request.expiresAtMs}`
    },
  }
}

async function serve(
  query: Record<string, string | string[]> = {},
  options: { method?: 'GET' | 'HEAD'; headers?: Record<string, string>; scope?: string; hash?: string } = {},
): Promise<MockRes> {
  const res = new MockRes()
  const path = [options.scope ?? 'org:acme', 'film', ...(options.hash ? [options.hash] : [])]
  await serveMediaCdn(
    { method: options.method ?? 'GET', query: { path, ...query }, headers: options.headers ?? {} } as never,
    res as never,
  )
  return res
}

/** Everything a caller can observe about one response, and what it wrote. */
async function observe(run: () => Promise<MockRes>) {
  mockState.writes = []
  mockState.requested = []
  const res = await run()
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    writes: mockState.writes,
    requested: mockState.requested,
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  mockState.doc = filmDoc()
  mockState.metadata = { contentType: 'video/mp4', size: FILM.length }
  mockFlagOn = true
  mockFlagAsked.length = 0
  minted = []
})

afterAll(() => resetPluginServicesForTests())

describe('AGL-2824 · with the flag off, no provider settings, or no copy, the CDN serves as before', () => {
  const requests: Array<[string, () => Promise<MockRes>]> = [
    ['the master', () => serve()],
    ['?r=auto', () => serve({ r: 'auto' }, { headers: { accept: '*/*' } })],
    ['a ranged request', () => serve({}, { headers: { range: 'bytes=0-3' } })],
    ['a HEAD', () => serve({}, { method: 'HEAD' })],
    ['the pinned form', () => serve({}, { hash: HASH })],
  ]

  it.each(requests)('flag off: %s is byte-for-byte the response without a provider', async (_name, run) => {
    const baseline = await observe(run)
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
    mockFlagOn = false
    const withProvider = await observe(run)
    expect(withProvider).toEqual(baseline)
    expect(baseline.status).toBe(_name === 'a ranged request' ? 206 : 200)
    expect(minted).toEqual([])
  })

  it.each(requests)('no settings: %s is byte-for-byte the response without a provider', async (_name, run) => {
    const baseline = await observe(run)
    registerMediaDeliveryProvider(provider(false), { pluginId: 'delivery-spec' })
    const unconfigured = await observe(run)
    expect(unconfigured).toEqual(baseline)
    // An unconfigured provider costs no flag read either.
    expect(mockFlagAsked).toEqual([])
    expect(minted).toEqual([])
  })

  it.each(requests)('no copy: %s is byte-for-byte the response without a provider', async (_name, run) => {
    mockState.doc = filmDoc({ deliveryCopies: undefined })
    const baseline = await observe(run)
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
    const uncopied = await observe(run)
    expect(uncopied).toEqual(baseline)
    expect(mockFlagAsked).toEqual([])
  })

  it('a copy of bytes the asset no longer has is not served either', async () => {
    mockState.doc = filmDoc({ contentHash: 'fedcba9876543210' })
    const baseline = await observe(() => serve())
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
    expect(await observe(() => serve())).toEqual(baseline)
    expect(minted).toEqual([])
  })
})

describe('AGL-2824 · flag on, provider configured, copy present: a 302 to the provider', () => {
  beforeEach(() => {
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
  })

  it('redirects the master, private and unstored, and records the play', async () => {
    const response = await observe(() => serve())
    expect(response.status).toBe(302)
    expect(response.headers['location']).toBe(
      `https://video.delivery.test/${MASTER_KEY}?token=t-${minted[0]?.expiresAtMs}`,
    )
    expect(response.headers['cache-control']).toBe('private, no-store')
    // No validator and no representation: the redirect names a URL that expires.
    expect(response.headers['etag']).toBeUndefined()
    expect(response.headers['content-type']).toBeUndefined()
    expect(response.headers['content-length']).toBeUndefined()
    expect(response.body).toBe('')
    // No byte was read from the platform's bucket.
    expect(response.requested).toEqual([])
    expect(response.writes).toEqual([
      {
        path: `orgs/acme/analytics/${new Date().toISOString().slice(0, 10)}`,
        data: expect.objectContaining({
          media: { film: { serves: { increment: 1 }, redirects: { increment: 1 } } },
        }),
      },
    ])
    expect(minted[0]).toMatchObject({
      key: MASTER_KEY,
      claims: { scope: 'org:acme', mediaId: 'film', orgId: 'acme', hostId: null },
    })
    // Fifteen minutes for a one-minute film: twice the film, at the minimum.
    const lifetime = (minted[0]?.expiresAtMs ?? 0) - Date.now()
    expect(lifetime).toBeGreaterThan(14 * 60 * 1000)
    expect(lifetime).toBeLessThanOrEqual(15 * 60 * 1000)
    expect(mockFlagAsked).toEqual(['acme'])
  })

  it('redirects a HEAD without counting a play', async () => {
    const response = await observe(() => serve({}, { method: 'HEAD' }))
    expect(response.status).toBe(302)
    expect(response.writes).toEqual([])
  })

  it('negotiates ?r=auto exactly as before and redirects to that rendition’s copy', async () => {
    const response = await observe(() => serve({ r: 'auto' }, { headers: { accept: '*/*' } }))
    expect(response.status).toBe(302)
    expect(response.headers['location']).toContain(RENDITION_KEY)
    expect(response.headers['vary']).toBe('Accept')
  })

  it('redirects a ranged request, which the provider then answers', async () => {
    const response = await observe(() => serve({}, { headers: { range: 'bytes=0-3' } }))
    expect(response.status).toBe(302)
  })

  it('redirects the pinned form at the current hash, and still 302s a stale pin home', async () => {
    expect((await observe(() => serve({}, { hash: HASH }))).headers['location']).toContain(
      MASTER_KEY,
    )
    const stale = await observe(() => serve({}, { hash: 'fedcba9876543210' }))
    expect(stale.status).toBe(302)
    expect(stale.headers['location']).toBe('/api/media/cdn/org:acme/film')
  })

  it('serves a rendition with no copy from the platform, not the master’s copy', async () => {
    mockState.doc = filmDoc({ deliveryCopies: copy(MASTER_KEY, 'master') })
    const response = await observe(() => serve({ r: '720p' }))
    expect(response.status).toBe(200)
    expect(response.body).toBe(FILM.toString())
  })

  it('leaves a download to this route, which sets its disposition', async () => {
    const response = await observe(() => serve({ download: '1' }))
    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toMatch(/^attachment/)
    expect(minted).toEqual([])
  })
})

describe('AGL-2824 · every access check still runs first', () => {
  beforeEach(() => {
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
  })

  it('a private asset without a signature is refused, and no URL is minted', async () => {
    mockState.doc = filmDoc({ private: true })
    const response = await observe(() => serve())
    expect(response.status).toBe(404)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(minted).toEqual([])
  })

  it('a signed private asset redirects, for no longer than its signature', async () => {
    mockState.doc = filmDoc({ private: true })
    const signature = mintMediaSignature('org:acme', 'film', Date.now(), 5 * 60 * 1000)
    const response = await observe(() => serve({ exp: String(signature.exp), sig: signature.sig }))
    expect(response.status).toBe(302)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(minted[0]?.expiresAtMs).toBe(signature.exp)
  })

  it('an asset restricted to another site is refused before any redirect', async () => {
    mockState.doc = filmDoc({ visibleTo: ['host:somewhere-else'] })
    const response = await observe(() => serve())
    expect(response.status).toBe(404)
    expect(minted).toEqual([])
  })

  it('a deleted asset is refused before any redirect', async () => {
    mockState.doc = filmDoc({ deletedAt: 1 })
    expect((await observe(() => serve())).status).toBe(404)
    expect(minted).toEqual([])
  })
})

describe('AGL-2824 · images and posters are unaffected', () => {
  beforeEach(() => {
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
  })

  it('serves a poster from the platform, as an edge-cacheable image', async () => {
    const response = await observe(() => serve({ poster: '1' }))
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/webp')
    expect(response.body).toBe(POSTER.toString())
    expect(minted).toEqual([])
    expect(mockFlagAsked).toEqual([])
  })

  it('serves an image from the platform even if its document claims a copy', async () => {
    mockState.doc = filmDoc({ contentType: 'image/png', videoRenditions: undefined })
    mockState.metadata = { contentType: 'image/png', size: FILM.length }
    const baseline = await (async () => {
      resetPluginServicesForTests()
      return observe(() => serve())
    })()
    registerMediaDeliveryProvider(provider(true), { pluginId: 'delivery-spec' })
    const withProvider = await observe(() => serve())
    expect(withProvider).toEqual(baseline)
    expect(withProvider.status).toBe(200)
    expect(minted).toEqual([])
  })
})
