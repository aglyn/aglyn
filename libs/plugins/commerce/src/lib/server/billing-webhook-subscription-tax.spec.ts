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

import { commerceBillingWebhookHandler } from './billing-webhook'
import {
  subscriptionInvoiceTaxOwner,
  subscriptionInvoiceTaxReversal,
} from '../model'

/**
 * A STRIPE-TAX SUBSCRIPTION CYCLE LEAVES THE TAX WITH AGLYN (AGL-1956).
 *
 * ## What these tests are built to catch
 *
 * The failure this closes is not "no reversal call was made" — it is "the tax
 * ended up in the wrong balance". Those are different assertions, and only the
 * second one is worth writing: a test that asserted `POST /reversals` happened
 * would pass against a reversal of the WRONG AMOUNT, against one pointed at the
 * wrong transfer, and against one that fired on a merchant's own manual tax.
 *
 * So the harness below models the destination-charge ledger — the charge, the
 * transfer, the application fee, the AGL-2317 fee refund and the reversal — and
 * every money assertion is stated as `merchantNetCents()` and
 * `platformNetCents()`. Those two are computed from what actually went over the
 * wire, so an incorrect amount lands in the balances rather than in a call
 * count. Wire-shape assertions (the idempotency key, which transfer was hit)
 * are marked as STRUCTURAL where they appear and never stand alone.
 *
 * `global.fetch` is a mock and the key is asserted `sk_test_`: localhost
 * carries the LIVE secret, so no real Stripe path may be exercised on any run.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

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
    doc: (id?: string) => {
      if (id && /^__.*__$/.test(id)) {
        const error: any = new Error(
          `INVALID_ARGUMENT: Document name "${path}/${id}" is invalid`,
        )
        error.code = 3
        throw error
      }
      return makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`)
    },
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
    where: () => ref,
    limit: () => ref,
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
      update: (ref: any, value: any) => {
        void ref.set(value, { merge: true })
      },
    }),
}

let orgFixture: any = { id: 'org-1', plan: 'business', ownerUid: 'owner-1' }
const staffNotifications: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
        increment: (value: number) => ({ __increment: value }),
      },
    },
  },
  findUserByUidAcrossPools: async () => null,
  getOrgForHost: async () => ({ org: orgFixture }),
  meterHostEmail: async () => undefined,
  notifyHostManagers: async () => undefined,
  notifyStaff: async (payload: any) => {
    staffNotifications.push(payload)
  },
  upsertHostContact: async () => undefined,
  renderHostEmailWithTokens: async () => null,
  syncConnectAccountStatus: async () => undefined,
  updateExisting: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

// ---------------------------------------------------------------------------
// The destination-charge ledger, modelled
// ---------------------------------------------------------------------------

/**
 * A $113.25 cycle on a Stripe Tax storefront.
 *
 *   items                   10000    $100.00 of goods
 *   + shipping                500    a $5.00 rate
 *   + tax                     825    8.25% — computed against AGLYN's
 *   = total                 11325    registrations, so AGLYN remits it
 *
 * The subscription carries `application_fee_percent: 2`, so Stripe debited 227¢
 * (2% of the WHOLE total) and — this is the measured behaviour recorded at
 * `reverseSellerShare` — transferred the FULL charge to the connected account,
 * taking the fee at the destination. `transfer.amount === charge.amount`.
 *
 * AGL-2317 then refunds 27¢ of that fee (the part taken on tax and shipping)
 * back to the merchant, which leaves the merchant holding all 825¢ of tax.
 */
const CHARGE_CENTS = 11325
const TAX_CENTS = 825
const ITEMS_CENTS = 10000
const SHIPPING_CENTS = 500
const STRIPE_FEE_CENTS = 227
const ITEMS_ONLY_FEE_CENTS = 200

/** Mutated per case: what `GET /v1/transfers/{id}` answers. */
let transferFixture: any
/** Mutated per case: what `GET /v1/charges/{id}` answers. */
let chargeFixture: any
/** Status + body the reversal POST answers with. */
let reversalStatus = 200
let reversalErrorBody: any = null
/** The AGL-2317 fee refund standing on the fee object, as Stripe would report. */
let feeRefundedSoFar = 0

