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

import type { BillingWebhookHandler } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  sendGa4Purchase,
  sendGa4Refund,
} from '@aglyn/tenant-data-admin'

/**
 * Marketplace-purchase section of the platform Stripe webhook (AGL-46/418):
 * keyed by session id (idempotent on Stripe redelivery) — relocated
 * verbatim from the console route; registered via
 * registerMarketplaceConsoleApi. Install gating and the seller ledger read
 * these purchase docs.
 */
export const marketplaceBillingWebhookHandler: BillingWebhookHandler = async ({
  type,
  object,
}) => {
    // Marketplace purchases (AGL-46): keyed by session id (idempotent on
    // Stripe redelivery). Install gating and the seller ledger read these.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'marketplace-purchase' &&
      object?.payment_status === 'paid'
    ) {
      // Sellers are orgs (AGL-652) — the ledger records which ORG earned it.
      const { listingId, buyerUid, sellerOrgId, feeCents, transferCents } =
        object.metadata ?? {}
      if (listingId && buyerUid && sellerOrgId) {
        // The remittance-correct split (AGL-1544), read ONCE and used by both
        // the ledger and the GA hit (AGL-1639) — the two must not be able to
        // describe the same sale differently.
        //
        // `amount_total` is the tax-inclusive GROSS the buyer paid. Out of it:
        // `taxCents` is what the PLATFORM owes the state (collected under the
        // marketplace-provider registration, never ours), and `sellerCents` is
        // the fixed transfer the seller's Connect account received (their
        // share of the pre-tax price). What is left is what Aglyn keeps.
        const grossCents = Number(object?.amount_total ?? 0)
        const taxCents = Number(object?.total_details?.amount_tax ?? 0)
        const sellerCents = Number(transferCents ?? 0)
        const netCents = grossCents - taxCents - sellerCents
        await firebaseAdmin
          .app()
          .firestore()
          .collection('marketplacePurchases')
          .doc(String(object.id))
          .set({
            listingId,
            buyerUid,
            sellerOrgId,
            // Gross − tax − transfer = the platform fee, which feeCents also
            // records independently from the rate resolved at checkout.
            amountCents: grossCents,
            feeCents: Number(feeCents ?? 0),
            taxCents,
            transferCents: sellerCents,
            // The refund trail (AGL-1546): `charge.refunded` carries the
            // payment intent, not the session — without this id a refund
            // could never find the purchase it revokes.
            paymentIntentId: String(object?.payment_intent ?? ''),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
        // Marketplace sales are real revenue and belong in the same GA
        // `purchase` stream as subscriptions (AGL-1561), separated by
        // `item_category` so plugin revenue and subscription revenue can be
        // read apart or together.
        //
        // After the ledger write, and fire-and-forget: the ledger is what
        // grants the install entitlement, and an analytics failure must never
        // throw here — the route deletes its idempotency claim on any throw,
        // which would make Stripe redeliver a purchase that already landed.
        //
        // `transaction_id` is the checkout session id — the same key the
        // ledger doc uses — so GA de-duplicates a redelivery exactly as
        // Firestore does.
        // WHAT COUNTS AS REVENUE ON A MARKETPLACE SALE (AGL-1639)
        //
        // Our NET — the platform fee — and not the gross the buyer paid.
        // Decided once here rather than inferred from whichever Stripe field
        // was nearest, because the three candidates are genuinely different
        // numbers:
        //
        //   gross incl. tax  reconciles with nothing we own
        //   GMV ex-tax       what the SELLERS earned, not what we did
        //   platform net     our books, our MRR, our balance     ← this one
        //
        // This is *our* GA property and every other number in it is ours;
        // subscription `purchase` already reports what Aglyn was paid, and
        // marketplace revenue has to mean the same thing or the combined
        // total, ARPA and every revenue-based audience are nonsense. The two
        // stay separable by `item_category`.
        //
        // Tax is excluded rather than folded in, and is deliberately NOT sent
        // as GA4's `tax` param either: `value` is our fee, so a `tax` beside
        // it would not be a component of it, and asserting in GA that Aglyn
        // took this tax is exactly the question the publisher agreement's
        // seller-of-record clause has open. The ledger doc above keeps the
        // full split for anyone who needs it.
        void sendGa4Purchase({
          transactionId: String(object.id),
          value: netCents / 100,
          currency: String(object?.currency ?? 'usd'),
          items: [
            {
              item_id: String(listingId),
              // The listing id, not the display name: a listing's name is
              // seller-authored free text and is not worth risking in a
              // dimension when the id already identifies it.
              item_name: String(listingId),
              item_category: 'marketplace',
              // GA expects the items to sum to `value`; one item, one price.
              price: netCents / 100,
              quantity: 1,
            },
          ],
          clientId: object?.metadata?.ga_client_id,
          stripeCustomerId: String(object?.customer ?? '') || String(buyerUid),
        }).catch(() => undefined)
      }
    }

    // Refund revocation (AGL-1546): a FULL refund un-buys the listing —
    // the install gate treats a purchase with `refundedAt` as absent. Only
    // `refunded: true` (the whole charge) revokes; a partial refund is a
    // concession, not a revocation. Keyed by the payment intent stored at
    // completion, and idempotent: a Stripe redelivery restamps the same
    // values on the same doc. Requires the platform webhook endpoint to be
    // subscribed to `charge.refunded` (AGL-1549).
    if (type === 'charge.refunded' && object?.refunded === true) {
      const paymentIntentId = String(object?.payment_intent ?? '')
      if (paymentIntentId) {
        const firestore = firebaseAdmin.app().firestore()
        const purchases = await firestore
          .collection('marketplacePurchases')
          .where('paymentIntentId', '==', paymentIntentId)
          .limit(1)
          .get()
        if (!purchases.empty) {
          const purchase = purchases.docs[0]
          // Read BEFORE the stamp: `refundedAt` doubles as the GA guard, so
          // a redelivery that slips past the route's event claim finds the
          // purchase already refunded and reports nothing a second time.
          const alreadyRefunded = Boolean(purchase.get('refundedAt'))
          await purchase.ref.set(
            {
              refundedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              refundedCents: Number(object?.amount_refunded ?? 0),
            },
            { merge: true },
          )
          // GA4 `refund` (AGL-1850) — the reversal of the AGL-1639 purchase,
          // in the SAME accounting. The purchase reported the platform NET
          // (gross − tax − transfer), so the refund must reverse that number:
          // refunding the tax-inclusive gross would net MORE out of GA than
          // the sale ever put in. The ledger doc read above holds the split
          // the sale was recorded with, so the two cannot disagree.
          //
          // `transaction_id` is the purchase's own — the checkout session id
          // the ledger and the original `purchase` are keyed by — which is
          // what tells GA WHICH revenue to net out.
          //
          // Full refunds only, matching the revocation gate: the ledger's
          // split does not decompose an arbitrary partial amount (whose share
          // came back is a Stripe-side question), so a partial refund stays a
          // concession in GA exactly as it does for the entitlement.
          //
          // Fire-and-forget, after the stamp, same posture as the purchase:
          // an analytics failure must never un-claim a Stripe event.
          if (!alreadyRefunded) {
            const grossCents = Number(purchase.get('amountCents') ?? 0)
            const taxCents = Number(purchase.get('taxCents') ?? 0)
            const sellerCents = Number(purchase.get('transferCents') ?? 0)
            const netCents = grossCents - taxCents - sellerCents
            if (netCents > 0) {
              void sendGa4Refund({
                transactionId: String(purchase.id),
                value: netCents / 100,
                currency: String(object?.currency ?? 'usd'),
                items: [],
                stripeCustomerId:
                  String(object?.customer ?? '') ||
                  String(purchase.get('buyerUid') ?? ''),
              }).catch(() => undefined)
            }
          }
        }
      }
    }
}
