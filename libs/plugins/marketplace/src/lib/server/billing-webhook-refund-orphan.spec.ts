/**
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
 *
 * @jest-environment node
 */

/**
 * A REFUND THAT LANDS BEFORE ITS PURCHASE IS NOT DROPPED (AGL-2148).
 *
 * THE DEFECT. Both money doors joined `marketplacePurchases` on the payment
 * intent and had `if (!purchases.empty) { … }` with NO else. The purchase
 * document is written by `checkout.session.completed`, and that delivery
 * retries — this endpoint 500s on every transient Stripe failure in the file
 * and on any throw from a sibling plugin handler, after which Stripe
 * redelivers for up to three days. A dashboard refund issued inside that
 * window found nothing and the branch simply ended: the buyer got their money
 * back, the publisher kept their 80%, Aglyn ate the gross, and `hasLivePurchase`
 * saw no `refundedAt`, so the refunded buyer kept the install.
 *
 * WHY THE NAIVE CONTAINMENT WAS REJECTED, pinned here because "just throw so
 * Stripe redelivers" is the obvious next edit: `charge.refunded` and
 * `charge.dispute.*` arrive on this same endpoint for storefront orders and
 * subscription charges, whose payment intents never match a marketplace
 * purchase. Throwing on "not found" would 500 the webhook for every
 * non-marketplace refund, and the route drops its idempotency claim on a
 * throw, re-running the commerce and bookings handlers' non-idempotent
 * effects. `parks nothing for a refund that is not ours` is that control.
 *
 * No Stripe path is exercised — localhost carries the LIVE secret key.
 * `global.fetch` is replaced for the whole suite and `STRIPE_SECRET_KEY` is
 * DELETED (the root .env leaks into jest and holds the live key); the cases
 * that need one set a throwaway. Same harness as
 * `billing-webhook-refund-reversal.spec.ts`, deliberately: the door and the
 * drain must stay comparable.
 */

jest.mock('@aglyn/tenant-data-admin', () => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const store: Record<string, Record<string, unknown> | undefined> = {}
  const docFor = (path: string) => ({
    // A real DocumentReference carries its own id, and production code reads
    // it: the reversal stamps `metadata[purchaseId]` from it and the GA
    // `refund` is keyed by it.
    id: path.split('/').pop() ?? path,
    set: (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ path, data })
      // MERGE vs REPLACE, modelled exactly: the purchase write is merged and
      // the difference is the whole of AGL-2109. A double that merged both
      // ways could not tell a drain that preserved `createdAt` from one that
      // erased it.
      store[path] = options?.merge ? { ...(store[path] ?? {}), ...data } : data
      return Promise.resolve()
    },
    get: async () => ({
      exists: Boolean(store[path]),
      data: () => store[path],
      get: (field: string) => (store[path] ?? {})[field],
    }),
    // Firestore's delete removes the document and is a no-op on one already
    // absent — never an error.
    delete: () => {
      delete store[path]
      return Promise.resolve()
    },
  })
  const ga4: Ga4PurchaseInput[] = []
  const ga4Refunds: Ga4PurchaseInput[] = []
  return {
    __writes: writes,
    __store: store,
    __ga4: ga4,
    __ga4Refunds: ga4Refunds,
    syncConnectAccountStatus: async () => 0,
    sendGa4Purchase: async (
      input: Ga4PurchaseInput,
    ): Promise<Ga4SendResult> => {
      ga4.push(input)
      return { sent: true, synthesizedClientId: false }
    },
    sendGa4Refund: async (input: Ga4PurchaseInput): Promise<Ga4SendResult> => {
      ga4Refunds.push(input)
      return { sent: true, synthesizedClientId: false }
    },
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) => docFor(`${name}/${id}`),
            where: (field: string, _op: string, value: unknown) => ({
              limit: () => ({
                get: async () => {
                  const docs = Object.entries(store)
                    .filter(
                      ([path, data]) =>
                        path.startsWith(`${name}/`) &&
                        (data ?? {})[field] === value,
                    )
                    .map(([path, data]) => ({
                      id: path.split('/').pop(),
                      ref: docFor(path),
                      get: (f: string) => (data ?? {})[f],
                      data: () => data,
                    }))
                  return { empty: docs.length === 0, docs }
                },
              }),
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
  }
})

import type { Ga4PurchaseInput, Ga4SendResult } from '@aglyn/tenant-data-admin'

import { marketplaceBillingWebhookHandler } from './billing-webhook'

