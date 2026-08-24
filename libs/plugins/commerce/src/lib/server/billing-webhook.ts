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
import * as Aglyn from '@aglyn/aglyn/server'
import {
  findUserByUidAcrossPools,
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
  notifyHostManagers,
  notifyStaff,
  upsertHostContact,
  renderHostEmailWithTokens,
  syncConnectAccountStatus,
  updateExisting,
} from '@aglyn/tenant-data-admin'
import { createHmac } from 'crypto'
import {
  isEmailConfigured,
  sendEmail,
} from '@aglyn/shared-util-email'
import * as CommerceModel from '../model'
import { recordContactRefund } from './contact-refund'
import { mintDownloadToken, tokenSigningSecret } from './download'
import { alertLowStockCrossing } from './low-stock'
import { decrementVariantStock } from './reserve-stock'
import { releaseStockHold } from './stock-hold'
import {
  releasePromotionHold,
  settlePromotionSlot,
} from './promotion-hold'
import { flagOrderRestock } from './restock-flag'
import { storefrontTaxModeOf } from './storefront-tax'
import { recordStorefrontTax } from './storefront-tax-record'
import { enqueueSupplierDelivery } from './supplier-outbox'

/**
 * Assigns unassigned license keys for a digital product (AGL-308):
 * stamps order/email on the key docs, returns the key strings, and
 * nudges managers when the pool runs low.
 *
 * EACH KEY IS CLAIMED IN ITS OWN TRANSACTION (AGL-2149). The original shape was
 * a query for `assignedAtMs == null` followed by a bare `set(…, { merge: true })`
 * per document, with nothing between the read and the write. Two orders for the
 * same product landing together — the ordinary case for a digital product that
 * is selling — both read the same head of the pool and both stamped it, so the
 * second write simply overwrote the first order's `orderId` and BOTH buyers
 * were mailed the same key. That is a redeemable secret handed out twice, and
 * it is invisible afterwards: the key doc records only the later order.
 *
 * The claim is a transaction rather than the `create()` primitive `refund.ts`
 * uses for idempotency, because the document being claimed ALREADY EXISTS — the
 * merchant uploaded the pool — so there is no create to lose. What a
 * transaction gives is the same guarantee from the other side: Firestore aborts
 * and retries the transaction if `assignedAtMs` changed between this
 * transaction's read of the key and its commit, so exactly one of two racing
 * orders can turn a `null` into a timestamp. The in-transaction re-read of
 * `assignedAtMs` is the test that makes the abort observable to us rather than
 * merely survived: a key another order took while we were queuing is skipped,
 * not double-stamped.
 *
 * THE POOL QUERY OVER-FETCHES for the same reason. Asking for exactly
 * `quantity` candidates and then losing three of them to a concurrent order
 * would silently short the buyer, so the query takes headroom and the loop
 * stops at `quantity` claims. A buyer can still be short-changed when the pool
 * genuinely runs dry — that is the merchant's stock problem, and the low-pool
 * nudge below is what tells them.
 *
 * The failure mode is still "fewer keys than paid for", never "someone else's
 * key": swallowing stays, because the money has moved and a thrown assignment
 * would take the receipt and the fulfilment down with it.
 */
async function assignLicenseKeys(
  firestore: FirebaseFirestore.Firestore,
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  productId: string,
  orderId: string,
  email: string | null,
  quantity: number,
): Promise<string[]> {
  try {
    const wanted = Math.max(1, quantity)
    const pool = await hostRef
      .collection('licenseKeys')
      .where('productId', '==', productId)
      .where('assignedAtMs', '==', null)
      // Headroom for keys a concurrent order claims out from under this one.
      .limit(wanted * 3)
      .get()
    const keys: string[] = []
    for (const docSnapshot of pool.docs) {
      if (keys.length >= wanted) break
      const claimed = await firestore
        .runTransaction(async (transaction) => {
          const fresh = await transaction.get(docSnapshot.ref)
          if (!fresh.exists) return null
          // Re-asked INSIDE the transaction that writes it. This is the whole
          // guard: the query's answer is a snapshot from before we queued.
          if (fresh.get('assignedAtMs') != null) return null
          transaction.update(docSnapshot.ref, {
            orderId,
            email,
            assignedAtMs: Date.now(),
          })
          return String(fresh.get('key'))
        })
        .catch((error) => {
          console.error('license key claim failed', error)
          return null
        })
      if (claimed) keys.push(claimed)
    }
    if (keys.length) {
      const remaining = await hostRef
        .collection('licenseKeys')
        .where('productId', '==', productId)
        .where('assignedAtMs', '==', null)
        .limit(6)
        .get()
      if (remaining.size < 5) {
        void notifyHostManagers(hostId, {
          type: 'content.lowStock',
          title: 'License key pool running low',
          body: `${remaining.size} keys left`,
          link: `/${hostId}/products`,
        })
      }
    }
    return keys
  } catch (error) {
    console.error('license key assignment failed', error)
    return []
  }
}

/**
 * Applies a redemption to a coupon, gift card or discount that must ALREADY
 * exist, and — when it does not — stamps the orphan on the order (AGL-1767).
 *
 * `set(..., { merge: true })` reads as "update if present" and means "create if
 * absent", so a merchant who deleted the code between the shopper starting
 * checkout and this webhook landing got a phantom back. The gift card is the
 * one that corrupts an aggregate: `increment(-N)` on a missing document creates
 * it holding `balanceCents: -N`, so any outstanding-liability figure summed over
 * `giftCards` is understated by N and re-issuing the code later starts the new
 * card in the hole. The coupon ghosts carry a redemption count a re-created
 * coupon inherits against its `maxRedemptions` cap, and the discount ghost is
 * worse than inert: it passes every gate in `commerce-discounts.ts`'s
 * `applies()`, because each one skips when its constraint field is ABSENT, so it
 * reaches the automatic-promotion loop as a candidate and shows in the console
 * list as a nameless always-on promotion nobody created. The only thing keeping
 * it from discounting anything is `valueCents()` returning 0 for an unrecognised
 * `kind` — one default, not a guard.
 *
 * REFUSE-AND-RECORD, not a bare refusal, which is AGL-1760's rule: the shopper's
 * discount really was applied by Stripe and the gift-card balance really was
 * spent, so dropping the fact silently would be AGL-1732 inverted — money moved,
 * recorded nowhere. The note goes on the ORDER's own `timeline`, which the
 * console order dialog renders, the way `47d3bccc5` records `folio-unattached`.
 * The merchant reading the order sees "$25 was applied against a gift card that
 * no longer exists" instead of a negative number quietly leaving a liability
 * total. The coupon/gift-card document is not the place — that document IS the
 * defect — and a new collection would be invisible until someone built UI for
 * it, which is the same failure with an extra step.
 *
 * WHY `null` IS NOT `false`. `updateExisting` reports absence ONLY for gRPC
 * `NOT_FOUND` and rethrows everything else, which matters here because the note
 * this writes claims absence by name. A permission denial, an App Check
 * rejection or a transport failure must not become "the merchant deleted your
 * coupon" on an order the merchant is reading. Those are logged and left
 * unstamped. Nothing rethrows: `runBillingWebhookHandlers` lets the first throw
 * propagate, and a 500 here would have Stripe redeliver into the AGL-498
 * existence guard, which returns before this whole fan-out — so a throw does not
 * retry the redemption, it abandons the fulfilment that follows it.
 */
async function redeemExistingOrRecord(
  ref: FirebaseFirestore.DocumentReference,
  patch: Record<string, unknown>,
  orderRef: FirebaseFirestore.DocumentReference,
  detail: string,
): Promise<void> {
  const applied = await updateExisting(ref, patch).catch((error) => {
    console.error('Redemption write failed', ref.path, error)
    return null
  })
  if (applied !== false) return
  console.error('Redemption against a missing document', ref.path)
  await recordRedemptionOrphan(orderRef, detail)
}

/**
 * Stamps a redemption that could not be recorded onto the order's own timeline.
 *
 * Split out of `redeemExistingOrRecord` (AGL-2449) so the gift-card settlement
 * — which is a transaction rather than an `updateExisting`, and so cannot go
 * through that helper — reports a missing card in exactly the same words, on
 * exactly the same surface, as every other redemption. Two ways of telling a
 * merchant the same fact is how one of them ends up never being built.
 *
 * `update()`, not a merge-set: the order was created by the transaction
 * upstream (a redelivery returns before here), so it exists — and writing this
 * note through a merge would mint an order stub on the one path where it does
 * not.
 */
async function recordRedemptionOrphan(
  orderRef: FirebaseFirestore.DocumentReference,
  detail: string,
): Promise<void> {
  await orderRef
    .update({
      timeline: firebaseAdmin.firestore.FieldValue.arrayUnion({
        atMs: Date.now(),
        event: 'redemption-unrecorded',
        detail,
      }),
    })
    .catch(() => undefined)
}

/**
 * Count one promotion redemption (AGL-2453), settling the slot it reserved.
 *
 * This used to be a bare `redeemExistingOrRecord(ref, { redemptions:
 * increment(1) }, …)` at three call sites, and it was the counting half of a
 * cap that nothing re-checked: the increment always landed, minutes after a
 * plain `.get()` at checkout had already let the shopper through. The counter
 * told the truth afterwards and the discount was already given.
 *
 * Now the checkout HOLDS a slot and this settles it. Two properties matter:
 *
 *  - **Idempotent under redelivery.** The redemption is owed by the presence of
 *    the hold, so a second delivery of the same event finds none and counts
 *    nothing. `reconcile-stock.ts:52-58` names these counters as sitting behind
 *    one non-idempotent `created` flag and defers the per-effect sweep — this
 *    is the per-effect answer for redemptions, not a reliance on that flag.
 *  - **A session with no hold still counts.** An UNCAPPED promotion reserves
 *    nothing (there is no slot to reserve), and a session minted before this
 *    deploy reserved nothing either. Both carry no `holdKey` and both take the
 *    original unconditional increment — dropping them would under-count real
 *    redemptions, which is the merchant's own record of their promotion.
 */
async function settleRedemption(options: {
  firestore: FirebaseFirestore.Firestore
  ref: FirebaseFirestore.DocumentReference
  holdKey: string
  orderRef: FirebaseFirestore.DocumentReference
  label: string
  detail: string
}): Promise<void> {
  const { firestore, ref, holdKey, orderRef, label, detail } = options
  if (!holdKey) {
    await redeemExistingOrRecord(
      ref,
      { redemptions: firebaseAdmin.firestore.FieldValue.increment(1) },
      orderRef,
      detail,
    )
    return
  }
  const settled = await settlePromotionSlot({ firestore, ref, holdKey, label })
  // `missing` alone is the orphan: the merchant deleted the promotion between
  // checkout and payment, so the redemption cannot be recorded anywhere and the
  // order's own timeline is where that fact belongs. `already-settled` is a
  // redelivery and is silent by design; `error` is transient — the hold stands,
  // lapses on its own, and a note claiming the document is gone would be false.
  if (settled === 'missing') {
    await recordRedemptionOrphan(orderRef, detail)
  }
}

/** gRPC `Status.FAILED_PRECONDITION` — Firestore's "this query needs an index". */
const GRPC_FAILED_PRECONDITION = 9

/**
 * The order a card dispute is against (AGL-1787), or null.
 *
 * A dispute carries NO metadata — Stripe copies none from the session or the
 * payment intent — so this branch cannot self-select on `object.metadata.type`
 * the way every other section of this file does. The lookup IS the selection:
 * the platform account also carries marketplace plugin purchases, Aglyn's own
 * subscription billing and booking payments, and a dispute on any of those
 * reaches this handler too. Finding no commerce order means the dispute is not
 * commerce's, which is the COMMON case and must stay silent — an alert or a
 * counter here would fire on every marketplace dispute AGL-1554 handles.
 *
 * `payment_intent` is the join, exactly as AGL-1546 joined `charge.refunded` to
 * a marketplace purchase. It is used only as a query VALUE and never as a
 * document id, so the reserved-id hazard (`__x__` earning `INVALID_ARGUMENT` at
 * the service rather than throwing at `.doc()`) cannot arise here.
 *
 * TWO MATCHES REFUSE. A payment intent belongs to one charge and one order, so
 * a second match is corrupt data; reversing an arbitrary one of them is a coin
 * flip and reversing both double-counts. Refuse and log — the dispute is
 * durable in Stripe and a human reconciles.
 *
 * The `collectionGroup` needs a COLLECTION_GROUP-scoped single-field index on
 * `orders.paymentIntentId`, declared in `cloud/firebase-firestore.indexes.json`
 * beside the `installs.listingId` one. Until that index deploys the query fails
 * `FAILED_PRECONDITION`, which is caught here rather than thrown: a throw
 * propagates through `runBillingWebhookHandlers` into a 500, and Stripe
 * redelivers an event whose failure NO redelivery can fix — an infinite retry
 * loop. Every other failure is transient and rethrows on purpose, because there
 * a redelivery is exactly the right answer.
 */
type DisputeLookup =
  | { kind: 'order'; snapshot: FirebaseFirestore.QueryDocumentSnapshot }
  /** No commerce order matched. The COMMON case, and correctly silent. */
  | { kind: 'not-ours' }
  /**
   * The lookup could not run or could not be trusted (AGL-2161). A PLATFORM
   * fault, and the one outcome that must never be reported as `not-ours`.
   */
  | { kind: 'unresolved'; reason: 'missing-index' | 'ambiguous' }

async function findOrderForDispute(
  paymentIntentId: string,
): Promise<DisputeLookup> {
  const matches = await firebaseAdmin
    .app()
    .firestore()
    .collectionGroup('orders')
    .where('paymentIntentId', '==', paymentIntentId)
    .limit(2)
    .get()
    .catch((error: { code?: number }) => {
      if (error?.code !== GRPC_FAILED_PRECONDITION) throw error
      console.error(
        'Dispute lookup needs the collection-group index on ' +
          'orders.paymentIntentId (AGL-1787)',
        error,
      )
      return null
    })
  // THE THREE ANSWERS ARE NOW THREE (AGL-2161). All three used to be `null`,
  // and the caller read `null` as "not a commerce dispute" and did nothing —
  // so a collection-group index that had not deployed meant EVERY chargeback
  // on the platform got no flag, no seller-share reversal and no merchant
  // notification, while looking byte-for-byte like the routine case of a
  // dispute against a marketplace or booking charge.
  //
  // Distinguishing them needs no knowledge of whether the index is in fact
  // deployed, which is why this did not have to wait on a production probe:
  // "the query could not run" and "the query ran and matched nothing" are
  // different facts at the point they happen, and only one of them is ours to
  // fix.
  if (!matches) return { kind: 'unresolved', reason: 'missing-index' }
  if (matches.empty) return { kind: 'not-ours' }
  if (matches.docs.length > 1) {
    console.error(
      'Dispute matched more than one order; reversing none',
      paymentIntentId,
    )
    return { kind: 'unresolved', reason: 'ambiguous' }
  }
  return { kind: 'order', snapshot: matches.docs[0] }
}

/**
 * Tells STAFF that a chargeback could not be routed (AGL-2161).
 *
 * Staff, not the merchant: on the missing-index path there is no merchant to
 * tell — the whole point is that the order could not be found — and a missing
 * platform index is a platform fault affecting every host at once. `notifyStaff`
 * is the same channel the analytics and abuse routes use for exactly this
 * class, and it never throws.
 *
 * `system.announcement` rather than a new type: the AGL-1088 rule is that
 * category is the prefix and `system` is the bucket nobody mutes to reduce
 * noise, which is the property an alert about unrouted money needs.
 */
async function reportUnresolvedDispute(
  reason: 'missing-index' | 'ambiguous',
  paymentIntentId: string,
  dispute: StripeDispute,
): Promise<void> {
  const amount = `$${((dispute.amount ?? 0) / 100).toFixed(2)}`
  await notifyStaff({
    type: 'system.announcement',
    title: 'Chargeback could not be routed to an order',
    body:
      reason === 'missing-index'
        ? `A ${amount} chargeback (${paymentIntentId}) could not be looked ` +
          'up: the collection-group index on orders.paymentIntentId is not ' +
          'deployed, so EVERY commerce chargeback is currently being ignored ' +
          '— no flag, no seller-share reversal, no merchant notification. ' +
          'Deploy cloud/firebase-firestore.indexes.json.'
        : `A ${amount} chargeback (${paymentIntentId}) matched more than one ` +
          'order, so none was reversed. The dispute is durable in Stripe and ' +
          'needs reconciling by hand.',
    link: '/admin',
  })
}

/** The fields of a Stripe Dispute this handler reads. */
interface StripeDispute {
  id?: string
  status?: string
  reason?: string
  /** Disputed cents, which can be less than the charge. */
  amount?: number
  /** Unix SECONDS, as every Stripe timestamp is. */
  created?: number
  charge?: string
  payment_intent?: string
  evidence_details?: { due_by?: number }
}

/** The dispute record this event describes, before any outcome is known. */
function disputeFromEvent(dispute: StripeDispute): CommerceModel.OrderDispute {
  const dueBy = Number(dispute?.evidence_details?.due_by ?? 0)
  return {
    id: String(dispute?.id ?? ''),
    status: String(dispute?.status ?? ''),
    ...(dispute?.reason ? { reason: String(dispute.reason) } : {}),
    amountCents: Math.max(0, Math.round(Number(dispute?.amount ?? 0))),
    openedAtMs: Number(dispute?.created ?? 0) * 1000 || Date.now(),
    ...(dueBy > 0 ? { evidenceDueByMs: dueBy * 1000 } : {}),
  }
}

/**
 * `charge.dispute.created`: FLAG the order, reverse nothing (AGL-1787).
 *
 * A dispute can be WON, and this is the whole reason the reversal waits for
 * `closed`. Nothing here un-writes: `recordContactRefund` is monotonic by
 * construction (AGL-1754 chose counters over decrements precisely so a reader
 * can never be handed a number that went backwards), so a reversal written on
 * `created` and reversed again on a win would need a decrement the contact
 * writer deliberately does not have. Waiting means a win has NOTHING to undo,
 * which is a stronger guarantee than undoing correctly. AGL-1554 states the
 * same rule for the marketplace side.
 *
 * What the merchant gets is the thing they actually need on day one: notice,
 * with the evidence deadline, while there is still time to respond.
 *
 * The write is `update()` on the whole `dispute` field, not a merge into it.
 * A merge recurses, so a SECOND dispute opened on the same charge after a win
 * would inherit the first one's `outcome`, `closedAtMs` and `reversedCents` —
 * an open dispute reading as already settled. `update()` replaces a nested map
 * wholesale, which is the semantics this wants, and the transaction has just
 * proven the document exists so it cannot `NOT_FOUND`.
 */
async function recordDisputeOpened(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  dispute: StripeDispute,
): Promise<{ opened: boolean; record: CommerceModel.OrderDispute }> {
  const record = disputeFromEvent(dispute)
  const opened = await firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction) => {
      const fresh = await transaction.get(snapshot.ref)
      if (!fresh.exists) return false
      const order = CommerceModel.liftLegacyOrder((fresh.data() ?? {}) as never)
      // Once-only, keyed on the DOCUMENT, which is how every section of this
      // file guards a redelivery ("idempotent by doc key") and how AGL-1754
      // made its status flip observable exactly once. A claim in
      // `apiIdempotency` would be worse here, not better: its key would have to
      // be the Stripe event id, which never changes, so a process killed
      // between the claim and the record would strand it and the redelivery —
      // the only retry a webhook has — would be turned away forever. An HTTP
      // caller escapes a stranded claim with a fresh key; a webhook cannot.
      // Reading the order inside the transaction that writes it has no such
      // window.
      //
      // Any stored record of THIS dispute means `created` already landed, or
      // `closed` beat it here; a DIFFERENT id is a genuine second dispute on
      // the same charge and does replace it.
      if (order.dispute?.id === record.id) return false
      const amount = `$${(record.amountCents / 100).toFixed(2)}`
      transaction.update(snapshot.ref, {
        dispute: record,
        timeline: CommerceModel.appendOrderEvent(
          order,
          'dispute',
          `Chargeback opened for ${amount}` +
            (record.reason ? ` (${record.reason.replace(/_/g, ' ')})` : '') +
            (record.evidenceDueByMs
              ? ` — evidence due ${new Date(record.evidenceDueByMs)
                  .toISOString()
                  .slice(0, 10)}`
              : ''),
          record.openedAtMs,
        ),
      })
      return true
    })
  return { opened, record }
}

/**
 * `charge.dispute.closed`: the only event that moves money (AGL-1787).
 *
 * `status` is `won`, `lost` or `warning_closed`. Only `lost` reverses; the
 * other two record the outcome and leave every figure alone, which costs
 * nothing precisely because `created` reversed nothing.
 *
 * A LOSS IS RECORDED AS A REFUND, and that is the decision. Money reversed is
 * money reversed whichever door it left by, so it lands in the fields AGL-1754
 * built for it — `refundedCents` on the order, `refundedCents` /
 * `refundedOrdersCount` / `lastRefundAtMs` on the contact — and the order
 * reaches `refunded`. What the merchant sees as DIFFERENT is the wording: the
 * order timeline says "charged back", the contact timeline says "charged back"
 * (the `kind` parameter AGL-1754 shipped for exactly this handler), and the
 * `dispute` record beside the status carries the reason, the amount and the
 * outcome. The alternative — a `disputed` status — is measured in
 * `OrderDispute`'s comment: it would have escaped five gates that match on
 * `'refunded'` and left the shopper their downloads.
 *
 * THE CAP is `refund.ts`'s: this attempt against what is LEFT, never the order
 * total. A merchant who already refunded half and then loses a dispute for the
 * full amount reverses only the remaining half — the buyer cannot be given the
 * same money twice, and Stripe's own dispute is against the net charge.
 *
 * THE STATUS FLIP asks `canTransitionOrder` rather than forcing `refunded`, so
 * a cancelled order records the loss without the chargeback rewriting a
 * terminal state the merchant chose. `closedTheOrder` then needs no separate
 * `!== 'refunded'` test: an order already in `refunded` has no legal transition
 * out of it, so `canTransitionOrder` is false and the flip is observable
 * exactly once — the AGL-1754 finding that `fullyRefunded` is NOT a once-only
 * signal, inherited rather than rediscovered. Two partial refunds settling
 * either side of this dispute can all three compute "fully refunded"; only the
 * transaction that reads the status it is about to write may increment.
 *
 * THE DISPUTE FEE (typically $15) is not recorded anywhere on the order. These
 * are DESTINATION charges — `payment_intent_data[transfer_data][destination]`
 * with no `on_behalf_of` — so the dispute and its fee are debited from the
 * PLATFORM's balance, not the merchant's. It is not money the customer handed
 * over and not money the merchant lost, so it belongs neither in `ltvCents` nor
 * in the order's totals, and stamping Aglyn's cost onto a merchant-facing
 * document would assert a loss they did not take. Whether the platform should
 * RECOVER the principal by reversing the transfer is a real policy question
 * with a merchant-agreement answer attached, and is filed rather than guessed.
 */
