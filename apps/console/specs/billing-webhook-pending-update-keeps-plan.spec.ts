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

const mockRaiseOperatorAlert = jest.fn(async (..._args: unknown[]) => ({ outcome: 'delivered' }))

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
  formatOperatorAlertAmount: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/operator-alerts',
  ).formatOperatorAlertAmount,
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
  // The REAL plan model: a schedule refresh re-derives the target phase with
  // the same add-on ceilings the product sells.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // Real, for the metered-backfill decision the Stripe-keyed cases reach.
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
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
  // The operator alert pipeline (AGL-3377): what the route raises, not how it is delivered.
  raiseOperatorAlert: (...args: unknown[]) => mockRaiseOperatorAlert(...args),
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
  notifyStaff: async () => undefined,
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

/**
 * A held add-on increase that APPLIES reaches the pending downgrade
 * (AGL-3358).
 *
 * The add-ons route refreshes a pending downgrade's snapshotted item list
 * right after an increase paid on the spot (AGL-2150). An increase held for
 * the customer's bank applies later, here, and until this the schedule kept
 * the old quantity — measured in test mode, phase 1 still read quantity 1
 * after a held 1 → 4 increase was paid — so the seats were paid for and then
 * dropped at the period end.
 */
describe('a held add-on increase that applies refreshes the pending downgrade (AGL-3358)', () => {
  const PERIOD_START = 1_790_000_000
  const PERIOD_END = 1_792_592_000
  let stripeCalls: Array<{ href: string; method: string; body: string }>

  /** The live subscription AFTER the held 1 → 4 dataset increase applied. */
  const applied = {
    id: 'sub_held',
    object: 'subscription',
    customer: 'cus_held',
    status: 'active',
    schedule: 'sub_sched_down',
    current_period_start: PERIOD_START,
    current_period_end: PERIOD_END,
    metadata: { orgId: 'org-real', plan: 'pro' },
    pending_update: null,
    items: {
      data: [
        item('price_pro_monthly'),
        { ...item('price_pro_dataset'), quantity: 4 },
      ],
    },
  }

  /** The event, with the `previous_attributes` Stripe sent in test mode. */
  function withPrevious(
    object: Record<string, unknown>,
    previousAttributes: Record<string, unknown>,
  ) {
    const event = subscriptionEvent(object)
    return {
      ...event,
      data: { object, previous_attributes: previousAttributes },
    }
  }

  function scheduleWrite(): URLSearchParams | null {
    const call = stripeCalls.find(
      (entry) =>
        entry.method === 'POST' &&
        entry.href.includes('/subscription_schedules/sub_sched_down'),
    )
    return call ? new URLSearchParams(call.body) : null
  }

  /** A phase's quantity for one price, or null when it has no such line. */
  function phaseQuantity(
    body: URLSearchParams | null,
    phase: number,
    price: string,
  ): string | null {
    for (let i = 0; body?.get(`phases[${phase}][items][${i}][price]`); i += 1) {
      if (body?.get(`phases[${phase}][items][${i}][price]`) === price) {
        return body.get(`phases[${phase}][items][${i}][quantity]`)
      }
    }
    return null
  }

  function loadWithStripe() {
    jest.resetModules()
    process.env = {
      ...CLEAN_ENV,
      ...BASE_ENV,
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_PRICE_STARTER: 'price_starter_monthly',
      STRIPE_PRICE_PRO_EXTRA_DATASET: 'price_pro_dataset',
      STRIPE_PRICE_STARTER_EXTRA_DATASET: 'price_starter_dataset',
    } as NodeJS.ProcessEnv
    return require('../app/api/billing/webhook/route').POST as (
      request: Request,
    ) => Promise<Response>
  }

  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    mockOrgPatches.length = 0
    mockBillingWrites.length = 0
    mockActivityRows.length = 0
    stripeCalls = []
    global.fetch = jest.fn(async (url: unknown, init: any) => {
      const href = String(url)
      stripeCalls.push({
        href,
        method: String(init?.method ?? 'GET'),
        body: String(init?.body ?? ''),
      })
      // The pending downgrade as the console writes one: phase 0 is the
      // present, phase 1 is Starter from the period end — still carrying the
      // ONE dataset it was snapshotted with.
      if (href.includes('/subscription_schedules/sub_sched_down')) {
        return {
          ok: true,
          json: async () => ({
            id: 'sub_sched_down',
            status: 'active',
            end_behavior: 'release',
            phases: [
              {
                start_date: PERIOD_START,
                end_date: PERIOD_END,
                items: [
                  { price: 'price_pro_monthly', quantity: 1 },
                  { price: 'price_pro_dataset', quantity: 1 },
                ],
              },
              {
                start_date: PERIOD_END,
                end_date: PERIOD_END + 2_592_000,
                metadata: { plan: 'starter', orgId: 'org-real' },
                items: [
                  { price: 'price_starter_monthly', quantity: 1 },
                  { price: 'price_starter_dataset', quantity: 1 },
                ],
              },
            ],
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('rewrites the target phase with the quantity that was paid for', async () => {
    const post = loadWithStripe()
    const response = await post(
      signed(
        withPrevious(applied, {
          items: { data: [] },
          pending_update: {
            expires_at: 1_790_685_512,
            subscription_items: [{ id: 'si_price_pro_dataset', quantity: 4 }],
          },
        }),
      ),
    )
    expect(response.status).toBe(200)
    const body = scheduleWrite()
    expect(body).not.toBeNull()
    // The purchase survives the flip, re-priced to the target plan.
    expect(phaseQuantity(body, 1, 'price_starter_dataset')).toBe('4')
    // The present is restated from the live subscription.
    expect(phaseQuantity(body, 0, 'price_pro_dataset')).toBe('4')
    expect(body?.get('phases[1][metadata][plan]')).toBe('starter')
    expect(body?.get('proration_behavior')).toBe('none')
  })

  it('CONTROL: an ordinary update (no held change applied) leaves the schedule alone', async () => {
    const post = loadWithStripe()
    await post(signed(withPrevious(applied, { items: { data: [] } })))
    expect(scheduleWrite()).toBeNull()
  })

  it('CONTROL: a change still HELD refreshes nothing', async () => {
    const post = loadWithStripe()
    await post(
      signed(
        withPrevious(
          { ...applied, pending_update: { expires_at: 1_790_685_512 } },
          { latest_invoice: 'in_old', pending_update: null },
        ),
      ),
    )
    expect(scheduleWrite()).toBeNull()
  })
})
