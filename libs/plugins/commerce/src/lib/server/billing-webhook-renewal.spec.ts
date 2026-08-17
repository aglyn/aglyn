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

/**
 * Storefront subscription RENEWALS (AGL-1743).
 *
 * AGL-1732 gave the initial charge a home on the subscription document and
 * stopped there, because `invoice.payment_succeeded` was unhandled repo-wide:
 * month 2 onward took the customer's money and produced no record anywhere.
 *
 * Same harness as `billing-webhook-subscription.spec.ts` and for the same
 * reason — the handler returns nothing, so every assertion is about WHAT
 * LANDED IN THE DATABASE. Firestore is an in-memory map keyed by document
 * path. `global.fetch` is replaced and asserted unused: localhost carries the
 * LIVE secret key, so no Stripe path may be exercised on any run.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/** Direct children of `path` — a collection `get()` must not return grandchildren. */
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
    /**
     * A document id matching `__.*__` is RESERVED — Firestore rejects the path
     * rather than returning an absent snapshot (AGL-1763). Reproduced because
     * the handler used to reach for `products/__missing__` as a deliberate
     * miss, and a double that quietly returned "not found" for it would hide
     * exactly the throw that dropped the renewal.
     */
    doc: (id?: string) => {
      if (id && /^__.*__$/.test(id)) {
        const error: any = new Error(
          `INVALID_ARGUMENT: Document name "${path}/${id}" is invalid: ` +
            'the id matches the reserved pattern __.*__',
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

const notifications: any[] = []
const contactUpserts: any[] = []

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
  getOrgForHost: async () => ({
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
  meterHostEmail: async () => undefined,
  notifyHostManagers: async (hostId: string, notification: any) => {
    notifications.push({ hostId, ...notification })
  },
  upsertHostContact: async (options: any) => {
    contactUpserts.push(options)
  },
  renderHostEmailWithTokens: async () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

const fetchMock = jest.fn(async (url: any) => {
  throw new Error(`Unexpected fetch to ${String(url)}`)
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The subscription record AGL-1732 writes from the completed Checkout Session:
 * a $50/month box, quantity 2, 10% coupon priced in, $8.25 of manual tax sent
 * as an ordinary one-time line item.
 */
const SOLD_SUBSCRIPTION = {
  productId: 'product-1',
  variantId: 'large',
  customerEmail: 'boxer@example.com',
  customerName: 'Bea Oxer',
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
  totals: {
    itemsCents: 10000,
    shippingCents: 0,
    taxCents: 825,
    discountCents: 1000,
    feeCents: 196,
    totalCents: 9825,
  },
  interval: 'month',
  checkoutSessionId: 'cs_sub_1',
  createdAtMs: 1799000000000,
}

/**
 * Cycle 2, as Stripe sends it.
 *
 * NOT the same amount as the initial charge, deliberately: in `manual` tax
 * mode `checkout.ts` sends the tax as a ONE-TIME `line_items[1]`, which a
 * subscription-mode session bills on the first invoice only. So the renewal
 * collects $90.00 where the sale collected $98.25 — precisely the divergence
 * AGL-1743 describes, and unrecoverable while the frozen initial `totals` was
 * the only figure Aglyn held.
 *
 *   subtotal              10000   Stripe `subtotal` (2 × the 5000 list price)
 *   - discount             1000   Stripe `total_discount_amounts`
 *   + tax                     0   no recurring tax line on a renewal
 *   + shipping                0   Stripe `shipping_cost`
 *   = amount_paid          9000   what actually arrived
 */
const RENEWAL_INVOICE = {
  id: 'in_2',
  object: 'invoice',
  customer: 'cus_1',
  subscription: 'sub_1',
  billing_reason: 'subscription_cycle',
  currency: 'usd',
  number: 'ACME-0002',
  hosted_invoice_url: 'https://invoice.stripe.com/i/in_2',
  amount_paid: 9000,
  subtotal: 10000,
  total: 9000,
  tax: 0,
  total_discount_amounts: [{ amount: 1000, discount: 'di_1' }],
  shipping_cost: null,
  application_fee_amount: 180,
  period_start: 1800000000,
  period_end: 1802678400,
  status_transitions: { paid_at: 1800000005 },
  customer_email: 'boxer@example.com',
  customer_name: 'Bea Oxer',
  lines: {
    data: [
      {
        amount: 9000,
        quantity: 2,
        description: '2 × Monthly box (at $50.00 / month)',
        price: { unit_amount: 5000, recurring: { interval: 'month' } },
        period: { start: 1800000000, end: 1802678400 },
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

async function deliver(object: any, type = 'invoice.payment_succeeded') {
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

function storedSubscription(): any {
  return docs.get('hosts/host-1/subscriptions/sub_1')
}

function orderDocs() {
  return childPaths('hosts/host-1/orders').map((path) => docs.get(path))
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  contactUpserts.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1', { displayName: 'Acme Boxes' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Monthly box',
    type: 'physical',
    subscription: { interval: 'month' },
    variants: [
      { id: 'large', priceUsd: 50, sku: 'BOX-L', options: { size: 'Large' } },
    ],
  })
  docs.set('hosts/host-1/subscriptions/sub_1', { ...SOLD_SUBSCRIPTION })
})

// ---------------------------------------------------------------------------

describe('storefront subscription renewals (AGL-1743)', () => {
  /**
   * THE DEFECT. `invoice.payment_succeeded` was unhandled repo-wide, so every
   * charge after the first produced no record at all. Every assertion here
   * failed before this branch existed — there was no document to read.
   */
  it('records the renewal as its own invoice document', async () => {
    await deliver(RENEWAL_INVOICE)

    expect(invoiceDocs()).toHaveLength(1)
    const stored = invoiceDocs()[0] as any
    expect(stored.invoiceId).toBe('in_2')
    expect(stored.number).toBe('ACME-0002')
    expect(stored.billingReason).toBe('subscription_cycle')
    expect(stored.currency).toBe('usd')
    expect(stored.paidCents).toBe(9000)
    // When the money arrived, and what period it bought.
    expect(stored.paidAtMs).toBe(1800000005000)
    expect(stored.periodStartMs).toBe(1800000000000)
    expect(stored.periodEndMs).toBe(1802678400000)
    // Who it came from.
    expect(stored.customerEmail).toBe('boxer@example.com')
    // And where the merchant can see Stripe's own copy.
    expect(stored.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/in_2')
  })

  /** What the cycle actually bought, decomposed from the invoice's own fields. */
  it('decomposes the renewal into line items and totals', async () => {
    await deliver(RENEWAL_INVOICE)
    const stored = invoiceDocs()[0] as any

    expect(stored.lineItems).toEqual([
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
    ])
    expect(stored.totals.itemsCents).toBe(10000)
    expect(stored.totals.discountCents).toBe(1000)
    expect(stored.totals.taxCents).toBe(0)
    expect(stored.totals.shippingCents).toBe(0)
    // Aglyn's cut, from the invoice's own `application_fee_amount` — a
    // subscription carries `application_fee_percent`, so every cycle has one.
    expect(stored.totals.feeCents).toBe(180)
    expect(stored.totals.totalCents).toBe(9000)
  })

  /**
   * The parts must sum to what Stripe collected. AGL-1698's failure shape was
   * a decomposition that silently did not, so the invariant is asserted rather
   * than assumed.
   */
  it('stores parts that reconcile against the amount paid', async () => {
    await deliver(RENEWAL_INVOICE)
    const { totals } = invoiceDocs()[0] as any
    expect(
      totals.itemsCents +
        totals.shippingCents +
        totals.taxCents -
        totals.discountCents,
    ).toBe(RENEWAL_INVOICE.amount_paid)
  })

  /** Tax and shipping are read from the invoice's fields, not a session's. */
  it('reads tax and shipping off the invoice, which has no total_details', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      amount_paid: 10425,
      total: 10425,
      tax: 825,
      shipping_cost: { amount_total: 600 },
    })
    const { totals } = invoiceDocs()[0] as any
    expect(totals.taxCents).toBe(825)
    expect(totals.shippingCents).toBe(600)
    expect(totals.totalCents).toBe(10425)
  })

  /** The newer API shape, where the scalar `tax` gave way to `total_taxes`. */
  it('reads tax from total_taxes when the scalar field is absent', async () => {
    const { tax: _dropped, ...withoutScalarTax } = RENEWAL_INVOICE as any
    await deliver({
      ...withoutScalarTax,
      amount_paid: 9825,
      total: 9825,
      total_taxes: [{ amount: 825 }],
    })
    expect((invoiceDocs()[0] as any).totals.taxCents).toBe(825)
  })

  /**
   * The subscription document stops diverging. Its `totals` was the initial
   * charge, frozen: a price change, a tax change or a trial converting left
   * Aglyn's record disagreeing with what was being collected, silently.
   */
  it('rolls the renewal onto the subscription document', async () => {
    await deliver(RENEWAL_INVOICE)
    const stored = storedSubscription()

    expect(stored.lastInvoiceId).toBe('in_2')
    expect(stored.lastPaymentCents).toBe(9000)
    expect(stored.lastPaymentAtMs).toBe(1800000005000)
    expect(stored.paidThroughMs).toBe(1802678400000)
    // Lifetime, across every cycle recorded.
    expect(stored.paidCents).toBe(9000)
    expect(stored.invoicesCount).toBe(1)
    // And the frozen figure is refreshed to what this cycle actually cost.
    expect(stored.totals.totalCents).toBe(9000)
    expect(stored.totals.taxCents).toBe(0)
    // The sale record itself survives the merge.
    expect(stored.checkoutSessionId).toBe('cs_sub_1')
    expect(stored.customerEmail).toBe('boxer@example.com')
  })

  it('accumulates across cycles', async () => {
    await deliver(RENEWAL_INVOICE)
    await deliver({
      ...RENEWAL_INVOICE,
      id: 'in_3',
      number: 'ACME-0003',
      period_start: 1802678400,
      period_end: 1805356800,
      status_transitions: { paid_at: 1802678405 },
    })

    expect(invoiceDocs()).toHaveLength(2)
    const stored = storedSubscription()
    expect(stored.paidCents).toBe(18000)
    expect(stored.invoicesCount).toBe(2)
    expect(stored.lastInvoiceId).toBe('in_3')
    expect(stored.paidThroughMs).toBe(1805356800000)
  })

  /**
   * Product intent, pinned. Subscriptions are deliberately NOT orders — the
   * merchant docs say so, the console keeps Orders and Subscriptions apart,
   * and the tenant account page renders them separately. Whether a PHYSICAL
   * renewal should also produce a fulfilment artifact is the open product
   * question (AGL-1743 §1); until it is answered, a renewal must not start
   * manufacturing order rows in tables and revenue charts that would then
   * need unpicking.
   */
  it('creates no order document', async () => {
    await deliver(RENEWAL_INVOICE)
    expect(orderDocs()).toHaveLength(0)
    expect(docs.has('hosts/host-1/counters/orders')).toBe(false)
  })

  /**
   * RFM (AGL-328) counts a subscriber's lifetime value. AGL-1732 made the
   * first charge count; a subscriber in month 12 who has paid twelve times
   * must not still rank as a one-payment customer.
   */
  it('rolls the renewal into the contact lifetime value', async () => {
    await deliver(RENEWAL_INVOICE)
    expect(contactUpserts).toHaveLength(1)
    expect(contactUpserts[0].purchaseCents).toBe(9000)
    expect(contactUpserts[0].email).toBe('boxer@example.com')
    expect(contactUpserts[0].interaction.refId).toBe('in_2')
  })

  /**
   * The console has no Subscriptions tab, so a notification is the only place
   * a merchant learns the money arrived at all.
   */
  it('tells the managers the money arrived, and how much', async () => {
    await deliver(RENEWAL_INVOICE)
    expect(notifications).toHaveLength(1)
    // The cadence rides the title exactly as the *New subscriber* one does
    // (AGL-1732) — $90.00 a month and $90.00 a year are the same number.
    expect(notifications[0].title).toBe('Subscription renewed — $90.00/month')
    expect(notifications[0].body).toBe('boxer@example.com')
  })

  /**
   * Stripe delivers at least once, and the roll-up accumulates — a replay
   * that reached it would inflate lifetime paid, the cycle count and the
   * contact's LTV on every retry. Keyed on the INVOICE id.
   */
  it('absorbs a redelivered invoice without double-counting', async () => {
    await deliver(RENEWAL_INVOICE)
    await deliver(RENEWAL_INVOICE)

    expect(invoiceDocs()).toHaveLength(1)
    expect(storedSubscription().paidCents).toBe(9000)
    expect(storedSubscription().invoicesCount).toBe(1)
    expect(contactUpserts).toHaveLength(1)
    expect(notifications).toHaveLength(1)
  })

  /**
   * Stripe sends BOTH `invoice.paid` and `invoice.payment_succeeded` for the
   * same payment, and which of them a given endpoint receives is dashboard
   * configuration this repo cannot see. Handling both makes the branch fire
   * whichever is enabled; the invoice-id guard makes having both enabled
   * record the cycle exactly once rather than twice.
   */
  it('records one cycle when both invoice events are delivered', async () => {
    await deliver(RENEWAL_INVOICE, 'invoice.paid')
    await deliver(RENEWAL_INVOICE, 'invoice.payment_succeeded')

    expect(invoiceDocs()).toHaveLength(1)
    expect(storedSubscription().paidCents).toBe(9000)
    expect(contactUpserts).toHaveLength(1)
    expect(notifications).toHaveLength(1)
  })

  /**
   * The subscription's FIRST invoice also arrives as a paid invoice, carrying
   * `billing_reason: 'subscription_create'`. `checkout.session.completed` has
   * already counted that money into the contact's LTV and already notified the
   * managers (AGL-1732), so counting it again here would double every
   * subscriber's opening value. It is still recorded as an invoice document:
   * that is the ledger, and it must not have a hole where cycle 1 belongs.
   */
  it('records the opening invoice without re-counting the sale', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      id: 'in_1',
      billing_reason: 'subscription_create',
      amount_paid: 9825,
      total: 9825,
      tax: 825,
    })

    expect(invoiceDocs()).toHaveLength(1)
    expect((invoiceDocs()[0] as any).paidCents).toBe(9825)
    expect(storedSubscription().paidCents).toBe(9825)
    // No second contact increment and no second notification.
    expect(contactUpserts).toHaveLength(0)
    expect(notifications).toHaveLength(0)
    // And the sale's own decomposition is not overwritten by the invoice's.
    expect(storedSubscription().totals.totalCents).toBe(9825)
    expect(storedSubscription().totals.feeCents).toBe(196)
  })

  /**
   * A trial subscription's opening invoice is $0. Refreshing `totals` from it
   * would wipe the recorded sale to zero; the first real charge arrives later
   * as `subscription_cycle` and is what the record should follow.
   */
  it('never overwrites the recorded amount with a zero invoice', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      id: 'in_trial',
      billing_reason: 'subscription_create',
      amount_paid: 0,
      total: 0,
      subtotal: 0,
      lines: { data: [] },
    })
    expect(storedSubscription().totals.totalCents).toBe(9825)
    expect(contactUpserts).toHaveLength(0)
  })

  /**
   * Platform billing — Aglyn charging its own customers — runs through the
   * same endpoint and the same fan-out. Its invoices carry an `orgId` and no
   * `commerce-subscription` type, and this branch must not touch them.
   */
  it('ignores a platform-billing invoice entirely', async () => {
    await deliver({
      id: 'in_platform',
      customer: 'cus_org',
      subscription: 'sub_org',
      billing_reason: 'subscription_cycle',
      amount_paid: 4900,
      subscription_details: { metadata: { orgId: 'org-1', plan: 'business' } },
    })

    expect(invoiceDocs()).toHaveLength(0)
    expect(contactUpserts).toHaveLength(0)
    expect(notifications).toHaveLength(0)
    // The stored storefront subscription is untouched.
    expect(storedSubscription().lastInvoiceId).toBeUndefined()
  })

  /**
   * Every subscription sold before AGL-1732 has no stored `lineItems` to take
   * the product identity from. The renewal still has to record, falling back
   * to the product document named in the subscription metadata.
   */
  it('records a renewal for a subscription that predates the sale record', async () => {
    docs.set('hosts/host-1/subscriptions/sub_1', {
      productId: 'product-1',
      customerEmail: 'boxer@example.com',
      status: 'active',
    })
    await deliver(RENEWAL_INVOICE)

    const stored = invoiceDocs()[0] as any
    expect(stored.paidCents).toBe(9000)
    expect(stored.lineItems[0].productId).toBe('product-1')
    expect(stored.lineItems[0].name).toBe('Monthly box')
    expect(stored.lineItems[0].quantity).toBe(2)
    expect(stored.lineItems[0].unitAmountCents).toBe(5000)
  })

  /**
   * The cadence comes off the invoice's own recurring price, so a plan the
   * merchant moved from monthly to yearly stops being described as monthly.
   */
  it('refreshes the interval from the invoice', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      lines: {
        data: [
          {
            amount: 9000,
            quantity: 2,
            description: '2 × Monthly box (at $50.00 / year)',
            price: { unit_amount: 5000, recurring: { interval: 'year' } },
            period: { start: 1800000000, end: 1802678400 },
          },
        ],
      },
    })
    expect(storedSubscription().interval).toBe('year')
    expect(notifications[0].title).toBe('Subscription renewed — $90.00/year')
  })

  /**
   * A mid-cycle plan switch invoices the proration against the OLD price
   * ahead of the new plan (AGL-1640), so `lines.data[0]` is not the
   * subscription's line. The cadence and the product identity must come from
   * the plan line, and the money recorded is still Stripe's own total.
   */
  it('picks the plan line out of a proration invoice', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      amount_paid: 11500,
      total: 11500,
      subtotal: 12500,
      lines: {
        data: [
          {
            amount: 2500,
            quantity: 1,
            proration: true,
            description: 'Unused time on Monthly box',
            price: { unit_amount: 5000, recurring: { interval: 'month' } },
          },
          {
            amount: 10000,
            quantity: 2,
            description: '2 × Monthly box (at $50.00 / month)',
            price: { unit_amount: 5000, recurring: { interval: 'month' } },
          },
        ],
      },
    })
    const stored = invoiceDocs()[0] as any
    expect(stored.totals.totalCents).toBe(11500)
    expect(stored.lineItems).toHaveLength(2)
    // The plan line carries the product identity; the proration line does not,
    // because it is not a sale of that product.
    const plan = stored.lineItems.find((line: any) => line.productId === 'product-1')
    expect(plan.name).toBe('Monthly box')
    expect(plan.quantity).toBe(2)
    expect(plan.unitAmountCents).toBe(5000)
    const proration = stored.lineItems.find((line: any) => !line.productId)
    expect(proration.name).toBe('Unused time on Monthly box')
    // `unit_amount` is the FULL price on a proration line, so the fraction
    // actually billed is what gets stored.
    expect(proration.unitAmountCents).toBe(2500)
    expect(storedSubscription().interval).toBe('month')
  })

  /**
   * A subscription whose host is not the one the metadata names must not be
   * reachable: the write path is built from the metadata, so a missing hostId
   * has to be a no-op rather than a write to `hosts/undefined`.
   */
  it('does nothing when the invoice names no host', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      subscription_details: {
        metadata: { type: 'commerce-subscription', productId: 'product-1' },
      },
    })
    expect(invoiceDocs()).toHaveLength(0)
    expect([...docs.keys()].some((key) => key.includes('undefined'))).toBe(false)
  })

  it('never calls Stripe', async () => {
    await deliver(RENEWAL_INVOICE)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * A renewal for a subscription Aglyn has NO RECORD OF (AGL-1763).
 *
 * The roll-up was an unguarded `set(..., { merge: true })` against a document
 * that was read and never asked whether it exists, so this case minted one out
 * of the roll-up alone — money and nothing else. Refusing instead would be
 * AGL-1732 in reverse (a payment collected, recorded nowhere), and the id is
 * not caller-controlled the way AGL-1760's was: it rides a signature-verified
 * Stripe payload. So the record is RECONSTRUCTED, and these tests assert the
 * identity fields individually (AGL-1711) — because "not a stub" is precisely
 * the claim that every field a reader filters on is present.
 */
describe('a renewal whose subscription was never recorded (AGL-1763)', () => {
  beforeEach(() => {
    // The whole premise: the parent document is absent.
    docs.delete('hosts/host-1/subscriptions/sub_1')
  })

  it('records the money in the invoice ledger regardless', async () => {
    await deliver(RENEWAL_INVOICE)

    expect(invoiceDocs()).toHaveLength(1)
    const stored = invoiceDocs()[0] as any
    expect(stored.invoiceId).toBe('in_2')
    expect(stored.subscriptionId).toBe('sub_1')
    expect(stored.paidCents).toBe(9000)
    expect(stored.invoiceTotalCents).toBe(9000)
    expect(stored.billingReason).toBe('subscription_cycle')
    expect(stored.customerEmail).toBe('boxer@example.com')
    expect(stored.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/in_2')
  })

  it('reconstructs the subscription with the identity a reader can find it by', async () => {
    await deliver(RENEWAL_INVOICE)

    const stored = storedSubscription()
    expect(stored).toBeDefined()
    // `gate.ts:72`, `membership-account.ts:155` and `subscription-portal.ts:49`
    // all query `where('customerEmail', '==', …)`; a stub answered none of them.
    expect(stored.customerEmail).toBe('boxer@example.com')
    expect(stored.customerName).toBe('Bea Oxer')
    // `subscription-portal.ts:52` needs this or it 404s "No subscription
    // found" — the subscriber's only route to cancelling.
    expect(stored.stripeCustomerId).toBe('cus_1')
    // `gate.ts:76` and `member-post.ts:88` test `status` against LIVE_STATUSES.
    expect(stored.status).toBe('active')
    // `gate.ts:77` matches the entitlement on `productId`.
    expect(stored.productId).toBe('product-1')
    expect(stored.interval).toBe('month')
  })

  it('stores what the subscriber pays now, decomposed', async () => {
    await deliver(RENEWAL_INVOICE)

    const stored = storedSubscription()
    expect(stored.totals.itemsCents).toBe(10000)
    expect(stored.totals.discountCents).toBe(1000)
    expect(stored.totals.taxCents).toBe(0)
    expect(stored.totals.totalCents).toBe(9000)
    expect(stored.lineItems).toHaveLength(1)
    expect(stored.lineItems[0].productId).toBe('product-1')
    expect(stored.lineItems[0].name).toBe('Monthly box')
    expect(stored.lineItems[0].quantity).toBe(2)
    expect(stored.lineItems[0].unitAmountCents).toBe(5000)
  })

  it('dates the record from the cycle it can prove, not from now', async () => {
    await deliver(RENEWAL_INVOICE)

    // `period_start` 1800000000s. `Date.now()` would date a subscription of
    // unknown age to whichever cycle happened to be the first one seen.
    expect(storedSubscription().createdAtMs).toBe(1800000000000)
  })

  it('marks the record as reconstructed and claims no checkout session', async () => {
    await deliver(RENEWAL_INVOICE)

    const stored = storedSubscription()
    expect(stored.reconstructedFromInvoiceId).toBe('in_2')
    // `checkoutSessionId` is AGL-1732's redelivery key and the id
    // `order-analytics.ts:187` resolves the opening purchase through. A
    // reconstruction cannot answer that question, so it must not appear to.
    expect(stored.checkoutSessionId).toBeUndefined()
  })

  it('still rolls the money up, and still accumulates on the next cycle', async () => {
    await deliver(RENEWAL_INVOICE)

    expect(storedSubscription().paidCents).toBe(9000)
    expect(storedSubscription().invoicesCount).toBe(1)
    expect(storedSubscription().lastInvoiceId).toBe('in_2')

    await deliver({
      ...RENEWAL_INVOICE,
      id: 'in_3',
      amount_paid: 9000,
      status_transitions: { paid_at: 1802678405 },
    })

    expect(invoiceDocs()).toHaveLength(2)
    expect(storedSubscription().paidCents).toBe(18000)
    expect(storedSubscription().invoicesCount).toBe(2)
    expect(storedSubscription().lastInvoiceId).toBe('in_3')
    // Cycle 2 must not re-date the record it did not create.
    expect(storedSubscription().createdAtMs).toBe(1800000000000)
    expect(storedSubscription().reconstructedFromInvoiceId).toBe('in_2')
  })

  /**
   * The reserved-id landmine sitting in the same path. With no stored sale and
   * no `productId` in the metadata, the identity fallback reached for
   * `products/__missing__` — an id matching `__.*__`, which Firestore REFUSES.
   * `runBillingWebhookHandlers` lets the first throw propagate, so the renewal
   * was dropped whole and Stripe re-delivered into the same throw.
   */
  it('records the renewal when the metadata names no product', async () => {
    await deliver({
      ...RENEWAL_INVOICE,
      subscription_details: {
        metadata: { type: 'commerce-subscription', hostId: 'host-1' },
      },
    })

    expect(invoiceDocs()).toHaveLength(1)
    expect((invoiceDocs()[0] as any).paidCents).toBe(9000)
    const stored = storedSubscription()
    expect(stored.paidCents).toBe(9000)
    // Nothing is invented: no product was named, so none is claimed.
    expect(stored.productId).toBeUndefined()
    expect(stored.lineItems[0].name).toBe('Subscription')
    // The identity that IS knowable still lands, so the subscriber can still
    // be found and can still reach the portal.
    expect(stored.customerEmail).toBe('boxer@example.com')
    expect(stored.stripeCustomerId).toBe('cus_1')
  })

  it('creates no order document, exactly as a recorded renewal does not', async () => {
    await deliver(RENEWAL_INVOICE)
    expect(orderDocs()).toHaveLength(0)
  })

  it('never calls Stripe', async () => {
    await deliver(RENEWAL_INVOICE)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
