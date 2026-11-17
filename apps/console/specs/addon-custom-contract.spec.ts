/**
 * @jest-environment node
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
 * A Custom contract's self-serve additions (AGL-4233).
 *
 * A Custom deal with a rate card sells its additions at the contract's rates
 * on per-workspace prices, as items on the deal's own subscription: a card
 * deal is charged now and granted once paid, an invoice deal is prorated onto
 * its next invoice and granted now. A Custom deal WITHOUT a rate card sells
 * nothing, exactly as before, and a purchase that would take the contract
 * under its quote floor is held for staff.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out.
 */

export {}

const ORG_ID = 'org-custom'

let stripeCalls: Array<{ href: string; method: string; body: string }> = []
let mockOrgMirrorWrites: any[] = []
let mockAlerts: Array<{ type: string; options: any }> = []
/** The org document. */
let mockOrgDoc: Record<string, unknown>
/** The billing document: the negotiated base lives here. */
let mockBillingDoc: Record<string, unknown>
/** How the deal is collected. */
let collectionMethod: 'charge_automatically' | 'send_invoice'
/** Prices already minted, by lookup key. */
let mintedPrices: Record<string, string>

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              data: () => mockOrgDoc,
              ref: {
                set: async (value: unknown) => {
                  mockOrgMirrorWrites.push(value)
                },
              },
            }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => mockBillingDoc,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async () => true,
}))

jest.mock('../utils/server/operator-alerts-seam', () => ({
  __esModule: true,
  raiseOperatorAlert: async (type: string, options: unknown) => {
    mockAlerts.push({ type, options })
    return { raised: true }
  },
}))

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  runPluginEventHandlers: async () => undefined,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
      delete clean[key]
    }
  }
  return clean
})()

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch

/** The deal's ad-hoc base price, the only item a provisioned deal carries. */
const BASE_ITEM = {
  id: 'si_base',
  quantity: 1,
  price: {
    id: 'price_enterprise_adhoc',
    unit_amount: 500000,
    recurring: { interval: 'month' },
    metadata: { custom: 'true', plan: 'enterprise', orgId: ORG_ID },
  },
}

/** A live Custom workspace: Custom plan on the org doc, the base on billing. */
function customOrg(contract?: Record<string, unknown>) {
  mockOrgDoc = {
    plan: 'enterprise',
    billingStatus: 'active',
    displayName: 'Contract Co',
    ...(contract ? { entitlements: { contract } } : {}),
  }
}

function loadAddons() {
  jest.resetModules()
  process.env = {
    ...CLEAN_ENV,
    STRIPE_SECRET_KEY: 'sk_test_fake',
  } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(
  post: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, ...body }),
    }),
  )
}

const posts = (fragment: string) =>
  stripeCalls
    .filter((c) => c.method === 'POST' && c.href.includes(fragment))
    .map((c) => new URLSearchParams(c.body))

beforeEach(() => {
  stripeCalls = []
  mockOrgMirrorWrites = []
  mockAlerts = []
  mintedPrices = {}
  collectionMethod = 'charge_automatically'
  mockBillingDoc = {
    stripeCustomerId: 'cus_test_custom',
    subscription: { status: 'active', interval: 'month', customMonthlyUsd: 50_000 },
  }
  customOrg({ usageCeilingMonthlyUsd: 500 })
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    const body = new URLSearchParams(String(init?.body ?? ''))
    stripeCalls.push({ href, method, body: String(init?.body ?? '') })
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            currency: 'usd',
            collection_method: collectionMethod,
            current_period_end: 1767225600,
            automatic_tax: { enabled: true },
            metadata: { plan: 'enterprise', orgId: ORG_ID, custom: 'true' },
            items: { data: [BASE_ITEM] },
          },
        ],
      }
    } else if (href.includes('/prices?') && method === 'GET') {
      const key = decodeURIComponent(href.split('lookup_keys[]=')[1] ?? '')
      payload = { data: mintedPrices[key] ? [{ id: mintedPrices[key] }] : [] }
    } else if (href.includes('/products/search')) {
      payload = { data: [{ id: 'prod_enterprise_contract_co' }] }
    } else if (href.endsWith('/v1/prices') && method === 'POST') {
      const id = `price_contract_${body.get('metadata[aglynAddonKind]')}`
      mintedPrices[String(body.get('lookup_key'))] = id
      payload = { id }
    } else if (href.includes('/invoices/upcoming')) {
      payload = {
        currency: 'usd',
        amount_due: 999_00,
        tax: 0,
        lines: { data: [{ proration: true, amount: 1000 }] },
      }
    } else if (href.includes('/subscriptions/sub_1') && method === 'POST') {
      const price = body.get('items[0][price]')
      const kind = String(price ?? '').replace('price_contract_', '')
      payload = {
        id: 'sub_1',
        status: 'active',
        pending_update: null,
        items: {
          data: [
            BASE_ITEM,
            {
              id: 'si_contract',
              quantity: Number(body.get('items[0][quantity]')),
              price: { id: price, metadata: { aglynAddonKind: kind } },
            },
          ],
        },
        latest_invoice: {
          status: 'paid',
          amount_due: 1000,
          currency: 'usd',
          payment_intent: { status: 'succeeded' },
        },
      }
    } else {
      throw new Error(`unexpected fetch: ${method} ${href}`)
    }
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

