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
 * A chargeback against AGLYN'S OWN subscription revenue reverses the revenue
 * row, nets GA, and reaches staff (AGL-2120).
 *
 * `charge.dispute.created` / `.closed` have been subscribed since AGL-1787 and
 * were handled only inside the commerce and marketplace plugins, which
 * self-select by finding a storefront order or a marketplace purchase. A
 * dispute against an Aglyn subscription invoice matched neither and produced
 * nothing: the `platformRevenue` row kept its full `netCents` while the money
 * had gone, so the Texas return over-reported by the disputed amount; GA was
 * never netted; and nothing told staff a paying customer had disputed a
 * charge — including while the evidence window was still open.
 *
 * The four claims worth an assembly test:
 *
 * 1. **The claiming boundary.** A Dispute carries no `customer` and no
 *    `invoice`, so the usual `findOrgIdByStripeCustomer` discriminator has
 *    nothing to read. Ownership is decided by whether the dispute's charge or
 *    payment intent matches a `platformRevenue` row — a collection that only
 *    ever holds invoices whose customer already resolved through the
 *    `stripeCustomers` index. A storefront chargeback must find none and fall
 *    through untouched.
 * 2. **Only `closed` + `lost` moves money.** `created` is a warning; a WON
 *    dispute reverses nothing.
 * 3. **The reversal converges.** `refundedCents` is cumulative, so a Stripe
 *    redelivery of the same dispute must not double-count, and a lost dispute
 *    landing on an invoice already partly refunded must add to the existing
 *    total rather than replace it.
 * 4. **Staff hear about it,** with an actor and a reason, on open AND close.
 *
 * NO STRIPE PATH IS EXERCISED: `global.fetch` is a jest mock, `sendGa4Refund`
 * is captured wholesale, and the env is scrubbed of the developer's own
 * STRIPE_* config because `nx test` leaks the root `.env`, which on localhost
 * carries the LIVE secret key.
 */

// A module, not a script — the const declarations below would otherwise
// collide with the other console billing route specs' globals under `tsc`.
export {}

import { createHmac } from 'node:crypto'
import type { Ga4PurchaseInput, Ga4SendResult } from '@aglyn/tenant-data-admin'

/** Env without a trace of the developer's own Stripe config. */
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

/**
 * A Firestore double that models the three behaviours this branch depends on
 * EXACTLY, because an unfaithful fake here would fabricate both greens and
 * reds:
 *
 * - `set(..., { merge: true })` merges field-wise into the existing document
 *   rather than replacing it. The reversal writes four fields onto a row that
 *   already holds a dozen; a replacing fake would silently erase `grossCents`
 *   and every later assertion about the row would read `undefined`.
 * - `update()` REJECTS on a missing document (real `update()` throws
 *   `5 NOT_FOUND`), which is what keeps a merge-set from resurrecting an
 *   erased org as a stub.
 * - `where(field, '==', value)` filters over the real stored documents of
 *   that collection, and `limit(n)` truncates. Stubbing the query to always
 *   return the seeded row would make claim 1 — the ownership boundary —
 *   untestable, because a storefront dispute would "match" too.
 *
 * `QueryDocumentSnapshot`s carry a live `ref`, so a write through the query
 * result lands in the same map the direct-path reads see.
 */
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
      docs.set(
        path,
        options?.merge ? { ...docs.get(path), ...data } : { ...data },
      )
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

  /** Snapshot over a stored path, with a `ref` that writes back through it. */
  const snapshot = (path: string) => ({
    id: path.split('/').pop() as string,
    exists: true,
    data: () => docs.get(path),
    get: (field: string) => (docs.get(path) ?? {})[field],
    ref: doc(path),
  })

  const query = (
    name: string,
    filters: readonly [string, unknown][],
    max: number | null,
  ) => ({
    where: (field: string, op: string, value: unknown) => {
      // The branch only ever uses equality; anything else would silently
      // pass through this fake and prove nothing.
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
        .map(snapshot)
      return { docs: max == null ? matches : matches.slice(0, max), empty: matches.length === 0 }
    },
  })

  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        const id = `auto-${docs.size}`
        docs.set(`${name}/${id}`, { ...data })
        return { id }
      },
      where: (field: string, op: string, value: unknown) =>
        query(name, [], null).where(field, op, value),
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
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_own_1' ? 'org-real' : null,
  notifyOrgAdmins: async () => undefined,
  sendGa4Purchase: async (): Promise<Ga4SendResult> => ({
    sent: true,
    synthesizedClientId: true,
  }),
  // Captured, not stubbed — the input IS part of the subject of this file.
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