const defaultFetch = async (url: any, _init?: any): Promise<any> => {
  const href = String(url)
  if (href.includes('/reversals')) {
    return {
      ok: reversalStatus < 400,
      status: reversalStatus,
      json: async () =>
        reversalStatus < 400
          ? { id: 'trr_1', amount: reversalAmountAsked() }
          : reversalErrorBody,
    } as any
  }
  // STATEFUL, like Stripe. A second delivery must find the AGL-2317 refund
  // already standing on the fee — a fixture that forgot it would let the fee
  // correction run twice and quietly restate the merchant's balance, hiding
  // whatever the reversal guard actually did.
  if (href.includes('/v1/application_fees') && href.includes('/refunds')) {
    feeRefundedSoFar += Number(
      new URLSearchParams(String((_init as any)?.body ?? '')).get('amount') ?? 0,
    )
    return { ok: true, status: 200, json: async () => ({ id: 'fr_1' }) } as any
  }
  if (href.includes('/v1/application_fees')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'fee_1',
            amount: STRIPE_FEE_CENTS,
            amount_refunded: feeRefundedSoFar,
          },
        ],
      }),
    } as any
  }
  if (href.includes('/v1/transfers/')) {
    return { ok: true, status: 200, json: async () => transferFixture } as any
  }
  if (href.includes('/v1/charges/')) {
    return { ok: true, status: 200, json: async () => chargeFixture } as any
  }
  if (href.includes('/v1/payment_intents/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pi_2', latest_charge: 'ch_2' }),
    } as any
  }
  // The AGL-2289 re-price and the AGL-2071 lapse stop both land here.
  if (href.includes('/v1/subscriptions/')) {
    return { ok: true, status: 200, json: async () => ({ id: 'sub_1' }) } as any
  }
  throw new Error(`Unexpected fetch to ${href}`)
}

const fetchMock = jest.fn(defaultFetch)

function callsMatching(fragment: string) {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).includes(fragment),
  )
}

function postedAmount(fragment: string): number {
  const call = callsMatching(fragment)[0]
  if (!call) return 0
  return Number(
    new URLSearchParams(String((call[1] as any)?.body ?? '')).get('amount') ?? 0,
  )
}

function reversalAmountAsked(): number {
  return postedAmount('/reversals')
}

/** Every cent this delivery pulled back out of the connected account. */
function reversedCents(): number {
  return callsMatching('/reversals').reduce(
    (sum, call) =>
      sum +
      Number(
        new URLSearchParams(String((call[1] as any)?.body ?? '')).get(
          'amount',
        ) ?? 0,
      ),
    0,
  )
}

/** Every cent the AGL-2317 correction handed BACK to the connected account. */
function feeRefundedCents(): number {
  return callsMatching('/application_fees').reduce((sum, call) => {
    if (!String(call[0]).includes('/refunds')) return sum
    return (
      sum +
      Number(
        new URLSearchParams(String((call[1] as any)?.body ?? '')).get(
          'amount',
        ) ?? 0,
      )
    )
  }, 0)
}

/**
 * WHAT THE MERCHANT ENDS UP HOLDING, derived from the wire and not asserted
 * piecemeal.
 *
 * Stripe transferred the whole charge and debited the application fee at the
 * destination; the fee refund adds back; the transfer reversal takes away.
 * Stripe's own processing cost is deliberately absent — it comes off the
 * PLATFORM balance on a destination charge and is not part of this split.
 */
function merchantNetCents(): number {
  return (
    Number(transferFixture?.amount ?? 0) -
    STRIPE_FEE_CENTS +
    feeRefundedCents() -
    reversedCents()
  )
}

