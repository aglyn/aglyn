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
 * A subscription must not INVENT the workspace it claims to belong to
 * (AGL-1763).
 *
 * `metadata.orgId` is caller data — Stripe echoes back whatever checkout
 * stamped, and a dashboard-edited, hand-migrated or stale subscription can name
 * a workspace that is gone or never was. Guarded only by `if (orgId)`, the
 * merge-set below it CREATED `orgs/{orgId}`, holding a paid `plan` and nothing
 * else: no owner, no members, no slug. That document is invisible to every
 * console list (they scope by membership) and simultaneously authoritative to
 * everything that matters — every feature gate reads `org.plan`, and
 * `orgMonthlyRevenueUsd` counts it. A phantom organisation appears in revenue.
 *
 * Driven through the REAL route with a REAL signed payload, because "the guard
 * exists" and "the guard is wired" are different claims and only the second is
 * worth anything. Counting what LANDED: assertions read the in-memory store by
 * document path, each stored field checked individually (AGL-1711).
 *
 * The fake is faithful in the two places the whole file rests on:
 *
 * - `update()` rejects a missing document with the real gRPC `NOT_FOUND`. One
 *   that created instead would pass against the broken code as happily as
 *   against the fix.
 * - `update()` also rejects a delete sentinel below the top level with
 *   `INVALID_ARGUMENT`, exactly as `@google-cloud/firestore` does
 *   (`allowDeletes: 'root'`) and unlike the merge-set this replaced, which
 *   accepts one at any depth. That is a real trap on this path: the discount
 *   mirror clears fields with sentinels, so writing it as a nested map under
 *   `update()` would 500 the webhook. The rewrite to dotted paths is what
 *   avoids it, and this is what proves the rewrite was needed.
 *
 * NO STRIPE PATH IS EXERCISED — localhost carries the LIVE key. `global.fetch`
 * is replaced for the whole file and every call it receives is asserted.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'

/** gRPC `Status.NOT_FOUND` / `Status.INVALID_ARGUMENT`. */
const GRPC_NOT_FOUND = 5
const GRPC_INVALID_ARGUMENT = 3

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
 * No `STRIPE_SECRET_KEY`: the two best-effort Stripe steps self-select on it,
 * so leaving it unset keeps this file's subject — what lands in Firestore —
 * uncluttered. One test sets it, to pin that the customer stamp still runs off
 * the hoisted snapshot.
 */
const BASE_ENV = {
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
}

/** Every document, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()
/** Appended `adminAudit` rows, in order. */
let audit: Record<string, unknown>[] = []
/** Fires before an `update()` resolves, to open the mid-handler race window. */
let onUpdate: ((path: string) => void) | null = null

const mockWriteOrgBilling = jest.fn()
const mockNotifyOrgAdmins = jest.fn()

const DELETE_SENTINEL = '__delete__'

/** Applies one `update()` key, honouring dotted field paths. */
function applyUpdateKey(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  const segments = key.split('.')
  let cursor = target
  for (const segment of segments.slice(0, -1)) {
    if (typeof cursor[segment] !== 'object' || cursor[segment] === null) {
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  }
  const leaf = segments[segments.length - 1]
  if (value === DELETE_SENTINEL) delete cursor[leaf]
  else cursor[leaf] = value
}

/** True when a delete sentinel hides anywhere below the top level. */
function hasNestedDelete(value: unknown, depth: number): boolean {
  if (value === DELETE_SENTINEL) return depth > 0
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value as Record<string, unknown>).some((entry) =>
    hasNestedDelete(entry, depth + 1),
  )
}

/**
 * `set(…, { merge: true })` the way Firestore actually does it: maps merge
 * RECURSIVELY, and a delete sentinel is honoured at ANY depth.
 *
 * Faithful on purpose, and it is what makes the non-vacuity measurement mean
 * something. A shallow spread would replace the whole `discount` map and drop
 * sentinels on the floor, so the two discount pins below would "fail" against
 * HEAD for a reason invented by the fake rather than any defect — turning a
 * behaviour-preservation pin into a fake red.
 */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE_SENTINEL) {
      delete next[key]
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      next[key] = mergeInto(
        (typeof next[key] === 'object' && next[key] !== null
          ? next[key]
          : {}) as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

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
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      docs.set(
        path,
        options?.merge
          ? mergeInto((docs.get(path) ?? {}) as Record<string, unknown>, data)
          : mergeInto({}, data),
      )
      return undefined
    },
    update: async (data: Record<string, unknown>) => {
      onUpdate?.(path)
      for (const [key, value] of Object.entries(data)) {
        // `allowDeletes: 'root'` — a sentinel one level down is an argument
        // error, not a merge. Reproduced so a revert to a nested map is caught
        // here rather than by a 500 in production.
        if (hasNestedDelete(value, 0)) {
          const error: Error & { code?: number } = new Error(
            `3 INVALID_ARGUMENT: FieldValue.delete() must appear at the top-level (${key})`,
          )
          error.code = GRPC_INVALID_ARGUMENT
          throw error
        }
      }
      if (!docs.has(path)) {
        const error: Error & { code?: number } = new Error(
          `5 NOT_FOUND: no entity to update: ${path}`,
        )
        error.code = GRPC_NOT_FOUND
        throw error
      }
      const next = structuredClone(docs.get(path)) as Record<string, unknown>
      for (const [key, value] of Object.entries(data)) {
        applyUpdateKey(next, key, value)
      }
      docs.set(path, next)
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
        if (name === 'adminAudit') audit.push({ ...data })
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
    }),
  }
}

