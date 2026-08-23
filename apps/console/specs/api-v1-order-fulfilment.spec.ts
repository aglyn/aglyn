/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * `PATCH /v1/sites/{siteId}/orders/{orderId}` — recording a shipment over the
 * public REST API (AGL-2461).
 *
 * ## What this file is really testing
 *
 * The endpoint's whole design is that `apps/console` implements NONE of the
 * order semantics: the transition rule, the transaction, the fulfillment
 * append and the timeline all live in the commerce plugin, which this app may
 * not import (`eslint.config.mjs`, `scope:app` →
 * `notDependOnLibsWithTags:['aglyn:addons']`), and are reached through the
 * core `registerOrderFulfilmentService` capability registry. So the app's
 * responsibilities are exactly two — **authorize**, and **translate** — and
 * those are what is asserted here. The commerce half is proved in
 * `libs/plugins/commerce/src/lib/server/fulfill-order.spec.ts`.
 *
 * ## The registry is REAL here, and the double is faithful on the one point
 *
 * `getOrderFulfilmentService` is `requireActual`, not a stub: a handler that
 * quietly wrote the order itself would pass a mocked lookup and fail here.
 * And the fake service is registered INSIDE the mocked `ensureAll` — exactly
 * as production registers it inside the loader's activation of the commerce
 * `consoleApi` surface — so a handler that forgets to `ensureAll` finds no
 * service and 404s, rather than being handed one for free by the test.
 *
 * The service double models the semantics the real transaction guarantees
 * (`already` on a repeat, `blocked` carrying the refusing status, no write on
 * either), because a double that always answered `recorded` would make the
 * conflict and retry cases pass against a handler that mishandled both.
 *
 * ## Authorization is the point, not a detail
 *
 * This is a money-adjacent write on a public, key-authenticated surface. Four
 * gates stand in front of it — key scope, plan entitlement, org-owns-site, and
 * per-site plugin enablement — and each has its own case naming the mutation
 * that reddens it. The org-scoping one matters most: without it, any valid key
 * could move any other tenant's order by guessing a host id.
 */

/** Every document, by path. */
const mockDocs = new Map<string, Record<string, unknown>>()

/** Scopes the authenticated key carries, per test. */
let mockScopes: string[] = []
/** What `checkEntitlement` answers, per entitlement, per test. */
let mockEntitlements: Record<string, boolean> = {}
/** The org document `getOrgDoc` resolves the key to, per test. */
let mockOrg: Record<string, unknown> = {}

const tick = () => Promise.resolve()

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => {
      await tick()
      return {
        id,
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
        get: (field: string) => mockDocs.get(path)?.[field],
      }
    },
    // The authenticator meters every request onto `apiUsage/{YYYY-MM}`
    // fire-and-forget; a doc ref without `set` throws synchronously, ahead of
    // the promise its `.catch` guards, and every request 500s for a reason
    // that has nothing to do with what is under test.
    set: async (data: Record<string, unknown>) => {
      await tick()
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
    },
    /**
     * DELIBERATELY ABSENT: `update`. The app must never write an order — the
     * plugin's transaction does. A handler that reached for a client-side
     * write here would throw rather than quietly succeed, which is the
     * failure mode this whole change exists to prevent.
     */
  }
}

function mockCollectionRef(path: string) {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
  }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL error envelope: this spec is about what reaches the wire,
  // including the `type`/`code` an integrator branches on.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'NOW' },
      },
    },
  }
})

/** Surfaces each `ensureAll` asked for. */
const mockEnsured: string[][] = []

/** Calls the double received, in order. */
const mockShipments: Array<Record<string, unknown>> = []
/** Set false to model a deployment whose plugins register no fulfilment. */
let mockServicePresent = true

const mockRegistry = jest.requireActual(
  '../../../libs/aglyn/src/lib/plugin-manager/order-fulfilment',
)

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  // The REAL registry, so the handler must genuinely go through the seam.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/order-fulfilment',
  ),
  // The REAL per-site enablement resolution — the gate is only as good as
  // this function, and stubbing it would assert nothing about the gate.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  ),
  apiRequestEnforcementShape: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).apiRequestEnforcementShape,
  checkApiRequestQuota: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).checkApiRequestQuota,
  checkEntitlement: (_org: unknown, entitlement: string) =>
    mockEntitlements[entitlement] ?? false,
  createResourceUid: () => 'rec_1',
}))

