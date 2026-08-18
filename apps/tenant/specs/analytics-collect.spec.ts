/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
 *
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
 * The pageview collector (AGL-82) and its AGL-1844 expansion — UTM capture,
 * visitor approximation, retention stamps and the spoofed-host gate — driven
 * through the real route with a fake Firestore.
 *
 * The counters under test are metered-invoice inputs (`analytics/{day}.total`
 * prices page views), so the assertions are about the exact document a beacon
 * leaves behind: which fields exist, which do not, and the precise numbers.
 * The fake `set(merge)` merges maps RECURSIVELY and applies increments at the
 * leaves, because that is what Firestore does and a shallow fake would
 * fabricate both false greens and false reds on the nested `paths`/`utm`
 * maps.
 */

const HOST_ID = 'host-1'
const DAY = new Date().toISOString().slice(0, 10)

type Increment = { __increment: number }
const mockIsIncrement = (value: unknown): value is Increment =>
  typeof value === 'object' && value !== null && '__increment' in (value as any)

let mockStore: Record<string, Record<string, any>> = {}
let mockEmitted: Array<{ hostId: string; event: string }> = []
let mockHostReads = 0

/** Recursive merge with increments applied at the leaves, like Firestore. */
const mockApplyMerge = (
  base: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> => {
  const next: Record<string, any> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (mockIsIncrement(value)) {
      next[key] = Number(next[key] ?? 0) + value.__increment
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !(value instanceof Date) &&
      !Array.isArray(value)
    ) {
      next[key] = mockApplyMerge(
        typeof next[key] === 'object' && next[key] !== null ? next[key] : {},
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

const mockDocHandle = (path: string) => ({
  get: async () => {
    if (path.startsWith('hosts/') && path.split('/').length === 2) {
      mockHostReads += 1
    }
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    const base = options?.merge ? (mockStore[path] ?? {}) : {}
    mockStore[path] = mockApplyMerge(base, patch)
  },
  update: async (patch: Record<string, any>) => {
    // Real update() throws on a missing doc — the route relies on that to
    // avoid resurrecting deleted overlays, so the fake must model it.
    if (mockStore[path] === undefined) {
      throw new Error(`no document at ${path}`)
    }
    const next = { ...mockStore[path] }
    for (const [dotted, value] of Object.entries(patch)) {
      const segments = dotted.split('.')
      let cursor: Record<string, any> = next
      for (const segment of segments.slice(0, -1)) {
        cursor[segment] = { ...(cursor[segment] ?? {}) }
        cursor = cursor[segment]
      }
      const leaf = segments[segments.length - 1]
      cursor[leaf] = mockIsIncrement(value)
        ? Number(cursor[leaf] ?? 0) + value.__increment
        : value
    }
    mockStore[path] = next
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string) => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  // The barrel drags the whole admin surface in; the route needs little. The
  // rate limiter is required FOR REAL (a pure module) so the route runs its
  // actual limiter arithmetic, not a fake of it.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => mockCollectionHandle(name),
        }),
      }),
    },
  }
})

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: (hostId: string, event: string) => {
    mockEmitted.push({ hostId, event })
    return Promise.resolve()
  },
}))

const loadRoute = () => {
  let route: typeof import('../app/api/analytics/collect/route')
  jest.isolateModules(() => {
    route = require('../app/api/analytics/collect/route')
  })
  return route!
}

const beacon = (
  body: Record<string, unknown>,
  options?: { ip?: string; userAgent?: string; host?: string },
) =>
  new Request('https://site.example/api/analytics/collect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'text/plain',
      'x-forwarded-for': options?.ip ?? '203.0.113.7',
      'user-agent': options?.userAgent ?? 'Mozilla/5.0 (Macintosh)',
      host: options?.host ?? 'site.example',
    },
  })

const dayDoc = () => mockStore[`hosts/${HOST_ID}/analytics/${DAY}`]

