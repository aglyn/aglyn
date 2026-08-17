/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * The extended `/api/edit-context` payload (AGL-1829). `buildRoute` and the
 * plugin-set composition are the REAL implementations — only the Firestore
 * reads, the token verify and the release-flag verdicts are faked — so these
 * assertions pin actual console URLs, not mock echoes. Pinned:
 *
 * - draftChanges is TRUE when the screen's most recently touched version is
 *   not the live pointer, FALSE when it is — and the versions read happens
 *   only on this editor-only call (the fake counts every query);
 * - quick links are real buildRoute output for the org slug + subdomain;
 * - Inbox/Orders render only what the host's effective plugin set justifies:
 *   a host-level `disabledPlugins` entry removes its link, a release-flag
 *   subtraction removes its link, and Orders deep-links `?tab=orders`;
 * - a bad token still gets a flat 401 before any read happens.
 */

interface FakeDocData {
  [field: string]: unknown
}

let mockHostData: FakeDocData | null
let mockScreenData: FakeDocData | null
let mockOrgData: FakeDocData | null
let mockLatestVersionId: string | null
let mockVersionQueries: number
let mockFlagFilter: (ids: readonly string[]) => string[]
// The AGL-82 analytics day docs the stat cluster reads (AGL-1829 follow-on).
let mockAnalyticsDayData: FakeDocData | null
let mockAnalyticsDayThrow: boolean
let mockAnalyticsDayId: string | undefined
let mockScreenAnalyticsData: FakeDocData | null
let mockScreenAnalyticsReads: number
let mockScreenAnalyticsDocId: string | undefined

function docSnapshot(data: FakeDocData | null) {
  return {
    exists: data !== null,
    data: () => data ?? undefined,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

/**
 * Minimal Firestore double for the exact chains the route walks:
 * a host doc, its screen doc, the screen's versions orderBy+limit
 * query, the org doc, and the AGL-82 analytics day docs (host-wide and
 * per-screen). Subcollections dispatch BY NAME so a new read the route
 * grows cannot silently answer with the wrong document.
 */
function hostSubcollection(sub: string) {
  if (sub === 'screens') {
    return {
      withConverter: () => ({
        doc: () => ({ get: async () => docSnapshot(mockScreenData) }),
      }),
      doc: () => ({
        collection: (inner: string) => {
          expect(inner).toBe('versions')
          return {
            orderBy: (field: string, direction: string) => ({
              limit: (count: number) => ({
                get: async () => {
                  mockVersionQueries += 1
                  expect(field).toBe('updatedAt')
                  expect(direction).toBe('desc')
                  expect(count).toBe(1)
                  return {
                    docs: mockLatestVersionId
                      ? [{ id: mockLatestVersionId }]
                      : [],
                  }
                },
              }),
            }),
          }
        },
      }),
    }
  }
  if (sub === 'analytics') {
    return {
      doc: (id: string) => ({
        get: async () => {
          if (mockAnalyticsDayThrow) throw new Error('unavailable')
          mockAnalyticsDayId = id
          return docSnapshot(mockAnalyticsDayData)
        },
      }),
    }
  }
  if (sub === 'screenAnalytics') {
    return {
      doc: (id: string) => ({
        get: async () => {
          mockScreenAnalyticsReads += 1
          mockScreenAnalyticsDocId = id
          return docSnapshot(mockScreenAnalyticsData)
        },
      }),
    }
  }
  throw new Error(`Unexpected host subcollection: ${sub}`)
}

function mockFirestore() {
  return {
    collection: (name: string) => ({
      withConverter: () => ({
        doc: () => ({
          get: async () =>
            docSnapshot(name === 'hosts' ? mockHostData : mockScreenData),
        }),
      }),
      doc: () => ({
        get: async () => docSnapshot(name === 'orgs' ? mockOrgData : mockHostData),
        collection: hostSubcollection,
      }),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore() }),
  },
  hostConverter: {},
  screenConverter: {},
  isServerReleaseFlagOnForOrg: jest.fn(async () => true),
  verifyEditAccessToken: (token: unknown) =>
    token === 'good-token'
      ? { hostId: 'host-1', uid: 'user-1', exp: 123456 }
      : null,
  filterEnabledPluginsByReleaseFlags: jest.fn(
    async (ids: readonly string[]) => mockFlagFilter(ids),
  ),
}))

import { POST } from '../app/api/edit-context/route'

function contextRequest(token = 'good-token', path = '/about'): Request {
  return new Request('https://www.aglyn.com/api/edit-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'www.aglyn.com' },
    body: JSON.stringify({ token, path }),
  })
}

