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
 * The marketplace section of the platform Stripe webhook (AGL-46/418,
 * extended by AGL-1544/1546): the purchase doc is the buyer's entitlement
 * AND the seller ledger AND the tax record, so what lands on it is a
 * contract, not an implementation detail.
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
      store[path] = options?.merge
        ? { ...(store[path] ?? {}), ...data }
        : data
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
    // AGL-1561: marketplace sales are real revenue and report a GA4
    // `purchase`. Captured rather than stubbed so the money that reaches
    // GA can be asserted against the money that reaches the ledger.
    __ga4: ga4,
    // AGL-1850: and a full refund reverses it, in the same accounting.
    __ga4Refunds: ga4Refunds,
    sendGa4Purchase: async (
      input: Ga4PurchaseInput,
    ): Promise<Ga4SendResult> => {
      ga4.push(input)
      return { sent: true, synthesizedClientId: false }
    },
    sendGa4Refund: async (
      input: Ga4PurchaseInput,
    ): Promise<Ga4SendResult> => {
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
                      // Real query snapshots carry the document id, and the
                      // AGL-1850 refund keys its GA hit on it.
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
  // Typed as the real `sendGa4Purchase` input rather than a loose record, so
  // the GA4 assertions below are checked against the shape production sends —
  // a renamed field on `Ga4PurchaseInput` fails typecheck here instead of
  // silently making `sent.transactionId` read as `undefined` at runtime.
  __ga4: Ga4PurchaseInput[]
  __ga4Refunds: Ga4PurchaseInput[]
}

const completedSession = (over: Record<string, unknown> = {}) => ({
  type: 'checkout.session.completed',
  object: {
    id: 'cs_test_1',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 10825,
    total_details: { amount_tax: 825 },
    metadata: {
      type: 'marketplace-purchase',
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      feeCents: '2000',
      transferCents: '8000',
    },
    ...over,
  },
  event: {},
})

beforeEach(() => {
  adminMock.__writes.length = 0
  adminMock.__ga4.length = 0
  adminMock.__ga4Refunds.length = 0
  for (const key of Object.keys(adminMock.__store)) {
    delete adminMock.__store[key]
  }
})

describe('marketplace purchase record (AGL-46/1544)', () => {
  it('writes the purchase keyed by session id with the full money split', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(adminMock.__writes).toHaveLength(1)
    const { path, data } = adminMock.__writes[0]
    expect(path).toBe('marketplacePurchases/cs_test_1')
    expect(data).toMatchObject({
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      feeCents: 2000,
      // The tax the PLATFORM owes and the transfer the SELLER received —
      // without these the ledger cannot show a remittance-correct split.
      taxCents: 825,
      transferCents: 8000,
      paymentIntentId: 'pi_1',
    })
  })

  it('ignores unpaid sessions and foreign metadata', async () => {
    await marketplaceBillingWebhookHandler(
      completedSession({ payment_status: 'unpaid' }) as any,
    )
    await marketplaceBillingWebhookHandler(
      completedSession({ metadata: { type: 'subscription' } }) as any,
    )
    expect(adminMock.__writes).toHaveLength(0)
  })

  /**
   * THE REDELIVERY GUARD (AGL-2109).
   *
   * The ledger doc is not only the sale — it is the buyer's ENTITLEMENT
   * (`hasLivePurchase` reads `refundedAt`), the refund trail, and the
   * transfer-reversal settle marker (`reversedTransferCents`, which the
   * reversal short-circuits on so a seller is never debited twice).
   *
   * Every LATER write on this path merges. The session write did not, so it
   * was a full document REPLACE — and Stripe redelivers
   * `checkout.session.completed` for up to three days whenever this endpoint
   * 500s, which it does on purpose for every transient Stripe failure and for
   * any throw from a sibling plugin handler running after this one. A
   * redelivery landing after a refund therefore erased `refundedAt` (the
   * refunded buyer silently got their access back) and erased
   * `reversedTransferCents` (the seller became reversible a second time).
   *
   * Forced red on purpose by dropping `{ merge: true }` from the session
   * write in `billing-webhook.ts`: `refundedAt` comes back `undefined` and
   * both assertions below fail.
   */
  it('a session REDELIVERY after a refund does not erase the refund or the reversal marker', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    // The refund trail and the settle marker, written by the later branches.
    adminMock.__store['marketplacePurchases/cs_test_1'] = {
      ...(adminMock.__store['marketplacePurchases/cs_test_1'] ?? {}),
      refundedAt: 'NOW',
      refundedCents: 10825,
      reversedTransferCents: 8000,
      transferReversalId: 'trr_1',
    }

    // Stripe redelivers the SAME session event.
    await marketplaceBillingWebhookHandler(completedSession() as any)

    const row = adminMock.__store['marketplacePurchases/cs_test_1'] ?? {}
    // Entitlement: `hasLivePurchase` is `!purchase.get('refundedAt')`, so
    // losing this field hands a refunded buyer their install back.
    expect(row['refundedAt']).toBe('NOW')
    expect(row['refundedCents']).toBe(10825)
    // Settle marker: losing it re-opens `reverseMarketplaceSellerShare`,
    // which would debit the publisher's Connect account a second time.
    expect(row['reversedTransferCents']).toBe(8000)
    expect(row['transferReversalId']).toBe('trr_1')
    // And the sale itself is still intact — a merge must not be a no-op.
    expect(row['amountCents']).toBe(10825)
    expect(row['transferCents']).toBe(8000)
  })

  /**
   * The other half of AGL-2109, and the drift the merge itself would have
   * introduced: `createdAt` is the date the seller ledger and every revenue
   * period read, so a redelivery three days later must not move the sale to
   * today. Forced red by putting `createdAt` back unconditionally in the
   * session write — the second delivery then stamps it again.
   */
  it('a session REDELIVERY does not restamp createdAt', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    // Distinguishable from the mock's 'NOW' sentinel, so a restamp is
    // visible rather than coincidentally equal.
    adminMock.__store['marketplacePurchases/cs_test_1']['createdAt'] = 'DAY_ONE'

    await marketplaceBillingWebhookHandler(completedSession() as any)

    expect(
      adminMock.__store['marketplacePurchases/cs_test_1']['createdAt'],
    ).toBe('DAY_ONE')
    // A FIRST delivery still stamps it — otherwise this passes on a handler
    // that never writes the field at all.
    expect(
      adminMock.__store['marketplacePurchases/cs_test_9'],
    ).toBeUndefined()
    await marketplaceBillingWebhookHandler(
      completedSession({ id: 'cs_test_9' }) as any,
    )
    expect(
      adminMock.__store['marketplacePurchases/cs_test_9']['createdAt'],
    ).toBe('NOW')
  })
})

