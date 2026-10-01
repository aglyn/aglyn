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
// work scheduled any other way simply does not run.
import { after } from 'next/server'

import type { BillingWebhookHandler } from '@aglyn/aglyn/server'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
  notifyHostManagers,
  notifyRiskEvent,
  renderHostEmailWithTokens,
  sendGa4Purchase,
} from '@aglyn/tenant-data-admin'
import { paymentRiskEventFrom } from '@aglyn/aglyn/app-utils/payment-risk'
import {
  recordPaymentRiskOnRecord,
  settlePaymentRiskDisputeOnRecord,
} from '@aglyn/tenant-data-admin/server/payment-risk-record'
import {
  reverseDestinationTransfer,
  type TransferReversalFailure,
} from '@aglyn/tenant-data-admin/server/stripe-transfer-reversal'
import { captureHostContact } from '@aglyn/tenant-runtime'
import {
  bookingPlatformNetCents,
  shouldSendBookingPlatformPurchase,
} from '../model/booking-purchase-analytics'
import { sendEmail } from '@aglyn/shared-util-email'
import { pluginTaxProfile } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { fileBookingOnCrm } from './booking-crm'
import { bookingTimeZoneFor } from './booking-time-zone'
import { formatBookingWhen } from '../model/booking-time'

/**
 * Paid-booking section of the platform Stripe webhook (AGL-170/418):
 * payment confirms the pendingPayment hold — relocated verbatim from the
 * console route; registered via registerBookingsConsoleApi.
 */
/** gRPC `Status.FAILED_PRECONDITION` — Firestore's "this query needs an index". */
const GRPC_FAILED_PRECONDITION = 9

/**
 * The booking a charge paid for, found by the `paymentIntentId` the paid
 * handler below records (AGL-2315), or null. A missing collection-group
 * index is logged and answered null rather than thrown: no redelivery can
 * fix it, and the dispute then reaches staff through the route's
 * unattributed-dispute alert instead of vanishing.
 */
async function findBookingForPayment(
  paymentIntentId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  if (!paymentIntentId) return null
  const matches = await firebaseAdmin
    .app()
    .firestore()
    .collectionGroup('bookings')
    .where('paymentIntentId', '==', paymentIntentId)
    .limit(2)
    .get()
    .catch((error: { code?: number }) => {
      if (error?.code !== GRPC_FAILED_PRECONDITION) throw error
      console.error(
        'Booking payment lookup needs the collection-group index on ' +
          'bookings.paymentIntentId (AGL-3360)',
        error,
      )
      return null
    })
  // One payment intent pays one booking; two is corrupt data, and stamping
  // an arbitrary one would tell the wrong merchant.
  return matches && matches.docs.length === 1 ? matches.docs[0] : null
}

/** What a booking records once its lost dispute's reversal is settled. */
interface BookingDisputeReversal {
  disputeId: string
  reversedTransferCents: number
  transferReversalId?: string
  /** Why nothing was pulled back, when nothing was. */
  failedReason?: TransferReversalFailure
  owedCents?: number
  atMs: number
}

/**
 * The merchant's share of a LOST booking dispute, pulled back from the
 * connected account (AGL-3363), by the AGL-1794 policy a store order follows:
 * the Stripe half is the shared `reverseDestinationTransfer`, this is only
 * the booking's own record.
 *
 * IDEMPOTENT BY THE BOOKING: `disputeReversal` for this dispute, present,
 * means settled and a redelivery returns before any Stripe call. A delivery
 * that died after the POST is healed by the seam adopting the reversal the
 * transfer already carries. A transient Stripe failure THROWS (the seam
 * does), leaving the marker unset so Stripe's redelivery retries it. A final
 * failure is settled with its reason and the owed amount, so it is findable.
 *
 * `cents` is non-zero only for the delivery that wrote the reversal, which
 * is the one that tells the merchant.
 */
