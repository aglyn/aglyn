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
  syncConnectAccountStatus,
} from '@aglyn/tenant-data-admin'

/** Stripe failures a redelivery can actually fix. */
function isTransientStripeStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** One authorized GET against the Stripe API, body parsed either way. */
async function stripeGet(
  url: string,
  stripeKey: string,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

/**
 * The seller's share of a LOST marketplace dispute, pulled back from the
 * connected account (AGL-1554, by the AGL-1794 policy).
 *
 * Marketplace sales are destination charges on the platform account, so the
 * disputed funds and the dispute fee are debited from the PLATFORM's balance
 * while the seller keeps the `transfer_data[amount]` they were paid — a
 * seller paid in full for a sale the buyer's bank took back, with Aglyn out
 * the principal. AGL-1794 decided this allocation for commerce orders and it
 * carries over unchanged: the seller eats their share, by a
 * `transfers/{id}/reversals` call for the portion that was actually
 * transferred; the platform still eats Stripe's dispute fee, deliberately.
 *
 * PROPORTIONAL, NEVER MORE: `disputedCents × transfer.amount ÷
 * charge.amount`, FLOORED, then capped at what the transfer has left
 * (`amount − amount_reversed`) — a transfer partially reversed by a
 * dashboard refund cannot be pulled below its own remainder from here. The
 * reversal CAN drive the connected account negative, which Stripe recovers
 * from future payouts.
 *
 * IDEMPOTENT BY THE PURCHASE DOCUMENT, with the transfer itself as the crash
 * window's backstop — the reverseSellerShare scheme from the commerce
 * webhook, applied to `marketplacePurchases/{sessionId}`:
 * `reversedTransferCents` present (0 included) means this step settled, and
 * a redelivery returns before any Stripe call; a delivery killed between the
 * POST landing and the record writing is healed by ADOPTING the reversal the
 * transfer already carries (`metadata.disputeId`); and the POST's
 * `Idempotency-Key` hands a racing delivery Stripe's stored response rather
 * than a second reversal.
 *
 * DEFINITIVE failures settle `reversedTransferCents: 0` and DO NOT throw —
 * no redelivery fixes a charge with no transfer, and a throw propagates into
 * a 500 Stripe redelivers forever. TRANSIENT failures (429/5xx/network)
 * throw on purpose: the marker is still unset, so the redelivery IS the
 * retry. A missing STRIPE_SECRET_KEY neither settles nor throws: the
 * revocation half already landed, and the redelivery retries the reversal
 * once a key is present.
 */
async function reverseMarketplaceSellerShare(
  purchaseRef: FirebaseFirestore.DocumentReference,
  dispute: any,
): Promise<void> {
  const disputeId = String(dispute?.id ?? '')
  if (!disputeId) return
  const snapshot = await purchaseRef.get()
  if (!snapshot.exists) return
  // The settle marker — see the doc comment. 0 counts.
  if (snapshot.get('reversedTransferCents') != null) return
  const disputedCents = Math.round(Number(dispute?.amount ?? 0))
  if (!(disputedCents > 0)) return
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Marketplace transfer reversal skipped: STRIPE_SECRET_KEY is not set (AGL-1554)',
    )
    return
  }

  /** Settles the step exactly once, whatever it found. */
  const settle = async (
    reversedTransferCents: number,
    transferReversalId: string | null,
  ): Promise<void> => {
    const fresh = await purchaseRef.get()
    if (!fresh.exists || fresh.get('reversedTransferCents') != null) return
    await purchaseRef.set(
      {
        reversedTransferCents,
        ...(transferReversalId ? { transferReversalId } : {}),
      },
      { merge: true },
    )
  }

  const chargeId = String(dispute?.charge ?? '')
  if (!chargeId) {
    console.error('Marketplace dispute carries no charge; share not reversed', {
      disputeId,
    })
    await settle(0, null)
    return
  }
  const charge = await stripeGet(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    stripeKey,
  )
  if (!charge.ok) {
    if (isTransientStripeStatus(charge.status)) {
      throw new Error(
        `Stripe charge read failed (${charge.status}) for marketplace dispute ${disputeId}`,
      )
    }
    console.error(
      'Stripe refused the charge read; marketplace share not reversed',
      charge.body?.error,
    )
    await settle(0, null)
    return
  }
  const transferId = String(charge.body?.transfer ?? '')
  const chargeAmountCents = Math.round(Number(charge.body?.amount ?? 0))
  if (!transferId || !(chargeAmountCents > 0)) {
    console.error(
      'No transfer on the disputed marketplace charge; share not reversed',
      { disputeId, chargeId },
    )
    await settle(0, null)
    return
  }
  const transfer = await stripeGet(
    `https://api.stripe.com/v1/transfers/${transferId}`,
    stripeKey,
  )
  if (!transfer.ok) {
    if (isTransientStripeStatus(transfer.status)) {
      throw new Error(
        `Stripe transfer read failed (${transfer.status}) for marketplace dispute ${disputeId}`,
      )
    }
    console.error(
      'Stripe refused the transfer read; marketplace share not reversed',
      transfer.body?.error,
    )
    await settle(0, null)
    return
  }
  // The crash window's backstop: the POST landed on a previous delivery and
  // the record did not. Adopt what exists rather than creating a second one.
  const existing = ((transfer.body?.reversals?.data ?? []) as any[]).find(
    (item) => String(item?.metadata?.disputeId ?? '') === disputeId,
  )
  if (existing) {
    await settle(
      Math.round(Number(existing.amount ?? 0)),
      String(existing.id ?? ''),
    )
    return
  }
  const transferCents = Math.round(Number(transfer.body?.amount ?? 0))
  const alreadyReversedCents = Math.round(
    Number(transfer.body?.amount_reversed ?? 0),
  )
  const remainingCents = Math.max(0, transferCents - alreadyReversedCents)
  const shareCents = Math.min(
    Math.floor((disputedCents * transferCents) / chargeAmountCents),
    remainingCents,
  )
  if (!(shareCents > 0)) {
    console.error(
      'Transfer has nothing left to reverse; marketplace share not reversed',
      { disputeId, transferId, transferCents, alreadyReversedCents },
    )
    await settle(0, null)
    return
  }
  const params = new URLSearchParams({
    amount: String(shareCents),
    'metadata[disputeId]': disputeId,
    'metadata[purchaseId]': purchaseRef.id,
  })
  const response = await fetch(
    `https://api.stripe.com/v1/transfers/${transferId}/reversals`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `dispute-reversal-${disputeId}`,
      },
      body: params.toString(),
    },
  )
  const reversal = await response.json().catch(() => null)
  if (!response.ok) {
    if (isTransientStripeStatus(response.status)) {
      throw new Error(
        `Stripe transfer reversal failed (${response.status}) for marketplace dispute ${disputeId}`,
      )
    }
    console.error(
      'Stripe refused the marketplace transfer reversal',
      reversal?.error,
    )
    await settle(0, null)
    return
  }
  await settle(
    Math.round(Number(reversal?.amount ?? shareCents)),
    String(reversal?.id ?? ''),
  )
}

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
  // Connect readiness, kept fresh (AGL-1997) — the publisher twin of the
  // commerce sync. The seller panel reads `stripeChargesEnabled` /
  // `stripePayoutsEnabled` off this document, and before this nothing but the
  // publisher reopening the connect route ever refreshed either. Same early
  // return: `account.updated` shares nothing with the purchase sections below.
  if (type === 'account.updated') {
    await syncConnectAccountStatus('publisherProfiles', object)
    return
  }

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

  // Chargebacks (AGL-1554): the AGL-1546 refund arriving by the bank's
  // door. `charge.dispute.*` for tenant storefront orders and platform
  // subscriptions arrives on this endpoint too — the payment-intent join
  // below simply finds no purchase for those and this section stays out of
  // their way, exactly as the refund branch does.
  //
  // A dispute is NOT a refund, and the states matter (the AGL-1554
  // analysis): `created` can still be WON, and nothing un-revokes, so it
  // only flags the purchase for staff visibility. Money moves exclusively
  // on `closed` + `status: 'lost'`: the buyer's entitlement goes the way
  // the money went (`refundedAt`, the field the install gate reads as
  // absent-purchase — final outcomes only), GA nets the AGL-1639 purchase
  // out in the AGL-1850 accounting (platform net, guarded by the same
  // `refundedAt` read the refund branch uses), and the seller's share
  // comes back by the AGL-1794 policy. `won` and `warning_closed` record
  // the outcome and move nothing.
  if (type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
    const disputeId = String(object?.id ?? '')
    const paymentIntentId = String(object?.payment_intent ?? '')
    if (disputeId && paymentIntentId) {
      const firestore = firebaseAdmin.app().firestore()
      const purchases = await firestore
        .collection('marketplacePurchases')
        .where('paymentIntentId', '==', paymentIntentId)
        .limit(1)
        .get()
      if (!purchases.empty) {
        const purchase = purchases.docs[0]
        const status = String(object?.status ?? '')
        if (type === 'charge.dispute.created') {
          await purchase.ref.set(
            {
              disputeId,
              disputeStatus: status || 'needs_response',
              disputeOpenedAt:
                firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        } else if (status === 'lost') {
          // Read BEFORE the stamp, the refund branch's own GA guard: a
          // purchase already refunded (or a redelivery that slipped the
          // route's event claim) reports nothing a second time.
          const alreadyRefunded = Boolean(purchase.get('refundedAt'))
          await purchase.ref.set(
            {
              disputeId,
              disputeStatus: status,
              refundedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              refundedCents: Math.round(Number(object?.amount ?? 0)),
            },
            { merge: true },
          )
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
                stripeCustomerId: String(purchase.get('buyerUid') ?? ''),
              }).catch(() => undefined)
            }
          }
          // AFTER the revocation, so the entitlement never stays live
          // because a Stripe read failed: this half throws on transient
          // failures (the redelivery is the retry, and everything above is
          // idempotent under it) and settles definitively otherwise.
          await reverseMarketplaceSellerShare(purchase.ref, object)
        } else {
          // `won` or `warning_closed`: the money stayed, the entitlement
          // stays, and the outcome lands on the record for whoever flagged
          // it at `created`.
          await purchase.ref.set(
            { disputeId, disputeStatus: status },
            { merge: true },
          )
        }
      }
    }
  }
}