async function recordDisputeClosed(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  dispute: StripeDispute,
): Promise<{
  recorded: boolean
  lost: boolean
  reversedCents: number
  closedTheOrder: boolean
  customerEmail: unknown
}> {
  const event = disputeFromEvent(dispute)
  const outcome = String(dispute?.status ?? '')
  const lost = outcome === 'lost'
  return firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction) => {
      const idle = {
        recorded: false,
        lost,
        reversedCents: 0,
        closedTheOrder: false,
        customerEmail: null as unknown,
      }
      const fresh = await transaction.get(snapshot.ref)
      if (!fresh.exists) return idle
      const order = CommerceModel.liftLegacyOrder((fresh.data() ?? {}) as never)
      const stored = order.dispute
      // Already settled: a plain redelivery of this same `closed`.
      if (stored?.id === event.id && stored.closedAtMs) return idle
      const totalCents =
        order.totals?.totalCents ?? Number(order.amountCents ?? 0)
      const alreadyReversed = Number(order.refundedCents ?? 0)
      const reversedCents = lost
        ? Math.max(0, Math.min(event.amountCents, totalCents - alreadyReversed))
        : 0
      const reversedTotal = alreadyReversed + reversedCents
      const fullyReversed = reversedCents > 0 && reversedTotal >= totalCents
      const closedTheOrder =
        fullyReversed &&
        CommerceModel.canTransitionOrder(order.status, 'refunded')
      const closedAtMs = Date.now()
      const amount = `$${(reversedCents / 100).toFixed(2)}`
      transaction.update(snapshot.ref, {
        ...(reversedCents > 0 ? { refundedCents: reversedTotal } : {}),
        ...(closedTheOrder ? { status: 'refunded' } : {}),
        dispute: {
          ...event,
          // The open time from the `created` this closes, when we saw it —
          // `closed` can arrive without it (a lost event, or a subscription
          // added late), and `disputeFromEvent` falls back to the dispute's
          // own `created` for that case.
          ...(stored?.id === event.id && stored.openedAtMs
            ? { openedAtMs: stored.openedAtMs }
            : {}),
          status: outcome,
          outcome,
          closedAtMs,
          reversedCents,
        },
        timeline: CommerceModel.appendOrderEvent(
          order,
          'dispute',
          lost
            ? `${amount} charged back (dispute lost)` +
                (closedTheOrder ? ' (full)' : '')
            : `Dispute ${outcome.replace(/_/g, ' ')} — no money reversed`,
          closedAtMs,
        ),
      })
      return {
        recorded: true,
        lost,
        reversedCents,
        closedTheOrder,
        customerEmail: order.customerEmail,
      }
    })
}

/**
 * Stop a LAPSED storefront's recurring billing (AGL-2071).
 *
 * ## The money path this closes
 *
 * A storefront subscription is a DESTINATION CHARGE on Aglyn's platform
 * account: `checkout.ts` sends `subscription_data[transfer_data][destination]`
 * unconditionally and `subscription_data[application_fee_percent]` only when
 * the plan's take rate is above zero. Stripe's processing fee (2.9% + 30¢) and
 * any $15 dispute fee are debited from the PLATFORM's balance — stated at
 * :356-359 of this file — so a cycle billed at a 0% take rate is strictly
 * loss-making for Aglyn.
 *
 * Every shopper-facing door re-asks the plan per request and refuses a lapsed
 * org: `checkout.ts:132`, `cart-checkout.ts:96`, `draft-order.ts:102`,
 * `reserve.ts:70`, `pos-order.ts:94`. A RENEWAL has no door — Stripe bills the
 * subscriber on its own schedule and this webhook is told afterwards. So the
 * subscription created while the org could sell keeps billing forever after
 * the org's own subscription dies, and `resolveEffectivePlan` has by then
 * collapsed that org to `free`.
 *
 * ## Why this cancels rather than refuses
 *
 * The cycle in hand is money Stripe has ALREADY taken. Refusing to record it
 * would be AGL-1732 in reverse — a payment collected and filed nowhere — and
 * the subscriber's box still has to ship. So the ledger, the order and the
 * fulfilment path are untouched; what changes is that no FURTHER cycle is
 * billed.
 *
 * `cancel_at_period_end` rather than an outright cancel, for two reasons that
 * both matter: the subscriber keeps the period they just paid for, and the
 * flag is REVERSIBLE — the merchant has a full cycle to restore their Aglyn
 * plan before anything is actually lost. An immediate cancel would take
 * service away from a shopper who did nothing wrong.
 *
 * ## Once-only
 *
 * The marker is CLAIMED in a transaction before the Stripe call, so two
 * deliveries racing cannot both notify the merchant. A Stripe refusal releases
 * the claim, because a marker that outlives a failed call would leave the
 * subscription billing forever with the books saying it had been stopped. The
 * `Idempotency-Key` covers the window where the claim is written and the
 * response never arrives.
 */
async function stopLapsedStorefrontSubscription(
  hostId: string,
  subscriptionId: string,
  subscriptionRef: FirebaseFirestore.DocumentReference,
): Promise<void> {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Lapsed storefront subscription not stopped: STRIPE_SECRET_KEY is not set (AGL-2071)',
      { hostId, subscriptionId },
    )
    return
  }
  const claimed = await firebaseAdmin
    .app()
    .firestore()
    .runTransaction(async (transaction) => {
      const fresh = await transaction.get(subscriptionRef)
      if (fresh.get('lapsedStopRequestedAtMs') != null) return false
      transaction.set(
        subscriptionRef,
        { lapsedStopRequestedAtMs: Date.now() },
        { merge: true },
      )
      return true
    })
  if (!claimed) return

  // `null`, not `FieldValue.delete()`: the guard above asks `!= null`, so
  // both readings are identical to it, and a plain value keeps the release
  // inside the same merge-set semantics every other write here uses.
  const release = async () => {
    await subscriptionRef
      .set({ lapsedStopRequestedAtMs: null }, { merge: true })
      .catch(() => undefined)
  }

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(
      subscriptionId,
    )}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `lapsed-stop-${subscriptionId}`,
      },
      body: new URLSearchParams({
        cancel_at_period_end: 'true',
      }).toString(),
    },
  ).catch(() => null)
  if (!response || !response.ok) {
    await release()
    if (!response || isTransientStripeStatus(response.status)) {
      // Let Stripe redeliver: the ledger write above is idempotent on the
      // invoice id, so a retry re-runs this and nothing else.
      throw new Error(
        `Stripe refused to stop lapsed subscription ${subscriptionId} ` +
          `(${response ? response.status : 'network'})`,
      )
    }
    console.error(
      'Stripe refused to stop a lapsed storefront subscription (AGL-2071)',
      { hostId, subscriptionId, status: response.status },
    )
    return
  }
  await subscriptionRef
    .set(
      {
        lapsedStopReason: 'plan',
        cancelAtPeriodEnd: true,
      },
      { merge: true },
    )
    .catch(() => undefined)
  void notifyHostManagers(hostId, {
    type: 'content.order',
    title: 'A subscription stopped renewing — your plan no longer includes storefront subscriptions',
    body:
      'This subscriber keeps the period they have already paid for. ' +
      'Restore your plan before it ends to keep billing them.',
    link: `/${hostId}/products`,
  })
}

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
 * Re-price a storefront subscription's platform fee to the merchant's CURRENT
 * plan (AGL-2289).
 *
 * `checkout.ts` sets `subscription_data[application_fee_percent]` ONCE, at the
 * sale, and nothing has ever revisited it. `application_fee_percent` lives on
 * the Stripe subscription and applies to every invoice it ever raises, so the
 * rate a merchant was on the day a shopper subscribed is the rate they pay
 * forever — in both directions, and both are wrong:
 *
 *  - Sold on Starter (5% digital) then upgraded to Advanced (0%): Aglyn keeps
 *    taking 5% of every cycle from a merchant whose plan says it takes none.
 *    That is an over-charge to find and refund.
 *  - Sold on Advanced (the param omitted entirely) then downgraded to Starter:
 *    Aglyn keeps taking nothing, on a DESTINATION charge whose processing fee
 *    it pays out of its own balance. Every cycle is a loss.
 *
 * The renewal is the only place this can be corrected, because a renewal is
 * the only event a subscription raises — there is no door for the merchant to
 * walk through. It runs beside the AGL-2071 lapse stop for that reason.
 *
 * IDEMPOTENT BY A STORED VALUE, not by a Stripe read. `appliedFeePct` on our
 * own `subscriptions/{id}` document records what was last SENT, so an ordinary
 * renewal compares two numbers and makes no network call at all. A
 * subscription from before this shipped carries no such field, which reads as
 * "unknown" and re-prices once — the self-healing pass, and the reason this
 * does not need a backfill.
 *
 * The value is written only AFTER Stripe accepts, so a failure re-tries on the
 * next cycle rather than recording a rate that was never applied. A transient
 * refusal throws so Stripe redelivers (the ledger write is keyed on the
 * invoice id, so a redelivery re-runs this and nothing else); a definitive one
 * is logged and let go, because no redelivery fixes it and a throw would have
 * Stripe retry the whole invoice forever — the AGL-1743 lesson.
 *
 * A rate of 0 UNSETS the parameter rather than sending `0`: Stripe rejects a
 * zero `application_fee_percent`, and an empty value is how its API clears an
 * optional field. That is also what `checkout.ts` does by omitting the key.
 */
async function repriceStorefrontSubscriptionFee(
  subscriptionRef: FirebaseFirestore.DocumentReference,
  subscriptionId: string,
  desiredFeePct: number,
): Promise<void> {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey || !subscriptionId) return
  const snapshot = await subscriptionRef.get().catch(() => null)
  if (!snapshot?.exists) return
  const stored = snapshot.get('appliedFeePct')
  // `Number.isFinite` and not `!= null`: a malformed stored value must read as
  // unknown and re-price, never as agreement with whatever it happens to be.
  if (Number.isFinite(stored) && Number(stored) === desiredFeePct) return
  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(
      subscriptionId,
    )}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Keyed on the RATE as well as the subscription, so a later change
        // back is a new request rather than a replay of the old one.
        'Idempotency-Key': `fee-reprice-${subscriptionId}-${desiredFeePct}`,
      },
      body: new URLSearchParams({
        application_fee_percent:
          desiredFeePct > 0 ? String(desiredFeePct) : '',
      }).toString(),
    },
  ).catch(() => null)
  if (!response || !response.ok) {
    if (!response || isTransientStripeStatus(response.status)) {
      throw new Error(
        `Stripe refused to re-price subscription ${subscriptionId} ` +
          `(${response ? response.status : 'network'})`,
      )
    }
    console.error(
      `Stripe refused the fee re-price for ${subscriptionId} (AGL-2289)`,
      await response.json().catch(() => null),
    )
    return
  }
  await subscriptionRef
    .set({ appliedFeePct: desiredFeePct }, { merge: true })
    .catch(() => undefined)
}

/**
 * The charge a paid invoice settled against, on whichever spelling this
 * endpoint's API version uses (AGL-2317).
 *
 * `invoice.charge` was removed in favour of `invoice.payments[]` on newer
 * versions, and the version an endpoint speaks is dashboard configuration this
 * repo cannot see — the same three-spelling problem `subscriptionMeta` and the
 * tax fields already solve by reading every form. `payment_intent` is the third
 * (the renewal order write at :1667 reads it), and it needs one more hop.
 */
