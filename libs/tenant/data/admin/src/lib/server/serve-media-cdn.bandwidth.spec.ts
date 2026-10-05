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
 * Video and files count against the bandwidth band (AGL-3474), through the
 * real `serveMediaCdn`.
 *
 * Three claims, each paired with the case that must answer the other way:
 *
 *  1. A video's bytes reach the bandwidth total — written on the day document
 *     the invoice, the cap and the meter all read, and read back through the
 *     same `analyticsBandwidthReading` they call. An IMAGE's bytes do not: the
 *     band's page weight already contains them, and counting them here would
 *     bill them twice.
 *  2. Free stops at its band. A Free org whose cap is engaged gets a `503` for
 *     its video and keeps its images; a PAYING org carrying the same marker
 *     (it upgraded this month) keeps serving.
 *  3. Video alone engages the cap. A Free org crossing its band with no page
 *     view at all is stamped by the CDN, with the beacon's own marker fields,
 *     and refused from then on; a paying org at a hundred times the traffic
 *     is never stamped and costs no read to check.
 *
 * Firestore is an in-memory document store that applies increments and
 * merges the way Firestore does, and models the projection a `getAll` mask
 * asks for — so a host mask that dropped `bandwidthCeiling` would read no
 * ceiling, and these cases would say so.
 */

import { Readable, Writable } from 'node:stream'
import {
  analyticsBandwidthReading,
  bandwidthCapEngaged,
  bandwidthCapMonthKey,
  MEDIA_BANDWIDTH_DAY_FIELD,
  ORIGIN_MEDIA_BANDWIDTH_WEIGHT,
  PLAN_ENTITLEMENTS,
  pageViewsFromBandwidthGb,
} from '@aglyn/aglyn/server'
import {
  engageMediaBandwidthCap,
  invalidateMediaBandwidthCapState,
} from './media-bandwidth-cap'
import { invalidateMediaCdnLockCache, serveMediaCdn } from './serve-media-cdn'

const FILM = Buffer.from('FILM-BYTES')
const PICTURE = Buffer.from('PNG-BYTES')
const GIB = 1024 * 1024 * 1024
const MONTH = bandwidthCapMonthKey()
const DAY = new Date().toISOString().slice(0, 10)

type Data = Record<string, any>

const mockStore: Record<string, Data> = {}
const mockWrites: Array<{ path: string; data: Data }> = []
/** Every collection query, by collection path. */
const mockQueries: string[] = []
const mockNotices: Array<{ hostId: string; payload: Data }> = []
let mockRedirect: Data | null = null
/** Stands between a day-document write and the store; a rejection is a failed write. */
let mockDayWriteGate: (() => Promise<void>) | null = null

/** A Firestore merge: maps merge recursively, increments add at the leaves. */
function mockMerge(target: Data, patch: Data): Data {
  const out: Data = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      out[key] = Number(out[key] ?? 0) + Number(value.increment)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mockMerge(
        out[key] && typeof out[key] === 'object' ? out[key] : {},
        value,
      )
    } else {
      out[key] = value
    }
  }
  return out
}

