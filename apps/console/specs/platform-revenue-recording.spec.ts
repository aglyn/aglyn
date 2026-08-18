/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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

/**
 * Every charge on Aglyn's own account leaves a filable tax record (AGL-1811).
 *
 * Two layers, both here because only together do they mean anything:
 *
 * - `platformInvoiceRevenue` decomposes a paid invoice correctly — driven
 *   with fixtures shaped from REAL invoices read off the live account
 *   (2026-08-15), including the shape the commerce comment said could not
 *   happen: the `tax` scalar present-but-empty BESIDE a populated
 *   `total_taxes[]`.
 * - The webhook actually WRITES it — "the helper exists" and "the helper is
 *   wired" are different claims (the AGL-1763 lesson), so the wiring test
 *   drives the REAL route with a REAL signed payload and reads the document
 *   that landed.
 *
 * The claiming boundary is the third subject: `checkout.session.completed`
 * fires for EVERY checkout on the account — marketplace, commerce tenant
 * sales, POS — and `invoice.paid` fires for tenant-store product
 * subscriptions too. Aglyn's own charges are exactly the invoices whose
 * customer resolves through the `stripeCustomers` index (stamped only by
 * `writeOrgBilling`), so a shopper's invoice must record NOTHING.
 *
 * NO STRIPE PATH IS EXERCISED — localhost carries the LIVE key.
 * `global.fetch` is replaced for the whole file.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import { platformInvoiceRevenue } from '../utils/server/platform-revenue'

/**
 * Shaped from live invoice `in_1U4EAkDYHP4psn7hwU9KikBz` (read-only,
 * 2026-08-15): the CURRENT API generation, where the scalar `tax` coexists
 * with `total_taxes[]` and the breakdown is the authoritative half.
 * Amounts swapped for a non-zero example: $100.00 + 8.25% × $80 = $6.60,
 * the measured TX data-processing computation.
 */
const CURRENT_SHAPE_INVOICE = {
  id: 'in_current',
  object: 'invoice',
  customer: 'cus_own_1',
  subscription: 'sub_1',
  amount_paid: 10660,
  total: 10660,
  currency: 'usd',
  tax: 0, // the scalar lies on this API generation — the array is the truth
  total_taxes: [
    {
      amount: 660,
      tax_behavior: 'exclusive',
      tax_rate_details: { tax_rate: 'txr_tx_state' },
      taxability_reason: 'taxable_basis_reduced',
      taxable_amount: 8000,
      type: 'tax_rate_details',
    },
  ],
  total_tax_amounts: [{ amount: 660, tax_rate: 'txr_tx_state' }],
  automatic_tax: { enabled: true, status: 'complete' },
  customer_address: {
    city: 'Jarrell',
    country: 'US',
    line1: '125 Johnston Ln',
    postal_code: '76537',
    state: 'TX',
  },
  status_transitions: { paid_at: 1786687300 },
  created: 1786687254,
}

