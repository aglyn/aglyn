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

// `after()`, never a bare `void promise` (AGL-2327). This handler runs inside
// the console's `/api/billing/webhook` invocation, which AGL-1133 measured on
// production is frozen the moment the response is sent — so fire-and-forget
// work scheduled here simply does not run. The console's own route was
// migrated for that reason (AGL-2346) and this one, in the same invocation,
// was not: marketplace revenue and refunds were reporting to nothing, which is
// the surviving half of "four server events ship to nothing" now that the
// Measurement Protocol credentials have landed (2026-08-17).
import { after } from 'next/server'

import type { BillingWebhookHandler } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  sendGa4Purchase,
  sendGa4Refund,
  clearConnectPayoutFailure,
  recordConnectPayoutFailure,
  syncConnectAccountStatus,
} from '@aglyn/tenant-data-admin'

/** Stripe failures a redelivery can actually fix. */
function isTransientStripeStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * THE BUYER'S TAX JURISDICTION, from the session Stripe computed the tax on.
 *
 * Aglyn is a marketplace facilitator, so the tax on a facilitated sale is
 * Aglyn's to collect and remit — and a return reports it BY STATE. Checkout
 * already collects everything needed for that (`billing_address_collection:
 * 'required'`, `automatic_tax[enabled]`), and Stripe states the address it
 * computed from back on `customer_details.address`. Nothing read it, so every
 * facilitated sale reached `tx-return.ts` with no jurisdiction and the whole
 * of the marketplace tax could be stated only as a platform total attributable
 * to no state.
 *
 * COUNTRY AND STATE ONLY, and deliberately narrower than the storefront twin.
 * `StorefrontTaxRow` keeps `city` and `postalCode` beside them; the return
 * reads neither, on either collection — it keys every jurisdiction bucket
 * `COUNTRY-STATE`. A purchase document already names `buyerUid`, so anything
 * stored here is personal data by association, and a street-grained address a
 * filing cannot use is data held for no purpose. The two fields kept are the
 * two the return reads.
 *
 * Null when the session states no country. An unstated jurisdiction is COUNTED
 * by the return (`rowsMissingJurisdiction`) and never inferred: a jurisdiction
 * reconstructed after the fact is a guess handed to a tax authority as a fact.
 */
