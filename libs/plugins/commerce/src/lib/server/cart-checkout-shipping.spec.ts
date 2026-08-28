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
    couponAmounts.length = 0
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
  /**
   * AGL-2232, at the door rather than in the model.
   *
   * The cart is 2 x 400 g = 800 g. Against a table whose only tier stops at
   * 500 g nothing resolves, for any of the six collectable countries — and the
   * "did this merchant configure shipping at all?" probe used the SAME cart, so
   * it came back empty too and the handler took the branch reserved for a store
   * that never set shipping up: a live session, no `shipping_options`, freight
   * charged at nothing.
   */
  describe('a cart past every tier (AGL-2232)', () => {
    const stopsAt500g = {
      shipping: {
        zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
        rates: [
          {
            id: 'wt',
            zoneId: 'world',
            name: 'By weight',
            kind: 'weight_tiers',
            tiers: [{ upTo: 500, amountCents: 599 }],
          },
        ],
      },
    }

    it('refuses the checkout instead of opening a free-freight session', async () => {
      const { result, body } = await runCheckout(stopsAt500g)
      expect(result.status).toBe(409)
      expect(String(result.body.error)).toContain('cannot price shipping')
      // The refusal is COMPLETE: no session was minted at all, so there is no
      // live Stripe page a shopper could still pay on.
      expect(body).toBeNull()
      // And it does not send the shopper to the country picker, which cannot
      // fix a parcel no tier covers.
      expect(result.body.needsShippingCountry).toBeUndefined()
    })

    it('refuses a declared destination for the same reason', async () => {
      const { result } = await runCheckout(stopsAt500g, {
        shippingCountry: 'US',
      })
      expect(result.status).toBe(409)
      expect(String(result.body.error)).toContain('cannot price shipping')
    })

    /**
     * POSITIVE CONTROL. The same store with a tier that reaches the cart still
     * sells — so the refusal above is about the gap, not about weight tiers.
     */
    it('POSITIVE CONTROL: a tier that covers 800g still prices and sells', async () => {
      const { result, body } = await runCheckout({
        shipping: {
          zones: [{ id: 'world', name: 'Everywhere', countries: ['*'] }],
          rates: [
            {
              id: 'wt',
              zoneId: 'world',
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
      expect(result.status).toBe(200)
      expect(shippingOptions(body).map((option) => option.amount)).toEqual([
        '1299',
      ])
    })
  })
  /**
   * A FREE-SHIPPING DISCOUNT REACHES THE TOTAL (AGL-2508).
   *
   * The defect was a silent wrong charge, and silent is the operative word.
   * `valueCents` answered `0` for every kind it did not understand, so a
   * `free_shipping` discount resolved successfully worth nothing: the apply
   * block gates on `discountCents > 0` and skipped it, and the invalid-code
   * 400 beside it only fires when NOTHING resolved, so that skipped it too.
   * The shopper typed a valid code, saw no error, and paid full shipping.
   *
   * Asserted on the CHARGED AMOUNT — the `fixed_amount` on the session's
   * shipping options, which is the number Stripe will bill — never on any
   * rendered output. Stripe is mocked absolutely and the key is a fake test
   * key, exactly as the rest of this suite.
   */
  describe('a free-shipping discount (AGL-2508)', () => {
    const freeShip = {
      id: 'ship-free',
      code: 'FREESHIP',
      kind: 'free_shipping',
      enabled: true,
    }

    it('zeroes the rate the shopper will be charged', async () => {
      const { result, body } = await runCheckout(
        { shipping },
        {
          shippingCountry: 'US',
          couponCode: 'FREESHIP',
          discounts: [freeShip],
        },
      )

      expect(result.status).toBe(200)
      expect(shippingOptions(body)).toEqual([
        { name: 'Standard', amount: '0', currency: 'usd', type: 'fixed_amount' },
      ])
    })

    it('CONTROL: the same cart without the code still pays $7.99', async () => {
      // Without this the assertion above would pass just as well against a
      // handler that had stopped charging shipping altogether.
      const { result, body } = await runCheckout(
        { shipping },
        { shippingCountry: 'US' },
      )

      expect(result.status).toBe(200)
      expect(shippingOptions(body)).toEqual([
        {
          name: 'Standard',
          amount: '799',
          currency: 'usd',
          type: 'fixed_amount',
        },
      ])
    })

    it('CONTROL: a percentage discount leaves shipping alone', async () => {
      // The other direction: free shipping must not become what every discount
      // does. A percent code reduces the goods and the parcel still costs
      // $7.99.
      const { result, body } = await runCheckout(
        { shipping },
        {
          shippingCountry: 'US',
          couponCode: 'TENOFF',
          discounts: [
            {
              id: 'ten-off',
              code: 'TENOFF',
              kind: 'percent',
              valuePct: 10,
              enabled: true,
            },
          ],
        },
      )

      expect(result.status).toBe(200)
      expect(shippingOptions(body)).toEqual([
        {
          name: 'Standard',
          amount: '799',
          currency: 'usd',
          type: 'fixed_amount',
        },
      ])
      // It did apply, rather than being skipped the way free shipping was.
      expect(body?.get('metadata[discountId]')).toBe('ten-off')
    })

    it('records the redemption it just spent', async () => {
      // Free shipping now takes the same hold every other discount takes. It
      // was skipped entirely before, so a capped free-shipping promotion was
      // unlimited in practice.
      const { body } = await runCheckout(
        { shipping },
        {
          shippingCountry: 'US',
          couponCode: 'FREESHIP',
          discounts: [freeShip],
        },
      )

      expect(body?.get('metadata[discountId]')).toBe('ship-free')
    })

    it('refuses a discount kind it cannot apply, rather than charging in full', async () => {
      // The guard that keeps the next `free_shipping` from being a silent
      // undercharge: a code that resolves but confers nothing this build
      // understands is a refusal the shopper can see, not a full-price sale.
      const { result, body } = await runCheckout(
        { shipping },
        {
          shippingCountry: 'US',
          couponCode: 'WAT',
          discounts: [
            { id: 'mystery', code: 'WAT', kind: 'mystery-kind', enabled: true },
          ],
        },
      )

      expect(result.status).toBe(400)
      // Nothing was opened, so nothing can be charged.
      expect(body).toBeNull()
    })
  })

  /**
   * A SCOPED DISCOUNT CHARGES FOR WHAT IT DOES NOT COVER (AGL-2517).
   *
   * `applies` refused a cart holding NONE of the scoped products, so the scope
   * was never entirely dead — but the amount was computed against the whole
   * subtotal, so one in-scope item discounted the entire basket. The merchant
   * chose a scope and checkout charged as though they had not.
   *
   * Asserted on `amount_off` — the cents Stripe actually takes off the session
   * — with a second, out-of-scope product in the cart so the scoped and
   * unscoped answers cannot coincide.
   */
  describe('a product-scoped discount (AGL-2517)', () => {
    // The seeded cart is 2 x $30 of `p1`; `extra` adds 1 x $50 of `p2`.
    const extraProduct = { id: 'p2', priceUsd: 50, quantity: 1 }
    const scoped = {
      id: 'scoped-ten',
      code: 'TEN',
      kind: 'percent',
      valuePct: 10,
      enabled: true,
      productIds: ['p1'],
    }

    it('takes its percentage off the scoped lines only', async () => {
      const { result } = await runCheckout(
        { shipping },
        {
          shippingCountry: 'US',
          couponCode: 'TEN',
          discounts: [scoped],
          extraProduct,
        },
      )

      expect(result.status).toBe(200)
      // 10% of the $60 of `p1`, never 10% of the $110 basket.
      expect(couponAmounts).toEqual(['600'])
    })

    it('CONTROL: the same discount unscoped still covers the basket', async () => {
      // Without this the change would look correct while shrinking every
      // ordinary store-wide discount.
      const { result } = await runCheckout(
        { shipping },
        {
          shippingCountry: 'US',
          couponCode: 'TEN',
          discounts: [{ ...scoped, productIds: [] }],
          extraProduct,
        },
      )

      expect(result.status).toBe(200)
      expect(couponAmounts).toEqual(['1100'])
    })
  })
})
