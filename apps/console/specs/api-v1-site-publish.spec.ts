/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2462 — `POST /v1/sites/{siteId}/publish`.
 *
 * An integration could write a dataset record over `/v1` and had no way to make
 * a live page show it. The only mechanism was time: `getDatasets` caches for
 * `DATASETS_TTL_SECONDS` (60) behind `tenantDataTag(hostId)`, and the catch-all
 * page is `revalidate = 60`. Time-based ISR is stale-while-revalidate, so the
 * visitor AFTER the window can still be served the old copy. A cache expiring
 * is not a publish.
 *
 * ## What each block has to prove, and what would make it lie
 *
 * - **The publish reaches the tenant.** Asserting only a `200` is satisfied by
 *   a handler that returns `{ published: true }` and calls nothing. So the
 *   captured tenant request is asserted on: the secret header, the subdomain,
 *   and above all `hostId` — the field that busts `tenant-data:{hostId}` and
 *   is therefore the only reason a re-render reads the record that was just
 *   written rather than faithfully rebuilding from the cached copy.
 * - **The gate is wired.** A scope suite that shows only a refusal is
 *   satisfied by a handler that refuses everything, so the negative control
 *   leads: the same request with the scope succeeds. `sites:read` is tried
 *   explicitly, because a publish gated on the READ scope would pass a test
 *   that only checks "some scope is required".
 * - **The budget is per HOST, not per key.** This is the whole reason the
 *   endpoint was safe to build (see the handler's docblock: 250 paths × ~40
 *   Firestore reads each, on the cheapest call in the API). A budget keyed on
 *   the API key would let one org mint ten keys and multiply the fan-out, so
 *   the key the limiter is called with is asserted literally.
 * - **The refusal costs nothing downstream.** Every refusal asserts that the
 *   tenant was NOT called — a 429 that still fans out is the bug wearing a
 *   status code.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
let mockOrg: Record<string, unknown> = {
  plan: 'business',
  hosts: { 'host-1': true },
}
let mockScopes: string[] = ['sites:read', 'sites:publish']

/** Durable-limiter calls, in order, so the budget key can be asserted. */
let mockRateCalls: Array<{ key: string; limit?: number; windowMs?: number }> = []
/** Keys the durable limiter should refuse, and the reset it reports. */
let mockRateRefuse = new Set<string>()

/** Tenant `/api/revalidate` requests captured from the mocked `fetch`. */
let mockTenantCalls: Array<{ url: string; headers: Record<string, string>; body: any }> = []
let mockTenantStatus = 200
let mockTenantBody: unknown = {
  revalidated: ['/host-1/', '/host-1/menu'],
  count: 2,
  requested: 2,
  truncated: 0,
  revalidatedTags: ['tenant-data:host-1', 'tenant-host:demo'],
}

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => ({
      id,
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path),
      get: (field: string) => mockDocs.get(path)?.[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, { ...(options?.merge ? (mockDocs.get(path) ?? {}) : {}), ...data })
    },
  }
}

function mockCollectionRef(path: string) {
  return { path, doc: (id: string) => mockDocRef(`${path}/${id}`) }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({ orgId: 'org-1', keyId: 'key-1', scopes: mockScopes }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    // The REAL durable limiter is not under test; this double records what it
    // was asked and refuses only what a test names. Recording the options is
    // what lets the per-host window be asserted rather than assumed.
    consumeRateLimit: async (
      key: string,
      options?: { limit?: number; windowMs?: number },
    ) => {
      mockRateCalls.push({ key, limit: options?.limit, windowMs: options?.windowMs })
      const allowed = !mockRateRefuse.has(key)
      return {
        allowed,
        limit: options?.limit ?? 120,
        remaining: allowed ? 119 : 0,
        resetMs: Date.now() + (options?.windowMs ?? 60_000),
        degraded: false,
        contended: false,
      }
    },
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  PLATFORM_BRAND_NAME: 'Aglyn',
}))