function buyerTaxJurisdiction(
  object: any,
): { country: string; state: string | null } | null {
  const address = object?.customer_details?.address
  const country =
    typeof address?.country === 'string' ? address.country.trim() : ''
  if (!country) return null
  const state = typeof address?.state === 'string' ? address.state.trim() : ''
  return { country, state: state || null }
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
 * The seller's share of a LOST marketplace dispute — or of a REFUND
 * (AGL-1995) — pulled back from the connected account (AGL-1554, by the
 * AGL-1794 policy).
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
 * PROPORTIONAL, NEVER MORE: `causeAmountCents × transfer.amount ÷
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
 * transfer already carries (`metadata.disputeId` / `metadata.refundId`);
 * and the POST's
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
 *
 * WHY THE SAME FUNCTION SERVES BOTH DOORS (AGL-1995).
 *
 * The refund door reached Sep 1 never calling this at all: `charge.refunded`
 * revoked the entitlement and sent the GA hit while the publisher kept their
 * 80% and Aglyn absorbed the whole gross. A second, parallel reversal
 * function is exactly the shape AGL-1994 was filed about — the marketplace
 * and commerce Connect twins drifting because a fix landed on one — so the
 * cause is a parameter here rather than a copy.
 *
 * WHAT DOES *NOT* CARRY OVER FROM COMMERCE. `refund.ts` pairs
 * `reverse_transfer` with `refund_application_fee: 'true'`, and the AGL-1794
 * note warns that flag is a one-parameter policy switch. **It has no meaning
 * on this path.** Marketplace checkout deliberately pays the seller with a
 * FIXED `payment_intent_data[transfer_data][amount]` and NOT
 * `application_fee_amount` (checkout.ts:177-181 — the fee form would transfer
 * `amount_total − fee`, and `amount_total` includes the tax the platform
 * owes). There is therefore no application-fee object on a marketplace charge
 * to refund, and `transfer.amount` is the seller's share, NOT `charge.amount`
 * as it is on the commerce side. The proportional maths below already models
 * that correctly, which is why the refund door can reuse it unchanged.
 *
 * The resulting allocation on a full refund is the same one commerce reaches
 * by the opposite parameter: the buyer is made whole, the seller returns
 * their share, and Aglyn gives back its own commission and the tax it
 * collected. A LOST DISPUTE still differs on purpose — the platform keeps its
 * cut there, per AGL-1794 — and that difference survives because the two call
 * sites pass different causes, not because they run different code.
 *
 * ONE PULL-BACK PER PURCHASE. Both doors share the `reversedTransferCents`
 * settle marker, so a refund following a lost dispute (or the reverse) finds
 * the share already recovered and returns before any Stripe call. The seller
 * cannot be debited twice for one sale.
 */
interface SellerShareReversalCause {
  /** Which door — decides the metadata key and the idempotency key. */
  kind: 'dispute' | 'refund'
  /** Stripe id of the dispute or the refunded charge. */
  id: string
  /** Cents going back to the buyer. */
  amountCents: number
  /** The charge whose transfer is being pulled back. */
  chargeId: string
}

async function reverseMarketplaceSellerShare(
  purchaseRef: FirebaseFirestore.DocumentReference,
  cause: SellerShareReversalCause,
): Promise<void> {
  const causeId = String(cause?.id ?? '')
  if (!causeId) return
  // Kept as `disputeId` on the wire for `kind: 'dispute'` so reversals
  // stamped before AGL-1995 are still found and ADOPTED by the crash-window
  // backstop below. A refund uses its own key for the same reason.
  const metadataKey = cause.kind === 'dispute' ? 'disputeId' : 'refundId'
  const snapshot = await purchaseRef.get()
  if (!snapshot.exists) return
  // The settle marker — see the doc comment. 0 counts.
  if (snapshot.get('reversedTransferCents') != null) return
  const causeAmountCents = Math.round(Number(cause?.amountCents ?? 0))
  if (!(causeAmountCents > 0)) return
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Marketplace transfer reversal skipped: STRIPE_SECRET_KEY is not set (AGL-1554)',
    )
    return
  }

  /**
   * Settles the step exactly once, whatever it found.
   *
   * A settle of ZERO is not the same event as a settle of the full share, and
   * until AGL-2140 the document could not tell them apart (AGL-2140). Six
   * paths below abandon the reversal for a DEFINITIVE reason — no charge id,
   * Stripe refusing the charge read, no transfer on the charge, Stripe
   * refusing the transfer read, nothing left to reverse, Stripe refusing the
   * reversal itself — and each wrote `reversedTransferCents: 0`, which the
   * short-circuit at the top of this function then honours forever. The only
   * other trace was a `console.error`.
   *
   * A Stripe 4xx is one of those definitive reasons: `balance_insufficient` on
   * a connected account is a **400**, not a 5xx, so it does not throw and does
   * not redeliver. The publisher's share was therefore forfeited permanently,
   * silently, and with nothing queryable to find it by afterwards.
   *
   * Settling stays — re-running these paths would eventually double-debit a
   * seller, which is worse. What changes is that an abandoned reversal now
   * says so ON THE DOCUMENT: `reversalFailedAt`, a machine-readable
   * `reversalFailedReason`, and `reversalOwedCents` when the amount is known.
   * `where('reversalFailedAt', '!=', null)` is then the recovery queue.
   */
  const settle = async (
    reversedTransferCents: number,
    transferReversalId: string | null,
    /** Why nothing (or less than the cause) was reversed. Omit on success. */
    failure?: { reason: string; owedCents?: number },
  ): Promise<void> => {
    const fresh = await purchaseRef.get()
    if (!fresh.exists || fresh.get('reversedTransferCents') != null) return
    if (failure) {
      console.error('Marketplace seller share NOT reversed — recorded for recovery', {
        purchaseId: purchaseRef.id,
        kind: cause.kind,
        causeId,
        reason: failure.reason,
        owedCents: failure.owedCents ?? null,
      })
    }
    await purchaseRef.set(
      {
        reversedTransferCents,
        ...(transferReversalId ? { transferReversalId } : {}),
        ...(failure
          ? {
              reversalFailedAt:
                firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              reversalFailedReason: failure.reason,
              reversalFailedCause: cause.kind,
              ...(failure.owedCents != null
                ? { reversalOwedCents: failure.owedCents }
                : {}),
            }
          : {}),
      },
      { merge: true },
    )
  }

  const chargeId = String(cause?.chargeId ?? '')
  if (!chargeId) {
    await settle(0, null, { reason: 'no-charge-on-cause' })
    return
  }
  const charge = await stripeGet(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    stripeKey,
  )
  if (!charge.ok) {
    if (isTransientStripeStatus(charge.status)) {
      throw new Error(
        `Stripe charge read failed (${charge.status}) for marketplace ${cause.kind} ${causeId}`,
      )
    }
    console.error('Stripe refused the charge read', charge.body?.error)
    await settle(0, null, { reason: 'charge-read-refused' })
    return
  }
  const transferId = String(charge.body?.transfer ?? '')
  const chargeAmountCents = Math.round(Number(charge.body?.amount ?? 0))
  if (!transferId || !(chargeAmountCents > 0)) {
    await settle(0, null, { reason: 'no-transfer-on-charge' })
    return
  }
  const transfer = await stripeGet(
    `https://api.stripe.com/v1/transfers/${transferId}`,
    stripeKey,
  )
  if (!transfer.ok) {
    if (isTransientStripeStatus(transfer.status)) {
      throw new Error(
        `Stripe transfer read failed (${transfer.status}) for marketplace ${cause.kind} ${causeId}`,
      )
    }
    console.error('Stripe refused the transfer read', transfer.body?.error)
    await settle(0, null, { reason: 'transfer-read-refused' })
    return
  }
  // The crash window's backstop: the POST landed on a previous delivery and
  // the record did not. Adopt what exists rather than creating a second one.
  const existing = ((transfer.body?.reversals?.data ?? []) as any[]).find(
    (item) => String(item?.metadata?.[metadataKey] ?? '') === causeId,
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
    Math.floor((causeAmountCents * transferCents) / chargeAmountCents),
    remainingCents,
  )
  if (!(shareCents > 0)) {
    // Not necessarily a fault — an earlier cause may already have pulled the
    // whole transfer back — so `owedCents` is deliberately 0 rather than
    // absent: nothing is owed, and the row says so instead of leaving the
    // amount unknown.
    await settle(0, null, { reason: 'transfer-fully-reversed', owedCents: 0 })
    return
  }
  const params = new URLSearchParams({
    amount: String(shareCents),
    [`metadata[${metadataKey}]`]: causeId,
    'metadata[purchaseId]': purchaseRef.id,
  })
  const response = await fetch(
    `https://api.stripe.com/v1/transfers/${transferId}/reversals`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `${cause.kind}-reversal-${causeId}`,
      },
      body: params.toString(),
    },
  )
  const reversal = await response.json().catch(() => null)
  if (!response.ok) {
    if (isTransientStripeStatus(response.status)) {
      throw new Error(
        `Stripe transfer reversal failed (${response.status}) for marketplace ${cause.kind} ${causeId}`,
      )
    }
    // THE ONE THAT COSTS REAL MONEY. A definitive 4xx here — including a
    // `balance_insufficient` on the publisher's account, which is a 400 — used
    // to forfeit the whole share with only a log line.
    console.error('Stripe refused the marketplace transfer reversal', reversal?.error)
    await settle(0, null, {
      reason: 'reversal-refused',
      owedCents: shareCents,
    })
    return
  }
  await settle(
    Math.round(Number(reversal?.amount ?? shareCents)),
    String(reversal?.id ?? ''),
  )
}

