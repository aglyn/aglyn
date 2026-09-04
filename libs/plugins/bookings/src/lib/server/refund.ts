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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
// Leaf import, not the barrel: the specs in this library mock
// `@aglyn/tenant-data-admin` wholesale, and a permissive stub would turn a
// reversal that never happened green.
import { reverseEmailAttributedRevenue } from '@aglyn/tenant-data-admin/server/email-revenue-attribution'
import { createHash } from 'crypto'

/**
 * Refund a paid booking (AGL-2315), full or partial, site-admin only.
 *
 * This route exists BECAUSE of the destination charge, not alongside it. While
 * a paid booking settled in Aglyn's own balance there was nothing here to get
 * wrong: cancelling a booking refunded the guest nothing at all, and any
 * refund issued by hand simply gave back money Aglyn was already holding. Once
 * the charge goes to the merchant's connected account that stops being true in
 * two directions at once, and both are money:
 *
 *  - **The guest.** Cancelling a paid booking wrote `status: 'canceled'` from
 *    the console and moved no money. The slot reopened, the appointment was
 *    gone, and the guest had paid for it. That was survivable only because the
 *    platform still held the funds and could be made to give them back; with
 *    the money at the merchant it is a silent, unrecoverable overcharge.
 *  - **Aglyn.** A refund on a destination charge that does NOT set
 *    `reverse_transfer` is paid entirely out of the PLATFORM's balance while
 *    the merchant keeps the transfer in full. The merchant cancels, the guest
 *    is made whole, and Aglyn funds the whole concession out of a cut that was
 *    at most 5% of it. This repo has shipped that exact bug once already, on a
 *    marketplace partial refund.
 *
 * So both switches are sent, and they are two different decisions:
 *
 *  - `reverse_transfer` pulls the refunded share back OUT of the merchant's
 *    account. Stripe prorates it against a partial refund, so a $30 refund on
 *    a $75 booking claws back $30 of the merchant's $71.25, not all of it.
 *  - `refund_application_fee` returns Aglyn's commission on the refunded
 *    share. A refunded appointment earned the platform nothing, and this
 *    matches `commerce/refund.ts`, which has sent both since AGL-287. The
 *    DISPUTE path deliberately sends only the reversal — that asymmetry is
 *    AGL-1809's and is not copied here.
 *
 * Two SEPARATE controls guard the money, the AGL-1696 lesson from the order
 * refund, and conflating them is how that one originally went wrong:
 *
 *  - The idempotency key stops a DUPLICATE refund — one attempt sent twice
 *    because the response was lost or the admin double-clicked. It is minted
 *    per attempt by the console and deliberately not derived from the booking
 *    or the amount: two $10 refunds on a $75 booking are two real refunds.
 *  - The cap stops an OVER-refund — several partials summing past what was
 *    captured, including two admins refunding at once, where the attempts are
 *    genuinely distinct and no key can help. That needs the counter read and
 *    written inside one transaction, BEFORE Stripe is called, so a lost
 *    response leaves the amount counted and the retry refunds less, never
 *    more.
 */