describe('platformInvoiceRevenue decomposes a paid invoice (AGL-1811)', () => {
  it('reads the breakdown array FIRST — the live scalar is 0 beside real tax', () => {
    const record = platformInvoiceRevenue(CURRENT_SHAPE_INVOICE)
    expect(record).not.toBeNull()
    expect(record!.grossCents).toBe(10660)
    expect(record!.taxCents).toBe(660)
    expect(record!.netCents).toBe(10000)
    // The row must be auditable against the filed 80% position, not just
    // summable: reason and rate travel with the amount.
    expect(record!.taxLines).toEqual([
      {
        amountCents: 660,
        taxabilityReason: 'taxable_basis_reduced',
        taxRateId: 'txr_tx_state',
        // The 80% base itself — the "taxable sales" figure the TX return
        // reports, carried on the row so filing needs no Stripe read.
        taxableAmountCents: 8000,
      },
    ])
    expect(record!.customerAddress).toEqual({
      country: 'US',
      state: 'TX',
      city: 'Jarrell',
      postalCode: '76537',
    })
    expect(record!.automaticTax).toBe(true)
    expect(record!.paidAt).toEqual(new Date(1786687300 * 1000))
  })

  it('falls back to the scalar on OLD API shapes that carry nothing else', () => {
    const record = platformInvoiceRevenue({
      id: 'in_old',
      amount_paid: 2708,
      total: 2708,
      currency: 'usd',
      tax: 208,
      customer: 'cus_own_1',
    })
    expect(record!.taxCents).toBe(208)
    expect(record!.netCents).toBe(2500)
    expect(record!.taxLines).toEqual([])
  })

  it('reads `total_tax_amounts[]` — the middle generation — including expanded rates', () => {
    const record = platformInvoiceRevenue({
      id: 'in_mid',
      amount_paid: 2708,
      tax: null,
      total_tax_amounts: [
        { amount: 208, tax_rate: { id: 'txr_expanded' } },
      ],
    })
    expect(record!.taxCents).toBe(208)
    expect(record!.taxLines[0].taxRateId).toBe('txr_expanded')
    // The middle generation's entries carry no `taxable_amount` here — the
    // absence must store as null (unknown base), never 0 (a zero-base sale).
    expect(record!.taxLines[0].taxableAmountCents).toBeNull()
  })

  it('an UNTAXED invoice records zeros, not an absence — shaped from the live Feb invoice', () => {
    // `in_1TubsJDYHP4psn7h3EpJYI28`: billed before its subscription gained
    // automatic_tax. It is still a transaction the return period must see,
    // and `automaticTax: false` is what distinguishes "collected nothing"
    // from "owed nothing".
    const record = platformInvoiceRevenue({
      id: 'in_untaxed',
      customer: 'cus_own_2',
      subscription: 'sub_2',
      amount_paid: 2500,
      total: 2500,
      currency: 'usd',
      tax: null,
      total_taxes: [],
      total_tax_amounts: [],
      automatic_tax: { enabled: false },
      customer_address: {
        city: 'Jarrell',
        country: 'US',
        postal_code: '76537',
        state: 'TX',
      },
    })
    expect(record!.grossCents).toBe(2500)
    expect(record!.taxCents).toBe(0)
    expect(record!.netCents).toBe(2500)
    expect(record!.automaticTax).toBe(false)
  })

  it('never throws: no id answers null, garbage answers null', () => {
    expect(platformInvoiceRevenue({})).toBeNull()
    expect(platformInvoiceRevenue(null)).toBeNull()
    expect(platformInvoiceRevenue('in_x')).toBeNull()
    expect(platformInvoiceRevenue({ id: '' })).toBeNull()
  })

  it('tolerates expanded customer/subscription objects and missing address', () => {
    const record = platformInvoiceRevenue({
      id: 'in_expanded',
      customer: { id: 'cus_obj' },
      subscription: { id: 'sub_obj' },
      amount_paid: 1000,
      created: 1786687254,
    })
    expect(record!.stripeCustomerId).toBe('cus_obj')
    expect(record!.subscriptionId).toBe('sub_obj')
    expect(record!.customerAddress).toBeNull()
    // No paid_at → the created timestamp keeps the row in a period.
    expect(record!.paidAt).toEqual(new Date(1786687254 * 1000))
  })
})

// ---------------------------------------------------------------------------
// Wiring: the webhook writes the record, and ONLY for Aglyn's own customers.
// ---------------------------------------------------------------------------

/** Env without a trace of the developer's own Stripe config (`nx test` leaks the root env). */
const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
      delete clean[key]
    }
  }
  return clean
})()

const ORIGINAL_ENV = process.env

/**
 * No `STRIPE_SECRET_KEY`: the best-effort invoice-tagging and
 * customer-stamping steps self-select on it, keeping this file's subject —
 * what lands in Firestore — uncluttered.
 */
const BASE_ENV = { STRIPE_WEBHOOK_SECRET: 'whsec_fake' }