/**
 * THE PUBLISHER'S SHARE OF A *PARTIAL* REFUND, PULLED BACK (AGL-2299).
 *
 * WHAT WAS WRONG. `charge.refunded` fires on EVERY refund; `object.refunded`
 * is true only once the whole charge is gone. Everything above this function
 * is gated on that flag, so a partial refund did nothing at all — no
 * reversal, no record, not even a log line — and the note beside the branch
 * said so deliberately: "a partial refund is a concession the ledger's split
 * cannot decompose".
 *
 * That premise is false, and it is expensive. `reverseMarketplaceSellerShare`
 * decomposes exactly this, proportionally, and has since AGL-1554. What the
 * old branch actually did was hand the entire concession to Aglyn: on a $100
 * sale at a 20% take rate the platform holds $20 plus the tax it owes the
 * state, and a $50 goodwill refund is paid out of the PLATFORM's balance —
 * the publisher's $80 already left on the destination transfer. Aglyn is
 * $30 down and the publisher is untouched. Any partial refund larger than the
 * take rate loses money, which is most of them.
 *
 * The publisher agreement §8.4 is not ambiguous about this: *"You are
 * responsible for refunds, chargebacks, and disputes on your sales. Aglyn may
 * reverse or withhold amounts corresponding to refunded, disputed, or
 * fraudulent transactions."* A partial refund is a refunded amount.
 *
 * THE ENTITLEMENT IS NOT TOUCHED, and that part of the old comment stands: a
 * partial refund is a concession, not an un-buy. No `refundedAt`, so
 * `hasLivePurchase` still says the buyer owns it, and no GA4 `refund` — that
 * event nets the WHOLE transaction out of the platform-net accounting
 * (AGL-1850), which a partial refund did not do. Only the money moves.
 *
 * WHY THIS IS A SECOND FUNCTION RATHER THAN A FLAG ON THE FIRST.
 * `reverseMarketplaceSellerShare` is ONE-SHOT by design — `reversedTransferCents`
 * present means "this purchase's pull-back has settled", and that marker is
 * what stops a refund following a lost dispute from debiting a publisher
 * twice. Partial refunds are the opposite shape: there can be several, and
 * each must add to what came back. Teaching one function both disciplines is
 * how the settle marker stops meaning anything.
 *
 * IDEMPOTENT WITHOUT A MARKER, because Stripe already keeps the ledger.
 * The target is derived from the charge's CUMULATIVE `amount_refunded`, and
 * what has already come back is `transfer.amount_reversed` — Stripe's own
 * number, not ours:
 *
 *     target    = floor(amount_refunded × transfer.amount ÷ charge.amount)
 *     toReverse = clamp(target, 0, transfer.amount) − transfer.amount_reversed
 *
 * A redelivery recomputes the same target, finds `amount_reversed` already
 * there, and reverses nothing. Three partial refunds converge on the right
 * total whatever order they arrive in. And it composes with the one-shot path
 * in both directions: a later FULL refund computes
 * `min(transfer.amount, remaining)` and takes only the remainder, while a
 * dispute takes its own proportional slice of what is left.
 *
 * FAILURES DO NOT SETTLE ANYTHING. Transient (429/5xx/network) throws so the
 * redelivery is the retry, exactly as the one-shot path does. A definitive
 * 4xx — `balance_insufficient` on a publisher's account is a 400 — records
 * itself in AGL-2140's existing recovery queue (`reversalFailedAt`,
 * `reversalFailedReason`, `reversalOwedCents`) and returns 200 so the endpoint
 * does not redeliver forever. Nothing is permanently forfeited by that: the
 * next partial refund on the same charge recomputes the target from scratch
 * and picks the shortfall back up.
 */
