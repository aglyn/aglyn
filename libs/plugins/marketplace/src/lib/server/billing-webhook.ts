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
import { firebaseAdmin, sendGa4Purchase } from '@aglyn/tenant-data-admin'

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
        await firebaseAdmin
          .app()
          .firestore()
          .collection('marketplacePurchases')
          .doc(String(object.id))
          .set({
            listingId,
            buyerUid,
            sellerOrgId,
            // The remittance-correct split (AGL-1544): amount_total includes
            // the tax automatic_tax added on top; taxCents is what the
            // PLATFORM owes the state, transferCents is what the seller
            // received (their share of the pre-tax price). Gross − tax −
            // transfer = the platform fee, which feeCents also records.
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            taxCents: Number(object?.total_details?.amount_tax ?? 0),
            transferCents: Number(transferCents ?? 0),
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
        void sendGa4Purchase({
          transactionId: String(object.id),
          value: Number(object?.amount_total ?? 0) / 100,
          currency: String(object?.currency ?? 'usd'),
          items: [
            {
              item_id: String(listingId),
              // The listing id, not the display name: a listing's name is
              // seller-authored free text and is not worth risking in a
              // dimension when the id already identifies it.
              item_name: String(listingId),
              item_category: 'marketplace',
              price: Number(object?.amount_total ?? 0) / 100,
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
          await purchases.docs[0].ref.set(
            {
              refundedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              refundedCents: Number(object?.amount_refunded ?? 0),
            },
            { merge: true },
          )
        }
      }
    }
}
