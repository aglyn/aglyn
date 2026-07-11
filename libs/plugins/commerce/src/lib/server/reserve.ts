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

import type { PluginApiHandler } from '@aglyn/aglyn'
import * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'

/**
 * Reserve a stay (AGL-310): server-side quote + availability check,
 * pending reservation doc, then a Stripe session for the deposit (or
 * full amount) on the merchant's account. Webhook completion confirms
 * the reservation; abandoned pending holds expire after 30 minutes and
 * stop blocking the calendar.
 */
export const reserveHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ error: 'Payments are not configured.' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const resourceId = String(body.resourceId ?? '')
  const checkInDayMs = Aglyn.toDayMs(Number(body.checkInDayMs ?? 0))
  const checkOutDayMs = Aglyn.toDayMs(Number(body.checkOutDayMs ?? 0))
  const guestName = String(body.guestName ?? '').trim().slice(0, 120)
  const guestEmail = String(body.guestEmail ?? '').trim().toLowerCase().slice(0, 120)
  if (!hostId || !resourceId || !checkInDayMs || !checkOutDayMs) {
    return res.status(400).json({ error: 'Missing reservation details' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [resourceSnapshot, reservationsSnapshot] = await Promise.all([
      hostRef.collection('resources').doc(resourceId).get(),
      hostRef
        .collection('reservations')
        .where('resourceId', '==', resourceId)
        .limit(500)
        .get(),
    ])
    const resource = resourceSnapshot.data() as Aglyn.HostResource | undefined
    if (!resource) return res.status(404).json({ error: 'Unknown resource' })

    // Pending holds block for 30 minutes only, so abandoned checkouts
    // release the dates.
    const now = Date.now()
    const live = reservationsSnapshot.docs
      .map((docSnapshot) => ({
        checkInDayMs: Number(docSnapshot.get('checkInDayMs')),
        checkOutDayMs: Number(docSnapshot.get('checkOutDayMs')),
        status: String(docSnapshot.get('status')) as Aglyn.ReservationStatus,
        createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
      }))
      .filter(
        (reservation) =>
          reservation.status !== 'pending' ||
          now - reservation.createdAtMs < 30 * 60 * 1000,
      )
    if (
      !Aglyn.isRangeAvailable(resource, live, checkInDayMs, checkOutDayMs)
    ) {
      return res.status(409).json({ error: 'Those dates just sold out' })
    }
    const quote = Aglyn.computeReservationQuote(
      resource,
      checkInDayMs,
      checkOutDayMs,
    )
    if (quote.problem) return res.status(400).json({ error: quote.problem })

    const ownerOrg = await getOrgForHost(hostId)
    const ownerId = ownerOrg?.org?.ownerUid
    const ownerProfile = ownerId
      ? await firestore.collection('profiles').doc(String(ownerId)).get()
      : null
    const accountId = ownerProfile?.get('stripeAccountId')
    if (!accountId || !ownerProfile?.get('stripeChargesEnabled')) {
      return res.status(409).json({ error: 'Payments are not set up yet' })
    }
    const feePct = Aglyn.resolveTransactionFeePct(
      ownerOrg?.org as any,
      'service',
    )
    const chargeCents = quote.depositCents || quote.totalCents
    const feeCents =
      feePct > 0 ? Math.max(1, Math.round((chargeCents * feePct) / 100)) : 0

    const reservationRef = hostRef.collection('reservations').doc()
    await reservationRef.set({
      resourceId,
      status: 'pending',
      checkInDayMs,
      checkOutDayMs,
      guestName: guestName || null,
      guestEmail: guestEmail || null,
      nights: quote.nights,
      totalCents: quote.totalCents,
      depositCents: quote.depositCents,
      paidCents: 0,
      createdAtMs: now,
    } satisfies Aglyn.HostReservation)

    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const backUrl = referer.startsWith('http') ? referer : origin
    const separator = backUrl.includes('?') ? '&' : '?'
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(chargeCents),
      'line_items[0][price_data][product_data][name]': `${resource.name} — ${
        quote.nights
      } night${quote.nights === 1 ? '' : 's'}${
        quote.depositCents && quote.depositCents < quote.totalCents
          ? ' (deposit)'
          : ''
      }`.slice(0, 120),
      ...(feeCents > 0
        ? { 'payment_intent_data[application_fee_amount]': String(feeCents) }
        : {}),
      'payment_intent_data[transfer_data][destination]': String(accountId),
      ...(guestEmail ? { customer_email: guestEmail } : {}),
      success_url: `${backUrl}${separator}reserved=1`,
      cancel_url: `${backUrl}${separator}reserved=0`,
      'metadata[type]': 'commerce-reservation',
      'metadata[hostId]': hostId,
      'metadata[reservationId]': reservationRef.id,
      'metadata[feeCents]': String(feeCents),
    })
    const response = await fetch(
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
    const session = (await response.json()) as { url?: string; error?: any }
    if (!response.ok || !session.url) {
      console.error('Stripe reservation error', session.error)
      await reservationRef.delete().catch(() => undefined)
      return res.status(502).json({ error: 'Payment setup failed' })
    }
    return res.status(200).json({ url: session.url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reservation failed' })
  }
}
