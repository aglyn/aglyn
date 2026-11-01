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
 * A plugin's sale on a workspace's own billing customer (AGL-4049).
 *
 * A marketplace purchase paid from the card on file is an invoice whose
 * customer resolves through `stripeCustomers`, the test this route has always
 * used for "this charge is Aglyn's own". It is not. Left alone, every one of
 * these events does something wrong, and each test below is a thing that
 * would otherwise happen:
 *
 * - `invoice.paid` books the whole sale in `platformRevenue`, so its tax is
 *   filed twice, beside the marketplace's own row, and GA hears the gross as
 *   subscription revenue.
 * - `invoice.finalized` and `invoice.payment_failed` tell the workspace about
 *   a bill and a dunning that do not exist, and staff that it is about to stop
 *   paying.
 * - `invoice.voided`, which is how a declined attempt is cleared, raises an
 *   operator alert that revenue is not coming.
 * - `charge.refunded` finds no revenue row, reads the invoice as one from
 *   before AGL-1811, and reports the full gross refund to GA under the same
 *   transaction id the marketplace nets out itself.
 *
 * The paid notice stays: it is the workspace's receipt. And a platform
 * invoice beside it behaves as it always has, which is the control.
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

const mockGa4Purchases: Ga4PurchaseInput[] = []
const mockGa4Refunds: Ga4PurchaseInput[] = []
const mockNotified: Array<{ orgId: string; notice: Record<string, unknown> }> = []
const mockStaffNotices: Array<Record<string, unknown>> = []
const mockOperatorAlerts: string[] = []

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

/**
 * `after()` from `next/server` is how this route schedules post-response work
 * (AGL-2346), and outside a real request scope Next's own `after` throws — so
 * a direct handler invocation needs a double. This one records every scheduled
 * callback AND runs it inline, leaving every existing assertion (all of which
 * observe the effect) unchanged, while `mockAfterScheduled` becomes the
 * evidence that the work was SCHEDULED rather than fired and forgotten. Revert
 * the route to a bare `void promise` and this array stays empty.
 */
const mockAfterScheduled: Array<() => unknown> = []
jest.mock('next/server', () => ({
  after: (work: () => unknown) => {
    mockAfterScheduled.push(work)
    return work()
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  // The platform's billing events (AGL-3011). The webhook raises them once an
  // invoice or a dispute resolves to a workspace; what a plugin does with one
  // is proved in the plugin's own suite, so this only has to exist.
  runPluginEventHandlers: async () => ({ handled: 0, failed: [] }),
  __esModule: true,
  // The REAL classifier, ledger and write observer (AGL-1954), never stubs.
  // The route's "did this delivery do anything" verdict is the thing under
  // test in `billing-webhook-inert.spec.ts`, and a hand-written double here
  // would let this suite keep passing while the real rule changed under it.
  classifyDeliveryLag: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).classifyDeliveryLag,
  classifyWebhookDelivery: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).classifyWebhookDelivery,
  createWebhookEffectLedger: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).createWebhookEffectLedger,
  observeWrites: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).observeWrites,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  NOTIFICATION_TYPE_LABELS: {},
  formatOperatorAlertAmount: () => '$29.00',
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
  notifyOrgAdmins: async (orgId: string, notice: Record<string, unknown>) => {
    mockNotified.push({ orgId, notice })
  },
  notifyStaff: async (notice: Record<string, unknown>) => {
    mockStaffNotices.push(notice)
  },
  raiseOperatorAlert: async (type: string) => {
    mockOperatorAlerts.push(type)
    return { outcome: 'delivered' }
  },
  sendGa4Purchase: async (input: Ga4PurchaseInput): Promise<Ga4SendResult> => {
    mockGa4Purchases.push(input)
    return { sent: true, synthesizedClientId: true }
  },
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

function event(type: string, object: Record<string, unknown>) {
  return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } }
}

function loadWebhook() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

const PLUGIN_SALE_INVOICE = {
  id: 'in_sale',
  object: 'invoice',
  customer: 'cus_own_1',
  amount_due: 10660,
  amount_paid: 10660,
  currency: 'usd',
  total_taxes: [{ amount: 660, taxable_amount: 8000 }],
  metadata: { type: 'marketplace-purchase', pluginSale: 'true' },
}

