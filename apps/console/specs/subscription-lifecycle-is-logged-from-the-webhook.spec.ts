/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor and every case here fails identically.
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
 * THE SUBSCRIPTION LIFECYCLE REACHES THE WORKSPACE FEED, AND NOBODY IS NAMED
 * WHO DID NOT ACT (AGL-118).
 *
 * Signing up, upgrading, downgrading and being cancelled by Stripe were all
 * invisible: they mirrored onto the org doc and appeared in no log at all, so
 * a workspace whose plan silently became `free` had nothing to read that said
 * when, or why, or whether a person did it.
 *
 * The writer is the WEBHOOK, not the console route, because the webhook
 * reports what HAPPENED where the route reports what was ATTEMPTED — and
 * because Stripe ends subscriptions on its own, which the console never hears
 * about. The cost is that the webhook has no session, so the acting uid
 * travels in Stripe metadata.
 *
 * ## What actually needs guarding
 *
 * Metadata PERSISTS. A uid stamped at checkout is still sitting on the
 * subscription a year later when dunning cancels it, so the naive reader puts
 * a real person's name on a cancellation nobody performed. That is the
 * org-owner inference this issue rejected, wearing a different hat and looking
 * like evidence — and it is what the attribution cases below exist for.
 *
 * ## The controls
 *
 * Every "writes nothing" and "names nobody" case is paired with one that
 * writes and one that names. Without the pair, a route that logs nothing at
 * all and a reader that attributes nothing ever pass the whole file.
 *
 * Assertions are on the WRITTEN ENTRY — the arguments handed to
 * `logOrgActivity` — never on the response or on anything rendered.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import type { Ga4SendResult } from '@aglyn/tenant-data-admin'

import { subscriptionActivityEntry } from '../app/api/billing/webhook/subscription-activity'

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
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
}

type NotifyInput = { type: string; title: string; orgId: string; link: string }

const mockNotifications: NotifyInput[] = []
const mockBillingWrites: Array<{ orgId: string; patch: any }> = []
/** Every `plan` the route asked the org mirror to write. */
const mockPlanMirrors: Array<{ orgId: string; plan: string }> = []
/** Every org activity entry, exactly as the route composed it. */
const mockOrgActivity: Array<{
  orgId: string
  actor: { uid: string | null; email: string | null }
  action: string
  target: Record<string, unknown>
}> = []

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
    // `options` is HONOURED, not dropped. A double that ignores `merge`
    // replaces the document and makes a document-replacing regression
    // unassertable — the exact shape that has produced false greens here
    // before.
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

/** See `billing-webhook-ga-cancellation.spec.ts` — records AND runs inline. */
const mockAfterScheduled: Array<() => unknown> = []
jest.mock('next/server', () => ({
  after: (work: () => unknown) => {
    mockAfterScheduled.push(work)
    return work()
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
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
  buildRoute: (_route: string, params: { orgSlug?: string }) =>
    `/${params?.orgSlug ?? 'org'}/billing`,
  Route: { MANAGE_BILLING: 'MANAGE_BILLING', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW' },
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
  // Captured, not stubbed — HALF the subject of this file.
  notifyOrgAdmins: async (orgId: string, input: Omit<NotifyInput, 'orgId'>) => {
    mockNotifications.push({ ...input, orgId })
  },
  // CAPTURED, not stubbed away — it is the subject of this file.
  logOrgActivity: async (
    orgId: string,
    actor: { uid: string | null; email: string | null },
    action: string,
    target: Record<string, unknown>,
  ) => {
    mockOrgActivity.push({ orgId, actor, action, target })
  },
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
  // Captured, not stubbed — the OTHER half.
  writeOrgBilling: async (orgId: string, patch: unknown) => {
    mockBillingWrites.push({ orgId, patch })
  },
  // CAPTURED. The entry claims a plan MOVED, and the only way to show the
  // claim is true is to see the mirror being asked to move it — a stub that
  // answers `true` and writes nothing would let every control below pass
  // against a route whose mirror had stopped working entirely.
  updateExisting: async (ref: { id?: string }, patch: Record<string, unknown>) => {
    mockPlanMirrors.push({ orgId: String(ref?.id ?? ''), plan: String(patch['plan'] ?? '') })
    // `false` is the workspace that was ERASED between this event arriving and
    // its mirror landing — `updateExisting` reports that it found nothing to
    // update. Controllable because the entry is gated on it and nothing else
    // here can produce that state.
    return mockMirrorLands
  },
}))

/** Whether the org mirror finds a workspace to write to. */
let mockMirrorLands = true

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
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/** A Stripe delivery envelope. The id is fresh so the idempotency claim on
 * `stripeEvents` never short-circuits a case that means to run. */
function event(object: Record<string, unknown>, type: string) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object },
  }
}