/** Every document, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()

function mockMakeFirestore() {
  const doc = (path: string) => ({
    id: path.split('/').pop(),
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw new Error('ALREADY_EXISTS')
      docs.set(path, { ...data })
      return undefined
    },
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      ref: { id: path.split('/').pop() },
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data })
      return undefined
    },
    update: async (data: Record<string, unknown>) => {
      if (!docs.has(path)) throw new Error(`5 NOT_FOUND: ${path}`)
      docs.set(path, { ...docs.get(path), ...data })
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
    }),
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  runBillingWebhookHandlers: async () => undefined,
  // The webhook's import graph reaches `billing-addons`, which derives
  // PAID_PLANS from this list at module load.
  SELF_SERVE_PLANS: [
    'free',
    'starter',
    'pro',
    'business',
    'scale',
    'advanced',
    'agency',
  ],
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockMakeFirestore() }),
    firestore: {
      FieldValue: {
        delete: () => '__delete__',
        serverTimestamp: () => '__now__',
      },
    },
  },
  // The claiming boundary under test: only `cus_own_1` is an Aglyn billing
  // customer. A commerce shopper's customer id resolves to nothing, exactly
  // as the real index behaves — `writeOrgBilling` is its only writer.
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_own_1' ? 'org-real' : null,
  notifyOrgAdmins: async () => undefined,
  sendGa4Purchase: async () => undefined,
  writeOrgBilling: async () => undefined,
  updateExisting: async () => true,
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

function signed(body: unknown, secret = 'whsec_fake') {
  const payload = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return new Request('https://app.aglyn.com/api/billing/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': `t=${timestamp},v1=${signature}`,
      'content-type': 'application/json',
    },
    body: payload,
  })
}

function invoicePaidEvent(
  invoice: Record<string, unknown>,
  { eventId = `evt_${Math.random().toString(36).slice(2)}`, type = 'invoice.paid' } = {},
) {
  return { id: eventId, type, data: { object: invoice } }
}

function loadWebhook() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

describe('the webhook records platform revenue per transaction (AGL-1811)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'starter' })
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('THE GAP: invoice.paid on an OWN customer stores the filable record', async () => {
    const post = loadWebhook()
    const response = await post(signed(invoicePaidEvent(CURRENT_SHAPE_INVOICE)))
    expect(response.status).toBe(200)

    const stored = docs.get('platformRevenue/in_current')
    expect(stored).toBeTruthy()
    // Field by field — an internally-consistent wrong decomposition is the
    // AGL-1711 failure shape, so each number is pinned individually.
    expect(stored!.orgId).toBe('org-real')
    expect(stored!.grossCents).toBe(10660)
    expect(stored!.taxCents).toBe(660)
    expect(stored!.netCents).toBe(10000)
    expect(stored!.currency).toBe('usd')
    expect(stored!.automaticTax).toBe(true)
    expect((stored!.customerAddress as any).state).toBe('TX')
    expect((stored!.taxLines as any[])[0].taxabilityReason).toBe(
      'taxable_basis_reduced',
    )
    expect(stored!.subscriptionId).toBe('sub_1')
    expect(stored!.stripeCustomerId).toBe('cus_own_1')
  })

  it("CONTROL — a tenant shopper's invoice records NOTHING", async () => {
    // `invoice.paid` fires for tenant-store product subscriptions on the
    // same endpoint. Their customers were minted by commerce checkout, not
    // `writeOrgBilling`, so the index resolves nothing — and claiming their
    // tax as Aglyn's would corrupt the return in the unfixable direction.
    const post = loadWebhook()
    await post(
      signed(
        invoicePaidEvent({
          ...CURRENT_SHAPE_INVOICE,
          id: 'in_shopper',
          customer: 'cus_shopper_9',
        }),
      ),
    )
    expect(docs.get('platformRevenue/in_shopper')).toBeUndefined()
  })

  it('CONTROL — invoice.finalized is a bill, not a payment: nothing recorded', async () => {
    const post = loadWebhook()
    await post(
      signed(
        invoicePaidEvent(CURRENT_SHAPE_INVOICE, { type: 'invoice.finalized' }),
      ),
    )
    expect(docs.get('platformRevenue/in_current')).toBeUndefined()
  })

  it('a Stripe redelivery converges on ONE row, not a duplicate', async () => {
    const post = loadWebhook()
    await post(signed(invoicePaidEvent(CURRENT_SHAPE_INVOICE, { eventId: 'evt_1' })))
    // Same event id: the idempotency claim answers duplicate=true.
    await post(signed(invoicePaidEvent(CURRENT_SHAPE_INVOICE, { eventId: 'evt_1' })))
    // Different event id, same invoice (Stripe re-sends paid on occasion):
    // keyed by INVOICE id, the second write restamps the same document.
    await post(signed(invoicePaidEvent(CURRENT_SHAPE_INVOICE, { eventId: 'evt_2' })))

    const rows = [...docs.keys()].filter((key) =>
      key.startsWith('platformRevenue/'),
    )
    expect(rows).toEqual(['platformRevenue/in_current'])
  })
})