/**
 * The REAL helper, reached by its own module path so the barrel — and
 * firebase-admin behind it — stays out of this suite.
 */
const mockUpdateExisting = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/update-existing',
).updateExisting

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
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
  notifyOrgAdmins: (...args: unknown[]) => mockNotifyOrgAdmins(...args),
  sendGa4Purchase: async () => undefined,
  sendGa4Refund: async () => undefined,
  sendGa4SubscriptionCancelled: async () => undefined,
  writeOrgBilling: (...args: unknown[]) => mockWriteOrgBilling(...args),
  updateExisting: (...args: unknown[]) => mockUpdateExisting(...args),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

const PLAN_ITEM = {
  id: 'si_plan',
  price: {
    id: 'price_starter_monthly',
    recurring: { interval: 'month' },
    unit_amount: 2500,
  },
}

/** Every fetch the route made, so "no Stripe call" is counted, not trusted. */
let fetched: string[] = []

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
  objectOverrides: Record<string, unknown> = {},
  type = 'customer.subscription.updated',
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        metadata: { orgId: 'org-real', plan: 'starter' },
        items: { data: [PLAN_ITEM] },
        current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
        ...objectOverrides,
      },
    },
  }
}

function loadWebhook(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/** A real workspace: the fields a phantom conspicuously lacks. */
function seedOrg(id = 'org-real', extra: Record<string, unknown> = {}) {
  docs.set(`orgs/${id}`, {
    name: 'Acme Ltd',
    slug: 'acme',
    ownerUid: 'user-1',
    plan: 'free',
    ...extra,
  })
}

beforeEach(() => {
  docs = new Map()
  audit = []
  onUpdate = null
  fetched = []
  mockWriteOrgBilling.mockReset()
  mockNotifyOrgAdmins.mockReset()
  global.fetch = jest.fn(async (url: unknown) => {
    fetched.push(String(url))
    return { ok: true, json: async () => ({}) }
  }) as never
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('a subscription naming no workspace (AGL-1763)', () => {
  it('creates NO org document, and none of its downstream mirrors', async () => {
    const post = loadWebhook()
    seedOrg()
    const response = await post(
      signed(
        subscriptionEvent({ metadata: { orgId: 'org-typo', plan: 'business' } }),
      ),
    )

    // 200 on purpose: this is permanent, not transient. A 500 would un-claim
    // the event (AGL-498) and buy days of identical retries.
    expect(response.status).toBe(200)

    // The phantom, asserted as an absence AND field by field, because "no
    // document" and "a document with no plan" are different failures.
    expect(docs.has('orgs/org-typo')).toBe(false)
    expect(docs.get('orgs/org-typo')?.['plan']).toBeUndefined()
    expect(docs.get('orgs/org-typo')?.['discount']).toBeUndefined()

    // `writeOrgBilling` is the second Firestore writer on this path: it
    // merge-sets `billingStatus` back onto the org doc AND stamps
    // `stripeCustomers/{id} -> orgId`, which would keep routing every later
    // invoice event at the phantom.
    expect(mockWriteOrgBilling).not.toHaveBeenCalled()

    // The real workspace is untouched — still on its own plan.
    expect(docs.get('orgs/org-real')?.['plan']).toBe('free')

    // No Stripe call left the handler.
    expect(fetched).toEqual([])
  })

  it('RECORDS the orphan for staff, every field individually', async () => {
    // Refusing silently would be the AGL-1760 failure in the other direction:
    // the subscription is real and billing, so a customer would be paying for
    // a workspace that does not exist with nothing to reconcile against.
    const post = loadWebhook()
    const response = await post(
      signed(
        subscriptionEvent(
          { metadata: { orgId: 'org-typo', plan: 'business' } },
          'customer.subscription.created',
        ),
      ),
    )
    expect(response.status).toBe(200)

    expect(audit).toHaveLength(1)
    expect(audit[0]['actorUid']).toBe('system:stripe-webhook')
    expect(audit[0]['action']).toBe('billing.orphanedSubscription')
    expect(audit[0]['target']).toBe('orgs/org-typo')
    expect(audit[0]['before']).toBeNull()
    expect(audit[0]['at']).toBe('__now__')
    const after = audit[0]['after'] as Record<string, unknown>
    expect(after['orgId']).toBe('org-typo')
    expect(after['reason']).toBe('no-such-org')
    expect(after['eventType']).toBe('customer.subscription.created')
    expect(after['subscriptionId']).toBe('sub_1')
    expect(after['stripeCustomerId']).toBe('cus_1')
    expect(after['plan']).toBe('business')
  })

  it('SECOND LINE: an org erased between the check and the write is not reborn', async () => {
    // The window the read cannot close. `update()` closes it; a merge-set
    // would recreate the org from the patch alone.
    const post = loadWebhook()
    seedOrg()
    onUpdate = (path) => {
      if (path === 'orgs/org-real') docs.delete(path)
    }

    const response = await post(signed(subscriptionEvent()))
    expect(response.status).toBe(200)
    expect(docs.has('orgs/org-real')).toBe(false)
    expect(mockWriteOrgBilling).not.toHaveBeenCalled()
    expect(audit).toHaveLength(1)
    expect((audit[0]['after'] as Record<string, unknown>)['reason']).toBe(
      'erased-mid-handler',
    )
  })
})

describe('a subscription naming a REAL workspace still mirrors (AGL-1763)', () => {
  it('writes the plan and leaves every unrelated field alone', async () => {
    const post = loadWebhook()
    seedOrg()
    const response = await post(signed(subscriptionEvent()))
    expect(response.status).toBe(200)

    const org = docs.get('orgs/org-real') as Record<string, unknown>
    expect(org['plan']).toBe('starter')
    // `update()` must PATCH, not replace.
    expect(org['name']).toBe('Acme Ltd')
    expect(org['slug']).toBe('acme')
    expect(org['ownerUid']).toBe('user-1')

    expect(mockWriteOrgBilling).toHaveBeenCalledTimes(1)
    expect(mockWriteOrgBilling.mock.calls[0][0]).toBe('org-real')
    expect(mockWriteOrgBilling.mock.calls[0][1].stripeCustomerId).toBe('cus_1')
    expect(audit).toHaveLength(0)
  })

  it('mirrors a coupon as dotted paths, PRESERVING the staff-set keys', async () => {
    // The nested-map merge this replaced kept `appliedBy`/`reason` by reading
    // them and rewriting them. Dotted paths must reach the same place, or a
    // periodic `subscription.updated` silently erases the audit context.
    const post = loadWebhook()
    seedOrg('org-real', {
      discount: {
        couponId: 'OLD',
        appliedBy: 'staff-9',
        appliedAt: '__seeded__',
        reason: 'negotiated at renewal',
      },
    })
    const response = await post(
      signed(
        subscriptionEvent({
          discount: {
            coupon: { id: 'SAVE20', percent_off: 20, name: 'SAVE20' },
            promotion_code: 'promo_1',
          },
        }),
      ),
    )
    expect(response.status).toBe(200)

    const discount = (docs.get('orgs/org-real') as Record<string, any>)[
      'discount'
    ]
    expect(discount['couponId']).toBe('SAVE20')
    expect(discount['percentOff']).toBe(20)
    expect(discount['code']).toBe('SAVE20')
    expect(discount['promotionCodeId']).toBe('promo_1')
    // Stripe does not carry these; they must survive the resync.
    expect(discount['appliedBy']).toBe('staff-9')
    expect(discount['appliedAt']).toBe('__seeded__')
    expect(discount['reason']).toBe('negotiated at renewal')
    // `amount_off` was absent, so its mirror is CLEARED rather than left stale
    // — the delete sentinel, at the top level of the patch where `update()`
    // accepts it.
    expect('amountOffUsd' in discount).toBe(false)
  })

  it('clears the whole discount on a cancellation', async () => {
    const post = loadWebhook()
    seedOrg('org-real', { discount: { couponId: 'SAVE20', percentOff: 20 } })
    const response = await post(
      signed(subscriptionEvent({}, 'customer.subscription.deleted')),
    )
    expect(response.status).toBe(200)

    const org = docs.get('orgs/org-real') as Record<string, unknown>
    expect(org['plan']).toBe('free')
    expect('discount' in org).toBe(false)
    expect(org['name']).toBe('Acme Ltd')
  })

  it('stamps the Stripe customer off the HOISTED snapshot, with one org read', async () => {
    // The block used to read the org doc twice, conditionally, neither time
    // checking `.exists`. Both reads now come off the guard's snapshot.
    const post = loadWebhook({ STRIPE_SECRET_KEY: 'sk_test_fake' })
    seedOrg()
    const response = await post(signed(subscriptionEvent()))
    expect(response.status).toBe(200)
    expect(fetched).toEqual(['https://api.stripe.com/v1/customers/cus_1'])
  })

  it('NEGATIVE CONTROL: an invalid signature is refused before any read', async () => {
    const post = loadWebhook()
    seedOrg()
    const response = await post(signed(subscriptionEvent(), 'whsec_wrong'))
    expect(response.status).toBe(400)
    expect(docs.get('orgs/org-real')?.['plan']).toBe('free')
    expect(audit).toHaveLength(0)
  })
})

/**
 * A scheduled downgrade that has LANDED must stop being pending (AGL-2144).
 *
 * `writeOrgBilling` merge-sets, and a merge preserves nested keys it does not
 * mention — so `subscription.pendingDowngrade` survived the phase flip
 * verbatim. Nothing else cleared it: the two clears in
 * `/api/billing/subscription` cover schedule release and "keep my plan", and
 * no `subscription_schedule.*` event is handled anywhere. The org doc was left
 * asserting a move it had already made, with an `effectiveAt` receding into
 * the past, and the billing page rendered that forever as a warning chip plus
 * a prominent button offering to undo it.
 *
 * The detection is a POSITIVE signal — the mirrored plan equalling the pending
 * target, which phase 1's `metadata[plan]` makes true at the flip. The absence
 * of a schedule would have been the wrong signal: `subscription.updated`
 * events are not ordered, so one predating the schedule attach would drop a
 * downgrade the customer really had scheduled.
 */
describe('a completed downgrade stops being pending (AGL-2144)', () => {
  /** The mirror `writeOrgBilling` was handed, or undefined. */
  function mirroredSubscription(): Record<string, unknown> | undefined {
    return mockWriteOrgBilling.mock.calls[0]?.[1]?.subscription
  }

  it('clears pendingDowngrade once the phase has flipped to the target tier', async () => {
    const post = loadWebhook()
    seedOrg('org-real', {
      plan: 'pro',
      subscription: {
        status: 'active',
        pendingDowngrade: { plan: 'starter', scheduleId: 'sub_sched_1' },
      },
    })
    // Phase 1 stamps metadata.plan with the target tier, so this event IS the
    // flip: the subscription now reads `starter`, the tier it was scheduled
    // to move to.
    const response = await post(
      signed(subscriptionEvent({ metadata: { orgId: 'org-real', plan: 'starter' } })),
    )
    expect(response.status).toBe(200)
    expect(mirroredSubscription()).toMatchObject({ pendingDowngrade: null })
  })

  it('LEAVES it alone while the downgrade is still in the future', async () => {
    // The control that makes the test above mean something: an ordinary
    // `subscription.updated` before the flip still reports the OLD tier, and
    // must not drop a downgrade the customer scheduled and is waiting on.
    const post = loadWebhook()
    seedOrg('org-real', {
      plan: 'pro',
      subscription: {
        status: 'active',
        pendingDowngrade: { plan: 'starter', scheduleId: 'sub_sched_1' },
      },
    })
    const response = await post(
      signed(subscriptionEvent({ metadata: { orgId: 'org-real', plan: 'pro' } })),
    )
    expect(response.status).toBe(200)
    expect(mirroredSubscription()).toBeDefined()
    expect('pendingDowngrade' in (mirroredSubscription() ?? {})).toBe(false)
  })

  it('a cancellation clears it too — there is no subscription left to move down', async () => {
    const post = loadWebhook()
    seedOrg('org-real', {
      plan: 'pro',
      subscription: {
        status: 'active',
        pendingDowngrade: { plan: 'starter', scheduleId: 'sub_sched_1' },
      },
    })
    const response = await post(
      signed(subscriptionEvent({}, 'customer.subscription.deleted')),
    )
    expect(response.status).toBe(200)
    expect(mirroredSubscription()).toMatchObject({ pendingDowngrade: null })
  })

  it('an org that never scheduled one is not handed a null it never had', async () => {
    const post = loadWebhook()
    seedOrg('org-real', { plan: 'starter', subscription: { status: 'active' } })
    const response = await post(signed(subscriptionEvent()))
    expect(response.status).toBe(200)
    expect('pendingDowngrade' in (mirroredSubscription() ?? {})).toBe(false)
  })
})