async function resolveInvoiceChargeId(
  invoice: any,
  stripeKey: string,
): Promise<string> {
  const direct = invoice?.charge
  if (typeof direct === 'string' && direct) return direct
  for (const payment of invoice?.payments?.data ?? []) {
    const charge = payment?.payment?.charge
    if (typeof charge === 'string' && charge) return charge
    const nested = payment?.payment?.payment_intent
    if (typeof nested === 'string' && nested) {
      const intent = await stripeGet(
        `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(nested)}`,
        stripeKey,
      )
      const latest = intent.ok ? intent.body?.latest_charge : ''
      if (typeof latest === 'string' && latest) return latest
    }
  }
  const paymentIntentId = invoice?.payment_intent
  if (typeof paymentIntentId === 'string' && paymentIntentId) {
    const intent = await stripeGet(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(
        paymentIntentId,
      )}`,
      stripeKey,
    )
    const latest = intent.ok ? intent.body?.latest_charge : ''
    if (typeof latest === 'string' && latest) return latest
  }
  return ''
}

/**
 * Take the platform's cut of a subscription cycle on ITEMS ONLY (AGL-2317).
 *
 * ## What was wrong
 *
 * `checkout.ts` sends `subscription_data[application_fee_percent]`, and Stripe
 * applies that percentage to the WHOLE invoice — sales tax and shipping
 * included. Every one-time door in this product computes an
 * `application_fee_amount` in cents on post-discount items instead, and
 * AGL-2315 deliberately did the same for bookings. So the recurring door was
 * taking a percentage of money that belongs to a state revenue office, and the
 * same merchant selling the same $30 good was charged 60¢ through one button
 * and 65¢ through the other.
 *
 * This is a BASE correction, not a pricing change: the advertised commerce fee
 * is a cut of sales, the one-time path already implements exactly that, and the
 * subscription path was charging merchants MORE than the locked basis. No rate,
 * tier boundary or metered price is touched — see
 * `subscriptionInvoiceItemsOnlyFeeCents`, which derives the target by scaling
 * the fee Stripe actually took and never names a rate at all.
 *
 * ## Why this runs on the PAID invoice and not on the draft
 *
 * Stripe offers no items-only base for `application_fee_percent` — it is a
 * percentage of the invoice total, full stop — and a Subscription has no
 * `application_fee_amount` field to set instead. The obvious repair is to
 * subscribe `invoice.created` and write an exact cents amount onto each draft
 * before it finalises. That covers RENEWALS and cannot cover the opening cycle:
 * a subscription bought through Checkout has its first invoice created,
 * finalised and paid inside the session, so the `invoice.created` delivery
 * arrives against an already-paid invoice that Stripe will not let us modify.
 * Dropping the percent and relying on the draft patch would therefore leave
 * cycle 1 of every subscription — the whole first year of an annual one —
 * collecting no fee at all.
 *
 * Nor can the opening fee be pre-computed as an equivalent percentage:
 * `application_fee_percent` carries limited decimal places, and on a Stripe Tax
 * merchant the tax is not even known when the session is created.
 *
 * So the correction is applied where the composition is finally knowable and no
 * event is racing: the paid invoice. Stripe's own instrument for handing a
 * platform fee back to the connected account is an application-fee refund, and
 * the excess — the part taken on tax and shipping — is refunded to the
 * merchant. Three properties made this the shape worth shipping inside the
 * freeze:
 *
 *  - **It rides an event we already receive.** `invoice.paid` is in
 *    `WEBHOOK_EVENTS` and is live. `invoice.created` is not, and adding it is a
 *    dashboard reconciliation someone has to run — a correctness fix that only
 *    works after an ops step is a fix that can silently not ship.
 *  - **It reaches the BACK-BOOK with no migration.** Existing subscriptions
 *    carry `application_fee_percent` on the Stripe object and will keep applying
 *    it; every cycle they raise is corrected here, from the first delivery
 *    onward, without touching a single Stripe subscription.
 *  - **It is a no-op with ZERO network calls on an untaxed invoice**, which is
 *    every subscription in a store that collects no tax and ships nothing.
 *
 * ## Idempotency
 *
 * Two ways, because the `invoice.paid` / `invoice.payment_succeeded` pair means
 * the same payment arrives twice. The `Idempotency-Key` is the invoice id, and
 * — independently of Stripe honouring it — the refundable amount is computed
 * from the fee's own `amount_refunded`, so a second delivery finds nothing left
 * to refund and makes no write. A redelivery after the ledger row exists
 * re-runs this and only this, exactly like the AGL-2071 stop beside it.
 *
 * Returns the fee actually in force after the correction, so the recorded
 * `totals.feeCents` is what Aglyn kept rather than what Stripe first debited.
 * That closes AGL-2317's second-order half too: cycle 1 was recorded from
 * `metadata[feeCents]` (items only) while Stripe had charged percent-of-total,
 * so the same subscription's first and second cycles reported fees computed on
 * different bases.
 */
async function chargeSubscriptionFeeOnItemsOnly(
  invoice: any,
  hostId: string,
  invoiceId: string,
): Promise<number> {
  const chargedCents = Math.max(
    0,
    Math.round(Number(invoice?.application_fee_amount ?? 0)),
  )
  const desiredCents =
    CommerceModel.subscriptionInvoiceItemsOnlyFeeCents(invoice)
  // No fee, or nothing but items on the invoice. The overwhelming majority of
  // cycles land here and this function costs them nothing.
  if (!Number.isFinite(chargedCents) || chargedCents <= desiredCents) {
    return Number.isFinite(chargedCents) ? chargedCents : 0
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Subscription fee not corrected to the items-only base: STRIPE_SECRET_KEY is not set (AGL-2317)',
      { hostId, invoiceId },
    )
    return chargedCents
  }
  const chargeId = await resolveInvoiceChargeId(invoice, stripeKey)
  if (!chargeId) {
    console.error(
      'Subscription fee not corrected to the items-only base: the invoice names no charge (AGL-2317)',
      { hostId, invoiceId },
    )
    return chargedCents
  }
  const fees = await stripeGet(
    `https://api.stripe.com/v1/application_fees?limit=1&charge=${encodeURIComponent(
      chargeId,
    )}`,
    stripeKey,
  )
  const fee = fees.ok ? fees.body?.data?.[0] : null
  if (!fee?.id) {
    if (!fees.ok && isTransientStripeStatus(fees.status)) {
      throw new Error(
        `Stripe would not list the application fee for invoice ${invoiceId} ` +
          `(${fees.status})`,
      )
    }
    console.error(
      'Subscription fee not corrected to the items-only base: no application fee on the charge (AGL-2317)',
      { hostId, invoiceId, chargeId, status: fees.status },
    )
    return chargedCents
  }
  const feeAmount = Math.max(0, Math.round(Number(fee.amount ?? 0)))
  const alreadyRefunded = Math.max(
    0,
    Math.round(Number(fee.amount_refunded ?? 0)),
  )
  // What is still standing against the items-only target. A previous delivery
  // that already corrected this invoice leaves nothing here.
  const refundCents = feeAmount - alreadyRefunded - desiredCents
  if (refundCents <= 0) return desiredCents
  const response = await fetch(
    `https://api.stripe.com/v1/application_fees/${encodeURIComponent(
      String(fee.id),
    )}/refunds`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `fee-basis-${invoiceId}`,
      },
      body: new URLSearchParams({ amount: String(refundCents) }).toString(),
    },
  ).catch(() => null)
  if (!response || !response.ok) {
    if (!response || isTransientStripeStatus(response.status)) {
      // Let Stripe redeliver — the ledger write is keyed on the invoice id, so
      // a retry re-runs this and nothing else (the AGL-1743 discipline).
      throw new Error(
        `Stripe refused the items-only fee correction for invoice ${invoiceId} ` +
          `(${response ? response.status : 'network'})`,
      )
    }
    // Definitive: no redelivery fixes it, and throwing would have Stripe retry
    // the whole invoice forever. Record what was actually taken.
    console.error(
      `Stripe refused the items-only fee correction for ${invoiceId} (AGL-2317)`,
      await response.json().catch(() => null),
    )
    return chargedCents
  }
  return desiredCents
}

/**
 * THE SALES TAX ON A SUBSCRIPTION CYCLE, PULLED BACK TO THE PLATFORM
 * (AGL-1956).
 *
 * ## The leak
 *
 * Aglyn is the merchant of record on every buyer-facing path: storefront
 * charges are destination charges on Aglyn's own platform account, so where
 * Stripe Tax computes against Aglyn's registrations Aglyn is the party that
 * remits. `commerce-connect-transfer.ts` closes that for a ONE-OFF sale with a
 * fixed `transfer_data[amount]`.
 *
 * A Stripe Subscription accepts no `transfer_data[amount]` — only
 * `application_fee_percent` — so `checkout.ts` deliberately excludes
 * subscriptions from that helper. On a destination charge the fee form
 * transfers the WHOLE charge to the connected account and debits the fee at
 * the destination, and the charge has the tax inside it. AGL-2317 then refunds
 * the slice of the fee that was taken on tax and shipping back to the
 * merchant, which is correct as a FEE BASIS and makes the tax position
 * strictly worse: after both steps the merchant is holding **every cent** of a
 * tax Aglyn owes a state revenue office.
 *
 * The money is therefore already IN the connected account, and the only
 * instrument that moves it back is a TRANSFER REVERSAL. (Not a top-up — that
 * is the fix for the opposite residual, the shopper-chosen shipping the
 * one-off path under-transfers, and it points the other way.) The reversal
 * leaves the merchant with `items + shipping − itemsOnlyFee`, the identical
 * split `platformLiableTransferCents` fixes up front on the one-off path.
 *
 * ## Only where AGLYN is the liable party
 *
 * `subscriptionInvoiceTaxReversal` decides, off `automatic_tax.enabled` and
 * `automatic_tax.liability.type` and NEVER off the tax lines. A manual-rate
 * subscription bills a real Stripe Tax Rate (AGL-1751), so its cycles carry a
 * populated `total_taxes[]` that looks exactly like a Stripe Tax one — reading
 * the lines would reverse the merchant's own tax out of their payout, which is
 * this bug pointing the other way and worse, because it takes money that is
 * genuinely theirs.
 *
 * ## Idempotency: three independent guards, because a reversal applied twice
 * ## takes the merchant's money twice
 *
 * 1. **Our own record.** `subscriptions/{id}/taxReversals/{invoiceId}` is
 *    claimed in a transaction, and a delivery that finds `reversedCents` set
 *    returns before any Stripe call. Stripe sends `invoice.paid` AND
 *    `invoice.payment_succeeded` for one payment and redelivers on top of
 *    that, so this is the guard that actually fires in practice.
 * 2. **The transfer itself**, for the crash window between the POST landing
 *    and the record being written. The reversal carries
 *    `metadata[aglynTaxInvoiceId]`, so the next delivery finds it and ADOPTS
 *    it rather than creating a second one.
 * 3. **A per-ATTEMPT `Idempotency-Key`**, `…-{invoiceId}-{attempt}`, so a
 *    duplicate of the SAME attempt is handed Stripe's stored response instead
 *    of moving money again.
 *
 * ## Why the key carries an attempt number — MEASURED, and it contradicts the docs
 *
 * The key used to be `…-{invoiceId}` alone. Measured in test mode against the
 * live API, that is a permanent dead end for retries:
 *
 *   - a reversal refused with 400 is **stored** under the key, and replaying
 *     the same request returns the same 400 with `Idempotent-Replayed: true`
 *     (`tr_3U7rqHDYHP4psn7h3M8c405O`);
 *   - retrying the same key with a CORRECTED body is refused outright with
 *     `idempotency_error` — "Keys for idempotent requests can only be used
 *     with the same parameters" — and the transfer stayed at
 *     `amount_reversed=0`.
 *
 * Stripe's documentation says results are only saved once an endpoint has
 * begun executing and that validation failures are not saved. The observation
 * disagrees, and the observation is what ships. With a fixed key, a reversal
 * that failed once could NEVER succeed, and Aglyn would silently keep owing a
 * state money it never clawed back — a worse failure than the double-reversal
 * the key was defending against.
 *
 * So the key varies per attempt and the no-double-reversal guarantee moves
 * entirely onto guards 1 and 2, which do not depend on Stripe at all:
 *
 *   - two deliveries racing cannot both act, because the in-flight claim is
 *     taken in a TRANSACTION and only one can win it;
 *   - a delivery that crashed mid-flight releases its claim by staleness, and
 *     the next one finds its reversal on the transfer by metadata and ADOPTS
 *     it rather than creating a second.
 *
 * Guard 2 is therefore load-bearing rather than a nicety. The reversal
 * metadata was confirmed to round-trip on `GET /v1/transfers/{id}`
 * (`trr_1U7rrQDYHP4psn7ha7jtjgzj`), and the embedded `reversals` list is
 * re-read in full when Stripe says it has more.
 *
 * The marker doc is deliberately NOT the invoice document. `invoices/{id}`
 * existing IS the ledger's idempotency key, and a merge-set against a missing
 * path CREATES it (the AGL-1763 shape) — recording the reversal there would
 * make the cycle itself look already-recorded and lose the payment.
 *
 * ## Failure, and what a retry looks like
 *
 * TRANSIENT (network, 429, 5xx) throws: the marker is still unclaimed, so the
 * redelivery Stripe sends IS the retry, and everything it replays is idle.
 *
 * DEFINITIVE refusals record `reversedCents: 0` with a reason and do not
 * throw — no redelivery fixes them, and a throw would have Stripe retry the
 * whole invoice forever (the AGL-1743 lesson).
 *
 * INSUFFICIENT DESTINATION BALANCE is the one that is neither. Stripe will not
 * reverse more than the connected account holds, and money Aglyn owes a state
 * and does not have must never settle silently. So it records
 * `status: 'insufficient'` and `owedCents`, leaves `reversedCents` UNSET so
 * every later delivery re-attempts, and alerts staff. A partial reversal
 * records the same way, with `owedCents` carrying the shortfall.
 */
async function reverseSubscriptionTaxToPlatform(
  invoice: any,
  hostId: string,
  subscriptionRef: FirebaseFirestore.DocumentReference,
  invoiceId: string,
): Promise<void> {
  if (!invoiceId) return
  const decision = CommerceModel.subscriptionInvoiceTaxReversal(invoice)
  // The common cycle: a manual-rate store, an untaxed one, or a $0 /
  // fully-discounted invoice. Zero network calls, zero writes.
  if (decision.kind === 'skip') return

  const markerRef = subscriptionRef.collection('taxReversals').doc(invoiceId)

  /**
   * How long an in-flight claim is honoured before a later delivery may take
   * it over. A webhook handler that has not finished inside this has died;
   * guard 2 is what makes the takeover safe.
   */
  const CLAIM_STALE_MS = 10 * 60_000

  /**
   * Settles this invoice's reversal step exactly once.
   *
   * `reversedCents` present — 0 included — means settled, and every later
   * delivery returns before touching Stripe. The in-flight claim is dropped in
   * the same write so a settled row never looks busy.
   */
  const settle = async (
    reversedCents: number,
    fields: Record<string, unknown>,
  ): Promise<boolean> =>
    firebaseAdmin
      .app()
      .firestore()
      .runTransaction(async (transaction) => {
        const fresh = await transaction.get(markerRef)
        if (fresh.exists && fresh.get('reversedCents') != null) return false
        transaction.set(
          markerRef,
          {
            invoiceId,
            hostId,
            reversedCents,
            inFlightAtMs: null,
            settledAtMs: Date.now(),
            ...fields,
          },
          { merge: true },
        )
        return true
      })

  /**
   * Gives the claim back WITHOUT settling, so the next delivery takes a fresh
   * attempt number and therefore a fresh idempotency key. This is the whole
   * retry mechanism: a transient refusal and an insufficient destination
   * balance both land here.
   */
  const release = async (fields: Record<string, unknown> = {}) => {
    await markerRef
      .set({ invoiceId, hostId, inFlightAtMs: null, ...fields }, { merge: true })
      .catch(() => undefined)
  }

  /**
   * Takes the in-flight claim, or answers 0 when this delivery must stand
   * down. Only one of two racing deliveries can win the transaction, which is
   * what stops both of them reversing.
   */
  const claim = async (taxCents: number): Promise<number> =>
    firebaseAdmin
      .app()
      .firestore()
      .runTransaction(async (transaction) => {
        const fresh = await transaction.get(markerRef)
        if (fresh.exists) {
          if (fresh.get('reversedCents') != null) return 0
          const inFlight = Number(fresh.get('inFlightAtMs') ?? 0)
          if (
            Number.isFinite(inFlight) &&
            inFlight > 0 &&
            Date.now() - inFlight < CLAIM_STALE_MS
          ) {
            return 0
          }
        }
        // `strictNullChecks` is off repo-wide, so a malformed stored counter
        // would sail through as `NaN`, poison the idempotency key and be
        // rejected by Firestore. Guarded rather than trusted.
        const prior = Number(fresh.get('attempt') ?? 0)
        const attempt = (Number.isFinite(prior) ? Math.max(0, prior) : 0) + 1
        transaction.set(
          markerRef,
          {
            invoiceId,
            hostId,
            taxCents,
            attempt,
            inFlightAtMs: Date.now(),
          },
          { merge: true },
        )
        return attempt
      })

  if (decision.kind === 'unreadable') {
    // LOUD, and on the books. An invoice that claims automatic tax while
    // stating no tax field is a Stripe API-version change this repo cannot
    // see, not a $0 cycle — and treating it as "no tax" would leak the whole
    // liability with nothing looking wrong.
    console.error(
      'Subscription tax NOT reversed to the platform: the invoice states no readable tax (AGL-1956)',
      { hostId, invoiceId, reason: decision.reason },
    )
    await settle(0, { status: 'unreadable', reason: decision.reason })
    void notifyStaff({
      type: 'system.announcement',
      title: 'A subscription invoice stated no readable tax',
      body:
        `Invoice ${invoiceId} enables automatic tax but names no tax field, so ` +
        `no reversal was made. Aglyn may owe tax it did not pull back. ` +
        `${decision.reason}`,
    }).catch(() => undefined)
    return
  }

  const taxCents = decision.taxCents

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Subscription tax not reversed to the platform: STRIPE_SECRET_KEY is not set (AGL-1956)',
      { hostId, invoiceId },
    )
    return
  }

  // GUARD 1. Every ordinary redelivery stops here, before any Stripe call, and
  // two racing deliveries cannot both get past it.
  const attempt = await claim(taxCents)
  if (!attempt) return
  try {
    await runReversal(attempt)
  } catch (error) {
    // The claim must not outlive a failed attempt, or the redelivery Stripe
    // sends — which IS the retry — would find the row busy and stand down.
    await release({ status: 'retrying', taxCents, owedCents: taxCents })
    throw error
  }
  return

  async function runReversal(attemptNumber: number): Promise<void> {
    const chargeId = await resolveInvoiceChargeId(invoice, stripeKey)
    if (!chargeId) {
      // A taxed invoice settled entirely from a customer credit balance raises
      // no charge, so there is no transfer and nothing to pull back.
      console.error(
        'Subscription tax not reversed: the invoice names no charge (AGL-1956)',
        { hostId, invoiceId },
      )
      await settle(0, { status: 'no-charge', taxCents })
      return
    }
    const charge = await stripeGet(
      `https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}`,
      stripeKey,
    )
    if (!charge.ok) {
      if (isTransientStripeStatus(charge.status)) {
        throw new Error(
          `Stripe charge read failed (${charge.status}) for invoice ${invoiceId} (AGL-1956)`,
        )
      }
      console.error(
        'Subscription tax not reversed: Stripe refused the charge read (AGL-1956)',
        { hostId, invoiceId, chargeId, error: charge.body?.error },
      )
      await settle(0, { status: 'charge-unreadable', taxCents })
      return
    }
    const transferId = String(charge.body?.transfer ?? '')
    if (!transferId) {
      // No transfer means nothing was ever handed to the merchant — the tax is
      // already sitting on the platform balance.
      await settle(0, { status: 'no-transfer', taxCents, chargeId })
      return
    }
    const transfer = await stripeGet(
      `https://api.stripe.com/v1/transfers/${encodeURIComponent(transferId)}`,
      stripeKey,
    )
    if (!transfer.ok) {
      if (isTransientStripeStatus(transfer.status)) {
        throw new Error(
          `Stripe transfer read failed (${transfer.status}) for invoice ${invoiceId} (AGL-1956)`,
        )
      }
      console.error(
        'Subscription tax not reversed: Stripe refused the transfer read (AGL-1956)',
        { hostId, invoiceId, transferId, error: transfer.body?.error },
      )
      await settle(0, { status: 'transfer-unreadable', taxCents })
      return
    }
    // GUARD 2 — the crash window, and LOAD-BEARING now that the idempotency key
    // varies per attempt. A previous attempt's POST landed and its record did
    // not; adopt it rather than reversing the tax a second time.
    //
    // The embedded list is capped (Stripe returns the first 10), so a transfer
    // carrying more reversals than that is re-read in full. Missing an existing
    // reversal here would double-reverse, which is the one outcome this whole
    // function is built to prevent — worth the extra call in the rare case.
    let reversalList = (transfer.body?.reversals?.data ?? []) as any[]
    if (transfer.body?.reversals?.has_more === true) {
      const full = await stripeGet(
        `https://api.stripe.com/v1/transfers/${encodeURIComponent(
          transferId,
        )}/reversals?limit=100`,
        stripeKey,
      )
      if (!full.ok) {
        // Unknown is NOT "none": proceeding here could create a second reversal.
        throw new Error(
          `Stripe reversal list read failed (${full.status}) for invoice ${invoiceId} (AGL-1956)`,
        )
      }
      reversalList = (full.body?.data ?? []) as any[]
    }
    const adopted = reversalList.find(
      (item) => String(item?.metadata?.aglynTaxInvoiceId ?? '') === invoiceId,
    )
    if (adopted) {
      const adoptedCents = Math.max(0, Math.round(Number(adopted.amount ?? 0)))
      await settle(adoptedCents, {
        status: 'reversed',
        taxCents,
        transferId,
        reversalId: String(adopted.id ?? ''),
        adopted: true,
        ...(adoptedCents < taxCents
          ? { owedCents: taxCents - adoptedCents }
          : {}),
      })
      return
    }
    const transferCents = Math.max(0, Math.round(Number(transfer.body?.amount ?? 0)))
    const alreadyReversedCents = Math.max(
      0,
      Math.round(Number(transfer.body?.amount_reversed ?? 0)),
    )
    const remainingCents = Math.max(0, transferCents - alreadyReversedCents)
    const reverseCents = Math.min(taxCents, remainingCents)
    if (!(reverseCents > 0)) {
      // Nothing left on the transfer — a refund with `reverse_transfer` got here
      // first. The money is back on the platform balance either way; what Aglyn
      // must NOT do is call this settled without saying so.
      console.error(
        'Subscription tax not reversed: the transfer has nothing left (AGL-1956)',
        { hostId, invoiceId, transferId, transferCents, alreadyReversedCents },
      )
      await settle(0, {
        status: 'nothing-left',
        taxCents,
        transferId,
        owedCents: taxCents,
      })
      return
    }
    const response = await fetch(
      `https://api.stripe.com/v1/transfers/${encodeURIComponent(
        transferId,
      )}/reversals`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // GUARD 3, per ATTEMPT. Stripe stores a 4xx under the key and replays
          // it (measured — see the note on this function), so a key fixed on the
          // invoice alone would make a once-failed reversal permanently
          // unretryable. The attempt number comes from the claim above, so two
          // racing deliveries still cannot both reach this line.
          'Idempotency-Key': `subscription-tax-reversal-${invoiceId}-${attemptNumber}`,
        },
        body: new URLSearchParams({
          amount: String(reverseCents),
          'metadata[aglynTaxInvoiceId]': invoiceId,
          'metadata[hostId]': hostId,
        }).toString(),
      },
    ).catch(() => null)
    const body = response ? await response.json().catch(() => null) : null
    if (!response || !response.ok) {
      if (!response || isTransientStripeStatus(response.status)) {
        throw new Error(
          `Stripe refused the subscription tax reversal for invoice ${invoiceId} ` +
            `(${response ? response.status : 'network'}) (AGL-1956)`,
        )
      }
      // THE ONE THAT IS NEITHER TRANSIENT NOR FINAL. An insufficient destination
      // balance is money Aglyn owes a state and does not have, so it must stay
      // retryable: the claim is RELEASED rather than settled, and the next
      // delivery takes attempt+1 — a fresh idempotency key, which is the only
      // thing that lets Stripe execute it at all.
      const insufficient = String(body?.error?.code ?? '') === 'balance_insufficient'
      console.error(
        'Stripe refused the subscription tax reversal (AGL-1956)',
        { hostId, invoiceId, transferId, reverseCents, error: body?.error },
      )
      const failureFields = {
        taxCents,
        transferId,
        owedCents: taxCents,
        reason: String(body?.error?.message ?? ''),
      }
      if (insufficient) {
        await release({ status: 'insufficient', ...failureFields })
      } else {
        await settle(0, { status: 'refused', ...failureFields })
      }
      void notifyStaff({
        type: 'system.announcement',
        title: 'A subscription sales-tax reversal failed',
        body:
          `$${(taxCents / 100).toFixed(2)} of sales tax on invoice ${invoiceId} ` +
          `is still with the merchant and Aglyn owes it. ` +
          (insufficient
            ? 'The connected account had insufficient balance; this will retry.'
            : `Stripe refused: ${String(body?.error?.message ?? 'no reason given')}`),
      }).catch(() => undefined)
      return
    }
    const reversedCents = Math.max(0, Math.round(Number(body?.amount ?? reverseCents)))
    await settle(reversedCents, {
      status: 'reversed',
      taxCents,
      transferId,
      reversalId: String(body?.id ?? ''),
      // A transfer that could only give back part of the tax. Recorded so the
      // shortfall is a number somebody can query, not a rounding nobody sees.
      ...(reversedCents < taxCents ? { owedCents: taxCents - reversedCents } : {}),
    })
  }
}

/**
 * The seller's share of a LOST dispute, pulled back from the connected
 * account (AGL-1794).
 *
 * These are destination charges, so the disputed funds and the dispute fee
 * are debited from the PLATFORM's balance while the merchant keeps the
 * transfer — a merchant paid in full for a sale the shopper's bank took back,
 * with Aglyn out the principal. The decision (AGL-1794): the merchant eats
 * their share, by a `transfers/{id}/reversals` call keyed off the charge's
 * transfer. The platform still eats Stripe's dispute fee, DELIBERATELY: that
 * is the cost of owning the payment relationship, not the merchant's loss,
 * which is why no fee figure appears here or anywhere on the order.
 *
 * GROSS, NOT NET — the money question, settled on evidence (AGL-1794).
 *
 * Stripe transfers the FULL charge to the connected account and debits the
 * `application_fee_amount` at the DESTINATION, so `transfer.amount` equals
 * `charge.amount` and the merchant's own balance transaction reads
 * `amount 10000, fee 500, net 9500` (measured in test mode; AGL-1951 caught
 * the fixture here modelling it backwards). The proportional share below is
 * therefore the WHOLE principal, and the merchant hands back the gross while
 * Aglyn keeps its commission.
 *
 * ⚑ THAT EQUALITY IS NO LONGER UNIVERSAL (AGL-1956). A `mode: 'stripe'`
 * storefront sale now sends a FIXED `transfer_data[amount]` and no
 * application fee at all, because Stripe Tax on a platform session computes
 * against AGLYN's registrations and Aglyn remits it — the fee form would have
 * transferred the tax to the merchant. On those charges `transfer.amount` is
 * `goods + shipping − fee`, strictly LESS than `charge.amount`.
 *
 * Nothing below needed changing, and that is worth saying explicitly rather
 * than leaving to be rediscovered: the share is already computed as
 * `principal × transfer.amount ÷ charge.amount`, so the ratio simply stops
 * being 1 and the merchant hands back their share of the principal and no
 * part of the tax — which is correct, because the tax was never theirs and
 * Aglyn has to refund it to the shopper's bank out of its own balance. The
 * ratio was written for a partially-refunded transfer; it now earns its keep
 * on every taxed sale too.
 *
 * That asymmetry with the refund door is deliberate, not an oversight.
 * `refund.ts` sends `refund_application_fee: 'true'` alongside
 * `reverse_transfer`, so a REFUND returns Aglyn's commission; this door sends
 * no such flag, so a CHARGEBACK does not. The market was surveyed before
 * choosing: Shopify Payments, Etsy, eBay, PayPal and Square all take the gross
 * back from the seller and none return the platform's cut on a chargeback,
 * and most add a dispute fee on top ($15 Shopify, $20 eBay, $20 PayPal) that
 * Aglyn does not pass on. Stripe itself documents only the mechanism — the
 * `refund_application_fee` switch on a reversal — and takes no position on
 * which way to flip it, advising platforms to price the application fee to
 * absorb dispute costs rather than recover them per incident. Reversing NET
 * is the minority practice (Eventbrite is the clean example, and it absorbs
 * the bank fees too). **Do not add `refund_application_fee` to the POST below
 * without re-deciding the policy** — it is the one-parameter switch between
 * this and handing the commission back, and the reversal amount does not
 * change when it flips, so nothing else in the wire shape would give it away.
 *
 * PROPORTIONAL, NEVER MORE. The share of the reversed principal is
 * `reversedCents × transfer.amount ÷ charge.amount`, FLOORED, then capped
 * at what the transfer has left (`amount − amount_reversed`) — a transfer
 * partially reversed by an earlier `reverse_transfer` refund cannot be pulled
 * below its own remainder from here. The ratio is 1 on an untouched transfer,
 * by the measurement above; it earns its keep on a partially-refunded one.
 * The reversal CAN drive the connected account negative, which Stripe recovers
 * from future payouts; that is the policy, recorded on the order timeline in
 * words the merchant can read.
 *
 * IDEMPOTENT BY THE ORDER DOCUMENT, with the transfer itself as the crash
 * window's backstop. `dispute.reversedTransferCents` present — 0 included —
 * means this step settled, and a redelivery returns before any Stripe call.
 * A process killed between the POST landing and the record writing leaves
 * that marker unset, so the redelivery runs again: it finds the reversal
 * already sitting on the transfer (`metadata.disputeId`, stamped by the POST
 * below), ADOPTS it, and creates nothing. Under both, the POST carries an
 * `Idempotency-Key` derived from the dispute id, so even a delivery that
 * raced past both reads is handed Stripe's stored response rather than a
 * second reversal.
 *
 * DEFINITIVE failures record `reversedTransferCents: 0` with a timeline note
 * and DO NOT throw: a charge with no transfer on it, a transfer with nothing
 * left to reverse, Stripe refusing the request outright. No redelivery fixes
 * those, and a throw propagates through `runBillingWebhookHandlers` into a
 * 500 Stripe redelivers forever — the AGL-1743 lesson, applied the same way
 * `findOrderForDispute` applies it to the missing index. TRANSIENT failures
 * (a network reject, a 429, a 5xx) throw on purpose: the marker is still
 * unset, so the redelivery Stripe sends IS the retry, and the settle it
 * replays is idle so nothing else doubles.
 *
 * This runs OUTSIDE the settle transaction and re-reads the order itself,
 * because it must also run on a redelivery whose settle was idle — the
 * transient-failure path above depends on exactly that.
 *
 * RETURNS the cents this delivery pulled back and is therefore responsible
 * for announcing — 0 for every no-op, every definitive failure, and every
 * redelivery that found the step already settled. The caller's merchant
 * notification is keyed on it, so a non-zero answer must mean "the write
 * happened HERE, and nobody has told the merchant yet".
 */
