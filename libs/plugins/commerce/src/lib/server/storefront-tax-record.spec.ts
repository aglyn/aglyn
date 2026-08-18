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
 * Storefront tax reaches a durable record (AGL-1904).
 *
 * Driven through `commerceBillingWebhookHandler` rather than by calling the
 * recorder directly: the wiring is half the fix. Every order-writing section
 * of that handler early-returns on its own redelivery guard, so a recorder
 * placed a few lines lower would stop recording the moment an order document
 * already existed — the placement is asserted here by delivering the SAME
 * session twice and checking the row is still there.
 *
 * The Stripe boundary IS exercised, for one reason: a Checkout Session's
 * `total_details.breakdown` is an expandable field absent from the delivered
 * payload, and `taxable_amount` — the figure a return reports as taxable
 * sales — lives only inside it. The fetch is asserted to happen, and asserted
 * NOT to happen for a manual-mode sale that has no Stripe-computed base.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore — same shape as the other webhook specs
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
      // `set(merge)` conjures a document that did not exist and merges field
      // by field into one that did — modelled exactly, because the recorder's
      // idempotency depends on the difference.
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
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
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
    orgId: 'org-1',
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
  meterHostEmail: async () => undefined,
  notifyHostManagers: async () => undefined,
  upsertHostContact: async () => undefined,
  renderHostEmailWithTokens: async () => null,
  // Modelled, not permissive: `update()` semantics — a write that does
  // nothing when the document is absent, and never conjures one.
  updateExisting: async (ref: any, value: Record<string, any>) => {
    const existing = docs.get(ref.path)
    if (!existing) return false
    docs.set(ref.path, { ...existing, ...value })
    return true
  },
  orgDataCollectionForHost: async () => null,
  scopedToHost: (query: any) => query,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

/**
 * The expanded session Stripe answers with — the breakdown the delivered
 * payload does not carry. Transcribed from the real test-mode response.
 */
const EXPANDED_BREAKDOWN = {
  discounts: [],
  taxes: [
    {
      amount: 825,
      taxability_reason: 'standard_rated',
      taxable_amount: 10000,
      rate: {
        id: 'txr_live_tx',
        object: 'tax_rate',
        jurisdiction: 'Texas',
        percentage: 8.25,
        effective_percentage: 8.25,
        state: 'TX',
        tax_type: 'sales_tax',
      },
    },
  ],
}

let expandCalls: string[] = []
let expandOk = true

const fetchMock = jest.fn(async (url: any) => {
  const href = String(url)
  if (href.includes('/v1/checkout/sessions/')) {
    expandCalls.push(href)
    if (!expandOk) return { ok: false, status: 500, json: async () => ({}) }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'cs_tax_1',
        amount_total: 10825,
        currency: 'usd',
        created: 1787032952,
        payment_status: 'paid',
        metadata: { type: 'commerce-cart', hostId: 'host-1' },
        automatic_tax: {
          enabled: true,
          liability: { type: 'self' },
          status: 'complete',
        },
        customer_details: {
          address: { country: 'US', state: 'TX', city: 'Austin' },
        },
        total_details: { amount_tax: 825, breakdown: EXPANDED_BREAKDOWN },
      }),
    }
  }
  throw new Error(`Unexpected fetch to ${href}`)
})

/** A Stripe-Tax cart session as the WEBHOOK sees it — no breakdown. */
const STRIPE_TAX_SESSION = {
  id: 'cs_tax_1',
  payment_status: 'paid',
  payment_intent: 'pi_tax_1',
  amount_total: 10825,
  currency: 'usd',
  created: 1787032952,
  automatic_tax: { enabled: true, liability: { type: 'self' }, status: 'complete' },
  customer_details: {
    email: 'shopper@example.com',
    address: { country: 'US', state: 'TX', city: 'Austin' },
  },
  total_details: { amount_tax: 825, amount_shipping: 0, amount_discount: 0 },
  metadata: { type: 'commerce-cart', hostId: 'host-1', cartId: 'cart-1', feeCents: '0' },
}

/** The same store in `manual` mode: tax is an ordinary line item. */
const MANUAL_TAX_SESSION = {
  id: 'cs_manual_1',
  payment_status: 'paid',
  payment_intent: 'pi_manual_1',
  amount_total: 10800,
  currency: 'usd',
  created: 1787032952,
  customer_details: {
    email: 'shopper@example.com',
    address: { country: 'US', state: 'TX', city: 'Austin' },
  },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'commerce-order',
    hostId: 'host-1',
    productId: 'product-1',
    taxCents: '800',
    unitAmountCents: '10000',
    quantity: '1',
    feeCents: '0',
  },
}

