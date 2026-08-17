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
        const paidAmountCents = Math.max(
          0,
          Math.round(Number(object?.amount_total ?? 0)),
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
            booking = (snapshot.data() as any) ?? {}
            transaction.set(
              bookingRef,
              {
                status: 'confirmed',
                paidAmountCents,
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
            ...(paidAmountCents > 0 ? { purchaseCents: paidAmountCents } : {}),
            interaction: {
              refId: String(bookingId),
              summary: `Paid for "${String(
                booking['serviceName'] ?? 'a service',
              ).slice(0, 60)}" ($${(paidAmountCents / 100).toFixed(2)})`,
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