describe('GA4 purchase reporting (AGL-1561)', () => {
  it('reports the sale as revenue, keyed by the same session id as the ledger', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)

    expect(adminMock.__ga4).toHaveLength(1)
    const sent = adminMock.__ga4[0]
    // The session id, so GA de-duplicates a Stripe redelivery exactly as the
    // ledger's doc id does.
    expect(sent.transactionId).toBe('cs_test_1')
    expect(sent.items[0].item_category).toBe('marketplace')
  })

  it('reports nothing when the purchase was not paid', async () => {
    // An unpaid session writes no ledger row, so it must not report revenue
    // either — the two have to agree or GA and Stripe tell different stories.
    await marketplaceBillingWebhookHandler(
      completedSession({ payment_status: 'unpaid' }) as any,
    )

    expect(adminMock.__writes).toHaveLength(0)
    expect(adminMock.__ga4).toHaveLength(0)
  })

  it('never carries a seller-authored listing name into a GA dimension', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)

    expect(JSON.stringify(adminMock.__ga4)).not.toContain('@')
  })
})

/**
 * AGL-1639. GA revenue that disagrees with Stripe is worse than no GA
 * revenue, because it gets quoted.
 *
 * The fixture is one whole worked example: a $100 listing sold by a 20%-rate
 * seller into a jurisdiction charging $8.25 of tax.
 *
 *   gross (amount_total) 10825¢ = 10000¢ listing + 825¢ tax
 *   − tax                  825¢  collected by the platform, owed to the state
 *   − transfer            8000¢  paid to the seller's Connect account
 *   ────────────────────────────
 *   = platform net        2000¢  which is exactly metadata.feeCents
 *
 * Sending 108.25 booked tax and the seller's payout as Aglyn revenue.
 */