/**
 * A paid service booking (AGL-2000). Carries no tax by a stated decision in
 * `bookings/server.ts`, and — the actual finding — was absent from
 * SESSION_TYPES, so it produced no row at all.
 */
const BOOKING_SESSION = {
  id: 'cs_booking_1',
  payment_status: 'paid',
  payment_intent: 'pi_booking_1',
  amount_total: 7500,
  currency: 'usd',
  created: 1787032952,
  customer_details: {
    email: 'client@example.com',
    address: { country: 'US', state: 'TX', city: 'Austin' },
  },
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  metadata: {
    type: 'booking-payment',
    hostId: 'host-1',
    bookingId: 'booking-1',
  },
}

async function deliver(object: any, type = 'checkout.session.completed') {
  await commerceBillingWebhookHandler({
    type,
    object,
    requestHost: 'example.test',
  } as never)
}

describe('storefront tax recording (AGL-1904)', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    docs.clear()
    autoIdCounter = 0
    expandCalls = []
    expandOk = true
    fetchMock.mockClear()
    global.fetch = fetchMock as never
    process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
  })

  afterAll(() => {
    global.fetch = realFetch
  })

  it('records a Stripe-Tax cart sale as Aglyn-liable, with Stripe’s own base', async () => {
    await deliver(STRIPE_TAX_SESSION)
    const row = docs.get('storefrontTaxCollected/cs_tax_1')
    expect(row).toMatchObject({
      kind: 'session',
      hostId: 'host-1',
      orgId: 'org-1',
      metadataType: 'commerce-cart',
      taxMode: 'stripe-automatic',
      taxLiability: 'platform',
      grossCents: 10825,
      taxCents: 825,
      netCents: 10000,
      currency: 'usd',
      customerAddress: { country: 'US', state: 'TX' },
    })
    // The base came from the EXPAND, not from the delivered payload, and not
    // from dividing the amount by a rate.
    expect(expandCalls).toHaveLength(1)
    expect(expandCalls[0]).toContain('expand[]=total_details.breakdown')
    expect(row?.taxLines).toEqual([
      {
        amountCents: 825,
        taxabilityReason: 'standard_rated',
        taxRateId: 'txr_live_tx',
        taxableAmountCents: 10000,
        jurisdiction: 'Texas',
        rateState: 'TX',
        percentage: 8.25,
      },
    ])
  })

  /**
   * AGL-2000: a booking sale was not merely untaxed — it did not appear in
   * the record that would let anyone notice it was untaxed, or reconcile it
   * later. `booking-payment` was absent from SESSION_TYPES entirely.
   */
  it('records a paid booking, and reads it as an untaxed sale', async () => {
    await deliver(BOOKING_SESSION)
    const row = docs.get('storefrontTaxCollected/cs_booking_1')
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      kind: 'session',
      hostId: 'host-1',
      metadataType: 'booking-payment',
      // The stated decision, visible in the ledger rather than inferred from
      // a missing row.
      taxMode: 'none',
      taxLiability: null,
      grossCents: 7500,
      taxCents: 0,
      netCents: 7500,
    })
    // Stripe computed nothing, so there is no base to go and fetch.
    expect(expandCalls).toHaveLength(0)
  })

  // Positive control: the set must stay selective. Recording every session
  // type would file platform subscription revenue and marketplace sales as
  // storefront tax rows.
  it('still records nothing for a session type that is not a storefront sale', async () => {
    await deliver({
      ...BOOKING_SESSION,
      id: 'cs_not_ours_1',
      metadata: { type: 'marketplace-purchase', hostId: 'host-1' },
    })
    expect(docs.get('storefrontTaxCollected/cs_not_ours_1')).toBeUndefined()
  })

  it('records a manual-mode sale as manual, with no liability and no base', async () => {
    await deliver(MANUAL_TAX_SESSION)
    const row = docs.get('storefrontTaxCollected/cs_manual_1')
    expect(row).toMatchObject({
      taxMode: 'manual',
      taxLiability: null,
      taxCents: 800,
      grossCents: 10800,
      netCents: 10000,
    })
    expect(row?.taxLines).toEqual([])
    // Nothing to expand: Stripe was never told this was tax, so there is no
    // Stripe-computed base to go and fetch.
    expect(expandCalls).toHaveLength(0)
  })

  it('keeps the row when the breakdown read fails, base unstated rather than invented', async () => {
    expandOk = false
    await deliver(STRIPE_TAX_SESSION)
    const row = docs.get('storefrontTaxCollected/cs_tax_1')
    // The sale is still on the record with its full tax — an unreadable base
    // must not be able to make a taxable sale disappear.
    expect(row).toMatchObject({ taxMode: 'stripe-automatic', taxCents: 825 })
    expect(row?.taxLines).toEqual([])
  })

  it('is idempotent across a redelivery — one row, not two', async () => {
    await deliver(STRIPE_TAX_SESSION)
    await deliver(STRIPE_TAX_SESSION)
    const rows = [...docs.keys()].filter((key) =>
      key.startsWith('storefrontTaxCollected/'),
    )
    expect(rows).toEqual(['storefrontTaxCollected/cs_tax_1'])
    expect(docs.get('storefrontTaxCollected/cs_tax_1')?.taxCents).toBe(825)
  })

  /**
   * THE PLACEMENT GUARD. The cart branch below returns early once its order
   * document exists (`if (!created) return`), so a recorder sitting anywhere
   * after it stops running on every delivery but the first. Deleting the row
   * and redelivering is the only way to tell a recorder that runs ALWAYS from
   * one that merely ran once: both leave a row after two deliveries.
   */
  it('still records on a delivery whose order branch has already early-returned', async () => {
    await deliver(STRIPE_TAX_SESSION)
    expect(docs.get('hosts/host-1/orders/cs_tax_1')).toBeDefined()
    docs.delete('storefrontTaxCollected/cs_tax_1')
    await deliver(STRIPE_TAX_SESSION)
    expect(docs.get('storefrontTaxCollected/cs_tax_1')).toMatchObject({
      taxMode: 'stripe-automatic',
      taxCents: 825,
    })
  })

  it('records a storefront subscription from its INVOICE, never twice', async () => {
    const subscriptionSession = {
      id: 'cs_sub_1',
      payment_status: 'paid',
      amount_total: 10825,
      currency: 'usd',
      subscription: 'sub_1',
      automatic_tax: { enabled: true, liability: { type: 'self' } },
      total_details: { amount_tax: 825 },
      metadata: {
        type: 'commerce-subscription',
        hostId: 'host-1',
        productId: 'product-1',
      },
    }
    await deliver(subscriptionSession)
    // The session is deliberately NOT a source: its invoice carries the same
    // money, and recording both would double the opening cycle.
    expect(docs.get('storefrontTaxCollected/cs_sub_1')).toBeUndefined()

    const invoice = {
      id: 'in_sub_1',
      amount_paid: 10825,
      currency: 'usd',
      status_transitions: { paid_at: 1787032952 },
      automatic_tax: { enabled: true, liability: { type: 'self' } },
      subscription: 'sub_1',
      subscription_details: {
        metadata: {
          type: 'commerce-subscription',
          hostId: 'host-1',
          productId: 'product-1',
        },
      },
      total_taxes: [
        {
          amount: 825,
          taxable_amount: 10000,
          taxability_reason: 'standard_rated',
          tax_rate_details: { tax_rate: 'txr_live_tx' },
        },
      ],
      customer_address: { country: 'US', state: 'TX' },
      lines: { data: [] },
    }
    await deliver(invoice, 'invoice.paid')
    // Stripe sends BOTH events for one payment; the doc id makes that one row.
    await deliver(invoice, 'invoice.payment_succeeded')
    const rows = [...docs.keys()].filter((key) =>
      key.startsWith('storefrontTaxCollected/'),
    )
    expect(rows).toEqual(['storefrontTaxCollected/in_sub_1'])
    expect(docs.get('storefrontTaxCollected/in_sub_1')).toMatchObject({
      kind: 'invoice',
      taxMode: 'stripe-automatic',
      taxLiability: 'platform',
      taxCents: 825,
    })
    // An invoice carries its breakdown inline — no expand needed.
    expect(expandCalls).toHaveLength(0)
  })

  it('writes nothing for a sale that carried no tax at all', async () => {
    await deliver({
      ...MANUAL_TAX_SESSION,
      id: 'cs_untaxed',
      amount_total: 10000,
      metadata: { ...MANUAL_TAX_SESSION.metadata, taxCents: '0' },
    })
    expect(docs.get('storefrontTaxCollected/cs_untaxed')).toBeUndefined()
  })

  it('never lets a recording failure throw into the webhook', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = {
      ...STRIPE_TAX_SESSION,
      id: 'cs_broken',
      metadata: { ...STRIPE_TAX_SESSION.metadata, cartId: undefined },
    }
    global.fetch = (async () => {
      throw new Error('Stripe is down')
    }) as never
    await expect(deliver(broken)).resolves.toBeUndefined()
    // The expand failed, and the row still landed from the delivered payload.
    expect(docs.get('storefrontTaxCollected/cs_broken')).toMatchObject({
      taxCents: 825,
    })
    error.mockRestore()
  })
})
