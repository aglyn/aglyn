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
 * `charge.refunded` reaches `sendGa4Refund` with the right numbers
 * (AGL-1850) — the `billing-webhook-ga-purchase.spec.ts` shape, for the
 * reversal.
 *
 * The three claims worth an assembly test, none of which the sender's own
 * spec can see:
 *
 * 1. **The claiming boundary.** `charge.refunded` fires on this endpoint for
 *    tenant storefront orders and marketplace sales too. Only a charge that
 *    carries an INVOICE id and whose customer resolves through the
 *    `stripeCustomers` index may report — the same double test that keeps a
 *    shopper's `invoice.paid` out of `purchase`.
 * 2. **The delta arithmetic.** Stripe's `amount_refunded` is CUMULATIVE, and
 *    GA refund values are additive; sending it verbatim would re-report every
 *    earlier partial. The AGL-1811 `platformRevenue` row carries the running
 *    `refundedCents` that makes the delta computable.
 * 3. **The id.** `transaction_id` is the INVOICE id the original `purchase`
 *    used — netting requires the same transaction, not the charge id.
 *
 * NO STRIPE PATH IS EXERCISED and no GA path either: `sendGa4Refund` is
 * captured wholesale and `global.fetch` is a jest mock.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
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
const BASE_ENV = { STRIPE_WEBHOOK_SECRET: 'whsec_fake' }

const mockGa4Refunds: Ga4PurchaseInput[] = []

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
  // customer — a commerce shopper's customer id resolves to nothing.
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_own_1' ? 'org-real' : null,
  notifyOrgAdmins: async () => undefined,
  sendGa4Purchase: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  // Captured, not stubbed — the input IS the subject of this file.
  sendGa4Refund: async (input: Ga4PurchaseInput): Promise<Ga4SendResult> => {
    mockGa4Refunds.push(input)
    return { sent: true, synthesizedClientId: !input.clientId }
  },
  sendGa4SubscriptionCancelled: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
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

function refundEvent(
  charge: Record<string, unknown>,
  { eventId = `evt_${Math.random().toString(36).slice(2)}` } = {},
) {
  return { id: eventId, type: 'charge.refunded', data: { object: charge } }
}

function loadWebhook() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/** A partial refund of a subscription invoice charge on OUR account. */
const OWN_CHARGE = {
  id: 'ch_own_1',
  object: 'charge',
  customer: 'cus_own_1',
  invoice: 'in_ga_annual',
  currency: 'usd',
  refunded: false,
  amount_refunded: 1000,
}