describe('marketplace revenue reconciles with Stripe (AGL-1639)', () => {
  it('reports the platform NET, not the tax-inclusive gross', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    const sent = adminMock.__ga4[0]
    expect(sent.value).toBe(20)
    // The gross the buyer paid, and the ex-tax GMV, are both wrong answers.
    expect(sent.value).not.toBe(108.25)
    expect(sent.value).not.toBe(100)
    // One item, one price: GA expects the items to sum to `value`.
    expect(sent.items[0].price).toBe(20)
    expect(sent.items[0].quantity).toBe(1)
  })

  it('the number GA gets equals the number the ledger records as the fee', async () => {
    // The two are computed independently — GA from Stripe's authoritative
    // gross and tax minus the seller transfer, the ledger's feeCents from
    // the rate resolved at checkout. If they ever diverge, one of them is
    // lying about the same sale.
    await marketplaceBillingWebhookHandler(completedSession() as any)
    const ledger = adminMock.__writes[0].data
    const sent = adminMock.__ga4[0]
    expect(sent.value * 100).toBe(ledger.feeCents)
    expect(sent.value * 100).toBe(
      Number(ledger.amountCents) -
        Number(ledger.taxCents) -
        Number(ledger.transferCents),
    )
  })

  it('holds at a different rate, price and tax jurisdiction', async () => {
    // A $250 listing at the 30% free-plan rate, no sales tax owed.
    await marketplaceBillingWebhookHandler(
      completedSession({
        amount_total: 25000,
        total_details: { amount_tax: 0 },
        metadata: {
          type: 'marketplace-purchase',
          listingId: 'listing-1',
          buyerUid: 'buyer-1',
          sellerOrgId: 'seller-org',
          feeCents: '7500',
          transferCents: '17500',
        },
      }) as any,
    )
    expect(adminMock.__ga4[0].value).toBe(75)
  })

  it('accounts for every cent the buyer paid, exactly once', async () => {
    // Aglyn collects sales tax as marketplace provider and remits it; it is
    // not ours and it is not `value`. The full decomposition of the gross has
    // to close — GA revenue plus the tax plus the seller's transfer IS what
    // the buyer was charged, with nothing double-counted and nothing lost.
    await marketplaceBillingWebhookHandler(completedSession() as any)
    const ledger = adminMock.__writes[0].data
    expect(
      adminMock.__ga4[0].value * 100 +
        Number(ledger.taxCents) +
        Number(ledger.transferCents),
    ).toBe(Number(ledger.amountCents))
  })
})

describe('refund revocation (AGL-1546)', () => {
  const refundEvent = (over: Record<string, unknown> = {}) => ({
    type: 'charge.refunded',
    object: {
      id: 'ch_1',
      payment_intent: 'pi_1',
      refunded: true,
      amount_refunded: 10825,
      ...over,
    },
    event: {},
  })

  it('a FULL refund stamps the purchase and is idempotent', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(
      adminMock.__store['marketplacePurchases/cs_test_1'],
    ).toMatchObject({ refundedAt: 'NOW', refundedCents: 10825 })
    // Redelivery restamps the same values — never a second doc, never a
    // throw that would 500 the whole platform webhook.
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(
      Object.keys(adminMock.__store).filter((key) =>
        key.startsWith('marketplacePurchases/'),
      ),
    ).toHaveLength(1)
  })

  it('a PARTIAL refund is a concession, not a revocation', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    await marketplaceBillingWebhookHandler(
      refundEvent({ refunded: false, amount_refunded: 500 }) as any,
    )
    expect(
      adminMock.__store['marketplacePurchases/cs_test_1']?.['refundedAt'],
    ).toBeUndefined()
  })

  it('an unknown payment intent writes nothing', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    adminMock.__writes.length = 0
    await marketplaceBillingWebhookHandler(
      refundEvent({ payment_intent: 'pi_other' }) as any,
    )
    expect(adminMock.__writes).toHaveLength(0)
    expect(adminMock.__ga4Refunds).toHaveLength(0)
  })
})

/**
 * AGL-1850. The refund is the AGL-1639 purchase run backwards, and every
 * assertion here is the mirror of one over there: same transaction id space
 * (the session id), same accounting (platform net, never the gross the buyer
 * paid back), and the same one-way ratchet (a redelivery must not report the
 * money out twice).
 */
describe('GA4 refund reverses the purchase in the same accounting (AGL-1850)', () => {
  const refundEvent = (over: Record<string, unknown> = {}) => ({
    type: 'charge.refunded',
    object: {
      id: 'ch_1',
      payment_intent: 'pi_1',
      customer: 'cus_buyer_1',
      currency: 'usd',
      refunded: true,
      amount_refunded: 10825,
      ...over,
    },
    event: {},
  })

  it('a full refund sends `refund` keyed by the ORIGINAL session id, valued at platform net', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    await marketplaceBillingWebhookHandler(refundEvent() as any)

    expect(adminMock.__ga4Refunds).toHaveLength(1)
    const sent = adminMock.__ga4Refunds[0]
    // The session id the purchase reported — netting requires the SAME
    // transaction, not the charge id and not the refund's own event.
    expect(sent.transactionId).toBe('cs_test_1')
    // Platform net ($20), matching what the purchase put in. The gross the
    // buyer got back (108.25) would net MORE out of GA than the sale ever
    // reported — the AGL-1639 failure with the opposite sign.
    expect(sent.value).toBe(20)
    expect(sent.value).toBe(adminMock.__ga4[0].value)
    expect(sent.stripeCustomerId).toBe('cus_buyer_1')
  })

  it('a redelivery that slips the event claim reports nothing twice — refundedAt is the guard', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    await marketplaceBillingWebhookHandler(refundEvent() as any)
    expect(adminMock.__ga4Refunds).toHaveLength(1)
  })

  it('a partial refund reports nothing — the ledger split does not decompose it', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    await marketplaceBillingWebhookHandler(
      refundEvent({ refunded: false, amount_refunded: 500 }) as any,
    )
    expect(adminMock.__ga4Refunds).toHaveLength(0)
  })
})
