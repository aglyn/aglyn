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
import { resetFxRatesCache } from './currency'

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
    delete: async () => {
      docs.delete(path)
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

/**
 * A transaction, because the code under test now uses one (AGL-2356).
 *
 * Checkout reserves the units it is about to sell inside a Firestore
 * transaction, so a double without `runTransaction` is not a Firestore and this
 * file's handler fails before it reaches anything this file is about. Reads and
 * writes go through the same doc refs as everything else here, and writes are
 * applied on commit.
 *
 * NO VERSIONING and no retry: nothing in this file tests contention, and a fake
 * that pretended to model it would be decoration. The contention is proved in
 * `stock-hold-race.spec.ts`, which versions every document and re-runs a
 * callback whose read went stale.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<() => Promise<void>> = []
  const result = await body({
    get: async (ref: any) => ref.get(),
    set: (ref: any, value: any, options?: any) => {
      writes.push(() => ref.set(value, options))
    },
    update: (ref: any, value: any) => {
      writes.push(() => ref.set(value, { merge: true }))
    },
    create: (ref: any, value: any) => {
      writes.push(() => ref.set(value))
    },
  })
  for (const write of writes) await write()
  return result
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'pro',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — captured, never reached
// ---------------------------------------------------------------------------

let sessionBody: URLSearchParams | null = null

/** `amount_off` on every coupon the handler minted, in call order. */
const couponAmounts: string[] = []
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
    // The MONEY on a discount: `amount_off` is what Stripe takes off the
    // session, so it is the assertion surface for any pricing question.
    couponAmounts.push(
      String(new URLSearchParams(String(init?.body ?? '')).get('amount_off')),
    )
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
  /**
   * `hosts/{hostId}/discounts` docs. When present the legacy AGL-96 coupon is
   * NOT seeded, so a scenario testing a discount cannot accidentally be
   * carried by a 50%-off coupon of the same code if the discount fails to
   * resolve — which would hide the very failure under test.
   */
  discounts?: Array<Record<string, any> & { id: string }>
  /**
   * A SECOND product in the cart, so a scoped discount has something to NOT
   * cover. With one product the scoped and unscoped answers coincide and the
   * assertion proves nothing.
   */
  extraProduct?: { id: string; priceUsd: number; quantity: number }
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
  // AGL-1999: every scenario in this suite is about SHIPPING, so the store
  // states a tax decision it would otherwise leave unmade — an undecided
  // store refuses the sale before shipping is ever resolved. A scenario that
  // supplies its own `tax` wins.
  docs.set('hosts/host-1/settings/store', {
    tax: { mode: 'none' },
    ...(storeSettings ?? {}),
  })
  if (scenario.extraProduct) {
    const extra = scenario.extraProduct
    const cart = docs.get('hosts/host-1/carts/cart-1') as any
    cart.lines = [
      ...cart.lines,
      { productId: extra.id, variantId: `${extra.id}-v1`, quantity: extra.quantity },
    ]
    docs.set(`hosts/host-1/products/${extra.id}`, {
      name: extra.id,
      status: 'active',
      type: 'physical',
      variants: [
        { id: `${extra.id}-v1`, priceUsd: extra.priceUsd, weightGrams: 10, inventory: 10 },
      ],
    })
  }
  for (const discount of scenario.discounts ?? []) {
    const { id, ...fields } = discount
    docs.set(`hosts/host-1/discounts/${id}`, fields)
  }
  if (scenario.couponCode && !scenario.discounts) {
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

/** Per 1 EUR: 1 USD = 1.7 NZD. */
const fxRates = {
  base: 'EUR',
  rates: { USD: 1.05, NZD: 1.785, GBP: 0.84 },
  asOfMs: Date.now() - 3_600_000,
}

const currencies = {
  enabled: true,
  currencies: [
    { code: 'NZD', rounding: 'whole' },
    { code: 'GBP', rounding: '99', pricesIncludeTax: true },
  ],
}

const nzShipping = {
  zones: [{ id: 'anz', name: 'Australia & NZ', countries: ['NZ', 'AU'] }],
  rates: [
    {
      id: 'intl',
      zoneId: 'anz',
      name: 'International',
      kind: 'free_over',
      amountCents: 2500,
      freeOverCents: 15000,
      amountsByCurrency: { NZD: 3900 },
      freeOverByCurrency: { NZD: 25000 },
    },
  ],
}

async function runIn(
  currency: string | undefined,
  storeSettings: Record<string, any>,
  scenario: Scenario = {},
  profile: Record<string, any> = { stripeChargeModel: 'direct' },
) {
  seedStore(storeSettings, scenario)
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
    ...profile,
  })
  docs.set('platform/fxRates', fxRates)
  resetFxRatesCache()
  sessionBody = null
  const request = makeRequest(scenario)
  if (currency) (request.body as Record<string, unknown>).currency = currency
  const { res, result } = makeResponse()
  await cartCheckoutHandler(request, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

describe('cart checkout in the shopper currency (AGL-4248)', () => {
  const realFetch = global.fetch
  const realKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_never_used'
  })
  afterAll(() => {
    global.fetch = realFetch
    process.env.STRIPE_SECRET_KEY = realKey
  })
  beforeEach(() => {
    fetchMock.mockClear()
    couponAmounts.length = 0
  })

  it('charges a New Zealand shopper in NZD, at the converted and rounded price', async () => {
    const { result, body } = await runIn('NZD', { currencies })
    expect(result.status).toBe(200)
    // $30 → NZ$51.00 exactly, whole-number rounding keeps it.
    expect(body?.get('line_items[0][price_data][currency]')).toBe('nzd')
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('5100')
    expect(body?.get('metadata[currency]')).toBe('nzd')
    expect(body?.get('metadata[baseCurrency]')).toBe('usd')
    expect(Number(body?.get('metadata[fxRate]'))).toBeCloseTo(1.7, 6)
    expect(body?.get('metadata[chargeUnits0]')).toBe('5100')
    // The order's figures arrive in NZD; the take is recorded there too.
    expect(body?.has('metadata[chargeFeeCents]')).toBe(true)
  })

  it('uses a fixed NZ$ price where the variant has one', async () => {
    const { body } = await runIn('NZD', { currencies }, {
      product: { variants: [{ id: 'v1', priceUsd: 30, fixedPrices: { NZD: 49 }, weightGrams: 400, inventory: 10 }] },
    })
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('4900')
  })

  it('prices shipping with its own NZ$ amount and NZ$ free-over threshold', async () => {
    // 2 × NZ$51 = NZ$102: under the NZ$250 threshold, so the NZ$39 rate applies.
    const { body } = await runIn('NZD', { currencies, shipping: nzShipping }, { shippingCountry: 'NZ' })
    expect(shippingOptions(body)).toEqual([
      { name: 'International', amount: '3900', currency: 'nzd', type: 'fixed_amount' },
    ])
    expect(allowedCountries(body)).toEqual(['NZ'])
  })

  it('marks prices tax-inclusive for a currency set that way', async () => {
    const { body } = await runIn('GBP', { currencies })
    expect(body?.get('line_items[0][price_data][currency]')).toBe('gbp')
    // $30 → £24 → .99 = £24.99.
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('2499')
    expect(body?.get('line_items[0][price_data][tax_behavior]')).toBe('inclusive')
  })

  it('scales a coupon to the charge-currency goods', async () => {
    const { body } = await runIn('NZD', { currencies }, { couponCode: 'HALF' })
    expect(body?.get('discounts[0][coupon]')).toBe('co_test_1')
    // 50% of NZ$102.
    expect(couponAmounts).toEqual(['5100'])
  })

  it('charges the store currency when the store does not sell in the one asked for', async () => {
    for (const [currency, settings, profile] of [
      ['NZD', {}, undefined],
      ['AUD', { currencies }, undefined],
      ['NZD', { currencies }, { stripeChargeModel: 'destination' }],
      [undefined, { currencies }, undefined],
    ] as const) {
      const { body } = await runIn(currency, settings, {}, profile ?? { stripeChargeModel: 'direct' })
      expect(body?.get('line_items[0][price_data][currency]')).toBe('usd')
      expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('3000')
      expect(body?.has('metadata[currency]')).toBe(false)
    }
  })

  it('charges the store currency on rates older than four days', async () => {
    const stale = { ...fxRates, asOfMs: Date.now() - 6 * 86_400_000 }
    seedStore({ currencies }, {})
    docs.set('profiles/owner-1', { stripeAccountId: 'acct_1', stripeChargesEnabled: true, stripeChargeModel: 'direct' })
    docs.set('platform/fxRates', stale)
    resetFxRatesCache()
    sessionBody = null
    const request = makeRequest({})
    ;(request.body as Record<string, unknown>).currency = 'NZD'
    const { res } = makeResponse()
    await cartCheckoutHandler(request, res)
    expect((sessionBody as URLSearchParams | null)?.get('line_items[0][price_data][currency]')).toBe('usd')
  })
})
