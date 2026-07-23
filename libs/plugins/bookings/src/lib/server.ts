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

import { checkEntitlement,
  registerPluginConfigSchema,
  registerPluginJob,
} from '@aglyn/aglyn/server'
import { type BookedInterval, BOOKING_MAX_DAYS_AHEAD, computeOpenSlots, type HostBookingService, isSlotOpen } from './model'
import {
  registerBillingWebhookHandler,
  registerPluginApiRoute,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { BUNDLE_ID } from './constants/bundle-common'
import { BOOKINGS_CONFIG_SCHEMA } from './plugin-config'
import { bookingsBillingWebhookHandler } from './server/billing-webhook'

// Settings schema (AGL-428): registered here too so server-only loads
// (API dispatchers) get defaults-merged getPluginConfig reads.
registerPluginConfigSchema(BOOKINGS_CONFIG_SCHEMA)

// Scheduled cleanup (AGL-435): lapse day-old expired payment holds to
// 'canceled' (the read paths already treat them as released — this keeps
// the collection tidy and the read-time filter cheap). Bounded + failure
// tolerant: a missing collection-group index just logs and retries on
// the next beat.
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'expire-stale-holds',
  intervalMinutes: 6 * 60,
  description: 'Cancel pendingPayment bookings whose hold lapsed >24h ago.',
  handler: async () => {
    const cutoff = Date.now() - 24 * 60 * 60_000
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collectionGroup('bookings')
      .where('status', '==', 'pendingPayment')
      .where('expiresAtMs', '<', cutoff)
      .limit(100)
      .get()
    for (const doc of snapshot.docs) {
      await doc.ref.set({ status: 'canceled' }, { merge: true })
    }
    if (snapshot.size) {
      console.info(`bookings: lapsed ${snapshot.size} stale payment holds`)
    }
  },
})
import {
  firebaseAdmin,
  getOrgForHost,
  notifyHostManagers,
  upsertHostContact,
  getPluginConfig,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'

const BOOKING_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Best-effort per-instance rate limit (mirrors forms/submit).
const recentBookingIpHits = new Map<string, number[]>()
const BOOKING_RATE_WINDOW_MS = 60_000
const BOOKING_RATE_MAX = 5

function bookingRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentBookingIpHits.get(ip) ?? []).filter(
    (t) => now - t < BOOKING_RATE_WINDOW_MS,
  )
  hits.push(now)
  recentBookingIpHits.set(ip, hits)
  return hits.length > BOOKING_RATE_MAX
}

/**
 * Public open-slot listing (AGL-159): visitors browse a service's next
 * open times. Server-side because bookings (names/emails) must never be
 * client-readable — only the derived busy intervals are used here.
 */
const slotsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  const serviceId = String(req.query['serviceId'] ?? '')
  if (!hostId) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)

    // No serviceId → public service directory for the booking widget
    // (AGL-160): names/durations/prices only, never availability internals.
    if (!serviceId) {
      const services = await hostRef.collection('services').limit(50).get()
      return res.status(200).json({
        services: services.docs
          .filter((doc) => !doc.get('deletedAt'))
          .map((doc) => ({
            $id: doc.id,
            name: doc.get('name') ?? '',
            durationMinutes: Number(doc.get('durationMinutes') ?? 30),
            priceUsd: Number(doc.get('priceUsd') ?? 0),
            description: doc.get('description') ?? '',
          })),
      })
    }
    const serviceSnapshot = await hostRef
      .collection('services')
      .doc(serviceId)
      .get()
    const service = serviceSnapshot.data() as HostBookingService | undefined
    if (!service || (serviceSnapshot.get('deletedAt') as unknown)) {
      return res.status(404).json({ error: 'Unknown service' })
    }
    const fromMs = Date.now()
    // Booking horizon (AGL-428): org-configurable via the plugin settings
    // framework; defaults to BOOKING_MAX_DAYS_AHEAD through the schema.
    const config = await getPluginConfig(
      await resolveOrgIdForHost(hostId),
      'bookings',
    )
    const maxDaysAhead = Number(config.maxDaysAhead ?? BOOKING_MAX_DAYS_AHEAD)
    const toMs = fromMs + maxDaysAhead * 24 * 60 * 60_000
    const bookedSnapshot = await hostRef
      .collection('bookings')
      .where('serviceId', '==', serviceId)
      .where('startsAtMs', '>=', fromMs - 24 * 60 * 60_000)
      .limit(500)
      .get()
    const booked: BookedInterval[] = bookedSnapshot.docs
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
    const slots = computeOpenSlots(service, fromMs, toMs, booked, 120)
    return res.status(200).json({
      service: {
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceUsd: service.priceUsd ?? 0,
        timezone: service.timezone ?? 'UTC',
      },
      slots,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Slot lookup failed' })
  }
}

