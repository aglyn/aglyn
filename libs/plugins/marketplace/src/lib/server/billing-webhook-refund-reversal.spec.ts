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
 * A refunded marketplace purchase pulls the publisher's share back (AGL-1995).
 *
 * THE DEFECT. `charge.refunded` revoked the entitlement and sent the GA hit
 * and never touched the transfer, so a refund made the buyer whole, left the
 * publisher their 80%, and Aglyn absorbed the entire gross. The lost-dispute
 * branch a few lines below had always reversed; this door never did, and
 * `reverseMarketplaceSellerShare` had exactly one call site.
 *
 * WHY THE OLD SUITE COULD NOT CATCH IT — the AGL-1794 lesson quoted in the
 * issue: nothing about the wire shape changes when a reversal is missing, so
 * 61 green tests said nothing. These assert the reversal POST ITSELF.
 *
 * No Stripe path is exercised — localhost carries the LIVE secret key.
 * `global.fetch` is replaced for the whole suite and `STRIPE_SECRET_KEY` is
 * DELETED (the root .env leaks into jest and holds the live key); the
 * reversal cases set a throwaway. Same harness as
 * `billing-webhook-dispute.spec.ts`, deliberately: these two doors must stay
 * comparable.
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

// The AGL-1639 worked example, shared with the dispute suite: $100 listing,
// 20% platform rate, $8.25 tax. gross 10825 − tax 825 − transfer 8000 =
// platform net 2000.
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

/** `charge.refunded` — the object is the CHARGE, not a refund object. */
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

// The marketplace pays the seller a FIXED `transfer_data[amount]`, so
// `transfer.amount` (8000) is the seller's share and is NOT `charge.amount`
// (10825). That is the opposite of the commerce side and is why no
// `refund_application_fee` appears anywhere on this path.
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

describe("a refund pulls back the publisher's share (AGL-1995)", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1995'
  })

  it('POSTs the transfer reversal — the call that never happened', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    // The assertion the AGL-1794 lesson demands: the reversal CALL, not a
    // wire shape that looks identical with or without it.
    expect(posts).toHaveLength(1)
    const { init } = posts[0]
    const params = new URLSearchParams(String(init.body))
    // floor(10825 × 8000 ÷ 10825) = 8000 — the publisher's whole share,
    // because the whole charge was refunded.
    expect(params.get('amount')).toBe('8000')
    expect(params.get('metadata[refundId]')).toBe('ch_1')
    // Its OWN idempotency namespace: a refund following a dispute on the
    // same purchase must not be handed the dispute's stored response.
    expect(init.headers['Idempotency-Key']).toBe('refund-reversal-ch_1')
    expect(purchase()).toMatchObject({
      reversedTransferCents: 8000,
      transferReversalId: 'trr_1',
    })
  })

  it('never sends refund_application_fee — there is no application fee here', async () => {
    // Marketplace checkout pays a FIXED `transfer_data[amount]` instead of
    // `application_fee_amount` (checkout.ts:177-181), so the commerce door's
    // flag has nothing to act on. Pinned because copying `refund.ts` wholesale
    // is the obvious next edit, and it would be wrong.
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    const params = new URLSearchParams(String(posts[0].init.body))
    expect(params.get('refund_application_fee')).toBeNull()
    expect(params.get('reverse_transfer')).toBeNull()
  })

  it('still revokes the entitlement and still reports the GA refund', async () => {
    // Positive control on everything the branch already did: adding the
    // reversal must not cost the revocation or the analytics.
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({
      refundedAt: 'NOW',
      refundedCents: 10825,
    })
    expect(adminMock.__ga4Refunds).toHaveLength(1)
    // Platform NET (10825 − 825 − 8000), the AGL-1850 accounting, unchanged.
    expect(adminMock.__ga4Refunds[0]).toMatchObject({ value: 20 })
  })

  it('reverses only what the transfer has left after an earlier pull-back', async () => {
    // A transfer already partly reversed (a dashboard reversal, say) cannot
    // be pulled below its own remainder.
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody({ amount_reversed: 6000 }) },
      reversalPost: { body: { id: 'trr_2', amount: 2000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    const params = new URLSearchParams(String(posts[0].init.body))
    expect(params.get('amount')).toBe('2000')
    expect(purchase()).toMatchObject({ reversedTransferCents: 2000 })
  })

  it('adopts a reversal a crashed delivery already created, and POSTs nothing', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: {
        body: transferBody({
          reversals: {
            data: [
              { id: 'trr_prior', amount: 8000, metadata: { refundId: 'ch_1' } },
            ],
          },
        }),
      },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(posts).toHaveLength(0)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 8000,
      transferReversalId: 'trr_prior',
    })
  })

  it('does not debit the publisher twice when a redelivery arrives', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(posts).toHaveLength(1)
    fetchMock.mockClear()
    posts.length = 0
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    // The settle marker short-circuits before any Stripe call.
    expect(posts).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('what a refund must NOT reverse (AGL-1995)', () => {
  // Positive controls for the branch's selectivity. A reversal that fired on
  // everything would be a worse bug than the one being fixed: it would debit
  // publishers for sales that were never refunded.
  it('leaves a PARTIAL refund alone — the share stays with the publisher', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1995'
    await marketplaceBillingWebhookHandler(
      refundEvent({ refunded: false, amount_refunded: 5000 }) as any,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(purchase()['reversedTransferCents']).toBeUndefined()
    // And it stays a concession: no revocation either.
    expect(purchase()['refundedAt']).toBeUndefined()
  })

  it('touches nothing when the refund belongs to another payment intent', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_1995'
    await marketplaceBillingWebhookHandler(
      refundEvent({ payment_intent: 'pi_someone_else' }) as any,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(purchase()['refundedAt']).toBeUndefined()
    expect(purchase()['reversedTransferCents']).toBeUndefined()
  })

  it('without a Stripe key the revocation still lands and no fetch is made', async () => {
    // The entitlement must never stay live because the reversal step could
    // not run; the redelivery retries the reversal once a key is present.
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({ refundedAt: 'NOW' })
    expect(purchase()['reversedTransferCents']).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
