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
 * The gated stream's redirect with a delivery provider in core's slot
 * (AGL-2824). The delivery resolver, the media signing and the delivery
 * decision are the real modules; Firestore, the bucket, the member gate and
 * the release flag are doubles.
 *
 * With the flag on and a current copy at the provider, the stream mints the
 * provider's short-lived URL itself. With the flag off, the redirect is the
 * one `stream.spec.ts` pins — asserted here as equal to the answer the same
 * request gets with no provider registered at all, at the same instant.
 */

process.env.TOKEN_SIGNING_SECRET = 'stream-delivery-spec-secret'

import {
  type MediaDeliveryProvider,
  type MediaDeliveryUrlRequest,
  registerMediaDeliveryProvider,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { MEDIA_CDN_ROUTE } from '@aglyn/aglyn/server'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { streamHandler } from './stream'

const { GATED_VIDEO_SESSION_TTL_MS } = jest.requireActual(
  '@aglyn/tenant-data-admin/server/media-signing',
)

const docs = new Map<string, Record<string, any>>()

function makeDocRef(path: string) {
  return {
    id: path.split('/').pop() as string,
    path,
    async get() {
      const data = docs.get(path)
      return {
        exists: data !== undefined,
        id: path.split('/').pop() as string,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
  }
}

function makeCollectionRef(path: string) {
  return {
    doc: (id: string) => ({
      ...makeDocRef(`${path}/${id}`),
      collection: (name: string) => makeCollectionRef(`${path}/${id}/${name}`),
    }),
  }
}

const fakeFirestore = { collection: (name: string) => makeCollectionRef(name) }
const fakeBucket = {
  name: 'aglyn-test.appspot.com',
  file: () => ({ getSignedUrl: async () => ['https://storage.test/signed'] }),
}

jest.mock('@aglyn/tenant-data-admin', () => {
  const delivery = jest.requireActual('@aglyn/tenant-data-admin/server/paid-media-delivery')
  const signing = jest.requireActual('@aglyn/tenant-data-admin/server/media-signing')
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => fakeFirestore,
        storage: () => ({ bucket: () => fakeBucket }),
      }),
    },
    createPaidMediaDeliveryIo: delivery.createPaidMediaDeliveryIo,
    resolvePaidMediaDelivery: delivery.resolvePaidMediaDelivery,
    GATED_VIDEO_SESSION_TTL_MS: signing.GATED_VIDEO_SESSION_TTL_MS,
  }
})

let mockFlagOn = true
const mockFlagAsked: Array<string | null> = []
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  isServerReleaseFlagOnForOrg: async (_key: string, orgId: string | null) => {
    mockFlagAsked.push(orgId)
    return mockFlagOn
  },
}))

jest.mock('./membership', () => ({
  requireActiveMember: async () => ({
    memberId: 'mem-1',
    member: { get: (field: string) => (field === 'email' ? 'member-a@example.com' : undefined) },
  }),
}))
jest.mock('./gate', () => ({ checkMemberEntitlement: async () => true }))

const HOST = 'host-1'
const ORG = 'acme'
const PRODUCT = 'prod-course'
const HASH = '0123456789abcdef'
const MASTER_KEY = `orgs/${ORG}/med-film/${HASH}/master/${HASH}`
const WEBM_KEY = `orgs/${ORG}/med-film/${HASH}/r-720p-vp9/${'c'.repeat(32)}`
const MP4_KEY = `orgs/${ORG}/med-film/${HASH}/r-720p/${'d'.repeat(32)}`

function copyOf(key: string, objectHash: string, contentType = 'video/mp4') {
  return { key, sourceHash: HASH, objectHash, contentType, sizeBytes: 10, copiedAtMs: 1 }
}

function makeResponse() {
  const result = {
    status: 0,
    body: undefined as unknown,
    redirectedTo: '',
    headers: {} as Record<string, string>,
  }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value
    },
    redirect(code: number, url: string) {
      result.status = code
      result.redirectedTo = url
    },
    end() {
      // unused
    },
  }
  return { res: res as unknown as PluginApiResponse, result }
}