/** The other side of the same charge: everything the merchant did not keep. */
function platformNetCents(): number {
  return CHARGE_CENTS - merchantNetCents()
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOLD_SUBSCRIPTION = {
  productId: 'product-1',
  variantId: 'large',
  customerEmail: 'boxer@example.com',
  stripeCustomerId: 'cus_1',
  status: 'active',
  appliedFeePct: 2,
  lineItems: [
    {
      productId: 'product-1',
      variantId: 'large',
      name: 'Monthly box',
      variantLabel: 'Large',
      sku: 'BOX-L',
      productType: 'physical',
      quantity: 2,
      unitAmountCents: 5000,
    },
  ],
  interval: 'month',
  createdAtMs: 1799000000000,
}

/** A Stripe Tax cycle: `automatic_tax.enabled`, liability `self` = Aglyn's. */
const STRIPE_TAX_INVOICE = {
  id: 'in_2',
  object: 'invoice',
  customer: 'cus_1',
  subscription: 'sub_1',
  billing_reason: 'subscription_cycle',
  currency: 'usd',
  amount_paid: CHARGE_CENTS,
  subtotal: ITEMS_CENTS,
  total: CHARGE_CENTS,
  tax: TAX_CENTS,
  automatic_tax: { enabled: true, liability: { type: 'self' } },
  shipping_cost: { amount_total: SHIPPING_CENTS },
  application_fee_amount: STRIPE_FEE_CENTS,
  charge: 'ch_2',
  period_start: 1800000000,
  period_end: 1802678400,
  status_transitions: { paid_at: 1800000005 },
  customer_email: 'boxer@example.com',
  lines: {
    data: [
      {
        amount: ITEMS_CENTS,
        quantity: 2,
        description: '2 × Monthly box',
        price: { unit_amount: 5000, recurring: { interval: 'month' } },
      },
    ],
  },
  subscription_details: {
    metadata: {
      type: 'commerce-subscription',
      hostId: 'host-1',
      productId: 'product-1',
    },
  },
}

/**
 * THE SAME NUMBERS, but the merchant configured the rate themselves
 * (AGL-1751). `automatic_tax` is off and the tax rides a real Stripe Tax Rate,
 * so `total_taxes[]` is populated and looks IDENTICAL to a Stripe Tax cycle by
 * shape. This is the fixture that catches a reader that trusts the lines.
 */
const MANUAL_TAX_INVOICE = {
  ...STRIPE_TAX_INVOICE,
  id: 'in_manual',
  tax: undefined,
  automatic_tax: { enabled: false },
  total_taxes: [{ amount: TAX_CENTS }],
}

async function deliver(object: any, type = 'invoice.paid') {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
}

function markerDoc(invoiceId = 'in_2') {
  return docs.get(
    `hosts/host-1/subscriptions/sub_1/taxReversals/${invoiceId}`,
  ) as any
}

function invoiceDocs() {
  return childPaths('hosts/host-1/subscriptions/sub_1/invoices').map((path) =>
    docs.get(path),
  )
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  autoIdCounter = 0
  staffNotifications.length = 0
  fetchMock.mockReset()
  fetchMock.mockImplementation(defaultFetch)
  reversalStatus = 200
  reversalErrorBody = null
  feeRefundedSoFar = 0
  chargeFixture = {
    id: 'ch_2',
    amount: CHARGE_CENTS,
    transfer: 'tr_1',
  }
  transferFixture = {
    id: 'tr_1',
    amount: CHARGE_CENTS,
    amount_reversed: 0,
    reversals: { data: [] },
  }

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    subscription: { interval: 'month' },
    variants: [
      { id: 'large', priceUsd: 50, sku: 'BOX-L', options: { size: 'Large' } },
    ],
  })
  docs.set('hosts/host-1/subscriptions/sub_1', SOLD_SUBSCRIPTION)
  orgFixture = { id: 'org-1', plan: 'business', ownerUid: 'owner-1' }
  process.env.STRIPE_SECRET_KEY = 'sk_test_subscription_tax_spec'
})

// ---------------------------------------------------------------------------
// The decision, in isolation
// ---------------------------------------------------------------------------

