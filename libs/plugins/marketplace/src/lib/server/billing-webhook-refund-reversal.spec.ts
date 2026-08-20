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
    // A real DocumentReference carries its own id, and production code reads
    // it: the reversal stamps `metadata[purchaseId]` from it and the GA
    // `refund` is keyed by it. A double without it fabricates an `undefined`
    // transaction id that no assertion here could have distinguished from a
    // real one.
    id: path.split('/').pop() ?? path,
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
    // Firestore's delete removes the document and is a no-op on one that is
    // already absent — never an error, which is why the drain can call it
    // unconditionally.
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

/**
 * AN ABANDONED REVERSAL SAYS SO, ON THE DOCUMENT (AGL-2140).
 *
 * Six paths settle the step with ZERO reversed for a DEFINITIVE reason, and
 * the settle marker then short-circuits every redelivery forever. Before this
 * the only difference between "the publisher's 8000 came back" and "the
 * publisher kept 8000 and Aglyn ate the refund" was a `console.error` — the
 * document read `reversedTransferCents: 0` either way, and nothing anywhere
 * could be queried to find the money afterwards.
 *
 * The settle STAYS: re-running these paths would eventually double-debit a
 * seller, which is worse than a recorded loss. What changes is that the loss
 * is recorded.
 *
 * Forced red by dropping the `failure` argument at any of the six call sites:
 * `reversalFailedReason` comes back undefined.
 */
describe('a reversal that cannot happen is recorded, not lost (AGL-2140)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_2138'
  })

  /**
   * THE ONE THAT COSTS REAL MONEY. `balance_insufficient` on a publisher's
   * connected account is a **400** — definitive, so it does not throw and
   * Stripe never redelivers. The whole share was forfeited silently.
   */
  it('a Stripe 4xx on the reversal POST records the reason and the amount owed', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: {
        ok: false,
        status: 400,
        body: { error: { code: 'balance_insufficient' } },
      },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 0,
      reversalFailedReason: 'reversal-refused',
      reversalFailedCause: 'refund',
      // The publisher's full share, which is what someone recovering this has
      // to know and could not have derived from a settled-at-zero row.
      reversalOwedCents: 8000,
    })
    expect(purchase()['reversalFailedAt']).toBe('NOW')
  })

  /** A definitive refusal on the charge read, before any amount is known. */
  it('a refused charge read records the reason with no amount claimed', async () => {
    stubStripe({
      charge: { ok: false, status: 404, body: { error: { code: 'resource_missing' } } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 0,
      reversalFailedReason: 'charge-read-refused',
    })
    // Not invented: the share is unknowable at this point, so no figure is
    // written rather than a misleading zero.
    expect(purchase()['reversalOwedCents']).toBeUndefined()
  })

  /** A charge with no transfer on it — nothing was ever paid out. */
  it('a charge with no transfer records that, distinctly', async () => {
    stubStripe({ charge: { body: { id: 'ch_1', amount: 10825 } } })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 0,
      reversalFailedReason: 'no-transfer-on-charge',
    })
  })

  /**
   * An already fully-reversed transfer is NOT a failure — an earlier cause
   * pulled it back — so it states `owedCents: 0` rather than leaving the
   * amount unknown. Distinguishing this from the 4xx case is the whole point
   * of the field.
   */
  it('a fully-reversed transfer records zero owed, not an unknown', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody({ amount_reversed: 8000 }) },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 0,
      reversalFailedReason: 'transfer-fully-reversed',
      reversalOwedCents: 0,
    })
  })

  /**
   * POSITIVE CONTROL. A reversal that SUCCEEDS must carry none of these
   * fields — otherwise `where('reversalFailedAt', '!=', null)` returns every
   * refund ever processed and the recovery queue is useless.
   */
  it('POSITIVE CONTROL: a successful reversal records no failure at all', async () => {
    stubStripe({
      charge: { body: chargeBody },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_1', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(purchase()).toMatchObject({
      reversedTransferCents: 8000,
      transferReversalId: 'trr_1',
    })
    expect(purchase()['reversalFailedAt']).toBeUndefined()
    expect(purchase()['reversalFailedReason']).toBeUndefined()
    expect(purchase()['reversalOwedCents']).toBeUndefined()
  })
})