/** The entries this delivery produced. */
const entries = () => mockOrgActivity

/**
 * A subscription as Stripe delivers it, with the metadata under test.
 *
 * `plan` is the metadata key the mirror reads first, so it is what the org
 * doc becomes; `actorUid`/`actorAction` are the pair the console stamps.
 */
function subscription(options: {
  plan?: string
  status?: string
  actorUid?: string
  actorAction?: string
  cancellationReason?: string | null
}) {
  const {
    plan = 'pro',
    status = 'active',
    actorUid,
    actorAction,
    cancellationReason,
  } = options
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status,
    created: 1_787_173_753,
    current_period_end: 1_792_444_153,
    metadata: {
      orgId: 'org-real',
      plan,
      ...(actorUid ? { actorUid } : {}),
      ...(actorAction ? { actorAction } : {}),
    },
    ...(cancellationReason !== undefined
      ? { cancellation_details: { reason: cancellationReason } }
      : {}),
    items: {
      data: [
        {
          id: 'si_plan',
          price: {
            id: 'price_starter_monthly',
            recurring: { interval: 'month' },
            unit_amount: 2500,
          },
        },
      ],
    },
  }
}

describe('what a subscription event earns in the feed', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'starter' })
    mockNotifications.length = 0
    mockBillingWrites.length = 0
    mockOrgActivity.length = 0
    mockPlanMirrors.length = 0
    mockAfterScheduled.length = 0
    mockMirrorLands = true
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    })) as never
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('THE CONTROL — a plan change writes one entry, naming the person who asked', async () => {
    // First, because every "writes nothing" and "names nobody" case below
    // also passes against a route that logs nothing at all, forever.
    const post = loadWebhook()
    const response = await post(
      signed(
        event(
          subscription({ plan: 'pro', actorUid: 'uid-7', actorAction: 'switch' }),
          'customer.subscription.updated',
        ),
      ),
    )

    expect(response.status).toBe(200)
    // The mirror really moved — otherwise this is asserting the log of a plan
    // change that did not happen.
    expect(mockPlanMirrors).toEqual([{ orgId: 'org-real', plan: 'pro' }])

    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toEqual({
      orgId: 'org-real',
      // No email: the webhook holds a uid at best, and resolving an address
      // would answer with whoever holds that uid TODAY.
      actor: { uid: 'uid-7', email: null },
      action: 'Changed the plan from starter to pro',
      target: { type: 'subscription', id: 'sub_1', name: 'pro' },
    })
  })

  it('names NOBODY when Stripe cancels after failed payments', async () => {
    /*
     * THE CASE THIS FILE EXISTS FOR. The subscription still carries the
     * `subscribe` stamp from checkout — a real uid, a real person — and the
     * temptation is to read it. Two independent rules refuse: a `subscribe`
     * stamp does not sign a cancellation, and a cancellation Stripe decided
     * on has no actor whatever is stamped.
     */
    const post = loadWebhook()
    await post(
      signed(
        event(
          subscription({
            status: 'canceled',
            actorUid: 'uid-7',
            actorAction: 'subscribe',
            cancellationReason: 'payment_failed',
          }),
          'customer.subscription.deleted',
        ),
      ),
    )

    expect(entries()).toHaveLength(1)
    expect(entries()[0].actor.uid).toBeNull()
    expect(entries()[0].action).toBe(
      'Subscription canceled after failed payments',
    )
    // And the plan being LEFT, not the `free` the mirror just wrote — every
    // cancellation would otherwise say the same nothing.
    expect(entries()[0].target).toMatchObject({ name: 'starter' })
  })

  it('names the person who asked to cancel — the control for the case above', async () => {
    // Without this, "never attribute a cancellation" passes the case above
    // and ships a feed where no cancellation ever has a name.
    const post = loadWebhook()
    await post(
      signed(
        event(
          subscription({
            status: 'canceled',
            actorUid: 'uid-7',
            actorAction: 'cancel',
            cancellationReason: 'cancellation_requested',
          }),
          'customer.subscription.deleted',
        ),
      ),
    )

    expect(entries()).toHaveLength(1)
    expect(entries()[0].actor.uid).toBe('uid-7')
    expect(entries()[0].action).toBe('Canceled the subscription')
  })

  it('writes NOTHING for a renewal that moves no plan', async () => {
    // Stripe re-delivers `customer.subscription.updated` for renewals,
    // metered attaches and payment-method changes. A row on each would bury
    // the four events a year that matter under a monthly drip saying nothing
    // changed — and each would carry the stale stamp, so they would all be
    // attributed too.
    const post = loadWebhook()
    await post(
      signed(
        event(
          subscription({
            plan: 'starter',
            actorUid: 'uid-7',
            actorAction: 'subscribe',
          }),
          'customer.subscription.updated',
        ),
      ),
    )

    expect(entries()).toHaveLength(0)
  })

  it('writes NOTHING into a workspace that was erased mid-handler', async () => {
    /*
     * The `mirrored` gate. `logOrgActivity` writes into
     * `orgs/{orgId}/activity`, and an org whose document has just been erased
     * has no feed to file under — the write would recreate the parent path as
     * a side effect and leave one activity document standing in a workspace
     * that no longer exists.
     *
     * The route already records this case as an orphaned subscription, which
     * is the durable record of it. Without this test the gate can be deleted
     * and every other case here still passes, because in all of them the
     * mirror lands.
     */
    mockMirrorLands = false
    const post = loadWebhook()
    await post(
      signed(
        event(
          subscription({
            plan: 'pro',
            actorUid: 'uid-7',
            actorAction: 'switch',
          }),
          'customer.subscription.updated',
        ),
      ),
    )

    // The mirror was ATTEMPTED — otherwise this proves only that the handler
    // stopped early, which is a different thing from the gate holding.
    expect(mockPlanMirrors).toHaveLength(1)
    expect(mockOrgActivity).toHaveLength(0)
  })

  it('writes NOTHING into a workspace the subscription does not name', async () => {
    // A tenant shopper's product subscription carries no `metadata.orgId`
    // naming one of OUR workspaces. An entry here would put a merchant's
    // customer's billing event in the merchant's own audit trail.
    const post = loadWebhook()
    const foreign = subscription({ actorUid: 'uid-7', actorAction: 'switch' })
    const response = await post(
      signed(
        event({ ...foreign, metadata: { plan: 'pro' } }, 'customer.subscription.updated'),
      ),
    )

    expect(response.status).toBe(200)
    expect(entries()).toHaveLength(0)
  })
})