jest.mock('./firebase-admin', () => {
  const snapshotOf = (path: string, mask?: string[]) => {
    const stored = mockStore[path]
    const data =
      stored && mask
        ? Object.fromEntries(Object.entries(stored).filter(([key]) => mask.includes(key)))
        : stored
    return {
      id: path.split('/').pop(),
      ref: docRef(path),
      exists: stored !== undefined,
      get: (field: string) => data?.[field],
      data: () => data,
    }
  }
  const write = (path: string, data: Data, options?: { merge?: boolean }) => {
    mockWrites.push({ path, data })
    mockStore[path] = options?.merge ? mockMerge(mockStore[path] ?? {}, data) : mockMerge({}, data)
  }
  function docRef(path: string): any {
    return {
      path,
      id: path.split('/').pop(),
      collection: (name: string) => collectionRef(`${path}/${name}`),
      get: async () => snapshotOf(path),
      set: async (data: Data, options?: { merge?: boolean }) => {
        if (mockDayWriteGate && path.includes('/analytics/')) await mockDayWriteGate()
        write(path, data, options)
      },
    }
  }
  function collectionRef(path: string): any {
    const query = (filters: Array<[string, string, unknown]>): any => ({
      where: (field: string, op: string, value: unknown) =>
        query([...filters, [field, op, value]]),
      select: () => query(filters),
      limit: () => query(filters),
      get: async () => {
        mockQueries.push(path)
        const prefix = `${path}/`
        const docs = Object.keys(mockStore)
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .sort()
          .map((key) => snapshotOf(key))
          .filter((snapshot) =>
            filters.every(([field, op, value]) => {
              const actual = field === '__name__' ? snapshot.id : snapshot.get(field)
              if (op === '>=') return String(actual) >= String(value)
              if (op === '<=') return String(actual) <= String(value)
              return actual === value
            }),
          )
        return { docs, size: docs.length, empty: docs.length === 0 }
      },
    })
    return { ...query([]), doc: (id: string) => docRef(`${path}/${id}`) }
  }
  const firestore = {
    collection: (name: string) => collectionRef(name),
    getAll: async (...args: any[]) => {
      const last = args[args.length - 1]
      const options = last && typeof last === 'object' && 'fieldMask' in last ? last : undefined
      const refs = options ? args.slice(0, -1) : args
      return refs.map((ref: any) => snapshotOf(ref.path, options?.fieldMask))
    },
    runTransaction: async (run: (transaction: any) => Promise<unknown>) =>
      run({
        get: async (ref: any) => snapshotOf(ref.path),
        set: (ref: any, data: Data, options?: { merge?: boolean }) =>
          write(ref.path, data, options),
      }),
  }
  const file = (path: string) => ({
    getMetadata: async () => [
      path.includes('picture')
        ? { contentType: 'image/png', size: String(PICTURE.length) }
        : path.endsWith('.webp')
          ? { contentType: 'image/webp', size: String(PICTURE.length) }
          : {
              contentType: mockStore['__metadata']?.['contentType'] ?? 'video/mp4',
              size: String(FILM.length),
            },
    ],
    createReadStream: (options?: { start?: number; end?: number }) => {
      const body = path.includes('picture') || path.endsWith('.webp') ? PICTURE : FILM
      const start = options?.start ?? 0
      const end = options?.end
      return Readable.from([body.subarray(start, end === undefined ? undefined : end + 1)])
    },
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => firestore,
        storage: () => ({ bucket: () => ({ file }) }),
      }),
      firestore: {
        FieldValue: { increment: (n: number) => ({ increment: n }) },
        FieldPath: { documentId: () => '__name__' },
      },
    },
  }
})

jest.mock('./lockdown', () => ({ getPlatformLockdown: async () => null }))
jest.mock('./media-quarantine', () => ({ getMediaQuarantine: async () => null }))
jest.mock('./media-cdn-rate-limit', () => ({ mediaCdnRateLimitRefusal: async () => null }))
jest.mock('./notifications', () => ({
  notifyHostManagers: async (hostId: string, payload: Data) => {
    mockNotices.push({ hostId, payload })
  },
}))
jest.mock('@aglyn/aglyn/plugin-manager/media-delivery-provider', () => ({
  mediaDeliveryProvider: () => (mockRedirect ? {} : null),
}))
jest.mock('./media-delivery', () => ({
  mediaDeliveryOrgIdFor: async () => 'org-1',
  mediaDeliveryRedirect: async () => mockRedirect,
}))

class MockRes extends Writable {
  headers: Record<string, string> = {}
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
  override _write(chunk: Buffer | string, _encoding: unknown, done: (error?: Error) => void) {
    this.body += String(chunk)
    done()
  }
}

async function serve(
  segments: string[],
  options: { method?: 'GET' | 'HEAD'; query?: Data; headers?: Data } = {},
): Promise<MockRes> {
  const res = new MockRes()
  await serveMediaCdn(
    {
      method: options.method ?? 'GET',
      query: { path: segments, ...(options.query ?? {}) },
      headers: options.headers ?? {},
    } as never,
    res as never,
  )
  return res
}

const film = () => serve(['site-1', 'film'])
const picture = () => serve(['site-1', 'picture'])

const freeOrg = (extra: Data = {}) => ({ name: 'Acme', plan: 'free', ...extra })
const paidOrg = (extra: Data = {}) => ({
  name: 'Acme',
  plan: 'starter',
  subscription: { status: 'active' },
  ...extra,
})

/** The site's day document, as the meter reads it. */
const siteDay = () => mockStore[`hosts/site-1/analytics/${DAY}`]

/** What the bandwidth readers make of a scope's day documents. */
function meteredBytesOf(scope: string): number {
  const days = Object.keys(mockStore)
    .filter((key) => key.startsWith(`${scope}/analytics/`))
    .map((key) => ({ get: (field: string) => mockStore[key]?.[field] }))
  return analyticsBandwidthReading(days).mediaBytes
}

