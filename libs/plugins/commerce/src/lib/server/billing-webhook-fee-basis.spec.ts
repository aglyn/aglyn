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
  subscriptionInvoiceFeeBasisCents,
  subscriptionInvoiceItemsOnlyFeeCents,
} from '../model'

/**
 * A subscription's platform fee is taken on ITEMS ONLY (AGL-2317).
 *
 * `checkout.ts` sends `subscription_data[application_fee_percent]`, which
 * Stripe applies to the WHOLE invoice — so Aglyn took a percentage of sales
 * tax, which is money owed to a state, and of shipping. Every one-time door
 * computes an `application_fee_amount` in cents on post-discount items.
 *
 * ## What these tests are built to catch
 *
 * A fee test that asserts "the fee is N%" proves nothing about the branch where
 * the fee is skipped, and a test that passes whether or not tax is in the base
 * is measuring nothing. So every case here pins an EXACT cents figure against
 * an invoice that carries tax AND shipping, and the untaxed invoice is asserted
 * to make no Stripe call at all — the two directions are separate assertions,
 * not one.
 *
 * Same harness shape as `billing-webhook-renewal.spec.ts`: the handler returns
 * nothing, so every assertion is about what landed in the database or on the
 * wire. `global.fetch` is a mock — localhost carries the LIVE secret key, so no
 * real Stripe path may be exercised on any run.
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
    }),
}

let orgFixture: any = { id: 'org-1', plan: 'business', ownerUid: 'owner-1' }

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
  upsertHostContact: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

/** What `GET /v1/application_fees` answers with; mutated per case. */
let applicationFee: any = { id: 'fee_1', amount: 227, amount_refunded: 0 }
/** Status the refund POST answers with. */
let refundStatus = 200

const defaultFetch = async (url: any, _init?: any): Promise<any> => {
  const href = String(url)
  if (href.includes('/v1/application_fees') && href.includes('/refunds')) {
    return {
      ok: refundStatus < 400,
      status: refundStatus,
      json: async () => ({ id: 'fr_1' }),
    } as any
  }
  if (href.includes('/v1/application_fees')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: applicationFee ? [applicationFee] : [] }),
    } as any
  }
  if (href.includes('/v1/payment_intents/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pi_2', latest_charge: 'ch_from_pi' }),
    } as any
  }
  // The AGL-2289 re-price and the AGL-2071 lapse stop both land here.
  if (href.includes('/v1/subscriptions/')) {
    return { ok: true, status: 200, json: async () => ({ id: 'sub_1' }) } as any
  }
  throw new Error(`Unexpected fetch to ${href}`)
}

const fetchMock = jest.fn(defaultFetch)

/** The fee-basis correction: `POST /v1/application_fees/{id}/refunds`. */
function refundCalls() {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).includes('/refunds'),
  )
}

/** Every read or write this correction makes against the fee objects. */
function feeLookupCalls() {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).includes('/v1/application_fees'),
  )
}

function refundedAmount(): number {
  const body = String((refundCalls()[0]?.[1] as any)?.body ?? '')
  return Number(new URLSearchParams(body).get('amount'))
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

/**
 * A renewal that carries BOTH of the parts the fee must not be taken on.
 *
 *   items (post-discount)   10000    $100.00 of goods
 *   + shipping                500    a $5.00 rate
 *   + tax                     825    8.25% — the state's money
 *   = total                 11325
 *
 * Stripe applied the subscription's `application_fee_percent` of 2% to that
 * WHOLE total: 227¢. The items-only figure at the same rate is 200¢, so 27¢ of
 * this fee was taken out of tax and shipping.
 */
const TAXED_INVOICE = {
  id: 'in_2',
  object: 'invoice',
  customer: 'cus_1',
  subscription: 'sub_1',
  billing_reason: 'subscription_cycle',
  currency: 'usd',
  amount_paid: 11325,
  subtotal: 10000,
  total: 11325,
  tax: 825,
  shipping_cost: { amount_total: 500 },
  application_fee_amount: 227,
  charge: 'ch_2',
  period_start: 1800000000,
  period_end: 1802678400,
  status_transitions: { paid_at: 1800000005 },
  customer_email: 'boxer@example.com',
  lines: {
    data: [
      {
        amount: 10000,
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

/** The same cycle in a store that collects no tax and ships nothing. */
const PLAIN_INVOICE = {
  ...TAXED_INVOICE,
  id: 'in_3',
  amount_paid: 10000,
  total: 10000,
  tax: 0,
  shipping_cost: null,
  application_fee_amount: 200,
}

async function deliver(object: any, type = 'invoice.paid') {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'acme.aglyn.app',
  } as any)
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
  fetchMock.mockReset()
  fetchMock.mockImplementation(defaultFetch)
  applicationFee = { id: 'fee_1', amount: 227, amount_refunded: 0 }
  refundStatus = 200

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    subscription: { interval: 'month' },
    variants: [
      { id: 'large', priceUsd: 50, sku: 'BOX-L', options: { size: 'Large' } },
    ],
  })
  docs.set('hosts/host-1/subscriptions/sub_1', {
    ...SOLD_SUBSCRIPTION,
    // Agrees with the plan, so the AGL-2289 re-pricer makes no call and every
    // Stripe assertion below is about THIS correction.
    appliedFeePct: 2,
  })
  orgFixture = { id: 'org-1', plan: 'business', ownerUid: 'owner-1' }
  process.env.STRIPE_SECRET_KEY = 'sk_test_fee_basis_spec'
})

