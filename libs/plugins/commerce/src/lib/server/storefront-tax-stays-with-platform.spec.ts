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
import * as CommerceModel from '../model'
import { checkoutHandler } from './checkout'

/**
 * THE SALES TAX MUST STAY WITH THE PARTY THAT OWES IT (AGL-1956).
 *
 * On a `mode: 'stripe'` store the shopper's tax is computed against AGLYN's
 * registrations — measured in AGL-1904, reported by Stripe as
 * `automatic_tax.liability: { type: "self" }` — and Aglyn is the registered
 * Texas taxpayer that must remit it, from a first taxable sales date of
 * 2026-09-01 (AGL-1811). The registration identifiers themselves are operator
 * configuration and are deliberately NOT quoted here: this repository is
 * public, and `check-no-tax-identifiers` refuses them in tracked source.
 *
 * The session nonetheless sent `payment_intent_data[application_fee_amount]`.
 * On a destination charge that form means Stripe transfers `amount_total − fee`
 * to the connected account, and `amount_total` HAS THE TAX INSIDE IT. So every
 * taxed storefront sale wired the state's money to the merchant and returned
 * only the commission, leaving Aglyn holding a liability it had already paid
 * away.
 *
 * ## What makes these specs bite
 *
 * Asserting that `transfer_data[amount]` is present would pass against a fix
 * that computed it wrongly, and asserting a literal cent figure would pass
 * against a fee ladder that silently changed. So the assertions here run the
 * emitted form body through `settleDestinationCharge` below, which models
 * STRIPE'S OWN documented arithmetic for a destination charge, and then ask
 * the only question that matters:
 *
 *     after the dust settles, is Aglyn still holding the tax?
 *
 * That question has a different answer under the two knobs, which is precisely
 * why it catches the defect and a literal assertion would not.
 *
 * Stripe is mocked absolutely and nothing here may reach api.stripe.com —
 * localhost has twice been found carrying a LIVE secret key under a comment
 * reading "TEST MODE" (most recently `apps/console/.env.production.local`), so
 * the fetch double throws on any host but Stripe and the suite asserts the key
 * prefix before it runs.
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
    set: async (data: Record<string, any>) => {
      docs.set(path, data)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    // `limit()` is chainable and `get()` answers an empty collection: buy-now
    // reads `hosts/{id}/discounts` on every checkout since AGL-2519, and a
    // double without these throws where Firestore would simply return nothing.
    // This suite seeds no discounts, so empty IS the faithful answer.
    limit: () => makeCollectionRef(path),
    get: async () => ({ docs: [] as unknown[] }),
  }
}

async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const pending: Array<() => Promise<void>> = []
  const result = await body({
    get: async (ref: any) => ref.get(),
    set: (ref: any, value: any, options?: any) => {
      pending.push(() => ref.set(value, options))
    },
    update: (ref: any, value: any) => {
      pending.push(() => ref.set(value, { merge: true }))
    },
    create: (ref: any, value: any) => {
      pending.push(() => ref.set(value))
    },
  })
  for (const write of pending) await write()
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

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (target.endsWith('/v1/tax_rates')) {
    return { ok: true, json: async () => ({ id: 'txr_test_1' }) }
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
// Stripe's destination-charge arithmetic, modelled
// ---------------------------------------------------------------------------

interface Settlement {
  /** What the shopper's card is run for. */
  amountTotalCents: number
  /** What lands in the merchant's connected account. */
  toMerchantCents: number
  /** What Aglyn is left holding out of the charge. */
  platformKeepsCents: number
}

/**
 * What Stripe does with a destination charge, from the two knobs the session
 * may carry. This is the whole point of the file, so it models the REAL rule
 * rather than a convenient one:
 *
 *   - `application_fee_amount` → Stripe transfers the FULL charge and debits
 *     the fee at the destination. Measured, and recorded in
 *     `billing-webhook.ts`'s AGL-1794 note: "`transfer.amount` equals
 *     `charge.amount`". The platform nets the fee and nothing else — so
 *     anything else in `amount_total`, tax included, has gone to the merchant.
 *   - `transfer_data[amount]` → Stripe transfers exactly that, and the
 *     platform keeps the remainder.
 *
 * Sending BOTH is rejected by Stripe, so this throws on the pair rather than
 * silently preferring one. A fix that emitted both would otherwise look green
 * here and 400 in production.
 */
