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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { draftOrderHandler } from './draft-order'

/**
 * Shipping reaches the draft-order payment link (AGL-1792).
 *
 * AGL-1707 wired the merchant's zones and rates into cart checkout and AGL-1720
 * into buy-now; `draft-order.ts` contained no `shipping` string at all. So a
 * merchant who configured a $7.99 rate collected it when the buyer used the
 * storefront and collected nothing when the SAME merchant invoiced the SAME
 * buyer for the SAME parcel through a payment link — and the session collected
 * no address either, so they were not even told where to send it.
 *
 * The resolver is not re-implemented here; this file proves the draft handler
 * calls `planCheckoutShipping` and that the two things peculiar to this path
 * hold: physical products only, and a refusal that leaves NO order document
 * behind. The draft handler writes its order before it talks to Stripe, so a
 * refusal placed after that write would strand a `pending` order on the
 * merchant's list for every attempt — the same shape as the orphaned coupon
 * AGL-1721 avoided in the cart.
 *
 * Stripe is mocked absolutely, as in `checkout-shipping.spec.ts`: localhost
 * carries the LIVE secret key, so nothing here may reach api.stripe.com. The
 * assertions read the form body the handler built, which is the artefact that
 * decides whether shipping is charged.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** Direct children of `path` — a collection `get()` must not return grandchildren. */
function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    // Firestore's `merge` keeps the fields it is not given; a plain `set`
    // replaces the document. Modelling only one of the two would let a test
    // pass against a handler that used the wrong one.
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
}

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => fakeFirestore,
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'mgr-1', email: 'mgr@acme.test' }),
      }),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<server-timestamp>' },
    },
  },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — captured, never reached
// ---------------------------------------------------------------------------

let sessionBody: URLSearchParams | null = null

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (target.endsWith('/v1/checkout/sessions')) {
    sessionBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/pay/cs_test_1',
      }),
    }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  } as PluginApiResponse
  return { res, result }
}

interface Scenario {
  /** `hosts/host-1/settings/store`, or omitted for a merchant with no doc. */
  settings?: Record<string, any> | null
  /** Merged over the seeded product doc. */
  product?: Record<string, any>
  quantity?: number
  /** What the merchant declared, exactly as it arrives over the wire. */
  shippingCountry?: unknown
}

/** Seeds a host whose manager can invoice one 400g $30 physical product. */
async function runDraft(scenario: Scenario = {}) {
  docs.clear()
  autoIdCounter = 0
  docs.set('hosts/host-1', {
    name: 'Acme',
    memberRoles: { 'mgr-1': 'manager' },
  })
  docs.set('hostIndex/host-1', { subdomain: 'acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'v1', priceUsd: 30, weightGrams: 400, inventory: 100 }],
    ...(scenario.product ?? {}),
  })
  // AGL-1999: every scenario in this suite is about SHIPPING, so the store
  // states a tax decision it would otherwise leave unmade — an undecided
  // store refuses the sale before shipping is ever resolved. A scenario that
  // supplies its own `tax` wins.
  docs.set('hosts/host-1/settings/store', {
    tax: { mode: 'none' },
    ...(scenario.settings ?? {}),
  })
  sessionBody = null
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: {
      hostId: 'host-1',
      productId: 'p1',
      variantId: 'v1',
      quantity: scenario.quantity ?? 1,
      email: 'buyer@example.com',
      ...('shippingCountry' in scenario
        ? { shippingCountry: scenario.shippingCountry }
        : {}),
    },
    cookies: {},
    headers: {
      host: 'console.example.com',
      authorization: 'Bearer id-token',
    },
    query: {},
  } as unknown as PluginApiRequest
  await draftOrderHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