async function reverseBookingSellerShare(
  bookingRef: FirebaseFirestore.DocumentReference,
  dispute: any,
): Promise<{ cents: number; settled: 'reversed' | 'failed' | 'pending' }> {
  const disputeId = String(dispute?.id ?? '')
  const amountCents = Math.max(0, Math.round(Number(dispute?.amount ?? 0)))
  if (!disputeId || !(amountCents > 0)) return { cents: 0, settled: 'failed' }
  const firestore = firebaseAdmin.app().firestore()
  const prior = (await bookingRef.get()).get('disputeReversal') as
    | BookingDisputeReversal
    | undefined
  if (prior?.disputeId === disputeId) {
    return { cents: 0, settled: prior.failedReason ? 'failed' : 'reversed' }
  }
  const outcome = await reverseDestinationTransfer({
    kind: 'dispute',
    id: disputeId,
    amountCents,
    chargeId:
      typeof dispute?.charge === 'string' ? dispute.charge : String(dispute?.charge?.id ?? ''),
    metadata: { bookingId: bookingRef.id },
  })
  if (outcome.kind === 'skipped') {
    console.error('Booking transfer reversal skipped: STRIPE_SECRET_KEY is not set (AGL-3363)')
    return { cents: 0, settled: 'pending' }
  }
  const record: BookingDisputeReversal =
    outcome.kind === 'reversed'
      ? {
          disputeId,
          reversedTransferCents: outcome.cents,
          ...(outcome.reversalId ? { transferReversalId: outcome.reversalId } : {}),
          atMs: Date.now(),
        }
      : {
          disputeId,
          reversedTransferCents: 0,
          failedReason: outcome.reason,
          ...(outcome.owedCents != null ? { owedCents: outcome.owedCents } : {}),
          atMs: Date.now(),
        }
  if (outcome.kind === 'not-reversed') {
    console.error('Booking seller share NOT reversed — recorded on the booking', {
      bookingId: bookingRef.id,
      disputeId,
      reason: outcome.reason,
    })
  }
  const wrote = await firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(bookingRef)
    if (!fresh.exists) return false
    const current = fresh.get('disputeReversal') as BookingDisputeReversal | undefined
    if (current?.disputeId === disputeId) return false
    transaction.set(bookingRef, { disputeReversal: record }, { merge: true })
    return true
  })
  return {
    cents: wrote && outcome.kind === 'reversed' ? outcome.cents : 0,
    settled: outcome.kind === 'reversed' ? 'reversed' : 'failed',
  }
}

