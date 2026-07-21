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
 * registerCommunityConsoleApi. Install gating and the seller ledger read
 * these purchase docs.
 */
export const communityBillingWebhookHandler: BillingWebhookHandler = async ({
  type,
  object,
}) => {
    // Marketplace purchases (AGL-46): keyed by session id (idempotent on
    // Stripe redelivery). Install gating and the seller ledger read these.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'community-purchase' &&
      object?.payment_status === 'paid'
    ) {
      // Sellers are orgs (AGL-652) — the ledger records which ORG earned it.
      const { listingId, buyerUid, sellerOrgId, feeCents } =
        object.metadata ?? {}
      if (listingId && buyerUid && sellerOrgId) {
        await firebaseAdmin
          .app()
          .firestore()
          .collection('communityPurchases')
          .doc(String(object.id))
          .set({
            listingId,
            buyerUid,
            sellerOrgId,
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
      }
    }
}