/**
 * The film bytes that fill the Free band, at the weight a film counts —
 * read from the table and the derived weight, never restated.
 */
const freeBandBytes = () =>
  (PLAN_ENTITLEMENTS.free.bandwidthGb * GIB) / ORIGIN_MEDIA_BANDWIDTH_WEIGHT

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key]
  mockWrites.length = 0
  mockQueries.length = 0
  mockNotices.length = 0
  mockRedirect = null
  mockDayWriteGate = null
  invalidateMediaCdnLockCache()
  invalidateMediaBandwidthCapState()
  mockStore['hosts/site-1'] = { orgId: 'org-1', displayName: 'Acme' }
  mockStore['hostIndex/site-1'] = { orgId: 'org-1' }
  mockStore['orgs/org-1'] = paidOrg()
  mockStore['hosts/site-1/media/film'] = {
    fileName: 'clip.mp4',
    contentType: 'video/mp4',
    contentHash: '0123456789abcdef',
    storagePath: 'hosts/site-1/media/film',
    variants: [],
  }
  mockStore['hosts/site-1/media/picture'] = {
    fileName: 'picture.png',
    contentType: 'image/png',
    contentHash: 'fedcba9876543210',
    storagePath: 'hosts/site-1/media/picture',
    variants: [640],
  }
  mockStore['orgs/org-1/media/brochure'] = {
    fileName: 'brochure.pdf',
    contentType: 'application/pdf',
    contentHash: 'aaaaaaaaaaaaaaaa',
    storagePath: 'orgs/org-1/media/brochure',
    variants: [],
    visibleTo: ['org'],
  }
})

describe('a video request’s bytes reach the bandwidth total (AGL-3474)', () => {
  it('counts every byte a film sends on the site’s day document', async () => {
    const res = await film()
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(FILM.toString())
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBe(FILM.length)
    // The per-asset figure the DAM reads is unchanged beside it.
    expect(siteDay()?.media?.film).toEqual({ serves: 1, bytes: FILM.length })
    // …and the reader every bandwidth consumer calls sees it.
    expect(meteredBytesOf('hosts/site-1')).toBe(FILM.length)
  })

  it('counts the slice a ranged request sends, not the object', async () => {
    const res = await serve(['site-1', 'film'], { headers: { range: 'bytes=0-3' } })
    expect(res.statusCode).toBe(206)
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBe(4)
  })

  it('counts a document from the org library on the org’s own day document', async () => {
    mockStore['__metadata'] = { contentType: 'application/pdf' }
    const res = await serve(['org:org-1', 'brochure'])
    expect(res.statusCode).toBe(200)
    expect(mockStore[`orgs/org-1/analytics/${DAY}`]?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBe(
      FILM.length,
    )
    expect(meteredBytesOf('orgs/org-1')).toBe(FILM.length)
  })

  it('NEGATIVE: an image counts its delivery but not toward the band', async () => {
    const res = await picture()
    expect(res.statusCode).toBe(200)
    expect(siteDay()?.media?.picture).toEqual({ serves: 1, bytes: PICTURE.length })
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBeUndefined()
  })

  it('NEGATIVE: an image VARIANT is not counted twice either', async () => {
    const res = await serve(['site-1', 'picture'], { query: { w: '640' } })
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('content-type')).toBe('image/webp')
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBeUndefined()
  })

  it('NEGATIVE: a HEAD sends no body and counts nothing', async () => {
    await serve(['site-1', 'film'], { method: 'HEAD' })
    expect(siteDay()).toBeUndefined()
  })

  it('counts a film the delivery provider serves, at the copy’s size', async () => {
    // Moving a film off origin must not move it off the meter. The redirect is
    // the one request of the sitting that reaches the CDN.
    mockRedirect = {
      location: 'https://delivery.test/film',
      expiresAtMs: Date.now() + 60_000,
      key: 'hosts/site-1/film/master',
      sizeBytes: 5_000_000,
    }
    const res = await serve(['site-1', 'film'], { headers: { range: 'bytes=0-1' } })
    expect(res.statusCode).toBe(302)
    expect(res.getHeader('location')).toBe('https://delivery.test/film')
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBe(5_000_000)
    expect(siteDay()?.media?.film).toEqual({ serves: 1, redirects: 1 })
  })
})

/**
 * THE COUNT OUTLIVES THE RESPONSE, OR IT IS NOT A COUNT.
 *
 * The day-document write used to be `void …catch(() => undefined)`: nothing
 * waited for it, so a serverless instance frozen once the response left took
 * the write with it, and a write that failed said so to nobody. Bandwidth the
 * day document never takes is bandwidth the band and the invoice never see.
 */