/**
 * Booking creation (AGL-159): validates the slot against the service's
 * windows AND stored bookings inside a transaction (double-booking safe),
 * stores the booking, records a lead, emits the `booking` host event, and
 * sends an env-gated Resend confirmation. Plan gate: the owning org
 * needs the `bookings` flag (dark-launch workspaces pass).
 */
const bookHandler: PluginApiHandler = async (req, res) => {
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
  if (!BOOKING_EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  if (startsAtMs < Date.now()) {
    return res.status(409).json({ error: 'That time has already passed' })
  }
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown',
  ).split(',')[0]
  if (bookingRateLimited(ip)) {
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
      const org = (await getOrgForHost(hostId))?.org
      if (!checkEntitlement(org as never, 'bookings')) {
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
        error?: unknown
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
    // In-app notification to the site's managers (AGL-259).
    void notifyHostManagers(hostId, {
      type: 'content.booking',
      title: 'New booking',
      body: new Date(startsAtMs).toLocaleString(),
      link: `/${hostId}/bookings`,
    })
    const { alerts } = await emitHostEvent(hostId, 'booking', {
      serviceName: service.name ?? '',
      email,
      startsAtMs,
    })

    // Env-gated confirmation email (same provider as AGL-98).
    if (isEmailConfigured()) {
      const timezone = service.timezone || 'UTC'
      const when = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(startsAtMs))
      await sendEmail({
        to: email,
        subject: `Booking confirmed: ${service.name}`,
        text:
          `Hi ${name},\n\nYour booking for "${service.name}" is ` +
          `confirmed for ${when} (${timezone}).\n\n` +
          `Reference: ${bookingId}`,
        context: 'booking confirmation',
      })
    }

    return res.status(200).json({ bookingId, startsAtMs, endsAtMs, alerts })
  } catch (error: unknown) {
    if ((error as { code?: number })?.code === 409) {
      return res
        .status(409)
        .json({ error: 'That time was just taken — pick another slot' })
    }
    console.error(error)
    return res.status(500).json({ error: 'Booking failed' })
  }
}

/**
 * Booking reminder emails (AGL-160): invoke hourly from the scheduler with
 * `x-cron-secret`. Finds confirmed bookings starting 23–25 hours out
 * (collection-group query, so one call covers every host), emails each
 * visitor through the env-gated Resend path, and stamps `reminderSentAt`
 * so re-runs are idempotent. 501 without the email config, matching
 * report-usage/usage-email.
 */
const remindersHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res
      .status(501)
      .json({ error: 'Reminders are not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  if (!isEmailConfigured()) {
    return res.status(501).json({
      error: 'Reminders are not configured (RESEND_API_KEY, USAGE_EMAIL_FROM).',
    })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const windowStart = Date.now() + 23 * 60 * 60 * 1000
    const windowEnd = Date.now() + 25 * 60 * 60 * 1000
    const upcoming = await firestore
      .collectionGroup('bookings')
      .where('startsAtMs', '>=', windowStart)
      .where('startsAtMs', '<=', windowEnd)
      .limit(500)
      .get()

    let sent = 0
    let skipped = 0
    for (const doc of upcoming.docs) {
      const data = doc.data()
      if (
        data['status'] === 'canceled' ||
        data['reminderSentAt'] ||
        !data['email']
      ) {
        skipped += 1
        continue
      }
      const when = new Date(Number(data['startsAtMs'])).toLocaleString(
        'en-US',
        { dateStyle: 'full', timeStyle: 'short' },
      )
      const result = await sendEmail({
        to: String(data['email']),
        subject: `Reminder: ${data['serviceName'] ?? 'your booking'} tomorrow`,
        text:
          `Hi ${data['name'] ?? ''},\n\nA reminder that "${
            data['serviceName'] ?? 'your booking'
          }" is scheduled for ${when}.\n\nReference: ${doc.id}`,
        context: 'booking reminder',
      })
      if (result.sent) {
        sent += 1
        await doc.ref
          .set(
            {
              reminderSentAt:
                firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => undefined)
      }
    }
    return res.status(200).json({ scanned: upcoming.size, sent, skipped })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reminders failed' })
  }
}

/** Registers the bookings plugin's public (site-facing) API routes (AGL-396). */
export function registerBookingsApi(): void {
  registerPluginApiRoute('bookings/slots', slotsHandler)
  registerPluginApiRoute('bookings/book', bookHandler)
}

/** Registers the bookings plugin's console-side API routes (AGL-396). */
export function registerBookingsConsoleApi(): void {
  registerPluginApiRoute('bookings/reminders', remindersHandler)
  // Paid-booking confirmation rides the platform Stripe webhook (AGL-418).
  registerBillingWebhookHandler(bookingsBillingWebhookHandler)
}
