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
import { checkoutHandler } from './checkout'

/**
 * Shipping reaches the buy-now Checkout Session (AGL-1720).
 *
 * AGL-1707 wired the merchant's zones and rates into CART checkout. Buy-now
 * contained no `shipping` string at all — no address collection, no
 * `shipping_options` — so the same merchant selling the same product charged
 * two different totals depending on which button the shopper pressed. The
 * translation is not re-implemented here; this file proves the buy-now handler
 * calls the AGL-1707 one and that its two extra conditions hold.
 *
 * Stripe is mocked absolutely, as in `cart-checkout-shipping.spec.ts`:
 * localhost carries the LIVE secret key, so nothing here may reach
 * api.stripe.com. The assertions read the form body the handler built, which
 * is the artefact that decides whether shipping is charged.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

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
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`) }
}

const fakeFirestore = { collection: (name: string) => makeCollectionRef(name) }

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
  /** `hosts/host-1/settings/store`, or null for a merchant with no doc. */
  settings?: Record<string, any> | null
  /** Merged over the seeded product doc. */
  product?: Record<string, any>
  /** Units bought — the buy-now path sells ONE product at a quantity. */
  quantity?: number
  couponCode?: string
  /** Seeded at `hosts/host-1/coupons/{couponCode}`. */
  coupon?: Record<string, any>
  billing?: string
  /** What the shopper declared, exactly as it arrives over the wire. */
  shippingCountry?: unknown
}