function request(
  method: 'GET' | 'POST',
  fields: Record<string, unknown>,
  headers: Record<string, string> = {},
): PluginApiRequest {
  return {
    method,
    query: method === 'GET' ? fields : {},
    body: method === 'POST' ? fields : {},
    headers,
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
}

/** Mint the stream link as an entitled member, then follow it as the player. */
async function play(accept = '*/*') {
  const minted = makeResponse()
  await streamHandler(request('POST', { hostId: HOST, productId: PRODUCT, video: 0 }), minted.res)
  expect(minted.result.status).toBe(200)
  const url = new URL((minted.result.body as { url: string }).url, 'https://shop.example')
  const followed = makeResponse()
  await streamHandler(
    request('GET', Object.fromEntries(url.searchParams.entries()), { accept }),
    followed.res,
  )
  return followed.result
}

let minted: MediaDeliveryUrlRequest[] = []

function provider(): MediaDeliveryProvider {
  return {
    isConfigured: () => true,
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    deleteObjectsWithPrefix: async () => 0,
    deliveryUrl: async (urlRequest) => {
      minted.push(urlRequest)
      return `https://video.delivery.test/${urlRequest.key}?token=t`
    },
  }
}

const NOW = Date.parse('2026-09-18T12:00:00.000Z')

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  resetPluginServicesForTests()
  docs.clear()
  minted = []
  mockFlagOn = true
  mockFlagAsked.length = 0
  docs.set(`hostIndex/${HOST}`, { orgId: ORG })
  docs.set(`hosts/${HOST}/products/${PRODUCT}`, {
    name: 'Training program',
    slug: 'training-program',
    type: 'digital',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 39 }],
    gatedVideos: [{ url: `${MEDIA_CDN_ROUTE}/org:${ORG}/med-film`, title: 'Week 1' }],
  })
  docs.set(`orgs/${ORG}/media/med-film`, {
    fileName: 'week-1.mp4',
    contentType: 'video/mp4',
    storagePath: `orgs/${ORG}/media/Films/med-film`,
    visibleTo: ['org'],
    private: true,
    contentHash: HASH,
    video: { durationMs: 20 * 60_000 },
    videoRenditions: [
      { key: '720p-vp9', ext: 'webm', contentType: 'video/webm', width: 1280, height: 720, sizeBytes: 5 },
      { key: '720p', ext: 'mp4', contentType: 'video/mp4', width: 1280, height: 720, sizeBytes: 7 },
    ],
    deliveryCopies: {
      master: copyOf(MASTER_KEY, HASH),
      'r-720p-vp9': copyOf(WEBM_KEY, 'c'.repeat(32), 'video/webm'),
      'r-720p': copyOf(MP4_KEY, 'd'.repeat(32)),
    },
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  resetPluginServicesForTests()
})

describe('AGL-2824 · flag on: the stream mints the delivery provider’s short-lived URL', () => {
  beforeEach(() => {
    registerMediaDeliveryProvider(provider(), { pluginId: 'delivery-spec' })
  })

  it('redirects straight to the provider, for the viewing session and no longer', async () => {
    const played = await play()
    expect(played.status).toBe(302)
    // `*/*` names no container, so the MP4 baseline the CDN would pick.
    expect(played.redirectedTo).toBe(`https://video.delivery.test/${MP4_KEY}?token=t`)
    expect(minted).toEqual([
      {
        key: MP4_KEY,
        expiresAtMs: NOW + GATED_VIDEO_SESSION_TTL_MS,
        claims: { scope: `org:${ORG}:${HOST}`, mediaId: 'med-film', hostId: HOST, orgId: ORG },
      },
    ])
    expect(played.headers['Cache-Control']).toBe('private, no-store')
    // The `Accept` chose the rendition, so this response varies on it.
    expect(played.headers['Vary']).toBe('Accept')
    expect(mockFlagAsked).toEqual([ORG])
  })

  it('hands a browser that names WebM the WebM copy', async () => {
    const played = await play('video/webm,video/*;q=0.9')
    expect(played.redirectedTo).toBe(`https://video.delivery.test/${WEBM_KEY}?token=t`)
  })

  it('still refuses a video whose asset is public, before any URL is minted', async () => {
    docs.set(`orgs/${ORG}/media/med-film`, {
      ...docs.get(`orgs/${ORG}/media/med-film`),
      private: false,
    })
    const played = await play()
    expect(played.status).toBe(409)
    expect(minted).toEqual([])
  })
})

describe('AGL-2824 · flag off, or no current copy: today’s signed CDN path', () => {
  it('flag off: the redirect is exactly the one with no provider registered', async () => {
    const baseline = await play()
    registerMediaDeliveryProvider(provider(), { pluginId: 'delivery-spec' })
    mockFlagOn = false
    const flagOff = await play()
    expect(flagOff).toEqual(baseline)
    expect(flagOff.status).toBe(302)
    const location = new URL(flagOff.redirectedTo, 'https://shop.example')
    expect(location.pathname).toBe(`${MEDIA_CDN_ROUTE}/org:${ORG}:${HOST}/med-film`)
    expect(location.searchParams.get('r')).toBe('auto')
    expect(Number(location.searchParams.get('exp'))).toBe(NOW + GATED_VIDEO_SESSION_TTL_MS)
    expect(location.searchParams.get('sig')).toMatch(/^[0-9a-f]{32}$/)
    expect(flagOff.headers['Vary']).toBeUndefined()
    expect(minted).toEqual([])
  })

  it('a copy made from bytes the asset no longer has is not handed out', async () => {
    docs.set(`orgs/${ORG}/media/med-film`, {
      ...docs.get(`orgs/${ORG}/media/med-film`),
      contentHash: 'fedcba9876543210',
    })
    const baseline = await play()
    registerMediaDeliveryProvider(provider(), { pluginId: 'delivery-spec' })
    expect(await play()).toEqual(baseline)
    expect(minted).toEqual([])
  })
})