const adminMock = jest.requireMock('@aglyn/tenant-data-admin') as {
  __writes: Array<{ path: string; data: Record<string, unknown> }>
  __store: Record<string, Record<string, unknown> | undefined>
  __ga4: Ga4PurchaseInput[]
  __ga4Refunds: Ga4PurchaseInput[]
}

// The AGL-1639 worked example, shared with the reversal and dispute suites:
// $100 listing, 20% platform rate, $8.25 tax. gross 10825 − tax 825 −
// transfer 8000 = platform net 2000.
const completedSession = () => ({
  type: 'checkout.session.completed',
  object: {
    id: 'cs_test_1',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 10825,
    total_details: { amount_tax: 825 },
    currency: 'usd',
    customer: 'cus_1',
    metadata: {
      type: 'marketplace-purchase',
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      feeCents: '2000',
      transferCents: '8000',
    },
  },
  event: {},
})

/**
 * `charge.refunded` — the object is the CHARGE. `metadata` is the
 * PaymentIntent's, which Stripe copies onto the charge it creates; marketplace
 * checkout stamps `payment_intent_data[metadata][type]` for exactly this read.
 */
const refundEvent = (over: Record<string, unknown> = {}) => ({
  type: 'charge.refunded',
  object: {
    id: 'ch_1',
    payment_intent: 'pi_1',
    refunded: true,
    amount: 10825,
    amount_refunded: 10825,
    currency: 'usd',
    customer: 'cus_1',
    metadata: {
      type: 'marketplace-purchase',
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
    },
    ...over,
  },
  event: {},
})

const disputeLostEvent = (over: Record<string, unknown> = {}) => ({
  type: 'charge.dispute.closed',
  object: {
    id: 'dp_1',
    charge: 'ch_1',
    payment_intent: 'pi_1',
    status: 'lost',
    amount: 10825,
    currency: 'usd',
    ...over,
  },
  event: {},
})

const fetchMock: jest.Mock<Promise<any>, [any, any?]> = jest.fn(
  async (url: any) => {
    throw new Error(`Unexpected fetch to ${String(url)}`)
  },
)

interface StripeRoutes {
  charge?: { ok?: boolean; status?: number; body: any }
  transfer?: { ok?: boolean; status?: number; body: any }
  reversalPost?: { ok?: boolean; status?: number; body: any }
}

const posts: Array<{ url: string; init: any }> = []
const chargeReads: string[] = []

function stubStripe(routes: StripeRoutes): void {
  fetchMock.mockImplementation(async (url: any, init?: any) => {
    const address = String(url)
    const respond = (route: { ok?: boolean; status?: number; body: any }) => ({
      ok: route.ok ?? true,
      status: route.status ?? 200,
      json: async () => route.body,
    })
    if (address === 'https://api.stripe.com/v1/charges/ch_1' && routes.charge) {
      chargeReads.push(address)
      return respond(routes.charge)
    }
    if (
      address === 'https://api.stripe.com/v1/transfers/tr_1' &&
      routes.transfer
    ) {
      return respond(routes.transfer)
    }
    if (
      address === 'https://api.stripe.com/v1/transfers/tr_1/reversals' &&
      init?.method === 'POST' &&
      routes.reversalPost
    ) {
      posts.push({ url: address, init })
      return respond(routes.reversalPost)
    }
    throw new Error(`Unexpected fetch to ${address}`)
  })
}

// The marketplace pays the seller a FIXED `transfer_data[amount]`, so
// `transfer.amount` (8000) is the seller's share and is NOT `charge.amount`
// (10825).
const chargeBody = (over: Record<string, unknown> = {}) => ({
  id: 'ch_1',
  amount: 10825,
  transfer: 'tr_1',
  metadata: { type: 'marketplace-purchase' },
  ...over,
})
const transferBody = (over: Record<string, unknown> = {}) => ({
  id: 'tr_1',
  amount: 8000,
  amount_reversed: 0,
  reversals: { data: [] },
  ...over,
})

const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY
const originalFetch = (global as any).fetch

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

afterAll(() => {
  ;(global as any).fetch = originalFetch
  if (ORIGINAL_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY
})

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_double_2148'
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: any) => {
    throw new Error(`Unexpected fetch to ${String(url)}`)
  })
  posts.length = 0
  chargeReads.length = 0
  adminMock.__writes.length = 0
  adminMock.__ga4.length = 0
  adminMock.__ga4Refunds.length = 0
  for (const key of Object.keys(adminMock.__store)) {
    delete adminMock.__store[key]
  }
})

const purchase = () => adminMock.__store['marketplacePurchases/cs_test_1'] ?? {}
const orphan = () => adminMock.__store['marketplaceRefundOrphans/pi_1']

