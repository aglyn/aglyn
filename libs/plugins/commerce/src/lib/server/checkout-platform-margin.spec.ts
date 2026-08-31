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
import {
  MARKETPLACE_PROCESSING_FIXED_CENTS,
  MARKETPLACE_PROCESSING_PERCENT_BNPL,
  MARKETPLACE_PROCESSING_PERCENT_CARD,
} from '@aglyn/aglyn/server'
import { checkoutHandler } from './checkout'

/**
 * A STOREFRONT SALE MUST NOT COST AGLYN MORE THAN IT EARNS (AGL-2152).
 *
 * Every storefront charge is a DESTINATION charge, so Stripe debits its
 * processing fee from the PLATFORM's balance. Pro, Business, Scale, Advanced,
 * Agency and Enterprise all carry `transactionFeePhysicalPct: 0`, so before
 * this change the session went out with no `application_fee_amount` at all and
 * Aglyn paid that fee on every physical order and collected nothing back.
 *
 * This file asserts the arithmetic AT THE STRIPE BOUNDARY — the form body the
 * handler actually posts to `/v1/checkout/sessions` — because a fee constant
 * that no charge path reads fixes nothing. The unit-level proof that the
 * figure is break-even at every order size lives beside the resolver in
 * `storefront-processing-recovery.spec.ts`; this one proves it ARRIVES.
 *
 * Stripe is mocked absolutely, as in `checkout-shipping.spec.ts`: localhost
 * carries the LIVE secret key, so nothing here may reach api.stripe.com.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

/**
 * FIRESTORE'S DEEP MERGE AND THE DELETE SENTINEL (AGL-2453).
 *
 * `set(…, { merge: true })` merges a nested MAP key by key rather than
 * replacing it, and only a `FieldValue.delete()` sentinel removes one of its
 * keys. The promotion hold this handler now places is exactly such a nested
 * map, so a shallow fake would report a document shape the product never
 * produces. Modelled here for the same reason `gift-card-hold-race.spec.ts`
 * models it — that file is the canonical version, including the contention
 * model this one deliberately omits.
 */
const DELETE = Symbol('FieldValue.delete')