function settleDestinationCharge(
  body: URLSearchParams | null,
  actual: { taxCents: number; shippingCents: number },
): Settlement {
  if (!body) throw new Error('No Stripe session was created')
  const goodsCents =
    Number(body.get('line_items[0][price_data][unit_amount]') ?? 0) *
    Number(body.get('line_items[0][quantity]') ?? 0)
  const amountTotalCents = goodsCents + actual.shippingCents + actual.taxCents
  const fixedTransfer = body.get('payment_intent_data[transfer_data][amount]')
  const applicationFee = body.get(
    'payment_intent_data[application_fee_amount]',
  )
  if (fixedTransfer !== null && applicationFee !== null) {
    throw new Error(
      'Stripe rejects a PaymentIntent carrying both application_fee_amount ' +
        'and transfer_data[amount] — only one may do the arithmetic',
    )
  }
  const toMerchantCents =
    fixedTransfer !== null
      ? Number(fixedTransfer)
      : amountTotalCents - Number(applicationFee ?? 0)
  return {
    amountTotalCents,
    toMerchantCents,
    platformKeepsCents: amountTotalCents - toMerchantCents,
  }
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
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as PluginApiResponse
  return { res, result }
}

/** A $100 digital product, so no shipping option can blur the arithmetic. */
async function runCheckout(settings: Record<string, any>) {
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_merchant',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Journal',
    status: 'active',
    type: 'digital',
    variants: [{ id: 'v1', priceUsd: 100, inventory: 100 }],
  })
  docs.set('hosts/host-1/settings/store', settings)
  sessionBody = null
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: { hostId: 'host-1', productId: 'p1', variantId: 'v1', quantity: 1 },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

/** A `mode: 'stripe'` store — Stripe Tax, computed against Aglyn (AGL-1904). */
const stripeTax = { tax: { mode: 'stripe' } }
/** A merchant's OWN 8.25% origin rate — the merchant's money, not Aglyn's. */
const manualTax = {
  tax: {
    mode: 'manual',
    origin: { country: 'US', state: 'TX' },
    rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
  },
}

describe('a Stripe Tax storefront sale leaves the tax with Aglyn (AGL-1956)', () => {
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

  beforeEach(() => fetchMock.mockClear())

  it('never lets a live key into this suite', () => {
    // A comment reading "TEST MODE" has been wrong in two different env files.
    // The PREFIX is the only truth, and it is asserted before any spec that
    // builds a Stripe request body runs.
    expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/)
  })

  it('keeps every cent of the tax, and pays the merchant the goods less the fee', async () => {
    const { result, body } = await runCheckout(stripeTax)
    expect(result.status).toBe(200)
    // The premise: Stripe Tax is on, so the tax is Aglyn's to remit.
    expect(body?.get('automatic_tax[enabled]')).toBe('true')

    // Stripe computes 8.25% Texas tax on the $100 line AFTER the session is
    // created — a figure this handler cannot see and must not need to.
    const taxCents = 825
    const settled = settleDestinationCharge(body, {
      taxCents,
      shippingCents: 0,
    })
    expect(settled.amountTotalCents).toBe(10825)

    const feeCents = Number(body?.get('metadata[feeCents]') ?? 0)
    expect(feeCents).toBeGreaterThan(0)

    // THE ASSERTION THIS FILE EXISTS FOR. Aglyn keeps its commission AND the
    // whole tax; the merchant keeps the goods less the commission and not one
    // cent of the state's money.
    expect(settled.platformKeepsCents).toBe(feeCents + taxCents)
    expect(settled.toMerchantCents).toBe(10000 - feeCents)

    // Stated the other way round, so a future change to the fee ladder cannot
    // quietly turn this green: the tax is exactly what the platform retains
    // over and above its own fee.
    expect(settled.platformKeepsCents - feeCents).toBe(taxCents)
  })

  it('sends a fixed transfer and NO application fee, never both', async () => {
    const { body } = await runCheckout(stripeTax)
    const feeCents = Number(body?.get('metadata[feeCents]') ?? 0)
    // The fee form is what transferred the tax away. It must be gone — not
    // merely joined by a fixed transfer, which Stripe would reject outright.
    expect(body?.get('payment_intent_data[application_fee_amount]')).toBeNull()
    expect(body?.get('payment_intent_data[transfer_data][amount]')).toBe(
      String(10000 - feeCents),
    )
    // The destination is untouched — this is still the merchant's sale.
    expect(body?.get('payment_intent_data[transfer_data][destination]')).toBe(
      'acct_merchant',
    )
    // Recorded, because it is the one shape where the merchant's payout can no
    // longer be re-derived from the charge.
    expect(body?.get('metadata[transferCents]')).toBe(String(10000 - feeCents))
  })

  it('leaves a MANUAL-rate sale on the fee form, tax and all', async () => {
    // The merchant configured this rate, the merchant owes it, and the
    // merchant may hold it. Fixing the transfer here would take the merchant's
    // own tax away from them — the mirror image of the defect. This is the
    // spec that stops the fix over-reaching.
    const { result, body } = await runCheckout(manualTax)
    expect(result.status).toBe(200)
    expect(body?.get('automatic_tax[enabled]')).toBeNull()
    expect(body?.get('payment_intent_data[transfer_data][amount]')).toBeNull()

    const feeCents = Number(body?.get('metadata[feeCents]') ?? 0)
    expect(body?.get('payment_intent_data[application_fee_amount]')).toBe(
      String(feeCents),
    )
    // The merchant's 8.25% rides as an ordinary `line_items[1]` product line
    // (AGL-1711), so it is part of the charge and flows to the merchant.
    const merchantTaxCents = Number(
      body?.get('line_items[1][price_data][unit_amount]') ?? 0,
    )
    expect(merchantTaxCents).toBe(825)
    const settled = settleDestinationCharge(body, {
      // Already inside the line items on this path, so Stripe adds nothing.
      taxCents: 0,
      shippingCents: merchantTaxCents,
    })
    expect(settled.platformKeepsCents).toBe(feeCents)
    expect(settled.toMerchantCents).toBe(10000 + merchantTaxCents - feeCents)
  })
})