describe('who owns the tax on a subscription invoice (AGL-1956)', () => {
  it('names Aglyn on an automatic-tax invoice', () => {
    expect(subscriptionInvoiceTaxOwner(STRIPE_TAX_INVOICE)).toBe('platform')
  })

  /**
   * The distinction that must not be got backwards: a manual rate is the
   * merchant's own tax and reversing it would take money that is genuinely
   * theirs. Both fixtures state 825¢ of tax in a populated array shape.
   */
  it('names the merchant on a manual-rate invoice that looks identical', () => {
    expect(subscriptionInvoiceTaxOwner(MANUAL_TAX_INVOICE)).toBe('merchant')
    expect(subscriptionInvoiceTaxReversal(MANUAL_TAX_INVOICE)).toEqual({
      kind: 'skip',
      reason: 'merchant-tax',
    })
  })

  it('names the merchant when Stripe computed against THEIR registrations', () => {
    expect(
      subscriptionInvoiceTaxOwner({
        automatic_tax: { enabled: true, liability: { type: 'account' } },
      }),
    ).toBe('merchant')
  })

  it('reads the tax off the scalar spelling', () => {
    expect(subscriptionInvoiceTaxReversal(STRIPE_TAX_INVOICE)).toEqual({
      kind: 'reverse',
      taxCents: TAX_CENTS,
    })
  })

  /**
   * Stripe removed the scalar in favour of `total_taxes[]`, and which spelling
   * this endpoint receives is dashboard configuration. Reading only the scalar
   * would answer "no tax" after a version bump nobody here can see.
   */
  it('reads it off `total_taxes` and `total_tax_amounts` too', () => {
    expect(
      subscriptionInvoiceTaxReversal({
        automatic_tax: { enabled: true },
        total_taxes: [{ amount: 600 }, { amount: 225 }],
      }),
    ).toEqual({ kind: 'reverse', taxCents: 825 })
    expect(
      subscriptionInvoiceTaxReversal({
        automatic_tax: { enabled: true },
        total_tax_amounts: [{ amount: 825 }],
      }),
    ).toEqual({ kind: 'reverse', taxCents: 825 })
  })

  /**
   * A MISSING FIELD IS NOT A ZERO. This is the swallowed-read shape: an
   * invoice claiming automatic tax while naming no tax field at all must be
   * loud, because the alternative reads as "nothing to reverse" and leaks the
   * whole liability with nothing looking wrong.
   */
  it('refuses to read a missing tax field as no tax', () => {
    const decision = subscriptionInvoiceTaxReversal({
      automatic_tax: { enabled: true },
      total: CHARGE_CENTS,
    })
    expect(decision.kind).toBe('unreadable')
  })

  it('treats a null scalar as missing, not as a stated zero', () => {
    expect(
      subscriptionInvoiceTaxReversal({
        automatic_tax: { enabled: true },
        tax: null,
      }).kind,
    ).toBe('unreadable')
  })

  it('and refuses a tax line whose amount will not parse', () => {
    expect(
      subscriptionInvoiceTaxReversal({
        automatic_tax: { enabled: true },
        total_taxes: [{ amount: 600 }, { amount: 'oops' }],
      }).kind,
    ).toBe('unreadable')
  })

  /** A stated zero, and a present-but-empty array, are real answers. */
  it('accepts a stated zero as a clean skip', () => {
    expect(
      subscriptionInvoiceTaxReversal({ automatic_tax: { enabled: true }, tax: 0 }),
    ).toEqual({ kind: 'skip', reason: 'no-tax' })
    expect(
      subscriptionInvoiceTaxReversal({
        automatic_tax: { enabled: true },
        total_taxes: [],
      }),
    ).toEqual({ kind: 'skip', reason: 'no-tax' })
  })
})

// ---------------------------------------------------------------------------
// The money, end to end
// ---------------------------------------------------------------------------