describe('a refund arriving before its purchase is parked (AGL-2148)', () => {
  it('parks the refund keyed by the payment intent — the else that did not exist', async () => {
    // NOTHING has created the purchase document: this is the window.
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(orphan()).toMatchObject({
      kind: 'refund',
      id: 'ch_1',
      paymentIntentId: 'pi_1',
      amountCents: 10825,
      chargeId: 'ch_1',
      currency: 'usd',
      stripeCustomerId: 'cus_1',
      createdAt: 'NOW',
    })
  })

  it('parks nothing for a refund that is not ours — the reason "just throw" was wrong', async () => {
    // A storefront order or a subscription charge refunded on the SAME
    // endpoint. The payment-intent join comes up empty for these too, and the
    // rejected containment would have 500'd every one of them, dropping the
    // route's idempotency claim and re-running the commerce and bookings
    // handlers' non-idempotent effects.
    await expect(
      marketplaceBillingWebhookHandler(
        refundEvent({ metadata: { type: 'commerce-order' } }) as any,
      ),
    ).resolves.toBeUndefined()
    expect(orphan()).toBeUndefined()
    expect(adminMock.__writes).toHaveLength(0)
    // And no Stripe round trip was spent deciding that.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('parks nothing when the charge carries no metadata at all', async () => {
    await marketplaceBillingWebhookHandler(
      refundEvent({ metadata: undefined }) as any,
    )
    expect(orphan()).toBeUndefined()
  })

  it('keeps the FIRST cause when the same refund is redelivered', async () => {
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    const before = { ...(orphan() as Record<string, unknown>) }
    adminMock.__writes.length = 0
    await marketplaceBillingWebhookHandler(
      refundEvent({ amount_refunded: 1 }) as any,
    )
    // Not merged over: a redelivery would otherwise move `createdAt` and, for
    // a refund/dispute pair inside one window, blend one cause's id with the
    // other's amount.
    expect(orphan()).toEqual(before)
    expect(adminMock.__writes).toHaveLength(0)
  })
})

