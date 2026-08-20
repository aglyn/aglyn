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
import { sendGa4StripeConnected } from './ga4-measurement-protocol'
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
 * @param eventLivemode `event.livemode` from the enclosing `account.updated`
 *   event (AGL-2471) — NOT `event.data.object.livemode`, which Stripe's
 *   Account object does not have. Anything other than a boolean writes
 *   nothing, leaving the field absent, which every money gate reads as
 *   unverified and refuses.
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
  eventLivemode?: unknown,
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
  // WHICH STRIPE WORLD (AGL-2471). The Account object has no `livemode`, but
  // the EVENT carrying it does, and it is Stripe's own statement about the
  // account being described — the strongest evidence available, and it
  // arrives on every change. This is what heals a linkage whose mode was
  // never recorded, without anyone touching the database by hand.
  //
  // Same doctrine as the two flags above: only a literal boolean is written.
  if (typeof eventLivemode === 'boolean') {
    patch['stripeAccountLivemode'] = eventLivemode
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
    // THE ACTIVATION TRANSITION, read BEFORE the write (AGL-1580).
    //
    // `stripe_connected` is one of the launch key events, and its two
    // client-side emitters are gated on the merchant's profile still reading
    // "not connected" when they click. This webhook is what makes that false:
    // it lands while the merchant is still on Stripe's hosted onboarding, so
    // the flag has already flipped by the time they get back and the browser
    // event can never fire. See `sendGa4StripeConnected` for why the two
    // guards cannot both open for the same account.
    //
    // `!== true` and not `=== false`: a profile that has never been asked has
    // the field ABSENT, and that is the commonest first-connect shape of all.
    const becameConnected =
      patch['stripeChargesEnabled'] === true &&
      doc.get('stripeChargesEnabled') !== true
    // `updateExisting` rethrows anything that is not "the document is gone",
    // so a permission or transport failure still reaches the webhook and gets
    // the redelivery it needs.
    if (await updateExisting(doc.ref, patch)) {
      updated += 1
      // Reported only after the write LANDED. A document erased between the
      // query and the update is not an activation, and reporting one would
      // put a merchant in the metric who no longer exists.
      //
      // Awaited, not floated: this runs inside the Stripe webhook's claim on
      // the event, and a floated promise in a serverless handler is frozen at
      // response and never runs — the AGL-2346 shape. The sender swallows
      // everything and cannot un-claim the event by throwing.
      if (becameConnected) await sendGa4StripeConnected({ accountId })
    }
  }
  return updated
}