describe('a Stripe Tax subscription cycle (AGL-1956)', () => {
  it('never lets a live key into this suite', () => {
    expect(String(process.env.STRIPE_SECRET_KEY)).toMatch(/^sk_test_/)
  })

  /**
   * THE DEFECT, stated as balances. Before this fix the merchant kept
   * 11325 − 227 + 27 = 11125, which is the goods, the shipping AND all 825¢ of
   * a tax Aglyn remits. After it they keep the goods and shipping less Aglyn's
   * items-only cut, and every cent of tax is on the platform balance.
   *
   * BEHAVIOURAL: both numbers are derived from what went over the wire, so a
   * reversal of the wrong amount fails here rather than passing a call count.
   */
  it('leaves the whole tax with the platform and the goods with the merchant', async () => {
    await deliver(STRIPE_TAX_INVOICE)

    expect(merchantNetCents()).toBe(
      ITEMS_CENTS + SHIPPING_CENTS - ITEMS_ONLY_FEE_CENTS,
    )
    expect(platformNetCents()).toBe(TAX_CENTS + ITEMS_ONLY_FEE_CENTS)
    expect(reversedCents()).toBe(TAX_CENTS)
  })

  /**
   * The same split the ONE-OFF path fixes up front (AGL-1956's
   * `platformLiableTransferCents`). Stated separately because the recurring
   * and one-time doors selling the same product must pay the same merchant the
   * same money.
   */
  it('lands on the identical split a one-off destination charge is fixed to', async () => {
    await deliver(STRIPE_TAX_INVOICE)

    // goods + cheapest shipping − fee, the one-off formula, evaluated here.
    expect(merchantNetCents()).toBe(10300)
  })

  /** STRUCTURAL: the reversal is aimed at the transfer named by the CHARGE. */
  it('finds the transfer through the charge, never through the invoice', async () => {
    await deliver(STRIPE_TAX_INVOICE)

    expect(callsMatching('/v1/charges/ch_2')).toHaveLength(1)
    expect(String(callsMatching('/reversals')[0][0])).toContain(
      '/v1/transfers/tr_1/reversals',
    )
  })

  /** STRUCTURAL: the key is deterministic on the invoice id and nothing else. */
  it('keys the reversal on the invoice id', async () => {
    await deliver(STRIPE_TAX_INVOICE)

    expect(
      (callsMatching('/reversals')[0][1] as any).headers['Idempotency-Key'],
    ).toBe('subscription-tax-reversal-in_2')
  })

  it('records what it pulled back, so a shortfall is queryable', async () => {
    await deliver(STRIPE_TAX_INVOICE)

    expect(markerDoc()).toMatchObject({
      invoiceId: 'in_2',
      hostId: 'host-1',
      status: 'reversed',
      reversedCents: TAX_CENTS,
      taxCents: TAX_CENTS,
      transferId: 'tr_1',
    })
    expect(markerDoc().owedCents).toBeUndefined()
  })

  /** The cycle is still recorded — this fix must not cost the ledger a row. */
  it('still files the invoice and the fulfilment order', async () => {
    await deliver(STRIPE_TAX_INVOICE)

    expect(invoiceDocs()).toHaveLength(1)
    expect((invoiceDocs()[0] as any).paidCents).toBe(CHARGE_CENTS)
  })

  /**
   * THE MERCHANT'S OWN TAX STAYS WITH THEM. Getting this backwards steals from
   * the merchant, so it is asserted on the balances too and not just on the
   * absence of a call.
   */
  it('reverses nothing on a manual-rate cycle, and makes no call to do it', async () => {
    await deliver(MANUAL_TAX_INVOICE)

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(callsMatching('/v1/charges/')).toHaveLength(0)
    expect(reversedCents()).toBe(0)
    expect(
      docs.get('hosts/host-1/subscriptions/sub_1/taxReversals/in_manual'),
    ).toBeUndefined()
  })

  /** A $0 or fully-discounted cycle is a clean no-op, never an error. */
  it('is a silent no-op on a $0 invoice', async () => {
    await expect(
      deliver({
        ...STRIPE_TAX_INVOICE,
        id: 'in_zero',
        amount_paid: 0,
        total: 0,
        tax: 0,
        application_fee_amount: 0,
        charge: null,
      }),
    ).resolves.toBeUndefined()

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(staffNotifications).toHaveLength(0)
  })

  /** No charge on the invoice: nothing was transferred, nothing to reverse. */
  it('records a no-charge invoice rather than throwing', async () => {
    chargeFixture = { id: 'ch_2', amount: CHARGE_CENTS, transfer: null }
    await deliver({ ...STRIPE_TAX_INVOICE, charge: null, payment_intent: null })

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(markerDoc()).toMatchObject({ status: 'no-charge', reversedCents: 0 })
  })

  it('records a charge with no transfer rather than throwing', async () => {
    chargeFixture = { id: 'ch_2', amount: CHARGE_CENTS, transfer: null }
    await deliver(STRIPE_TAX_INVOICE)

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(markerDoc()).toMatchObject({ status: 'no-transfer', reversedCents: 0 })
  })
})

