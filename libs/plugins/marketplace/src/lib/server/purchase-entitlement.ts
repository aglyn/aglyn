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
 */

/**
 * The paid-install entitlement predicate (AGL-46/1546/1699).
 *
 * ONE function, deliberately, because there are eight ways into paid content —
 * seven install routes plus `update-artifact` — and every one of them used to
 * carry its own copy of this query. AGL-1546 taught the copy in `install.ts`
 * that a refunded purchase no longer entitles and could not reach the other
 * seven, so a refunded buyer kept installing plugins, themes, templates,
 * layouts, dataset schemas and email templates for as long as the listing
 * existed. A predicate that decides who has paid us belongs in one place; the
 * next thing that changes it (chargebacks, AGL-1554) then changes it
 * everywhere by construction.
 */

/**
 * How many of a buyer's purchase docs for one listing to examine.
 *
 * Filtering in the query is not available to us: the honest predicate is
 * "there exists a purchase without `refundedAt`", and Firestore's
 * `where('refundedAt', '==', null)` does not match documents that are MISSING
 * the field — which is every purchase written before AGL-1546. A `!=` filter
 * has the same blind spot from the other side. So the docs come back unfiltered
 * and the liveness test happens here.
 *
 * Ten is a bound on the read, not on the semantics: it takes ten refunded
 * purchases of the SAME listing by the SAME buyer before a live eleventh could
 * be missed, and the failure mode of that is a 402 on a listing the buyer owns
 * — recoverable and visible — rather than free paid content.
 */

import {
  hasLivePurchaseOf,
  type PurchaseLiveness,
} from '../model/marketplace'

const PURCHASE_SCAN_LIMIT = 10

// The liveness test itself lives in the model (AGL-2158), not here: the
// listing page asks the same question and cannot import a server module, and
// its own copy had drifted to no refund test at all — showing a refunded
// buyer as an owner while these routes 402'd them.


interface LivePurchaseQuery {
  firestore: FirebaseFirestore.Firestore
  /** The authenticated caller's uid — never a value from the request body. */
  buyerUid: string
  listingId: string
}

/**
 * True when this buyer holds a purchase of this listing that still entitles.
 *
 * A FULLY refunded purchase (`refundedAt`, stamped by the `charge.refunded`
 * branch of the marketplace billing webhook) reads as absent. Re-buying after a
 * refund writes a fresh session-keyed doc, so a legitimate second purchase
 * still installs and a refunded one sitting beside it does not veto it.
 *
 * Callers gate on this only when `priceUsd > 0` and the caller is not the
 * publisher — a free listing and a publisher installing their own work never
 * had a purchase doc to find.
 */
export async function hasLivePurchase({
  firestore,
  buyerUid,
  listingId,
}: LivePurchaseQuery): Promise<boolean> {
  if (!buyerUid || !listingId) return false
  const purchases = await firestore
    .collection('marketplacePurchases')
    .where('buyerUid', '==', buyerUid)
    .where('listingId', '==', listingId)
    .limit(PURCHASE_SCAN_LIMIT)
    .get()
  return hasLivePurchaseOf(
    purchases.docs.map((purchase) => purchase.data() as PurchaseLiveness),
    listingId,
  )
}

/**
 * The whole gate: resolves to `null` when the caller may proceed, or to the
 * 402 payload to return when they may not.
 *
 * Returning the payload rather than writing the response keeps this usable
 * from `update-artifact`, whose preview and apply branches answer differently,
 * while still giving the seven install routes a single-line gate.
 */
export async function requirePurchase({
  firestore,
  buyerUid,
  listingId,
  priceUsd,
  ownsListing,
}: LivePurchaseQuery & {
  priceUsd: number
  /** The publisher installs their own listing for free (AGL-652). */
  ownsListing: boolean
}): Promise<{ error: string; priceUsd: number } | null> {
  if (!(priceUsd > 0) || ownsListing) return null
  const live = await hasLivePurchase({ firestore, buyerUid, listingId })
  return live ? null : { error: 'Purchase required', priceUsd }
}