export const bookingRefundHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ error: 'Payments are not configured.' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const bookingId = String(body.bookingId ?? '')
  // `null`/absent means "everything still refundable"; a number is a partial.
  const amountCents = body.amountCents == null ? null : Number(body.amountCents)
  // Node lowercases incoming headers, but read both spellings — the plugin API
  // request type makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  )
    .trim()
    .slice(0, 200)
  if (!hostId || !bookingId) {
    return res.status(400).json({ error: 'Missing hostId or bookingId' })
  }
  if (amountCents != null && !(Number.isFinite(amountCents) && amountCents > 0)) {
    return res.status(400).json({ error: 'Invalid refund amount' })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    // Site ADMIN, not merely a member: this moves money. The same gate
    // `commerce/refund.ts` applies.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return res.status(403).json({ error: 'Refunds require a site admin' })
    }
    const bookingRef = hostRef.collection('bookings').doc(bookingId)
    const bookingSnapshot = await bookingRef.get()
    if (!bookingSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown booking' })
    }
    const paymentIntentId = String(bookingSnapshot.get('paymentIntentId') ?? '')
    const paidCents = Math.max(
      0,
      Math.round(Number(bookingSnapshot.get('paidAmountCents') ?? 0)),
    )
    if (!paidCents) {
      return res.status(409).json({ error: 'This booking was never paid' })
    }
    if (!paymentIntentId) {
      // A booking paid BEFORE the webhook began recording the PaymentIntent
      // (AGL-2315). Refundable, but only by hand — and saying so beats a 500
      // an admin cannot act on.
      return res.status(409).json({
        error:
          'This booking was paid before refunds were supported here. ' +
          'Refund it in the Stripe dashboard, and tick “Reverse transfer” ' +
          'so the amount comes back from the merchant account.',
      })
    }

    // Replay a settled attempt before anything else can reject it. This read
    // is only a short-circuit, never the dedupe primitive — the atomic
    // `create()` below is.
    const claimRef = idempotencyKey
      ? firestore.collection('apiIdempotency').doc(
          createHash('sha256')
            // Scoped by the BOOKING, so a client that reused one key across
            // two bookings cannot dedupe two legitimately distinct refunds.
            // NOT by the amount: that would swallow a real second partial.
            .update(`booking-refund:${hostId}:${bookingId}:${idempotencyKey}`)
            .digest('hex'),
        )
      : null
    if (claimRef) {
      const prior = await claimRef.get()
      const priorResponse = prior.get('response')
      if (priorResponse) {
        return res
          .status(Number(prior.get('responseStatus') ?? 200))
          .json(priorResponse)
      }
      try {
        await claimRef.create({ status: 'pending', startedAtMs: Date.now() })
      } catch {
        // Another attempt with this key is in flight.
        return res
          .status(409)
          .json({ error: 'This refund is already being processed' })
      }
    }

    // RESERVE. Read and write the counter in ONE transaction so two concurrent
    // refunds cannot both see the same `refundedCents` and each send a full
    // amount to Stripe — the failure the order refund shipped with.
    let refundCents = 0
    let alreadyRefunded = 0
    await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(bookingRef)
      alreadyRefunded = Math.max(
        0,
        Math.round(Number(fresh.get('refundedCents') ?? 0)),
      )
      const remaining = paidCents - alreadyRefunded
      refundCents =
        amountCents == null
          ? remaining
          : Math.min(Math.round(amountCents), remaining)
      if (!(refundCents > 0)) {
        refundCents = 0
        return
      }
      transaction.set(
        bookingRef,
        { refundedCents: alreadyRefunded + refundCents },
        { merge: true },
      )
    })
    if (!(refundCents > 0)) {
      await claimRef?.delete().catch(() => undefined)
      return res.status(400).json({ error: 'Nothing left to refund' })
    }

    const params = new URLSearchParams({
      payment_intent: paymentIntentId,
      amount: String(refundCents),
      // THE SELLER SHARE COMES BACK. Without this the merchant keeps their
      // transfer in full and Aglyn funds the entire refund.
      reverse_transfer: 'true',
      // ...and so does Aglyn's commission on the refunded share. A refunded
      // appointment earned the platform nothing.
      refund_application_fee: 'true',
    })
    const response = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(claimRef ? { 'Idempotency-Key': claimRef.id } : {}),
      },
      body: params.toString(),
    })
    const refund = await response.json().catch(() => ({}) as any)
    if (!response.ok) {
      console.error('Stripe booking refund error', (refund as any)?.error)
      // Stripe said no, so we KNOW no money moved: give the reservation back
      // and let the same attempt be retried.
      await firestore
        .runTransaction(async (transaction) => {
          const current = Number(
            (await transaction.get(bookingRef)).get('refundedCents') ?? 0,
          )
          transaction.set(
            bookingRef,
            { refundedCents: Math.max(0, current - refundCents) },
            { merge: true },
          )
        })
        .catch(() => undefined)
      await claimRef?.delete().catch(() => undefined)
      return res.status(502).json({ error: 'Refund failed' })
    }

    // A FULL refund ends the appointment; a partial leaves it standing. The
    // guest who got half their money back still has the slot, and moving the
    // booking off `confirmed` would reopen a time the merchant is still
    // committed to.
    const totalRefunded = alreadyRefunded + refundCents
    const fullyRefunded = totalRefunded >= paidCents
    await bookingRef
      .set(
        {
          refundedCents: totalRefunded,
          ...(fullyRefunded ? { status: 'canceled' } : {}),
        },
        { merge: true },
      )
      .catch(() => undefined)

    const payload = {
      refundedCents: refundCents,
      totalRefundedCents: totalRefunded,
      fullyRefunded,
    }
    await claimRef
      ?.set(
        {
          status: 'done',
          responseStatus: 200,
          response: payload,
          settledAtMs: Date.now(),
        },
        { merge: true },
      )
      .catch(() => undefined)
    /*
     * The campaign's side of the ledger.
     *
     * A paid booking is credited to the campaign that led to it — the sale
     * announces itself through `upsertHostContact` with a `purchaseCents` and
     * this booking's id, exactly as a store order does — so a refunded one
     * has to stop counting. Without this, a booking site's campaign revenue
     * could only ever rise.
     *
     * Keyed by the BOOKING id, which is what the credit was filed under, so
     * this needs no email and works for a guest who never became a contact.
     * Recorded beside the credit rather than subtracted from it, and swallowed
     * whole: the money has already left the merchant's account and the booking
     * already records it, so nothing here may fail a refund.
     */
    await reverseEmailAttributedRevenue({
      hostId,
      orderId: bookingId,
      amountCents: refundCents,
      closedTheOrder: fullyRefunded,
    })
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Refund failed' })
  }
}
