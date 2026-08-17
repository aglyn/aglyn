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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { cartCheckoutHandler } from './cart-checkout'

/**
 * Shipping reaches the Checkout Session (AGL-1707), for the destination it
 * was resolved for and no other (AGL-1721).
 *
 * The model half is specced in `commerce-shipping.spec.ts`; what is proved
 * HERE is the wiring the defect was about — that the merchant's saved
 * settings document is actually read and actually lands on the session as
 * `shipping_options`. A model that resolves rates nobody sends is exactly the
 * state this issue found.
 *
 * AGL-1721 then made the ALLOWED COUNTRIES load-bearing rather than
 * decorative. Stripe offers a session's `shipping_options` to whoever opens
 * it and charges whichever the shopper picks — a `shipping_rate_data` has no
 * country and nothing re-checks one against the address — so the assertions
 * about `shipping_address_collection` below are not cosmetic: they are the
 * only thing stopping a French shopper from paying a US rate. Every test that
 * pins a rate list also pins the countries that list is honest for.
 *
 * Stripe is mocked absolutely, as in `pos-order.spec.ts`: localhost carries
 * the LIVE secret key, so nothing in this file may reach api.stripe.com. The
 * assertions read the form body the handler built, which is the artefact that
 * decides whether shipping is charged.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

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
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    limit: () => ref,
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
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
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
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
  // A real endpoint with a real side effect: every call CREATES a coupon
  // object on the merchant's account. Modelled so the ordering assertion
  // below — that a refused checkout creates none — can be made at all.
  if (target.endsWith('/v1/coupons')) {
    return { ok: true, json: async () => ({ id: 'co_test_1' }) }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

/** Stripe calls the handler made, by endpoint. */
function stripeCalls(endpoint: string) {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).endsWith(endpoint),
  ).length
}

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
  /** What the shopper declared, exactly as it arrives over the wire. */
  shippingCountry?: unknown
  couponCode?: string
  /** Overrides on the single cart product. */
  product?: Record<string, any>
}

function makeRequest(scenario: Scenario): PluginApiRequest {
  return {
    method: 'POST',
    body: {
      hostId: 'host-1',
      ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      ...('shippingCountry' in scenario
        ? { shippingCountry: scenario.shippingCountry }
        : {}),
    },
    cookies: { 'aglyn_cart_host-1': 'cart-1' },
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
}

/** Seeds a host that can sell, with one 800g $60 item in the cart. */
function seedStore(
  storeSettings: Record<string, any> | null,
  scenario: Scenario,
) {
  docs.clear()
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
  })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'v1', priceUsd: 30, weightGrams: 400, inventory: 10 }],
    ...(scenario.product ?? {}),
  })
  if (storeSettings) docs.set('hosts/host-1/settings/store', storeSettings)
  if (scenario.couponCode) {
    docs.set(`hosts/host-1/coupons/${scenario.couponCode}`, {
      percentOff: 50,
      enabled: true,
    })
  }
}