// ---------------------------------------------------------------------------
// Redelivery
// ---------------------------------------------------------------------------

describe('a redelivered subscription invoice (AGL-1956)', () => {
  /**
   * THE ONE THAT MATTERS MOST. Stripe sends `invoice.paid` AND
   * `invoice.payment_succeeded` for the same payment and redelivers on top of
   * that; a reversal applied twice takes the merchant's money twice.
   *
   * BEHAVIOURAL: the assertion is that the SECOND delivery moves nothing, and
   * that the merchant's balance after two deliveries is the same as after one.
   */
  it('reverses nothing on the second delivery of one payment', async () => {
    await deliver(STRIPE_TAX_INVOICE)
    const afterFirst = merchantNetCents()
    expect(reversedCents()).toBe(TAX_CENTS)

    // Stripe now reports the reversal on the transfer, as it would in reality.
    transferFixture = {
      ...transferFixture,
      amount_reversed: TAX_CENTS,
      reversals: {
        data: [
          {
            id: 'trr_1',
            amount: TAX_CENTS,
            metadata: { aglynTaxInvoiceId: 'in_2' },
          },
        ],
      },
    }
    await deliver(STRIPE_TAX_INVOICE, 'invoice.payment_succeeded')

    expect(callsMatching('/reversals')).toHaveLength(1)
    expect(reversedCents()).toBe(TAX_CENTS)
    expect(merchantNetCents()).toBe(afterFirst)
    expect(markerDoc().reversedCents).toBe(TAX_CENTS)
  })

  /**
   * The crash window: the POST landed and the record never did. The next
   * delivery must ADOPT what is on the transfer, not create a second reversal.
   */
  it('adopts a reversal it finds on the transfer instead of making another', async () => {
    transferFixture = {
      ...transferFixture,
      amount_reversed: TAX_CENTS,
      reversals: {
        data: [
          {
            id: 'trr_orphan',
            amount: TAX_CENTS,
            metadata: { aglynTaxInvoiceId: 'in_2' },
          },
        ],
      },
    }

    await deliver(STRIPE_TAX_INVOICE)

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(markerDoc()).toMatchObject({
      status: 'reversed',
      reversedCents: TAX_CENTS,
      reversalId: 'trr_orphan',
      adopted: true,
    })
  })

  /** Another invoice's reversal on the same transfer is NOT ours to adopt. */
  it('does not adopt a reversal stamped with a different invoice', async () => {
    transferFixture = {
      ...transferFixture,
      reversals: {
        data: [
          { id: 'trr_other', amount: 100, metadata: { aglynTaxInvoiceId: 'in_9' } },
        ],
      },
    }

    await deliver(STRIPE_TAX_INVOICE)

    expect(reversedCents()).toBe(TAX_CENTS)
  })
})

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