// ---------------------------------------------------------------------------
// The base, in isolation
// ---------------------------------------------------------------------------

describe('the items-only fee base (AGL-2317)', () => {
  it('removes tax and shipping from the invoice total', () => {
    expect(subscriptionInvoiceFeeBasisCents(TAXED_INVOICE)).toBe(10000)
  })

  /**
   * The scalar `tax` was REMOVED on newer API versions in favour of
   * `total_taxes[]`, and which version this endpoint speaks is dashboard
   * configuration. Reading only the scalar would value tax at 0 and hand back
   * the whole invoice total as the base — the very bug this closes, restored
   * silently by a Stripe upgrade nobody in this repo can see.
   */
  it('reads tax on the newer `total_taxes` spelling too', () => {
    const newer = { ...TAXED_INVOICE, tax: undefined, total_taxes: [{ amount: 825 }] }
    expect(subscriptionInvoiceFeeBasisCents(newer)).toBe(10000)
    expect(subscriptionInvoiceItemsOnlyFeeCents(newer)).toBe(200)
  })

  it('and on the `total_tax_amounts` spelling between them', () => {
    const middle = {
      ...TAXED_INVOICE,
      tax: undefined,
      total_tax_amounts: [{ amount: 600 }, { amount: 225 }],
    }
    expect(subscriptionInvoiceFeeBasisCents(middle)).toBe(10000)
  })

  /**
   * The rate is never named. Whatever produced `application_fee_amount` — the
   * sale-time rate, one AGL-2289 has re-priced, a staff override — comes
   * through untouched and only the tax/shipping portion is removed. Pricing is
   * locked, so this must be a BASE correction that cannot become a rate one.
   */
  it('scales whatever rate Stripe applied, never a rate of its own', () => {
    // 5% of the same total is 566¢; items-only at 5% is 500¢.
    expect(
      subscriptionInvoiceItemsOnlyFeeCents({
        ...TAXED_INVOICE,
        application_fee_amount: 566,
      }),
    ).toBe(500)
  })

  it('leaves an untaxed, unshipped invoice exactly as Stripe charged it', () => {
    expect(subscriptionInvoiceFeeBasisCents(PLAIN_INVOICE)).toBe(10000)
    expect(subscriptionInvoiceItemsOnlyFeeCents(PLAIN_INVOICE)).toBe(200)
  })

  it('answers 0 where no fee was charged at all', () => {
    expect(
      subscriptionInvoiceItemsOnlyFeeCents({
        ...TAXED_INVOICE,
        application_fee_amount: 0,
      }),
    ).toBe(0)
  })

  /** A cent, never zero, wherever a rate applies — matching `checkout.ts`. */
  it('floors a surviving fee at one cent', () => {
    expect(
      subscriptionInvoiceItemsOnlyFeeCents({
        ...TAXED_INVOICE,
        total: 11325,
        application_fee_amount: 1,
      }),
    ).toBe(1)
  })

  /** An invoice that is nothing but tax has no items to charge a fee on. */
  it('answers 0 when the invoice is tax alone', () => {
    expect(
      subscriptionInvoiceItemsOnlyFeeCents({
        total: 825,
        tax: 825,
        application_fee_amount: 16,
      }),
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The correction, on the wire
// ---------------------------------------------------------------------------

describe('a paid subscription invoice (AGL-2317)', () => {
  /**
   * THE DEFECT, end to end. Stripe took 2% of $113.25; Aglyn keeps 2% of the
   * $100.00 of goods and hands the other 27¢ back to the merchant, who owes it
   * onward to the state.
   */
  it('refunds the part of the fee taken on tax and shipping', async () => {
    await deliver(TAXED_INVOICE)

    expect(refundCalls()).toHaveLength(1)
    expect(String(refundCalls()[0][0])).toContain(
      '/v1/application_fees/fee_1/refunds',
    )
    expect(refundedAmount()).toBe(27)
    // Keyed on the invoice, so the `invoice.paid` /
    // `invoice.payment_succeeded` pair cannot refund twice.
    expect((refundCalls()[0][1] as any).headers['Idempotency-Key']).toBe(
      'fee-basis-in_2',
    )
  })

  /**
   * THE BASIS, pinned as a number. A test that only asserted "a refund
   * happened" would pass against a correction that removed the wrong amount,
   * and one that asserted the fee is "2%" would pass against the bug.
   */
  it('records the fee on the items-only figure, not on Stripe’s', async () => {
    await deliver(TAXED_INVOICE)

    const stored = invoiceDocs()[0] as any
    expect(stored.totals.feeCents).toBe(200)
    expect(stored.totals.taxCents).toBe(825)
    expect(stored.totals.shippingCents).toBe(500)
    // The invoice's own parts are untouched — only Aglyn's cut moved.
    expect(stored.paidCents).toBe(11325)
  })

  /**
   * The OPENING cycle, which is the half no draft-invoice hook can reach: a
   * subscription bought through Checkout has its first invoice created,
   * finalised and paid inside the session. It is corrected here like any other.
   */
  it('corrects the opening cycle as well as a renewal', async () => {
    await deliver({ ...TAXED_INVOICE, billing_reason: 'subscription_create' })

    expect(refundedAmount()).toBe(27)
    expect((invoiceDocs()[0] as any).totals.feeCents).toBe(200)
  })

  /**
   * THE SKIPPED BRANCH, asserted separately. Most stores collect no tax and a
   * subscription carries no shipping rate, so this is the common path and it
   * must cost nothing: not a refund, not even the lookup that precedes one.
   */
  it('makes no Stripe call at all when there is no tax or shipping', async () => {
    await deliver(PLAIN_INVOICE)

    expect(feeLookupCalls()).toHaveLength(0)
    expect((invoiceDocs()[0] as any).totals.feeCents).toBe(200)
  })

  it('makes no Stripe call on a plan that charges no fee', async () => {
    await deliver({ ...TAXED_INVOICE, application_fee_amount: 0 })

    expect(feeLookupCalls()).toHaveLength(0)
    expect((invoiceDocs()[0] as any).totals.feeCents).toBe(0)
  })

  /**
   * The second delivery of one payment. Stripe sends `invoice.paid` AND
   * `invoice.payment_succeeded`, and the invoice's `application_fee_amount`
   * still reads 227 on the redelivery — so the guard cannot be the invoice
   * field. It is the fee's own `amount_refunded`.
   */
  it('refunds nothing a second time when the pair both arrive', async () => {
    await deliver(TAXED_INVOICE)
    expect(refundCalls()).toHaveLength(1)

    applicationFee = { id: 'fee_1', amount: 227, amount_refunded: 27 }
    await deliver(TAXED_INVOICE, 'invoice.payment_succeeded')

    expect(refundCalls()).toHaveLength(1)
  })

  /** No `charge` on the newer API versions — the payment intent names it. */
  it('finds the fee through the payment intent when the invoice names no charge', async () => {
    await deliver({ ...TAXED_INVOICE, charge: undefined, payment_intent: 'pi_2' })

    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/v1/payment_intents/pi_2'),
      ),
    ).toBe(true)
    expect(
      String(feeLookupCalls()[0][0]).includes('charge=ch_from_pi'),
    ).toBe(true)
    expect(refundedAmount()).toBe(27)
  })

  /**
   * A transient refusal must not leave a ledger row claiming a fee that was
   * never corrected. It throws, Stripe redelivers, and the invoice-id guard
   * makes the retry re-run this and nothing else.
   */
  it('throws and files nothing when Stripe is transiently unavailable', async () => {
    refundStatus = 503

    await expect(deliver(TAXED_INVOICE)).rejects.toThrow(/items-only fee/)
    expect(invoiceDocs()).toHaveLength(0)
  })

  /**
   * A definitive refusal is the opposite call: no redelivery fixes it, and
   * throwing would have Stripe retry the invoice forever (the AGL-1743
   * lesson). The cycle is recorded with the fee that was ACTUALLY taken, so
   * the merchant's books match their Stripe balance.
   */
  it('records the fee Stripe really took when the correction is refused', async () => {
    refundStatus = 400

    await deliver(TAXED_INVOICE)

    expect(invoiceDocs()).toHaveLength(1)
    expect((invoiceDocs()[0] as any).totals.feeCents).toBe(227)
  })
})
