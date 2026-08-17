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
 * Manual tax RECURS on a subscription session (AGL-1751).
 *
 * The AGL-1711 construction sends the merchant's manual tax as an ordinary
 * `line_items[1]` product line. On a subscription session a non-recurring
 * price is a one-time item, and Stripe bills one-time items on the FIRST
 * invoice only — so a manual-tax merchant collected their tax once and then,
 * every renewal after, collected none, while the buyer had been shown a taxed
 * price. The fix: in subscription mode the manual tax rides a real Stripe Tax
 * Rate attached to `line_items[0]`, which Checkout carries onto the
 * subscription item and applies to every invoice.
 *
 * These specs read the form bodies the handler builds — the artefacts that
 * decide what recurs. Stripe is mocked absolutely, as in
 * `checkout-shipping.spec.ts`: localhost carries the LIVE secret key, so
 * nothing here may reach api.stripe.com.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore (with `set`, for the tax-rate cache write)
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
const writes: Array<{ path: string; data: Record<string, any> }> = []

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
    set: async (data: Record<string, any>) => {
      docs.set(path, data)
      writes.push({ path, data })
    },
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
let taxRateBody: URLSearchParams | null = null
/** Stripe endpoints in call order, e.g. ['tax_rates', 'sessions']. */
let stripeCalls: string[] = []
let taxRateResponse: { ok: boolean; body: Record<string, any> } = {
  ok: true,
  body: { id: 'txr_test_1' },
}

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (target.endsWith('/v1/tax_rates')) {
    stripeCalls.push('tax_rates')
    taxRateBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: taxRateResponse.ok,
      json: async () => taxRateResponse.body,
    }
  }
  if (target.endsWith('/v1/checkout/sessions')) {
    stripeCalls.push('sessions')
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
  /** `hosts/host-1/settings/store`, or omitted for no settings doc. */
  settings?: Record<string, any>
  /** Merged over the seeded product doc. */
  product?: Record<string, any>
  quantity?: number
  billing?: string
  /** Seeded at `hosts/host-1/stripeTaxRates/{key}` before the request. */
  taxRateCache?: Record<string, Record<string, any>>
}

/** The TX merchant: manual 8.25% tax by origin, as AGL-285's editor writes. */
const manualTax = {
  mode: 'manual',
  origin: { country: 'US', state: 'TX' },
  rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
}

/** Seeds a host selling one $30 product; `subscription` opt-in per scenario. */
async function runCheckout(scenario: Scenario = {}) {
  docs.clear()
  writes.length = 0
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Journal',
    status: 'active',
    type: 'digital',
    variants: [{ id: 'v1', priceUsd: 30, inventory: 100 }],
    ...(scenario.product ?? {}),
  })
  if (scenario.settings) {
    docs.set('hosts/host-1/settings/store', scenario.settings)
  }
  for (const [key, data] of Object.entries(scenario.taxRateCache ?? {})) {
    docs.set(`hosts/host-1/stripeTaxRates/${key}`, data)
  }
  sessionBody = null
  taxRateBody = null
  stripeCalls = []
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: {
      hostId: 'host-1',
      productId: 'p1',
      variantId: 'v1',
      quantity: scenario.quantity ?? 1,
      ...(scenario.billing ? { billing: scenario.billing } : {}),
    },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return {
    result,
    body: sessionBody as URLSearchParams | null,
    taxRate: taxRateBody as URLSearchParams | null,
  }
}

/** Every `line_items[1]` key the handler emitted — the one-time tax line. */
function oneTimeTaxLineKeys(body: URLSearchParams | null) {
  return [...(body?.keys() ?? [])].filter((key) =>
    key.startsWith('line_items[1]'),
  )
}

const subscription = { subscription: { interval: 'month' } }

