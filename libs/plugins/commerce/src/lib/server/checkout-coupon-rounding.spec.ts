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
 * WHAT THE BUY-NOW SESSION ACTUALLY CHARGES (AGL-2159).
 *
 * A percentage coupon comes off the ORDER total, and a Stripe line is
 * `quantity` units at ONE integer `unit_amount` — so the two only agree when
 * the discounted total happens to divide by the quantity. The handler used to
 * paper over the gap with `Math.round(amountCents / quantity)` and multiply it
 * back, which meant:
 *
 *  - the shopper was charged up to `quantity / 2` cents away from the total
 *    the storefront quoted, in either direction;
 *  - the platform fee and the manual tax were computed from `amountCents`,
 *    a figure nothing collected;
 *  - and when the rounding went UP far enough, `discountCents` — computed as
 *    `list − charged` under a `Math.max(0, …)` — clamped to ZERO. The order
 *    then recorded no discount on a sale the shopper had applied a coupon to,
 *    while the charge was the undiscounted list price. The promotion vanished
 *    from the merchant's own record of it.
 *
 * These read the FORM BODY the handler built. That is the artefact that
 * decides what the card is charged, and `line_items[0][quantity]` ×
 * `line_items[0][price_data][unit_amount]` is the only arithmetic Stripe does.
 *
 * Stripe is mocked absolutely, as in `checkout-shipping.spec.ts`: localhost
 * carries the LIVE secret key, so nothing here may reach api.stripe.com.
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
  /** Whole dollars-and-cents, as the merchant typed it. */
  priceUsd: number
  quantity?: number
  percentOff?: number
}

async function runCheckout(scenario: Scenario) {
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    // Digital, so no shipping plan or address collection joins the body and
    // the assertions are about the product line and nothing else.
    type: 'digital',
    variants: [{ id: 'v1', priceUsd: scenario.priceUsd, inventory: 500 }],
  })
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  if (scenario.percentOff) {
    docs.set('hosts/host-1/coupons/SAVE', {
      percentOff: scenario.percentOff,
      enabled: true,
    })
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
      ...(scenario.percentOff ? { couponCode: 'SAVE' } : {}),
    },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

/** Exactly what Stripe will charge for the product line. */
function chargedCents(body: URLSearchParams | null): number {
  return (
    Number(body?.get('line_items[0][quantity]')) *
    Number(body?.get('line_items[0][price_data][unit_amount]'))
  )
}

/** What the order will record: list total minus the recorded discount. */
function recordedCents(body: URLSearchParams | null): number {
  return (
    Number(body?.get('metadata[unitAmountCents]')) *
      Number(body?.get('metadata[quantity]')) -
    Number(body?.get('metadata[discountCents]'))
  )
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  fetchMock.mockClear()
})

// ---------------------------------------------------------------------------

