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
import { cartCheckoutHandler, CHECKOUT_EXTRA_UNAVAILABLE_MESSAGE } from './cart-checkout'
import { registerPluginCheckoutExtra } from '@aglyn/aglyn/plugin-manager/plugin-checkout-extras'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { decodeCheckoutExtrasMetadata } from '@aglyn/aglyn/plugin-manager/plugin-checkout-extras'
import { cartExtrasHandler } from './checkout-extras'
import * as Aglyn from '@aglyn/aglyn/server'

/**
 * Optional lines another plugin offers (AGL-3635) reach the Checkout Session
 * only as the buyer chose them and only at the price the provider names at
 * the moment of sale: package protection is charged as its own untaxed
 * line, carries no platform take, rides the session metadata the webhook
 * records it from, and an offer the buyer ticked that is gone refuses
 * rather than selling without it.
 *
 * The harness is `cart-checkout-shipping.spec.ts`'s: Stripe is mocked
 * absolutely and the assertions read the form body the handler built.
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
    plan: 'business',
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
  /** The offers the buyer ticked, as the cart sends them. */
  extras?: unknown
}

function makeRequest(scenario: Scenario): PluginApiRequest {
  return {
    method: 'POST',
    body: {
      hostId: 'host-1',
      ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      ...(scenario.extras !== undefined ? { extras: scenario.extras } : {}),
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

const PROTECTION = {
  key: 'package-protection',
  label: 'Package protection',
  description: 'Covers loss in transit.',
  amountCents: 198,
  currency: 'usd',
  defaultSelected: true,
  quoteRef: 'q_1',
}

/** What the provider was asked, each time. */
const asked: Array<{ itemsCents: number; lines: unknown[] }> = []

function offerProtection(amountCents = 198) {
  registerPluginCheckoutExtra(
    {
      offer: async (request) => {
        asked.push({ itemsCents: request.itemsCents, lines: request.lines })
        return request.lines.some((line) => line.ships) ? { ...PROTECTION, amountCents } : null
      },
    },
    { pluginId: 'post-purchase' },
  )
}

function extraLine(body: URLSearchParams | null, index: number) {
  const field = `line_items[${index}][price_data]`
  return body?.has(`${field}[unit_amount]`)
    ? {
        name: body.get(`${field}[product_data][name]`),
        amount: body.get(`${field}[unit_amount]`),
        taxCode: body.get(`${field}[product_data][tax_code]`),
        quantity: body.get(`line_items[${index}][quantity]`),
      }
    : null
}

describe('cart checkout extras (AGL-3635)', () => {
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
    couponAmounts.length = 0
    asked.length = 0
    resetPluginServicesForTests()
  })

  it('sells exactly as before when the buyer ticked nothing', async () => {
    offerProtection()
    const { result, body } = await runCheckout(null)
    expect(result.status).toBe(200)
    expect(extraLine(body, 1)).toBeNull()
    expect(body?.has('metadata[extra0]')).toBe(false)
    expect(asked).toHaveLength(0)
  })

  it('charges a ticked offer as its own untaxed line, at the price asked for again now', async () => {
    offerProtection(205)
    const { result, body } = await runCheckout(null, { extras: ['post-purchase.package-protection'] })
    expect(result.status).toBe(200)
    expect(extraLine(body, 1)).toEqual({
      name: 'Package protection',
      amount: '205',
      taxCode: 'txcd_00000000',
      quantity: '1',
    })
    expect(asked).toEqual([{ itemsCents: 6000, lines: [expect.objectContaining({ unitCents: 3000, quantity: 2, ships: true })] }])
    const metadata = Object.fromEntries(
      [...(body?.entries() ?? [])]
        .filter(([key]) => key.startsWith('metadata['))
        .map(([key, value]) => [key.slice('metadata['.length, -1), value]),
    )
    expect(decodeCheckoutExtrasMetadata(metadata)).toEqual([
      {
        id: 'post-purchase.package-protection',
        pluginId: 'post-purchase',
        key: 'package-protection',
        label: 'Package protection',
        amountCents: 205,
        quoteRef: 'q_1',
      },
    ])
  })

  it('takes no platform cut on the extra: only the card cost of carrying it', async () => {
    offerProtection(198)
    const without = await runCheckout(null)
    const feeWithout = Number(without.body?.get('payment_intent_data[application_fee_amount]') ?? 0)
    const withExtra = await runCheckout(null, { extras: ['post-purchase.package-protection'] })
    const feeWith = Number(withExtra.body?.get('payment_intent_data[application_fee_amount]') ?? 0)
    expect(feeWith - feeWithout).toBe(
      Aglyn.saleProcessingCostCents(6000 + 198) - Aglyn.saleProcessingCostCents(6000),
    )
  })

  it('refuses rather than sells without cover the buyer ticked and is no longer offered', async () => {
    const gone = await runCheckout(null, { extras: ['post-purchase.package-protection'] })
    expect(gone.result).toEqual({
      status: 409,
      body: { error: CHECKOUT_EXTRA_UNAVAILABLE_MESSAGE, extrasChanged: true },
    })
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
    offerProtection()
    const forged = await runCheckout(null, { extras: ['someone.else-entirely'] })
    expect(forged.result.status).toBe(409)
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
  })

  it('ignores a choice that is not an id, and never takes a price from the request', async () => {
    offerProtection(198)
    const { result, body } = await runCheckout(null, {
      extras: [{ id: 'post-purchase.package-protection', amountCents: 1 }],
    })
    expect(result.status).toBe(200)
    expect(extraLine(body, 1)).toBeNull()
  })
})

describe('the cart’s offers (AGL-3635)', () => {
  function getRequest(cookie = true): PluginApiRequest {
    return {
      method: 'GET',
      query: { hostId: 'host-1' },
      cookies: cookie ? { 'aglyn_cart_host-1': 'cart-1' } : {},
      headers: {},
    } as unknown as PluginApiRequest
  }

  beforeEach(() => {
    resetPluginServicesForTests()
    asked.length = 0
  })

  it('answers none, reading nothing, when no plugin offers', async () => {
    seedStore(null, {})
    const { res, result } = makeResponse()
    await cartExtrasHandler(getRequest(), res)
    expect(result).toEqual({ status: 200, body: { extras: [], credits: [] } })
  })

  it('shows each offer for the visitor’s basket, without its quote id', async () => {
    seedStore(null, {})
    offerProtection()
    const { res, result } = makeResponse()
    await cartExtrasHandler(getRequest(), res)
    expect(result).toEqual({
      status: 200,
      body: {
        extras: [
          {
            id: 'post-purchase.package-protection',
            label: 'Package protection',
            description: 'Covers loss in transit.',
            amountCents: 198,
            defaultSelected: true,
          },
        ],
        // No store-credit provider is registered here (AGL-3640).
        credits: [],
      },
    })
  })

  it('offers nothing for a basket that does not ship, or no basket', async () => {
    seedStore(null, { product: { type: 'digital' } })
    offerProtection()
    const digital = makeResponse()
    await cartExtrasHandler(getRequest(), digital.res)
    expect(digital.result.body).toEqual({ extras: [], credits: [] })
    const none = makeResponse()
    await cartExtrasHandler(getRequest(false), none.res)
    expect(none.result.body).toEqual({ extras: [], credits: [] })
    expect(asked).toHaveLength(0)
  })
})
