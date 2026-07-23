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
          await sendEmail({
            to: String(booking['email']),
            subject: `Booking confirmed: ${booking['serviceName'] ?? ''}`,
            text:
              `Hi ${booking['name'] ?? ''},\n\nPayment received — ` +
              `"${booking['serviceName'] ?? 'your booking'}" is ` +
              `confirmed for ${when}.\n\nReference: ${bookingId}`,
            context: 'paid booking confirmation',
          })
        }
      }
    }
}