const OWN_INVOICE = {
  id: 'in_own',
  object: 'invoice',
  customer: 'cus_own_1',
  amount_due: 2900,
  amount_paid: 2900,
  currency: 'usd',
  metadata: {},
}

describe("a plugin's sale on a workspace's own billing customer (AGL-4049)", () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    mockGa4Purchases.length = 0
    mockGa4Refunds.length = 0
    mockNotified.length = 0
    mockStaffNotices.length = 0
    mockOperatorAlerts.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('CONTROL: a platform invoice books revenue, GA and the notice', async () => {
    const post = loadWebhook()
    expect((await post(signed(event('invoice.paid', OWN_INVOICE)))).status).toBe(200)
    expect(docs.has('platformRevenue/in_own')).toBe(true)
    expect(mockGa4Purchases).toHaveLength(1)
    expect(mockNotified).toHaveLength(1)
  })

  it('invoice.paid books no platform revenue and no GA purchase', async () => {
    const post = loadWebhook()
    expect((await post(signed(event('invoice.paid', PLUGIN_SALE_INVOICE)))).status).toBe(200)
    expect(docs.has('platformRevenue/in_sale')).toBe(false)
    expect(mockGa4Purchases).toEqual([])
  })

  it('invoice.paid keeps the paid notice: it is the receipt', async () => {
    const post = loadWebhook()
    await post(signed(event('invoice.paid', PLUGIN_SALE_INVOICE)))
    expect(mockNotified).toHaveLength(1)
    expect(String(mockNotified[0].notice['title'])).toContain('Invoice paid: $106.60')
  })

  it('invoice.finalized tells nobody: it is paid in the next breath', async () => {
    const post = loadWebhook()
    await post(signed(event('invoice.finalized', PLUGIN_SALE_INVOICE)))
    expect(mockNotified).toEqual([])
  })

  it('invoice.payment_failed starts no dunning copy and pings no staff', async () => {
    const post = loadWebhook()
    await post(signed(event('invoice.payment_failed', PLUGIN_SALE_INVOICE)))
    expect(mockNotified).toEqual([])
    expect(mockStaffNotices).toEqual([])
  })

  it('CONTROL: a platform invoice that fails still reaches the workspace and staff', async () => {
    const post = loadWebhook()
    await post(signed(event('invoice.payment_failed', OWN_INVOICE)))
    expect(mockNotified).toHaveLength(1)
    expect(mockStaffNotices).toHaveLength(1)
  })

  it.each(['invoice.voided', 'invoice.marked_uncollectible'])(
    '%s raises no operator alert: a declined attempt is cleared this way',
    async (type) => {
      const post = loadWebhook()
      await post(signed(event(type, PLUGIN_SALE_INVOICE)))
      expect(mockOperatorAlerts).toEqual([])
    },
  )

  it('CONTROL: a platform invoice voided still raises the alert', async () => {
    const post = loadWebhook()
    await post(signed(event('invoice.voided', OWN_INVOICE)))
    expect(mockOperatorAlerts).toEqual(['billing.platformInvoiceUncollectible'])
  })

  it('charge.refunded reports nothing here: the marketplace nets its own sale out', async () => {
    const post = loadWebhook()
    const charge = {
      id: 'ch_sale',
      object: 'charge',
      customer: 'cus_own_1',
      invoice: 'in_sale',
      currency: 'usd',
      refunded: true,
      amount_refunded: 10660,
      metadata: { type: 'marketplace-purchase', pluginSale: 'true' },
    }
    expect((await post(signed(event('charge.refunded', charge)))).status).toBe(200)
    expect(mockGa4Refunds).toEqual([])
  })

  it('CONTROL: a refund of an invoice with no row and no marker still reports', async () => {
    const post = loadWebhook()
    const charge = {
      id: 'ch_own',
      object: 'charge',
      customer: 'cus_own_1',
      invoice: 'in_old',
      currency: 'usd',
      refunded: true,
      amount_refunded: 2900,
      metadata: {},
    }
    await post(signed(event('charge.refunded', charge)))
    expect(mockGa4Refunds.map((sent) => sent.transactionId)).toEqual(['in_old'])
  })
})