async function reverseMarketplacePartialRefundShare(
  purchaseRef: FirebaseFirestore.DocumentReference,
  chargeId: string,
): Promise<void> {
  if (!chargeId) return
  const snapshot = await purchaseRef.get()
  if (!snapshot.exists) return
  // The one-shot path already settled this purchase — a lost dispute, or a
  // full refund that landed first. Its marker means the pull-back is closed.
  if (snapshot.get('reversedTransferCents') != null) return
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Marketplace partial-refund reversal skipped: STRIPE_SECRET_KEY is not set (AGL-2299)',
    )
    return
  }
  // The charge is RE-READ rather than taken from the event, for the same
  // reason the one-shot path re-reads it: the event is a snapshot, and the
  // number that decides this reversal is the charge's CUMULATIVE
  // `amount_refunded`. A redelivery days later, or a drain of a parked
  // partial, must converge on what is true now — not on what was true when
  // the event was minted. It also means an API version that trims `transfer`
  // out of the webhook payload cannot silently turn this into a no-op.
  const charge = await stripeGet(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    stripeKey,
  )
  if (!charge.ok) {
    if (isTransientStripeStatus(charge.status)) {
      throw new Error(
        `Stripe charge read failed (${charge.status}) for marketplace partial refund on ${chargeId}`,
      )
    }
    console.error('Stripe refused the charge read', charge.body?.error)
    return
  }
  const chargeAmountCents = Math.round(Number(charge.body?.amount ?? 0))
  const refundedCents = Math.round(Number(charge.body?.amount_refunded ?? 0))
  if (!(chargeAmountCents > 0) || !(refundedCents > 0)) return
  const transferId = String(charge.body?.transfer ?? '')
  if (!transferId) {
    // No destination transfer means no seller share to pull back — a
    // marketplace charge always has one, so this is a charge we do not own.
    return
  }
  const transfer = await stripeGet(
    `https://api.stripe.com/v1/transfers/${transferId}`,
    stripeKey,
  )
  if (!transfer.ok) {
    if (isTransientStripeStatus(transfer.status)) {
      throw new Error(
        `Stripe transfer read failed (${transfer.status}) for marketplace partial refund on ${chargeId}`,
      )
    }
    console.error('Stripe refused the transfer read', transfer.body?.error)
    await purchaseRef.set(
      {
        partialRefundedCents: refundedCents,
        reversalFailedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        reversalFailedReason: 'transfer-read-refused',
        reversalFailedCause: 'partial-refund',
      },
      { merge: true },
    )
    return
  }
  const transferCents = Math.round(Number(transfer.body?.amount ?? 0))
  const alreadyReversedCents = Math.round(
    Number(transfer.body?.amount_reversed ?? 0),
  )
  const targetCents = Math.min(
    transferCents,
    Math.floor((refundedCents * transferCents) / chargeAmountCents),
  )
  const toReverseCents = targetCents - alreadyReversedCents
  if (!(toReverseCents > 0)) {
    // Already square — a redelivery, or an earlier cause that took more than
    // this refund's proportional slice. Record what the buyer has had back so
    // the seller panel and the ledger agree with Stripe.
    await purchaseRef.set(
      {
        partialRefundedCents: refundedCents,
        partialReversedTransferCents: alreadyReversedCents,
      },
      { merge: true },
    )
    return
  }
  const response = await fetch(
    `https://api.stripe.com/v1/transfers/${transferId}/reversals`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Derived from the charge AND the cumulative target, so a redelivery
        // of the same event replays Stripe's stored response while a genuinely
        // larger second refund gets its own call. Belt and braces: the
        // `amount_reversed` read above already turns a redelivery into a
        // no-op, and this closes the window where the POST landed and our
        // record did not.
        'Idempotency-Key': `partial-reversal-${chargeId}-${targetCents}`,
      },
      body: new URLSearchParams({
        amount: String(toReverseCents),
        'metadata[partialRefundOfCharge]': chargeId,
        'metadata[purchaseId]': purchaseRef.id,
      }).toString(),
    },
  )
  const reversal = await response.json().catch(() => null)
  if (!response.ok) {
    if (isTransientStripeStatus(response.status)) {
      throw new Error(
        `Stripe partial transfer reversal failed (${response.status}) on ${chargeId}`,
      )
    }
    console.error(
      'Marketplace partial-refund seller share NOT reversed — recorded for recovery (AGL-2299)',
      { purchaseId: purchaseRef.id, chargeId, owedCents: toReverseCents },
    )
    await purchaseRef.set(
      {
        partialRefundedCents: refundedCents,
        partialReversedTransferCents: alreadyReversedCents,
        reversalFailedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        reversalFailedReason: 'reversal-refused',
        reversalFailedCause: 'partial-refund',
        reversalOwedCents: toReverseCents,
      },
      { merge: true },
    )
    return
  }
  await purchaseRef.set(
    {
      partialRefundedCents: refundedCents,
      partialReversedTransferCents:
        alreadyReversedCents + Math.round(Number(reversal?.amount ?? toReverseCents)),
      ...(reversal?.id ? { partialTransferReversalId: String(reversal.id) } : {}),
    },
    { merge: true },
  )
}

/**
 * WHERE A REFUND THAT ARRIVED TOO EARLY WAITS (AGL-2148).
 *
 * THE WINDOW IS REAL, not exotic. `checkout.session.completed` is what writes
 * `marketplacePurchases/{sessionId}`, and that delivery RETRIES: this endpoint
 * 500s on every transient Stripe failure raised in this file and on any throw
 * from a sibling plugin handler, and Stripe then redelivers for up to three
 * days. A dashboard refund issued inside that window joins on the payment
 * intent, finds nothing, and — before this — the branch simply ended. No
 * `else`. The buyer got their money, the publisher kept their 80%, Aglyn ate
 * the gross, and `hasLivePurchase` saw no `refundedAt`, so the refunded buyer
 * kept the install forever.
 *
 * WHY NOT SIMPLY THROW so Stripe redelivers the refund. Because
 * `charge.refunded` and `charge.dispute.*` arrive on this same endpoint for
 * storefront orders and subscription charges, whose payment intents will never
 * match a marketplace purchase. Throwing on "not found" would 500 the webhook
 * for every non-marketplace refund, and the route drops its idempotency claim
 * on a throw — so the commerce and bookings handlers' non-idempotent effects
 * would re-run. The containment would cost more than the defect.
 *
 * SO THE EVENT IS PARKED, and the session landing drains it. Keyed by PAYMENT
 * INTENT, which is the only id the refund door, the dispute door and the
 * session landing all carry: the drain is one `get()` on a known document id,
 * with no query and no composite index.
 *
 * NOTHING IS PARKED SPECULATIVELY. Both doors gate the write on a
 * marketplace discriminator (`metadata.type`, stamped on the PaymentIntent at
 * checkout — see checkout.ts), so a commerce refund writes no orphan at all.
 * That is why this store needs no TTL and no sweeper: a document here means a
 * marketplace purchase is mid-flight, and the session landing removes it.
 */
const REFUND_ORPHAN_COLLECTION = 'marketplaceRefundOrphans'

/** A cause plus everything the revocation and the GA hit need to replay it. */
interface RefundOutcomeCause extends SellerShareReversalCause {
  /** The join key, and the orphan document id. */
  paymentIntentId: string
  /** GA `refund` currency — the event's, never assumed. */
  currency: string
  /** Stripe customer for the GA hit; falls back to the buyer uid. */
  stripeCustomerId: string
}

/**
 * What may be parked when the purchase document does not exist yet.
 *
 * `partial-refund` (AGL-2299) is deliberately NOT a `SellerShareReversalCause`
 * kind: it never revokes, never reports to GA, and settles cumulatively
 * against Stripe's own `amount_reversed` rather than through the one-shot
 * marker. It shares only the store and the drain trigger.
 */
type ParkedCause = Omit<RefundOutcomeCause, 'kind'> & {
  kind: RefundOutcomeCause['kind'] | 'partial-refund'
}

