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
 * The Aglyn AI add-on lands on the org through the webhook (AGL-2897).
 *
 * Nothing in checkout or the add-ons route grants the add-on. Both attach a
 * `STRIPE_PRICE_{PLAN}_AI_ADDON[_YEARLY]` item to the subscription, and the
 * subscription events rewrite `org.seatAddons` from the items through
 * `addonQuantitiesFromItems` — so `seatAddons.aiAddon` is 1 exactly while the
 * item is on the subscription, and 0 the moment it is not. `seatAddons` is an
 * ENTITLEMENT INPUT: `resolveOrgEntitlements` folds it into
 * `features.aiGenerative` and the assist band, which is what this file pins
 * end to end rather than at either half.
 *
 * Harness lifted from `billing-webhook-ga-cancellation.spec.ts`. NO STRIPE
 * PATH IS EXERCISED: `global.fetch` is a jest mock.
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

const BASE_ENV = {
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_annual',
  STRIPE_PRICE_PRO_AI_ADDON: 'price_pro_ai_addon',
  STRIPE_PRICE_PRO_AI_ADDON_YEARLY: 'price_pro_ai_addon_yearly',
  STRIPE_PRICE_PRO_EXTRA_HOST: 'price_pro_extra_host',
}

/** Every `writeOrgBilling(orgId, payload)` the route made. */
const mockBillingWrites: Array<{ orgId: string; payload: any }> = []

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
  updateExisting: async () => true,
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

// The REAL resolver, outside the mock: the assertion is that the map the
// webhook wrote flips the feature, and a stubbed resolver would answer
// whatever this file told it to.
const {
  AI_ADDON_CREDITS_PER_MONTH,
  PLAN_ENTITLEMENTS,
  resolveOrgEntitlements,
} = require('../../../libs/aglyn/src/lib/app-utils/plan-entitlements')

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

/** A subscription item as Stripe sends it, trimmed to what the route reads. */
const item = (priceId: string, quantity = 1, interval = 'month') => ({
  id: `si_${priceId}`,
  price: { id: priceId, recurring: { interval } },
  quantity,
})

function subscription(items: unknown[], over: Record<string, unknown> = {}) {
  return {
    id: 'sub_ai_1',
    object: 'subscription',
    customer: 'cus_own_1',
    status: 'active',
    created: 1_768_000_000,
    current_period_end: 1_770_000_000,
    metadata: { orgId: 'org-real', plan: 'pro' },
    items: { data: items },
    ...over,
  }
}

/** The one org-billing write a delivery made. */
function mirrored() {
  expect(mockBillingWrites).toHaveLength(1)
  expect(mockBillingWrites[0].orgId).toBe('org-real')
  return mockBillingWrites[0].payload
}

describe('the AI add-on item becomes seatAddons.aiAddon (AGL-2897)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    mockBillingWrites.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('writes aiAddon: 1 while the monthly add-on item is on the subscription', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(subscriptionEvent(subscription([
        item('price_pro_monthly'),
        item('price_pro_ai_addon'),
      ]))),
    )
    expect(response.status).toBe(200)
    const { seatAddons } = mirrored()
    expect(seatAddons.aiAddon).toBe(1)
    // The map is FULL — explicit zeros for every other kind — so the write
    // converges on the subscription rather than merging over a stale doc.
    expect(seatAddons.hosts).toBe(0)
    expect(seatAddons.eventCalendar).toBe(0)
  })

  it('recognises the yearly variant, so an annual org is granted too', async () => {
    const post = loadWebhook()
    await post(
      signed(subscriptionEvent(subscription([
        item('price_pro_annual', 1, 'year'),
        item('price_pro_ai_addon_yearly', 1, 'year'),
      ]))),
    )
    expect(mirrored().seatAddons.aiAddon).toBe(1)
  })

  it('clears it — aiAddon: 0, not absent — once the item is gone', async () => {
    const post = loadWebhook()
    await post(
      signed(subscriptionEvent(subscription([
        item('price_pro_monthly'),
        item('price_pro_extra_host', 2),
      ]))),
    )
    const { seatAddons } = mirrored()
    expect(seatAddons.aiAddon).toBe(0)
    expect(seatAddons.hosts).toBe(2)
    expect(Object.prototype.hasOwnProperty.call(seatAddons, 'aiAddon')).toBe(true)
  })

  it('a cancellation zeroes it with everything else', async () => {
    const post = loadWebhook()
    await post(
      signed(
        subscriptionEvent(
          subscription(
            [item('price_pro_monthly'), item('price_pro_ai_addon')],
            { status: 'canceled', ended_at: 1_769_000_000 },
          ),
          { type: 'customer.subscription.deleted' },
        ),
      ),
    )
    expect(mirrored().seatAddons.aiAddon).toBe(0)
  })

  it('the written map flips aiGenerative and widens the assist band', async () => {
    const post = loadWebhook()
    await post(
      signed(subscriptionEvent(subscription([
        item('price_pro_monthly'),
        item('price_pro_ai_addon'),
      ]))),
    )
    const granted = resolveOrgEntitlements({ plan: 'pro', seatAddons: mirrored().seatAddons })
    expect(granted.features.aiGenerative).toBe(true)
    expect(granted.features.aiAssist).toBe(true)
    expect(granted.assistCreditsPerMonth).toBe(
      PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth + AI_ADDON_CREDITS_PER_MONTH.pro,
    )

    // …and the removal takes it back, from the SAME writer.
    mockBillingWrites.length = 0
    await post(signed(subscriptionEvent(subscription([item('price_pro_monthly')]))))
    const revoked = resolveOrgEntitlements({ plan: 'pro', seatAddons: mirrored().seatAddons })
    expect(revoked.features.aiGenerative).toBe(false)
    expect(revoked.assistCreditsPerMonth).toBe(PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth)
  })
})