describe('charge.refunded reaches sendGa4Refund with the right numbers (AGL-1850)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    // The AGL-1811 tax row the invoice's `purchase` pass wrote.
    docs.set('platformRevenue/in_ga_annual', {
      grossCents: 28900,
      orgId: 'org-real',
    })
    mockGa4Refunds.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('a first partial refund sends the delta under the ORIGINAL invoice id, and stamps the row', async () => {
    const post = loadWebhook()
    const response = await post(signed(refundEvent(OWN_CHARGE)))
    expect(response.status).toBe(200)

    expect(mockGa4Refunds).toHaveLength(1)
    const sent = mockGa4Refunds[0]
    // The invoice id the purchase reported — netting requires the SAME
    // transaction id, not the charge id.
    expect(sent.transactionId).toBe('in_ga_annual')
    expect(sent.value).toBe(10)
    expect(sent.currency).toBe('usd')
    expect(sent.stripeCustomerId).toBe('cus_own_1')
    // The running total that makes the NEXT event's delta computable, and
    // the tax record refund-aware.
    expect(docs.get('platformRevenue/in_ga_annual')).toMatchObject({
      refundedCents: 1000,
      refundRecordedAt: '__now__',
    })
  })

  it('a later refund reports only the DELTA — amount_refunded is cumulative', async () => {
    const post = loadWebhook()
    await post(signed(refundEvent(OWN_CHARGE)))
    // Stripe reports the TOTAL refunded so far: 1000 already reported + 2000
    // new. Sending 3000 verbatim would re-report the first partial.
    await post(
      signed(refundEvent({ ...OWN_CHARGE, amount_refunded: 3000 })),
    )
    expect(mockGa4Refunds.map((call) => call.value)).toEqual([10, 20])
    expect(docs.get('platformRevenue/in_ga_annual')).toMatchObject({
      refundedCents: 3000,
    })
  })

  it('a redelivery carrying the same cumulative total reports nothing new', async () => {
    const post = loadWebhook()
    await post(signed(refundEvent(OWN_CHARGE)))
    // A different event id (so the stripeEvents claim does not absorb it)
    // with the same cumulative amount — the delta is zero.
    await post(signed(refundEvent(OWN_CHARGE)))
    expect(mockGa4Refunds).toHaveLength(1)
  })

  it("a shopper's refund never reports — the customer resolves to no org", async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        refundEvent({
          ...OWN_CHARGE,
          id: 'ch_shopper',
          customer: 'cus_shopper_9',
          invoice: 'in_shopper_1',
        }),
      ),
    )
    expect(response.status).toBe(200)
    expect(mockGa4Refunds).toHaveLength(0)
  })

  it('a charge with no invoice never reports — that is marketplace/storefront id space', async () => {
    const post = loadWebhook()
    await post(
      signed(refundEvent({ ...OWN_CHARGE, id: 'ch_mkt', invoice: undefined })),
    )
    expect(mockGa4Refunds).toHaveLength(0)
  })

  it('a TAXED row scales the delta to NET — a full refund sums to what the purchase reported (AGL-1872)', async () => {
    const post = loadWebhook()
    // The measured live TX row (AGL-1811): $106.60 gross, $6.60 tax, so the
    // purchase reported $100.00. Refunds must reverse THAT number, not the
    // gross — a gross reversal would net GA below zero on a full refund.
    docs.set('platformRevenue/in_ga_taxed', {
      grossCents: 10660,
      taxCents: 660,
      orgId: 'org-real',
    })
    const taxedCharge = {
      ...OWN_CHARGE,
      id: 'ch_taxed',
      invoice: 'in_ga_taxed',
    }
    // Half the gross back: 5330 × (10660 − 660) / 10660 = 5000 — half of
    // what the purchase reported. A gross pass-through would send 53.30.
    await post(signed(refundEvent({ ...taxedCharge, amount_refunded: 5330 })))
    // The rest: the two deltas must sum to the purchase's $100.00 exactly.
    await post(
      signed(
        refundEvent({ ...taxedCharge, refunded: true, amount_refunded: 10660 }),
      ),
    )
    expect(mockGa4Refunds.map((call) => call.value)).toEqual([50, 50])
    expect(
      mockGa4Refunds.reduce((sum, call) => sum + call.value, 0),
    ).toBeCloseTo(100)
    // The row still tracks the GROSS cumulative — the tax record stays in
    // Stripe's own unit; only the GA reversal is netted.
    expect(docs.get('platformRevenue/in_ga_taxed')).toMatchObject({
      refundedCents: 10660,
    })
  })

  it('a pre-AGL-1811 invoice (no revenue row) reports only a FULL refund, once, at the total', async () => {
    const post = loadWebhook()
    docs.delete('platformRevenue/in_ga_annual')
    // Partial with no row: the delta is not computable — nothing, rather
    // than a guess.
    await post(signed(refundEvent(OWN_CHARGE)))
    expect(mockGa4Refunds).toHaveLength(0)
    // Full refund with no row: the cumulative total IS the whole story.
    await post(
      signed(
        refundEvent({ ...OWN_CHARGE, refunded: true, amount_refunded: 28900 }),
      ),
    )
    expect(mockGa4Refunds).toHaveLength(1)
    expect(mockGa4Refunds[0].value).toBe(289)
  })
})
