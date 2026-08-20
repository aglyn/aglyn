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

/**
 * Minimal Firestore stand-in that records what it was asked for — and APPLIES
 * the `where` clauses.
 *
 * It used to ignore them and hand back every seeded purchase whatever was
 * asked. That was survivable while the query was one fixed conjunction; it is
 * not survivable now that WHICH FIELD the query is keyed on is the thing under
 * test (AGL-2331). A filter-blind double returns the same green for the
 * person-scoped predicate and the org-scoped one, which is the definition of a
 * check that cannot fail.
 */
function makeFirestore(purchases: Array<Record<string, unknown>>) {
  const calls = { collections: [] as string[], limits: [] as number[] }
  const chainFor = (filters: Array<[string, unknown]>): any => ({
    where: (field: string, _op: string, value: unknown) =>
      chainFor([...filters, [field, value]]),
    limit(count: number) {
      calls.limits.push(count)
      return chainFor(filters)
    },
    get: async () => {
      const matched = purchases.filter((purchase) =>
        filters.every(([field, value]) => purchase[field] === value),
      )
      return {
        empty: matched.length === 0,
        docs: matched.map((purchase) => ({
          get: (field: string) => purchase[field],
          data: () => purchase,
        })),
      }
    },
  })
  const firestore = {
    collection(name: string) {
      calls.collections.push(name)
      return chainFor([])
    },
  }
  return { firestore: firestore as any, calls }
}

const listingId = 'listing-1'
const buyerUid = 'buyer-1'
const buyerOrgId = 'org-northwind'

describe('hasLivePurchase (AGL-1699)', () => {
  it('is false when the buyer never purchased', async () => {
    const { firestore } = makeFirestore([])
    await expect(hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId })).resolves.toBe(
      false,
    )
  })

  it('is true for an ordinary purchase with no refund stamp', async () => {
    const { firestore } = makeFirestore([{ buyerUid, buyerOrgId, listingId }])
    await expect(hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId })).resolves.toBe(
      true,
    )
  })

  it('is FALSE when the only purchase was fully refunded', async () => {
    const { firestore } = makeFirestore([
      { buyerUid, buyerOrgId, listingId, refundedAt: 'THEN' },
    ])
    await expect(hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId })).resolves.toBe(
      false,
    )
  })

  it('is true when a re-buy sits beside the refunded original', async () => {
    const { firestore } = makeFirestore([
      { buyerUid, buyerOrgId, listingId, refundedAt: 'THEN' },
      { buyerUid, buyerOrgId, listingId },
    ])
    await expect(hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId })).resolves.toBe(
      true,
    )
  })

  it('scans past the first doc — a refunded purchase must not shadow a live one', async () => {
    // The bug this bounds: every per-route copy used `.limit(1)`, so whichever
    // doc came back first decided the answer.
    const { firestore, calls } = makeFirestore([
      { buyerUid, buyerOrgId, listingId, refundedAt: 'THEN' },
      { buyerUid, buyerOrgId, listingId, refundedAt: 'THEN' },
      { buyerUid, buyerOrgId, listingId },
    ])
    await expect(hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId })).resolves.toBe(
      true,
    )
    expect(calls.limits[0]).toBeGreaterThan(1)
  })

  it('refuses a blank uid or listing without querying', async () => {
    const { firestore, calls } = makeFirestore([{ buyerUid, buyerOrgId, listingId }])
    await expect(
      hasLivePurchase({ firestore, buyerUid: '', buyerOrgId: '', listingId }),
    ).resolves.toBe(false)
    expect(calls.collections).toHaveLength(0)
  })
})

describe('requirePurchase (AGL-1699)', () => {
  it('returns the 402 payload for a refunded buyer', async () => {
    const { firestore } = makeFirestore([
      { buyerUid, buyerOrgId, listingId, refundedAt: 'THEN' },
    ])
    await expect(
      requirePurchase({
        firestore,
        buyerUid,
        buyerOrgId,
        listingId,
        priceUsd: 100,
        ownsListing: false,
      }),
    ).resolves.toEqual({ error: 'Purchase required', priceUsd: 100 })
  })

  it('lets a live purchase through', async () => {
    const { firestore } = makeFirestore([{ buyerUid, buyerOrgId, listingId }])
    await expect(
      requirePurchase({
        firestore,
        buyerUid,
        buyerOrgId,
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
        buyerOrgId,
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
        buyerOrgId,
        listingId,
        priceUsd: 100,
        ownsListing: true,
      }),
    ).resolves.toBeNull()
    expect(calls.collections).toHaveLength(0)
  })
})

describe('the licence belongs to the ORGANIZATION (AGL-2331)', () => {
  const otherOrg = 'org-contoso'

  it('a licence bought for another workspace does not entitle this one', async () => {
    // The revenue leak, at the predicate. One person, two workspaces, one
    // purchase — and the second workspace was getting it free.
    const { firestore } = makeFirestore([
      { buyerUid, buyerOrgId: otherOrg, listingId },
    ])
    await expect(
      hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId }),
    ).resolves.toBe(false)
  })

  it('a colleague who never bought it holds the ORG’s licence', async () => {
    const { firestore } = makeFirestore([
      { buyerUid: 'someone-else', buyerOrgId, listingId },
    ])
    await expect(
      hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId }),
    ).resolves.toBe(true)
  })

  it('a LEGACY purchase still entitles its buyer, in any workspace', async () => {
    // Nothing written before AGL-2331 carries an org, and reinterpreting one
    // as "licensed to nobody" would revoke access somebody paid for. Asserted
    // against a workspace the purchase never named, because that is the case
    // a naive org-keyed cutover breaks.
    const { firestore } = makeFirestore([{ buyerUid, listingId }])
    await expect(
      hasLivePurchase({ firestore, buyerUid, buyerOrgId: otherOrg, listingId }),
    ).resolves.toBe(true)
  })

  it('a legacy purchase does NOT entitle a colleague', async () => {
    // The grandfather covers the BUYER, not the org — widening it would be a
    // grant invented by the migration rather than access somebody bought.
    const { firestore } = makeFirestore([
      { buyerUid: 'someone-else', listingId },
    ])
    await expect(
      hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId }),
    ).resolves.toBe(false)
  })

  it('a refunded ORG licence stops entitling', async () => {
    const { firestore } = makeFirestore([
      { buyerUid: 'someone-else', buyerOrgId, listingId, refundedAt: 'THEN' },
    ])
    await expect(
      hasLivePurchase({ firestore, buyerUid, buyerOrgId, listingId }),
    ).resolves.toBe(false)
  })

  it('an empty org never matches a document’s empty org', async () => {
    // A site with no owning org is not a licence holder. If the two empty
    // strings were compared directly, one malformed purchase document would
    // entitle every org-less install in the system.
    const { firestore } = makeFirestore([
      { buyerUid: 'someone-else', buyerOrgId: '', listingId },
    ])
    await expect(
      hasLivePurchase({ firestore, buyerUid, buyerOrgId: '', listingId }),
    ).resolves.toBe(false)
  })
})