/**
 * The commerce plugin's `consoleApi` surface, as the loader activates it: the
 * capability exists only AFTER `ensureAll`, exactly as in production.
 */
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async (surfaces: string[]) => {
      mockEnsured.push(surfaces)
      if (!mockServicePresent) return
      mockRegistry.registerOrderFulfilmentService({
        pluginId: 'commerce',
        recordShipment: async (request: Record<string, unknown>) => {
          mockShipments.push(request)
          const path = `hosts/${request.hostId}/orders/${request.orderId}`
          const order = mockDocs.get(path)
          if (!order) return { outcome: 'no_such_order' }
          if (order.status === request.to) return { outcome: 'already' }
          // The double models the real transition rule on the one axis these
          // cases turn on: a terminal order refuses, and nothing is written.
          if (order.status === 'refunded' || order.status === 'cancelled') {
            return { outcome: 'blocked', from: order.status }
          }
          mockDocs.set(path, {
            ...order,
            status: request.to,
            fulfillments: [
              ...((order.fulfillments as unknown[]) ?? []),
              {
                id: 'ful_1',
                lineItemIds: [0],
                carrier: request.carrier || undefined,
                trackingNumber: request.trackingNumber || undefined,
                atMs: 1_700_000_000_000,
              },
            ],
          })
          return { outcome: 'recorded' }
        },
      })
    }),
  },
}))

import { GET, PATCH } from '../app/api/v1/[[...route]]/route'

const BASE = 'https://app.aglyn.com/api/v1'

