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
 * A DELIVERY THAT ONLY LANDED ON A RETRY (AGL-2039, the last arm of AGL-1948).
 *
 * `GET /v1/events?delivery_success=false` is a TERMINAL-state filter over
 * EVENTS. An event that 400s three times and succeeds on the fourth reads
 * back `delivery_success: true`, so it is zero in `undelivered`, zero in
 * `inert` (the handler did eventually run) and present in `processed`. Every
 * number `/api/health/billing` reads describes a healthy hour while three
 * real delivery attempts failed.
 *
 * That is not a hypothetical. AGL-1906 reported a 0.00% error rate over the
 * same window the Stripe Dashboard was showing 30% for, and both were right:
 * one counts events, the other counts attempts. The three attempts the
 * Dashboard counted were AGL-1551's.
 *
 * ## What this suite proves
 *
 * The route is DRIVEN for real. A retried delivery and a prompt one are
 * asserted to be byte-for-byte identical from outside — same status, same
 * body, same claim document except the marker — because that identity IS the
 * bug. If they differed anywhere else the suite would be proving something
 * easier.
 *
 * ## And the trap that would have made it worse than useless
 *
 * `strictNullChecks` is OFF repo-wide. An event with no `created` folds to
 * falsy, and the obvious `Number(event?.created ?? 0)` subtracts to a lag of
 * ~1.7 BILLION seconds — marking EVERY such delivery a retry, forever, on a
 * perfectly healthy webhook. A billing alarm that reds on its own missing
 * input is the shape that gets muted, taking the real alarm with it. Absent,
 * zero and non-numeric are each asserted to stamp NOTHING.
 *
 * Harness lifted from `billing-webhook-inert.spec.ts`.
 * NO STRIPE PATH IS EXERCISED: `global.fetch` is a jest mock.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
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