function disputeEvent(
  type: 'charge.dispute.created' | 'charge.dispute.closed',
  dispute: Record<string, unknown>,
  { eventId = `evt_${Math.random().toString(36).slice(2)}` } = {},
) {
  return { id: eventId, type, data: { object: dispute } }
}

function loadWebhook() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...BASE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (
    request: Request,
  ) => Promise<Response>
}

/** Every `adminAudit` document written, in insertion order. */
function auditEntries(): Record<string, unknown>[] {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith('adminAudit/'))
    .map(([, value]) => value)
}

/** A dispute against a subscription charge on OUR account. */
const OWN_DISPUTE = {
  id: 'dp_own_1',
  object: 'dispute',
  charge: 'ch_own_1',
  payment_intent: 'pi_own_1',
  amount: 28900,
  currency: 'usd',
  reason: 'fraudulent',
  evidence_details: { due_by: 1_760_000_000 },
}

describe('a platform subscription chargeback is handled (AGL-2120)', () => {
  beforeEach(() => {
    docs = new Map()
    docs.set('orgs/org-real', { name: 'Acme Ltd', slug: 'acme', plan: 'pro' })
    // The AGL-1811 tax row the invoice's `purchase` pass wrote, now carrying
    // the AGL-2120 charge linkage.
    docs.set('platformRevenue/in_disputed', {
      grossCents: 28900,
      taxCents: 2312,
      netCents: 26588,
      orgId: 'org-real',
      stripeCustomerId: 'cus_own_1',
      chargeId: 'ch_own_1',
      paymentIntentId: 'pi_own_1',
    })
    mockGa4Refunds.length = 0
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as never
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('a LOST dispute reverses the revenue row and nets GA under the invoice id', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        disputeEvent('charge.dispute.closed', {
          ...OWN_DISPUTE,
          status: 'lost',
        }),
      ),
    )
    expect(response.status).toBe(200)

    const row = docs.get('platformRevenue/in_disputed')
    // The field the Texas return reads — a lost dispute reverses money
    // exactly as a refund does, so it must land here.
    expect(row).toMatchObject({
      refundedCents: 28900,
      // ...and separably, because the BANK took it rather than the merchant
      // choosing to (the AGL-1787 order-model split).
      chargedBackCents: 28900,
      disputeId: 'dp_own_1',
      disputeReason: 'fraudulent',
      refundRecordedAt: '__now__',
    })
    // The merge did not eat the row it merged into.
    expect(row).toMatchObject({ grossCents: 28900, orgId: 'org-real' })

    expect(mockGa4Refunds).toHaveLength(1)
    // The INVOICE id the original `purchase` reported — netting requires the
    // same transaction id, not the dispute or charge id.
    expect(mockGa4Refunds[0].transactionId).toBe('in_disputed')
    // NET of tax, scaled by the row's own gross/net ratio, so a lost dispute
    // and a full refund of the same invoice move GA by the same amount:
    // 28900 * (28900 - 2312) / 28900 = 26588 cents.
    expect(mockGa4Refunds[0].value).toBe(265.88)
    expect(mockGa4Refunds[0].stripeCustomerId).toBe('cus_own_1')
  })

  it('an OPENED dispute warns staff with an actor, a reason and the deadline — and moves no money', async () => {
    const post = loadWebhook()
    await post(
      signed(
        disputeEvent('charge.dispute.created', {
          ...OWN_DISPUTE,
          status: 'warning_needs_response',
        }),
      ),
    )

    // Claim 2: `created` is a warning, not a reversal.
    const row = docs.get('platformRevenue/in_disputed') ?? {}
    expect(row.refundedCents).toBeUndefined()
    expect(row.chargedBackCents).toBeUndefined()
    expect(mockGa4Refunds).toHaveLength(0)

    const audit = auditEntries()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorUid: 'system:stripe-webhook',
      action: 'billing.disputeOpened',
      target: 'orgs/org-real',
    })
    // An actor without a reason is not an audit trail: the entry has to say
    // what staff are being asked to do, while they can still do it.
    expect(String(audit[0].reason)).toContain('evidence deadline')
    expect(audit[0].after).toMatchObject({
      disputeId: 'dp_own_1',
      invoiceId: 'in_disputed',
      orgId: 'org-real',
      disputedCents: 28900,
      evidenceDueBy: 1_760_000_000,
    })
  })

  it('a WON dispute is recorded and reverses nothing', async () => {
    const post = loadWebhook()
    await post(
      signed(
        disputeEvent('charge.dispute.closed', { ...OWN_DISPUTE, status: 'won' }),
      ),
    )

    const row = docs.get('platformRevenue/in_disputed') ?? {}
    expect(row.refundedCents).toBeUndefined()
    expect(mockGa4Refunds).toHaveLength(0)
    const audit = auditEntries()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'billing.disputeClosed' })
    expect(String(audit[0].reason)).toContain('nothing was reversed')
  })

  it('a redelivery of the same lost dispute converges instead of double-counting', async () => {
    const post = loadWebhook()
    const lost = disputeEvent('charge.dispute.closed', {
      ...OWN_DISPUTE,
      status: 'lost',
    })
    // Distinct EVENT ids so the `stripeEvents` idempotency claim cannot be
    // what makes this pass — the arithmetic has to.
    await post(signed({ ...lost, id: 'evt_first' }))
    await post(signed({ ...lost, id: 'evt_second' }))

    expect(docs.get('platformRevenue/in_disputed')).toMatchObject({
      refundedCents: 28900,
      chargedBackCents: 28900,
    })
    expect(mockGa4Refunds).toHaveLength(1)
  })

  it('a lost dispute on an invoice already partly refunded ADDS to the refund total', async () => {
    docs.set('platformRevenue/in_disputed', {
      ...(docs.get('platformRevenue/in_disputed') as Record<string, unknown>),
      // A $50 goodwill refund the merchant issued earlier.
      refundedCents: 5000,
    })
    const post = loadWebhook()
    await post(
      signed(
        disputeEvent('charge.dispute.closed', {
          ...OWN_DISPUTE,
          amount: 23900,
          status: 'lost',
        }),
      ),
    )

    expect(docs.get('platformRevenue/in_disputed')).toMatchObject({
      // 5000 already refunded + 23900 charged back.
      refundedCents: 28900,
      chargedBackCents: 23900,
    })
  })

  it('a STOREFRONT chargeback matches no row, writes nothing, and still answers 200', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(
        disputeEvent('charge.dispute.closed', {
          id: 'dp_shopper_1',
          charge: 'ch_shopper_1',
          payment_intent: 'pi_shopper_1',
          amount: 4200,
          currency: 'usd',
          reason: 'product_not_received',
          status: 'lost',
        }),
      ),
    )
    expect(response.status).toBe(200)

    // Claim 1: the ownership boundary. The plugins own this one; the platform
    // branch must not touch the seeded row, and must not bury staff in an
    // `adminAudit` entry per storefront chargeback.
    expect(docs.get('platformRevenue/in_disputed')).not.toHaveProperty(
      'refundedCents',
    )
    expect(auditEntries()).toHaveLength(0)
    expect(mockGa4Refunds).toHaveLength(0)
  })

  it('a lost dispute on a PRE-AGL-2120 row (no charge linkage) is logged, not guessed at', async () => {
    // The shape every row written before AGL-2120 has: a real subscription
    // invoice with nothing to match a dispute against.
    docs.set('platformRevenue/in_legacy', {
      grossCents: 9900,
      orgId: 'org-real',
      stripeCustomerId: 'cus_own_1',
    })
    docs.delete('platformRevenue/in_disputed')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const post = loadWebhook()
    await post(
      signed(
        disputeEvent('charge.dispute.closed', {
          ...OWN_DISPUTE,
          status: 'lost',
        }),
      ),
    )

    expect(docs.get('platformRevenue/in_legacy')).not.toHaveProperty(
      'refundedCents',
    )
    // The only trace such a dispute leaves — asserted so that removing it
    // fails here rather than going quietly silent in production.
    expect(warn).toHaveBeenCalledWith(
      '[billing/webhook] lost dispute matched no revenue row',
      expect.objectContaining({ disputeId: 'dp_own_1', disputedCents: 28900 }),
    )
  })

  it('matches on the CHARGE id when the row carries no payment intent', async () => {
    docs.set('platformRevenue/in_disputed', {
      grossCents: 28900,
      orgId: 'org-real',
      chargeId: 'ch_own_1',
    })
    const post = loadWebhook()
    await post(
      signed(
        disputeEvent('charge.dispute.closed', {
          ...OWN_DISPUTE,
          status: 'lost',
        }),
      ),
    )

    expect(docs.get('platformRevenue/in_disputed')).toMatchObject({
      chargedBackCents: 28900,
    })
  })
})
