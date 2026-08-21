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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { toBookingPurchaseSource } from '../model/booking-purchase-analytics'

/** Stripe Checkout Session ids: `cs_` + live/test prefix + base58-ish body. */
const SESSION_ID = /^cs_[A-Za-z0-9_]{8,255}$/

/**
 * The figures a merchant-side booking `purchase` needs, for one paid booking
 * (AGL-2481). The bookings mirror of `order-analytics.ts`, and deliberately
 * the same shape so the two revenue lines stay comparable.
 *
 * ## Why the client cannot compute this itself
 *
 * The guest's browser knows what the widget quoted, which is not what Stripe
 * charged: the merchant's service tax is added as a second line at session
 * creation, and the authoritative `amount_total` only exists once the webhook
 * has written it. Replaying the quoted price would understate every taxed
 * booking and would drift from the charge the moment a service price is
 * edited between session creation and webhook delivery.
 *
 * ## What authorises the read
 *
 * The Stripe Checkout Session id, which the webhook stamps on the booking as
 * `checkoutSessionId`. It is high-entropy and unguessable, Stripe hands it
 * only to the guest who paid — in the `success_url` — and it is scoped here to
 * the host that owns the booking, so one site's id cannot address another's.
 * The same bearer-by-opaque-id shape as `order-analytics`, `download` and
 * `subscription-portal`.
 *
 * It is still a public read, so the response is a PROJECTION built by
 * `toBookingPurchaseSource`, never the booking document: no guest email, no
 * name, no appointment time, and not our `feeCents` either — a guest has no
 * business learning Aglyn's take rate on their hairdresser. A booking document
 * is considerably more sensitive than an order: it says where somebody will
 * physically be and when.
 *
 * ## The webhook race
 *
 * The guest can return from Stripe before `checkout.session.completed` has
 * been processed, in which case no booking carries this session id yet. That
 * is answered with 404 and `retryable` rather than a synthesised booking — the
 * client polls briefly. Reporting a purchase we cannot yet read would mean
 * inventing the value.
 *
 * Never cached: a 404 during the race must not be stored in front of this, the
 * negative-cache shape that has bitten host lookups before.
 *
 * ## Only a CONFIRMED booking is a purchase
 *
 * `checkoutSessionId` is written inside the same transaction as
 * `status: 'confirmed'`, so in practice a findable booking is a paid one. The
 * status is re-checked anyway rather than trusted: a booking that has since
 * been refunded is moved OFF `confirmed`, and re-reporting one as revenue on a
 * guest's stray refresh would put a sale in the merchant's report that has
 * been reversed.
 */
export const bookingAnalyticsHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const sessionId = String(req.query.sessionId ?? '')
  if (!hostId || !sessionId) {
    return res.status(400).json({ error: 'Missing hostId or sessionId' })
  }
  // Shape-checked before it reaches Firestore: an unvalidated identifier in a
  // query is how a lookup becomes something else.
  if (!SESSION_ID.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' })
  }
  try {
    const bookings = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('bookings')
      // A single-field equality query, which Firestore serves from the
      // automatic per-field indexes — no composite index to create here.
      .where('checkoutSessionId', '==', sessionId)
      .limit(1)
      .get()

    res.setHeader('Cache-Control', 'no-store')

    const booking = bookings.docs?.[0]
    if (!booking) {
      // The race, or an id that was never ours. Both are retryable from the
      // client's point of view; it gives up after a bounded number of tries.
      return res.status(404).json({ error: 'Not found', retryable: true })
    }
    const data = (booking.data() ?? {}) as Record<string, any>
    if (data['status'] !== 'confirmed') {
      return res.status(409).json({ error: 'Not payable' })
    }
    return res.status(200).json(toBookingPurchaseSource(sessionId, data))
  } catch {
    // Never leak the underlying error to a public caller.
    return res.status(500).json({ error: 'Lookup failed' })
  }
}