const LIVE_DEPLOYMENT = {
  STRIPE_SECRET_KEY: 'sk_live_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_live_fake',
}

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
      if (!docs.has(path)) {
        const error = new Error(`5 NOT_FOUND: ${path}`) as Error & { code?: number }
        error.code = 5
        throw error
      }
      docs.set(path, { ...docs.get(path), ...data })
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
  })
  const query = (
    name: string,
    filters: readonly [string, unknown][],
    max: number | null,
  ) => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unmodelled query operator: ${op}`)
      return query(name, [...filters, [field, value]], max)
    },
    limit: (count: number) => query(name, filters, count),
    get: async () => {
      const matches = [...docs.keys()]
        .filter((path) => path.startsWith(`${name}/`))
        .filter((path) =>
          filters.every(([field, value]) => (docs.get(path) ?? {})[field] === value),
        )
        .map((path) => ({
          id: path.split('/').pop() as string,
          exists: true,
          data: () => docs.get(path),
          get: (field: string) => (docs.get(path) ?? {})[field],
          ref: doc(path),
        }))
      return {
        docs: max == null ? matches : matches.slice(0, max),
        empty: matches.length === 0,
      }
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
      where: (field: string, op: string, value: unknown) =>
        query(name, [], null).where(field, op, value),
    }),
  }
}

jest.mock('next/server', () => ({
  after: (work: () => unknown) => work(),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW' },
  // THE REAL lag classifier, ledger, classifier and write observer. Stubbing
  // any of them would make this suite an assertion about a test double.
  classifyDeliveryLag: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).classifyDeliveryLag,
  classifyWebhookDelivery: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).classifyWebhookDelivery,
  createWebhookEffectLedger: jest.requireActual(
    '@aglyn/aglyn/app-utils/webhook-delivery',
  ).createWebhookEffectLedger,
  observeWrites: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery')
    .observeWrites,
  runBillingWebhookHandlers: async () => ({ claimed: false }),
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  SELF_SERVE_PLANS: ['free', 'starter', 'pro', 'business', 'scale'],
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockMakeFirestore() }),
    firestore: {
      FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__now__' },
    },
  },
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_own_1' ? 'org-real' : null,
  notifyOrgAdmins: async () => undefined,
  notifyStaff: async () => undefined,
  sendGa4Purchase: async () => ({ sent: true, synthesizedClientId: true }),
  sendGa4Refund: async () => ({ sent: true, synthesizedClientId: true }),
  sendGa4SubscriptionCancelled: async () => ({
    sent: true,
    synthesizedClientId: true,
  }),
  writeOrgBilling: async () => undefined,
  updateExisting: async (
    ref: { update: (data: Record<string, unknown>) => Promise<unknown> },
    data: Record<string, unknown>,
  ) => {
    try {
      await ref.update(data)
      return true
    } catch (error) {
      if ((error as { code?: number })?.code === 5) return false
      throw error
    }
  },
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

function signed(body: unknown, secret: string) {
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
  process.env = { ...CLEAN_ENV, ...LIVE_DEPLOYMENT } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/** A paid workspace's subscription — a delivery that really does work. */
const OUR_SUBSCRIPTION = {
  id: 'sub_own_1',
  object: 'subscription',
  customer: 'cus_own_1',
  status: 'active',
  metadata: { orgId: 'org-real', plan: 'pro' },
  items: { data: [{ price: { id: 'price_pro', recurring: { interval: 'month' } } }] },
}

/**
 * An event carrying an explicit `created`. `created` is passed through
 * `Object.assign` rather than defaulted, so a case can omit it entirely —
 * which is one of the cases that matters.
 */
function event(
  id: string,
  created: unknown,
  overrides: Record<string, unknown> = {},
) {
  const base: Record<string, unknown> = {
    id,
    type: 'customer.subscription.updated',
    livemode: true,
    data: { object: OUR_SUBSCRIPTION },
    ...overrides,
  }
  if (created !== 'OMIT') base['created'] = created
  return base
}

const claim = (id: string) => docs.get(`stripeEvents/${id}`)
const wasMarkedRetried = (id: string) => claim(id)?.['retriedAtMs'] !== undefined

/** Unix SECONDS, the unit Stripe stamps `event.created` in. */
const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('the webhook records a delivery that only landed on a RETRY (AGL-2039)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'starter' })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as never
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('THE HEALTHY CONTROL: a delivery that lands promptly is NOT marked', async () => {
    const response = await loadWebhook()(
      signed(event('evt_prompt', nowSeconds()), 'whsec_live_fake'),
    )

    expect(response.status).toBe(200)
    // The work actually happened — otherwise the control proves nothing.
    expect(docs.get('orgs/org-real')?.['plan']).toBe('pro')
    expect(wasMarkedRetried('evt_prompt')).toBe(false)
    // An ordinary claim stays exactly two fields, so the `retriedAtMs`
    // aggregation and the `receivedAt` one cannot contaminate each other.
    expect(Object.keys(claim('evt_prompt') as object).sort()).toEqual([
      'receivedAt',
      'type',
    ])
  })

  it('THE AGL-1551 LAG: an event created 4h 37m ago IS marked', async () => {
    // The real lag of `evt_1U49XtDYHP4psn7hA9VHPnZz`, whose three 400s ARE
    // the three failures the Stripe Dashboard was reporting while this
    // platform's own audit read a 0.00% error rate over the same window.
    const response = await loadWebhook()(
      signed(event('evt_late', nowSeconds() - 16_665), 'whsec_live_fake'),
    )

    expect(response.status).toBe(200)
    expect(wasMarkedRetried('evt_late')).toBe(true)
    expect(claim('evt_late')?.['retriedType']).toBe('customer.subscription.updated')
    expect(claim('evt_late')?.['deliveryLagSeconds']).toBeGreaterThan(16_000)
  })

  it('the retried and the prompt delivery are IDENTICAL from outside', async () => {
    // The bug is precisely that they do not differ. Everything Stripe, the
    // delivery log and `undelivered` can see is the same on both.
    const prompt = await loadWebhook()(
      signed(event('evt_a', nowSeconds()), 'whsec_live_fake'),
    )
    const promptBody = await prompt.json()

    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'starter' })
    const late = await loadWebhook()(
      signed(event('evt_b', nowSeconds() - 20_000), 'whsec_live_fake'),
    )
    const lateBody = await late.json()

    expect(late.status).toBe(prompt.status)
    expect(lateBody).toEqual(promptBody)
    // ...and the work landed on BOTH, so this is not the inert shape wearing
    // a different name.
    expect(docs.get('orgs/org-real')?.['plan']).toBe('pro')
    expect(wasMarkedRetried('evt_b')).toBe(true)
  })

  /*==========================================
   * THE strictNullChecks TRAP.
   *
   * Each of these would mark EVERY delivery a retry under the naive
   * `Number(event?.created ?? 0)`, because the lag from the epoch is ~1.7
   * billion seconds. A billing alarm permanently red on its own missing
   * input is the one that gets muted.
   *=========================================*/
  it.each([
    ['ABSENT — the field is not on the event at all', 'OMIT'],
    ['ZERO — the value an absent field folds to', 0],
    ['a string', '1770000000'],
    ['null', null],
  ])('a created that is %s stamps NOTHING', async (_label, created) => {
    const response = await loadWebhook()(
      signed(event('evt_unmeasurable', created), 'whsec_live_fake'),
    )

    expect(response.status).toBe(200)
    expect(wasMarkedRetried('evt_unmeasurable')).toBe(false)
    // The claim itself is unaffected — the delivery is processed normally.
    expect(claim('evt_unmeasurable')).toBeTruthy()
    expect(docs.get('orgs/org-real')?.['plan']).toBe('pro')
  })

  it('the marker does NOT ride on the field the processed count reads', async () => {
    // `/api/health/billing` counts claims by `receivedAt`. A marker sharing
    // that field would inflate the very number it sits beside.
    await loadWebhook()(
      signed(event('evt_field', nowSeconds() - 20_000), 'whsec_live_fake'),
    )
    const marked = claim('evt_field') as Record<string, unknown>

    expect(marked['retriedAtMs']).toEqual(expect.any(Number))
    expect(Object.keys(marked)).toContain('receivedAt')
    // And not on the inert field either: the two counts are separate
    // questions and a delivery can be late AND have done its work.
    expect(marked['inertAtMs']).toBeUndefined()
  })

  it('says so in the log, so the incident is diagnosable without Firestore', async () => {
    const warns = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await loadWebhook()(
      signed(event('evt_logged', nowSeconds() - 20_000), 'whsec_live_fake'),
    )

    expect(
      warns.mock.calls.some((call) => String(call[0]).includes('landed on a RETRY')),
    ).toBe(true)
  })
})