describe('/api/edit-context extended payload (AGL-1829)', () => {
  beforeEach(() => {
    mockHostData = {
      $id: 'host-1',
      orgId: 'org-1',
      subdomain: 'www',
      cname: 'www.aglyn.com',
      displayName: 'Aglyn Marketing',
      screens: { 'screen-1': 'about' },
    }
    mockScreenData = {
      $id: 'screen-1',
      displayName: 'About',
      versionId: 'v-live',
    }
    mockOrgData = { slug: 'acme', enabledPlugins: ['inbox', 'commerce'] }
    mockLatestVersionId = 'v-live'
    mockVersionQueries = 0
    mockFlagFilter = (ids) => [...ids]
    mockAnalyticsDayData = { total: 128 }
    mockAnalyticsDayThrow = false
    mockAnalyticsDayId = undefined
    mockScreenAnalyticsData = { total: 12 }
    mockScreenAnalyticsReads = 0
    mockScreenAnalyticsDocId = undefined
  })

  it('reports draft changes when a newer version than the live pointer exists', async () => {
    mockLatestVersionId = 'v-draft'
    const response = await POST(contextRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.draftChanges).toBe(true)
    expect(mockVersionQueries).toBe(1)
  })

  it('reports no draft changes when the latest version IS the live one', async () => {
    const payload = await (await POST(contextRequest())).json()
    expect(payload.draftChanges).toBe(false)
  })

  it('builds the quick links through the real route table', async () => {
    const payload = await (await POST(contextRequest())).json()
    expect(payload.consoleUrl).toBe('https://app.aglyn.com/acme/hosts/www')
    expect(payload.screensUrl).toBe(
      'https://app.aglyn.com/acme/hosts/www/screens',
    )
    expect(payload.inboxUrl).toBe('https://app.aglyn.com/acme/hosts/www/inbox')
    expect(payload.ordersUrl).toBe(
      'https://app.aglyn.com/acme/hosts/www/products?tab=orders',
    )
    expect(payload.editUrl).toBe(
      'https://app.aglyn.com/acme/hosts/www/screens/screen-1/versions/v-live/besigner',
    )
    // The connected-as identity's destination: the console's user-level
    // account page — deliberately org-slug-free, so it survives whatever
    // workspace the editor lands in.
    expect(payload.accountUrl).toBe('https://app.aglyn.com/manage/user')
  })

  it("subtracts the host's per-site deny-list from the quick links", async () => {
    mockHostData = { ...mockHostData, disabledPlugins: ['inbox'] }
    const payload = await (await POST(contextRequest())).json()
    expect(payload.inboxUrl).toBeNull()
    expect(payload.ordersUrl).not.toBeNull()
  })

  it('subtracts release-flagged-off plugins from the quick links', async () => {
    mockFlagFilter = (ids) => ids.filter((id) => id !== 'commerce')
    const payload = await (await POST(contextRequest())).json()
    expect(payload.ordersUrl).toBeNull()
    expect(payload.inboxUrl).not.toBeNull()
  })

  it("resolves the site's favicon exactly like the layout's icon link", async () => {
    // Same field, same resolver as AGL-1421: a `media:` reference becomes
    // the site-relative CDN path the bar's page can resolve.
    mockHostData = { ...mockHostData, seo: { favicon: 'media:host-1/fav1' } }
    const payload = await (await POST(contextRequest())).json()
    expect(payload.faviconUrl).toBe('/api/media/cdn/host-1/fav1')
  })

  it('sends null — not a broken href — when the site set no favicon', async () => {
    const payload = await (await POST(contextRequest())).json()
    expect(payload.faviconUrl).toBeNull()
  })

  it('links the console analytics surface through the real route table', async () => {
    const payload = await (await POST(contextRequest())).json()
    expect(payload.analyticsUrl).toBe(
      'https://app.aglyn.com/acme/hosts/www/analytics',
    )
  })

  it("reports today's site pageviews from the AGL-82 day doc", async () => {
    const payload = await (await POST(contextRequest())).json()
    expect(payload.viewsToday).toBe(128)
    // The doc read is TODAY's UTC day id — the live counter, not history.
    expect(mockAnalyticsDayId).toBe(new Date().toISOString().slice(0, 10))
  })

  it('reports zero (not null) when no day doc exists yet', async () => {
    mockAnalyticsDayData = null
    const payload = await (await POST(contextRequest())).json()
    expect(payload.viewsToday).toBe(0)
  })

  it('reports null — no verdict — when the day-doc read fails', async () => {
    mockAnalyticsDayThrow = true
    const payload = await (await POST(contextRequest())).json()
    expect(payload.viewsToday).toBeNull()
  })

  it('withholds the per-screen stat AND its read from an unentitled org', async () => {
    // The default org has no plan → free → no screenAnalytics entitlement.
    const payload = await (await POST(contextRequest())).json()
    expect(payload.screenViewsToday).toBeNull()
    expect(mockScreenAnalyticsReads).toBe(0)
  })

  it('serves the per-screen stat to a Pro org from the AGL-151 doc', async () => {
    mockOrgData = { ...mockOrgData, plan: 'pro' }
    const payload = await (await POST(contextRequest())).json()
    expect(payload.screenViewsToday).toBe(12)
    expect(mockScreenAnalyticsReads).toBe(1)
    expect(mockScreenAnalyticsDocId).toBe(
      `screen-1:${new Date().toISOString().slice(0, 10)}`,
    )
  })

  it('downgrades the per-screen stat with a dead subscription, plan field intact', async () => {
    // `org.plan` is NOT entitlement (AGL-247): a canceled subscription must
    // read as free even while the stale plan field still says pro.
    mockOrgData = {
      ...mockOrgData,
      plan: 'pro',
      subscription: { status: 'canceled' },
    }
    const payload = await (await POST(contextRequest())).json()
    expect(payload.screenViewsToday).toBeNull()
    expect(mockScreenAnalyticsReads).toBe(0)
  })

  it('refuses a bad token with 401 before any read', async () => {
    const response = await POST(contextRequest('bad-token'))
    expect(response.status).toBe(401)
    expect(mockVersionQueries).toBe(0)
  })

  it('skips the versions read entirely for an unrouted path', async () => {
    mockHostData = { ...mockHostData, screens: {} }
    const payload = await (await POST(contextRequest())).json()
    expect(payload.draftChanges).toBeNull()
    expect(payload.screenId).toBeNull()
    expect(mockVersionQueries).toBe(0)
  })
})