async function reverseSellerShare(
  orderRef: FirebaseFirestore.DocumentReference,
  dispute: StripeDispute,
): Promise<number> {
  const disputeId = String(dispute?.id ?? '')
  if (!disputeId) return 0
  const snapshot = await orderRef.get()
  if (!snapshot.exists) return 0
  const order = CommerceModel.liftLegacyOrder((snapshot.data() ?? {}) as never)
  const stored = order.dispute
  // A different dispute has replaced the record, or the outcome on the books
  // is not a loss: nothing here to recover.
  if (stored?.id !== disputeId || stored.outcome !== 'lost') return 0
  // The settle marker — see the doc comment. 0 counts.
  if (stored.reversedTransferCents != null) return 0
  const principalCents = Number(stored.reversedCents ?? 0)
  // The order had nothing left to reverse — it was already fully refunded,
  // and `refund.ts` sent `reverse_transfer=true` when it was, so the seller's
  // share already went back by the refund door. No marker and no Stripe call:
  // the short-circuit is as idempotent as the write and cheaper.
  if (!(principalCents > 0)) return 0
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.error(
      'Transfer reversal skipped: STRIPE_SECRET_KEY is not set (AGL-1794)',
    )
    return 0
  }

  /**
   * Settles the step exactly once, whatever it found, and reports whether
   * THIS delivery was the one that wrote.
   *
   * The boolean is what makes the merchant notification once-only. The
   * pre-read above turns away every ordinary redelivery, but two deliveries
   * racing can both pass it and only one can win the transaction — so the
   * caller must learn its outcome from the write, not from having reached
   * this far. A notification is not idempotent by any doc key of its own.
   */
  const settle = async (
    reversedTransferCents: number,
    transferReversalId: string | null,
    note: string,
  ): Promise<boolean> => {
    return firebaseAdmin
      .app()
      .firestore()
      .runTransaction(async (transaction) => {
        const fresh = await transaction.get(orderRef)
        if (!fresh.exists) return false
        const current = CommerceModel.liftLegacyOrder(
          (fresh.data() ?? {}) as never,
        )
        const record = current.dispute
        if (record?.id !== disputeId || record.reversedTransferCents != null) {
          return false
        }
        transaction.update(orderRef, {
          // Written whole, the field's own rule — see `OrderDispute`.
          dispute: {
            ...record,
            reversedTransferCents,
            ...(transferReversalId ? { transferReversalId } : {}),
          },
          timeline: CommerceModel.appendOrderEvent(current, 'dispute', note),
        })
        return true
      })
  }

  const chargeId = String(dispute?.charge ?? '')
  if (!chargeId) {
    console.error('Dispute carries no charge; seller share not reversed', {
      disputeId,
    })
    await settle(
      0,
      null,
      'Seller share not reversed — no charge on the dispute',
    )
    return 0
  }
  const charge = await stripeGet(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    stripeKey,
  )
  if (!charge.ok) {
    if (isTransientStripeStatus(charge.status)) {
      throw new Error(
        `Stripe charge read failed (${charge.status}) for dispute ${disputeId}`,
      )
    }
    console.error(
      'Stripe refused the charge read; seller share not reversed',
      charge.body?.error,
    )
    await settle(
      0,
      null,
      'Seller share not reversed — charge not found at Stripe',
    )
    return 0
  }
  const transferId = String(charge.body?.transfer ?? '')
  const chargeAmountCents = Math.round(Number(charge.body?.amount ?? 0))
  if (!transferId || !(chargeAmountCents > 0)) {
    // An order from before destination charges, or a charge Stripe holds no
    // transfer for. Logged, recorded, let go.
    console.error(
      'No transfer on the disputed charge; seller share not reversed',
      {
        disputeId,
        chargeId,
      },
    )
    await settle(
      0,
      null,
      'Seller share not reversed — no transfer on the charge',
    )
    return 0
  }
  const transfer = await stripeGet(
    `https://api.stripe.com/v1/transfers/${transferId}`,
    stripeKey,
  )
  if (!transfer.ok) {
    if (isTransientStripeStatus(transfer.status)) {
      throw new Error(
        `Stripe transfer read failed (${transfer.status}) for dispute ${disputeId}`,
      )
    }
    console.error(
      'Stripe refused the transfer read; seller share not reversed',
      transfer.body?.error,
    )
    await settle(
      0,
      null,
      'Seller share not reversed — transfer not found at Stripe',
    )
    return 0
  }
  // The crash window's backstop: the POST landed on a previous delivery and
  // the record did not. Adopt what exists rather than creating a second one.
  const existing = ((transfer.body?.reversals?.data ?? []) as any[]).find(
    (item) => String(item?.metadata?.disputeId ?? '') === disputeId,
  )
  if (existing) {
    const adoptedCents = Math.round(Number(existing.amount ?? 0))
    // Announced on adoption too: the delivery that created this reversal died
    // before recording it, so it died before notifying. The money left the
    // connected account either way and the merchant has not been told yet.
    const wrote = await settle(
      adoptedCents,
      String(existing.id ?? ''),
      `$${(adoptedCents / 100).toFixed(2)} seller share reversed for lost dispute`,
    )
    return wrote ? adoptedCents : 0
  }
  const transferCents = Math.round(Number(transfer.body?.amount ?? 0))
  const alreadyReversedCents = Math.round(
    Number(transfer.body?.amount_reversed ?? 0),
  )
  const remainingCents = Math.max(0, transferCents - alreadyReversedCents)
  const shareCents = Math.min(
    chargeAmountCents > 0
      ? Math.floor((principalCents * transferCents) / chargeAmountCents)
      : 0,
    remainingCents,
  )
  if (!(shareCents > 0)) {
    console.error(
      'Transfer has nothing left to reverse; seller share not reversed',
      { disputeId, transferId, transferCents, alreadyReversedCents },
    )
    await settle(
      0,
      null,
      'Seller share already reversed on the transfer — nothing left to pull back',
    )
    return 0
  }
  const params = new URLSearchParams({
    amount: String(shareCents),
    'metadata[disputeId]': disputeId,
    'metadata[orderId]': orderRef.id,
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
        `Stripe transfer reversal failed (${response.status}) for dispute ${disputeId}`,
      )
    }
    console.error('Stripe refused the transfer reversal', reversal?.error)
    await settle(
      0,
      null,
      'Seller share not reversed — Stripe refused the reversal',
    )
    return 0
  }
  const reversedTransferCents = Math.round(
    Number(reversal?.amount ?? shareCents),
  )
  const wrote = await settle(
    reversedTransferCents,
    String(reversal?.id ?? ''),
    `$${(reversedTransferCents / 100).toFixed(2)} seller share reversed for lost dispute`,
  )
  return wrote ? reversedTransferCents : 0
}

/**
 * Commerce sections of the platform Stripe webhook (AGL-418): relocated
 * verbatim from the console route — subscriptions sync, reservations,
 * cart orders, draft orders, Commerce Starter orders, plus the license-key
 * assignment helper (AGL-308). Registered via registerCommerceConsoleApi;
 * every section is idempotent by doc key and self-selects on
 * `object.metadata.type`, exactly as the inline route sections did.
 */