describe('a coupon on a multi-quantity buy-now (AGL-2159)', () => {
  /**
   * THE WORST CASE, and the one that erases the promotion. 18 × 50¢ with 1%
   * off is $8.91; the old code priced the unit at `round(891 / 18) = 50` and
   * charged 18 × 50 = **$9.00** — the full list price, nine cents more than the
   * discounted total — and then recorded `discountCents: 0`, because
   * `Math.max(0, 900 − 900)` is zero. The shopper's coupon did nothing and the
   * merchant's record agreed that it did nothing.
   */
  it('charges the discounted total, not the list price rounded back up', async () => {
    const { result, body } = await runCheckout({
      priceUsd: 0.5,
      quantity: 18,
      percentOff: 1,
    })

    expect(result.status).toBe(200)
    expect(chargedCents(body)).toBe(891)
    // …and the record agrees with the charge, to the cent.
    expect(body?.get('metadata[discountCents]')).toBe('9')
    expect(recordedCents(body)).toBe(891)
  })

  /**
   * A drift with no erasure, on a real basket rather than a pathological one:
   * 19 x $39.99 at 50% off is $379.91 (the half-cent rounds up), and the old
   * code priced the unit at `round(37991 / 19) = 2000` and charged $380.00 —
   * nine cents the shopper never agreed to, on every order of that shape,
   * while the fee and the tax were computed from $379.91.
   */
  it('charges the discounted total when the unit price is not whole', async () => {
    const { body } = await runCheckout({
      priceUsd: 39.99,
      quantity: 19,
      percentOff: 50,
    })

    expect(chargedCents(body)).toBe(37991)
    expect(recordedCents(body)).toBe(37991)
    expect(body?.get('metadata[discountCents]')).toBe('37990')
  })

  /**
   * The shopper's real quantity is not lost when the line collapses: the order
   * is built from `metadata[quantity]`, not from the Stripe line, and the
   * count moves into the display name so the checkout page still says what is
   * being bought.
   */
  it('keeps the real quantity in the metadata and in the line name', async () => {
    const { body } = await runCheckout({
      priceUsd: 0.5,
      quantity: 18,
      percentOff: 1,
    })

    expect(body?.get('metadata[quantity]')).toBe('18')
    expect(body?.get('metadata[unitAmountCents]')).toBe('50')
    expect(body?.get('line_items[0][quantity]')).toBe('1')
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('891')
    expect(body?.get('line_items[0][price_data][product_data][name]')).toBe(
      'Kettle × 18',
    )
  })

  /**
   * THE NEGATIVE CONTROL that matters most. Nothing changes for a session
   * whose total divides evenly — which is EVERY sale with no coupon — so the
   * ordinary Stripe checkout page is untouched and this is not a rewrite of
   * how buy-now prices things.
   */
  it('leaves the per-unit line alone when the total divides evenly', async () => {
    const { body } = await runCheckout({ priceUsd: 30, quantity: 3 })

    expect(body?.get('line_items[0][quantity]')).toBe('3')
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('3000')
    expect(body?.get('line_items[0][price_data][product_data][name]')).toBe(
      'Kettle',
    )
    expect(body?.get('metadata[discountCents]')).toBe('0')
    expect(chargedCents(body)).toBe(9000)
  })

  /** …and with a coupon that happens to divide evenly, likewise. */
  it('leaves the per-unit line alone for an evenly divisible discount', async () => {
    const { body } = await runCheckout({
      priceUsd: 30,
      quantity: 2,
      percentOff: 50,
    })

    expect(body?.get('line_items[0][quantity]')).toBe('2')
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('1500')
    expect(body?.get('line_items[0][price_data][product_data][name]')).toBe(
      'Kettle',
    )
    expect(chargedCents(body)).toBe(3000)
    expect(recordedCents(body)).toBe(3000)
  })

  /**
   * The invariant itself, over a spread of prices, quantities and percentages
   * rather than the handful above: what Stripe charges and what the order
   * records are the same number, always. A single hand-picked case can be
   * satisfied by a special case; this cannot.
   */
  it.each([
    [0.5, 18, 1],
    [0.52, 16, 1],
    [39.99, 19, 50],
    [19.99, 7, 33],
    [10.1, 2, 95],
    [4.4, 10, 1],
    [123.45, 13, 17],
    [7.77, 99, 3],
  ])(
    'charges exactly what it records: $%s × %s at %s%% off',
    async (priceUsd, quantity, percentOff) => {
      const { body } = await runCheckout({ priceUsd, quantity, percentOff })

      expect(chargedCents(body)).toBe(recordedCents(body))
      // And the discount is never negative, nor larger than the list total.
      const discount = Number(body?.get('metadata[discountCents]'))
      expect(discount).toBeGreaterThan(0)
      expect(discount).toBeLessThan(
        Math.round(priceUsd * 100) * quantity,
      )
    },
  )

  /**
   * The 50¢ Stripe charge minimum still holds, and it holds on the CHARGE
   * rather than on a figure the line items cannot express — a 99% coupon on a
   * 60¢ item would otherwise send Stripe an amount it refuses.
   */
  it('never charges below the Stripe minimum', async () => {
    const { result, body } = await runCheckout({
      priceUsd: 0.6,
      quantity: 1,
      percentOff: 99,
    })

    expect(result.status).toBe(200)
    expect(chargedCents(body)).toBe(50)
    expect(recordedCents(body)).toBe(50)
  })
})
