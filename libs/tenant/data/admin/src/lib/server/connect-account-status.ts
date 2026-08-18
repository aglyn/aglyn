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

import { firebaseAdmin } from './firebase-admin'
import { updateExisting } from './update-existing'

/**
 * Connect readiness, refreshed from Stripe rather than from a cached flag
 * (AGL-1997).
 *
 * `stripeChargesEnabled` is the field every money route gates on — commerce
 * checkout, cart checkout, draft orders, reservations, POS — and until this it
 * was refreshed ONLY when the merchant happened to reopen the Connect route.
 * So an account Stripe later restricts (a verification deadline passing, a
 * capability revoked, documents going stale) kept a cached `true`, the store
 * kept selling, and the failure surfaced to the SHOPPER at payment time. The
 * merchant, who could have fixed it, was the last to know.
 *
 * `account.updated` is the event that carries this. Stripe sends it on every
 * change to a connected account, which is why the fix is a subscription and
 * not a poll.
 *
 * WHY IT WRITES ONLY WHAT STRIPE ACTUALLY SAID. Both flags are written only
 * when the payload states them as booleans. Coercing an absent field with
 * `Boolean(...)` would manufacture a `false` and lock out a merchant who is
 * fine — the over-restrictive direction, but still a wrong answer invented
 * from no evidence — and defaulting the other way would re-create the very
 * fail-open this closes. An event that states neither flag writes nothing at
 * all; it is not an Account payload.
 *
 * WHY `updateExisting` AND NOT A MERGE-SET. The refs come from a query, so the
 * documents existed a moment ago — but a merge-set would resurrect one erased
 * in between as a stub holding two payout booleans and nothing else, the
 * AGL-1763 phantom shape. `update()` rejects instead, and a rejection here
 * costs nothing: the next `account.updated` re-delivers the same state.
 *
 * IDEMPOTENT AND ORDER-INDEPENDENT by construction — it mirrors current state,
 * never a delta — so a Stripe redelivery and an out-of-order pair both
 * converge.
 */
export interface ConnectAccountStatusEvent {
  /** `event.data.object` for `account.updated` — the Stripe Account. */
  id?: unknown
  charges_enabled?: unknown
  payouts_enabled?: unknown
}

/**
 * Mirrors a connected account's charge/payout readiness onto whichever
 * documents in `collection` name it in `stripeAccountId`.
 *
 * @param collection Firestore collection holding the payout binding —
 *   `profiles` for storefront merchants, `publisherProfiles` for marketplace
 *   publishers. Each plugin syncs its own; a non-matching account updates
 *   nothing.
 * @returns the number of documents updated. 0 is the ordinary answer for an
 *   account this collection does not bind, and the caller should not treat it
 *   as a failure.
 */
export async function syncConnectAccountStatus(
  collection: string,
  account: ConnectAccountStatusEvent | null | undefined,
): Promise<number> {
  const accountId = typeof account?.id === 'string' ? account.id.trim() : ''
  if (!accountId) return 0
  const patch: Record<string, boolean> = {}
  if (typeof account?.charges_enabled === 'boolean') {
    patch['stripeChargesEnabled'] = account.charges_enabled
  }
  if (typeof account?.payouts_enabled === 'boolean') {
    patch['stripePayoutsEnabled'] = account.payouts_enabled
  }
  // Nothing stated, nothing written — see the doc comment.
  if (!Object.keys(patch).length) return 0

  const matches = await firebaseAdmin
    .app()
    .firestore()
    .collection(collection)
    .where('stripeAccountId', '==', accountId)
    .get()
  let updated = 0
  for (const doc of matches.docs) {
    // `updateExisting` rethrows anything that is not "the document is gone",
    // so a permission or transport failure still reaches the webhook and gets
    // the redelivery it needs.
    if (await updateExisting(doc.ref, patch)) updated += 1
  }
  return updated
}