describe('a serve is counted before the request is done', () => {
  const released = () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    return { gate, release }
  }

  it('holds the request open until the streamed film is counted', async () => {
    const { gate, release } = released()
    mockDayWriteGate = () => gate
    let done = false
    const pending = film().then((res) => ((done = true), res))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false)
    release()
    const res = await pending
    expect(res.statusCode).toBe(200)
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBe(FILM.length)
  })

  it('holds the delivery provider’s redirect open until it is counted', async () => {
    mockRedirect = {
      location: 'https://delivery.test/film',
      expiresAtMs: Date.now() + 60_000,
      key: 'hosts/site-1/film/master',
      sizeBytes: 5_000_000,
    }
    const { gate, release } = released()
    mockDayWriteGate = () => gate
    let done = false
    const pending = film().then((res) => ((done = true), res))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false)
    release()
    expect((await pending).statusCode).toBe(302)
    expect(siteDay()?.[MEDIA_BANDWIDTH_DAY_FIELD]).toBe(5_000_000)
  })

  it('reports a count the day document refused, and still serves the film', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockDayWriteGate = async () => {
      throw new Error('ABORTED: too much contention')
    }
    const res = await film()
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(FILM.toString())
    expect(error).toHaveBeenCalledWith(
      '[media-cdn] serve not counted',
      'site-1',
      'film',
      expect.any(Error),
    )
    error.mockRestore()
  })
})

describe('Free stops at its band (AGL-3474)', () => {
  it('refuses a Free org’s film once its cap is engaged — and keeps its images', async () => {
    mockStore['orgs/org-1'] = freeOrg({ bandwidthCap: { month: MONTH, engagedAt: 1 } })
    const res = await film()
    expect(res.statusCode).toBe(503)
    expect(res.getHeader('retry-after')).toBe('3600')
    expect(res.getHeader('cache-control')).toBe('no-store')
    expect(res.body).not.toContain('FILM')
    // Refused before anything was sent, so nothing was counted.
    expect(siteDay()).toBeUndefined()

    const image = await picture()
    expect(image.statusCode).toBe(200)
  })

  it('refuses the delivery provider’s redirect too', async () => {
    mockStore['orgs/org-1'] = freeOrg({ bandwidthCap: { month: MONTH, engagedAt: 1 } })
    mockRedirect = {
      location: 'https://delivery.test/film',
      expiresAtMs: Date.now() + 60_000,
      key: 'k',
      sizeBytes: 5_000_000,
    }
    const res = await film()
    expect(res.statusCode).toBe(503)
    expect(res.getHeader('location')).toBeUndefined()
  })

  it('NEGATIVE: last month’s marker refuses nothing', async () => {
    mockStore['orgs/org-1'] = freeOrg({ bandwidthCap: { month: '2020-01', engagedAt: 1 } })
    expect((await film()).statusCode).toBe(200)
  })

  it('NEGATIVE: a paying org carrying this month’s marker keeps serving', async () => {
    // It upgraded after the cap engaged: the plan is re-read, so the marker it
    // still carries refuses nothing.
    mockStore['orgs/org-1'] = paidOrg({ bandwidthCap: { month: MONTH, engagedAt: 1 } })
    expect((await film()).statusCode).toBe(200)
  })

  it('refuses a Free site’s film while its abuse ceiling degrades it', async () => {
    mockStore['orgs/org-1'] = freeOrg()
    mockStore['hosts/site-1'] = {
      ...mockStore['hosts/site-1'],
      bandwidthCeiling: { month: MONTH, ceiling: 100_000, used: 100_001, degraded: true },
    }
    expect((await film()).statusCode).toBe(503)
  })

  it('NEGATIVE: the same ceiling on a paying site refuses nothing', async () => {
    mockStore['hosts/site-1'] = {
      ...mockStore['hosts/site-1'],
      bandwidthCeiling: { month: MONTH, ceiling: 100_000, used: 100_001, degraded: true },
    }
    expect((await film()).statusCode).toBe(200)
  })
})