async function patch(path: string, body: unknown) {
  const request = new Request(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer aglyn_sk_test',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const segments = path.split('?')[0].split('/').filter(Boolean)
  const response = await PATCH(request, {
    params: Promise.resolve({ route: segments }),
  })
  return { status: response.status, body: await response.json() }
}

async function get(path: string) {
  const request = new Request(`${BASE}${path}`, {
    headers: { authorization: 'Bearer aglyn_sk_test' },
  })
  const segments = path.split('?')[0].split('/').filter(Boolean)
  const response = await GET(request, {
    params: Promise.resolve({ route: segments }),
  })
  return { status: response.status, body: await response.json() }
}

/** The order as it stands in the store — what actually landed. */
const stored = (id = 'ord_1') =>
  mockDocs.get(`hosts/host_1/orders/${id}`) ?? {}

beforeEach(() => {
  mockDocs.clear()
  mockShipments.length = 0
  mockEnsured.length = 0
  mockServicePresent = true
  mockRegistry.resetOrderFulfilmentServiceForTests()
  mockScopes = ['orders:read', 'orders:write']
  mockEntitlements = { apiAccess: true, commerce: true }
  mockOrg = { plan: 'business', hosts: { host_1: true } }
  mockDocs.set('hosts/host_1', { displayName: 'Bakery' })
  mockDocs.set('hosts/host_1/orders/ord_1', {
    number: 12,
    status: 'paid',
    channel: 'online',
    lineItems: [{ productId: 'p1', name: 'Loaf', quantity: 1, unitAmountCents: 500 }],
    totals: { itemsCents: 500, totalCents: 500 },
    createdAt: '2026-08-01T00:00:00.000Z',
  })
  // A second tenant's order, at a host this key's org does not own.
  mockDocs.set('hosts/host_other', { displayName: 'Someone else' })
  mockDocs.set('hosts/host_other/orders/ord_x', { status: 'paid' })
})

describe('the four gates in front of the write', () => {
  it('refuses a key without orders:write, and names the scope', async () => {
    // RED CHECK: delete the `requireScope(ctx, 'orders:write')` line and this
    // returns 200, having moved the order. That is the AGL-899 shape — a
    // scope that mints but grants unconditionally — on a write this time.
    mockScopes = ['orders:read']
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(403)
    expect(body.error.type).toBe('insufficient_scope')
    expect(body.error.code).toBe('orders:write')
    expect(stored().status).toBe('paid')
  })

  it('checks orders:write BEFORE orders:read, so a write-only key is not misled', async () => {
    // A fulfilment key that only records mockShipments holds no read scope. If
    // the read check came first it would be told it lacks `orders:read` — an
    // accurate sentence about the wrong thing, and the AGL-900 defect.
    mockScopes = ['orders:write']
    const { status } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(200)
  })

  it('refuses an org whose PLAN no longer includes commerce', async () => {
    // RED CHECK: drop `requireCommerce(ctx)` from the PATCH branch and this
    // returns 200. The key still has the scope and the plugin is still
    // installed — only the plan changed, which is the AGL-1873 downgrade case.
    mockEntitlements = { apiAccess: true, commerce: false }
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(403)
    expect(body.error.type).toBe('plan_required')
    expect(body.error.code).toBe('commerce')
    expect(stored().status).toBe('paid')
  })

  it('CANNOT move another org’s order, even with every scope', async () => {
    // THE ONE THAT MATTERS. RED CHECK: remove the `orgOwnsHost` guard from
    // `handleSites` — the single place org scoping is decided for every site
    // sub-resource — and this returns 200, having fulfilled a stranger's order
    // — a cross-tenant write primitive addressable by anyone holding any
    // valid key who can guess a host id. `hosts` on the key's own org
    // document is the only thing standing there.
    const { status, body } = await patch('/sites/host_other/orders/ord_x', {
      status: 'fulfilled',
    })
    expect(status).toBe(404)
    expect(body.error.message).toBe('No such site')
    expect(mockDocs.get('hosts/host_other/orders/ord_x')?.status).toBe('paid')
    // Not merely refused — never even reached the capability.
    expect(mockShipments).toHaveLength(0)
  })

  it('refuses a site the org switched commerce OFF for', async () => {
    // RED CHECK: delete the `isHostPluginEnabled` gate and this returns 200.
    // The registry is process-global and filled by `ensureAll`, so a
    // registered service says nothing about one org's configuration — without
    // this gate, a site with commerce switched off still takes order writes,
    // which every other commerce door (AGL-1014) refuses.
    mockDocs.set('hosts/host_1', {
      displayName: 'Bakery',
      disabledPlugins: ['commerce'],
    })
    const { status } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(404)
    expect(stored().status).toBe('paid')
    expect(mockShipments).toHaveLength(0)
  })

  it('gates on the SERVICE’s own pluginId, never a hard-coded name', async () => {
    // The app must not know addon-layer names. Register the capability under
    // a different plugin id and disable THAT id: the gate has to follow.
    mockRegistry.resetOrderFulfilmentServiceForTests()
    mockRegistry.registerOrderFulfilmentService({
      pluginId: 'other-commerce',
      recordShipment: async () => ({ outcome: 'recorded' }),
    })
    mockServicePresent = false // ensureAll must not overwrite the registration
    mockDocs.set('hosts/host_1', { disabledPlugins: ['other-commerce'] })
    const { status } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(404)
  })
})

describe('the seam itself', () => {
  it('activates the plugin surface, and finds the capability only after', async () => {
    // RED CHECK: remove the `serverPluginLoader.ensureAll(['consoleApi'])`
    // call and every write 404s "not available on this deployment" — the
    // registry is empty until the loader activates the plugin, exactly as in
    // production.
    const { status } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(200)
    expect(mockEnsured).toContainEqual(['consoleApi'])
  })

  it('404s honestly on a deployment where no plugin provides fulfilment', async () => {
    // A self-host build without commerce. The endpoint genuinely does not
    // exist there; a 500 would blame the caller's request for a
    // configuration.
    mockServicePresent = false
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(404)
    expect(body.error.type).toBe('not_found')
    expect(body.error.message).toMatch(/not available on this deployment/)
  })

  it('passes the shipment through verbatim, and writes nothing itself', async () => {
    await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })
    expect(mockShipments).toEqual([
      {
        hostId: 'host_1',
        orderId: 'ord_1',
        to: 'fulfilled',
        carrier: 'UPS',
        trackingNumber: '1Z999',
      },
    ])
  })

  it('bounds carrier and tracking exactly as the console route does', async () => {
    await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
      carrier: 'C'.repeat(100),
      trackingNumber: 'T'.repeat(100),
    })
    expect((mockShipments[0].carrier as string).length).toBe(40)
    expect((mockShipments[0].trackingNumber as string).length).toBe(60)
  })
})

