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
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  meterHostEmail,
  renderHostEmailWithTokens,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { sendEmail } from '@aglyn/shared-util-email'
import { storefrontTaxModeOf } from '@aglyn/plugins-commerce/server/storefront-tax'

/**
 * Paid-booking section of the platform Stripe webhook (AGL-170/418):
 * payment confirms the pendingPayment hold — relocated verbatim from the
 * console route; registered via registerBookingsConsoleApi.
 */
export const bookingsBillingWebhookHandler: BillingWebhookHandler = async ({
  type,
  object,
}) => {
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
                taxMode: storefrontTaxModeOf(object, taxCents),
                // The figure itself. Absent rather than a defaulted `0` — a
                // zero written through `merge` is the AGL-1758 shape, and
                // this handler can re-enter (see the widened guard above).
                ...(taxCents > 0 ? { taxCents } : {}),
                // The refund handles (AGL-2315). Written inside the same
                // transaction as the status, so a booking can never read
                // `confirmed` while the means to refund it are missing.
                ...(paymentIntentId ? { paymentIntentId } : {}),
                feeCents: chargedFeeCents,
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
          void upsertHostContact({
            hostId: String(hostId),
            email: booking['email'],
            ...(booking['name'] ? { name: String(booking['name']) } : {}),
            source: 'booking',
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
          const when = new Date(
            Number(booking['startsAtMs']),
          ).toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
          })
          const fallbackText =
            `Hi ${booking['name'] ?? ''},\n\nPayment received — ` +
            `"${booking['serviceName'] ?? 'your booking'}" is ` +
            `confirmed for ${when}.\n\nReference: ${bookingId}`
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
              timezone: String(booking['timezone'] ?? ''),
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
            context: 'paid booking confirmation',
          })
          // Cost meter (AGL-1438), matching the free-booking path.
          // Transactional: the guest has already paid.
          await meterHostEmail(String(hostId))
        }
      }
    }
}