describe('subscription checkout manual tax (AGL-1751)', () => {
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
    taxRateResponse = { ok: true, body: { id: 'txr_test_1' } }
  })

  it('charges the tax as a recurring tax rate, never a one-time line', async () => {
    const { result, body, taxRate } = await runCheckout({
      settings: { tax: manualTax },
      product: subscription,
    })
    expect(result.status).toBe(200)
    expect(body?.get('mode')).toBe('subscription')
    // The defect: this line recurs on no invoice after the first. It must be
    // ABSENT entirely, not merely joined by a tax rate — both at once would
    // double-charge the opening invoice.
    expect(oneTimeTaxLineKeys(body)).toEqual([])
    // The fix: a real tax rate on the subscription line, which Checkout
    // carries onto the subscription item and applies to every invoice.
    expect(body?.get('line_items[0][tax_rates][0]')).toBe('txr_test_1')
    // Created on the platform account (where the subscription lives), as an
    // exclusive percentage matching the merchant's zone rate.
    expect(stripeCalls).toEqual(['tax_rates', 'sessions'])
    expect(taxRate?.get('display_name')).toBe('TX sales tax')
    expect(taxRate?.get('percentage')).toBe('8.25')
    expect(taxRate?.get('inclusive')).toBe('false')
    // Stripe now KNOWS this is tax — `total_details.amount_tax` is real — so
    // the metadata snapshot must carry 0. `computeBuyNowOrder` SUMS the two
    // (they were mutually exclusive by construction), so carrying both would
    // double-count the tax on the recorded sale.
    expect(body?.get('metadata[taxCents]')).toBe('0')
    expect(body?.get('automatic_tax[enabled]')).toBeNull()
    // The rate id is cached under the host for the next session.
    expect(writes).toContainEqual(
      expect.objectContaining({
        path: 'hosts/host-1/stripeTaxRates/p82500-TX%20sales%20tax',
        data: expect.objectContaining({ taxRateId: 'txr_test_1' }),
      }),
    )
  })

  it('reuses a cached tax rate instead of minting one per checkout', async () => {
    // Tax rates are immutable Stripe objects — one per (percentage, label),
    // not one per checkout attempt, or every abandoned session mints another.
    const { result, body } = await runCheckout({
      settings: { tax: manualTax },
      product: subscription,
      taxRateCache: {
        'p82500-TX%20sales%20tax': { taxRateId: 'txr_cached_9' },
      },
    })
    expect(result.status).toBe(200)
    expect(stripeCalls).toEqual(['sessions'])
    expect(body?.get('line_items[0][tax_rates][0]')).toBe('txr_cached_9')
  })

  it('mints a new rate when the merchant has changed their zone rate', async () => {
    // The cache key encodes percentage and label, so an edited rate misses
    // the stale entry rather than silently charging the old percentage.
    const { body } = await runCheckout({
      settings: { tax: manualTax },
      product: subscription,
      taxRateCache: { 'p50000-TX%20sales%20tax': { taxRateId: 'txr_old_5' } },
    })
    expect(stripeCalls).toEqual(['tax_rates', 'sessions'])
    expect(body?.get('line_items[0][tax_rates][0]')).toBe('txr_test_1')
  })

  it('labels an unnamed rate the way the one-time line does', async () => {
    const { taxRate } = await runCheckout({
      settings: {
        tax: {
          mode: 'manual',
          origin: { country: 'US' },
          rates: [{ country: 'US', pct: 5 }],
        },
      },
      product: subscription,
    })
    expect(taxRate?.get('display_name')).toBe('Tax (5%)')
    expect(taxRate?.get('percentage')).toBe('5')
  })

  it('fails VISIBLY when the tax rate cannot be created', async () => {
    // Falling back to the one-time line would be this very bug; proceeding
    // with no tax at all would be a silent under-collection of every invoice.
    // A 502 at the checkout button is the only honest failure.
    taxRateResponse = { ok: false, body: { error: { message: 'nope' } } }
    const { result, body } = await runCheckout({
      settings: { tax: manualTax },
      product: subscription,
    })
    expect(result.status).toBe(502)
    expect(body).toBeNull()
    expect(stripeCalls).toEqual(['tax_rates'])
  })

  it('keeps the AGL-1711 one-time line construction on a payment session', async () => {
    // Buy-now DELIBERATELY hides the tax from Stripe — `amount_tax` reads 0
    // and the figure rides the metadata — and the webhook's decomposition
    // depends on exactly that. $30 × 8.25% = 248 (rounded).
    const { result, body } = await runCheckout({ settings: { tax: manualTax } })
    expect(result.status).toBe(200)
    expect(body?.get('mode')).toBe('payment')
    expect(stripeCalls).toEqual(['sessions'])
    expect(body?.get('line_items[1][price_data][unit_amount]')).toBe('248')
    expect(body?.get('line_items[1][price_data][product_data][name]')).toBe(
      'TX sales tax',
    )
    expect(body?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(body?.get('metadata[taxCents]')).toBe('248')
  })

  it('leaves stripe tax mode and inclusive pricing alone', async () => {
    // `automatic_tax` already recurs correctly; VAT-style inclusive pricing
    // charges nothing extra on either path. Neither may grow a tax rate.
    const stripeMode = await runCheckout({
      settings: { tax: { mode: 'stripe' } },
      product: subscription,
    })
    expect(stripeMode.result.status).toBe(200)
    expect(stripeMode.body?.get('automatic_tax[enabled]')).toBe('true')
    expect(stripeMode.body?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(oneTimeTaxLineKeys(stripeMode.body)).toEqual([])

    const inclusive = await runCheckout({
      settings: { tax: { ...manualTax, pricesIncludeTax: true } },
      product: subscription,
    })
    expect(inclusive.result.status).toBe(200)
    expect(inclusive.body?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(oneTimeTaxLineKeys(inclusive.body)).toEqual([])
    expect(inclusive.body?.get('metadata[taxCents]')).toBe('0')
  })
})
