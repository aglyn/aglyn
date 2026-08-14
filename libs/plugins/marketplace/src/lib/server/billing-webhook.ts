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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

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
      }
    }
}
