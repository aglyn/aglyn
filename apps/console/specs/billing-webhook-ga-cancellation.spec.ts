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
 * `customer.subscription.deleted` reaches `sendGa4SubscriptionCancelled`
 * with the subscription being LEFT (AGL-1851).
 *
 * The trap this file exists to pin: the cancellation branch of the webhook
 * computes `plan = 'free'` for the org mirror — the plan the org is moving
 * TO — while the churn event must report the plan the org is moving FROM.
 * A refactor that reuses the mirror's variable ships a churn report where
 * every cancellation reads "free", which renders fine and means nothing.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import type { Ga4SendResult } from '@aglyn/tenant-data-admin'

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
 * `STRIPE_PRICE_PRO_YEARLY` is set so `planFromPriceId` can name the plan
 * from the price when the metadata does not — the fallback case below.
 */
const BASE_ENV = {
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_annual',
}

type CancelInput = {
  plan: string
  billingInterval?: string
  tenureDays?: number
  clientId?: string | null
  stripeCustomerId?: string | null
}

const mockCancellations: CancelInput[] = []

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
  findOrgIdByStripeCustomer: async () => null,
  notifyOrgAdmins: async () => undefined,
  sendGa4Purchase: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  sendGa4Refund: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  // Captured, not stubbed — the input IS the subject of this file.
  sendGa4SubscriptionCancelled: async (
    input: CancelInput,
  ): Promise<Ga4SendResult> => {
    mockCancellations.push(input)
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

function subscriptionEvent(
  subscription: Record<string, unknown>,
  {
    eventId = `evt_${Math.random().toString(36).slice(2)}`,
    type = 'customer.subscription.deleted',
  } = {},
) {
  return { id: eventId, type, data: { object: subscription } }
}

function loadWebhook() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/** 212 days of Pro (annual), cancelled mid-term. */
const CREATED_AT = 1_768_000_000
const ENDED_AT = CREATED_AT + 212 * 86400

const CANCELLED_SUBSCRIPTION = {
  id: 'sub_ga_1',
  object: 'subscription',
  customer: 'cus_own_1',
  status: 'canceled',
  created: CREATED_AT,
  canceled_at: ENDED_AT - 86400,
  ended_at: ENDED_AT,
  metadata: {
    orgId: 'org-real',
    plan: 'pro',
    ga_client_id: '1725000000.987654321',
  },
  items: {
    data: [
      {
        id: 'si_plan',
        price: {
          id: 'price_pro_annual',
          nickname: 'Pro (annual)',
          recurring: { interval: 'year' },
          unit_amount: 34800,
        },
      },
    ],
  },
}

describe('customer.subscription.deleted reaches sendGa4SubscriptionCancelled (AGL-1851)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    mockCancellations.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('reports the plan being LEFT — never the free the org mirror writes', async () => {
    const post = loadWebhook()
    const response = await post(signed(subscriptionEvent(CANCELLED_SUBSCRIPTION)))
    expect(response.status).toBe(200)

    expect(mockCancellations).toHaveLength(1)
    const sent = mockCancellations[0]
    expect(sent.plan).toBe('pro')
    // The mirror's own `plan = 'free'` write goes through `updateExisting`,
    // which this file stubs — the mirror is billing-webhook-phantom-org's
    // subject. What is pinned HERE is that the churn event did not inherit
    // that variable.
    expect(sent.plan).not.toBe('free')
  })

  it('carries the interval, whole-day tenure, and the client id checkout stamped', async () => {
    const post = loadWebhook()
    await post(signed(subscriptionEvent(CANCELLED_SUBSCRIPTION)))

    const sent = mockCancellations[0]
    expect(sent.billingInterval).toBe('annual')
    // ended_at − created, in whole days — the canceled_at a day earlier is
    // when they clicked; ended_at is when the subscription actually ended.
    expect(sent.tenureDays).toBe(212)
    expect(sent.clientId).toBe('1725000000.987654321')
    expect(sent.stripeCustomerId).toBe('cus_own_1')
  })

  it('names the plan from the price when the metadata does not say', async () => {
    const post = loadWebhook()
    const { plan, ...metadata } = CANCELLED_SUBSCRIPTION.metadata
    await post(
      signed(subscriptionEvent({ ...CANCELLED_SUBSCRIPTION, metadata })),
    )
    // STRIPE_PRICE_PRO_YEARLY names price_pro_annual, so `planFromPriceId`
    // still answers — a dashboard-edited subscription keeps its churn tier.
    expect(mockCancellations[0].plan).toBe('pro')
  })

  it('a subscription.updated does not report churn', async () => {
    const post = loadWebhook()
    await post(
      signed(
        subscriptionEvent(
          { ...CANCELLED_SUBSCRIPTION, status: 'active' },
          { type: 'customer.subscription.updated' },
        ),
      ),
    )
    expect(mockCancellations).toHaveLength(0)
  })

  it('a subscription naming no workspace of ours reports nothing — the claiming rule', async () => {
    const post = loadWebhook()
    // A tenant shopper's product subscription carries the merchant's own
    // metadata, not an orgId in our orgs collection.
    await post(
      signed(
        subscriptionEvent({
          ...CANCELLED_SUBSCRIPTION,
          metadata: { hostId: 'host-9', type: 'commerce-subscription' },
        }),
      ),
    )
    await post(
      signed(
        subscriptionEvent({
          ...CANCELLED_SUBSCRIPTION,
          metadata: { ...CANCELLED_SUBSCRIPTION.metadata, orgId: 'org-gone' },
        }),
      ),
    )
    expect(mockCancellations).toHaveLength(0)
  })
})