function mergeInto(
  target: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete next[key]
    } else if (value && typeof value === 'object' && value.__increment != null) {
      next[key] = Number(next[key] ?? 0) + Number(value.__increment)
    } else if (value && typeof value === 'object' && value.__arrayUnion) {
      next[key] = [...(next[key] ?? []), value.__arrayUnion]
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.constructor === Object
    ) {
      next[key] = mergeInto(
        (next[key] && typeof next[key] === 'object' ? next[key] : {}) as any,
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

function writeDoc(
  path: string,
  value: Record<string, any>,
  merge: boolean,
): void {
  docs.set(path, merge ? mergeInto(docs.get(path) ?? {}, value) : value)
}

/**
 * Buffered writes applied at commit, and NOTHING ELSE.
 *
 * There is no version tracking here on purpose: contention is modelled in
 * `promotion-hold-race.spec.ts`, which is where two checkouts race for the last
 * redemption slot. This fake exists only so the handler's transaction can run
 * at all, and a green in this file is a statement about pricing, never about
 * concurrency. A fake that quietly pretended to model contention would be worse
 * than none — it would report green for exactly the bug it could not see.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<[string, Record<string, any>, boolean]> = []
  const transaction = {
    get: async (ref: any) => makeSnapshot(ref.path),
    set: (ref: any, value: Record<string, any>, options?: any) => {
      writes.push([ref.path, value, Boolean(options?.merge)])
    },
    update: (ref: any, value: Record<string, any>) => {
      writes.push([ref.path, value, true])
    },
  }
  const result = await body(transaction)
  for (const [path, value, merge] of writes) writeDoc(path, value, merge)
  return result
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
      writeDoc(path, value, Boolean(options?.merge))
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    // `limit()` is chainable and `get()` answers an empty collection: buy-now
    // reads `hosts/{id}/discounts` on every checkout since and a
    // double without these throws where Firestore would simply return nothing.
    // This suite seeds no discounts, so empty IS the faithful answer.
    limit: () => makeCollectionRef(path),
    get: async () => ({ docs: [] as unknown[] }),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

/**
 * Reassigned per scenario, because the whole point of this file is that the
 * PLAN decides the fee: a Business storefront (0% physical) and a Starter one
 * (2%) must both come out non-negative, by different arithmetic.
 */
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
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        delete: () => DELETE,
        increment: (value: number) => ({ __increment: value }),
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
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
  /** The seller's plan. Decides `transactionFeePhysicalPct`. */
  plan?: string
  /** Unit price in whole dollars. */
  priceUsd?: number
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
  mockOrg.org.plan = scenario.plan ?? 'business'
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
    variants: [
      {
        id: 'v1',
        priceUsd: scenario.priceUsd ?? 30,
        weightGrams: 400,
        inventory: 100,
      },
    ],
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






/** What Stripe debits from the PLATFORM for a charge of `chargeCents`. */
function stripeCostCents(chargeCents: number, percent: number): number {
  return (
    Math.round((chargeCents * percent) / 100) + MARKETPLACE_PROCESSING_FIXED_CENTS
  )
}

/** The `application_fee_amount` on the emitted session, or 0 when absent. */
function feeCents(body: URLSearchParams | null): number {
  return Number(
    body?.get('payment_intent_data[application_fee_amount]') ?? 0,
  )
}

const shippingRates = {
  zones: [{ id: 'us', name: 'United States', countries: ['US'] }],
  rates: [
    { id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 },
    { id: 'exp', zoneId: 'us', name: 'Express', kind: 'flat', amountCents: 1999 },
  ],
}

describe('a storefront sale is never a loss to the platform (AGL-2152)', () => {
  const realFetch = global.fetch
  const realKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_never_used'
  })

  afterAll(() => {
    global.fetch = realFetch
    process.env.STRIPE_SECRET_KEY = realKey as string
    mockOrg.org.plan = 'business'
  })

  beforeEach(() => {
    fetchMock.mockClear()
  })

  /**
   * THE ISSUE ITSELF. A Business storefront advertises 0% on physical goods,
   * and 0% on a destination charge is not "no take rate" — it is a loss.
   *
   * Written against the platform's NET rather than against a fee figure so it
   * cannot be satisfied by a constant: whatever the resolver returns has to
   * survive subtracting what Stripe will actually take.
   */
  it('a 0%-physical tier still covers Stripe on a plain order', async () => {
    const { result, body } = await runCheckout({
      plan: 'business',
      priceUsd: 30,
      settings: { tax: { mode: 'none' } },
    })
    expect(result.status).toBe(200)
    const fee = feeCents(body)
    // The session charges $30 and nothing else — no tax line, no shipping.
    expect(body?.get('line_items[0][price_data][unit_amount]')).toBe('3000')
    expect(body?.has('line_items[1][price_data][unit_amount]')).toBe(false)
    expect(fee).toBeGreaterThan(0)
    expect(fee - stripeCostCents(3000, MARKETPLACE_PROCESSING_PERCENT_BNPL)).toBeGreaterThanOrEqual(0)
  })

  /**
   * THE FIXED 30¢ IS WHY A PERCENTAGE ALONE CANNOT DO THIS. A $5 order is the
   * case a flat rate always loses: 2% of $5 is 10¢ against a 30¢ floor, and
   * even a rate above the processing percentage does not clear it until the
   * order gets large. Starter is the tier that charges a real 2% and it must
   * come out non-negative too.
   */
  it('a $5 order on the tier that charges 2% is still not a loss', async () => {
    const { result, body } = await runCheckout({
      plan: 'starter',
      priceUsd: 5,
      settings: { tax: { mode: 'none' } },
    })
    expect(result.status).toBe(200)
    const fee = feeCents(body)
    const net = fee - stripeCostCents(500, MARKETPLACE_PROCESSING_PERCENT_BNPL)
    expect(net).toBeGreaterThanOrEqual(0)
    // And the advertised 2% is still really collected on top of the cost —
    // the take did not quietly become the cost recovery.
    expect(net).toBeGreaterThanOrEqual(Math.round((500 * 2) / 100))
  })

  /**
   * THE CHARGE IS NOT THE GOODS. Stripe bills its percentage on everything the
   * card runs for, so a fee sized on the goods alone under-recovers by the
   * processing rate on the tax and the postage. The dearest shipping option is
   * the one that has to be covered: the shopper picks after the session is
   * built and `application_fee_amount` cannot be revised afterwards.
   */
  it('covers the manual tax line and the dearest shipping option too', async () => {
    const { result, body } = await runCheckout({
      plan: 'business',
      priceUsd: 30,
      shippingCountry: 'US',
      settings: {
        tax: {
          mode: 'manual',
          origin: { country: 'US', state: 'TX' },
          rates: [
            { country: 'US', state: 'TX', pct: 10, label: 'TX sales tax' },
          ],
        },
        shipping: shippingRates,
      },
    })
    expect(result.status).toBe(200)
    const taxCents = Number(body?.get('line_items[1][price_data][unit_amount]') ?? 0)
    expect(taxCents).toBe(300)
    const dearestShippingCents = 1999
    const worstChargeCents = 3000 + taxCents + dearestShippingCents
    expect(
      feeCents(body) -
        stripeCostCents(worstChargeCents, MARKETPLACE_PROCESSING_PERCENT_BNPL),
    ).toBeGreaterThanOrEqual(0)
  })

  /**
   * THE NEGATIVE CONTROL, and the reason this suite can fail: the fee the
   * handler used to emit — the plan's take of the goods and nothing else — is
   * a loss on every one of these orders. If a future edit reverts the charge
   * path to a take-only figure, the assertions above go red and this one
   * documents what they were protecting.
   */
  it('the take alone would have been a loss on all of them', () => {
    for (const [takePct, goodsCents] of [
      [0, 3000],
      [2, 500],
      [0, 4299],
    ] as const) {
      const takeOnlyFee = Math.round((goodsCents * takePct) / 100)
      // True at the CARD rate as well, which is the friendliest possible
      // reading of Stripe's cost.
      expect(
        takeOnlyFee -
          stripeCostCents(goodsCents, MARKETPLACE_PROCESSING_PERCENT_CARD),
      ).toBeLessThan(0)
    }
  })
})