/** Every `shipping_options[n]` in the emitted form body, in index order. */
function shippingOptions(body: URLSearchParams | null) {
  if (!body) return []
  const out: {
    name: string
    amount: string
    currency: string
    type: string
  }[] = []
  for (
    let index = 0;
    body.has(`shipping_options[${index}][shipping_rate_data][display_name]`);
    index += 1
  ) {
    const field = `shipping_options[${index}][shipping_rate_data]`
    out.push({
      name: String(body.get(`${field}[display_name]`)),
      amount: String(body.get(`${field}[fixed_amount][amount]`)),
      currency: String(body.get(`${field}[fixed_amount][currency]`)),
      type: String(body.get(`${field}[type]`)),
    })
  }
  return out
}

/** Every shipping-related key the handler emitted. */
function shippingKeys(body: URLSearchParams | null) {
  return [...(body?.keys() ?? [])].filter((key) => key.includes('shipping'))
}

/** The countries the session will accept an address in, in emitted order. */
function allowedCountries(body: URLSearchParams | null) {
  const out: string[] = []
  for (
    let index = 0;
    body?.has(`shipping_address_collection[allowed_countries][${index}]`);
    index += 1
  ) {
    out.push(
      String(
        body.get(`shipping_address_collection[allowed_countries][${index}]`),
      ),
    )
  }
  return out
}

/** The order documents this attempt left behind. */
function writtenOrders() {
  return childPaths('hosts/host-1/orders').map(
    (path) => docs.get(path) as Record<string, any>,
  )
}

const shipping = {
  zones: [
    { id: 'us', name: 'United States', countries: ['US'] },
    { id: 'world', name: 'Everywhere else', countries: ['*'] },
  ],
  rates: [
    {
      id: 'std',
      zoneId: 'us',
      name: 'Standard',
      kind: 'flat',
      amountCents: 799,
    },
    {
      id: 'intl',
      zoneId: 'world',
      name: 'International',
      kind: 'flat',
      amountCents: 2999,
    },
  ],
}

const byWeight = {
  zones: [{ id: 'all', name: 'Anywhere', countries: ['*'] }],
  rates: [
    {
      id: 'wt',
      zoneId: 'all',
      name: 'By weight',
      kind: 'weight_tiers',
      tiers: [
        { upTo: 500, amountCents: 599 },
        { upTo: 5000, amountCents: 1299 },
      ],
    },
  ],
}