describe('when the reversal cannot be made (AGL-1956)', () => {
  /**
   * Transient: the marker is unclaimed, so the redelivery Stripe sends IS the
   * retry. The cycle is already on the ledger — money collected is never left
   * unfiled — and only the reversal replays.
   */
  it('throws on a transient refusal, with the cycle already recorded', async () => {
    reversalStatus = 503
    reversalErrorBody = { error: { message: 'service unavailable' } }

    await expect(deliver(STRIPE_TAX_INVOICE)).rejects.toThrow(/tax reversal/)
    expect(invoiceDocs()).toHaveLength(1)
    expect(markerDoc()).toBeUndefined()
  })

  /**
   * INSUFFICIENT BALANCE is neither transient nor final: it is money Aglyn
   * owes a state and does not have. `reversedCents` is left UNSET so a later
   * delivery re-attempts, the shortfall is recorded, and staff are told.
   */
  it('leaves an insufficient-balance failure retryable, recorded and visible', async () => {
    reversalStatus = 400
    reversalErrorBody = {
      error: { code: 'balance_insufficient', message: 'Insufficient funds' },
    }

    await deliver(STRIPE_TAX_INVOICE)

    expect(markerDoc()).toMatchObject({
      status: 'insufficient',
      owedCents: TAX_CENTS,
      attempts: 1,
    })
    // The claim is NOT set, which is what makes the next delivery try again.
    expect(markerDoc().reversedCents).toBeNull()
    expect(staffNotifications).toHaveLength(1)
    expect(String(staffNotifications[0].body)).toContain('$8.25')

    // And it really does try again.
    reversalStatus = 200
    reversalErrorBody = null
    await deliver(STRIPE_TAX_INVOICE, 'invoice.payment_succeeded')

    expect(markerDoc()).toMatchObject({
      status: 'reversed',
      reversedCents: TAX_CENTS,
      attempts: 2,
    })
  })

  /**
   * A definitive refusal does not throw — that would have Stripe retry the
   * whole invoice forever (AGL-1743) — but it is recorded with the amount
   * still owed and staff are told.
   */
  it('records a definitive refusal without wedging the webhook', async () => {
    reversalStatus = 400
    reversalErrorBody = { error: { code: 'parameter_invalid', message: 'nope' } }

    await deliver(STRIPE_TAX_INVOICE)

    expect(markerDoc()).toMatchObject({
      status: 'refused',
      reversedCents: 0,
      owedCents: TAX_CENTS,
    })
    expect(staffNotifications).toHaveLength(1)
  })

  /**
   * An invoice claiming automatic tax that states no tax field. Loud, on the
   * books, and — critically — NOT silently treated as a zero-tax cycle.
   */
  it('is loud when the invoice will not state its tax', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await deliver({ ...STRIPE_TAX_INVOICE, tax: undefined })

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(markerDoc()).toMatchObject({ status: 'unreadable', reversedCents: 0 })
    expect(staffNotifications).toHaveLength(1)
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes('no readable tax'),
      ),
    ).toBe(true)
    errors.mockRestore()
  })

  /**
   * A refund with `reverse_transfer` got here first. Nothing is left on the
   * transfer, and the shortfall is recorded rather than being reported as a
   * successful zero.
   */
  it('records a transfer with nothing left, and what is still owed', async () => {
    transferFixture = {
      ...transferFixture,
      amount_reversed: CHARGE_CENTS,
      reversals: { data: [] },
    }

    await deliver(STRIPE_TAX_INVOICE)

    expect(callsMatching('/reversals')).toHaveLength(0)
    expect(markerDoc()).toMatchObject({
      status: 'nothing-left',
      reversedCents: 0,
      owedCents: TAX_CENTS,
    })
  })

  /** A partial reversal reverses what it can and records the remainder. */
  it('reverses what the transfer can give and records the shortfall', async () => {
    transferFixture = { ...transferFixture, amount_reversed: CHARGE_CENTS - 300 }

    await deliver(STRIPE_TAX_INVOICE)

    expect(reversedCents()).toBe(300)
    expect(markerDoc()).toMatchObject({
      status: 'reversed',
      reversedCents: 300,
      owedCents: TAX_CENTS - 300,
    })
  })
})
