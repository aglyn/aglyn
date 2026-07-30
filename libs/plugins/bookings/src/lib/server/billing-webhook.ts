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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { renderHostEmail, sendEmail } from '@aglyn/shared-util-email'

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
        const bookingRef = firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(String(hostId))
          .collection('bookings')
          .doc(String(bookingId))
        await bookingRef.set(
          {
            status: 'confirmed',
            paidAmountCents: Number(object?.amount_total ?? 0),
            expiresAtMs: firebaseAdmin.firestore.FieldValue.delete(),
            confirmedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        // Confirmation email now that payment cleared (env-gated inside
        // sendEmail, which no-ops when Resend isn't configured).
        const booking = (await bookingRef.get()).data() ?? {}
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
          const designed = await renderHostEmail(
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
        }
      }
    }
}