describe('draft-order shipping options (AGL-1792)', () => {
  const realFetch = global.fetch
  const realKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_never_used'
  })

  afterAll(() => {
    global.fetch = realFetch
    process.env.STRIPE_SECRET_KEY = realKey as string
  })

  beforeEach(() => {
    fetchMock.mockClear()
  })

  // The regression that would matter most, pinned first as AGL-1707 and
  // AGL-1720 did: a merchant who never configured shipping must keep charging
  // none, and must not suddenly put an address form in front of their buyer.
  it('emits no shipping key at all for a merchant who configured none', async () => {
    for (const settings of [null, {}, { tax: { mode: 'stripe' } }]) {
      const { result, body } = await runDraft({ settings })
      expect(result.status).toBe(200)
      expect(shippingKeys(body)).toEqual([])
    }
  })

  it('keeps all six countries when one rate serves them all', async () => {
    const { result, body } = await runDraft({
      settings: { shipping: byWeight },
    })
    expect(result.status).toBe(200)
    expect(allowedCountries(body)).toEqual(['US', 'CA', 'GB', 'AU', 'DE', 'FR'])
    expect(shippingOptions(body)).toEqual([
      {
        name: 'By weight',
        amount: '599',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
  })

  it('declares the destination’s rate, and only that destination', async () => {
    const us = await runDraft({ settings: { shipping }, shippingCountry: 'US' })
    expect(us.result.status).toBe(200)
    expect(shippingOptions(us.body)).toEqual([
      {
        name: 'Standard',
        amount: '799',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
    // Stripe charges whichever option is picked and never compares it to the
    // address, so narrowing the countries is the enforcement (AGL-1721).
    expect(allowedCountries(us.body)).toEqual(['US'])

    const fr = await runDraft({ settings: { shipping }, shippingCountry: 'FR' })
    expect(shippingOptions(fr.body)).toEqual([
      {
        name: 'International',
        amount: '2999',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
    expect(allowedCountries(fr.body)).toEqual(['FR'])
  })

  it('refuses a draft whose rates differ by destination, and writes no order', async () => {
    const { result, body } = await runDraft({ settings: { shipping } })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ needsShippingCountry: true })
    expect(body).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    // The peculiar hazard of THIS path: the order document is written before
    // Stripe is called, so a refusal resolved after it would leave a `pending`
    // draft on the merchant's orders list every time they pressed the button.
    expect(writtenOrders()).toEqual([])
  })

  it('refuses a destination this merchant does not serve, and writes no order', async () => {
    const { result, body } = await runDraft({
      settings: {
        shipping: {
          zones: [{ id: 'us', name: 'United States', countries: ['US'] }],
          rates: [
            {
              id: 'std',
              zoneId: 'us',
              name: 'Standard',
              kind: 'flat',
              amountCents: 799,
            },
          ],
        },
      },
      shippingCountry: 'FR',
    })
    expect(result.status).toBe(409)
    expect(String(result.body.error)).toContain('France')
    expect(body).toBeNull()
    expect(writtenOrders()).toEqual([])
  })

  it('ships nothing for a digital or service product', async () => {
    // A merchant invoices downloads and consulting through this dialog too.
    // Asking that buyer for an address, then charging them postage, would be
    // worse than the bug being fixed.
    for (const type of ['digital', 'service']) {
      const { result, body } = await runDraft({
        settings: { shipping },
        product: { type },
      })
      expect(result.status).toBe(200)
      expect(shippingKeys(body)).toEqual([])
    }
  })

  it('treats a product with no type as physical, as the fee ladder does', async () => {
    const { body } = await runDraft({
      settings: { shipping },
      product: { type: undefined },
      shippingCountry: 'US',
    })
    expect(shippingOptions(body).map((option) => option.name)).toEqual([
      'Standard',
    ])
    expect(allowedCountries(body)).toEqual(['US'])
  })

  it('weighs the units invoiced, not one unit', async () => {
    // 3 x 400g = 1200g, past the 500g tier. A handler passing `weightGrams`
    // without the quantity would quote 599 — the same under-collection in
    // miniature, on a path whose whole point is a multi-unit invoice.
    const { body } = await runDraft({
      settings: { shipping: byWeight },
      quantity: 3,
    })
    expect(body?.get('line_items[0][quantity]')).toBe('3')
    expect(shippingOptions(body)).toEqual([
      {
        name: 'By weight',
        amount: '1299',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
  })

  it('prices free_over off the invoiced subtotal', async () => {
    // 2 x $30 = $60, past the $50 threshold, so this order ships free. The
    // storefront resolves against the same figure for the same settings.
    const { body } = await runDraft({
      settings: {
        shipping: {
          zones: [{ id: 'all', name: 'Anywhere', countries: ['*'] }],
          rates: [
            {
              id: 'free50',
              zoneId: 'all',
              name: 'Free over $50',
              kind: 'free_over',
              amountCents: 799,
              freeOverCents: 5000,
            },
          ],
        },
      },
      quantity: 2,
    })
    expect(shippingOptions(body)).toEqual([
      {
        name: 'Free over $50',
        amount: '0',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
  })

  it('leaves the order document and its metadata otherwise unchanged', async () => {
    const { result, body } = await runDraft({
      settings: { shipping },
      shippingCountry: 'US',
      quantity: 2,
    })
    expect(result.status).toBe(200)
    // Shipping is additive: the stored draft is still priced at its items
    // total, and the webhook still finds it by the same metadata.
    const [order] = writtenOrders()
    expect(order.totals).toMatchObject({
      itemsCents: 6000,
      shippingCents: 0,
      totalCents: 6000,
    })
    expect(body?.get('metadata[type]')).toBe('commerce-draft')
    expect(body?.get('metadata[orderId]')).toBe(String(result.body.orderId))
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('3000')
  })
})
