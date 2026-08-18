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
 * Marketplace chargebacks (AGL-1554): a lost dispute is the AGL-1546 refund
 * arriving by the bank's door — the buyer's entitlement must go the way the
 * money went, the seller's share comes back the way AGL-1794 decided it does
 * for commerce, and GA nets the AGL-1639 purchase out in the same accounting
 * as the AGL-1850 refund.
 *
 * A dispute is NOT a refund, and the states matter: `created` can still be
 * WON, so it flags without revoking; only `closed` + `status: 'lost'` moves
 * anything. `warning_closed` moved no money and revokes nothing.
 *
 * No Stripe path is exercised — localhost carries the LIVE secret key.
 * `global.fetch` is replaced for the whole suite: asserted UNUSED on every
 * case except the seller-share reversal ones, which stub it by exact URL and
 * assert the reversal POST by shape. `STRIPE_SECRET_KEY` is DELETED for the
 * suite (the root .env leaks into jest, and it holds the live key); the
 * reversal tests set a throwaway.
 */

jest.mock('@aglyn/tenant-data-admin', () => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const store: Record<string, Record<string, unknown> | undefined> = {}
  const docFor = (path: string) => ({
    set: (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ path, data })
      store[path] = options?.merge ? { ...(store[path] ?? {}), ...data } : data
      return Promise.resolve()
    },
    get: async () => ({
      exists: Boolean(store[path]),
      data: () => store[path],
      get: (field: string) => (store[path] ?? {})[field],
    }),
  })
  const ga4: Ga4PurchaseInput[] = []
  const ga4Refunds: Ga4PurchaseInput[] = []
  return {
    __writes: writes,
    __store: store,
    __ga4: ga4,
    __ga4Refunds: ga4Refunds,
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

// The AGL-1639 worked example: $100 listing, 20% seller rate, $8.25 tax.
// gross 10825 − tax 825 − transfer 8000 = platform net 2000.
const completedSession = () => ({
  type: 'checkout.session.completed',
  object: {
    id: 'cs_test_1',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 10825,
    total_details: { amount_tax: 825 },
    currency: 'usd',
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

const disputeEvent = (
  type: 'charge.dispute.created' | 'charge.dispute.closed',
  over: Record<string, unknown> = {},
) => ({
  type,
  object: {
    id: 'dp_1',
    charge: 'ch_1',
    payment_intent: 'pi_1',
    amount: 10825,
    currency: 'usd',
    status: type === 'charge.dispute.created' ? 'needs_response' : 'lost',
    ...over,
  },
  event: {},
})

// ---------------------------------------------------------------------------
// fetch double — every Stripe call the reversal step makes, by exact URL.
// ---------------------------------------------------------------------------

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

/** POSTs seen by the fetch double, captured with their init for shape asserts. */
const posts: Array<{ url: string; init: any }> = []

function stubStripe(routes: StripeRoutes): void {
  fetchMock.mockImplementation(async (url: any, init?: any) => {
    const address = String(url)
    const respond = (route: { ok?: boolean; status?: number; body: any }) => ({
      ok: route.ok ?? true,
      status: route.status ?? 200,
      json: async () => route.body,
    })
    if (address === 'https://api.stripe.com/v1/charges/ch_1' && routes.charge) {
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

const chargeBody = { id: 'ch_1', amount: 10825, transfer: 'tr_1' }
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

beforeEach(async () => {
  // The root .env leaks into jest and carries the LIVE key — delete it so a
  // test that forgets its stub refuses before any fetch instead of calling
  // Stripe. Reversal tests set a throwaway.
  delete process.env.STRIPE_SECRET_KEY
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: any) => {
    throw new Error(`Unexpected fetch to ${String(url)}`)
  })
  posts.length = 0
  adminMock.__writes.length = 0
  adminMock.__ga4.length = 0
  adminMock.__ga4Refunds.length = 0
  for (const key of Object.keys(adminMock.__store)) {
    delete adminMock.__store[key]
  }
  await marketplaceBillingWebhookHandler(completedSession() as any)
  adminMock.__writes.length = 0
  adminMock.__ga4.length = 0
})

const purchase = () => adminMock.__store['marketplacePurchases/cs_test_1'] ?? {}

describe('charge.dispute.created flags without revoking (AGL-1554)', () => {
  it('stamps the dispute onto the purchase and leaves the entitlement alone', async () => {
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.created') as any,
    )
    expect(purchase()).toMatchObject({
      disputeId: 'dp_1',
      disputeStatus: 'needs_response',
      disputeOpenedAt: 'NOW',
    })
    // A dispute can be WON, and nothing un-revokes: `refundedAt` — the field
    // the install gate reads as absent-purchase — must not appear here.
    expect(purchase()['refundedAt']).toBeUndefined()
    expect(adminMock.__ga4Refunds).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an unknown payment intent writes nothing', async () => {
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.created', {
        payment_intent: 'pi_other',
      }) as any,
    )
    expect(adminMock.__writes).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('charge.dispute.closed, non-lost outcomes (AGL-1554)', () => {
  it('a WON dispute records the outcome and revokes nothing', async () => {
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed', { status: 'won' }) as any,
    )
    expect(purchase()).toMatchObject({
      disputeId: 'dp_1',
      disputeStatus: 'won',
    })
    expect(purchase()['refundedAt']).toBeUndefined()
    expect(adminMock.__ga4Refunds).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('warning_closed moved no money and revokes nothing', async () => {
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed', {
        status: 'warning_closed',
      }) as any,
    )
    expect(purchase()['refundedAt']).toBeUndefined()
    expect(adminMock.__ga4Refunds).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a LOST dispute revokes the entitlement (AGL-1554)', () => {
  it('stamps refundedAt — the field the install gate treats as absent-purchase', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1554'
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(purchase()).toMatchObject({
      disputeId: 'dp_1',
      disputeStatus: 'lost',
      refundedAt: 'NOW',
      refundedCents: 10825,
    })
  })

  it('without a Stripe key the revocation still lands and no fetch is made', async () => {
    // The entitlement must never stay live because the reversal step could
    // not run — the two halves fail independently. No settle marker either:
    // the redelivery retries the reversal once a key is present.
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(purchase()['refundedAt']).toBe('NOW')
    expect(purchase()['reversedTransferCents']).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a LOST dispute nets the purchase out of GA (AGL-1850 accounting)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1554'
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
  })

  it('sends `refund` keyed by the ORIGINAL session id, valued at platform net', async () => {
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(adminMock.__ga4Refunds).toHaveLength(1)
    const sent = adminMock.__ga4Refunds[0]
    expect(sent.transactionId).toBe('cs_test_1')
    // Platform net ($20), matching what the purchase put in — the gross the
    // bank pulled back (108.25) would net MORE out of GA than the sale ever
    // reported.
    expect(sent.value).toBe(20)
  })

  it('a purchase already refunded reports nothing twice — refundedAt is the guard', async () => {
    await marketplaceBillingWebhookHandler({
      type: 'charge.refunded',
      object: {
        id: 'ch_1',
        payment_intent: 'pi_1',
        refunded: true,
        amount_refunded: 10825,
      },
      event: {},
    } as any)
    expect(adminMock.__ga4Refunds).toHaveLength(1)
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(adminMock.__ga4Refunds).toHaveLength(1)
  })
})

describe("a LOST dispute pulls back the seller's share (AGL-1794 policy)", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1554'
  })

  it('reverses the transferred portion, proportional and idempotency-keyed', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(posts).toHaveLength(1)
    const { init } = posts[0]
    expect(init.headers['Idempotency-Key']).toBe('dispute-reversal-dp_1')
    const params = new URLSearchParams(String(init.body))
    // floor(10825 × 8000 ÷ 10825) = 8000 — the whole transfer, because the
    // whole charge was disputed.
    expect(params.get('amount')).toBe('8000')
    expect(params.get('metadata[disputeId]')).toBe('dp_1')
    expect(purchase()).toMatchObject({
      reversedTransferCents: 8000,
      transferReversalId: 'trr_1',
    })
  })

  it('caps at what the transfer has left', async () => {
    // A dashboard refund already reversed 6000 of the 8000: only the
    // remaining 2000 can come back, never more.
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody({ amount_reversed: 6000 }) },
      reversalPost: { body: { id: 'trr_2', amount: 2000 } },
    })
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    const params = new URLSearchParams(String(posts[0].init.body))
    expect(params.get('amount')).toBe('2000')
    expect(purchase()['reversedTransferCents']).toBe(2000)
  })

  it('adopts a reversal a crashed delivery already created, and POSTs nothing', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: {
        body: transferBody({
          reversals: {
            data: [
              {
                id: 'trr_prior',
                amount: 8000,
                metadata: { disputeId: 'dp_1' },
              },
            ],
          },
        }),
      },
    })
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(posts).toHaveLength(0)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 8000,
      transferReversalId: 'trr_prior',
    })
  })

  it('a redelivery with the marker settled makes no Stripe call at all', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    fetchMock.mockClear()
    posts.length = 0
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(adminMock.__ga4Refunds).toHaveLength(1)
  })

  it('a charge with no transfer settles 0 and does not throw', async () => {
    stubStripe({
      charge: { body: { id: 'ch_1', amount: 10825, transfer: null } },
    })
    await marketplaceBillingWebhookHandler(
      disputeEvent('charge.dispute.closed') as any,
    )
    expect(posts).toHaveLength(0)
    expect(purchase()['reversedTransferCents']).toBe(0)
    // The revocation half is untouched by the reversal outcome.
    expect(purchase()['refundedAt']).toBe('NOW')
  })

  it('a transient Stripe failure throws so the platform webhook 500s and Stripe redelivers', async () => {
    stubStripe({
      charge: { ok: false, status: 503, body: { error: { message: 'down' } } },
    })
    await expect(
      marketplaceBillingWebhookHandler(
        disputeEvent('charge.dispute.closed') as any,
      ),
    ).rejects.toThrow(/503/)
    // No marker: the redelivery IS the retry.
    expect(purchase()['reversedTransferCents']).toBeUndefined()
  })
})
