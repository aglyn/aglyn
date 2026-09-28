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
 * A HELD upgrade projects no plan (AGL-3358).
 *
 * `/api/billing/subscription` now sends an upgrade with
 * `payment_behavior: pending_if_incomplete`. Until its invoice is paid, Stripe
 * keeps the new items AND the new `metadata` in `subscription.pending_update`
 * and delivers `customer.subscription.updated` with the live object unchanged
 * (measured in test mode: `metadata.plan` stayed `pro`, the held one read
 * `advanced`). This webhook projects `plan` from `metadata.plan`, then from the
 * plan item's price, so it must read the LIVE object and never the held one.
 *
 * A pin, not a fix: the webhook already reads only the live object. It is
 * pinned because a later "helpful" read of `pending_update` would hand out
 * the plan a declined card was trying to buy.
 *
 * NO STRIPE PATH IS EXERCISED: `global.fetch` is a jest mock.
 */

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

const BASE_ENV = {
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_ADVANCED: 'price_advanced_monthly',
}

/** Every patch `updateExisting` was handed for the org doc. */
const mockOrgPatches: Array<Record<string, unknown>> = []
/** Every `writeOrgBilling(orgId, payload)` the route made. */
const mockBillingWrites: Array<{ orgId: string; payload: any }> = []
/** Every `org.seatAddons.changed` event the route raised (AGL-2929, AGL-2939). */
const mockActivityRows: unknown[][] = []

jest.mock('../../../libs/tenant/data/admin/src/lib/server/organizations', () => ({
  __esModule: true,
  logOrgActivity: async (...args: unknown[]) => {
    mockActivityRows.push(args)
  },
  logHostActivity: async () => undefined,
}))

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

jest.mock('next/server', () => ({
  after: (work: () => unknown) => work(),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The event the route raises (AGL-2939); the AI plugin's handler — proven
  // in its own spec — is what writes the row.
  runPluginEventHandlers: async (_event: string, payload: unknown) => {
    mockActivityRows.push([payload])
    return { handled: 1, failed: [] }
  },
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
  sendGa4SubscriptionCancelled: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  logOrgActivity: async () => undefined,
  // Captured, not stubbed — the `seatAddons` it carries IS the subject.
  writeOrgBilling: async (orgId: string, payload: unknown) => {
    mockBillingWrites.push({ orgId, payload })
  },
  // Captured: the `plan` it is handed is what every console surface gates on.
  updateExisting: async (_ref: unknown, patch: Record<string, unknown>) => {
    mockOrgPatches.push(patch)
    return true
  },
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
    type = 'customer.subscription.updated',
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

const item = (priceId: string) => ({
  id: `si_${priceId}`,
  price: { id: priceId, recurring: { interval: 'month' } },
  quantity: 1,
})

describe('a held upgrade projects no plan (AGL-3358)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    mockOrgPatches.length = 0
    mockBillingWrites.length = 0
    mockActivityRows.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('an update held in pending_update keeps the plan that was paid for', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        subscriptionEvent({
          id: 'sub_held',
          object: 'subscription',
          customer: 'cus_held',
          status: 'active',
          current_period_end: 1_793_194_709,
          metadata: { orgId: 'org-real', plan: 'pro' },
          items: { data: [item('price_pro_monthly')] },
          pending_update: {
            expires_at: 1_790_685_512,
            metadata: { plan: 'advanced' },
            subscription_items: [
              { id: 'si_price_pro_monthly', price: { id: 'price_advanced_monthly' } },
            ],
          },
        }),
      ),
    )
    expect(response.status).toBe(200)
    expect(mockOrgPatches.map((patch) => patch.plan)).toEqual(['pro'])
    expect(mockBillingWrites[0]?.payload?.subscription?.priceId).toBe(
      'price_pro_monthly',
    )
  })

  it('CONTROL: once Stripe applies it (paid), the same event shape moves the plan', async () => {
    const post = loadWebhook()
    await post(
      signed(
        subscriptionEvent({
          id: 'sub_held',
          object: 'subscription',
          customer: 'cus_held',
          status: 'active',
          current_period_end: 1_793_194_709,
          metadata: { orgId: 'org-real', plan: 'advanced' },
          items: { data: [item('price_advanced_monthly')] },
          pending_update: null,
        }),
      ),
    )
    expect(mockOrgPatches.map((patch) => patch.plan)).toEqual(['advanced'])
  })
})
