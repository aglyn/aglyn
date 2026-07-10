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

import {
  type BookedInterval,
  checkEntitlement,
  type HostBookingService,
  isSlotOpen,
} from '@aglyn/aglyn'
import {
  firebaseAdmin,
  getOrgForHost,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'
import { emitHostEvent } from '../../../utils/emit-host-event'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Best-effort per-instance rate limit (mirrors forms/submit).
const recentByIp = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 5

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  )
  hits.push(now)
  recentByIp.set(ip, hits)
  return hits.length > RATE_MAX
}

/**
 * Booking creation (AGL-159): validates the slot against the service's
 * windows AND stored bookings inside a transaction (double-booking safe),
 * stores the booking, records a lead, emits the `booking` host event, and
 * sends an env-gated Resend confirmation. Plan gate: the owning tenant
 * needs the `bookings` flag (dark-launch tenants pass).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const serviceId = String(req.body?.serviceId ?? '')
  const startsAtMs = Number(req.body?.startsAtMs ?? 0)
  const name = String(req.body?.name ?? '')
    .trim()
    .slice(0, 80)
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  if (!hostId || !serviceId || !Number.isFinite(startsAtMs) || !startsAtMs) {
    return res.status(400).json({ error: 'Invalid booking request' })
  }
  if (!name) return res.status(400).json({ error: 'Enter your name' })
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  if (startsAtMs < Date.now()) {
    return res.status(409).json({ error: 'That time has already passed' })
  }
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown',
  ).split(',')[0]
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many booking attempts' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, serviceSnapshot] = await Promise.all([
      hostRef.get(),
      hostRef.collection('services').doc(serviceId).get(),
    ])
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const service = serviceSnapshot.data() as HostBookingService | undefined
    if (!service || (serviceSnapshot.get('deletedAt') as unknown)) {
      return res.status(404).json({ error: 'Unknown service' })
    }

    // Plan gate (dark-launch rule preserved).
    {
      // Plan/quota gates ride the owning org's doc (AGL-238).
      const tenant = (await getOrgForHost(hostId))?.org
      if (tenant?.['plan'] && !checkEntitlement(tenant as any, 'bookings')) {
        return res
          .status(403)
          .json({ error: 'Bookings are not enabled on this site' })
      }
    }

    const durationMs =
      Math.max(5, Math.round(service.durationMinutes || 30)) * 60_000
    const endsAtMs = startsAtMs + durationMs
    const bookingsRef = hostRef.collection('bookings')

    // Paid services (AGL-170): the slot is HELD pending payment — the
    // booking lands as `pendingPayment` with a 15-minute expiry (expired
    // holds release the slot in the collision filters), and the visitor
    // goes to Stripe Checkout; the webhook confirms + emails on payment.
    const priceUsd = Number(service.priceUsd ?? 0)
    const paid = priceUsd > 0
    if (paid && !process.env.STRIPE_SECRET_KEY) {
      return res.status(501).json({
        error: 'Paid bookings are not configured (STRIPE_SECRET_KEY).',
      })
    }

    // Transaction: re-read overlapping bookings and validate the slot so
    // two simultaneous requests cannot double-book.
    const bookingId = await firestore.runTransaction(async (transaction) => {
      const overlapping = await transaction.get(
        bookingsRef
          .where('serviceId', '==', serviceId)
          .where('startsAtMs', '>=', startsAtMs - 24 * 60 * 60_000)
          .limit(500),
      )
      const booked: BookedInterval[] = overlapping.docs
        .filter(
        (doc) =>
          doc.get('status') !== 'canceled' &&
          // Expired payment holds release the slot (AGL-170).
          !(
            doc.get('status') === 'pendingPayment' &&
            Number(doc.get('expiresAtMs') ?? 0) < Date.now()
          ),
      )
        .map((doc) => ({
          startsAtMs: Number(doc.get('startsAtMs') ?? 0),
          endsAtMs: Number(doc.get('endsAtMs') ?? 0),
        }))
      if (!isSlotOpen(service, startsAtMs, booked)) {
        throw Object.assign(new Error('Slot unavailable'), { code: 409 })
      }
      const bookingRef = bookingsRef.doc()
      transaction.set(bookingRef, {
        serviceId,
        serviceName: service.name ?? '',
        name,
        email,
        startsAtMs,
        endsAtMs,
        status: paid ? 'pendingPayment' : 'confirmed',
        ...(paid && { expiresAtMs: Date.now() + 15 * 60_000 }),
        createdAt: FieldValue.serverTimestamp(),
      })
      return bookingRef.id
    })

    // Contacts ingestion (AGL-197) — booking requests identify a person.
    void upsertHostContact({
      hostId,
      email,
      name: name || undefined,
      source: 'booking',
      interaction: {
        refId: bookingId,
        summary: `Booked "${String(service.name ?? 'a service').slice(0, 60)}"`,
      },
    })

    if (paid) {
      const origin = req.headers.origin ?? `https://${req.headers.host}`
      const params = new URLSearchParams({
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(
          Math.round(priceUsd * 100),
        ),
        'line_items[0][price_data][product_data][name]': String(
          service.name ?? 'Booking',
        ).slice(0, 120),
        success_url: `${origin}/?booking=paid`,
        cancel_url: `${origin}/?booking=canceled`,
        customer_email: email,
        'metadata[type]': 'booking-payment',
        'metadata[hostId]': hostId,
        'metadata[bookingId]': bookingId,
        expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
      })
      const stripeResponse = await fetch(
        'https://api.stripe.com/v1/checkout/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        },
      )
      const session = (await stripeResponse.json()) as {
        url?: string
        error?: any
      }
      if (!stripeResponse.ok || !session.url) {
        console.error('Stripe booking checkout error', session.error)
        // Release the hold so the slot isn't stuck for 15 minutes.
        await bookingsRef
          .doc(bookingId)
          .set({ status: 'canceled' }, { merge: true })
          .catch(() => undefined)
        return res.status(502).json({ error: 'Payment setup failed' })
      }
      // Lead lands now; the confirmation email + workflow event fire from
      // the payment webhook.
      await hostRef
        .collection('leads')
        .add({
          email,
          source: 'booking',
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
      return res
        .status(200)
        .json({ bookingId, startsAtMs, endsAtMs, checkoutUrl: session.url })
    }

    // Bookings double as leads for the site owner (mirrors sign-ups).
    await hostRef
      .collection('leads')
      .add({
        email,
        source: 'booking',
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    // Event trigger (AGL-128/148/159).
    const { alerts } = await emitHostEvent(hostId, 'booking', {
      serviceName: service.name ?? '',
      email,
      startsAtMs,
    })

    // Env-gated confirmation email (same provider as AGL-98).
    const resendKey = process.env.RESEND_API_KEY
    const emailFrom = process.env.USAGE_EMAIL_FROM
    if (resendKey && emailFrom) {
      const timezone = service.timezone || 'UTC'
      const when = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(startsAtMs))
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
          subject: `Booking confirmed: ${service.name}`,
          text:
            `Hi ${name},\n\nYour booking for "${service.name}" is ` +
            `confirmed for ${when} (${timezone}).\n\n` +
            `Reference: ${bookingId}`,
        }),
      }).catch((error) => console.error('booking email failed', error))
    }

    return res.status(200).json({ bookingId, startsAtMs, endsAtMs, alerts })
  } catch (error: any) {
    if (error?.code === 409) {
      return res
        .status(409)
        .json({ error: 'That time was just taken — pick another slot' })
    }
    console.error(error)
    return res.status(500).json({ error: 'Booking failed' })
  }
}