describe('destinationChargeParams (AGL-1956)', () => {
  it('emits exactly one of the two knobs, never both', () => {
    const platform = CommerceModel.destinationChargeParams({
      accountId: 'acct_1',
      feeCents: 500,
      taxOwner: 'platform',
      merchantGoodsCents: 10000,
      shippingFloorCents: 0,
    })
    expect(platform['payment_intent_data[transfer_data][amount]']).toBe('9500')
    expect(
      platform['payment_intent_data[application_fee_amount]'],
    ).toBeUndefined()

    const merchant = CommerceModel.destinationChargeParams({
      accountId: 'acct_1',
      feeCents: 500,
      taxOwner: 'merchant',
      merchantGoodsCents: 10000,
      shippingFloorCents: 0,
    })
    expect(merchant['payment_intent_data[application_fee_amount]']).toBe('500')
    expect(
      merchant['payment_intent_data[transfer_data][amount]'],
    ).toBeUndefined()
  })

  it('pays the merchant their cheapest shipping, so the transfer is always payable', () => {
    // The dearest would be unsafe: a shopper who picks the cheapest produces a
    // charge SMALLER than a transfer computed at the dearest, and Stripe
    // rejects a transfer larger than its charge — failing the payment outright
    // rather than merely mis-splitting it.
    const floor = CommerceModel.shippingFloorCents([
      { amountCents: 2500 },
      { amountCents: 500 },
      { amountCents: 1200 },
    ])
    expect(floor).toBe(500)
    expect(CommerceModel.shippingFloorCents([])).toBe(0)
    expect(
      CommerceModel.platformLiableTransferCents({
        feeCents: 300,
        merchantGoodsCents: 10000,
        shippingFloorCents: floor,
      }),
    ).toBe(10200)
  })

  it('never emits a negative transfer, and still emits a zero one', () => {
    // `resolveTransactionFeeCents` passes Stripe's fixed 30¢ through, so a
    // sub-dollar order really can carry a fee worth more than the goods.
    const split = {
      accountId: 'acct_1',
      feeCents: 80,
      taxOwner: 'platform' as const,
      merchantGoodsCents: 50,
      shippingFloorCents: 0,
    }
    expect(CommerceModel.platformLiableTransferCents(split)).toBe(0)
    // Emitted at zero rather than omitted: an ABSENT `transfer_data[amount]`
    // means "transfer the whole charge", which is the defect coming back.
    expect(
      CommerceModel.destinationChargeParams(split)[
        'payment_intent_data[transfer_data][amount]'
      ],
    ).toBe('0')
  })
})