beforeEach(() => {
  mockStore = {
    // The host exists — the AGL-1844 spoof gate reads this.
    [`hosts/${HOST_ID}`]: { subdomain: 'site' },
  }
  mockEmitted = []
  mockHostReads = 0
})

describe('pageview counting (AGL-82 baseline)', () => {
  it('counts a pageview into the day doc with path, device and referrer', async () => {
    const route = loadRoute()
    const response = await route.POST(
      beacon({
        hostId: HOST_ID,
        path: '/pricing',
        referrer: 'https://news.example/post',
      }),
    )
    expect(response.status).toBe(204)
    expect(dayDoc()).toBeDefined()
    expect(dayDoc().total).toBe(1)
    expect(dayDoc().paths['/pricing']).toBe(1)
    expect(dayDoc().devices.desktop).toBe(1)
    expect(dayDoc().referrers['news_example']).toBe(1)
    expect(mockEmitted).toEqual([{ hostId: HOST_ID, event: 'pageView' }])
  })

  it('attributes the pageview to the screen day doc when screenId rides along', async () => {
    const route = loadRoute()
    await route.POST(beacon({ hostId: HOST_ID, path: '/', screenId: 'scr-1' }))
    const screenDoc = mockStore[`hosts/${HOST_ID}/screenAnalytics/scr-1:${DAY}`]
    expect(screenDoc).toBeDefined()
    expect(screenDoc.total).toBe(1)
    expect(screenDoc.screenId).toBe('scr-1')
    expect(screenDoc.day).toBe(DAY)
  })
})

describe('UTM capture (AGL-1844)', () => {
  it('counts utm source/medium/campaign into the day doc as opaque components', async () => {
    const route = loadRoute()
    await route.POST(
      beacon({
        hostId: HOST_ID,
        path: '/',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'aug-launch',
      }),
    )
    await route.POST(
      beacon({ hostId: HOST_ID, path: '/other', utmSource: 'newsletter' }),
    )
    expect(dayDoc().total).toBe(2)
    expect(dayDoc().utm.source.newsletter).toBe(2)
    expect(dayDoc().utm.medium.email).toBe(1)
    expect(dayDoc().utm.campaign['aug-launch']).toBe(1)
  })

  it('writes no utm field at all when the beacon carries none', async () => {
    const route = loadRoute()
    await route.POST(beacon({ hostId: HOST_ID, path: '/' }))
    expect(dayDoc().total).toBe(1)
    expect(dayDoc().utm).toBeUndefined()
  })

  it('sanitizes utm values into Firestore-safe map keys and caps their length', async () => {
    const route = loadRoute()
    await route.POST(
      beacon({
        hostId: HOST_ID,
        path: '/',
        utmSource: 'bad.$key#[1]',
        utmCampaign: 'x'.repeat(500),
      }),
    )
    expect(dayDoc().utm.source['bad__key__1_']).toBe(1)
    const campaignKeys = Object.keys(dayDoc().utm.campaign)
    expect(campaignKeys).toHaveLength(1)
    expect(campaignKeys[0].length).toBeLessThanOrEqual(80)
  })

  it('caps distinct utm values per host/day/param — known values keep counting', async () => {
    const route = loadRoute()
    for (let index = 0; index < 50; index += 1) {
      await route.POST(
        beacon({ hostId: HOST_ID, path: '/', utmSource: `s${index}` }),
      )
    }
    // 51st DISTINCT value is dropped; the map stays bounded.
    await route.POST(
      beacon({ hostId: HOST_ID, path: '/', utmSource: 'one-too-many' }),
    )
    expect(Object.keys(dayDoc().utm.source)).toHaveLength(50)
    expect(dayDoc().utm.source['one-too-many']).toBeUndefined()
    // A value that made it in before the cap still counts…
    await route.POST(beacon({ hostId: HOST_ID, path: '/', utmSource: 's0' }))
    expect(dayDoc().utm.source.s0).toBe(2)
    // …and the pageview itself is never dropped with the label.
    expect(dayDoc().total).toBe(52)
  })
})