export const bookingsBillingWebhookHandler: BillingWebhookHandler = async ({
  type,
  object,
}) => {
    // Fraud signals on a paid booking (AGL-3360): an issuer's early fraud
    // warning, a Radar review, or a dispute. Booking deposits never heard
    // about any of them, so the merchant learned of a chargeback from Stripe
    // alone. The signal now lands on the BOOKING, through the shared
    // `paymentRisk` shape every plugin stamps, and the site's managers are
    // told once. Nothing is refunded or canceled: the merchant decides.
    const risk = paymentRiskEventFrom(type, object)
    if (risk) {
      const booking = await findBookingForPayment(risk.paymentIntentId)
      if (!booking) return
      const hostId = String(booking.ref.parent.parent?.id ?? '')
      await recordPaymentRiskOnRecord(
        {
          ref: booking.ref,
          signal: risk.signal,
          hostId,
          subjectLabel: `the booking for ${String(booking.get('serviceName') ?? booking.id)}`,
          link: `/${hostId}/bookings`,
          notificationType: 'content.booking',
          amount: Number.isFinite(Number(booking.get('paidAmountCents')))
            ? `$${(Number(booking.get('paidAmountCents')) / 100).toFixed(2)}`
            : null,
          evidenceDueByMs:
            Number((object as { evidence_details?: { due_by?: unknown } })?.evidence_details?.due_by ?? 0) * 1000 || null,
        },
        { firestore: firebaseAdmin.app().firestore(), notifyRisk: notifyRiskEvent },
      )
      return { claimed: true, hostId }
    }
    // A dispute's outcome, on the signal `created` stamped. A LOST one pulls
    // the merchant's share back from the connected account (AGL-3363), through
    // the same seam a lost store order uses, so the platform no longer absorbs
    // a booking chargeback. Claimed when the share came back; a reversal that
    // could not be made stays unclaimed, so the route's unattributed-dispute
    // alert still tells staff about money nothing recovered.
    if (type === 'charge.dispute.closed') {
      const paymentIntentId =
        typeof object?.payment_intent === 'string'
          ? object.payment_intent
          : String(object?.payment_intent?.id ?? '')
      const booking = await findBookingForPayment(paymentIntentId)
      if (!booking) return
      const outcome = String(object?.status ?? '')
      await settlePaymentRiskDisputeOnRecord(
        booking.ref,
        String(object?.id ?? ''),
        outcome,
        { firestore: firebaseAdmin.app().firestore() },
      )
      const hostId = String(booking.ref.parent.parent?.id ?? '')
      if (outcome !== 'lost') return { claimed: true, hostId }
      const recovered = await reverseBookingSellerShare(booking.ref, object)
      if (recovered.cents > 0 && hostId) {
        const recoveredText = `$${(recovered.cents / 100).toFixed(2)}`
        const guest = String(booking.get('name') ?? '').trim()
        const service = String(booking.get('serviceName') ?? '').trim() || 'a service'
        await notifyHostManagers(hostId, {
          type: 'content.booking',
          title: `Payout adjusted — ${recoveredText} recovered for a lost chargeback`,
          body:
            `${guest ? `${guest}'s payment` : 'A payment'} for ${service} on ` +
            `{site} was charged back and the dispute was lost, so ` +
            `the ${recoveredText} transferred to you for it has been taken back. ` +
            `If your balance does not cover it, Stripe recovers the rest from ` +
            `your future payouts.`,
          link: `/${hostId}/bookings`,
        })
      }
      return recovered.settled === 'reversed' ? { claimed: true, hostId } : undefined
    }
    // Paid bookings (AGL-170): payment confirms the pendingPayment hold.
    if (
      type === 'checkout.session.completed' &&
      object?.metadata?.type === 'booking-payment' &&
      object?.payment_status === 'paid'
    ) {
      const { hostId, bookingId } = object.metadata ?? {}
      if (hostId && bookingId) {
        const firestore = firebaseAdmin.app().firestore()
        const bookingRef = firestore
          .collection('hosts')
          .doc(String(hostId))
          .collection('bookings')
          .doc(String(bookingId))
        // WHAT THE CLIENT HANDED OVER, ALL OF IT. Tax included: this is the
        // ceiling `refund.ts` reverses against, and the client paid the tax
        // too — a net figure here would strand part of a refund.
        const paidAmountCents = Math.max(
          0,
          Math.round(Number(object?.amount_total ?? 0)),
        )
        // THE MERCHANT'S SERVICE TAX, SEPARATED OUT (AGL-2028).
        //
        // `server.ts` charges the merchant's own service rate as an ordinary
        // `line_items[1]` Stripe is never told is tax (the AGL-1711
        // construction, which is what keeps the figure the MERCHANT's rather
        // than something computed against Aglyn's registrations). So
        // `amount_total` is service-plus-tax while Stripe's own tax fields
        // read zero, and the session's metadata is the only witness — exactly
        // as it is for a buy-now sale.
        const taxCents = Math.max(
          0,
          Math.round(Number(object?.metadata?.taxCents ?? 0)),
        )
        // The merchant's REVENUE, which is the charge less the tax. Used for
        // the contact's lifetime value below: tax is collected on behalf of
        // an authority and is not money the business earned, so counting it
        // would over-state every service client's worth.
        const serviceCents = Math.max(0, paidAmountCents - taxCents)
        // WHAT A REFUND WILL NEED (AGL-2315). A paid booking is now a
        // destination charge to the merchant's connected account, and
        // reversing one requires the PaymentIntent — which lives only on this
        // event. The booking document recorded `paidAmountCents` and nothing
        // that identifies the charge, so a refund had no handle to pull and
        // the information was gone the moment the webhook returned. Unlike
        // most gaps this one cannot be backfilled from our own data later:
        // every booking taken before this line landed can only be refunded by
        // hand in the Stripe dashboard.
        //
        // `feeCents` is Aglyn's cut as CHARGED, read back off the session's
        // own metadata rather than re-derived from the org at refund time. The
        // rate follows the plan (AGL-2289's rule) and the plan moves, so
        // re-resolving it during a refund would reverse a share that was never
        // taken. `'0'` is a real recorded answer on the 0%-rate tiers.
        const paymentIntentId =
          typeof object?.payment_intent === 'string'
            ? object.payment_intent
            : String(object?.payment_intent?.id ?? '')
        const chargedFeeCents = Math.max(
          0,
          Math.round(Number(object?.metadata?.feeCents ?? 0)),
        )
        // Redelivery guard (AGL-1755), the AGL-1748 shape. This was an
        // unconditional merge-set with no status check at all — idempotent
        // only by accident, because every value it wrote was fixed. A
        // redelivery re-sent the guest's confirmation and re-metered it, and
        // the moment this handler carries money to a contact the accident stops
        // holding: `purchaseCents` is a `FieldValue.increment`, so every retry
        // would inflate the customer's lifetime value.
        //
        // Keyed on the STATUS, not on the document existing: `server.ts` writes
        // the booking as `pendingPayment` BEFORE it opens the Stripe session,
        // so existence is guaranteed by the time any event arrives and proves
        // nothing — the AGL-1748 reasoning, not AGL-1732's `checkoutSessionId`
        // key, which existed because a sibling event wrote the same path.
        //
        // The key is "not yet confirmed" rather than "is pendingPayment" on
        // purpose. The lapsed-hold sweeper in `server.ts` cancels a
        // `pendingPayment` booking after 24h, and refusing a payment that
        // landed anyway would take the money and record nothing; `confirmed` is
        // reachable for a PAID booking only by this handler having already run,
        // so it is an exact "already processed" test. The existence check is
        // new and deliberate: the old merge-set would CREATE a stub booking
        // from a metadata `bookingId` that pointed at nothing.
        let booking: Record<string, any> = {}
        const confirmedNow = await firestore.runTransaction(
          async (transaction) => {
            const snapshot = await transaction.get(bookingRef)
            if (!snapshot.exists) return false
            if (snapshot.get('status') === 'confirmed') return false
            // "Already processed" is WIDER than `confirmed` once money can
            // flow back out (AGL-2315). A refunded booking is moved off
            // `confirmed`, so a redelivery arriving afterwards would otherwise
            // read as unprocessed and re-confirm an appointment the merchant
            // has already cancelled and refunded — re-sending the guest a
            // confirmation for it and re-metering the email. Any evidence this
            // handler has run before is the real test, and a refund counter or
            // a recorded PaymentIntent is exactly that evidence.
            if (
              Number(snapshot.get('refundedCents') ?? 0) > 0 ||
              snapshot.get('paymentIntentId')
            ) {
              return false
            }
            booking = (snapshot.data() as any) ?? {}
            transaction.set(
              bookingRef,
              {
                status: 'confirmed',
                paidAmountCents,
                // WHICH TAX REGIME THIS BOOKING CARRIED (AGL-2028), on the
                // document the merchant reads — the stamp every other
                // storefront money door already carries (AGL-2451).
                //
                // DERIVED from the one shared derivation, never a constant.
                // A hand-written "manual when the metadata says so" would be
                // a second rule that can drift from the `storefrontTaxCollected`
                // row filed for the same Stripe id, which is the exact
                // disagreement AGL-2451 exists to prevent.
                //
                // TWO-ARGUMENT, because the manual line makes Stripe report
                // `total_details.amount_tax: 0` on a booking that really did
                // charge the client tax; the one-argument form would stamp
                // `none` on precisely those. `absent` remains a fourth state
                // meaning "recorded before this shipped".
                taxMode: pluginTaxProfile().taxModeOf(object, taxCents),
                // The figure itself. Absent rather than a defaulted `0` — a
                // zero written through `merge` is the AGL-1758 shape, and
                // this handler can re-enter (see the widened guard above).
                ...(taxCents > 0 ? { taxCents } : {}),
                // The refund handles (AGL-2315). Written inside the same
                // transaction as the status, so a booking can never read
                // `confirmed` while the means to refund it are missing.
                ...(paymentIntentId ? { paymentIntentId } : {}),
                feeCents: chargedFeeCents,
                // WHICH CHECKOUT PAID FOR THIS (AGL-2481). The guest's browser
                // comes back from Stripe holding a session id and nothing
                // else — a booking id was never in the return URL — so this is
                // what lets `booking-analytics.ts` answer "what did I just
                // buy?" for the merchant-side `purchase`, and it is written
                // here because the session id first exists on this event.
                //
                // Inside the transaction with the status on purpose: the
                // lookup refuses anything that is not `confirmed`, so a
                // booking can never be findable by session id while reading as
                // unpaid.
                ...(object?.id ? { checkoutSessionId: String(object.id) } : {}),
                // NOTE the absent `refundedCents: 0`. Seeding it here would be
                // the AGL-1758 shape: a defaulted field written through
                // `merge` destroying the real one. This handler can re-enter
                // after a refund has already accumulated a counter (see the
                // widened guard above), and a zero written back over it would
                // re-open the full amount for refunding a second time. Absent
                // IS zero — every reader coerces with `?? 0`.
                expiresAtMs: firebaseAdmin.firestore.FieldValue.delete(),
                confirmedAt:
                  firebaseAdmin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            return true
          },
        )
        if (!confirmedNow) return
        // THE RECORD'S MEETING (AGL-2660). Payment is what confirms a paid
        // booking, so this is where it reaches the CRM: the meeting on the
        // record's timeline and, when the service asks, the follow-up task.
        // Inside the idempotency gate for the same reason the GA4 purchase
        // below is — a redelivery must not file a second meeting — and
        // through `after()` for the same reason too: this invocation is
        // frozen the moment the response is sent (AGL-2327). Never thrown:
        // the writer swallows its own failures, and the catch is for the
        // scheduling itself.
        after(() =>
          fileBookingOnCrm(firestore, {
            hostId: String(hostId),
            bookingId: String(bookingId),
            booking,
          }).catch(() => undefined),
        )
        // AGLYN'S REVENUE ON THIS BOOKING (AGL-2481) — into OUR GA4 property.
        //
        // ## Why it is inside the idempotency gate rather than beside it
        //
        // This sits AFTER `if (!confirmedNow) return` and that placement is the
        // whole guard. Stripe redelivers `checkout.session.completed` for up to
        // three days after any 500, and this endpoint 500s on purpose; a
        // redelivery re-enters this handler, the transaction above sees a
        // `confirmed` status (or a refund counter, or a recorded PaymentIntent)
        // and answers false, and everything below — the contact, the email, and
        // now this — is skipped. A `purchase` fired before that gate, or beside
        // it, would inflate our own reported revenue by the redelivery rate.
        //
        // `transaction_id` is the checkout session id, which is the same key
        // the guard turns on, so GA4's own de-duplication is a second
        // independent line of defence: even if the Firestore guard were ever
        // bypassed, GA would collapse the repeats.
        //
        // ## Platform NET, and the fee is the measured one
        //
        // `value` is our fee and not the $95 the guest paid — the AGL-1639
        // settlement. This is our property, the subscription and marketplace
        // `purchase` events in it already mean "what Aglyn was paid", and a
        // gross booking figure sitting beside them would make every combined
        // total, ARPA and revenue audience wrong. The merchant's own gross goes
        // to the MERCHANT's property, client-side, and the two never meet.
        //
        // The figure comes off the session's `metadata.feeCents` — the fee
        // Stripe actually charged as `application_fee_amount` — never from the
        // plan's rate re-applied here. See `bookingPlatformNetCents`.
        //
        // ## Scheduling and failure posture
        //
        // `after()`, never a bare `void` (AGL-2327/AGL-2346): this runs inside
        // the console's `/api/billing/webhook` invocation, which is frozen the
        // moment the response is sent, so fire-and-forget work scheduled any
        // other way simply does not run — the exact way marketplace revenue
        // reported to nothing. And `.catch()`, because a throw here would
        // un-claim the Stripe event and turn a missed analytics hit into a
        // repeated billing side effect.
        if (shouldSendBookingPlatformPurchase(object)) {
          const netCents = bookingPlatformNetCents(object)
          after(() =>
            sendGa4Purchase({
              transactionId: String(object?.id ?? ''),
              value: netCents / 100,
              currency: String(object?.currency ?? 'usd'),
              items: [
                {
                  // Ids only, no merchant free text. A service name is
                  // merchant-authored and one edit away from carrying a
                  // person's name into a dimension in OUR property; the id
                  // already identifies it. The merchant's own property gets
                  // the name, because there it is their own content.
                  item_id: String(booking['serviceId'] ?? bookingId),
                  item_name: String(booking['serviceId'] ?? bookingId),
                  item_category: 'booking',
                  // GA expects the items to sum to `value`; one item, one
                  // price, and that price is our fee — not the service's.
                  price: netCents / 100,
                  quantity: 1,
                },
              ],
              // Booking sessions carry no `ga_client_id` today — nothing
              // captures one on a tenant site — so this is read for the day
              // one is stamped and the seed below is what actually resolves.
              clientId: object?.metadata?.ga_client_id,
              // ONE PAYING GUEST, ONE SYNTHETIC USER. Seeded from Stripe's
              // customer where there is one, and otherwise from the guest's
              // email, which `server.ts` passes as `customer_email` and Stripe
              // echoes on `customer_details`. The seed is hashed inside
              // `synthesizeClientId` and never transmitted.
              //
              // The booking id is the LAST resort deliberately: it is unique
              // per appointment, so seeding from it would turn a regular
              // client into a crowd of one-purchase strangers and make ARPA
              // nonsense — precisely what that helper's determinism exists to
              // prevent. Without any seed at all `sendGa4Purchase` returns
              // `no-client-id` and the event is silently never sent, which is
              // the void this whole change exists to close.
              stripeCustomerId:
                String(object?.customer ?? '') ||
                String(object?.customer_details?.email ?? '') ||
                String(bookingId),
            }).catch(() => undefined),
          )
        }
        // Contacts ingestion (AGL-1755). `server.ts` captures the contact at
        // REQUEST time, which is the right place — the booking is written
        // `pendingPayment` and at that moment no money has moved, so passing an
        // amount there would be a lie. But payment completes HERE, and this
        // handler never returned to the contact, so a paid booking's money
        // reached the booking document and nothing else. The same structural
        // shape as AGL-1748's draft branch: the completion handler does
        // everything except the contact.
        //
        // `source` stays `'booking'` — the same source the request-time capture
        // used — so the `sources` map still says where this person came from
        // and no schema change is needed to keep service revenue
        // distinguishable from product revenue. The second interaction is
        // deliberate rather than a duplicate: "Booked X" and "Paid for X" are
        // two real events, and `mergeContactInteraction` does not dedupe on
        // `refId`.
        //
        // The amount is `amount_total`, the money that moved, per AGL-1698 and
        // AGL-1711 — the booking document stores no price to re-derive it from.
        if (booking['email']) {
          void captureHostContact({
            hostId: String(hostId),
            email: booking['email'],
            ...(booking['name'] ? { name: String(booking['name']) } : {}),
            source: 'booking',
            // Paid, so a customer (AGL-2612) — the request-time capture
            // said `lead`, and this is the door that has seen the money.
            initialLifecycleStage: 'customer',
            // The SERVICE, not the charge (AGL-2028). `amount_total` now
            // includes the merchant's service tax where they set one, and
            // tax is collected for an authority rather than earned — booking
            // it as lifetime value would over-state what every service
            // client is worth. Identical to `paidAmountCents` on the default
            // store, which sets no rate.
            ...(serviceCents > 0 ? { purchaseCents: serviceCents } : {}),
            interaction: {
              refId: String(bookingId),
              summary: `Paid for "${String(
                booking['serviceName'] ?? 'a service',
              ).slice(0, 60)}" ($${(serviceCents / 100).toFixed(2)})`,
            },
          })
        }
        // Confirmation email now that payment cleared (env-gated inside
        // sendEmail, which no-ops when Resend isn't configured).
        if (booking['email']) {
          // In the booking's own zone, and named (AGL-3432): a formatter with
          // no zone reads in the server's — UTC — and tells a paying guest the
          // wrong hour, and an empty zone prints "()".
          const timezone = await bookingTimeZoneFor(
            firestore,
            String(hostId),
            booking,
          )
          const when = formatBookingWhen(Number(booking['startsAtMs']), timezone)
          const paid = `$${(paidAmountCents / 100).toFixed(2)}`
          const fallbackText =
            `Hi ${booking['name'] ?? ''},\n\nPayment received — ` +
            `"${booking['serviceName'] ?? 'your booking'}" is ` +
            `confirmed for ${when} (${timezone}). You paid ${paid}.` +
            `\n\nReference: ${bookingId}`
          // Site-owner-designed template when published (AGL-770); null keeps
          // the built-in copy.
          const designed = await renderHostEmailWithTokens(
            firebaseAdmin.app().firestore(),
            String(hostId),
            'booking-confirmed',
            {
              name: String(booking['name'] ?? ''),
              'service.name': String(booking['serviceName'] ?? ''),
              when,
              timezone,
              'booking.payment': `You paid ${paid}.`,
              'booking.ref': String(bookingId),
            },
          )
          // White-label sender identity (White-Label Phase 3), matching the
          // free-booking path — the store's brand via the one shared resolver.
          const branding = resolveBrandingProfile(
            (await getOrgForHost(String(hostId)).catch(() => null))?.org as never,
          )
          await sendEmail({
            to: String(booking['email']),
            subject:
              designed?.subject ??
              `Booking confirmed: ${booking['serviceName'] ?? ''}`,
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            fromName: branding.fromName,
            sendingIdentity: await hostSendingIdentity(String(hostId)),
            audience: 'tenant',
            context: 'paid booking confirmation',
            // Owed to the recipient by their own booking: the phishing
            // screen's soft rules never hold it (AGL-3356).
            owedFor: 'booking',
          })
          // Cost meter (AGL-1438), matching the free-booking path.
          // Transactional: the guest has already paid.
          await meterHostEmail(String(hostId))
        }
      }
    }
}