export const commerceBillingWebhookHandler: BillingWebhookHandler = async ({
  type,
  object,
  event,
  requestHost,
}) => {
  // Connect readiness, kept fresh (AGL-1997). Every commerce money route —
  // checkout, cart checkout, draft orders, reservations, POS — gates the sale
  // on the CACHED `stripeChargesEnabled` written by the connect route. Nothing
  // refreshed it but the merchant reopening that route, so a merchant Stripe
  // later restricted kept selling on a stale `true` and the shopper met the
  // failure at payment time.
  //
  // FIRST and with an early return: this event shares nothing with the order
  // sections below, and returning here keeps it out of every `metadata.type`
  // test. `syncConnectAccountStatus` mirrors current state, so a redelivery is
  // harmless.
  // `event.livemode`, not `object.livemode` (AGL-2471): the Stripe Account
  // object carries no `livemode` field, but the event announcing it does, and
  // that is what lets a linkage whose mode was never recorded heal itself
  // instead of staying refused forever.
  if (type === 'account.updated') {
    await syncConnectAccountStatus('profiles', object, event?.livemode)
    return
  }

  // A DEAD SESSION GIVES ITS RESERVATIONS BACK (AGL-2453).
  //
  // Stripe expires a Checkout Session 24 hours after creation, and emits this
  // when the shopper abandons it or cancels out of it — there is no separate
  // "cancelled" event, because `cancel_url` is a redirect and not a state
  // change. This is therefore the explicit release path for everything a
  // checkout reserved before the money moved.
  //
  // Holds also carry `expiresAtMs` and every read prunes them, so correctness
  // does NOT depend on this handler firing (and it will not fire at all unless
  // the endpoint subscribes to the event). But a merchant watching a cap of 100
  // sit at 100 for a day after one abandoned cart, with nothing in the product
  // able to explain why, is the failure the TTL alone leaves standing — an
  // invisible expiry is not a release anyone can reason about.
  //
  // Same early return as `account.updated`: this event carries no order and
  // shares nothing with the `checkout.session.completed` sections below.
  if (type === 'checkout.session.expired') {
    const expiredHostId = String(object?.metadata?.hostId ?? '')
    if (!expiredHostId) return
    const expiredHostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(expiredHostId)
    // THE UNITS COME BACK FIRST (AGL-2356), because they are the reservation a
    // shopper is actually waiting on. A discount slot sitting against a cap is
    // a merchant-facing annoyance; a held unit is a sale the store cannot make,
    // and this event is what turns an abandoned checkout back into stock inside
    // a minute rather than at the TTL.
    //
    // Correctness does not depend on this firing — every read prunes lapsed
    // holds, so a unit is never stranded waiting on a webhook, and it will not
    // fire at all unless the endpoint subscribes to the event. What it buys is
    // that the shelf and the storefront agree PROMPTLY, which is the difference
    // between a hold a merchant can reason about and one they cannot.
    await releaseStockHold(
      expiredHostRef,
      String(object?.metadata?.stockHoldKey ?? ''),
    )
    const couponHoldKey = String(object?.metadata?.couponHoldKey ?? '')
    const couponCode = String(object?.metadata?.couponCode ?? '')
    if (couponHoldKey && couponCode) {
      await releasePromotionHold(
        expiredHostRef.collection('coupons').doc(couponCode),
        couponHoldKey,
      )
    }
    const discountHoldKey = String(object?.metadata?.discountHoldKey ?? '')
    const discountId = String(object?.metadata?.discountId ?? '')
    if (discountHoldKey && discountId) {
      await releasePromotionHold(
        expiredHostRef.collection('discounts').doc(discountId),
        discountHoldKey,
      )
    }
    // The gift-card hold rides along, because it is the same act on the same
    // event and AGL-2449 left it to the TTL alone. A shopper whose abandoned
    // checkout stands their own balance off for a day cannot be told why
    // either, and the release is the identical delete sentinel.
    const giftCardHoldKey = String(object?.metadata?.giftCardHoldKey ?? '')
    const giftCardCode = String(object?.metadata?.giftCardCode ?? '')
    if (giftCardHoldKey && giftCardCode) {
      await expiredHostRef
        .collection('giftCards')
        .doc(giftCardCode)
        .set(
          {
            holds: {
              [giftCardHoldKey]: firebaseAdmin.firestore.FieldValue.delete(),
            },
          },
          { merge: true },
        )
        .catch((error: unknown) => {
          console.error('Gift card hold release failed', giftCardCode, error)
        })
    }
    return
  }

  // White-label brand per host (White-Label Phase 3): every storefront email
  // this webhook sends — receipts, gift cards, reservation and sale notices,
  // supplier notices — reads as the store's brand. Resolved once per host from
  // the org doc through the one shared resolver, memoized for the event.
  const brandCache = new Map<string, Aglyn.ResolvedBrandingProfile>()
  const brandFor = async (
    hostId: string | number,
  ): Promise<Aglyn.ResolvedBrandingProfile> => {
    const key = String(hostId)
    const cached = brandCache.get(key)
    if (cached) return cached
    const org = await getOrgForHost(key).catch(() => null)
    const brand = Aglyn.resolveBrandingProfile(org?.org as never)
    brandCache.set(key, brand)
    return brand
  }

  // Storefront sales tax (AGL-1904), FIRST and unconditionally: a
  // `mode: 'stripe'` store's shopper is charged tax computed on AGLYN's own
  // registrations — the session is created on the platform account with no
  // `Stripe-Account` header and no `on_behalf_of`, and Stripe reports
  // `automatic_tax.liability: { type: 'self' }` on it (measured, see
  // `storefront-tax.ts`). That money settles into Aglyn's balance and Aglyn's
  // quarterly return could not see a cent of it.
  //
  // Ahead of the branch chain on purpose: every one of the sections below
  // early-returns on its own redelivery guard (`if (!created) return`), so a
  // recorder placed inside or after them would silently stop recording the
  // moment an order document already existed. This is idempotent by Stripe
  // object id, so running on every delivery is the correct behaviour.
  //
  // AWAITED and never allowed to throw: a lost row is an understated tax
  // return, and `recordStorefrontTax` swallows its own failures precisely so
  // this cannot turn a recording problem into a redelivered billing webhook.
  await recordStorefrontTax(String(type), object)

  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
      // Storefront subscription status sync (AGL-303).
      if (object?.metadata?.type === 'commerce-subscription') {
        const subHostId = object?.metadata?.hostId
        if (subHostId) {
          await firebaseAdmin
            .app()
            .firestore()
            .collection('hosts')
            .doc(String(subHostId))
            .collection('subscriptions')
            .doc(String(object.id))
            .set(
              {
                status:
                  type === 'customer.subscription.deleted'
                    ? 'canceled'
                    : String(object?.status ?? 'active'),
                currentPeriodEndMs: object?.current_period_end
                  ? object.current_period_end * 1000
                  : null,
              },
              { merge: true },
            )
            .catch(() => undefined)
        }
      }
  }

    // Storefront subscriptions (AGL-303): record the sub under the host;
    // status then follows customer.subscription.* events below.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-subscription' &&
      object?.subscription
    ) {
      const { hostId, productId } = object.metadata ?? {}
      if (hostId && productId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        // AGL-1732: this branch used to write the subscription doc and stop —
        // productId, email, name, customer id, status. NO money, anywhere. Not
        // as an order (subscriptions are deliberately not orders: the docs, the
        // console and the tenant account page all keep the two apart), but not
        // on the subscription doc either, and not in the manager notification
        // or the contact record. A merchant asking "what is this subscriber
        // paying me?" had exactly one answer available: log in to Stripe.
        //
        // The sale is now decomposed and stored ON THE SUBSCRIPTION, which is
        // the record this product already treats as the subscription's home.
        // `computeBuyNowOrder` is the right decomposition rather than a
        // parallel one: a subscription session is built by the SAME
        // `checkout.ts` function, carrying the same `unitAmountCents` /
        // `quantity` / `taxCents` / `discountCents` metadata snapshot, so the
        // two sessions differ only in `mode`. It reads Stripe's own
        // `total_details` through `computeCheckoutSessionTotals` — including
        // the `amount_shipping` AGL-1698 added — so nothing here re-derives a
        // figure Stripe already holds.
        //
        // This records the INITIAL charge only. Renewals arrive as
        // `invoice.payment_succeeded`, which this webhook does not handle at
        // all; see the follow-up filed with AGL-1732.
        const productForSnapshot = await hostRef
          .collection('products')
          .doc(String(productId))
          .get()
        const liftedForSnapshot = CommerceModel.liftLegacyProduct(
          (productForSnapshot.data() as any) ?? { name: 'Product' },
        )
        const soldVariant = object.metadata?.variantId
          ? liftedForSnapshot.variants.find(
              (item) => item.id === String(object.metadata.variantId),
            )
          : liftedForSnapshot.variants[0]
        const variantOptions = Object.values(soldVariant?.options ?? {})
        const { lineItems: subLineItems, totals: subTotals } =
          CommerceModel.computeBuyNowOrder(object, {
            name: String(productForSnapshot.get('name') ?? 'Product'),
            ...(variantOptions.length
              ? { variantLabel: variantOptions.join(' / ') }
              : {}),
            ...(soldVariant?.sku ? { sku: soldVariant.sku } : {}),
            ...(liftedForSnapshot.type
              ? { productType: liftedForSnapshot.type }
              : {}),
          })
        const subscriptionRef = hostRef
          .collection('subscriptions')
          .doc(String(object.subscription))
        // Redelivery guard (AGL-1732, the AGL-498 shape). Stripe delivers at
        // least once, and the effects below this write are NOT idempotent —
        // `upsertHostContact`'s `purchaseCents` is a `FieldValue.increment`, so
        // a replay would inflate the subscriber's lifetime value and their
        // order count on every retry.
        //
        // Keyed on `checkoutSessionId` rather than on the document existing:
        // `customer.subscription.created` writes the SAME doc path (status and
        // period end only) and Stripe does not order the two events, so an
        // existence check would discard the sale record whenever that event
        // won the race.
        const recorded = await firestore.runTransaction(async (transaction) => {
          const existing = await transaction.get(subscriptionRef)
          if (existing.get('checkoutSessionId') === String(object.id)) {
            return false
          }
          transaction.set(
            subscriptionRef,
            {
              productId: String(productId),
              ...(object.metadata?.variantId
                ? { variantId: String(object.metadata.variantId) }
                : {}),
              customerEmail: object?.customer_details?.email ?? null,
              customerName: object?.customer_details?.name ?? null,
              stripeCustomerId: String(object?.customer ?? '') || null,
              status: 'active',
              // What was bought, and for how much (AGL-1732). The interval
              // comes from the product doc because the amount alone is
              // ambiguous — $50 a month and $50 a year are the same number.
              lineItems: subLineItems,
              totals: subTotals,
              ...(liftedForSnapshot.subscription?.interval
                ? { interval: liftedForSnapshot.subscription.interval }
                : {}),
              checkoutSessionId: String(object.id),
              createdAtMs: Date.now(),
              // WHICH TAX this subscription will bill, for as long as it
              // lives (AGL-2323).
              //
              // A subscription bills on its own, and the mechanism attached at
              // the sale is the one every future invoice uses. The record kept
              // none of it: what was bought and for how much, and nothing at
              // all about the regime that produced the tax inside that figure.
              //
              // That absence is what made AGL-2323 unanswerable rather than
              // merely unfixed. "Which subscriptions predate AGL-1751 and bill
              // untaxed from cycle two?" and "which subscribers still carry a
              // rate their merchant has since corrected?" are questions about
              // the back book, and the only place the answer lived was a live
              // Stripe enumeration — the mutation-adjacent operation nobody
              // wants to run to find out whether they need to run it.
              //
              // ONE derivation, in the two-argument form the cart, draft and
              // buy-now order doors already use (AGL-2451), so this record,
              // the order minted for each cycle and the
              // `storefrontTaxCollected` row filed for the same Stripe id
              // cannot state three different regimes. The second argument
              // carries the pre-AGL-1751 shape, where the manual tax rode
              // `metadata[taxCents]` and `total_details.amount_tax` read 0.
              taxMode: storefrontTaxModeOf(
                object,
                Number(object?.metadata?.taxCents ?? 0),
              ),
              // The rate's IDENTITY, from the metadata `checkout.ts` stamps —
              // the session cannot answer it, because `line_items` is not
              // expanded on a delivered event. `taxMode` separates manual from
              // Stripe Tax; these two say WHICH manual rate, which is the only
              // thing that makes rate drift detectable without a Stripe read.
              // Absent where there is no merchant rate to name, never filled
              // with a plausible zero (AGL-1904).
              ...(object?.metadata?.taxRateId
                ? { taxRateId: String(object.metadata.taxRateId) }
                : {}),
              ...(Number(object?.metadata?.taxPct) > 0
                ? { taxRatePct: Number(object.metadata.taxPct) }
                : {}),
            },
            { merge: true },
          )
          return true
        })
        if (!recorded) return
        const subscriptionCents = Number(subTotals.totalCents ?? 0)
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          // The amount rides the title exactly as the order notification's
          // does (AGL-1732) — "New subscriber" alone never said what for.
          title: `New subscriber — $${(subscriptionCents / 100).toFixed(2)}${
            liftedForSnapshot.subscription?.interval
              ? `/${liftedForSnapshot.subscription.interval}`
              : ''
          }`,
          ...(object?.customer_details?.email
            ? { body: object.customer_details.email }
            : {}),
          link: `/${hostId}/products`,
        })
        // AWAITED SINCE AGL-2473, here and at the five sibling call sites in
        // this file. `upsertHostContact` carries `purchaseCents`, so it is what
        // feeds `ltvCents` and the RFM ranking — a `void`ed one is a paying
        // customer quietly missing from the segment the merchant emails. It
        // touches only our own Firestore, which is the whole line AGL-2473
        // drew: Aglyn's own storage is awaited, a stranger's server is queued.
        // `refund.ts` already awaited its sibling for exactly this reason.
        await upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          // RFM (AGL-328) counted a subscriber as having spent nothing, so
          // the customer paying every month looked colder than a one-off
          // buyer. The initial charge is real money and belongs in LTV.
          ...(subscriptionCents > 0 ? { purchaseCents: subscriptionCents } : {}),
          interaction: {
            refId: String(object.subscription),
            summary: `Started a subscription ($${(subscriptionCents / 100).toFixed(2)})`,
          },
        })
      }
    }

    // Storefront subscription RENEWALS (AGL-1743).
    //
    // `invoice.payment_succeeded` was unhandled repo-wide, so after AGL-1732
    // gave the INITIAL charge a home, month 2 onward still took the customer's
    // money and produced no record anywhere — not in orders, not in analytics,
    // not on the contact's `ltvCents`, not on the subscription document, whose
    // `totals` stayed frozen at the opening charge however the real one moved.
    //
    // ## What a cycle produces (AGL-1750 answered AGL-1743's open question)
    //
    // Every paid invoice is recorded as its own document under the
    // subscription — the ledger this product was missing — and rolled up onto
    // the subscription itself, which is the record the member drawer reads.
    //
    // A PHYSICAL subscription's cycle ALSO mints an order, on channel
    // `subscription` (AGL-1750). A monthly box is a shipment obligation, and
    // an invoice record is a receipt, not a work order: with no order there
    // is nothing to pick, pack, print a label against or mark fulfilled, and
    // recurring revenue is invisible to every surface that reads `orders`.
    // The opening cycle mints one too — its box ships like any other — while
    // its contact/notification fan-out stays with AGL-1732's branch. Digital
    // and service subscriptions still produce NO order: nothing ships, so
    // AGL-1732's "a subscription is not an order" stands for them, on the
    // same three sources (merchant docs, console separation, account page).
    //
    // ## Both invoice events, one record
    //
    // Stripe sends `invoice.paid` AND `invoice.payment_succeeded` for the same
    // payment, and which of them this endpoint receives is dashboard
    // configuration no code in this repo can see (the console route handles
    // `invoice.paid` for PLATFORM billing, which is the only evidence either
    // is enabled). Handling both means the branch fires whichever is on; the
    // invoice-id guard means having both on records the cycle once.
    if (type === 'invoice.payment_succeeded' || type === 'invoice.paid') {
      // The SUBSCRIPTION's metadata, which is what `checkout.ts` sets
      // (`subscription_data[metadata]`) — the invoice's own `metadata` is a
      // different, empty bag. `parent.subscription_details` is where newer API
      // versions moved it; both are read because the endpoint's version is not
      // visible from here.
      const subscriptionMeta =
        object?.subscription_details?.metadata ??
        object?.parent?.subscription_details?.metadata ??
        null
      const invoiceId = String(object?.id ?? '')
      const subscriptionId = String(
        object?.subscription ??
          object?.parent?.subscription_details?.subscription ??
          '',
      )
      const invoiceHostId = String(subscriptionMeta?.hostId ?? '')
      // Platform billing — Aglyn charging its own customers — runs through the
      // same endpoint and the same fan-out, and its invoices carry `orgId`
      // instead. Self-selection is on the same discriminator every other
      // section of this file uses.
      if (
        subscriptionMeta?.type === 'commerce-subscription' &&
        invoiceHostId &&
        subscriptionId &&
        invoiceId
      ) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(invoiceHostId)
        const subscriptionRef = hostRef
          .collection('subscriptions')
          .doc(subscriptionId)
        const invoiceRef = subscriptionRef.collection('invoices').doc(invoiceId)
        // The plan, RE-ASKED at the cycle (AGL-2071). `checkout.ts:132/149`
        // asked it when the subscription was SOLD, and that answer is all this
        // renewal would otherwise have — an answer that can be months stale
        // and is the wrong one the moment the merchant's own subscription
        // dies. The org doc is read whole (`getOrgDoc` projects nothing), so
        // `plan`, `subscriptionStatus` and `entitlements` are all present for
        // `resolveEffectivePlan` to collapse a dead subscription to `free`.
        //
        // BOTH flags, because `checkout.ts` required both to create this
        // subscription: `commerce` (Starter+) opens the storefront and
        // `storefrontSubscriptions` (Business+) is what makes a recurring
        // product sellable at all. A Business org that drops to Pro still has
        // a storefront and must still stop billing subscribers.
        //
        // A FAILED READ IS NOT AN ANSWER (AGL-2258). The `.catch(() => null)`
        // here made a transient Firestore failure indistinguishable from a
        // lapsed org: `checkEntitlement(null, …)` resolves through
        // `resolveOrgEntitlements(null)` to the FREE plan, so a moment of
        // unavailability cancelled a healthy merchant's subscriber at period
        // end and notified them their plan no longer covers subscriptions.
        //
        // Failing closed against a MISSING org is right and is kept — an
        // unindexed host has no storefront, and that is an answer. Failing
        // closed against an unreadable one is not: the two failure directions
        // are wildly asymmetric. Skipping the stop costs Aglyn one cycle at
        // the wrong take rate and the next cycle re-asks; taking it costs a
        // paying merchant a subscriber, irreversibly, on a question we never
        // actually asked.
        let renewalOrgUnreadable = false
        const renewalOrg = (
          await getOrgForHost(invoiceHostId).catch((error) => {
            renewalOrgUnreadable = true
            console.error(
              'Renewal plan check could not read the org; the lapse stop is skipped for this cycle (AGL-2258)',
              { hostId: invoiceHostId, subscriptionId },
              error,
            )
            return null
          })
        )?.org
        const renewalEntitled =
          Aglyn.checkEntitlement(renewalOrg as any, 'commerce') &&
          Aglyn.checkEntitlement(renewalOrg as any, 'storefrontSubscriptions')
        // The product identity comes from what the sale already recorded: an
        // invoice line knows a description and a price, never a productId, a
        // variant or a SKU. Subscriptions sold before AGL-1732 have no stored
        // line items, so those fall back to the product doc — one extra read,
        // and only for them.
        const soldSnapshot = await subscriptionRef.get()
        const soldLine = ((soldSnapshot.get('lineItems') ?? []) as
          | CommerceModel.OrderLineItem[]
          | undefined)?.[0]
        const productId = String(
          soldLine?.productId ??
            soldSnapshot.get('productId') ??
            subscriptionMeta?.productId ??
            '',
        )
        let snapshot: CommerceModel.BuyNowProductSnapshot & {
          productId: string
          variantId?: string
        }
        if (soldLine) {
          snapshot = {
            productId,
            ...(soldLine.variantId ? { variantId: soldLine.variantId } : {}),
            name: soldLine.name,
            ...(soldLine.variantLabel
              ? { variantLabel: soldLine.variantLabel }
              : {}),
            ...(soldLine.sku ? { sku: soldLine.sku } : {}),
            ...(soldLine.productType
              ? { productType: soldLine.productType }
              : {}),
          }
        } else {
          // AGL-1763: no product id, no read. `doc('__missing__')` was a
          // deliberate miss that Firestore does not permit — a document id
          // matching `__.*__` is RESERVED, so the backend rejects the path with
          // `INVALID_ARGUMENT` rather than returning an absent snapshot. And
          // `runBillingWebhookHandlers` lets the first throw propagate, so that
          // rejection would have dropped the whole renewal into the route's
          // error path with the money unrecorded and Stripe re-delivering into
          // the same throw. Narrow — `checkout.ts:323` always sets
          // `subscription_data[metadata][productId]` — but it is reachable for
          // exactly the population this branch now serves: a subscription
          // Aglyn has no record of, whose metadata nothing of ours wrote.
          const productSnapshot = productId
            ? await hostRef.collection('products').doc(productId).get()
            : null
          const lifted = CommerceModel.liftLegacyProduct(
            (productSnapshot?.data() as any) ?? { name: 'Subscription' },
          )
          const variantId = String(soldSnapshot.get('variantId') ?? '')
          const variant = variantId
            ? lifted.variants.find((item) => item.id === variantId)
            : lifted.variants[0]
          const variantOptions = Object.values(variant?.options ?? {})
          snapshot = {
            productId,
            ...(variantId ? { variantId } : {}),
            name: String(productSnapshot?.get('name') ?? 'Subscription'),
            ...(variantOptions.length
              ? { variantLabel: variantOptions.join(' / ') }
              : {}),
            ...(variant?.sku ? { sku: variant.sku } : {}),
            // Only a product Aglyn has actually seen states a type.
            // `liftLegacyProduct` defaults an absent `type` to `physical`,
            // which is right for a real legacy doc and a FABRICATION for the
            // `{ name: 'Subscription' }` placeholder — and now that `physical`
            // mints orders and decrements stock (AGL-1750), a guessed type
            // would manufacture fulfilment work for a product that may not
            // ship (AGL-1837).
            ...(productSnapshot?.exists && lifted.type
              ? { productType: lifted.type }
              : {}),
          }
        }
        // ITEMS ONLY (AGL-2317), before anything is recorded. Stripe applied
        // `application_fee_percent` to the whole invoice; the part of that fee
        // taken on sales tax and shipping goes back to the merchant, and what
        // is left is the figure the ledger stores. A transient Stripe failure
        // throws here rather than filing a fee we did not end up charging —
        // the redelivery re-runs it behind the invoice-id guard below.
        const feeCentsInForce = await chargeSubscriptionFeeOnItemsOnly(
          object,
          invoiceHostId,
          invoiceId,
        )
        const { lineItems: invoiceLineItems, totals: computedInvoiceTotals } =
          CommerceModel.computeSubscriptionInvoiceOrder(object, snapshot)
        // `computeSubscriptionInvoiceOrder` reads `application_fee_amount`
        // verbatim, which is what Stripe DEBITED, not what Aglyn kept.
        const invoiceTotals: CommerceModel.OrderTotals = {
          ...computedInvoiceTotals,
          feeCents: feeCentsInForce,
        }
        const paidCents = Math.max(0, Math.round(Number(object?.amount_paid ?? 0)))
        const billingReason = String(object?.billing_reason ?? '')
        // The subscription's FIRST invoice is also a paid invoice, and
        // `checkout.session.completed` has already counted that money into the
        // contact's lifetime value and already told the managers about it
        // (AGL-1732). Recording it again would double every subscriber's
        // opening value. It is still written as an invoice document — that is
        // the ledger, and it must not have a hole where cycle 1 belongs.
        const isOpeningInvoice = billingReason === 'subscription_create'
        const interval = CommerceModel.subscriptionInvoiceInterval(object)
        const paidAtMs = object?.status_transitions?.paid_at
          ? Number(object.status_transitions.paid_at) * 1000
          : Date.now()
        const periodEndMs = object?.period_end
          ? Number(object.period_end) * 1000
          : null
        // A physical cycle's fulfilment artifact (AGL-1750). The order's doc
        // id IS the invoice id, so the invoice-existence guard inside the
        // transaction below covers it too and a Stripe redelivery cannot
        // double-create (`in_…` never matches the reserved `__.*__` pattern).
        // Gated on a KNOWN physical type: `snapshot.productType` comes from
        // the recorded sale line or a product document actually read, never
        // from a default — a guessed type would manufacture shipment work.
        // Gated on the invoice actually BILLING the product too: a trial's
        // opening invoice is $0 with no lines — nothing ships until the trial
        // converts — whereas a 100%-off cycle still lists the product line
        // (Stripe discounts at the invoice level), and its box still ships.
        const cycleLine = invoiceLineItems.find(
          (line) => line.productId === productId,
        )
        const shipsPhysically =
          snapshot.productType === 'physical' &&
          Boolean(productId) &&
          Boolean(cycleLine)
        const orderRef = hostRef.collection('orders').doc(invoiceId)
        const counterRef = hostRef.collection('counters').doc('orders')
        // An invoice's shipping block is `customer_shipping` — it is NOT a
        // session's `shipping_details`, and an invoice has no
        // `customer_details` either. Fall back to the billing
        // `customer_address` + `customer_name` pair, the same
        // shipping-else-billing fallback the cart branch takes.
        const invoiceShipping = object?.customer_shipping?.address
          ? object.customer_shipping
          : object?.customer_address
            ? { name: object?.customer_name, address: object.customer_address }
            : null
        // Hoisted alongside `periodEndMs` (AGL-1763): the reconstruction below
        // dates the record from it, so the two must not drift.
        const periodStartMs = object?.period_start
          ? Number(object.period_start) * 1000
          : null
        // Idempotency, keyed on the INVOICE id (AGL-1743). Existence of the
        // invoice document IS that key — the doc id is the invoice id — and
        // unlike the AGL-1732 guard, which could not use existence because
        // `customer.subscription.created` writes the same subscription path,
        // nothing but this branch ever writes here. It also absorbs the
        // `invoice.paid` / `invoice.payment_succeeded` pair for one payment.
        //
        // The roll-up accumulates by reading inside the transaction rather
        // than with `FieldValue.increment`: the read is already happening for
        // the guard, and a lifetime total that can only be verified by
        // replaying every event is not a total a merchant can reconcile.
        const recorded = await firestore.runTransaction(async (transaction) => {
          const existingInvoice = await transaction.get(invoiceRef)
          if (existingInvoice.exists) return false
          const currentSubscription = await transaction.get(subscriptionRef)
          // Read (Firestore transactions read before they write) only when a
          // number will actually be allocated — a digital cycle must not
          // advance the merchant's order sequence.
          const orderCounter = shipsPhysically
            ? await transaction.get(counterRef)
            : null
          transaction.set(invoiceRef, {
            invoiceId,
            subscriptionId,
            billingReason,
            ...(object?.number ? { number: String(object.number) } : {}),
            currency: String(object?.currency ?? 'usd'),
            paidCents,
            /** Stripe's own total, which a credit balance can exceed. */
            invoiceTotalCents: Math.max(
              0,
              Math.round(Number(object?.total ?? paidCents)),
            ),
            lineItems: invoiceLineItems,
            totals: invoiceTotals,
            ...(interval ? { interval } : {}),
            paidAtMs,
            periodStartMs,
            periodEndMs,
            customerEmail:
              object?.customer_email ??
              currentSubscription.get('customerEmail') ??
              null,
            ...(object?.hosted_invoice_url
              ? { hostedInvoiceUrl: String(object.hosted_invoice_url) }
              : {}),
          })
          const rollup = {
            lastInvoiceId: invoiceId,
            lastPaymentCents: paidCents,
            lastPaymentAtMs: paidAtMs,
            ...(periodEndMs ? { paidThroughMs: periodEndMs } : {}),
            paidCents:
              Math.max(0, Number(currentSubscription.get('paidCents') ?? 0)) +
              paidCents,
            invoicesCount:
              Math.max(
                0,
                Number(currentSubscription.get('invoicesCount') ?? 0),
              ) + 1,
            // What the subscriber pays NOW, replacing the frozen opening
            // charge — the divergence this issue is about. Never from the
            // opening invoice, whose richer decomposition the session
            // already stored, and never from a zero one: a trial's first
            // invoice is $0 and would wipe the recorded sale to nothing.
            ...(!isOpeningInvoice && paidCents > 0
              ? { totals: invoiceTotals, ...(interval ? { interval } : {}) }
              : {}),
          }
          // AGL-1763: `currentSubscription` was READ here and never asked
          // whether it EXISTS. The roll-up went out as an unguarded merge-set,
          // and a merge-set against a missing path CREATES the document — so a
          // renewal for a subscription Aglyn had no record of minted one out of
          // the roll-up alone: `paidCents`, `invoicesCount`, `lastPayment*` and
          // nothing else. No `productId`, no `customerEmail`, no
          // `stripeCustomerId`, no `status`, no `createdAtMs`.
          //
          // That is worse than it sounds, because EVERY reader of this
          // collection filters on a field the stub lacks, and so cannot see it
          // at all: `gate.ts:72` and `membership-account.ts:155` query
          // `where('customerEmail', '==', …)`, `subscription-portal.ts:49` does
          // the same and 404s "No subscription found", `member-post.ts:88`
          // filters on `status`, and `order-analytics.ts:187` queries
          // `checkoutSessionId`. The result was a money-bearing orphan — a
          // total climbing every cycle inside a document nothing in the product
          // can find — while the subscriber paying it got no content access and
          // no route to the billing portal that would let them cancel.
          //
          // WHY THIS ONE CREATES RATHER THAN REFUSES. A renewal is real money
          // that Stripe has already taken, so refusing it would be AGL-1732 in
          // reverse: a payment collected and recorded nowhere. And this id is
          // not caller-controlled the way AGL-1760's was — `object.subscription`
          // arrives inside a signature-verified Stripe payload
          // (`verifyStripeSignature`, the console route at :120), so there is no
          // typo and no attacker to refuse. What was wrong was never the create;
          // it was creating a stub. So the record is reconstructed with every
          // field the invoice can honestly supply, which is what makes it
          // FINDABLE by the readers above rather than merely non-empty. A
          // create that fills the required fields is not the defect a stub is.
          transaction.set(
            subscriptionRef,
            currentSubscription.exists
              ? rollup
              : {
                  ...(productId ? { productId } : {}),
                  customerEmail: object?.customer_email ?? null,
                  ...(object?.customer_name
                    ? { customerName: String(object.customer_name) }
                    : {}),
                  stripeCustomerId: String(object?.customer ?? '') || null,
                  // An invoice states that a cycle was paid, not what Stripe
                  // calls the subscription — that lives on the subscription
                  // object. `active` is the honest reading of money arriving
                  // for a cycle, and the `customer.subscription.*` sync at :132
                  // replaces it with Stripe's own the moment one lands.
                  status: 'active',
                  lineItems: invoiceLineItems,
                  totals: invoiceTotals,
                  ...(interval ? { interval } : {}),
                  // NOT `Date.now()`. This subscription began before Aglyn knew
                  // about it, and stamping "now" would date the sale to
                  // whichever cycle happened to be the first one seen. The
                  // start of THIS cycle is the earliest moment the invoice
                  // actually proves.
                  createdAtMs: periodStartMs ?? paidAtMs,
                  // Provenance, so nothing downstream mistakes a reconstruction
                  // for a recorded sale — and deliberately NO
                  // `checkoutSessionId`: that field is AGL-1732's redelivery key
                  // and `order-analytics.ts` resolves the opening purchase
                  // through it, so inventing one would answer a question this
                  // record cannot answer.
                  reconstructedFromInvoiceId: invoiceId,
                  ...rollup,
                },
            { merge: true },
          )
          // The order itself (AGL-1750): `paid` and unfulfilled, so it enters
          // the same fulfilment flow as any one-time sale. Channel
          // `subscription`, not `online` — folding cycles into `online` would
          // silently rewrite every existing merchant's channel split.
          // Deliberately NO `checkoutSessionId`: that identity belongs to
          // AGL-1732's opening sale record, and `order-analytics.ts` resolves
          // the opening purchase through the SUBSCRIPTION's copy of it;
          // repeating it on an order would double the answer. `createdAtMs`
          // is when the cycle was PAID — dating a redelivered cycle "now"
          // would file it under the wrong day in every orders view.
          if (shipsPhysically) {
            const orderNumber = Number(orderCounter?.get('next') ?? 1)
            transaction.set(counterRef, { next: orderNumber + 1 }, { merge: true })
            transaction.set(orderRef, {
              number: orderNumber,
              status: 'paid',
              channel: 'subscription',
              lineItems: invoiceLineItems,
              totals: invoiceTotals,
              // WHICH TAX THIS CYCLE CARRIED (AGL-2451), from the invoice's own
              // `automatic_tax.enabled` and never from its tax lines. This is
              // the door the distinction matters most at: a MANUAL-mode
              // subscription carries a real Stripe Tax Rate so the recurring
              // tax survives (AGL-1751), so every renewal invoice arrives with
              // a populated `total_taxes[]` that looks exactly like a Stripe
              // Tax one. Reading the lines would stamp the merchant's own tax
              // as Aglyn-collected on every cycle they ever bill.
              taxMode: storefrontTaxModeOf(object),
              timeline: [{ atMs: paidAtMs, event: 'paid' }],
              paymentIntentId: String(object?.payment_intent ?? '') || null,
              subscriptionId,
              invoiceId,
              customerName:
                object?.customer_name ??
                currentSubscription.get('customerName') ??
                null,
              customerEmail:
                object?.customer_email ??
                currentSubscription.get('customerEmail') ??
                null,
              ...(invoiceShipping?.address
                ? {
                    shippingAddress: {
                      name: invoiceShipping?.name ?? undefined,
                      line1: invoiceShipping.address.line1 ?? undefined,
                      line2: invoiceShipping.address.line2 ?? undefined,
                      city: invoiceShipping.address.city ?? undefined,
                      state: invoiceShipping.address.state ?? undefined,
                      postalCode:
                        invoiceShipping.address.postal_code ?? undefined,
                      country: invoiceShipping.address.country ?? undefined,
                    },
                  }
                : {}),
              amountCents: paidCents,
              feeCents: Number(invoiceTotals.feeCents ?? 0),
              createdAtMs: paidAtMs,
              createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            })
          }
          return true
        })
        // THE SALES TAX COMES BACK TO THE PLATFORM (AGL-1956), and like the
        // stop below it runs BEFORE the `recorded` short-circuit: a cycle
        // already on the ledger is exactly the cycle whose reversal may still
        // be owed, and its own marker doc is what makes it once-only.
        //
        // AFTER the ledger write rather than before it, unlike the AGL-2317
        // fee correction above. That one feeds `totals.feeCents` and so must
        // resolve first; this one moves money the ledger does not restate, and
        // ordering it second means a transient Stripe refusal leaves the cycle
        // RECORDED — the payment is already collected, and AGL-1732's rule is
        // that money collected must never go unfiled. The redelivery then
        // re-runs the reversal alone.
        await reverseSubscriptionTaxToPlatform(
          object,
          invoiceHostId,
          subscriptionRef,
          invoiceId,
        )
        // BEFORE the redelivery short-circuit, deliberately (AGL-2071): a
        // cycle Aglyn has already recorded is exactly the cycle whose renewal
        // still needs stopping, and gating the stop on `recorded` would mean a
        // Stripe redelivery — or a stop that failed once — never tries again.
        // Its own claim marker is what makes it once-only.
        // `renewalOrgUnreadable` and not `!renewalOrg` (AGL-2258): a null org
        // we successfully read still stops, which is AGL-2071's decision.
        if (!renewalEntitled && !renewalOrgUnreadable) {
          await stopLapsedStorefrontSubscription(
            invoiceHostId,
            subscriptionId,
            subscriptionRef,
          )
        } else if (renewalEntitled) {
          // RE-PRICE THE PLATFORM FEE (AGL-2289). `application_fee_percent` was
          // set once at the sale and never revisited, and it lives on the
          // Stripe subscription — so the rate the merchant was on the day a
          // shopper subscribed was the rate they paid forever. A renewal is
          // the only event a subscription raises, so it is the only place this
          // can be corrected. Skipped entirely for a lapsed org (the stop
          // above is the answer there) and for an unreadable one, which knows
          // nothing about the plan to re-price against.
          //
          // `snapshot.productType` is the sale's own recorded type, never a
          // default — the same field `shipsPhysically` refuses to guess.
          await repriceStorefrontSubscriptionFee(
            subscriptionRef,
            subscriptionId,
            Aglyn.resolveTransactionFeePct(
              renewalOrg as any,
              (snapshot.productType ?? 'physical') as
                | 'physical'
                | 'digital'
                | 'service',
            ),
          )
        }
        if (!recorded) return
        // Inventory per cycle (AGL-1750, the AGL-281 semantics): the box that
        // ships this cycle comes off the shelf this cycle. Mirrors the cart
        // loop — tracked variants only, ledger row with `reason: 'sale'`
        // joined to the order, and the low-stock crossing alert — and sits
        // behind the transaction's invoice-id guard exactly as the cart's
        // decrement sits behind its `created` guard, so a redelivery never
        // decrements twice. One product per subscription, so no sibling-line
        // carry-forward (AGL-1830) is needed here.
        if (shipsPhysically) {
          const stockSnapshot = await hostRef
            .collection('products')
            .doc(productId)
            .get()
            .catch(() => null)
          if (stockSnapshot?.exists) {
            const stocked = CommerceModel.liftLegacyProduct(
              stockSnapshot.data() as any,
            )
            const stockVariantId =
              snapshot.variantId ?? stocked.variants[0]?.id
            const tracked = stocked.variants.some(
              (variant) =>
                variant.id === stockVariantId && variant.inventory != null,
            )
            if (stockVariantId && tracked) {
              const cycleQuantity = cycleLine?.quantity ?? 1
              // Atomic since AGL-2320, like every other decrement: a renewal
              // batch bills many subscribers at once, so two cycles of the same
              // physical box are exactly the concurrent pair that lost a
              // decrement here. The `stockSnapshot` read above still resolves
              // the variant; the transaction re-reads before it writes.
              const moved = await decrementVariantStock({
                firestore,
                hostRef,
                hostId: invoiceHostId,
                productId,
                variantId: stockVariantId,
                quantity: cycleQuantity,
                ledger: { reason: 'sale', orderId: invoiceId },
              })
              if (moved.before && moved.after) {
                alertLowStockCrossing(invoiceHostId, moved.before, moved.after)
              }
            }
          }
        }
        if (!isOpeningInvoice && paidCents > 0) {
          const renewalEmail =
            object?.customer_email ?? soldSnapshot.get('customerEmail') ?? null
          // A physical cycle now lands in Orders (AGL-1750), but the console
          // still has no Subscriptions tab, so for a digital or service
          // subscription this notification remains the only place a merchant
          // learns the money arrived at all.
          void notifyHostManagers(invoiceHostId, {
            type: 'content.order',
            title: `Subscription renewed — $${(paidCents / 100).toFixed(2)}${
              interval ? `/${interval}` : ''
            }`,
            ...(renewalEmail ? { body: String(renewalEmail) } : {}),
            link: `/${invoiceHostId}/products`,
          })
          // RFM (AGL-328): a subscriber in month 12 has paid twelve times, and
          // counting only the first charge ranks them as a one-purchase
          // customer forever. Keyed to the invoice so the guard above is what
          // stops a redelivery inflating it.
          await upsertHostContact({
            hostId: invoiceHostId,
            email: renewalEmail,
            ...(soldSnapshot.get('customerName')
              ? { name: String(soldSnapshot.get('customerName')) }
              : {}),
            source: 'order',
            purchaseCents: paidCents,
            interaction: {
              refId: invoiceId,
              summary: `Subscription renewed ($${(paidCents / 100).toFixed(2)})`,
            },
          })
        }
      }
    }

    // Reservations (AGL-310): payment confirms the pending hold.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-reservation' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, reservationId } = object.metadata ?? {}
      if (hostId && reservationId) {
        const firestore = firebaseAdmin.app().firestore()
        const reservationRef = firestore
          .collection('hosts')
          .doc(String(hostId))
          .collection('reservations')
          .doc(String(reservationId))
        // THE MERCHANT'S LODGING TAX, SEPARATED FROM THE STAY (AGL-1969).
        //
        // `reserve.ts` charges the merchant's own lodging rate as an ordinary
        // `line_items[1]` Stripe is never told is tax (the AGL-1711
        // construction, which is what keeps the figure the MERCHANT's rather
        // than something computed against Aglyn's registrations). So
        // `amount_total` is stay-plus-tax and Stripe's own tax fields read
        // zero; the session's metadata is the only witness, exactly as it is
        // for a buy-now sale.
        const taxCents = Math.max(
          0,
          Math.round(Number(object?.metadata?.taxCents ?? 0)),
        )
        // What the guest actually handed over, MINUS that tax. This is the
        // DEPOSIT when the resource has one (`reserve.ts` charges
        // `depositCents || totalCents`), never the stay's `totalCents` — see
        // the contact call below.
        //
        // Subtracting the tax is not cosmetic. `paidCents` is the money
        // applied to the STAY: `reservations-card` renders
        // `paidCents / totalCents` and computes the balance to collect at
        // check-out from the difference, so a tax-inclusive figure would
        // report a guest as further through paying for their stay than they
        // are and under-state what the merchant collects at the register. The
        // same figure feeds the guest's lifetime value, which tax is no part
        // of either (AGL-1755).
        const paidCents = Math.max(
          0,
          Math.round(Number(object?.amount_total ?? 0)) - taxCents,
        )
        // Redelivery guard (AGL-1755), the AGL-1748 shape. The `pending` ->
        // `confirmed` transition was always the guard, but it was a
        // read-then-write with every side effect hanging off it, so two
        // concurrent deliveries could both observe `pending` and both run them:
        // two manager notifications, two guest emails, two metered sends and —
        // now that this branch carries money to contacts — two
        // `FieldValue.increment` calls on the guest's lifetime value.
        //
        // Keyed on the STATUS, not on the document existing: `reserve.ts`
        // writes the reservation before it opens the Stripe session, so
        // existence is guaranteed by the time any event arrives and says
        // nothing about whether this delivery is the first. That is the same
        // reasoning as AGL-1748's draft branch, and the opposite of AGL-1732's
        // `checkoutSessionId` key, which existed because a SIBLING event wrote
        // the same path; no sibling writes reservations.
        let reserved: Record<string, any> | null = null
        const confirmedNow = await firestore.runTransaction(
          async (transaction) => {
            const snapshot = await transaction.get(reservationRef)
            if (!snapshot.exists) return false
            if (snapshot.get('status') !== 'pending') return false
            reserved = (snapshot.data() as any) ?? {}
            transaction.set(
              reservationRef,
              {
                status: 'confirmed',
                paidCents,
                checkoutSessionId: String(object.id),
                paymentIntentId: String(object?.payment_intent ?? '') || null,
                // The regime this stay carried, on the record the merchant
                // reads (AGL-1969).
                //
                // This does NOT decide the lodging-tax question. `reserve.ts`
                // computes no tax by an explicit, reasoned decision — a stay
                // is not goods, the AGL-285 editor configures a SALES rate,
                // and this charge is usually a DEPOSIT — and that decision is
                // untouched. What the reservation lacked was any statement of
                // it: the fact lived only in the `storefrontTaxCollected` row
                // filed above, and nowhere a merchant looking at their own
                // booking could see it. Every other storefront money door
                // stamps this on the document the merchant reads (AGL-2451);
                // the reservation settled money and recorded no regime at all.
                //
                // DERIVED, never the constant `'none'` the current decision
                // happens to produce. A constant would keep answering `none`
                // on the day this path does compute lodging tax, which is the
                // failure this field exists to prevent — and would make the
                // eventual AGL-1969 answer a second change here rather than
                // none. `absent` remains a fourth state meaning "recorded
                // before this shipped", which a back-book question needs to
                // separate from a deliberate zero.
                //
                // TWO-ARGUMENT, now that AGL-1969 is answered and the merchant
                // can set a lodging rate. That rate rides an ordinary line
                // item, so Stripe's own `total_details.amount_tax` reads 0 on
                // a stay that really did charge the guest occupancy tax — the
                // one-argument form stamped `none` on exactly those. This is
                // the same form the cart, draft and buy-now order doors
                // already use (AGL-2451): still the one shared derivation,
                // handed the witness it needs.
                taxMode: storefrontTaxModeOf(object, taxCents),
                // The figure itself, alongside the regime. Absent rather than
                // a defaulted `0` — a zero written through `merge` is the
                // AGL-1758 shape, and "no tax was charged" must stay
                // distinguishable from "this stay predates the field".
                ...(taxCents > 0 ? { taxCents } : {}),
              },
              { merge: true },
            )
            return true
          },
        )
        if (confirmedNow) {
          const reservation = (reserved ?? {}) as Record<string, any>
          void notifyHostManagers(String(hostId), {
            type: 'content.booking',
            title: 'New reservation',
            ...(object?.customer_details?.email
              ? { body: object.customer_details.email }
              : {}),
            link: `/${hostId}/products`,
          })
          // Contacts ingestion (AGL-1755): this branch stored `paidCents` from
          // `amount_total` and then called `upsertHostContact` with no amount,
          // so a guest who paid for a stay showed a lifetime value of zero. A
          // guest house's customers are customers; excluding them makes
          // `ltvCents` mean "product sales only", which is not what it is
          // called. Provenance survives without a schema change: `source` stays
          // `'booking'`, so the `sources` map still separates a stay from a
          // shop sale, and a reader that wants to split service revenue from
          // product revenue has the interaction timeline to do it with.
          //
          // The amount is `amount_total` — the money that moved — and NOT the
          // reservation's `totalCents`. That distinction is the whole
          // double-count question, and it resolves in favour of counting:
          //
          //  * a deposit is charged once, here;
          //  * a POS `folio` sale (AGL-317) charges a room extra as its OWN
          //    paid order and already carries its own `purchaseCents` from
          //    AGL-1748 — it appends to `reservations/{id}.folio` for display
          //    and never touches `paidCents`;
          //  * nothing ever settles a folio by charging again — check-out only
          //    moves the status, and its dialog says as much ("already recorded
          //    as paid POS orders");
          //  * the unpaid stay balance is collected at the register, which is
          //    likewise a separate POS order with its own amount.
          //
          // So the deposit and every folio line are disjoint sums, each counted
          // exactly once. Taking `totalCents` here is what WOULD double-count:
          // it would claim money the guest has not paid yet and will pay again
          // through the register.
          const guestContactEmail =
            object?.customer_details?.email ?? reservation['guestEmail'] ?? null
          if (guestContactEmail) {
            await upsertHostContact({
              hostId: String(hostId),
              email: guestContactEmail,
              name:
                object?.customer_details?.name ??
                reservation['guestName'] ??
                undefined,
              source: 'booking',
              ...(paidCents > 0 ? { purchaseCents: paidCents } : {}),
              interaction: {
                refId: String(reservationId),
                summary: `Reserved a stay ($${(paidCents / 100).toFixed(2)})`,
              },
            })
          }
          const guestEmail = object?.customer_details?.email
          if (guestEmail) {
            const checkIn = new Date(
              Number(reservation['checkInDayMs']),
            ).toUTCString()
            const paid = `$${(paidCents / 100).toFixed(2)}`
            const checkInShort = checkIn.slice(0, 16)
            const fallbackText =
              `Your stay is confirmed!\n\nCheck-in: ${checkInShort}\n` +
              `Nights: ${reservation['nights']}\n` +
              `Paid today: ${paid}\n` +
              `Reference: ${reservationId}`
            // Site-owner-designed template when published (AGL-771).
            const designed = await renderHostEmailWithTokens(
              firebaseAdmin.app().firestore(),
              String(hostId),
              'reservation-confirmed',
              {
                'reservation.checkIn': checkInShort,
                'reservation.nights': String(reservation['nights'] ?? ''),
                'reservation.paid': paid,
                'reservation.ref': String(reservationId),
              },
            )
            await sendEmail({
              to: guestEmail,
              subject: designed?.subject ?? 'Reservation confirmed',
              text: designed?.text || fallbackText,
              ...(designed?.html ? { html: designed.html } : {}),
              fromName: (await brandFor(hostId)).fromName,
              context: 'reservation confirmation',
            })
            // Cost meter (AGL-1438). Transactional: the guest has paid, and a
            // confirmation a quota refused reads as a failed reservation.
            await meterHostEmail(String(hostId))
          }
        }
      }
    }

    // Cart orders (AGL-293): one multi-line order from the cart doc;
    // clears the cart and decrements each line's stock.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-cart' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, cartId, feeCents, couponCode } = object.metadata ?? {}
      if (hostId && cartId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        const cartRef = hostRef.collection('carts').doc(String(cartId))
        const cartSnapshot = await cartRef.get()
        const cart = (cartSnapshot.data() as CommerceModel.HostCart | undefined) ?? {
          lines: [],
        }
        const orderRef = hostRef.collection('orders').doc(String(object.id))
        const counterRef = hostRef.collection('counters').doc('orders')
        const productSnapshots = await Promise.all(
          [...new Set(cart.lines.map((line) => line.productId))].map((id) =>
            hostRef.collection('products').doc(id).get(),
          ),
        )
        const productsById = new Map(
          productSnapshots.map((snapshot) => [
            snapshot.id,
            snapshot.exists
              ? CommerceModel.liftLegacyProduct(snapshot.data() as any)
              : null,
          ]),
        )
        // A cart line whose product was deleted between the shopper opening
        // the Stripe session and this webhook landing (AGL-2149). The line is
        // dropped from `lineItems` below and skipped by the inventory loop,
        // and until now that was SILENT: the order was written with fewer lines
        // than the shopper paid for while `amountCents` stayed the full
        // `amount_total`, so `itemsCents` and the charge disagreed and nothing
        // said why. A merchant reconciling that order sees a short order and no
        // explanation; a shopper sees goods they paid for missing.
        //
        // The upstream fix — snapshotting each line into `checkouts/{sessionId}`
        // at session creation so the webhook can price a deleted product from
        // the snapshot instead of the product doc — is a schema addition to the
        // recovery document that the abandoned-cart path also reads, and is NOT
        // done here. What is done is to make the loss LOUD: the unresolvable
        // lines are recorded on the order itself, stamped on the timeline the
        // console dialog renders, and pushed to the managers. A silent
        // discrepancy on a paid order is the worse outcome of the two.
        const unresolvedLines = cart.lines
          .filter((line) => !productsById.get(line.productId))
          .map((line) => ({
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            quantity: line.quantity,
          }))
        const lineItems: CommerceModel.OrderLineItem[] = cart.lines
          .map((line) => {
            const product = productsById.get(line.productId)
            if (!product) return null
            const variant = line.variantId
              ? product.variants.find((item) => item.id === line.variantId)
              : product.variants[0]
            return {
              productId: line.productId,
              ...(line.variantId ? { variantId: line.variantId } : {}),
              name: product.name,
              ...(variant && Object.keys(variant.options ?? {}).length
                ? {
                    variantLabel: Object.values(variant.options ?? {}).join(
                      ' / ',
                    ),
                  }
                : {}),
              ...(variant?.sku ? { sku: variant.sku } : {}),
              productType: product.type,
              ...(product.supplierId
                ? { supplierId: product.supplierId }
                : {}),
              quantity: line.quantity,
              unitAmountCents: Math.round(
                Number(variant?.priceUsd ?? 0) * 100,
              ),
            }
          })
          .filter(Boolean) as CommerceModel.OrderLineItem[]
        const shipping = object?.shipping_details ?? object?.customer_details
        const created = await firestore.runTransaction(async (transaction) => {
          const [existing, counter] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(counterRef),
          ])
          if (existing.exists) return false
          const number = Number(counter.get('next') ?? 1)
          transaction.set(counterRef, { next: number + 1 }, { merge: true })
          // AGL-1698: reads all THREE of `total_details` — the shipping used
          // to be dropped here, storing `shippingCents: 0` on every online
          // order while the shopper's shipping sat inside `amount_total`.
          const totals = CommerceModel.computeCheckoutSessionTotals(
            lineItems,
            object,
            { feeCents: Number(feeCents ?? 0) },
          )
          transaction.set(orderRef, {
            number,
            status: 'paid',
            channel: 'online',
            lineItems,
            totals,
            // WHICH TAX THIS SALE CARRIED (AGL-2451). `totals.taxCents` above
            // says how much; this says who computed it, which is the fact that
            // decides whose registration the money is held under. The same
            // resolver `recordStorefrontTax` used a few hundred lines up, so
            // the order and the filed row cannot disagree. A manual cart's tax
            // rides a real Stripe Tax Rate since AGL-1953 and therefore has a
            // populated breakdown — the flag is what tells the two apart.
            taxMode: storefrontTaxModeOf(
              object,
              Number(object?.metadata?.taxCents ?? 0),
            ),
            timeline: [
              { atMs: Date.now(), event: 'paid' },
              ...(unresolvedLines.length
                ? [
                    {
                      atMs: Date.now(),
                      event: 'line-unresolved',
                      detail:
                        `${unresolvedLines.length} paid ${
                          unresolvedLines.length === 1 ? 'line' : 'lines'
                        } could not be recorded because the product was ` +
                        'deleted during checkout, so this order is short of ' +
                        'what the shopper was charged. Refund the difference ' +
                        'or fulfil it by hand.',
                    },
                  ]
                : []),
            ],
            // The structured half, for the console badge and for anything
            // reconciling `totals.itemsCents` against `amountCents`.
            ...(unresolvedLines.length ? { unresolvedLines } : {}),
            paymentIntentId: String(object?.payment_intent ?? '') || null,
            checkoutSessionId: String(object.id),
            customerName: object?.customer_details?.name ?? null,
            customerEmail: object?.customer_details?.email ?? null,
            ...(shipping?.address
              ? {
                  shippingAddress: {
                    name: shipping?.name ?? undefined,
                    line1: shipping.address.line1 ?? undefined,
                    line2: shipping.address.line2 ?? undefined,
                    city: shipping.address.city ?? undefined,
                    state: shipping.address.state ?? undefined,
                    postalCode: shipping.address.postal_code ?? undefined,
                    country: shipping.address.country ?? undefined,
                  },
                }
              : {}),
            ...(couponCode ? { couponCode } : {}),
            amountCents: Number(object?.amount_total ?? 0),
            feeCents: Number(feeCents ?? 0),
            createdAtMs: Date.now(),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
          return true
        })
        // Redelivery/replay guard (AGL-498): only fulfil when the order was
        // just created. A duplicate delivery finds it already there and skips
        // the non-idempotent effects below (inventory / coupon / gift-card
        // decrements) that would otherwise double-apply.
        if (!created) return
        // AGL-2149: loud, not silent. Logged for the platform and pushed to the
        // merchant, once, behind the same `created` guard as every other
        // non-idempotent effect so a redelivery does not re-nag.
        if (unresolvedLines.length) {
          console.error('commerce cart order lost a paid line', {
            hostId: String(hostId),
            orderId: String(object.id),
            unresolvedLines,
          })
          void notifyHostManagers(String(hostId), {
            type: 'content.order',
            title: 'A paid order is missing items',
            body:
              `Order ${object.id} was charged in full but ` +
              `${unresolvedLines.length} ${
                unresolvedLines.length === 1 ? 'line' : 'lines'
              } could not be recorded — the product was deleted during ` +
              'checkout. Refund the difference or fulfil it by hand.',
            link: `/${hostId}/products`,
          })
        }
        await cartRef.delete().catch(() => undefined)
        // Recoverable checkout closes (AGL-296) so recovery emails stop;
        // the doc also carries the marketing opt-in (AGL-301).
        const checkoutRef = hostRef.collection('checkouts').doc(String(object.id))
        const checkoutSnapshot = await checkoutRef.get().catch(() => null)
        const marketingOptIn = Boolean(checkoutSnapshot?.get('marketingOptIn'))
        // AGL-1767: a plain refusal, and the only one of the five that needs no
        // record. The `.get()` above is the AGL-1760 shape exactly — its result
        // feeds `marketingOptIn` and is never asked `.exists` — and the merge-set
        // it guarded nothing of minted a `checkouts/{sessionId}` row holding
        // `status: 'completed'`. Harmless in itself (abandoned-cart recovery
        // wants that state anyway), but nothing occurred that a missing checkout
        // doc would strand: the order, the receipt and the fulfilment below are
        // all written elsewhere. `updateExisting`, not the read above, is the
        // check — it closes the window between them without a second round trip.
        await updateExisting(checkoutRef, {
          status: 'completed',
          completedAtMs: Date.now(),
        }).catch(() => undefined)
        // License keys (AGL-308) per digital line — OUTSIDE the receipt gate
        // (AGL-2149). These used to be assigned inside `if (isEmailConfigured()
        // && buyerEmailForReceipt)`, so a store with no SMTP configured, or a
        // buyer whose email Stripe did not hand back, produced a paid digital
        // order that never had a key assigned to it at all — not "the email did
        // not arrive", but "the key was never claimed", and nothing later
        // retries it because the `created` guard above turns a redelivery away.
        // The key is the GOODS on a digital order; the receipt is how they are
        // announced. Assignment is the part that must not be optional.
        //
        // Ordering is deliberate and is what the move had to preserve: the
        // receipt body below reads `licenseKeysByProduct`, so the assignment
        // still has to run BEFORE the mail is composed. Hoisting it (rather
        // than duplicating it into an else-branch) keeps that single ordering.
        // The buyer's email is stamped on each key when Stripe gave us one and
        // is `null` otherwise — the key doc's `orderId` is the join that
        // matters, and the order carries the buyer identity anyway.
        const licenseKeysByProduct: Record<string, string[]> = {}
        for (const line of lineItems) {
          if (line.productType !== 'digital') continue
          const keys = await assignLicenseKeys(
            firestore,
            hostRef,
            String(hostId),
            line.productId,
            String(object.id),
            object?.customer_details?.email ?? null,
            line.quantity,
          )
          if (keys.length) licenseKeysByProduct[line.productId] = keys
        }
        if (Object.keys(licenseKeysByProduct).length) {
          await orderRef
            .set({ licenseKeys: licenseKeysByProduct }, { merge: true })
            .catch(() => undefined)
        }
        // Branded receipt (AGL-296): env-gated like every outbound email.
        const buyerEmailForReceipt = object?.customer_details?.email
        if (isEmailConfigured() && buyerEmailForReceipt) {
          const receiptSettings = await hostRef
            .collection('settings')
            .doc('store')
            .get()
            .catch(() => null)
          const receiptFooter = String(
            receiptSettings?.get('receiptFooter') ?? '',
          )
          const linesText = lineItems
            .map(
              (line) =>
                `${line.quantity}× ${line.name}${
                  line.variantLabel ? ` (${line.variantLabel})` : ''
                } — $${((line.unitAmountCents * line.quantity) / 100).toFixed(2)}`,
            )
            .join('\n')
          // The keys assigned above the gate (AGL-2149); the receipt only
          // reports them.
          const licenseText = Object.entries(licenseKeysByProduct)
            .flatMap(([keyProductId, keys]) => {
              const line = lineItems.find(
                (item) => item.productId === keyProductId,
              )
              return keys.map(
                (key) => `License key (${line?.name ?? 'product'}): ${key}`,
              )
            })
            .join('\n')
          // Digital delivery links (AGL-302); reuse the canonical mint the
          // tenant download endpoint verifies so the secret can never drift.
          const downloadToken = mintDownloadToken(hostId, String(object.id))
          const siteOrigin = String(
            object?.success_url ?? '',
          ).replace(/\/\?.*$|\?.*$/, '')
          const downloadLines = lineItems
            .filter((line) => line.productType === 'digital')
            .map(
              (line) =>
                `Download ${line.name}: ${siteOrigin}/api/commerce/download` +
                `?hostId=${hostId}&orderId=${object.id}` +
                `&productId=${line.productId}&token=${downloadToken}`,
            )
            .join('\n')
          const orderTotal = `$${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`
          const orderSummary = [linesText, licenseText, downloadLines]
            .filter(Boolean)
            .join('\n\n')
          const fallbackText =
            `Thanks for your purchase!\n\n${linesText}\n\n` +
            (licenseText ? `${licenseText}\n\n` : '') +
            (downloadLines ? `${downloadLines}\n\n` : '') +
            `Total: ${orderTotal}\n` +
            `Order reference: ${object.id}` +
            (receiptFooter ? `\n\n${receiptFooter}` : '')
          // Site-owner-designed template when published (AGL-771). The
          // license keys and download links ride in {{order.summary}}.
          const designed = await renderHostEmailWithTokens(
            firebaseAdmin.app().firestore(),
            String(hostId),
            'order-receipt',
            {
              'order.summary': orderSummary,
              'order.total': orderTotal,
              'order.ref': String(object.id),
            },
          )
          await sendEmail({
            to: buyerEmailForReceipt,
            subject: designed?.subject ?? `Receipt for your order`,
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            fromName: (await brandFor(hostId)).fromName,
            context: 'cart receipt',
          })
          // Cost meter (AGL-1438). Transactional: a dropped receipt looks to
          // the buyer like an order that did not go through.
          await meterHostEmail(String(hostId))
        }
        // Inventory per line (AGL-281 semantics).
        for (const line of cart.lines) {
          const product = productsById.get(line.productId)
          if (!product) continue
          const variantId = line.variantId ?? product.variants[0]?.id
          const tracked = product.variants.some(
            (variant) =>
              variant.id === variantId && variant.inventory != null,
          )
          if (!variantId || !tracked) continue
          // Two lines of one product must COMPOUND (AGL-1830): a cart holds
          // two VARIANTS of one product as two lines (`lineKey` merges on
          // product+variant), and recomputing each from the product as first
          // read would erase this decrement when the sibling line's merge-set
          // landed, while the ledger below recorded both.
          //
          // Since AGL-2320 the compounding is a PROPERTY of the transaction,
          // not of the carry-forward: each line re-reads the product inside its
          // own transaction, so it starts from the sibling line's committed
          // write — and from a CONCURRENT request's committed write too, which
          // the in-memory carry-forward could never see. `productsById` is
          // still refreshed, because the gift-card pass below reads it.
          const moved = await decrementVariantStock({
            firestore,
            hostRef,
            hostId: String(hostId),
            productId: line.productId,
            variantId,
            quantity: line.quantity,
            ledger: { reason: 'sale', orderId: String(object.id) },
          })
          if (!moved.before || !moved.after) continue
          productsById.set(line.productId, moved.after)
          // Low-stock crossing alert (AGL-1826): the cart — the channel that
          // sells MORE units per order than the buy-now button — used to
          // cross the threshold silently. Same check, per product, on the
          // compounded pair; the `created` guard above bounds it on
          // redelivery. Fires per crossing line, which for a multi-product
          // basket is one nudge per product that breached.
          alertLowStockCrossing(String(hostId), moved.before, moved.after)
        }
        // SETTLEMENT: the reservation becomes the decrement (AGL-2356).
        //
        // AFTER the loop, never before it. Between the decrement and this
        // release the units are counted twice — once off the shelf, once still
        // held — so availability UNDER-reports for the few hundred milliseconds
        // it takes to get here. That is the safe direction: it can only refuse
        // a sale that a moment later succeeds. Releasing first would open the
        // opposite window, in which the unit is neither on the shelf nor
        // spoken for, and that window is the oversell itself.
        //
        // The decrement is deliberately NOT made conditional on the hold. A
        // paid order must decrement whether or not its reservation survived —
        // an expired hold, a session from before this deploy, a merchant who
        // saved the product editor mid-checkout — and `decrementVariantStock`
        // is byte-identical to what it was before this issue for exactly that
        // reason. The hold refuses the SECOND shopper; it never gates the
        // first one's goods.
        await releaseStockHold(
          hostRef,
          String(object.metadata?.stockHoldKey ?? ''),
        )
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          title: `New order — $${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`,
          ...(object?.customer_details?.email
            ? { body: `From ${object.customer_details.email}` }
            : {}),
          link: `/${hostId}/products`,
        })
        await upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          ...(marketingOptIn ? { marketingConsent: true } : {}),
          purchaseCents: Number(object?.amount_total ?? 0),
          interaction: {
            refId: String(object.id),
            summary: `Placed an order ($${(Number(object?.amount_total ?? 0) / 100).toFixed(2)})`,
          },
        })
        if (couponCode) {
          await settleRedemption({
            firestore,
            ref: hostRef.collection('coupons').doc(String(couponCode)),
            holdKey: String(object.metadata?.couponHoldKey ?? ''),
            orderRef,
            label: `coupon ${couponCode}`,
            detail:
              `Coupon ${couponCode} was applied to this order but no longer ` +
              'exists, so the redemption is uncounted against its limit.',
          })
        }
        // Gift card balance settlement (AGL-322, made a settlement by AGL-2449).
        if (object.metadata?.giftCardCode) {
          const giftCardCents = Number(object.metadata?.giftCardCents ?? 0)
          const holdKey = String(object.metadata?.giftCardHoldKey ?? '')
          const cardRef = hostRef
            .collection('giftCards')
            .doc(String(object.metadata.giftCardCode))
          const orphanNote =
            `$${(giftCardCents / 100).toFixed(2)} was applied from gift card ` +
            `${object.metadata.giftCardCode}, which no longer exists. The ` +
            'balance was not deducted from any card.'
          if (!holdKey) {
            // A session minted BEFORE holds existed. It reserved nothing, so
            // the old unconditional decrement is still the only thing that can
            // settle it — the shopper was given the discount and the merchant
            // must be paid out of the card. Kept deliberately rather than
            // refusing: in-flight sessions outlive the deploy by up to 24h, and
            // dropping them would hand out free money instead of double-spent
            // money. It ages out on its own once the last pre-deploy session
            // completes.
            await redeemExistingOrRecord(
              cardRef,
              {
                balanceCents:
                  firebaseAdmin.firestore.FieldValue.increment(-giftCardCents),
                lastUsedAtMs: Date.now(),
              },
              orderRef,
              orphanNote,
            )
          } else {
            // The hold IS the authority, not the metadata: `giftCardCents` is
            // a copy the session carries for the receipt, and settling against
            // the reservation is what makes this idempotent under redelivery —
            // the second delivery finds no hold and takes nothing.
            const settled = await firestore
              .runTransaction(async (transaction) => {
                const fresh = await transaction.get(cardRef)
                if (!fresh.exists) return null
                const card = (fresh.data() ??
                  {}) as CommerceModel.HostGiftCard
                const take = CommerceModel.giftCardSettlementCents(
                  card,
                  holdKey,
                  Date.now(),
                )
                transaction.set(
                  cardRef,
                  {
                    balanceCents: Math.max(
                      0,
                      Number(card.balanceCents ?? 0) - take,
                    ),
                    // `FieldValue.delete()`, NOT a locally-pruned copy of the
                    // map. `set(…, { merge: true })` merges nested maps rather
                    // than replacing them, so writing back an object with the
                    // key removed leaves the stored key exactly where it was —
                    // and a redelivery would then find the hold still standing
                    // and settle it a SECOND time, taking the balance twice for
                    // one payment. The sentinel is what makes this settlement
                    // idempotent.
                    holds: {
                      [holdKey]: firebaseAdmin.firestore.FieldValue.delete(),
                    },
                    ...(take > 0 ? { lastUsedAtMs: Date.now() } : {}),
                  },
                  { merge: true },
                )
                return take
              })
              .catch((error) => {
                console.error('Gift card settlement failed', holdKey, error)
                // Undefined, not null: null means "the card is gone", which is
                // the orphan note below. A transport failure is neither — the
                // hold stands and lapses on its own, and the merchant is short
                // rather than the customer double-charged.
                return undefined
              })
            if (settled === null) {
              await recordRedemptionOrphan(orderRef, orphanNote)
            } else if (settled != null && settled < giftCardCents) {
              // The card could not cover what the session discounted, which
              // after a hold means the merchant voided or hand-adjusted it
              // mid-flight. Money moved on a discount the card did not fund,
              // so it is recorded where the merchant reads it rather than
              // quietly absorbed.
              await recordRedemptionOrphan(
                orderRef,
                `$${(giftCardCents / 100).toFixed(2)} was discounted against ` +
                  `gift card ${object.metadata.giftCardCode}, but only $${(
                    settled / 100
                  ).toFixed(2)} could be taken from its balance.`,
              )
            }
          }
        }
        // Gift card issuance (AGL-322): each purchased gift-card line
        // mints a code for its unit price and emails it to the buyer.
        // Defense in depth (AGL-470): checkout already blocks gift-card
        // sales without the Business entitlement; re-check here so a doc
        // edited between checkout and webhook can't mint codes.
        const giftCardLines = lineItems.filter(
          (line) => productsById.get(line.productId)?.giftCard,
        )
        const giftCardsEntitled =
          giftCardLines.length > 0 &&
          Aglyn.checkEntitlement(
            (await getOrgForHost(String(hostId)))?.org as any,
            'giftCards',
          )
        for (const line of giftCardsEntitled ? giftCardLines : []) {
          const lineProduct = productsById.get(line.productId)
          if (!lineProduct?.giftCard) continue
          for (let unit = 0; unit < line.quantity; unit += 1) {
            const code = `GC-${createHmac('sha256', String(object.id))
              .update(`${line.productId}:${unit}:${Date.now()}`)
              .digest('hex')
              .slice(0, 12)
              .toUpperCase()}`
            // THE EMAIL IS GATED ON THE WRITE (AGL-2161). This `.set()` used
            // to `.catch(() => undefined)` and fall straight through to the
            // send below, so a failed write shipped the buyer a real-looking
            // `GC-XXXXXXXXXXXX` for a document that does not exist — and
            // `meterHostEmail` billed the merchant for delivering it. The
            // buyer only discovers it at checkout, where `cart-checkout.ts`
            // finds `!fresh.exists`, places no hold, and applies nothing.
            //
            // The redemption side already went transactional (AGL-2449); this
            // is the minting side catching up, and it deliberately EXTENDS
            // that path rather than adding a second mechanism: a card that was
            // never written is the same "card that isn't there" the settlement
            // orphan note describes, reached from the other end.
            const issued = await hostRef
              .collection('giftCards')
              .doc(code)
              .set({
                initialCents: line.unitAmountCents,
                balanceCents: line.unitAmountCents,
                recipientEmail: object?.customer_details?.email ?? null,
                orderId: String(object.id),
                createdAtMs: Date.now(),
              })
              .then(() => true)
              .catch((error: unknown) => {
                console.error('Gift card issuance failed', hostId, code, error)
                return false
              })
            if (!issued) {
              // LOUD, and on the surface a merchant already watches. The buyer
              // has paid, so somebody must act: the console's hand-issue route
              // (`gift-cards.ts`) is how they make it right. Sending nothing is
              // the recoverable half — an unissued card is a support ticket, a
              // phantom code is a customer who thinks they hold value.
              // `content.order` and `/products`: the Gift cards card lives on
              // the commerce console page the `/products` nav item opens, and
              // this is an order-shaped fact. A new notification type would
              // need a label, a category and a mute of its own for one edge —
              // reuse is the AGL-1088 call, same as `content.lowStock` is for
              // the oversell alert next door.
              void notifyHostManagers(String(hostId), {
                type: 'content.order',
                title: 'Gift card paid for but not issued',
                body:
                  `A $${(line.unitAmountCents / 100).toFixed(2)} gift card on ` +
                  `order ${String(object.id)} could not be written, so no code ` +
                  'was emailed to the buyer. Issue one by hand from Gift cards.',
                link: `/${hostId}/products`,
              })
              continue
            }
            const giftTo = object?.customer_details?.email
            if (giftTo) {
              const giftValue = `$${(line.unitAmountCents / 100).toFixed(2)}`
              const fallbackText =
                `Gift card code: ${code}\n` +
                `Value: ${giftValue}\n\n` +
                'Enter it at checkout to apply the balance.'
              // Site-owner-designed template when published (AGL-771).
              const designed = await renderHostEmailWithTokens(
                firebaseAdmin.app().firestore(),
                String(hostId),
                'gift-card',
                { 'giftcard.code': code, 'giftcard.value': giftValue },
              )
              await sendEmail({
                to: giftTo,
                subject: designed?.subject ?? 'Your gift card',
                text: designed?.text || fallbackText,
                ...(designed?.html ? { html: designed.html } : {}),
                fromName: (await brandFor(hostId)).fromName,
                context: 'gift card',
              })
              // Cost meter (AGL-1438). Transactional: this email IS the
              // purchased goods.
              await meterHostEmail(String(hostId))
            }
          }
        }
        // Discounts engine redemptions (AGL-305).
        if (object.metadata?.discountId) {
          await settleRedemption({
            firestore,
            ref: hostRef
              .collection('discounts')
              .doc(String(object.metadata.discountId)),
            holdKey: String(object.metadata?.discountHoldKey ?? ''),
            orderRef,
            label: `discount ${object.metadata.discountId}`,
            detail:
              `Discount ${object.metadata.discountId} was applied to this ` +
              'order but no longer exists, so the redemption is uncounted ' +
              'against its limit.',
          })
        }
      }
    }

    // Draft orders (AGL-287): the console pre-created the doc; completion
    // flips it to paid, stamps the intent, and decrements stock.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-draft' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, orderId, productId } = object.metadata ?? {}
      if (hostId && orderId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        const orderRef = hostRef.collection('orders').doc(String(orderId))
        // Redelivery guard (AGL-1748), the AGL-1732/AGL-498 shape. The
        // `pending` -> `paid` transition was always the guard, but it used to
        // be a read-then-write with every side effect below hanging off it, so
        // two concurrent deliveries could both observe `pending` and both run
        // them — a doubled manager notification, a doubled inventory decrement
        // and, now that this branch feeds contacts, a doubled
        // `FieldValue.increment` on the buyer's lifetime value.
        //
        // Keyed on the STATUS rather than on the document existing, which is
        // where this differs from AGL-1732: there, a sibling event wrote the
        // same path, so an existence check would have discarded the sale
        // record. Here the console (or the POS card path) pre-creates the order
        // before the session exists, so existence is guaranteed and says
        // nothing; only the transition distinguishes the first delivery.
        let paidOrder: CommerceModel.HostOrder | null = null
        // Shipping (AGL-1792). This branch wrote no `totals` at all: the
        // console froze them when the draft was composed, and while no draft
        // session could charge postage there was nothing to add. Now
        // `draft-order.ts` declares `shipping_options`, so the buyer picks a
        // rate and pays an amount that arrives only inside `amount_total` —
        // leaving the stored order alone would recreate AGL-1698 against real
        // money, which is the ordering constraint AGL-1707 wrote down.
        //
        // ADDITIVE, never a rebuild. `computeCheckoutSessionTotals` is the
        // obvious reach and is wrong here: this same branch completes a POS
        // card sale, whose tax and discount are priced into one "In-store
        // purchase" line and are therefore absent from Stripe's
        // `total_details`, so rebuilding would zero them. Only the part Stripe
        // alone knows is folded in, and a session that charged no shipping
        // leaves the document byte-identical — which is every draft that
        // exists today and every counter sale.
        //
        // The whole map is written rather than one field of it, so a
        // `merge`-set's nested-map merge and a plain replace agree.
        const shippingCents = Math.max(
          0,
          Math.round(Number(object?.total_details?.amount_shipping ?? 0) || 0),
        )
        // Tax joins shipping in the fold (AGL-1953). `draft-order.ts` now
        // declares tax — a Stripe Tax Rate for a `manual` store, whose figure
        // it already froze into `totals`, or `automatic_tax` for a `stripe`
        // one, whose figure ONLY Stripe knows and which would otherwise arrive
        // inside `amount_total` with nothing recording it. The same AGL-1698
        // shape shipping was added for.
        //
        // Byte-identical for everything that came before: a POS card sale
        // prices its tax into the single "In-store purchase" line and reports
        // `amount_tax` 0 here (its own figure stays on the order, and its
        // AGL-1953 witness is metadata, not this field), and a draft composed
        // by a store with no tax reports 0 too.
        const stripeTaxCents = Math.max(
          0,
          Math.round(Number(object?.total_details?.amount_tax ?? 0) || 0),
        )
        const chargedTotalCents = Number(object?.amount_total ?? NaN)
        // `shipping_details` ONLY, unlike the cart branch's
        // `?? customer_details` fallback: that address is the BILLING one, and
        // a card sale rung up at a register completes here too — it must not
        // acquire a destination nobody entered and nothing will ship to.
        // Stripe populates this exactly when the session asked for an address,
        // which is exactly when a parcel was priced.
        const shipTo = object?.shipping_details
        // A payment that arrived for an order NOT in `pending` — see the
        // transaction below. Carried out so the money can be reported after
        // the transaction commits.
        let paidAfterCancel = false
        const flipped = await firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(orderRef)
          if (!snapshot.exists) return false
          const lifted = CommerceModel.liftLegacyOrder(
            (snapshot.data() as any) ?? {},
          )
          if (lifted.status !== 'pending') {
            // NOT ALL NON-`pending` ORDERS ARE REDELIVERIES (AGL-2244), and
            // returning false for both is how a real capture went unrecorded.
            // A `cancelled` order whose payment link was paid anyway is money
            // that LANDED in the merchant's Stripe account with nothing in the
            // product to show for it: no order, no stock move, no contact, no
            // notification, not even a timeline line, so the merchant's books
            // and Stripe's disagree and nobody is told which is right.
            //
            // `cancel-order.ts` now expires the session, which stops the
            // ordinary case; this is the backstop for the window between the
            // cancel and the expiry, and for an expiry Stripe refused. Stamped
            // once, keyed on the same status the transaction reads and writes:
            // a redelivery finds `cancelled` too, so the guard is the timeline
            // entry itself, appended only when one is not already there.
            const alreadyNoted = (lifted.timeline ?? []).some(
              (entry) => entry?.event === 'paid-after-cancel',
            )
            if (lifted.status === 'cancelled' && !alreadyNoted) {
              paidAfterCancel = true
              // `set(..., { merge: true })`, the same call the paying branch
              // below makes on this document. Nothing here is a nested map, so
              // merge and replace agree, and the read above has just proven
              // the document exists — the only thing `update()` would add.
              transaction.set(
                orderRef,
                {
                  paidAfterCancel: true,
                  timeline: CommerceModel.appendOrderEvent(
                    lifted,
                    'paid-after-cancel',
                    'This cancelled order was paid anyway — the payment link ' +
                      'was still live. The money is in Stripe and this order ' +
                      'records no sale; refund it in Stripe, or reconcile it ' +
                      'by hand.',
                  ),
                },
                { merge: true },
              )
            }
            return false
          }
          paidOrder = lifted
          transaction.set(
            orderRef,
            {
              status: 'paid',
              // WHICH TAX THIS ORDER CARRIED (AGL-2451), resolved from the
              // session that actually charged it rather than from the draft's
              // frozen composition. `draft-order.ts` stamps its own reading at
              // compose time and this is the authoritative restatement: a
              // Stripe Tax draft freezes `taxCents: 0` and only the paid
              // session knows the figure, so only the paid session can say the
              // regime with the tax in hand.
              //
              // The metadata witness matters here more than anywhere: a POS
              // CARD sale completes through this same branch with the whole
              // basket sent as one opaque `In-store purchase` line, so Stripe
              // states no tax at all and `metadata[taxCents]` is the only
              // record that any of the charge was tax (AGL-1953). Without it
              // every register card sale would stamp `none` beside an order
              // plainly carrying tax.
              taxMode: storefrontTaxModeOf(
                object,
                Number(object?.metadata?.taxCents ?? 0),
              ),
              paymentIntentId: String(object?.payment_intent ?? '') || null,
              customerEmail:
                object?.customer_details?.email ?? lifted.customerEmail ?? null,
              timeline: CommerceModel.appendOrderEvent(lifted, 'paid'),
              ...(shippingCents > 0 || stripeTaxCents > 0
                ? {
                    totals: {
                      ...(lifted.totals ?? {}),
                      ...(shippingCents > 0 ? { shippingCents } : {}),
                      // Stripe's figure REPLACES the frozen one rather than
                      // adding to it: on a manual draft the two are the same
                      // number computed twice (we set the rate Stripe applied),
                      // so summing would double the tax on the record.
                      ...(stripeTaxCents > 0
                        ? { taxCents: stripeTaxCents }
                        : {}),
                      // Stripe's own figure, for the AGL-1698 reason: the
                      // frozen total is what the draft was priced at, and only
                      // `amount_total` is the money that moved.
                      totalCents: Number.isFinite(chargedTotalCents)
                        ? chargedTotalCents
                        : Number(lifted.totals?.totalCents ?? 0) +
                          shippingCents,
                    },
                  }
                : {}),
              ...(shipTo?.address
                ? {
                    shippingAddress: {
                      name: shipTo.name ?? undefined,
                      line1: shipTo.address.line1 ?? undefined,
                      line2: shipTo.address.line2 ?? undefined,
                      city: shipTo.address.city ?? undefined,
                      state: shipTo.address.state ?? undefined,
                      postalCode: shipTo.address.postal_code ?? undefined,
                      country: shipTo.address.country ?? undefined,
                    },
                  }
                : {}),
            },
            { merge: true },
          )
          return true
        })
        // Told to a human, because nothing else will be (AGL-2244). The
        // timeline line above is only findable by someone already looking at
        // the order they have no reason to open; this is money sitting in
        // Stripe against a sale the product does not have.
        if (paidAfterCancel && hostId) {
          await notifyHostManagers(String(hostId), {
            type: 'content.order',
            title: 'A cancelled order was paid',
            body:
              `Order ${orderId} was cancelled, but its payment link was still ` +
              'live and has been paid. The money is in Stripe and no sale was ' +
              'recorded — refund it in Stripe or reconcile it by hand.',
            link: `/${hostId}/orders`,
          })
        }
        if (flipped) {
          const order = paidOrder as unknown as CommerceModel.HostOrder
          void notifyHostManagers(String(hostId), {
            type: 'content.order',
            title: `Draft order paid — ${CommerceModel.formatOrderNumber(order, String(orderId))}`,
            link: `/${hostId}/products`,
          })
          // Contacts ingestion (AGL-1748): this branch flipped the order,
          // notified managers and decremented stock, but never reached
          // `upsertHostContact` — so a buyer who paid a merchant-sent payment
          // link never became a contact AT ALL, and neither did a POS card
          // customer, because `pos-order.ts` completes its QR sale through this
          // same `commerce-draft` branch rather than through its own handler.
          //
          // The amount is what Stripe charged (`amount_total`), for the
          // AGL-1698/AGL-1711 reason — the stored `totals.totalCents` is the
          // figure the draft was priced at, and the two agree by construction,
          // but only one of them is the money that moved. Stored totals remain
          // the fallback for a session shape that reports no total.
          const draftEmail =
            object?.customer_details?.email ?? order.customerEmail ?? null
          if (draftEmail) {
            const chargedCents =
              Number(object?.amount_total ?? 0) ||
              Number(order.totals?.totalCents ?? 0)
            await upsertHostContact({
              hostId: String(hostId),
              email: draftEmail,
              name: object?.customer_details?.name ?? undefined,
              source: 'order',
              ...(chargedCents > 0 ? { purchaseCents: chargedCents } : {}),
              interaction: {
                refId: String(orderId),
                summary: `Paid ${CommerceModel.formatOrderNumber(
                  order,
                  String(orderId),
                )} ($${(chargedCents / 100).toFixed(2)})`,
              },
            })
          }
          if (productId) {
            const productRef = hostRef
              .collection('products')
              .doc(String(productId))
            const productSnapshot = await productRef.get()
            const lifted = CommerceModel.liftLegacyProduct(
              (productSnapshot.data() as any) ?? { name: 'Product' },
            )
            const soldVariantId =
              String(object.metadata?.variantId ?? '') ||
              lifted.variants[0]?.id
            const quantity = order.lineItems?.[0]?.quantity ?? 1
            if (soldVariantId) {
              // Atomic since AGL-2320.
              const moved = await decrementVariantStock({
                firestore,
                hostRef,
                hostId: String(hostId),
                productId: String(productId),
                variantId: soldVariantId,
                quantity,
                ledger: { reason: 'sale', orderId: String(orderId) },
              })
              // `before`/`after` absent means nothing was written — a missing
              // product, an untracked variant, or a failed commit — and a
              // ledger row would then claim a movement the count never made.
              if (moved.before && moved.after) {
                // The AGL-1807 ledger row now rides inside the decrement's
                // own transaction (AGL-2161), so the `orderId` above is the
                // ORDER doc id from the metadata rather than `object.id` —
                // unlike the siblings, this branch's session id names no order
                // document, and `cancel-order.ts` looks the row up by that id.
                // Low-stock crossing alert (AGL-1826): a merchant-sent payment
                // link used to sell a product down to its threshold in
                // silence. The `pending` -> `paid` flip bounds redelivery.
                alertLowStockCrossing(String(hostId), moved.before, moved.after)
              }
            }
          } else {
            // POS card sale (AGL-1825). This branch's other tenant: the
            // register's QR session carries `{type, hostId, orderId}` and no
            // `productId`, so the decrement above was unreachable for every
            // card sale — the sale completed, contacts and totals were
            // recorded, and the shelf count never moved, while the SAME basket
            // paid in cash decremented per line in `pos-order.ts`. The order
            // document already holds the server-priced `lineItems`, so the
            // per-line loop runs here, in the AGL-281 shape, behind the same
            // `pending` -> `paid` guard that bounds the contact increment.
            //
            // Location-aware (AGL-286): the register's chosen bucket rides on
            // the order (`pos-order.ts` stores it on the pending write), and
            // by webhook time it exists nowhere else. An order minted before
            // that write carries none and falls back to the flat count.
            //
            // An `else`, not a second loop: a console draft carries BOTH
            // `productId` metadata and `lineItems`, and running both paths
            // would decrement it twice.
            const paidProducts = new Map<string, CommerceModel.HostProduct>()
            for (const line of order.lineItems ?? []) {
              const lineProductId = String(line?.productId ?? '')
              const soldQty = Math.round(Number(line?.quantity ?? 0))
              if (!lineProductId || !(soldQty > 0)) continue
              // Firestore reserves `__…__` ids and `.doc()` throws
              // synchronously on one; a corrupt line must not fail the
              // webhook (the restock-flag reader applies the same guard).
              if (/^__.*__$/.test(lineProductId)) continue
              if (!paidProducts.has(lineProductId)) {
                const productSnapshot = await hostRef
                  .collection('products')
                  .doc(lineProductId)
                  .get()
                paidProducts.set(
                  lineProductId,
                  CommerceModel.liftLegacyProduct(
                    (productSnapshot.data() as any) ?? { name: 'Product' },
                  ),
                )
              }
              const lineProduct = paidProducts.get(
                lineProductId,
              ) as CommerceModel.HostProduct
              const soldVariantId =
                line.variantId ?? lineProduct.variants[0]?.id
              if (
                !soldVariantId ||
                !lineProduct.variants.some(
                  (variant) =>
                    variant.id === soldVariantId &&
                    variant.inventory != null,
                )
              ) {
                continue
              }
              // Two lines of one product must COMPOUND: the next line starts
              // from these variants, not from the product as first read —
              // recomputing from the original would erase this decrement
              // when the sibling line's write landed. Since AGL-2320 the
              // transaction's own re-read is what compounds them, and it also
              // sees a concurrent request's write, which this map never could.
              const moved = await decrementVariantStock({
                firestore,
                hostRef,
                hostId: String(hostId),
                productId: lineProductId,
                variantId: soldVariantId,
                quantity: soldQty,
                locationId: order.locationId || undefined,
                ledger: { reason: 'sale', orderId: String(orderId) },
              })
              if (!moved.before || !moved.after) continue
              paidProducts.set(lineProductId, moved.after)
              // The AGL-1807 ledger row is written by the decrement itself
              // now (AGL-2161), joined to the ORDER doc (the session id names
              // no order) and carrying the location the units left. That join
              // is what lets `cancel-order.ts` tell a decremented card sale
              // from one that predates it — and, because the row can no longer
              // be lost on its own, absence of a row is now proof the count
              // never moved rather than a coin flip.
              // Low-stock crossing alert (AGL-1826): the register is the
              // channel most likely to be selling down the last few units of
              // physical shelf stock, and crossed in silence. The compounded
              // pair means two lines of one product cross exactly once, on
              // the line that breaches; the `pending` -> `paid` flip bounds
              // redelivery.
              alertLowStockCrossing(String(hostId), moved.before, moved.after)
            }
          }
        }
      }
    }

    // Commerce Starter orders (AGL-90): recorded under the selling host.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'commerce-order' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, productId, feeCents, couponCode } =
        object.metadata ?? {}
      if (hostId && productId) {
        const firestore = firebaseAdmin.app().firestore()
        const hostRef = firestore.collection('hosts').doc(String(hostId))
        // Orders v1 (AGL-283): line-item snapshot + totals + timeline with
        // a per-host sequential number; legacy flat fields stay for old
        // rows/readers. Transaction keeps numbers gapless per webhook
        // delivery (replays reuse the same order doc id, so re-numbering
        // is bounded to Stripe's at-least-once edge).
        const orderRef = hostRef.collection('orders').doc(String(object.id))
        const counterRef = hostRef.collection('counters').doc('orders')
        const amountCents = Number(object?.amount_total ?? 0)
        const productForSnapshot = await hostRef
          .collection('products')
          .doc(String(productId))
          .get()
        const snapshotName = String(
          productForSnapshot.get('name') ?? 'Product',
        )
        // AGL-1711: the line item and totals used to be fabricated from
        // `amount_total` alone — one unit, priced at the whole charge, with tax
        // and discount recorded as 0. `computeBuyNowOrder` rebuilds the real
        // decomposition from Stripe's `total_details` plus the two components
        // our own session shape hides from it (the manual tax line item and the
        // coupon priced into the unit amount), both carried in the metadata.
        const liftedForSnapshot = CommerceModel.liftLegacyProduct(
          (productForSnapshot.data() as any) ?? { name: snapshotName },
        )
        const soldVariant = object.metadata?.variantId
          ? liftedForSnapshot.variants.find(
              (item) => item.id === String(object.metadata.variantId),
            )
          : liftedForSnapshot.variants[0]
        const variantOptions = Object.values(soldVariant?.options ?? {})
        const { lineItems: buyNowLineItems, totals: buyNowTotals } =
          CommerceModel.computeBuyNowOrder(object, {
            name: snapshotName,
            ...(variantOptions.length
              ? { variantLabel: variantOptions.join(' / ') }
              : {}),
            ...(soldVariant?.sku ? { sku: soldVariant.sku } : {}),
            ...(liftedForSnapshot.type
              ? { productType: liftedForSnapshot.type }
              : {}),
            ...(liftedForSnapshot.supplierId
              ? { supplierId: liftedForSnapshot.supplierId }
              : {}),
          })
        const soldQuantity = buyNowLineItems[0]?.quantity ?? 1
        const created = await firestore.runTransaction(async (transaction) => {
          const [existing, counter] = await Promise.all([
            transaction.get(orderRef),
            transaction.get(counterRef),
          ])
          if (existing.exists) return false
          const number = Number(counter.get('next') ?? 1)
          transaction.set(counterRef, { next: number + 1 }, { merge: true })
          transaction.set(orderRef, {
            number,
            status: 'paid',
            channel: 'online',
            lineItems: buyNowLineItems,
            totals: buyNowTotals,
            // WHICH TAX THIS SALE CARRIED (AGL-2451). Buy-now's manual tax
            // goes over as an ordinary `line_items[1]` Stripe is never told is
            // tax (AGL-1711), so the session reports `amount_tax: 0` and
            // `metadata[taxCents]` — the key `checkout.ts` writes — is the only
            // witness. Same resolver as the filed tax row, same witness.
            taxMode: storefrontTaxModeOf(
              object,
              Number(object?.metadata?.taxCents ?? 0),
            ),
            timeline: [{ atMs: Date.now(), event: 'paid' }],
            paymentIntentId: String(object?.payment_intent ?? '') || null,
            checkoutSessionId: String(object.id),
            customerName: object?.customer_details?.name ?? null,
            createdAtMs: Date.now(),
            // Legacy Commerce Starter fields (AGL-90).
            productId,
            amountCents,
            feeCents: Number(feeCents ?? 0),
            customerEmail: object?.customer_details?.email ?? null,
            ...(couponCode ? { couponCode } : {}),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
          return true
        })
        // Redelivery guard (AGL-498): skip the notification + fulfilment side
        // effects when this order already existed.
        if (!created) return
        // In-app order notification (wave v6): host managers see sales
        // in the bell, not just the owner's email.
        void notifyHostManagers(String(hostId), {
          type: 'content.order',
          title: `New order — $${(Number(object?.amount_total ?? 0) / 100).toFixed(2)}`,
          ...(object?.customer_details?.email
            ? { body: `From ${object.customer_details.email}` }
            : {}),
          link: `/${hostId}/products`,
        })
        // Dropship routing (AGL-289): paid lines with a supplier notify
        // it (signed webhook and/or email) and stash a callback token so
        // the supplier can post tracking back. Plan-gated; failures never
        // fail the webhook.
        //
        // AWAITED SINCE AGL-2473, and the reason it can be is that the
        // supplier POST is no longer in it. This was `void (async () => …)()`
        // whose last act was `fetch(supplier.webhookUrl)` — a merchant-typed
        // endpoint on a host we do not run — and Vercel freezes the container
        // when the response is written, so a slow supplier was a supplier
        // never told, with nothing written down to say a notification was
        // owed. AGL-2161 declined to await it because a supplier timing out
        // would push this handler past Stripe's window and buy a DUPLICATED
        // order in exchange; that objection is now moot, because what is left
        // here touches only Aglyn's own Firestore and Aglyn's own mail
        // provider — the same things `refund.ts` awaits, for the same reason.
        // The one call to a stranger's server is a queued row that
        // `supplier-outbox.ts` retries out of band.
        await (async () => {
          try {
            const routedOrg = await getOrgForHost(String(hostId))
            if (
              !Aglyn.checkEntitlement(routedOrg?.org as any, 'dropshipRouting')
            ) {
              return
            }
            const routedProduct = await hostRef
              .collection('products')
              .doc(String(productId))
              .get()
            const supplierId = routedProduct.get('supplierId')
            if (!supplierId) return
            const supplierSnapshot = await hostRef
              .collection('suppliers')
              .doc(String(supplierId))
              .get()
            const supplier = supplierSnapshot.data() as
              | CommerceModel.HostSupplier
              | undefined
            if (!supplier) return
            const supplierToken = createHmac('sha256', tokenSigningSecret())
              .update(`${hostId}:${object.id}:${supplierId}`)
              .digest('hex')
              .slice(0, 32)
            const orderReference = hostRef
              .collection('orders')
              .doc(String(object.id))
            await orderReference.set(
              {
                supplierToken,
                timeline: firebaseAdmin.firestore.FieldValue.arrayUnion({
                  atMs: Date.now(),
                  event: 'routed',
                  detail: `Sent to supplier ${supplier.name}`,
                }),
              },
              { merge: true },
            )
            const payload = {
              hostId: String(hostId),
              orderId: String(object.id),
              productId: String(productId),
              productName: String(routedProduct.get('name') ?? 'Product'),
              // AGL-1711: the supplier was told to ship one unit however many
              // the buyer paid for.
              quantity: soldQuantity,
              customerEmail: object?.customer_details?.email ?? null,
              shippingName: object?.customer_details?.name ?? null,
              updateUrl:
                `https://${requestHost}/api/commerce/supplier-update` +
                `?hostId=${hostId}&orderId=${object.id}&token=${supplierToken}`,
            }
            if (supplier.webhookUrl) {
              // QUEUED, NOT POSTED (AGL-2473). One Firestore write, then the
              // job beat owns the delivery: retries with backoff, and a dead
              // letter that stamps this order's timeline and rings the bell
              // when a supplier stays unreachable. The BODY is frozen here
              // because `updateUrl` is built from `requestHost`, which is a
              // property of this request that no later pass can recover; the
              // endpoint and the signing secret are deliberately NOT frozen,
              // so a merchant correcting a typo'd URL fixes what is already
              // queued and no shared secret is copied into a second document.
              await enqueueSupplierDelivery({
                firestore,
                hostId: String(hostId),
                orderId: String(object.id),
                supplierId: String(supplierId),
                supplierName: String(supplier.name ?? ''),
                url: String(supplier.webhookUrl),
                body: JSON.stringify(payload),
              })
            }
            if (supplier.email) {
              await sendEmail({
                to: supplier.email,
                subject: `New order to fulfill: ${payload.productName}`,
                text:
                  `${payload.quantity}× ${payload.productName}\n` +
                  `Ship to: ${payload.shippingName ?? payload.customerEmail ?? 'see order'}\n\n` +
                  `Add tracking: ${payload.updateUrl}&trackingNumber=TRACKING&carrier=CARRIER`,
                fromName: (await brandFor(hostId)).fromName,
                context: 'dropship supplier notice',
              })
              // Cost meter (AGL-1438). Transactional: without it the order is
              // never fulfilled.
              await meterHostEmail(String(hostId))
            }
          } catch (routingError) {
            console.error('Dropship routing failed', routingError)
          }
        })()
        // Contacts ingestion (AGL-197): buyers become contacts.
        await upsertHostContact({
          hostId: String(hostId),
          email: object?.customer_details?.email,
          name: object?.customer_details?.name ?? undefined,
          source: 'order',
          purchaseCents: Number(object?.amount_total ?? 0),
          interaction: {
            refId: String(object.id),
            summary: `Placed an order ($${(Number(object?.amount_total ?? 0) / 100).toFixed(2)})`,
          },
        })
        const productRef = hostRef.collection('products').doc(String(productId))
        const productSnapshot = await productRef.get()
        // Inventory decrement (AGL-281): variant-aware with an adjustment
        // log; the checkout guard makes negative stock a race-window edge,
        // and the helper floors at zero. Legacy flat `inventory` stays
        // denormalized for the Product block.
        //
        // ATOMIC since AGL-2320. The read that decided the new count used to be
        // this branch's own `productSnapshot`, taken before the order write,
        // the licence keys and the receipt email — a wide window in which a
        // second sale's write was simply overwritten. `decrementVariantStock`
        // re-reads and writes inside one transaction, so concurrent sales
        // serialize; the snapshot above is still read, for the product NAME on
        // the receipt below, and no longer decides any count.
        {
          const lifted = CommerceModel.liftLegacyProduct(
            (productSnapshot.data() as any) ?? { name: 'Product' },
          )
          const soldVariantId =
            String(object.metadata?.variantId ?? '') ||
            lifted.variants[0]?.id
          if (soldVariantId) {
            // AGL-1711: `-1` regardless of how many units were bought, so a
            // 3-unit buy-now sale decremented stock by one and the difference
            // was silently oversellable. `canPurchase` already gated the full
            // quantity at checkout, so this is the only place it was dropped.
            const moved = await decrementVariantStock({
              firestore,
              hostRef,
              hostId: String(hostId),
              productId: String(productId),
              variantId: soldVariantId,
              quantity: soldQuantity,
              ledger: { reason: 'sale', orderId: String(object.id) },
            })
            if (moved.before && moved.after) {
              // Low-stock alert (AGL-281): fires on the crossing sale only,
              // so managers get one nudge per threshold breach, not one per
              // order after it. The check lived inline here — the one branch
              // of four that had it — until AGL-1826 extracted it to sit
              // beside every decrement; semantics unchanged.
              alertLowStockCrossing(String(hostId), moved.before, moved.after)
            }
          }
        }
        // Settlement, the same way round and for the same reason as the cart
        // branch above (AGL-2356): the decrement lands first, then the
        // reservation is dropped.
        await releaseStockHold(
          hostRef,
          String(object.metadata?.stockHoldKey ?? ''),
        )
        if (couponCode) {
          await settleRedemption({
            firestore,
            ref: hostRef.collection('coupons').doc(String(couponCode)),
            holdKey: String(object.metadata?.couponHoldKey ?? ''),
            orderRef,
            label: `coupon ${couponCode}`,
            detail:
              `Coupon ${couponCode} was applied to this order but no longer ` +
              'exists, so the redemption is uncounted against its limit.',
          })
        }
        // Receipt + seller notification (AGL-96): env-gated like every
        // other outbound email; failures never fail the webhook.
        if (isEmailConfigured()) {
          const productName = String(
            productSnapshot.get('name') ?? 'your purchase',
          )
          const amount = (Number(object?.amount_total ?? 0) / 100).toFixed(2)
          const buyerEmail = object?.customer_details?.email
          const orderTotal = `$${amount}`
          if (buyerEmail) {
            const fallbackText =
              `Thanks for your purchase!\n\n${productName} — $${amount}` +
              `\nOrder reference: ${object.id}`
            // Site-owner-designed template when published (AGL-771).
            const designed = await renderHostEmailWithTokens(
              firebaseAdmin.app().firestore(),
              String(hostId),
              'order-receipt',
              {
                'order.summary': productName,
                'order.total': orderTotal,
                'order.ref': String(object.id),
              },
            )
            await sendEmail({
              to: String(buyerEmail),
              subject: designed?.subject ?? `Receipt: ${productName}`,
              text: designed?.text || fallbackText,
              ...(designed?.html ? { html: designed.html } : {}),
              fromName: (await brandFor(hostId)).fromName,
              context: 'receipt',
            })
            // Cost meter (AGL-1438). Transactional, as the cart receipt above.
            await meterHostEmail(String(hostId))
          }
          const hostSnapshot = await hostRef.get()
          const sellerUid = (await getOrgForHost(String(hostId)))?.org
            ?.ownerUid
          if (sellerUid) {
            // Across pools (AGL-1144/AGL-1122). This was a project-level
            // `getUser`, which THROWS `auth/user-not-found` for a seller who
            // signs in through SSO — their record lives in their org's GCIP
            // tenant. The `.catch(() => null)` then skipped the block
            // entirely, so an SSO merchant was never told they had made a
            // sale, on any order, ever, with nothing logged.
            //
            // The order itself was never at risk: this runs after payment,
            // the buyer's receipt above uses the address from the order, and
            // no payout logic reads this. It is a notification, and it was
            // silently absent for exactly the customers on the plan that has
            // SSO.
            const seller = (await findUserByUidAcrossPools(sellerUid).catch(
              () => null,
            ))?.record
            if (seller?.email) {
              const siteName = String(
                hostSnapshot.get('displayName') ?? hostId,
              )
              const fallbackText =
                `You made a sale on ${siteName}!\n\n${productName} — $${amount}` +
                (buyerEmail ? `\nBuyer: ${buyerEmail}` : '') +
                `\nOrder reference: ${object.id}`
              // Site-owner-designed template when published (AGL-771).
              const designed = await renderHostEmailWithTokens(
                firebaseAdmin.app().firestore(),
                String(hostId),
                'sale-notification',
                {
                  'site.name': siteName,
                  'order.summary': `${productName} — $${amount}`,
                  'order.total': orderTotal,
                  'buyer.email': String(buyerEmail ?? ''),
                  'order.ref': String(object.id),
                },
              )
              await sendEmail({
                to: seller.email,
                subject: designed?.subject ?? `New order: ${productName}`,
                text: designed?.text || fallbackText,
                ...(designed?.html ? { html: designed.html } : {}),
                fromName: (await brandFor(hostId)).fromName,
                context: 'seller order notice',
              })
              // Cost meter (AGL-1438). Transactional: the seller learns about
              // the order here.
              await meterHostEmail(String(hostId))
            }
          }
        }
      }
    }

  // Card disputes against a merchant's store (AGL-1787).
  //
  // Commerce subscribed no `charge.dispute.*` event at all, so a shopper
  // chargeback reversed NOTHING: the order stayed `paid`, `refundedCents`
  // stayed 0 so the orders CSV reported the sale as kept (AGL-1747), the
  // buyer's contact kept its full `ltvCents` with no reversal beside it
  // (AGL-1754), the shopper kept every download and membership the five
  // `'refunded'` gates would have withdrawn, and no manager was told a dispute
  // existed while there was still time to answer it.
  //
  // TWO events, and only one of them touches money. `created` flags and
  // notifies; `closed` settles, reversing only on `status: 'lost'`. The
  // lifecycle's other events are deliberately NOT subscribed:
  // `charge.dispute.funds_withdrawn` and `funds_reinstated` describe the
  // PLATFORM's balance moving on a destination charge, not the merchant's, so
  // stamping them on a merchant's order would assert a movement that did not
  // happen in their account; `charge.dispute.updated` is evidence-submission
  // churn with no ledger consequence.
  //
  // The endpoint must subscribe both events for any of this to run —
  // `tools/scripts/setup-stripe.mjs` now creates them, and the EXISTING live
  // endpoint needs them added by hand (that script never edits an endpoint it
  // finds). AGL-1554 will add its own `closed` branch for the marketplace
  // side; the two coexist because each self-selects by finding its own record.
  if (type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
    const dispute = (object ?? {}) as StripeDispute
    const paymentIntentId = String(dispute.payment_intent ?? '')
    const lookup: DisputeLookup = paymentIntentId
      ? await findOrderForDispute(paymentIntentId)
      : { kind: 'not-ours' }
    // UNRESOLVED IS NOT NOT-OURS (AGL-2161). A lookup that could not run is
    // the platform's problem and is reported; a lookup that ran and matched
    // nothing is a marketplace, booking or platform-billing dispute, and
    // silence is the correct answer — see `findOrderForDispute`.
    if (lookup.kind === 'unresolved') {
      await reportUnresolvedDispute(lookup.reason, paymentIntentId, dispute)
    }
    // TELL THE ROUTE WE RECOGNISED IT (AGL-2429). A storefront chargeback is
    // the ORDINARY answer to "no platform revenue row matched", and the route
    // could not tell it apart from a dispute that nothing at all handled —
    // so it stayed silent about both. Claiming here is what buys the route
    // the right to alert on the ones nobody claimed.
    //
    // `unresolved` claims too: the lookup could not run, which
    // `reportUnresolvedDispute` has just raised with staff by name. A second,
    // vaguer alert from the route would describe the same incident twice.
    const claimed = lookup.kind === 'order' || lookup.kind === 'unresolved'
    const snapshot = lookup.kind === 'order' ? lookup.snapshot : null
    if (snapshot) {
      const hostId = String(snapshot.ref.parent.parent?.id ?? '')
      if (type === 'charge.dispute.created') {
        const { opened, record } = await recordDisputeOpened(snapshot, dispute)
        if (opened && hostId) {
          // Time-critical — Stripe's evidence window is days, not weeks — so
          // this is awaited rather than fired off with `void`: the handler is
          // serverless and work left running past the response is work the
          // container may be frozen before it finishes. `notifyHostManagers`
          // never throws.
          await notifyHostManagers(hostId, {
            type: 'content.order',
            title: `Chargeback opened — $${(record.amountCents / 100).toFixed(2)}`,
            body:
              `Order ${snapshot.id} was disputed` +
              (record.reason ? ` (${record.reason.replace(/_/g, ' ')})` : '') +
              (record.evidenceDueByMs
                ? `. Evidence is due ${new Date(record.evidenceDueByMs)
                    .toISOString()
                    .slice(0, 10)}.`
                : '. Respond in Stripe.'),
            link: `/${hostId}/orders`,
          })
        }
      } else {
        const settled = await recordDisputeClosed(snapshot, dispute)
        if (settled.recorded && hostId) {
          await notifyHostManagers(hostId, {
            type: 'content.order',
            title: settled.lost
              ? `Chargeback lost — $${(settled.reversedCents / 100).toFixed(2)} reversed`
              : 'Chargeback resolved in your favor',
            body: `Order ${snapshot.id}`,
            link: `/${hostId}/orders`,
          })
          // The customer's side of the ledger (AGL-1754), through the same
          // writer a refund uses and with `kind` set so the contact's timeline
          // says "charged back". Skipped when nothing was reversed: a won
          // dispute moved no money, and a lost one that found nothing left to
          // reverse would otherwise record a $0 entry against the buyer.
          if (settled.reversedCents > 0) {
            await recordContactRefund({
              hostId,
              orderId: snapshot.id,
              email: settled.customerEmail,
              amountCents: settled.reversedCents,
              closedTheOrder: settled.closedTheOrder,
              kind: 'chargeback',
            })
            // The shelf's side (AGL-1797), the SAME door the admin-initiated
            // refund writes so the two cannot diverge the way the contact
            // ledger did before AGL-1754. It flags rather than releases, and a
            // chargeback is the clearest do-not-restock case there is — the
            // shopper kept the item and took the money — so `kind` only changes
            // the wording the merchant reads. A WON dispute never reaches here
            // (`reversedCents` is 0), which is right: nothing was reversed, so
            // nothing is missing from the shelf.
            await flagOrderRestock({
              hostId,
              orderId: snapshot.id,
              kind: 'chargeback',
              closedTheOrder: settled.closedTheOrder,
            })
          }
        }
        // The platform's side of the money (AGL-1794): pull the seller's
        // share back from the connected account. OUTSIDE the `recorded` guard
        // on purpose — a redelivery whose settle was idle is exactly how a
        // transiently-failed reversal gets its retry — and gated inside on
        // the order's own `reversedTransferCents` marker, so it runs at most
        // once per dispute however many times Stripe delivers.
        if (String(dispute?.status ?? '') === 'lost') {
          const pulledBackCents = await reverseSellerShare(
            snapshot.ref,
            dispute,
          )
          // The merchant-experience half of the AGL-1794 decision, and not an
          // optional extra: the reversal takes money out of the connected
          // account, and when the balance does not cover it Stripe carries a
          // NEGATIVE balance and recovers it from future payouts. A merchant
          // who learns that from a short payout weeks later has been told by
          // the wrong party.
          //
          // The outcome notice above is a different message with a different
          // number: it reports what the SHOPPER's bank took back, which on a
          // destination charge left the platform's balance, not theirs. This
          // one reports the seller share that left THEIRS. Only sent when the
          // transfer reversal actually settled on this delivery — a redelivery
          // and every definitive no-op return 0, so the merchant is told once
          // and never told about money that did not move.
          if (pulledBackCents > 0 && hostId) {
            await notifyHostManagers(hostId, {
              type: 'content.order',
              title: `Payout adjusted — $${(pulledBackCents / 100).toFixed(2)} recovered for a lost chargeback`,
              body:
                `Order ${snapshot.id}: the amount transferred to you for this sale has been ` +
                `reversed. If your balance does not cover it, Stripe recovers the remainder ` +
                `from your future payouts.`,
              link: `/${hostId}/orders`,
            })
          }
        }
      }
    }
    return { claimed }
  }
}