describe('a Custom contract sells its additions at its own rates (AGL-4233)', () => {
  it('the catalog quotes the Pro rates by default and a negotiated rate where set', async () => {
    customOrg({ rates: { extraSeatMonthlyUsd: 3 }, usageCeilingMonthlyUsd: 500 })
    const post = loadAddons()
    const payload = await (await call(post, { action: 'get' })).json()
    expect(payload.catalog.hosts).toMatchObject({ unitUsd: 20, upgradeRequired: false, configured: true })
    expect(payload.catalog.managers).toMatchObject({ unitUsd: 3, upgradeRequired: false })
    expect(payload.catalog.members.unitUsd).toBe(2)
    expect(payload.catalog.posRegisters.unitUsd).toBe(89)
    expect(payload.catalog.aiAddon).toMatchObject({ unitUsd: 10, max: 30, credits: 5000 })
    // Site Care is named in a Custom agreement itself, never sold here; the
    // flat Event Calendar sells at its catalog price, as it did before.
    expect(payload.catalog.siteCare.upgradeRequired).toBe(true)
    expect(payload.catalog.eventCalendar.unitUsd).toBe(9)
    expect(payload.contract).toEqual({ billsOnNextInvoice: false })
  })

  it('a CARD deal is charged now and granted once paid, on a per-workspace price', async () => {
    const post = loadAddons()
    const response = await call(post, { action: 'set', kind: 'hosts', quantity: 2 })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.quantities.hosts).toBe(2)

    const [price] = posts('/v1/prices')
    expect(price.get('product')).toBe('prod_enterprise_contract_co')
    expect(price.get('unit_amount')).toBe('2000')
    expect(price.get('recurring[interval]')).toBe('month')
    expect(price.get('lookup_key')).toBe(`aglyn_contract_${ORG_ID}_hosts_month_2000`)
    expect(price.get('metadata[aglynAddonKind]')).toBe('hosts')

    const [update] = posts('/subscriptions/sub_1')
    expect(update.get('items[0][price]')).toBe('price_contract_hosts')
    expect(update.get('items[0][quantity]')).toBe('2')
    expect(update.get('proration_behavior')).toBe('always_invoice')
    expect(update.get('payment_behavior')).toBe('pending_if_incomplete')
    expect(mockOrgMirrorWrites).toEqual([
      expect.objectContaining({ seatAddons: expect.objectContaining({ hosts: 2 }) }),
    ])
  })

  it('an INVOICE deal puts the addition on the next invoice and grants it now', async () => {
    collectionMethod = 'send_invoice'
    const post = loadAddons()

    const preview = await (
      await call(post, { action: 'preview', kind: 'managers', quantity: 3 })
    ).json()
    expect(preview).toMatchObject({
      onNextInvoice: true,
      chargedNowCents: 0,
      nextInvoiceCents: 1000,
    })
    const previewCall = stripeCalls.find((c) => c.href.includes('/invoices/upcoming'))
    expect(previewCall?.href).toContain('subscription_proration_behavior=create_prorations')

    const payload = await (
      await call(post, { action: 'set', kind: 'managers', quantity: 3 })
    ).json()
    expect(payload).toMatchObject({ ok: true, onNextInvoice: true, chargedNowCents: 0 })
    const [update] = posts('/subscriptions/sub_1')
    expect(update.get('proration_behavior')).toBe('create_prorations')
    expect(update.has('payment_behavior')).toBe(false)
    expect(mockOrgMirrorWrites.at(-1)).toEqual(
      expect.objectContaining({ seatAddons: expect.objectContaining({ managers: 3 }) }),
    )
  })

  it('a price already minted is found by its lookup key and not minted again', async () => {
    mintedPrices[`aglyn_contract_${ORG_ID}_datasets_month_200`] = 'price_contract_datasets'
    const post = loadAddons()
    expect((await call(post, { action: 'set', kind: 'datasets', quantity: 4 })).status).toBe(200)
    expect(posts('/v1/prices')).toHaveLength(0)
    expect(posts('/subscriptions/sub_1')[0].get('items[0][price]')).toBe('price_contract_datasets')
  })

  it('an addition that takes the contract under its quote floor is HELD for staff, nothing charged', async () => {
    mockBillingDoc = {
      ...mockBillingDoc,
      subscription: { status: 'active', interval: 'month', customMonthlyUsd: 10 },
    }
    const post = loadAddons()
    const response = await call(post, { action: 'set', kind: 'hosts', quantity: 5 })
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.code).toBe('contract_review')
    expect(posts('/subscriptions/sub_1')).toHaveLength(0)
    expect(mockOrgMirrorWrites).toEqual([])
    expect(mockAlerts).toEqual([
      expect.objectContaining({
        type: 'billing.contractAdditionHeld',
        options: expect.objectContaining({ dedupeKey: `${ORG_ID}:hosts:5` }),
      }),
    ])
  })
})

describe('a Custom deal WITHOUT a rate card is unchanged (AGL-4233)', () => {
  it('sells no contract kind, and a purchase is refused before Stripe is asked for a price', async () => {
    customOrg()
    const post = loadAddons()
    const payload = await (await call(post, { action: 'get' })).json()
    for (const kind of ['hosts', 'managers', 'members', 'datasets', 'aiAddon', 'siteCare']) {
      expect(payload.catalog[kind].upgradeRequired).toBe(true)
    }
    expect(payload.contract).toBeUndefined()
    const response = await call(post, { action: 'set', kind: 'hosts', quantity: 1 })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('upgrade_required')
    expect(stripeCalls.filter((c) => c.href.includes('/prices'))).toHaveLength(0)
    expect(posts('/subscriptions/sub_1')).toHaveLength(0)
  })
})
