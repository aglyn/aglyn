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
  hasOrgLicenceOf,
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
  /**
   * THE ORGANIZATION BEING INSTALLED INTO (AGL-2331) — required, because a
   * licence belongs to an org and asking this question without one can only be
   * answered by the legacy grant.
   *
   * Every caller resolves it SERVER-SIDE from an authenticated membership
   * (`resolveOrgPermissions`), never from a request body field. It is
   * deliberately not optional: the gate that decides who gets paid content
   * must not be satisfiable by forgetting an argument, and a required property
   * makes every one of the nine doors a compile error until it is wired.
   *
   * The empty string is legal and means "this site has no owning org" — see
   * `purchaseEntitlesOrg`, which never matches a document against it.
   */
  buyerOrgId: string
  listingId: string
}

/**
 * True when this ORGANIZATION holds a live licence for this listing
 * (AGL-2331); see `purchaseEntitlesOrg` in the model for the licensing model
 * and the legacy grant, which is where the reasoning lives.
 *
 * A FULLY refunded purchase (`refundedAt`, stamped by the `charge.refunded`
 * branch of the marketplace billing webhook) reads as absent. Re-buying after a
 * refund writes a fresh session-keyed doc, so a legitimate second purchase
 * still installs and a refunded one sitting beside it does not veto it.
 *
 * TWO queries, not one, and not an `in` filter over both fields — Firestore
 * has no disjunction across different fields that also keeps the `listingId`
 * equality, and the honest question genuinely is a union of two populations:
 * the org's licences, and this person's pre-AGL-2331 purchases. Both are
 * equality-only conjunctions, so both are served by the automatic single-field
 * indexes exactly as the original query was — no composite index, nothing to
 * deploy.
 *
 * The org query is skipped entirely when there is no org, and the legacy query
 * when there is no uid, so the common path (an org-stamped licence for a
 * signed-in member) still costs the two reads it always did plus one for the
 * grandfather — and the grandfather query is against a set that can only
 * shrink.
 *
 * Callers gate on this only when `priceUsd > 0` and the caller is not the
 * publisher — a free listing and a publisher installing their own work never
 * had a purchase doc to find.
 */
export async function hasLivePurchase({
  firestore,
  buyerUid,
  buyerOrgId,
  listingId,
}: LivePurchaseQuery): Promise<boolean> {
  if (!listingId) return false
  if (!buyerUid && !buyerOrgId) return false
  const purchases = firestore.collection('marketplacePurchases')
  const [byOrg, byUid] = await Promise.all([
    buyerOrgId
      ? purchases
          .where('buyerOrgId', '==', buyerOrgId)
          .where('listingId', '==', listingId)
          .limit(PURCHASE_SCAN_LIMIT)
          .get()
      : null,
    // The legacy grant (AGL-2331). Kept as its own read rather than folded
    // into the org query, because the documents it exists to find are exactly
    // the ones with no `buyerOrgId` to match on — an org-keyed query cannot
    // see them at all, which is precisely how a naive cutover would have
    // revoked every purchase made before it.
    buyerUid
      ? purchases
          .where('buyerUid', '==', buyerUid)
          .where('listingId', '==', listingId)
          .limit(PURCHASE_SCAN_LIMIT)
          .get()
      : null,
  ])
  // `hasOrgLicenceOf` re-tests the listing id the queries already filtered on,
  // deliberately: it is the same shared predicate the listing page and the
  // checkout guard call, so the one place that decides who owns what has one
  // implementation rather than a server-shaped variant of it.
  return hasOrgLicenceOf(
    [...(byOrg?.docs ?? []), ...(byUid?.docs ?? [])].map(
      (purchase) => purchase.data() as PurchaseLiveness,
    ),
    listingId,
    { orgId: buyerOrgId, uid: buyerUid },
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
  buyerOrgId,
  listingId,
  priceUsd,
  ownsListing,
}: LivePurchaseQuery & {
  priceUsd: number
  /** The publisher installs their own listing for free (AGL-652). */
  ownsListing: boolean
}): Promise<{ error: string; priceUsd: number } | null> {
  if (!(priceUsd > 0) || ownsListing) return null
  const live = await hasLivePurchase({
    firestore,
    buyerUid,
    buyerOrgId,
    listingId,
  })
  return live ? null : { error: 'Purchase required', priceUsd }
}