describe('the session landing drains what was parked (AGL-2148)', () => {
  it('revokes, reports and reverses — the effects the refund door would have applied', async () => {
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    stubStripe({
      charge: { body: chargeBody() },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(completedSession() as any)
    // The entitlement: `hasLivePurchase` reads `refundedAt`.
    expect(purchase()).toMatchObject({
      refundedAt: 'NOW',
      refundedCents: 10825,
      reversedTransferCents: 8000,
      transferReversalId: 'trr_1',
      // The sale itself is still recorded — the drain revokes, it does not
      // erase (AGL-2109).
      listingId: 'listing-1',
      transferCents: 8000,
      createdAt: 'NOW',
    })
    // The publisher's 80% came back.
    expect(posts).toHaveLength(1)
    const params = new URLSearchParams(String(posts[0].init.body))
    expect(params.get('amount')).toBe('8000')
    expect(params.get('metadata[refundId]')).toBe('ch_1')
    expect(params.get('metadata[purchaseId]')).toBe('cs_test_1')
    // THE SAME key the door would have used — derived from the cause, not
    // from who is applying it — so Stripe cannot be made to reverse twice.
    expect(posts[0].init.headers['Idempotency-Key']).toBe(
      'refund-reversal-ch_1',
    )
    // GA nets out the platform NET, keyed by the session id, exactly as the
    // door does (AGL-1850).
    expect(adminMock.__ga4Refunds).toHaveLength(1)
    expect(adminMock.__ga4Refunds[0]).toMatchObject({
      transactionId: 'cs_test_1',
      value: 20,
      stripeCustomerId: 'cus_1',
    })
    // Drained.
    expect(orphan()).toBeUndefined()
  })

  it('does not debit the publisher twice when the refund is later redelivered', async () => {
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    stubStripe({
      charge: { body: chargeBody() },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(posts).toHaveLength(1)
    posts.length = 0
    adminMock.__ga4Refunds.length = 0
    // The refund now finds the purchase and takes the normal door.
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    // `reversedTransferCents` short-circuits before any Stripe call, and
    // `refundedAt` suppresses a second GA refund.
    expect(posts).toHaveLength(0)
    expect(adminMock.__ga4Refunds).toHaveLength(0)
  })

  it('a redelivered session does not re-apply the drain', async () => {
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    stubStripe({
      charge: { body: chargeBody() },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(completedSession() as any)
    posts.length = 0
    adminMock.__ga4Refunds.length = 0
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(posts).toHaveLength(0)
    expect(adminMock.__ga4Refunds).toHaveLength(0)
    expect(purchase()).toMatchObject({ refundedAt: 'NOW' })
  })

  it('keeps the orphan when the drain throws on a TRANSIENT Stripe failure', async () => {
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    stubStripe({ charge: { ok: false, status: 503, body: {} } })
    // The 500 IS the retry: Stripe redelivers the session for three days.
    await expect(
      marketplaceBillingWebhookHandler(completedSession() as any),
    ).rejects.toThrow(/charge read failed/i)
    // Dropping the orphan first would have lost the reversal permanently.
    expect(orphan()).toMatchObject({ kind: 'refund', id: 'ch_1' })
    // And the redelivery completes it.
    stubStripe({
      charge: { body: chargeBody() },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(posts).toHaveLength(1)
    expect(orphan()).toBeUndefined()
  })

  it('a DEFINITIVE reversal failure lands in AGL-2140’s queue, not a second one', async () => {
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    stubStripe({
      charge: { body: chargeBody() },
      transfer: { body: transferBody() },
      // `balance_insufficient` on the publisher's connected account is a 400.
      reversalPost: {
        ok: false,
        status: 400,
        body: { error: { code: 'balance_insufficient' } },
      },
    })
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(purchase()).toMatchObject({
      refundedAt: 'NOW',
      reversedTransferCents: 0,
      reversalFailedAt: 'NOW',
      reversalFailedReason: 'reversal-refused',
      reversalFailedCause: 'refund',
      reversalOwedCents: 8000,
    })
    // The settle is definitive, so the orphan has nothing left to replay.
    expect(orphan()).toBeUndefined()
  })

  it('a session with nothing parked is untouched', async () => {
    // The negative control for the drain: no orphan, no revocation, no
    // reversal, no Stripe call at all.
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(purchase()).toMatchObject({ listingId: 'listing-1' })
    expect(purchase().refundedAt).toBeUndefined()
    expect(posts).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(adminMock.__ga4Refunds).toHaveLength(0)
  })
})

describe('a lost dispute arriving before its purchase (AGL-2148)', () => {
  it('parks it, after ONE charge read establishes the dispute is ours', async () => {
    // A dispute event carries no metadata of ours — its object is the
    // DISPUTE, not the charge — so the discriminator costs a read.
    stubStripe({ charge: { body: chargeBody() } })
    await marketplaceBillingWebhookHandler(disputeLostEvent() as any)
    expect(chargeReads).toHaveLength(1)
    expect(orphan()).toMatchObject({
      kind: 'dispute',
      id: 'dp_1',
      chargeId: 'ch_1',
      amountCents: 10825,
    })
  })

  it('parks nothing for a storefront or subscription chargeback', async () => {
    stubStripe({
      charge: { body: chargeBody({ metadata: { type: 'commerce-order' } }) },
    })
    await marketplaceBillingWebhookHandler(disputeLostEvent() as any)
    expect(orphan()).toBeUndefined()
  })

  it('parks nothing and DOES NOT THROW when the charge read fails', async () => {
    // Deliberate: throwing would 500 the endpoint for a dispute we have not
    // established is ours, which is the blast radius that ruled out "just
    // throw" in the first place.
    stubStripe({ charge: { ok: false, status: 503, body: {} } })
    await expect(
      marketplaceBillingWebhookHandler(disputeLostEvent() as any),
    ).resolves.toBeUndefined()
    expect(orphan()).toBeUndefined()
  })

  it('parks nothing for a dispute that is not lost', async () => {
    await marketplaceBillingWebhookHandler(
      disputeLostEvent({ status: 'won' }) as any,
    )
    expect(orphan()).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drains into the dispute outcome, with the dispute idempotency key', async () => {
    stubStripe({ charge: { body: chargeBody() } })
    await marketplaceBillingWebhookHandler(disputeLostEvent() as any)
    stubStripe({
      charge: { body: chargeBody() },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_9', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(purchase()).toMatchObject({
      refundedAt: 'NOW',
      refundedCents: 10825,
      disputeId: 'dp_1',
      disputeStatus: 'lost',
      reversedTransferCents: 8000,
    })
    expect(posts).toHaveLength(1)
    const params = new URLSearchParams(String(posts[0].init.body))
    // `disputeId` on the wire, and the dispute's own idempotency namespace —
    // a refund following a dispute must not be handed the dispute's stored
    // response.
    expect(params.get('metadata[disputeId]')).toBe('dp_1')
    expect(posts[0].init.headers['Idempotency-Key']).toBe(
      'dispute-reversal-dp_1',
    )
    expect(orphan()).toBeUndefined()
  })
})