async function runCheckout(
  storeSettings: Record<string, any> | null,
  scenario: Scenario = {},
) {
  seedStore(storeSettings, scenario)
  sessionBody = null
  const { res, result } = makeResponse()
  await cartCheckoutHandler(makeRequest(scenario), res)
  return { result, body: sessionBody as URLSearchParams | null }
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

/** Every `shipping_options[n]` in the emitted form body, in index order. */
function shippingOptions(body: URLSearchParams | null) {
  if (!body) return []
  const out: { name: string; amount: string; currency: string; type: string }[] =
    []
  for (let index = 0; body.has(`shipping_options[${index}][shipping_rate_data][display_name]`); index += 1) {
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

const shipping = {
  zones: [
    { id: 'us', name: 'United States', countries: ['US'] },
    { id: 'world', name: 'Everywhere else', countries: ['*'] },
  ],
  rates: [
    { id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 },
    {
      id: 'intl',
      zoneId: 'world',
      name: 'International',
      kind: 'flat',
      amountCents: 2999,
    },
  ],
}

describe('cart checkout shipping options (AGL-1707)', () => {
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

  it('declares the destination’s rate, and only that destination (AGL-1721)', async () => {
    // The canonical shape from the issue: a US zone at $7.99 and a
    // rest-of-world zone at $29.99. Before this, BOTH were declared on one
    // session that accepted an address in any of six countries, so a shopper
    // in France picked $7.99 and the merchant paid the difference.
    const us = await runCheckout({ shipping }, { shippingCountry: 'US' })
    expect(us.result.status).toBe(200)
    expect(shippingOptions(us.body)).toEqual([
      {
        name: 'Standard',
        amount: '799',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
    // THE ENFORCING HALF. Filtering the rate list alone would leave a session
    // still willing to ship a $7.99 parcel to France.
    expect(allowedCountries(us.body)).toEqual(['US'])

    const fr = await runCheckout({ shipping }, { shippingCountry: 'FR' })
    expect(fr.result.status).toBe(200)
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

  it('refuses to price a cart whose rates differ by destination', async () => {
    const { result, body } = await runCheckout({ shipping })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ needsShippingCountry: true })
    expect(result.body.shippingCountries).toEqual([
      'US',
      'CA',
      'GB',
      'AU',
      'DE',
      'FR',
    ])
    // No session at all — not a session with the union on it.
    expect(body).toBeNull()
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
  })

  it('refuses a country it cannot collect an address for, rather than serving one', async () => {
    // The forgery shape. A crafted body naming something outside the
    // collectable list must not fall through to the old union — which is what
    // a handler that only narrowed WHEN IT RECOGNISED the country would do.
    for (const shippingCountry of ['JP', '', 'us; DROP', null, 42, ['US']]) {
      const { result, body } = await runCheckout(
        { shipping },
        { shippingCountry },
      )
      expect(result.status).toBe(400)
      expect(result.body).toMatchObject({ needsShippingCountry: true })
      expect(body).toBeNull()
    }
    // …and the lower-case spelling of a real one is accepted, not refused.
    const { result } = await runCheckout(
      { shipping },
      { shippingCountry: ' us ' },
    )
    expect(result.status).toBe(200)
  })

  it('refuses a destination the merchant ships nowhere near', async () => {
    // A US-only merchant with no rest-of-world zone. Charging this shopper
    // nothing is the AGL-1707 defect; charging them the US rate is AGL-1721.
    // Saying so is the only honest third answer.
    const usOnly = {
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
    }
    const { result, body } = await runCheckout(
      { shipping: usOnly },
      { shippingCountry: 'FR' },
    )
    expect(result.status).toBe(409)
    expect(String(result.body.error)).toContain('France')
    expect(body).toBeNull()
  })

  it('creates no Stripe coupon on a refused checkout', async () => {
    // Ordering, not decoration: the discount block POSTs a real coupon object
    // to the merchant's account. Refusing after it would orphan one on every
    // attempt, and a shopper answering the destination prompt makes two.
    const { result } = await runCheckout({ shipping }, { couponCode: 'HALF' })
    expect(result.status).toBe(400)
    expect(stripeCalls('/v1/coupons')).toBe(0)
  })

  it('never asks a cart that ships nothing', async () => {
    // A cart of downloads must not be asked which country to post them to —
    // and must not be charged to ship them either.
    const { result, body } = await runCheckout(
      { shipping },
      { product: { type: 'digital' } },
    )
    expect(result.status).toBe(200)
    expect(shippingOptions(body)).toEqual([])
    expect(allowedCountries(body)).toEqual(['US', 'CA', 'GB', 'AU', 'DE', 'FR'])
  })

  it('declares none for a merchant who configured no shipping', async () => {
    // The regression that would matter most: a merchant who never set
    // shipping up must keep charging none. Both an absent settings doc and a
    // doc that carries only tax.
    for (const settings of [null, { tax: { mode: 'stripe' } }]) {
      const { result, body } = await runCheckout(settings)
      expect(result.status).toBe(200)
      expect(shippingOptions(body)).toEqual([])
      expect([...(body as URLSearchParams).keys()]).not.toContainEqual(
        expect.stringContaining('shipping_options'),
      )
    }
  })

  it('keeps all six collectable countries when one rate serves them all', async () => {
    // The configuration AGL-1721 calls invisible, and the one that must not
    // regress: a single '*' zone resolves the same everywhere, so the union
    // IS exact, no destination is needed, and the session is the one AGL-1707
    // shipped. A fix that asked every shopper regardless would fail here.
    const { result, body } = await runCheckout({
      shipping: {
        zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
        rates: [
          {
            id: 'flat',
            zoneId: 'world',
            name: 'Standard',
            kind: 'flat',
            amountCents: 500,
          },
        ],
      },
      tax: { mode: 'stripe' },
    })
    expect(result.status).toBe(200)
    expect(allowedCountries(body)).toEqual(['US', 'CA', 'GB', 'AU', 'DE', 'FR'])
    expect(shippingOptions(body).map((option) => option.amount)).toEqual([
      '500',
    ])
    expect(body?.get('automatic_tax[enabled]')).toBe('true')
  })

  it('collects an address everywhere for a merchant who charges no shipping', async () => {
    // Address collection predates shipping on this path — it feeds the order
    // record and destination tax — so narrowing it is reserved for sessions
    // where a rate depends on it. A store that charges none keeps all six.
    const { result, body } = await runCheckout(null, {
      shippingCountry: 'US',
    })
    expect(result.status).toBe(200)
    expect(allowedCountries(body)).toEqual(['US', 'CA', 'GB', 'AU', 'DE', 'FR'])
  })

  it('prices a weight-tiered rate off the cart’s real weight', async () => {
    // 2 x 400g = 800g, which is past the 500g tier. A handler that never
    // summed variant weight would quote the 599 tier here.
    const { body } = await runCheckout({
      shipping: {
        zones: [{ id: 'us', name: 'US', countries: ['*'] }],
        rates: [
          {
            id: 'wt',
            zoneId: 'us',
            name: 'By weight',
            kind: 'weight_tiers',
            tiers: [
              { upTo: 500, amountCents: 599 },
              { upTo: 2000, amountCents: 1299 },
            ],
          },
        ],
      },
    })
    expect(shippingOptions(body)).toEqual([
      { name: 'By weight', amount: '1299', currency: 'usd', type: 'fixed_amount' },
    ])
  })

  it('prices free_over off the pre-discount cart subtotal', async () => {
    // 2 x $30 = $60, past a $50 threshold, so the rate resolves to free
    // rather than being omitted.
    const { body } = await runCheckout({
      shipping: {
        zones: [{ id: 'us', name: 'US', countries: ['*'] }],
        rates: [
          {
            id: 'free50',
            zoneId: 'us',
            name: 'Free over $50',
            kind: 'free_over',
            amountCents: 799,
            freeOverCents: 5000,
          },
        ],
      },
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
})
