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
 * The billing webhook drives `invoice.paid` as far as its GA4 `purchase`
 * call, with the right object (AGL-1684).
 *
 * The pieces were each unit-tested and the assembly was not:
 * `billingIntervalFromInvoice` / `selectSubscriptionLine` have 8 cases,
 * `sendGa4Purchase`'s wire payload has its own spec, and nothing executed the
 * route far enough to see what it PASSES them. A refactor handing the wrong
 * object to any of them — `amount_due` for `amount_paid`, session metadata
 * for subscription metadata — was caught by review and by nothing else,
 * while the number it corrupts is the GTM §6 revenue that reconciles
 * against Stripe.
 *
 * So this file captures the `sendGa4Purchase` INPUT rather than stubbing it
 * (the `libs/plugins/marketplace` billing-webhook spec's shape — capturing
 * is what let AGL-1639's gross-vs-net be asserted), and pins every field the
 * route computes: value, transaction id, interval, client id, line
 * selection. The sender itself — credentials, sanitizer, synthetic-id
 * fallback — stays covered by `ga4-measurement-protocol.spec.ts`; this file
 * is about the arguments, because that is the uncovered claim.
 *
 * The claiming boundary matters here exactly as it does for the tax record:
 * `invoice.paid` fires on this endpoint for tenant-store product
 * subscriptions too, and a shopper's invoice reaching `sendGa4Purchase`
 * would report a merchant's revenue as Aglyn's. Only a customer resolving
 * through the `stripeCustomers` index (stamped solely by `writeOrgBilling`)
 * may send.
 *
 * NO STRIPE PATH IS EXERCISED — localhost carries the LIVE key. And no GA
 * path either: `sendGa4Purchase` is replaced wholesale, `global.fetch` is a
 * jest mock, and the last test asserts nothing ever reached
 * google-analytics.com.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import type { Ga4PurchaseInput, Ga4SendResult } from '@aglyn/tenant-data-admin'

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
 * what reaches `sendGa4Purchase` — uncluttered.
 */
const BASE_ENV = { STRIPE_WEBHOOK_SECRET: 'whsec_fake' }

/**
 * Every `sendGa4Purchase` input, in call order. Typed as the real input
 * rather than a loose record so a renamed field on `Ga4PurchaseInput` fails
 * typecheck here instead of silently asserting against a key that no longer
 * exists (the marketplace spec's precaution, kept).
 */
const mockGa4Calls: Ga4PurchaseInput[] = []

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
  // Captured, not stubbed — the input IS the subject of this file.
  sendGa4Purchase: async (input: Ga4PurchaseInput): Promise<Ga4SendResult> => {
    mockGa4Calls.push(input)
    return { sent: true, synthesizedClientId: !input.clientId }
  },
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

function invoiceEvent(
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

/**
 * An annual subscription's first invoice, shaped the way Stripe actually
 * bills a mid-cycle switch (AGL-1640): the proration line — against the OLD
 * monthly price — sorts FIRST, ahead of the annual plan line. `lines.data[0]`
 * is therefore the wrong line on every axis this file asserts, which is what
 * makes it the fixture: an assembly that reads index 0 fails here, loudly.
 *
 * `amount_due` deliberately differs from `amount_paid` (a credit balance
 * covered part of the bill) so that value-from-the-wrong-field is a red,
 * not a coincidence.
 */
const ANNUAL_INVOICE = {
  id: 'in_ga_annual',
  object: 'invoice',
  customer: 'cus_own_1',
  subscription: 'sub_ga_1',
  amount_due: 30000,
  amount_paid: 28900,
  total: 30000,
  currency: 'usd',
  subscription_details: {
    metadata: { ga_client_id: '1725000000.987654321', orgId: 'org-real' },
  },
  lines: {
    data: [
      {
        proration: true,
        amount: -2100,
        price: {
          id: 'price_pro_monthly',
          nickname: 'Pro (monthly)',
          recurring: { interval: 'month' },
        },
      },
      {
        proration: false,
        amount: 31000,
        price: {
          id: 'price_pro_annual',
          nickname: 'Pro (annual)',
          recurring: { interval: 'year' },
        },
      },
    ],
  },
  status_transitions: { paid_at: 1786687300 },
  created: 1786687254,
}

describe('invoice.paid reaches sendGa4Purchase with the right object (AGL-1684)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    mockGa4Calls.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('THE ASSEMBLY: every field of the GA input, pinned individually', async () => {
    const post = loadWebhook()
    const response = await post(signed(invoiceEvent(ANNUAL_INVOICE)))
    expect(response.status).toBe(200)

    expect(mockGa4Calls).toHaveLength(1)
    const sent = mockGa4Calls[0]

    // The invoice id — GA de-duplicates on it, so a redelivery that slips
    // past the claim still cannot inflate revenue.
    expect(sent.transactionId).toBe('in_ga_annual')
    // amount_PAID in whole currency units — not amount_due (the bill), not
    // cents. $289.00, and the fixture's amount_due of $300.00 makes reading
    // the wrong field a different number.
    expect(sent.value).toBe(289)
    expect(sent.currency).toBe('usd')
    // The interval comes off the SUBSCRIPTION line, not lines.data[0] —
    // the proration against the old monthly price sorts first and an
    // index-0 read would report this annual sale as monthly (AGL-1640).
    expect(sent.billingInterval).toBe('annual')
    // Same selection drives the item: the annual price, named.
    expect(sent.items).toEqual([
      {
        item_id: 'price_pro_annual',
        item_name: 'Pro (annual)',
        item_category: 'subscription',
        price: 289,
        quantity: 1,
      },
    ])
    // The browser's client id, read from SUBSCRIPTION metadata — where
    // checkout wrote it (`subscription_data[metadata][ga_client_id]`) —
    // not session or invoice metadata, which never carry it.
    expect(sent.clientId).toBe('1725000000.987654321')
    // The fallback seed, so a renewal without a client id still lands on
    // one stable synthetic user instead of vanishing.
    expect(sent.stripeCustomerId).toBe('cus_own_1')
  })

  it('a RENEWAL — no ga_client_id on the subscription — still sends, seeded for the fallback', async () => {
    const post = loadWebhook()
    const { subscription_details, ...renewal } = ANNUAL_INVOICE
    await post(
      signed(invoiceEvent({ ...renewal, id: 'in_ga_renewal' })),
    )

    expect(mockGa4Calls).toHaveLength(1)
    const sent = mockGa4Calls[0]
    expect(sent.transactionId).toBe('in_ga_renewal')
    // No browser was involved; the route passes no client id and the
    // sender's synthetic-id fallback (unit-tested in its own spec) takes
    // the customer seed from here.
    expect(sent.clientId).toBeUndefined()
    expect(sent.stripeCustomerId).toBe('cus_own_1')
    expect(sent.value).toBe(289)
  })

  it('an invoice stating NO cadence sends the interval as absent, not monthly (AGL-1640)', async () => {
    const post = loadWebhook()
    await post(
      signed(
        invoiceEvent({
          ...ANNUAL_INVOICE,
          id: 'in_ga_flat',
          lines: {
            data: [{ description: 'One-off setup', amount: 28900 }],
          },
        }),
      ),
    )

    expect(mockGa4Calls).toHaveLength(1)
    // Excluded from the annual-mix breakdown rather than miscounted in it.
    expect(mockGa4Calls[0].billingInterval).toBeUndefined()
    // No line carries a price — the item falls back to its generic name
    // rather than inventing one.
    expect(mockGa4Calls[0].items[0].item_id).toBe('subscription')
  })

  it("CONTROL — a tenant shopper's invoice sends NOTHING: their revenue is the merchant's", async () => {
    // Same endpoint, same event type; the customer was minted by commerce
    // checkout, not `writeOrgBilling`, so the index resolves nothing. A GA
    // hit here would report a merchant's sale as Aglyn's revenue.
    const post = loadWebhook()
    await post(
      signed(
        invoiceEvent({
          ...ANNUAL_INVOICE,
          id: 'in_ga_shopper',
          customer: 'cus_shopper_9',
        }),
      ),
    )
    expect(mockGa4Calls).toHaveLength(0)
  })

  it('CONTROL — finalized is a bill and payment_failed is neither: no purchase', async () => {
    const post = loadWebhook()
    await post(signed(invoiceEvent(ANNUAL_INVOICE, { type: 'invoice.finalized' })))
    await post(
      signed(invoiceEvent(ANNUAL_INVOICE, { type: 'invoice.payment_failed' })),
    )
    expect(mockGa4Calls).toHaveLength(0)
  })

  it('a redelivered event id is claimed before the GA call: one purchase, not two', async () => {
    const post = loadWebhook()
    await post(signed(invoiceEvent(ANNUAL_INVOICE, { eventId: 'evt_ga_1' })))
    await post(signed(invoiceEvent(ANNUAL_INVOICE, { eventId: 'evt_ga_1' })))
    expect(mockGa4Calls).toHaveLength(1)

    // A re-sent `invoice.paid` under a FRESH event id does reach the call —
    // that is the layer the claim cannot catch, and why `transaction_id`
    // being the invoice id matters: GA de-duplicates the pair.
    await post(signed(invoiceEvent(ANNUAL_INVOICE, { eventId: 'evt_ga_2' })))
    expect(mockGa4Calls).toHaveLength(2)
    expect(mockGa4Calls[1].transactionId).toBe(mockGa4Calls[0].transactionId)
  })

  it('SEAL: nothing in this file ever spoke to google-analytics.com or stripe.com', async () => {
    const post = loadWebhook()
    await post(signed(invoiceEvent(ANNUAL_INVOICE)))
    const urls = (global.fetch as jest.Mock).mock.calls.map((call) =>
      String(call[0]),
    )
    for (const url of urls) {
      expect(url).not.toContain('google-analytics.com')
      expect(url).not.toContain('stripe.com')
    }
  })
})
