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

import type { AttemptClaim, PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { claimAttempt } from '@aglyn/aglyn/server'
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
  const checkInDayMs = CommerceModel.toDayMs(Number(body.checkInDayMs ?? 0))
  const checkOutDayMs = CommerceModel.toDayMs(Number(body.checkOutDayMs ?? 0))
  const guestName = String(body.guestName ?? '').trim().slice(0, 120)
  const guestEmail = String(body.guestEmail ?? '').trim().toLowerCase().slice(0, 120)
  // One reservation attempt, minted by the widget (AGL-1697). Node lowercases
  // incoming headers, but read both spellings — the plugin API request type
  // makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)
  if (!hostId || !resourceId || !checkInDayMs || !checkOutDayMs) {
    return res.status(400).json({ error: 'Missing reservation details' })
  }

  let claim: AttemptClaim | null = null
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    // Owner + payment readiness, HOISTED above the claim (AGL-1697): both are
    // deterministic refusals a merchant fixes out of band, and neither should
    // burn the guest's attempt key.
    const ownerOrg = await getOrgForHost(hostId)
    // Plan gate, re-asked per request exactly as the storefront checkout
    // asks it (AGL-1873, the AGL-481 pattern): a lapsed org's storefront
    // must not keep taking reservation deposits — at the free plan's 0%
    // transaction fee — through the one shopper-facing commerce door that
    // skipped the entitlement. Deterministic and merchant-side, so it sits
    // here above the claim with the readiness check.
    if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'commerce')) {
      return res.status(403).json({ error: 'Reservations are not enabled' })
    }
    const ownerId = ownerOrg?.org?.ownerUid
    const ownerProfile = ownerId
      ? await firestore.collection('profiles').doc(String(ownerId)).get()
      : null
    const accountId = ownerProfile?.get('stripeAccountId')
    if (!accountId || !ownerProfile?.get('stripeChargesEnabled')) {
      return res.status(409).json({ error: 'Payments are not set up yet' })
    }

    // The claim sits ABOVE the availability read, and that placement is the
    // fix for this handler's particular lie (AGL-1697): a retried attempt used
    // to collide with its OWN 30-minute pending hold and be told "Those dates
    // just sold out" — about dates the guest was holding — where the correct
    // answer was the original session URL. Replaying here means the retry
    // never reaches the availability check at all. Every refusal below the
    // claim releases it, because each is deterministic and retryable.
    const claimed = await claimAttempt(firestore, {
      kind: 'commerce-reserve',
      scopeId: hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
      busyMessage: 'This reservation is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

    const [resourceSnapshot, reservationsSnapshot] = await Promise.all([
      hostRef.collection('resources').doc(resourceId).get(),
      hostRef
        .collection('reservations')
        .where('resourceId', '==', resourceId)
        .limit(500)
        .get(),
    ])
    const resource = resourceSnapshot.data() as CommerceModel.HostResource | undefined
    if (!resource) {
      await claim.release()
      return res.status(404).json({ error: 'Unknown resource' })
    }

    // Pending holds block for 30 minutes only, so abandoned checkouts
    // release the dates.
    const now = Date.now()
    const live = reservationsSnapshot.docs
      .map((docSnapshot) => ({
        checkInDayMs: Number(docSnapshot.get('checkInDayMs')),
        checkOutDayMs: Number(docSnapshot.get('checkOutDayMs')),
        status: String(docSnapshot.get('status')) as CommerceModel.ReservationStatus,
        createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
      }))
      .filter(
        (reservation) =>
          reservation.status !== 'pending' ||
          now - reservation.createdAtMs < 30 * 60 * 1000,
      )
    if (
      !CommerceModel.isRangeAvailable(resource, live, checkInDayMs, checkOutDayMs)
    ) {
      // A GENUINE sold-out (a keyed retry replayed before reaching here). The
      // guest picks other dates or the blocking stay is cancelled; either way
      // the key must survive the refusal.
      await claim.release()
      return res.status(409).json({ error: 'Those dates just sold out' })
    }
    const quote = CommerceModel.computeReservationQuote(
      resource,
      checkInDayMs,
      checkOutDayMs,
    )
    if (quote.problem) {
      await claim.release()
      return res.status(400).json({ error: quote.problem })
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
    } satisfies CommerceModel.HostReservation)

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
          // The half that costs real money (AGL-1697). Stripe replays the
          // existing session for a repeated key instead of opening a second
          // one, covering the window where the claim is written but the
          // response never arrives.
          ...(claim.stripeKey ? { 'Idempotency-Key': claim.stripeKey } : {}),
        },
        body: params.toString(),
      },
    )
    const session = (await response.json()) as { url?: string; error?: any }
    if (!response.ok || !session.url) {
      console.error('Stripe reservation error', session.error)
      await reservationRef.delete().catch(() => undefined)
      // The hold is rolled back, so the key must come back too — the guest
      // presses the same button and the retry re-derives the same digest,
      // which Stripe replays if the session did get created.
      await claim.release()
      return res.status(502).json({ error: 'Payment setup failed' })
    }
    const payload = { url: session.url }
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule): the hold may or may not have landed, and it expires
    // in 30 minutes either way.
    await claim?.release()
    return res.status(500).json({ error: 'Reservation failed' })
  }
}
