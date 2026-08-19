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
 * The orders / products / media resources on the public REST API (AGL-1928).
 *
 * Four of these assertions exist because the naive implementation of each is
 * wrong in a way that still returns 200, which is the class of defect a
 * response-shaped test cannot see:
 *
 * - a scope that is *mintable* but unenforced (the AGL-899 rule),
 * - an entitlement gate that reads the plugin switch rather than the plan
 *   (the AGL-1873 defect, on the read side),
 * - `inventory ?? 0`, which renders every untracked product sold out,
 * - `channel === 'online'` as a Firestore predicate, which silently drops
 *   every order written before the field existed.
 *
 * Each was made to FAIL on purpose before landing — see the note on each
 * `it`, which names the mutation that reddens it.
 */

/** Every document, by path. */
const mockDocs = new Map<string, Record<string, unknown>>()

/** Scopes the authenticated key carries, per test. */
let mockScopes: string[] = []
/** What `checkEntitlement` answers, per entitlement, per test. */
let mockEntitlements: Record<string, boolean> = {}

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
    // fire-and-forget. Modelled rather than stubbed away: a doc ref without
    // `set` throws SYNCHRONOUSLY, ahead of the promise its `.catch` guards,
    // so every request 500s and each assertion below fails for a reason that
    // has nothing to do with what it is testing.
    set: async (data: Record<string, unknown>) => {
      await tick()
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
    },
  }
}

/** Immediate children of a collection path — not grandchildren. */
function childPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

interface Filter {
  field: string
  value: unknown
}

/**
 * A query that models Firestore's `where` semantics EXACTLY on the one point
 * this spec turns on: a document that does not carry the field at all is not
 * matched by an equality filter on it. A fake that treated a missing field as
 * `undefined === undefined` would make the `channel=online` test pass against
 * a broken handler — the unfaithful-double failure mode.
 */
function mockQuery(collectionPath: string, filters: Filter[]) {
  return {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(collectionPath, [...filters, { field, value }]),
    orderBy: () => mockQuery(collectionPath, filters),
    limit: () => mockQuery(collectionPath, filters),
    startAfter: () => mockQuery(collectionPath, filters),
    get: async () => {
      await tick()
      const docs = childPaths(collectionPath)
        .sort()
        .filter((path) => {
          const data = mockDocs.get(path) ?? {}
          return filters.every(
            (filter) =>
              Object.prototype.hasOwnProperty.call(data, filter.field) &&
              data[filter.field] === filter.value,
          )
        })
        .map((path) => ({
          id: path.slice(path.lastIndexOf('/') + 1),
          exists: true,
          data: () => mockDocs.get(path),
          get: (field: string) => mockDocs.get(path)?.[field],
        }))
      return { docs }
    },
  }
}

function mockCollectionRef(path: string) {
  return {
    ...mockQuery(path, []),
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
  }
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL error envelope and header builder: this spec is about what
  // reaches the wire, including the `type`/`code` an integrator branches on.
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
    getOrgDoc: async () => ({ plan: 'business', hosts: { host_1: true } }),
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

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  // The REAL quota functions (AGL-2163) — `authenticateApiV1` enforces
  // `checkApiRequestQuota(...).allowed` at the chokepoint every request here
  // passes through, and a wholesale mock that omits them turns each one into
  // a 500. Real rather than stubbed: the org this suite serves resolves to
  // `'never-blocks'`, so the quota is transparent here as it is in production.
  apiRequestEnforcementShape: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).apiRequestEnforcementShape,
  checkApiRequestQuota: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).checkApiRequestQuota,
  checkEntitlement: (_org: unknown, entitlement: string) =>
    mockEntitlements[entitlement] ?? false,
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => 'rec_1',
}))

import { GET } from '../app/api/v1/[[...route]]/route'

const BASE = 'https://app.aglyn.com/api/v1'

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

beforeEach(() => {
  mockDocs.clear()
  mockScopes = ['orders:read', 'products:read', 'media:read']
  mockEntitlements = { apiAccess: true, commerce: true }
})