/**
 * The decision itself, exercised without a signed payload, an idempotency
 * claim and a Firestore double standing between the test and the question.
 *
 * The suite above proves the route CALLS this and writes what it returns; this
 * one covers the combinations that would need a delivery each.
 */
describe('subscriptionActivityEntry — which stamp may sign which event', () => {
  const base = {
    canceled: false,
    previousPlan: 'starter',
    plan: 'pro',
    cancellationReason: null,
    metadata: { actorUid: 'uid-7', actorAction: 'switch' },
  }

  it('THE CONTROL — a matching stamp attributes the change', () => {
    expect(subscriptionActivityEntry(base)).toEqual({
      kind: 'plan-changed',
      action: 'Changed the plan from starter to pro',
      actorUid: 'uid-7',
      plan: 'pro',
    })
  })

  it('reads a first paid plan as STARTED, not as a change from nothing', () => {
    expect(
      subscriptionActivityEntry({
        ...base,
        previousPlan: '',
        metadata: { actorUid: 'uid-7', actorAction: 'subscribe' },
      }),
    ).toMatchObject({
      kind: 'started',
      action: 'Started the pro subscription',
      actorUid: 'uid-7',
    })
  })

  it('lets a SCHEDULED downgrade name the person who scheduled it', () => {
    // The flip happens at period end with nobody present, weeks after the
    // request. The phase metadata carries the actor across that gap, and the
    // person who scheduled it genuinely is the actor.
    expect(
      subscriptionActivityEntry({
        ...base,
        previousPlan: 'pro',
        plan: 'starter',
        metadata: { actorUid: 'uid-9', actorAction: 'downgrade' },
      }),
    ).toMatchObject({ actorUid: 'uid-9', action: 'Changed the plan from pro to starter' })
  })

  it('refuses a stamp that signs a different kind of event', () => {
    // A `cancel` stamp sitting on the subscription cannot sign a plan change,
    // and a `subscribe` stamp cannot sign a cancellation. Each is the stale
    // metadata hazard in one direction.
    expect(
      subscriptionActivityEntry({
        ...base,
        metadata: { actorUid: 'uid-7', actorAction: 'cancel' },
      })?.actorUid,
    ).toBeNull()
    expect(
      subscriptionActivityEntry({
        ...base,
        canceled: true,
        plan: 'free',
        cancellationReason: 'cancellation_requested',
        metadata: { actorUid: 'uid-7', actorAction: 'subscribe' },
      })?.actorUid,
    ).toBeNull()
  })

  it('refuses `resume`, which signs nothing at all', () => {
    // Clearing a pending cancellation produces no event this log records, so
    // its stamp must not go on to sign the next thing that happens.
    expect(
      subscriptionActivityEntry({
        ...base,
        metadata: { actorUid: 'uid-7', actorAction: 'resume' },
      })?.actorUid,
    ).toBeNull()
  })

  it('names nobody when a cancellation states no reason', () => {
    // Every cancellation predating the `canceledReason` mirror arrives this
    // way. Silence is not evidence that a person asked, so it fails closed.
    expect(
      subscriptionActivityEntry({
        ...base,
        canceled: true,
        plan: 'free',
        cancellationReason: null,
        metadata: { actorUid: 'uid-7', actorAction: 'cancel' },
      }),
    ).toMatchObject({ action: 'Subscription canceled', actorUid: null })
  })

  it('names nobody when there is no stamp at all', () => {
    // A dashboard-created or pre-stamp subscription. An unattributed entry is
    // the honest record; inventing an owner is the failure this closes.
    expect(
      subscriptionActivityEntry({ ...base, metadata: {} })?.actorUid,
    ).toBeNull()
    expect(
      subscriptionActivityEntry({ ...base, metadata: undefined })?.actorUid,
    ).toBeNull()
  })

  it('earns no entry when the plan did not move', () => {
    expect(
      subscriptionActivityEntry({ ...base, previousPlan: 'pro', plan: 'pro' }),
    ).toBeNull()
  })

  it('still earns an entry when a CANCELLED plan matches the mirror', () => {
    // An org already reading `free` whose subscription then ends. Keyed on
    // the plan transition alone this would write nothing — a subscription
    // ending with no record, which is the bug in miniature.
    expect(
      subscriptionActivityEntry({
        ...base,
        canceled: true,
        previousPlan: 'free',
        plan: 'free',
        cancellationReason: 'cancellation_requested',
        metadata: { actorUid: 'uid-7', actorAction: 'cancel' },
      }),
    ).toMatchObject({ kind: 'canceled', actorUid: 'uid-7' })
  })
})
