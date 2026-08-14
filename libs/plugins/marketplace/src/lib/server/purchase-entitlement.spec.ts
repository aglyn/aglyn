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
 * The shared paid-install entitlement predicate (AGL-1699).
 *
 * The interesting cases are the ones the per-route copies got wrong: a
 * refunded purchase must not entitle, a live purchase must still entitle even
 * with a refunded one beside it, and the free/publisher paths must not spend a
 * read at all.
 */

import { hasLivePurchase, requirePurchase } from './purchase-entitlement'

/** Minimal Firestore stand-in that records what it was asked for. */
function makeFirestore(purchases: Array<Record<string, unknown>>) {
  const calls = { collections: [] as string[], limits: [] as number[] }
  const firestore = {
    collection(name: string) {
      calls.collections.push(name)
      const chain = {
        where: () => chain,
        limit(count: number) {
          calls.limits.push(count)
          return chain
        },
        get: async () => ({
          empty: purchases.length === 0,
          docs: purchases.map((purchase) => ({
            get: (field: string) => purchase[field],
            data: () => purchase,
          })),
        }),
      }
      return chain
    },
  }
  return { firestore: firestore as any, calls }
}

const listingId = 'listing-1'
const buyerUid = 'buyer-1'

describe('hasLivePurchase (AGL-1699)', () => {
  it('is false when the buyer never purchased', async () => {
    const { firestore } = makeFirestore([])
    await expect(hasLivePurchase({ firestore, buyerUid, listingId })).resolves.toBe(
      false,
    )
  })

  it('is true for an ordinary purchase with no refund stamp', async () => {
    const { firestore } = makeFirestore([{ buyerUid, listingId }])
    await expect(hasLivePurchase({ firestore, buyerUid, listingId })).resolves.toBe(
      true,
    )
  })

  it('is FALSE when the only purchase was fully refunded', async () => {
    const { firestore } = makeFirestore([
      { buyerUid, listingId, refundedAt: 'THEN' },
    ])
    await expect(hasLivePurchase({ firestore, buyerUid, listingId })).resolves.toBe(
      false,
    )
  })

  it('is true when a re-buy sits beside the refunded original', async () => {
    const { firestore } = makeFirestore([
      { buyerUid, listingId, refundedAt: 'THEN' },
      { buyerUid, listingId },
    ])
    await expect(hasLivePurchase({ firestore, buyerUid, listingId })).resolves.toBe(
      true,
    )
  })

  it('scans past the first doc — a refunded purchase must not shadow a live one', async () => {
    // The bug this bounds: every per-route copy used `.limit(1)`, so whichever
    // doc came back first decided the answer.
    const { firestore, calls } = makeFirestore([
      { buyerUid, listingId, refundedAt: 'THEN' },
      { buyerUid, listingId, refundedAt: 'THEN' },
      { buyerUid, listingId },
    ])
    await expect(hasLivePurchase({ firestore, buyerUid, listingId })).resolves.toBe(
      true,
    )
    expect(calls.limits[0]).toBeGreaterThan(1)
  })

  it('refuses a blank uid or listing without querying', async () => {
    const { firestore, calls } = makeFirestore([{ buyerUid, listingId }])
    await expect(
      hasLivePurchase({ firestore, buyerUid: '', listingId }),
    ).resolves.toBe(false)
    expect(calls.collections).toHaveLength(0)
  })
})

describe('requirePurchase (AGL-1699)', () => {
  it('returns the 402 payload for a refunded buyer', async () => {
    const { firestore } = makeFirestore([
      { buyerUid, listingId, refundedAt: 'THEN' },
    ])
    await expect(
      requirePurchase({
        firestore,
        buyerUid,
        listingId,
        priceUsd: 100,
        ownsListing: false,
      }),
    ).resolves.toEqual({ error: 'Purchase required', priceUsd: 100 })
  })

  it('lets a live purchase through', async () => {
    const { firestore } = makeFirestore([{ buyerUid, listingId }])
    await expect(
      requirePurchase({
        firestore,
        buyerUid,
        listingId,
        priceUsd: 100,
        ownsListing: false,
      }),
    ).resolves.toBeNull()
  })

  it('never queries for a free listing', async () => {
    const { firestore, calls } = makeFirestore([])
    await expect(
      requirePurchase({
        firestore,
        buyerUid,
        listingId,
        priceUsd: 0,
        ownsListing: false,
      }),
    ).resolves.toBeNull()
    expect(calls.collections).toHaveLength(0)
  })

  it('never queries when the caller publishes the listing', async () => {
    const { firestore, calls } = makeFirestore([])
    await expect(
      requirePurchase({
        firestore,
        buyerUid,
        listingId,
        priceUsd: 100,
        ownsListing: true,
      }),
    ).resolves.toBeNull()
    expect(calls.collections).toHaveLength(0)
  })
})
