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
 * THE NEW CARD IS THE ONE THE RETRY CHARGES (AGL-3442).
 *
 * Billing's Update payment method button opens Stripe's portal flow, which
 * sets only the CUSTOMER's default payment method. Every subscription the
 * console creates carries its own default, which wins — so without the
 * webhook moving it, a past-due customer who replaced the failed card would
 * be told it was updated while the next retry charged the old one.
 *
 * This drives the real webhook with `customer.updated` deliveries and asserts
 * on what it POSTED to Stripe. The controls are the deliveries that must move
 * nothing: an update to something other than the default, and the
 * `payment_method.attached` that arrives beside every new card.
 */

export {}

import { createHmac } from 'node:crypto'

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

/** What the plugins were told the default is (AGL-3011), in order. */
const mockPluginEvents: Array<{ name: string; payload: any }> = []

jest.mock('next/server', () => ({
  after: (work: () => unknown) => work(),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  formatOperatorAlertAmount: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/operator-alerts',
  ).formatOperatorAlertAmount,
  runPluginEventHandlers: async (name: string, payload: unknown) => {
    mockPluginEvents.push({ name, payload })
    return { handled: 0, failed: [] }
  },
  // The REAL classifier, ledger and write observer (AGL-1954), never stubs.
  classifyDeliveryLag: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery')
    .classifyDeliveryLag,
  classifyWebhookDelivery: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery')
    .classifyWebhookDelivery,
  createWebhookEffectLedger: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery')
    .createWebhookEffectLedger,
  observeWrites: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery')
    .observeWrites,
  buildRoute: (_route: string, params: { orgSlug?: string }) =>
    `/${params?.orgSlug ?? 'org'}/billing`,
  Route: { MANAGE_BILLING: 'MANAGE_BILLING', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW' },
  runBillingWebhookHandlers: async () => undefined,
  SELF_SERVE_PLANS: ['free', 'starter', 'pro', 'business', 'scale', 'advanced', 'agency'],
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  raiseOperatorAlert: async () => ({ outcome: 'delivered' }),
  firebaseAdmin: {
    app: () => ({ firestore: () => mockMakeFirestore() }),
    firestore: {
      FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__now__' },
    },
  },
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_1' ? 'org-1' : null,
  notifyOrgAdmins: async () => undefined,
  logOrgActivity: async () => undefined,
  notifyStaff: async () => undefined,
  sendGa4Purchase: async () => ({ sent: true, synthesizedClientId: true }),
  sendGa4Refund: async () => ({ sent: true, synthesizedClientId: true }),
  sendGa4SubscriptionCancelled: async () => ({ sent: true, synthesizedClientId: true }),
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

function loadWebhook() {
  jest.resetModules()
  process.env = {
    ...CLEAN_ENV,
    STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    STRIPE_SECRET_KEY: 'sk_test_fake',
  } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function delivery(
  type: string,
  object: Record<string, unknown>,
  previousAttributes?: Record<string, unknown>,
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    livemode: false,
    data: { object, ...(previousAttributes ? { previous_attributes: previousAttributes } : {}) },
  }
}

/** The customer after the portal flow saved `pm_new` as its default. */
const CUSTOMER_AFTER_FLOW = {
  id: 'cus_1',
  object: 'customer',
  invoice_settings: { default_payment_method: 'pm_new' },
}

/** Every POST the route made to Stripe's subscriptions endpoint. */
let subscriptionPosts: Array<{ url: string; body: string }>

beforeEach(() => {
  docs = new Map()
  docs.set('orgs/org-1', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
  mockPluginEvents.length = 0
  subscriptionPosts = []
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://api.stripe.com/v1/subscriptions/')) {
      subscriptionPosts.push({ url, body: String(init?.body ?? '') })
      return { ok: true, status: 200, json: async () => ({}) }
    }
    if (url.startsWith('https://api.stripe.com/v1/subscriptions?')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            // Created by `/api/billing/checkout`, so it carries its own
            // default: the card that just failed.
            { id: 'sub_1', status: 'past_due', default_payment_method: 'pm_old' },
          ],
        }),
      }
    }
    if (url.startsWith('https://api.stripe.com/v1/customers/cus_1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          invoice_settings: {
            default_payment_method: { id: 'pm_new', type: 'card', card: { last4: '4242' } },
          },
        }),
      }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
  }) as never
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('a new default payment method reaches the subscription (AGL-3442)', () => {
  it('moves the subscription off the replaced card and onto the new default', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        delivery('customer.updated', CUSTOMER_AFTER_FLOW, {
          invoice_settings: { default_payment_method: 'pm_old' },
        }),
      ),
    )

    expect(response.status).toBe(200)
    expect(subscriptionPosts).toEqual([
      {
        url: 'https://api.stripe.com/v1/subscriptions/sub_1',
        body: 'default_payment_method=pm_new',
      },
    ])
    // And the plugins are still told what the default is, as before.
    expect(mockPluginEvents.map((event) => event.name)).toEqual([
      'billing.paymentMethod.changed',
    ])
  })

  it('CONTROL — an update to something else moves nothing', async () => {
    const post = loadWebhook()
    await post(
      signed(
        delivery('customer.updated', CUSTOMER_AFTER_FLOW, {
          address: { city: 'Dallas' },
        }),
      ),
    )
    expect(subscriptionPosts).toEqual([])
    // PREMISE: the delivery reached the branch, which still told the plugins.
    expect(mockPluginEvents.map((event) => event.name)).toEqual([
      'billing.paymentMethod.changed',
    ])
  })

  it('CONTROL — an attached card is not yet the default, and moves nothing', async () => {
    const post = loadWebhook()
    await post(
      signed(
        delivery('payment_method.attached', {
          id: 'pm_new',
          object: 'payment_method',
          customer: 'cus_1',
          type: 'card',
        }),
      ),
    )
    expect(subscriptionPosts).toEqual([])
    expect(mockPluginEvents.map((event) => event.name)).toEqual([
      'billing.paymentMethod.changed',
    ])
  })
})