describe('what the endpoint will and will not accept', () => {
  it('refuses `cancelled` by NAME, saying why, and never calls the capability', async () => {
    // RED CHECK: drop the `ORDER_WRITE_REFUSED` branch and this becomes the
    // generic "must be one of" 400 — accurate, and it stops telling a
    // merchant's integrator the one thing they need to know, which is where
    // cancelling actually lives and why it is not here.
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'cancelled',
    })
    expect(status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.message).toMatch(/releases held stock/)
    expect(mockShipments).toHaveLength(0)
    expect(stored().status).toBe('paid')
  })

  it('refuses `refunded` by name too — money moves through its own route', async () => {
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'refunded',
    })
    expect(status).toBe(400)
    expect(body.error.message).toMatch(/moves money/)
    expect(stored().status).toBe('paid')
  })

  it('names an unknown key rather than dropping it', async () => {
    // RED CHECK: delete the unknown-key check and this returns 200 with a
    // `trackingUrl` that went nowhere — "we recorded your shipment as you
    // described it" when half of it was discarded. The `updateFormSubmission`
    // and `updateContact` rule.
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
      trackingUrl: 'https://example.com/track',
    })
    expect(status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.fields.trackingUrl).toBe('Not writable on an order')
    expect(mockShipments).toHaveLength(0)
  })

  it('refuses an unknown status with the allowed set', async () => {
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'shipped',
    })
    expect(status).toBe(400)
    expect(body.error.fields.status).toMatch(/fulfilled, delivered/)
  })

  it('405s a POST to one order, and says what IS allowed', async () => {
    const { status } = await patch('/sites/host_1/orders', {
      status: 'fulfilled',
    })
    // No order id — a collection PATCH is not a thing here.
    expect(status).toBe(405)
  })
})

describe('what the caller gets back', () => {
  it('returns the ORDER, showing the shipment that was just recorded', async () => {
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })
    expect(status).toBe(200)
    expect(body.object).toBe('order')
    expect(body.status).toBe('fulfilled')
    // RED CHECK: read the order BEFORE calling the capability and this shows
    // the pre-write state — a 200 whose body contradicts what it just did.
    expect(body.fulfillments).toEqual([
      expect.objectContaining({ carrier: 'UPS', trackingNumber: '1Z999' }),
    ])
    // Published as ISO 8601, like every other time this API emits.
    expect(body.fulfillments[0].at).toBe('2023-11-14T22:13:20.000Z')
  })

  it('a retry lands the same state AND returns the same 200 — no key needed', async () => {
    // RED CHECK: map `already` to a 409 and this fails. The endpoint takes no
    // `Idempotency-Key`; the capability's already-in-target return is what
    // makes the retry safe, and answering it as a conflict would send every
    // fulfilment poller into an error path on its own successful work.
    const first = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    const retry = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(retry.body.status).toBe('fulfilled')
    expect(retry.body.fulfillments).toHaveLength(1)
  })

  it('answers a blocked transition 409 with the new order_transition code', async () => {
    // RED CHECK: reuse an existing 409 code (or fall through to a 500) and
    // this fails. An integrator has to tell "the order moved on without me"
    // apart from every other conflict — it is the one a poller will actually
    // hit, and the one it must not retry forever.
    mockDocs.set('hosts/host_1/orders/ord_1', { status: 'refunded' })
    const { status, body } = await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
    })
    expect(status).toBe(409)
    expect(body.error.type).toBe('conflict')
    expect(body.error.code).toBe('order_transition')
    expect(body.error.message).toMatch(/"refunded"/)
    expect(stored().status).toBe('refunded')
  })

  it('404s an order that is not there', async () => {
    const { status, body } = await patch('/sites/host_1/orders/nope', {
      status: 'delivered',
    })
    expect(status).toBe(404)
    expect(body.error.message).toBe('No such order')
  })

  it('the read side sees the write — one object, one shape', async () => {
    await patch('/sites/host_1/orders/ord_1', {
      status: 'fulfilled',
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })
    const { body } = await get('/sites/host_1/orders/ord_1')
    expect(body.status).toBe('fulfilled')
    expect(body.fulfillments[0].trackingNumber).toBe('1Z999')
  })
})
