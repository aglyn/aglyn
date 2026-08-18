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
 * The cart charges the merchant's `manual` tax (AGL-1953).
 *
 * ## What was wrong
 *
 * The entire tax handling of this path was three lines — `if (taxSettings.mode
 * === 'stripe') automatic_tax[enabled]` — with no `manual` branch at all. A
 * merchant who configured destination tax in the AGL-285 zone editor, **the
 * mode a merchant lands in by default**, collected that tax on a buy-now
 * purchase and nothing whatever on a cart purchase of the same goods. Same
 * store, same shopper, same items; two totals decided by which button was
 * pressed. The merchant owes the tax either way, and their own order record
 * said `taxCents: 0` because Stripe was never told of a tax never added.
 *
 * ## Why a TAX RATE here and a line item on buy-now
 *
 * Not an inconsistency — the two paths price discounts differently and only
 * one construction survives each. Buy-now prices its discount INTO the unit
 * amount, so its `line_items[1]` tax line cannot be touched afterwards. THIS
 * path applies discounts, coupons and gift cards as session-level Stripe
 * coupons, which spread across every line, so a fake tax line would be
 * discounted along with the goods and the metadata snapshot would over-state
 * what was collected. A real tax rate is applied by Stripe AFTER the discount
 * — measured, not assumed; see `manual-tax-rate.ts` — so the arithmetic holds
 * and `total_details.amount_tax` becomes a real field the webhook can read.
 *
 * The classification assertions are the load-bearing ones: a manual sale must
 * NOT set `automatic_tax[enabled]`, because that flag is what
 * `storefront-tax.ts` reads to decide whose registrations computed the tax.
 * Setting it here would book merchant-configured tax as Aglyn-collected.
 *
 * Stripe is mocked absolutely, as in `cart-checkout-shipping.spec.ts`: nothing
 * in this file may reach api.stripe.com. The assertions read the form body the
 * handler built, which is the artefact that decides what the shopper pays.
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
/** Set to make the tax-rate endpoint refuse, for the 502 case. */
let taxRateRefuses = false

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
  // A real endpoint with a real side effect: every call CREATES an immutable
  // tax rate on the platform account, which is why the cache case below is
  // worth asserting at all.
  if (target.endsWith('/v1/tax_rates')) {
    if (taxRateRefuses) {
      return {
        ok: false,
        json: async () => ({ error: { message: 'nope' } }),
      }
    }
    return { ok: true, json: async () => ({ id: 'txr_test_1' }) }
  }
  if (target.endsWith('/v1/coupons')) {
    return { ok: true, json: async () => ({ id: 'co_test_1' }) }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

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

/** A merchant with an 8.25% Texas rate configured, origin Texas. */
const MANUAL_TX = {
  tax: {
    mode: 'manual',
    origin: { country: 'US', state: 'TX' },
    rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
  },
}

interface Scenario {
  /** Extra products/lines beyond the default taxable one. */
  exemptLine?: boolean
  couponCode?: string
}

/**
 * One $30 taxable item, quantity 2. A second, TAX-EXEMPT download is added on
 * request so the per-line exclusion can be told apart from a session-wide one.
 */
function seedStore(storeSettings: Record<string, any> | null, scenario: Scenario) {
  docs.clear()
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [
      { productId: 'p1', variantId: 'v1', quantity: 2 },
      ...(scenario.exemptLine
        ? [{ productId: 'p2', variantId: 'v2', quantity: 1 }]
        : []),
    ],
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
  })
  docs.set('hosts/host-1/products/p2', {
    name: 'Manual PDF',
    status: 'active',
    type: 'digital',
    taxExempt: true,
    variants: [{ id: 'v2', priceUsd: 9, inventory: null }],
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
  await cartCheckoutHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      },
      cookies: { 'aglyn_cart_host-1': 'cart-1' },
      headers: { host: 'shop.example.com' },
      query: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

afterAll(() => {
  if (ORIGINAL_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY
})

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_double_1953'
  taxRateRefuses = false
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('a manual-tax store now collects tax on a cart sale (AGL-1953)', () => {
  /** THE DEFECT: this session used to carry no tax of any kind. */
  it('puts the merchant configured rate on the taxable line', async () => {
    const result = await runCheckout(MANUAL_TX)
    expect(result.status).toBe(200)
    expect(stripeCalls('/v1/tax_rates')).toBe(1)
    const created = new URLSearchParams(
      String(
        fetchMock.mock.calls.find((call) =>
          String(call[0]).endsWith('/v1/tax_rates'),
        )?.[1]?.body ?? '',
      ),
    )
    expect(created.get('percentage')).toBe('8.25')
    expect(created.get('display_name')).toBe('TX sales tax')
    // Exclusive: the tax is ADDED to the price, not carved out of it.
    expect(created.get('inclusive')).toBe('false')
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBe('txr_test_1')
  })

  /**
   * THE CLASSIFICATION, and the reason it is asserted separately: this flag is
   * what `storefront-tax.ts` reads to decide WHOSE registrations computed the
   * tax. A manual sale that set it would be recorded as Aglyn-collected — the
   * AGL-1904 defect with the sign flipped.
   */
  it('does not claim Stripe Tax computed it', async () => {
    await runCheckout(MANUAL_TX)
    expect(sessionBody?.get('automatic_tax[enabled]')).toBeNull()
  })

  /** Per LINE, which a single session-wide figure could not have expressed. */
  it('leaves a tax-exempt line out of the tax', async () => {
    await runCheckout(MANUAL_TX, { exemptLine: true })
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBe('txr_test_1')
    expect(sessionBody?.get('line_items[1][tax_rates][0]')).toBeNull()
    // …and the exempt line is still SOLD, not dropped.
    expect(sessionBody?.get('line_items[1][price_data][unit_amount]')).toBe(
      '900',
    )
  })

  /** Immutable objects on a real account: the second sale reuses the first. */
  it('mints one tax rate per rate, not one per checkout', async () => {
    await runCheckout(MANUAL_TX)
    expect(stripeCalls('/v1/tax_rates')).toBe(1)
    // Same host, same rate — the cache doc survives in `docs`, so re-running
    // without clearing it is the real second sale.
    sessionBody = null
    const { res } = makeResponse()
    await cartCheckoutHandler(
      {
        method: 'POST',
        body: { hostId: 'host-1' },
        cookies: { 'aglyn_cart_host-1': 'cart-1' },
        headers: { host: 'shop.example.com' },
        query: {},
      } as unknown as PluginApiRequest,
      res,
    )
    expect(stripeCalls('/v1/tax_rates')).toBe(1)
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBe('txr_test_1')
  })

  /**
   * A VISIBLE refusal, never a fallback to an untaxed session — silently
   * under-collecting is the defect this issue is about, and a shopper who
   * pays no tax cannot be asked for it later.
   */
  it('refuses the checkout when Stripe will not mint the rate', async () => {
    taxRateRefuses = true
    const result = await runCheckout(MANUAL_TX)
    expect(result.status).toBe(502)
    // No session was opened, so nothing was sold at the wrong price.
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
  })
})

describe('the modes the cart already had keep their behaviour', () => {
  it('still asks Stripe Tax to compute a `stripe` mode store', async () => {
    await runCheckout({ tax: { mode: 'stripe' } })
    expect(sessionBody?.get('automatic_tax[enabled]')).toBe('true')
    // Stripe Tax computes its own rates; minting one here would double-tax.
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBeNull()
  })

  /**
   * A merchant who DECIDED not to collect gets the session they always got
   * (AGL-1999). Previously spelled as an absent settings document, which is
   * now the refusal below.
   */
  it('sends no tax of any kind when the store decided not to collect', async () => {
    await runCheckout({ tax: { mode: 'none' } })
    expect(sessionBody?.get('automatic_tax[enabled]')).toBeNull()
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
  })

  /**
   * THE AGL-1999 DEFECT, on the cart door. `mode: undefined` matched neither
   * branch, so the cart charged the shopper an untaxed total and refused
   * nothing.
   */
  it('REFUSES a cart checkout when nobody has decided about tax', async () => {
    const result = await runCheckout(null)
    expect(result.status).toBe(409)
    expect(String(result.body?.error)).toContain('sales tax')
    // No session was minted for an untaxed total.
    expect(sessionBody).toBeNull()
  })

  /** The same for a settings doc that exists but states no mode. */
  it('REFUSES when the settings doc exists with an empty tax map', async () => {
    const result = await runCheckout({ tax: {} })
    expect(result.status).toBe(409)
  })

  /**
   * VAT-style pricing: the tax is already inside the displayed price, so
   * adding a rate on top would charge it twice. Buy-now skips it the same
   * way — which is the consistency this issue exists to restore.
   */
  it('adds nothing when prices already include tax', async () => {
    await runCheckout({
      tax: { ...MANUAL_TX.tax, pricesIncludeTax: true },
    })
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
  })

  /** A configured mode with no rate matching the origin taxes nothing. */
  it('adds nothing when no configured rate matches the store origin', async () => {
    await runCheckout({
      tax: {
        mode: 'manual',
        origin: { country: 'US', state: 'TX' },
        rates: [{ country: 'CA', pct: 5, label: 'GST' }],
      },
    })
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
  })
})

describe('tax and a discount on the same session', () => {
  /**
   * The reason this path uses a rate rather than buy-now's line item. Stripe
   * applies a session-level coupon FIRST and the line's tax rate to what is
   * left — measured in test mode: a $100.00 line with an 8.25% rate and a
   * $30.00 `amount_off` coupon reports `amount_tax: 578` against
   * `taxable_amount: 7000`, i.e. 8.25% of the DISCOUNTED 7000, not of 10000.
   *
   * So the two coexist on one session and the tax follows the discount with
   * no snapshot of ours to keep in step. What is asserted here is that both
   * are actually sent — the arithmetic is Stripe's and is not ours to restate.
   */
  it('sends the coupon and the tax rate together', async () => {
    await runCheckout(MANUAL_TX, { couponCode: 'HALF' })
    expect(sessionBody?.get('discounts[0][coupon]')).toBe('co_test_1')
    expect(sessionBody?.get('line_items[0][tax_rates][0]')).toBe('txr_test_1')
  })
})