jest.mock('firebase-admin/firestore', () => {
  class MockTimestamp {
    mockMs = 0
    toDate() {
      return new Date(this.mockMs)
    }
    static now() {
      return new MockTimestamp()
    }
  }
  return { __esModule: true, FieldPath: { documentId: () => '__name__' }, Timestamp: MockTimestamp }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GET, POST } from '../app/api/v1/[[...route]]/route'

/**
 * Read as SOURCE, not imported. `@aglyn/tenant-data-admin` is wholesale-mocked
 * above — a closed world — so an import of `API_SCOPES` here would resolve to
 * the mock and assert nothing about the real constant.
 */
const readSource = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', '..', '..', ...parts), 'utf8')

const request = (path: string, method = 'POST') =>
  new Request(`https://app.aglyn.com/api/v1/${path}`, {
    method,
    headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
  })

const routeContext = (segments: string[]) => ({
  params: Promise.resolve({ route: segments }),
})

const publish = (hostId = 'host-1') =>
  POST(request(`sites/${hostId}/publish`), routeContext(['sites', hostId, 'publish']))

beforeEach(() => {
  mockDocs.clear()
  mockOrg = { plan: 'business', hosts: { 'host-1': true } }
  mockScopes = ['sites:read', 'sites:publish']
  mockRateCalls = []
  mockRateRefuse = new Set()
  mockTenantCalls = []
  mockTenantStatus = 200
  mockTenantBody = {
    revalidated: ['/host-1/', '/host-1/menu'],
    count: 2,
    requested: 2,
    truncated: 0,
    revalidatedTags: ['tenant-data:host-1', 'tenant-host:demo'],
  }
  process.env['REVALIDATE_SECRET'] = 'shh'
  // A routed site: two screens with paths, which is what the handler turns
  // into the tenant's `paths`.
  mockDocs.set('hosts/host-1', {
    subdomain: 'demo',
    displayName: 'Demo',
    screens: { 'scr-1': '', 'scr-2': 'menu' },
  })
  global.fetch = (async (url: unknown, init: any) => {
    mockTenantCalls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    return {
      ok: mockTenantStatus >= 200 && mockTenantStatus < 300,
      status: mockTenantStatus,
      json: async () => mockTenantBody,
    }
  }) as never
})

describe('POST /v1/sites/{siteId}/publish (AGL-2462)', () => {
  it('publishes: reaches the tenant with the data tag and the site paths', async () => {
    const response = await publish()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.object).toBe('publish')
    expect(body.site).toBe('host-1')

    // The tenant was actually called — once.
    expect(mockTenantCalls).toHaveLength(1)
    const [call] = mockTenantCalls
    expect(call.url).toContain('demo.')
    expect(call.url).toContain('/api/revalidate')
    expect(call.headers['x-revalidate-secret']).toBe('shh')
    expect(call.body.host).toBe('demo')
    // THE field that makes the dataset record visible. Without `hostId` the
    // tenant busts no `tenant-data:{hostId}` tag, every dropped page
    // regenerates from the same cached datasets, and the endpoint is a
    // 250-path no-op that still reports success.
    expect(call.body.hostId).toBe('host-1')
    expect(call.body.paths).toEqual(expect.arrayContaining(['/', '/menu']))
  })

  it('refuses a key without sites:publish, and sites:read is not enough', async () => {
    mockScopes = ['sites:read']
    const response = await publish()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.type).toBe('insufficient_scope')
    expect(body.error.code).toBe('sites:publish')
    // A refusal that still fanned out would be the amplifier wearing a 403.
    expect(mockTenantCalls).toHaveLength(0)
  })

  it('404s a site the organization does not own, and never calls the tenant', async () => {
    mockDocs.set('hosts/host-9', { subdomain: 'someone-else', screens: { a: '' } })
    const response = await publish('host-9')

    expect(response.status).toBe(404)
    expect(mockTenantCalls).toHaveLength(0)
  })

  it('bounds the fan-out with a per-HOST hourly budget, not the per-key one', async () => {
    await publish()

    const publishBudget = mockRateCalls.filter((call) =>
      call.key.startsWith('apiv1-publish:'),
    )
    expect(publishBudget).toHaveLength(1)
    // Keyed on the HOST. Keyed on the API key instead, an org mints ten keys
    // and multiplies the fan-out by ten — the budget has to bound the work,
    // and the work belongs to the site.
    expect(publishBudget[0].key).toBe('apiv1-publish:host-1')
    // A handful an hour, not the documented 120/min the request limiter uses.
    expect(publishBudget[0].windowMs).toBe(60 * 60 * 1000)
    expect(publishBudget[0].limit).toBeLessThanOrEqual(20)
  })

  it('429s once the host budget is spent, and does not fan out', async () => {
    mockRateRefuse.add('apiv1-publish:host-1')
    const response = await publish()
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.error.type).toBe('rate_limited')
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(mockTenantCalls).toHaveLength(0)
  })

  it('405s a GET on the publish path', async () => {
    const response = await GET(
      request('sites/host-1/publish', 'GET'),
      routeContext(['sites', 'host-1', 'publish']),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('POST')
  })

  it('reports a site with no routed screens instead of pretending it published', async () => {
    mockDocs.set('hosts/host-1', { subdomain: 'demo', screens: {} })
    const response = await publish()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.published).toBe(false)
    expect(body.reason).toBe('not_routed')
    expect(mockTenantCalls).toHaveLength(0)
  })
})

describe('the sites:publish scope is grantable (AGL-899 rule)', () => {
  it('is enforced by API_SCOPES and offered by the console picker', () => {
    const scopes = readSource(
      'libs/tenant/data/admin/src/lib/server/api-keys.ts',
    )
    const picker = readSource(
      'apps/console/components/org-api-keys-card.component.tsx',
    )
    // A scope the server enforces but the picker omits is a scope nobody can
    // grant, so the endpoint ships closed to every customer.
    expect(scopes).toContain("'sites:publish'")
    expect(picker).toContain("scope: 'sites:publish'")
  })
})