describe('what a refund must NOT reverse (AGL-1995)', () => {
  // Positive controls for the branch's selectivity. A reversal that fired on
  // everything would be a worse bug than the one being fixed: it would debit
  // publishers for sales that were never refunded.
  it('leaves a partial refund UNREVOKED — it is a concession, not an un-buy', async () => {
    // The money half of a partial refund CHANGED in AGL-2299 (see the
    // dedicated describe below); what this case pins is the half that did
    // not. The buyer keeps what they bought, GA is not told the sale came
    // back, and the one-shot settle marker is not consumed.
    process.env.STRIPE_SECRET_KEY = 'sk_double_1995'
    stubStripe({
      charge: { body: { ...chargeBody, amount_refunded: 5000 } },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_partial', amount: 3695 } },
    })
    await marketplaceBillingWebhookHandler(
      refundEvent({ refunded: false, amount_refunded: 5000 }) as any,
    )
    expect(purchase()['refundedAt']).toBeUndefined()
    expect(adminMock.__ga4Refunds).toHaveLength(0)
    // The one-shot marker stays free, so a LATER full refund or lost dispute
    // can still run — with only the remainder left to take.
    expect(purchase()['reversedTransferCents']).toBeUndefined()
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

/**
 * A PARTIAL refund pulls back the publisher's proportional share (AGL-2299).
 *
 * The worked example throughout: a $100 listing at a 20% take rate with $8.25
 * of tax. `charge.amount` is 10825, `transfer.amount` is 8000 — the seller's
 * share of the PRE-TAX price, because the marketplace pays a fixed
 * `transfer_data[amount]` rather than an application fee.
 *
 * Before this, none of it happened: the branch was gated on `refunded ===
 * true`, so a $50 goodwill refund was paid entirely out of the platform's
 * balance while the publisher's $80 had already left on the destination
 * transfer. Aglyn holds $20 of that charge plus tax it owes the state, so the
 * platform was $30 down and the seller untouched. Publisher agreement §8.4
 * covers the pull-back in as many words.
 *
 * The arithmetic: floor(5000 × 8000 ÷ 10825) = 3695.
 */
describe('a partial refund reverses the seller share proportionally (AGL-2299)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_double_2291'
  })

  const partial = (amountRefunded: number) =>
    refundEvent({ refunded: false, amount_refunded: amountRefunded }) as any

  it('POSTs the proportional slice and records it', async () => {
    stubStripe({
      charge: { body: { ...chargeBody, amount_refunded: 5000 } },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_p1', amount: 3695 } },
    })

    await marketplaceBillingWebhookHandler(partial(5000))

    expect(posts).toHaveLength(1)
    expect(String(posts[0].init.body)).toContain('amount=3695')
    expect(purchase()).toMatchObject({
      partialRefundedCents: 5000,
      partialReversedTransferCents: 3695,
      partialTransferReversalId: 'trr_p1',
    })
  })

  it('is idempotent under a redelivery — Stripe’s amount_reversed is the ledger', async () => {
    // The second delivery sees the reversal already on the transfer, so the
    // target is met and nothing is POSTed. No settle marker of our own is
    // involved: the convergence is against Stripe's own number.
    let reversed = 0
    fetchMock.mockImplementation(async (url: any, init?: any) => {
      const address = String(url)
      if (address === 'https://api.stripe.com/v1/charges/ch_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...chargeBody, amount_refunded: 5000 }),
        }
      }
      if (address === 'https://api.stripe.com/v1/transfers/tr_1') {
        return {
          ok: true,
          status: 200,
          json: async () => transferBody({ amount_reversed: reversed }),
        }
      }
      if (address === 'https://api.stripe.com/v1/transfers/tr_1/reversals') {
        posts.push({ url: address, init })
        reversed += 3695
        return { ok: true, status: 200, json: async () => ({ id: 'trr_p1', amount: 3695 }) }
      }
      throw new Error(`Unexpected fetch to ${address}`)
    })

    await marketplaceBillingWebhookHandler(partial(5000))
    await marketplaceBillingWebhookHandler(partial(5000))

    expect(posts).toHaveLength(1)
    expect(purchase()['partialReversedTransferCents']).toBe(3695)
  })

  it('a SECOND partial refund takes only the difference', async () => {
    // Two refunds, $50 then a further $25, so the cumulative
    // `amount_refunded` is 7500: target floor(7500 × 8000 ÷ 10825) = 5542,
    // and 3695 has already come back, so the second call takes 1847.
    let reversed = 0
    let refunded = 5000
    fetchMock.mockImplementation(async (url: any, init?: any) => {
      const address = String(url)
      if (address === 'https://api.stripe.com/v1/charges/ch_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...chargeBody, amount_refunded: refunded }),
        }
      }
      if (address === 'https://api.stripe.com/v1/transfers/tr_1') {
        return {
          ok: true,
          status: 200,
          json: async () => transferBody({ amount_reversed: reversed }),
        }
      }
      if (address === 'https://api.stripe.com/v1/transfers/tr_1/reversals') {
        posts.push({ url: address, init })
        const amount = Number(new URLSearchParams(String(init.body)).get('amount'))
        reversed += amount
        return { ok: true, status: 200, json: async () => ({ id: 'trr_p', amount }) }
      }
      throw new Error(`Unexpected fetch to ${address}`)
    })

    await marketplaceBillingWebhookHandler(partial(5000))
    refunded = 7500
    await marketplaceBillingWebhookHandler(partial(7500))

    expect(posts.map((post) => new URLSearchParams(String(post.init.body)).get('amount'))).toEqual([
      '3695',
      '1847',
    ])
    expect(purchase()['partialReversedTransferCents']).toBe(5542)
  })

  it('a LATER full refund takes only the remainder — no double debit', async () => {
    // The composition that matters most. The one-shot path caps at
    // `transfer.amount − amount_reversed`, so after 3695 has come back on a
    // partial, a full refund pulls 4305 rather than the whole 8000.
    let reversed = 0
    let refunded = 5000
    fetchMock.mockImplementation(async (url: any, init?: any) => {
      const address = String(url)
      if (address === 'https://api.stripe.com/v1/charges/ch_1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...chargeBody, amount_refunded: refunded }),
        }
      }
      if (address === 'https://api.stripe.com/v1/transfers/tr_1') {
        return {
          ok: true,
          status: 200,
          json: async () => transferBody({ amount_reversed: reversed }),
        }
      }
      if (address === 'https://api.stripe.com/v1/transfers/tr_1/reversals') {
        posts.push({ url: address, init })
        const amount = Number(new URLSearchParams(String(init.body)).get('amount'))
        reversed += amount
        return { ok: true, status: 200, json: async () => ({ id: 'trr_x', amount }) }
      }
      throw new Error(`Unexpected fetch to ${address}`)
    })

    await marketplaceBillingWebhookHandler(partial(5000))
    refunded = 10825
    await marketplaceBillingWebhookHandler(
      refundEvent({ refunded: true, amount_refunded: 10825 }) as any,
    )

    expect(posts.map((post) => new URLSearchParams(String(post.init.body)).get('amount'))).toEqual([
      '3695',
      '4305',
    ])
    // Together they are the whole seller share, and no more.
    expect(reversed).toBe(8000)
    // And the full refund did everything else a full refund does.
    expect(purchase()['refundedAt']).toBe('NOW')
    expect(purchase()['reversedTransferCents']).toBe(4305)
  })

  it('does nothing once the one-shot path has already settled', async () => {
    // A lost dispute took the share; a partial refund arriving afterwards must
    // not debit the publisher a second time.
    stubStripe({
      charge: { body: { ...chargeBody, amount_refunded: 10825 } },
      transfer: { body: transferBody() },
      reversalPost: { body: { id: 'trr_full', amount: 8000 } },
    })
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    posts.length = 0

    await marketplaceBillingWebhookHandler(partial(5000))

    expect(posts).toHaveLength(0)
  })

  it('ignores a partial refund on a charge with no purchase and no marketplace stamp', async () => {
    // The selectivity control. `charge.refunded` reaches this endpoint for
    // storefront orders and subscription charges; a reversal that fired on
    // those would debit merchants for sales this handler knows nothing about.
    await marketplaceBillingWebhookHandler(
      refundEvent({
        refunded: false,
        amount_refunded: 5000,
        payment_intent: 'pi_someone_else',
      }) as any,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records a definitive Stripe refusal for recovery rather than losing it', async () => {
    // `balance_insufficient` on a connected account is a 400, so it neither
    // throws nor redelivers — AGL-2140's queue is where it has to land.
    stubStripe({
      charge: { body: { ...chargeBody, amount_refunded: 5000 } },
      transfer: { body: transferBody() },
      reversalPost: {
        ok: false,
        status: 400,
        body: { error: { code: 'balance_insufficient' } },
      },
    })

    await marketplaceBillingWebhookHandler(partial(5000))

    expect(purchase()).toMatchObject({
      reversalFailedReason: 'reversal-refused',
      reversalFailedCause: 'partial-refund',
      reversalOwedCents: 3695,
    })
    // NOT settled: the one-shot marker stays free, so a later full refund or
    // dispute still pulls back what it can.
    expect(purchase()['reversedTransferCents']).toBeUndefined()
  })

  it('records the MEASURED owed amount, not a constant (AGL-2309)', async () => {
    // AGL-2309 gave the queue a staff surface, and a surface is only worth
    // building if the number on it is the real one. The test above pins a
    // single refusal at 3695 — which any writer hardcoding 3695 would also
    // pass, and a hardcoded owed amount is exactly the failure that makes a
    // recovery queue worse than none: staff would chase the wrong sum.
    //
    // So: two refusals of DIFFERENT sizes on the same purchase, and the
    // recorded amount has to move with the refund. A refusal does not settle
    // (`reversedTransferCents` stays free, asserted above), so the second
    // refund re-runs and overwrites.
    //
    // floor(5000 × 8000 ÷ 10825) = 3695; floor(8000 × 8000 ÷ 10825) = 5912.
    const refuse = (amountRefunded: number) =>
      stubStripe({
        charge: { body: { ...chargeBody, amount_refunded: amountRefunded } },
        transfer: { body: transferBody() },
        reversalPost: {
          ok: false,
          status: 400,
          body: { error: { code: 'balance_insufficient' } },
        },
      })

    refuse(5000)
    await marketplaceBillingWebhookHandler(partial(5000))
    expect(purchase()['reversalOwedCents']).toBe(3695)

    refuse(8000)
    await marketplaceBillingWebhookHandler(partial(8000))
    expect(purchase()['reversalOwedCents']).toBe(5912)
  })

  it('THROWS on a transient Stripe failure so the redelivery is the retry', async () => {
    stubStripe({
      charge: { body: { ...chargeBody, amount_refunded: 5000 } },
      transfer: { ok: false, status: 503, body: {} },
    })
    await expect(
      marketplaceBillingWebhookHandler(partial(5000)),
    ).rejects.toThrow(/transfer read failed/i)
  })
})