describe('GET /v1/sites/{id}/orders', () => {
  beforeEach(() => {
    mockDocs.set('hosts/host_1/orders/ord_modern', {
      number: 12,
      status: 'paid',
      channel: 'pos',
      customerEmail: 'shopper@example.com',
      lineItems: [{ productId: 'p1', name: 'Loaf', quantity: 2, unitAmountCents: 500 }],
      totals: {
        itemsCents: 1000,
        shippingCents: 0,
        taxCents: 83,
        discountCents: 0,
        totalCents: 1083,
        feeCents: 22,
      },
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    // A pre-channel legacy order (AGL-90 Commerce Starter): no `channel`, no
    // `totals`, money in the flat `amountCents`/`feeCents` pair.
    mockDocs.set('hosts/host_1/orders/ord_legacy', {
      number: 3,
      status: 'paid',
      amountCents: 2500,
      feeCents: 50,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('refuses a key without orders:read, and names the scope', async () => {
    // RED CHECK: delete the `requireScope(ctx, 'orders:read')` line in
    // `handleOrders` and this returns 200 with the order list. That is the
    // AGL-899 shape — a scope that mints but grants unconditionally.
    mockScopes = ['sites:read']
    const { status, body } = await get('/sites/host_1/orders')
    expect(status).toBe(403)
    expect(body.error.type).toBe('insufficient_scope')
    expect(body.error.code).toBe('orders:read')
  })

  it('refuses an org whose plan no longer includes commerce', async () => {
    // RED CHECK: drop the `requireCommerce(ctx)` call and this returns 200.
    // The org still has `apiAccess` and the key still has the scope — the
    // only thing that changed is the plan, which is exactly the AGL-1873
    // downgrade case the console's money doors missed.
    mockEntitlements = { apiAccess: true, commerce: false }
    const { status, body } = await get('/sites/host_1/orders')
    expect(status).toBe(403)
    expect(body.error.type).toBe('plan_required')
    expect(body.error.code).toBe('commerce')
  })

  it('publishes one totals shape — a legacy order is lifted, not left bare', async () => {
    // RED CHECK: remove the `legacyTotal` fallback in `orderView` and
    // `ord_legacy.totals.totalCents` comes back `null` while the response is
    // still a well-formed 200 — an accounting sync that silently books a
    // $25 order as zero.
    const { status, body } = await get('/sites/host_1/orders')
    expect(status).toBe(200)
    const byId = Object.fromEntries(
      body.data.map((order: { id: string }) => [order.id, order]),
    )
    expect(byId.ord_legacy.totals.totalCents).toBe(2500)
    expect(byId.ord_legacy.totals.feeCents).toBe(50)
    expect(byId.ord_modern.totals.totalCents).toBe(1083)
    // The fee is Aglyn's cut of a total the shopper paid in full. It must not
    // have been netted out of the total by the serializer.
    expect(byId.ord_modern.totals.totalCents).toBe(
      byId.ord_modern.totals.itemsCents +
        byId.ord_modern.totals.shippingCents +
        byId.ord_modern.totals.taxCents -
        byId.ord_modern.totals.discountCents,
    )
  })

  it('reports a missing channel as online rather than as unknown', async () => {
    const { body } = await get('/sites/host_1/orders')
    const legacy = body.data.find((o: { id: string }) => o.id === 'ord_legacy')
    expect(legacy.channel).toBe('online')
  })

  it('channel=online still finds orders written before the field existed', async () => {
    // RED CHECK: change the handler's `if (channel && channel !== 'online')`
    // to a plain `if (channel)` — pushing `online` into the Firestore
    // predicate — and this returns an EMPTY list with a 200. The oldest
    // orders are precisely what a first backfill reaches for, so the failure
    // lands on the request most likely to be someone's first.
    const { status, body } = await get('/sites/host_1/orders?channel=online')
    expect(status).toBe(200)
    expect(body.data.map((o: { id: string }) => o.id)).toEqual(['ord_legacy'])
  })

  it('channel=pos filters through the store', async () => {
    const { body } = await get('/sites/host_1/orders?channel=pos')
    expect(body.data.map((o: { id: string }) => o.id)).toEqual(['ord_modern'])
  })

  it('404s an unowned site before it reads any order', async () => {
    const { status, body } = await get('/sites/host_other/orders')
    expect(status).toBe(404)
    expect(body.error.message).toBe('No such site')
  })
})

describe('GET /v1/sites/{id}/products', () => {
  beforeEach(() => {
    mockDocs.set('hosts/host_1/products/p_tracked', {
      name: 'Sourdough',
      status: 'active',
      variants: [
        { id: 'v1', sku: 'SD-S', priceUsd: 6, inventory: 4 },
        { id: 'v2', sku: 'SD-L', priceUsd: 9, inventory: 0 },
      ],
    })
    mockDocs.set('hosts/host_1/products/p_untracked', {
      name: 'Consulting hour',
      status: 'active',
      variants: [{ id: 'v1', priceUsd: 120, inventory: null }],
    })
    mockDocs.set('hosts/host_1/products/p_deleted', {
      name: 'Discontinued',
      status: 'active',
      deletedAt: 1_760_000_000_000,
      variants: [],
    })
  })

  it('keeps untracked stock distinct from sold out', async () => {
    // RED CHECK: write `inventory: Number(variant.inventory ?? 0)` in
    // `variantView` — the obvious defensive default — and the consulting
    // hour reads `0`. Every downstream "hide out-of-stock" rule then hides a
    // product that has unlimited availability, and the response is a 200
    // throughout.
    const { body } = await get('/sites/host_1/products')
    const byId = Object.fromEntries(
      body.data.map((p: { id: string }) => [p.id, p]),
    )
    expect(byId.p_untracked.variants[0].inventory).toBeNull()
    expect(byId.p_untracked.variants[0].inventoryTracked).toBe(false)
    expect(byId.p_untracked.inventory).toBeNull()
    // Sold out is a real zero, and must survive as one.
    expect(byId.p_tracked.variants[1].inventory).toBe(0)
    expect(byId.p_tracked.variants[1].inventoryTracked).toBe(true)
    expect(byId.p_tracked.inventory).toBe(4)
  })

  it('never hands back a product the merchant deleted', async () => {
    // RED CHECK: drop the `deletedAt` filter and `p_deleted` appears in the
    // list and answers 200 on retrieve — a deleted product resurrected into
    // someone's storefront feed.
    const { body } = await get('/sites/host_1/products')
    expect(body.data.map((p: { id: string }) => p.id)).toEqual([
      'p_tracked',
      'p_untracked',
    ])
    const single = await get('/sites/host_1/products/p_deleted')
    expect(single.status).toBe(404)
    expect(single.body.error.message).toBe('No such product')
  })

  it('requires products:read specifically, not sites:read', async () => {
    mockScopes = ['sites:read', 'orders:read']
    const { status, body } = await get('/sites/host_1/products')
    expect(status).toBe(403)
    expect(body.error.code).toBe('products:read')
  })
})

describe('GET /v1/media', () => {
  beforeEach(() => {
    mockDocs.set('orgs/org-1/media/m_public', {
      fileName: 'hero.png',
      contentType: 'image/png',
      sizeBytes: 40_000,
      width: 1200,
      height: 630,
      folderId: 'fold_1',
      url: 'https://storage.example/hero.png?token=abc',
      cdnPath: '/api/media/cdn/org:org-1/m_public',
    })
    mockDocs.set('orgs/org-1/media/m_private', {
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: 8_000,
      private: true,
      url: 'https://storage.example/contract.pdf?token=def',
    })
    mockDocs.set('orgs/org-1/media/m_deleted', {
      fileName: 'old.png',
      deletedAt: 1_760_000_000_000,
      url: 'https://storage.example/old.png',
    })
    mockDocs.set('hosts/host_1/media/m_site', {
      fileName: 'about.jpg',
      url: 'https://storage.example/about.jpg',
    })
  })

  it('serves the organization library and omits soft-deleted files', async () => {
    const { status, body } = await get('/media')
    expect(status).toBe(200)
    expect(body.data.map((m: { id: string }) => m.id)).toEqual([
      'm_private',
      'm_public',
    ])
  })

  it('publishes the CDN url separately, and never invents one', async () => {
    // RED CHECK: fall `cdnUrl` back to `data.url` and a private PDF grows a
    // link the caller will treat as publicly embeddable. `cdnPath` is absent
    // for private assets and for plans without `mediaCdn`, and that absence
    // is the signal.
    const { body } = await get('/media')
    const byId = Object.fromEntries(
      body.data.map((m: { id: string }) => [m.id, m]),
    )
    expect(byId.m_public.cdnUrl).toBe(
      'https://app.aglyn.com/api/media/cdn/org:org-1/m_public',
    )
    expect(byId.m_private.cdnUrl).toBeNull()
    expect(byId.m_private.private).toBe(true)
  })

  it('serves a site library at the site path, distinct from the org one', async () => {
    const { body } = await get('/sites/host_1/media')
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['m_site'])
  })

  it('retrieves one file by id', async () => {
    const { status, body } = await get('/media/m_public')
    expect(status).toBe(200)
    expect(body.object).toBe('media')
    expect(body.fileName).toBe('hero.png')
  })

  it('does not require the commerce entitlement', async () => {
    // Media is not a commerce resource. A store-less org must still be able
    // to read its own asset library.
    mockEntitlements = { apiAccess: true, commerce: false }
    const { status } = await get('/media')
    expect(status).toBe(200)
  })
})