/** Seeds a host that can sell one 400g $30 physical product. */
async function runCheckout(scenario: Scenario = {}) {
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme' })
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
  if (scenario.couponCode && scenario.coupon) {
    docs.set(`hosts/host-1/coupons/${scenario.couponCode}`, scenario.coupon)
  }
  sessionBody = null
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: {
      hostId: 'host-1',
      productId: 'p1',
      variantId: 'v1',
      quantity: scenario.quantity ?? 1,
      ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      ...(scenario.billing ? { billing: scenario.billing } : {}),
      ...('shippingCountry' in scenario
        ? { shippingCountry: scenario.shippingCountry }
        : {}),
    },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

/** Every `shipping_options[n]` in the emitted form body, in index order. */
function shippingOptions(body: URLSearchParams | null) {
  if (!body) return []
  const out: { name: string; amount: string; currency: string; type: string }[] =
    []
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

/** Every shipping-related key the handler emitted, sorted. */
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

describe('buy-now checkout shipping options (AGL-1720)', () => {
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

  // The regression that would matter most, pinned first as AGL-1707 did: a
  // merchant who never configured shipping must keep charging none, and must
  // not suddenly be shown an address form either.
  it('emits no shipping key at all for a merchant who configured none', async () => {
    for (const settings of [null, {}, { tax: { mode: 'stripe' } }]) {
      const { result, body } = await runCheckout({ settings })
      expect(result.status).toBe(200)
      expect(shippingKeys(body)).toEqual([])
    }
  })

  it('declares the destination’s rate, and only that destination (AGL-1721)', async () => {
    const us = await runCheckout({
      settings: { shipping },
      shippingCountry: 'US',
    })
    expect(us.result.status).toBe(200)
    expect(shippingOptions(us.body)).toEqual([
      { name: 'Standard', amount: '799', currency: 'usd', type: 'fixed_amount' },
    ])
    // Stripe applies no shipping rate without somewhere to ship to, so the
    // options are worthless without these keys — and it re-checks the rate
    // against nothing, so a wider list here is the whole defect.
    expect(allowedCountries(us.body)).toEqual(['US'])

    const fr = await runCheckout({
      settings: { shipping },
      shippingCountry: 'FR',
    })
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

  it('refuses a buy-now whose rates differ by destination', async () => {
    const { result, body } = await runCheckout({ settings: { shipping } })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ needsShippingCountry: true })
    expect(body).toBeNull()
  })

  it('keeps all six countries when one rate serves them all', async () => {
    // The single-'*'-zone merchant, whose union was exact all along. Asking
    // this shopper anything would be a regression, and the buy-now path must
    // agree with the cart's answer for the same settings document.
    const { result, body } = await runCheckout({
      settings: { shipping: byWeight },
    })
    expect(result.status).toBe(200)
    expect(allowedCountries(body)).toEqual(['US', 'CA', 'GB', 'AU', 'DE', 'FR'])
    expect(shippingOptions(body)).toHaveLength(1)
  })

  it('refuses a destination this merchant does not serve', async () => {
    const { result, body } = await runCheckout({
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
  })

  it('never narrows the address form on a product that ships nothing', async () => {
    // A declared destination is about pricing a parcel. A digital product has
    // none, so the country must not leak into the session as an address
    // restriction — this path emits no shipping keys at all for one.
    const { result, body } = await runCheckout({
      settings: { shipping },
      product: { type: 'digital' },
      shippingCountry: 'US',
    })
    expect(result.status).toBe(200)
    expect(shippingKeys(body)).toEqual([])
  })

  it('weighs the units bought, not one unit', async () => {
    // THE single-item case this path is about: 3 x 400g = 1200g, past the
    // 500g tier. A handler that passed `weightGrams` without multiplying by
    // quantity would send 400g and quote the 599 tier — the same
    // under-collection in miniature, and the same hardcoded-1 shape AGL-1711
    // just removed from this function.
    const { body } = await runCheckout({
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

  it('prices free_over off the pre-discount total, not the coupon’d one', async () => {
    // 2 x $30 = $60 list, past the $50 threshold, so shipping is free — even
    // though the 50%-off coupon drops what Stripe is charged to $30. The
    // shopper saw "free over $50" against the subtotal, and the cart path
    // resolves against the same pre-discount figure.
    const { body } = await runCheckout({
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
      couponCode: 'HALF',
      coupon: { percentOff: 50, enabled: true },
    })
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('1500')
    expect(shippingOptions(body)).toEqual([
      {
        name: 'Free over $50',
        amount: '0',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
  })

  it('ships nothing for a digital or service product', async () => {
    // The PDP path sells downloads and services too. Charging a shopper to
    // ship a PDF — and asking them for an address first — would be a worse
    // bug than the one being fixed.
    for (const type of ['digital', 'service']) {
      const { result, body } = await runCheckout({
        settings: { shipping },
        product: { type },
      })
      expect(result.status).toBe(200)
      expect(shippingKeys(body)).toEqual([])
    }
  })

  it('treats a product with no type as physical, as the fee ladder does', async () => {
    // `liftLegacyProduct` only defaults `type` on docs it synthesizes variants
    // for, so a part-migrated doc reaches the handler without one. The fee
    // ladder above already reads that as physical; shipping must agree.
    const { body } = await runCheckout({
      settings: { shipping },
      product: { type: undefined },
      shippingCountry: 'US',
    })
    expect(shippingOptions(body).map((option) => option.name)).toEqual([
      'Standard',
    ])
    expect(allowedCountries(body)).toEqual(['US'])
  })

  it('ships nothing on a subscription session', async () => {
    // A subscription session lands in the webhook's `commerce-subscription`
    // branch, which writes a subscription doc and never reads
    // `total_details.amount_shipping`. Shipping charged there would be real
    // money recorded nowhere — a worse version of the AGL-1698 hazard that
    // orders this whole batch.
    const { result, body } = await runCheckout({
      settings: { shipping },
      product: { subscription: { interval: 'month' } },
    })
    expect(result.status).toBe(200)
    expect(body?.get('mode')).toBe('subscription')
    expect(shippingKeys(body)).toEqual([])
  })

  it('leaves the AGL-1711 decomposition metadata and the tax opt-in alone', async () => {
    // Shipping is additive: the webhook still reads its unit price, tax and
    // discount from metadata, and shipping from Stripe's own total_details.
    const { body } = await runCheckout({
      settings: { shipping, tax: { mode: 'stripe' } },
      quantity: 2,
      shippingCountry: 'US',
    })
    expect(body?.get('metadata[unitAmountCents]')).toBe('3000')
    expect(body?.get('metadata[quantity]')).toBe('2')
    expect(body?.get('metadata[taxCents]')).toBe('0')
    expect(body?.get('metadata[discountCents]')).toBe('0')
    expect(body?.get('automatic_tax[enabled]')).toBe('true')
    expect(shippingOptions(body)).toHaveLength(1)
  })
})