/**
 * The three effects a full refund or a LOST dispute applies to a purchase:
 * revoke, report, pull the seller's share back.
 *
 * ONE function for three call sites — the refund door, the dispute door, and
 * the orphan drain — deliberately, and it is the AGL-1994 lesson again: the
 * drain must apply *the same* effects the door would have, and a second copy
 * of them is how the two drift. The drain therefore cannot forget the GA hit
 * or the reversal, because it is not in a position to.
 *
 * IDEMPOTENT AT EVERY LAYER. `refundedAt` read BEFORE the stamp is the GA
 * guard (a redelivery reports nothing twice); `reversedTransferCents` is the
 * reversal's settle marker, so a redelivery — or a drain running after the
 * door already ran — returns before any Stripe call; and the reversal POST
 * carries `Idempotency-Key: <kind>-reversal-<causeId>`, which is the SAME key
 * either path would have used because it is derived from the cause, not from
 * who is applying it. A drained refund and a redelivered `charge.refunded`
 * are therefore indistinguishable to Stripe, and the publisher cannot be
 * debited twice.
 */
async function applyMarketplaceRefundOutcome(
  purchaseRef: FirebaseFirestore.DocumentReference,
  cause: RefundOutcomeCause,
  /** Dispute-only fields stamped in the same write. */
  extraStamp: Record<string, unknown> = {},
): Promise<void> {
  const snapshot = await purchaseRef.get()
  if (!snapshot.exists) return
  // Read BEFORE the stamp: `refundedAt` doubles as the GA guard, so a
  // redelivery that slips past the route's event claim finds the purchase
  // already refunded and reports nothing a second time.
  const alreadyRefunded = Boolean(snapshot.get('refundedAt'))
  await purchaseRef.set(
    {
      ...extraStamp,
      refundedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      refundedCents: cause.amountCents,
    },
    { merge: true },
  )
  // GA4 `refund` (AGL-1850) — the reversal of the AGL-1639 purchase, in the
  // SAME accounting. The purchase reported the platform NET (gross − tax −
  // transfer), so the refund must reverse that number: refunding the
  // tax-inclusive gross would net MORE out of GA than the sale ever put in.
  // Fire-and-forget, after the stamp: an analytics failure must never
  // un-claim a Stripe event.
  if (!alreadyRefunded) {
    const grossCents = Number(snapshot.get('amountCents') ?? 0)
    const taxCents = Number(snapshot.get('taxCents') ?? 0)
    const sellerCents = Number(snapshot.get('transferCents') ?? 0)
    const netCents = grossCents - taxCents - sellerCents
    if (netCents > 0) {
      after(() => sendGa4Refund({
        transactionId: String(purchaseRef.id),
        value: netCents / 100,
        currency: cause.currency,
        items: [],
        stripeCustomerId:
          cause.stripeCustomerId || String(snapshot.get('buyerUid') ?? ''),
      }).catch(() => undefined))
    }
  }
  // AFTER the revocation, so the entitlement never stays live because a
  // Stripe read failed: this half throws on transient failures (the
  // redelivery is the retry, and everything above is idempotent under it) and
  // settles definitively otherwise.
  await reverseMarketplaceSellerShare(purchaseRef, cause)
}

/**
 * Parks a cause whose purchase document does not exist yet.
 *
 * FIRST CAUSE WINS. The document is not merged over: a redelivery of the same
 * refund would otherwise move `createdAt`, and the (vanishingly unlikely)
 * refund-then-dispute pair inside one window would otherwise blend into a
 * chimera carrying one cause's id and the other's amount. The first cause is
 * the one that revoked, and the reversal settle marker means only one
 * pull-back can happen regardless of which is replayed.
 */