describe('video alone engages the Free cap (AGL-3474)', () => {
  /** A month of counted media, `overBand` bytes either side of the band. */
  const plantMonthOfMedia = (overBand: number) => {
    mockStore[`hosts/site-1/analytics/${MONTH}-01`] = {
      total: 0,
      [MEDIA_BANDWIDTH_DAY_FIELD]: freeBandBytes() + overBand,
    }
  }

  it('stamps the marker the beacon stamps, tells the site’s managers once, and refuses next', async () => {
    mockStore['orgs/org-1'] = freeOrg()
    plantMonthOfMedia(1024 * 1024)
    // Served: the verdict this request read predates the stamp.
    expect((await film()).statusCode).toBe(200)

    const marker = mockStore['orgs/org-1']?.['bandwidthCap']
    expect(marker).toMatchObject({
      month: MONTH,
      includedPageViews: Math.round(
        pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.free.bandwidthGb),
      ),
    })
    expect(marker.pageViews).toBeGreaterThan(marker.includedPageViews)
    expect(marker.engagedAt).toBeGreaterThan(0)
    // The merge kept the org whole.
    expect(mockStore['orgs/org-1']).toMatchObject({ name: 'Acme', plan: 'free' })
    // The reader every serving path calls agrees.
    expect(bandwidthCapEngaged(mockStore['orgs/org-1'] as never)).toBe(true)

    expect(mockNotices).toHaveLength(1)
    expect(mockNotices[0]?.hostId).toBe('site-1')
    expect(mockNotices[0]?.payload['type']).toBe('system.bandwidthCapEngaged')
    expect(mockNotices[0]?.payload['body']).toContain('Nothing is charged')
    // …and says why a film spent it faster than pages would have.
    expect(mockNotices[0]?.payload['body']).toContain(
      `count ${ORIGIN_MEDIA_BANDWIDTH_WEIGHT}× toward it`,
    )

    // Once the verdict cache turns over, the film stops.
    invalidateMediaCdnLockCache()
    expect((await film()).statusCode).toBe(503)
    // …and another instance totalling the same month neither re-stamps it
    // nor tells anyone again.
    invalidateMediaBandwidthCapState()
    const engagedAt = marker.engagedAt
    expect(await engageMediaBandwidthCap('org-1')).toBe(false)
    expect(mockStore['orgs/org-1']?.['bandwidthCap']?.engagedAt).toBe(engagedAt)
    expect(mockNotices).toHaveLength(1)
  })

  it('counts the org library’s video toward the same band', async () => {
    mockStore['orgs/org-1'] = freeOrg()
    mockStore[`orgs/org-1/analytics/${MONTH}-01`] = {
      [MEDIA_BANDWIDTH_DAY_FIELD]: freeBandBytes() + 1024 * 1024,
    }
    mockStore['__metadata'] = { contentType: 'application/pdf' }
    expect((await serve(['org:org-1', 'brochure'])).statusCode).toBe(200)
    expect(mockStore['orgs/org-1']?.['bandwidthCap']?.month).toBe(MONTH)
  })

  it('NEGATIVE: a Free org inside its band is not stamped', async () => {
    mockStore['orgs/org-1'] = freeOrg()
    plantMonthOfMedia(-1024 * 1024)
    expect((await film()).statusCode).toBe(200)
    expect(mockStore['orgs/org-1']?.['bandwidthCap']).toBeUndefined()
    expect(mockNotices).toHaveLength(0)
  })

  it('counts a film at its weight: bytes that would fit the band 1:1 cross it', async () => {
    // Inside the band at one-for-one, past it at the weight — the case a
    // weight applied anywhere but the shared conversion would get wrong.
    mockStore['orgs/org-1'] = freeOrg()
    mockStore[`hosts/site-1/analytics/${MONTH}-01`] = {
      [MEDIA_BANDWIDTH_DAY_FIELD]: PLAN_ENTITLEMENTS.free.bandwidthGb * GIB * 0.9,
    }
    expect((await film()).statusCode).toBe(200)
    expect(mockStore['orgs/org-1']?.['bandwidthCap']?.month).toBe(MONTH)
  })

  it('NEGATIVE: a paying org a hundred bands over is never stamped, and costs no read', async () => {
    mockStore[`hosts/site-1/analytics/${MONTH}-01`] = {
      [MEDIA_BANDWIDTH_DAY_FIELD]: freeBandBytes() * 100,
    }
    expect((await film()).statusCode).toBe(200)
    expect(mockStore['orgs/org-1']?.['bandwidthCap']).toBeUndefined()
    // Past the band a paying org is billed, not totalled: no month was read.
    expect(mockQueries.filter((path) => path.endsWith('/analytics'))).toEqual([])
  })

  it('NEGATIVE: an image never starts a total', async () => {
    mockStore['orgs/org-1'] = freeOrg()
    plantMonthOfMedia(1024 * 1024)
    expect((await picture()).statusCode).toBe(200)
    expect(mockStore['orgs/org-1']?.['bandwidthCap']).toBeUndefined()
  })
})