async function recordRefundOrphan(
  firestore: FirebaseFirestore.Firestore,
  cause: ParkedCause,
): Promise<void> {
  if (!cause.paymentIntentId || !cause.id) return
  const orphanRef = firestore
    .collection(REFUND_ORPHAN_COLLECTION)
    .doc(cause.paymentIntentId)
  const parked = await orphanRef.get()
  // FIRST CAUSE WINS — with one exception (AGL-2299). A parked
  // `partial-refund` is strictly weaker than a full refund or a lost dispute:
  // it moves a slice of the seller's share and nothing else. If the same
  // charge is then refunded in full inside the same window, the stronger
  // cause must replace it, or the drain would pull back a slice and leave the
  // buyer entitled to content they have been fully refunded for. The reverse
  // never happens: a fully refunded charge cannot take a partial afterwards.
  if (parked.exists && !(
    parked.get('kind') === 'partial-refund' && cause.kind !== 'partial-refund'
  )) {
    return
  }
  await orphanRef.set(
    {
      kind: cause.kind,
      id: cause.id,
      paymentIntentId: cause.paymentIntentId,
      amountCents: cause.amountCents,
      chargeId: cause.chargeId,
      currency: cause.currency,
      stripeCustomerId: cause.stripeCustomerId,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  // Loud on purpose: this is money in flight. If the matching session never
  // lands (a buyer who abandoned checkout cannot be refunded, so in practice
  // it always does), the row is the only trace, and it is queryable.
  console.error(
    'Marketplace refund landed before its purchase — parked for the session handler (AGL-2148)',
    {
      kind: cause.kind,
      causeId: cause.id,
      paymentIntentId: cause.paymentIntentId,
      amountCents: cause.amountCents,
    },
  )
}

/**
 * Applies — and removes — a cause parked before this purchase existed.
 *
 * WHETHER THE SESSION PATH MAY REVOKE AND REVERSE FOR A CAUSE IT DID NOT
 * RECEIVE: yes, and it is not really a choice. The alternative is a purchase
 * document that reads as live for money the buyer already got back — a free
 * install and a publisher paid for a sale that was undone.
 *
 * THE DELETE IS LAST, after the reversal returns. A transient Stripe failure
 * inside `reverseMarketplaceSellerShare` THROWS on purpose so the session
 * delivery 500s and Stripe redelivers; if the orphan were dropped first, that
 * redelivery would find nothing to replay and the reversal would be lost
 * permanently. Deleting after a DEFINITIVE settle is correct and deliberate:
 * that settle wrote `reversalFailedAt` / `reversalFailedReason` /
 * `reversalOwedCents` onto the purchase, so the money lands in AGL-2140's
 * existing recovery queue rather than in a second one invented here.
 */
async function drainMarketplaceRefundOrphan(
  firestore: FirebaseFirestore.Firestore,
  purchaseRef: FirebaseFirestore.DocumentReference,
  paymentIntentId: string,
): Promise<void> {
  if (!paymentIntentId) return
  const orphanRef = firestore
    .collection(REFUND_ORPHAN_COLLECTION)
    .doc(paymentIntentId)
  const orphan = await orphanRef.get()
  if (!orphan.exists) return
  const causeId = String(orphan.get('id') ?? '')
  const parkedKind = String(orphan.get('kind') ?? '')
  if (parkedKind === 'partial-refund') {
    // A partial refund never revokes and never reports, so it does not go
    // through `applyMarketplaceRefundOutcome` (AGL-2299). The charge is RE-READ
    // from Stripe rather than replayed from the parked amount: the target is
    // computed from the charge's cumulative `amount_refunded`, and by the time
    // this drains there may have been a second refund the parked document
    // never saw.
    // Throws on a transient Stripe failure, which leaves the orphan in place
    // for the redelivery — the delete below is exactly what must not happen
    // in that case, and it is why it is AFTER this await rather than before.
    await reverseMarketplacePartialRefundShare(
      purchaseRef,
      String(orphan.get('chargeId') ?? ''),
    )
    await orphanRef.delete()
    return
  }
  const kind = parkedKind === 'dispute' ? 'dispute' : 'refund'
  if (causeId) {
    await applyMarketplaceRefundOutcome(
      purchaseRef,
      {
        kind,
        id: causeId,
        paymentIntentId,
        amountCents: Math.round(Number(orphan.get('amountCents') ?? 0)),
        chargeId: String(orphan.get('chargeId') ?? ''),
        currency: String(orphan.get('currency') ?? 'usd'),
        stripeCustomerId: String(orphan.get('stripeCustomerId') ?? ''),
      },
      // A parked dispute is always a LOST one — the only dispute state that
      // moves money — so the outcome lands on the record too, exactly as the
      // dispute door would have stamped it.
      kind === 'dispute'
        ? { disputeId: causeId, disputeStatus: 'lost' }
        : {},
    )
  }
  await orphanRef.delete()
}

/**
 * A dispute has no metadata of ours to read — the event object is the DISPUTE,
 * not the charge — so the discriminator costs one Stripe read.
 *
 * Only ever reached when the payment-intent join came up empty, so a normal
 * marketplace dispute (purchase present) pays nothing for it, and a commerce
 * or subscription dispute pays one GET before being correctly ignored.
 * Disputes are rare enough for that to be the right trade against parking an
 * orphan for every chargeback on the platform.
 *
 * A FAILED READ DOES NOT THROW, deliberately, and this is the one place the
 * fix accepts a loss. Throwing would 500 the endpoint for a dispute we have
 * not established is ours — the exact blast radius that ruled out "just throw"
 * in the first place — and the route drops its idempotency claim on a throw.
 * So a marketplace dispute landing inside the purchase window WHILE the charge
 * read fails loses its orphan. It is logged, and it is two independent
 * unlikely events deep.
 */
async function recordDisputeOrphanIfMarketplace(
  firestore: FirebaseFirestore.Firestore,
  object: any,
  paymentIntentId: string,
): Promise<boolean> {
  const chargeId = String(object?.charge ?? '')
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!chargeId || !stripeKey) return false
  const charge = await stripeGet(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    stripeKey,
  )
  if (!charge.ok) {
    console.error(
      'Could not classify a dispute with no matching purchase — orphan NOT parked (AGL-2148)',
      { chargeId, paymentIntentId, status: charge.status },
    )
    return false
  }
  if (charge.body?.metadata?.type !== 'marketplace-purchase') return false
  await recordRefundOrphan(firestore, {
    kind: 'dispute',
    id: String(object?.id ?? ''),
    paymentIntentId,
    amountCents: Math.round(Number(object?.amount ?? 0)),
    chargeId,
    currency: String(object?.currency ?? 'usd'),
    stripeCustomerId: '',
  })
  // Parked, so it IS marketplace's — the route must not also alert on it
  // (AGL-2429). The three early exits above return false on purpose: two of
  // them mean "could not classify", and a dispute nobody could classify is
  // exactly what the route's unattributed alert exists to catch.
  return true
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
  event,
}) => {
  // Connect readiness, kept fresh (AGL-1997) — the publisher twin of the
  // commerce sync. The seller panel reads `stripeChargesEnabled` /
  // `stripePayoutsEnabled` off this document, and before this nothing but the
  // publisher reopening the connect route ever refreshed either. Same early
  // return: `account.updated` shares nothing with the purchase sections below.
  // `event.livemode`, not `object.livemode` (AGL-2471) — the Account object
  // has no such field. Two of the three poisoned production linkages were
  // publisherProfiles, and this is the path that heals them.
  if (type === 'account.updated') {
    await syncConnectAccountStatus(
      'publisherProfiles',
      object,
      event?.livemode,
    )
    return
  }

  // A PAYOUT OR TRANSFER THAT NEVER LANDED (AGL-2513).
  //
  // Placed beside `account.updated` because it is the same kind of event —
  // account-level, nothing to do with the `metadata.type` order sections
  // below — and returns for the same reason.
  //
  // `payout.failed` is the CONNECTED account's balance failing to reach its
  // bank, so the account id is `event.account`: the Payout object's own
  // `destination` names the bank, not the Connect account. `transfer.failed`
  // is the platform's balance failing to reach the connected account, a
  // platform event whose `destination` IS the account.
  //
  // Recorded and surfaced, never retried: Stripe runs its own retry schedule
  // and a second transfer against an account that just refused one is how a
  // duplicate lands.
  if (type === 'payout.failed' || type === 'transfer.failed') {
    const failedAccountId =
      type === 'payout.failed'
        ? String(event?.account ?? '')
        : String(object?.destination?.id ?? object?.destination ?? '')
    await recordConnectPayoutFailure('publisherProfiles', {
      kind: type === 'payout.failed' ? 'payout' : 'transfer',
      object,
      accountId: failedAccountId,
      livemode: event?.livemode,
    })
    return
  }
  // A later success retires the warning the card shows. The history in
  // `connectPayoutFailures` is kept — "has this account failed before" is what
  // that record exists to answer — but a stale warning on a resolved problem
  // trains people to ignore the surface.
  if (type === 'payout.paid') {
    await clearConnectPayoutFailure('publisherProfiles', String(event?.account ?? ''))
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
    const { listingId, buyerUid, buyerOrgId, sellerOrgId, feeCents, transferCents } =
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
      // WHERE that tax is owed. Read from the session Stripe computed it
      // from — see `buyerTaxJurisdiction`.
      const jurisdiction = buyerTaxJurisdiction(object)
      const purchaseRef = firebaseAdmin
        .app()
        .firestore()
        .collection('marketplacePurchases')
        .doc(String(object.id))
      // `createdAt` is stamped ONCE (AGL-2109). Merging the write below fixed
      // the erasure but introduced its own drift: `serverTimestamp()` on a
      // redelivery would move a three-day-old sale to today, which is the
      // field the seller ledger and every revenue period read. One read, on a
      // path that already makes several Stripe round trips, buys a date that
      // means what it says.
      const alreadyRecorded = (await purchaseRef.get()).exists
      await purchaseRef
        .set({
          listingId,
          buyerUid,
          // THE ORG THE PURCHASE LICENSES (AGL-2331).
          //
          // The one field that makes this document an ORGANIZATIONAL licence
          // rather than a personal one. `hasLivePurchase` keys the eight
          // paid-content doors and the duplicate-purchase guard on it; a
          // document written without it falls back to the legacy person-scoped
          // grant, which is exactly right for the purchases that predate
          // AGL-2331 and exactly wrong for anything written after it. Checkout
          // therefore refuses to open a session that cannot name a validated
          // buyer org, so `metadata.buyerOrgId` is present on every session
          // this branch can see from now on.
          //
          // Written CONDITIONALLY, and the merge is why: a redelivery of an
          // older session — Stripe retries for up to three days — carries no
          // `buyerOrgId`, and `{ merge: true }` with an explicit `undefined`
          // is a no-op in the Admin SDK but an explicit `''` is not. Spreading
          // nothing keeps a redelivery from overwriting a real org id with an
          // empty string, which would strip the licence off the org that
          // bought it.
          ...(buyerOrgId ? { buyerOrgId: String(buyerOrgId) } : {}),
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
          ...(alreadyRecorded
            ? {}
            : {
                createdAt:
                  firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                // THE JURISDICTION THE TAX WAS COMPUTED FOR (AGL-2137).
                //
                // Here, inside the first-record branch, for a stronger reason
                // than `createdAt`'s: a row that exists without a jurisdiction
                // must keep not having one. Stripe redelivers this event for
                // up to three days, and a redelivery that stamped a
                // jurisdiction onto an older sale would restate which state a
                // past period's tax is attributed to — a period that may
                // already have been filed. Recording forward is an
                // improvement; reaching backwards is a restatement.
                //
                // Absent, rather than null, when the session states no
                // country: see `buyerTaxJurisdiction`.
                ...(jurisdiction ? { customerAddress: jurisdiction } : {}),
              }),
        },
        // MERGED, like every other write on this path (AGL-2109). This one
        // was a full document REPLACE, and the document it replaces is not
        // only the sale: it is the buyer's ENTITLEMENT (`hasLivePurchase`
        // reads `refundedAt`), the refund trail, the dispute trail, and the
        // transfer-reversal SETTLE MARKER (`reversedTransferCents`, which
        // `reverseMarketplaceSellerShare` short-circuits on so a publisher is
        // never debited twice).
        //
        // Stripe redelivers `checkout.session.completed` for up to three days
        // after any 500, and this endpoint 500s on purpose — for every
        // transient Stripe failure raised in this file and for any throw from
        // a sibling plugin handler that runs after this one
        // (`runBillingWebhookHandlers` awaits them in sequence and lets a
        // throw propagate). So the redelivery is expected traffic, not an
        // exotic race. Landing after a refund it erased `refundedAt` — the
        // refunded buyer silently got their install back — and erased
        // `reversedTransferCents`, re-opening a second reversal against the
        // publisher's Connect account.
        //
        // Merging is safe in the other direction too: every field written
        // here is derived from the session event, so a redelivery restamps
        // identical values.
        { merge: true },
      )
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
      after(() => sendGa4Purchase({
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
      }).catch(() => undefined))
      // A refund or a lost dispute that arrived before this document existed
      // is applied NOW (AGL-2148) — revocation, GA and the transfer reversal,
      // by the same function the refund door uses. Last on this path, and
      // awaited: it can throw on a transient Stripe failure, which is exactly
      // the redelivery this branch is already idempotent under.
      await drainMarketplaceRefundOrphan(
        firebaseAdmin.app().firestore(),
        purchaseRef,
        String(object?.payment_intent ?? ''),
      )
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
      // Everything a refund does to a purchase, and everything it needs to
      // wait for one — assembled once so the two paths cannot describe the
      // same refund differently.
      const cause: RefundOutcomeCause = {
        kind: 'refund',
        // `charge.refunded` carries the CHARGE, so the charge id is both the
        // cause id and the chargeId — unchanged from AGL-1995.
        id: String(object?.id ?? ''),
        paymentIntentId,
        amountCents: Math.round(Number(object?.amount_refunded ?? 0)),
        chargeId: String(object?.id ?? ''),
        currency: String(object?.currency ?? 'usd'),
        stripeCustomerId: String(object?.customer ?? ''),
      }
      if (!purchases.empty) {
        // The publisher's share comes back (AGL-1995), the entitlement is
        // revoked (AGL-1546) and GA nets the sale out (AGL-1850) — see
        // `applyMarketplaceRefundOutcome`. FULL refunds only, matching the
        // revocation and GA gates: the branch is already inside
        // `object?.refunded === true`. The seller's share of a PARTIAL refund
        // now comes back too, without any of the other three effects — see
        // `reverseMarketplacePartialRefundShare` below. There is no
        // marketplace refund UI, so every refund is issued from the Stripe
        // Dashboard and this webhook is the only code that sees one.
        await applyMarketplaceRefundOutcome(purchases.docs[0].ref, cause)
      } else if (object?.metadata?.type === 'marketplace-purchase') {
        // THE ELSE THAT DID NOT EXIST (AGL-2148). The purchase document is
        // written by `checkout.session.completed`, that delivery retries, and
        // a refund issued inside the window found nothing and was DROPPED.
        //
        // Gated on the PaymentIntent metadata stamped at marketplace checkout
        // (checkout.ts) and copied by Stripe onto the charge, so the
        // storefront and subscription refunds that share this endpoint park
        // nothing. A charge predating that stamp is not parked either — its
        // purchase document has long existed, so the join above finds it.
        await recordRefundOrphan(firestore, cause)
      }
    }
  }

  // A PARTIAL refund pulls the publisher's share back too (AGL-2299) — and
  // nothing else. The branch above is gated on `refunded === true`, which is
  // "the whole charge is gone"; every smaller refund fell through it and the
  // platform paid the entire concession out of a 20% cut. The entitlement is
  // untouched on purpose: a partial refund is a concession, not an un-buy.
  //
  // Same marketplace discriminator the orphan store uses, for the same
  // reason: `charge.refunded` arrives here for storefront orders and
  // subscription charges too, and this must not read a transfer belonging to
  // one of those.
  //
  // The discriminator is required only on the ORPHAN side, exactly as the
  // full-refund branch requires it: when the payment-intent join FINDS a
  // marketplace purchase, that join is already the proof, and demanding the
  // metadata as well would skip every charge predating the AGL-2148 stamp.
  if (
    type === 'charge.refunded' &&
    object?.refunded !== true &&
    Math.round(Number(object?.amount_refunded ?? 0)) > 0
  ) {
    const paymentIntentId = String(object?.payment_intent ?? '')
    if (paymentIntentId) {
      const firestore = firebaseAdmin.app().firestore()
      const purchases = await firestore
        .collection('marketplacePurchases')
        .where('paymentIntentId', '==', paymentIntentId)
        .limit(1)
        .get()
      if (!purchases.empty) {
        await reverseMarketplacePartialRefundShare(
          purchases.docs[0].ref,
          String(object?.id ?? ''),
        )
      } else if (object?.metadata?.type === 'marketplace-purchase') {
        // The AGL-2148 window, for partials. Parked with the charge on it so
        // the drain can recompute the target from Stripe rather than trusting
        // a number this event carried; the amount rides along for forensics.
        await recordRefundOrphan(firestore, {
          kind: 'partial-refund',
          id: String(object?.id ?? ''),
          paymentIntentId,
          amountCents: Math.round(Number(object?.amount_refunded ?? 0)),
          chargeId: String(object?.id ?? ''),
          currency: String(object?.currency ?? 'usd'),
          stripeCustomerId: String(object?.customer ?? ''),
        })
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
    // Reported to the route so it can tell "marketplace handled it" from
    // "nothing handled it" (AGL-2429). Left false by the guard below on
    // purpose: a dispute carrying no payment intent cannot be joined to a
    // purchase, which is a fault, not a routine miss.
    let claimed = false
    if (disputeId && paymentIntentId) {
      const firestore = firebaseAdmin.app().firestore()
      const purchases = await firestore
        .collection('marketplacePurchases')
        .where('paymentIntentId', '==', paymentIntentId)
        .limit(1)
        .get()
      if (!purchases.empty) {
        claimed = true
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
          // Revoke, report, pull the seller's share back — the same three
          // effects the refund door applies, through the same function
          // (AGL-2148), so the two doors and the orphan drain cannot drift.
          // The dispute outcome is stamped in the same write.
          await applyMarketplaceRefundOutcome(
            purchase.ref,
            {
              kind: 'dispute',
              id: disputeId,
              paymentIntentId,
              amountCents: Math.round(Number(object?.amount ?? 0)),
              chargeId: String(object?.charge ?? ''),
              currency: String(object?.currency ?? 'usd'),
              // A dispute event carries no Stripe customer; the GA hit falls
              // back to the buyer uid on the purchase, as it always has.
              stripeCustomerId: '',
            },
            { disputeId, disputeStatus: status },
          )
        } else {
          // `won` or `warning_closed`: the money stayed, the entitlement
          // stays, and the outcome lands on the record for whoever flagged
          // it at `created`.
          await purchase.ref.set(
            { disputeId, disputeStatus: status },
            { merge: true },
          )
        }
      } else if (type === 'charge.dispute.closed' &&
        String(object?.status ?? '') === 'lost') {
        // The refund branch's window, by the bank's door (AGL-2148): only a
        // LOST closed dispute moves money, so only that state is worth
        // parking. A `created` landing in the same window loses nothing but
        // the staff flag — the `closed` that follows days later always finds
        // the purchase document.
        claimed = await recordDisputeOrphanIfMarketplace(
          firestore,
          object,
          paymentIntentId,
        )
      }
    }
    return { claimed }
  }
}
