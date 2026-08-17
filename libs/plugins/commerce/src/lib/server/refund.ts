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

import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { createHash } from 'crypto'
import { recordContactRefund } from './contact-refund'
import { flagOrderRestock } from './restock-flag'

/**
 * A claim on one refund attempt (AGL-1696), the same primitive the POS sale
 * path uses (AGL-1691, `cab8aa36e`).
 */
interface RefundClaim {
  /** Stripe idempotency key for this attempt, or null when no key was sent. */
  stripeKey: string | null
  record: (status: number, body: unknown) => Promise<void>
  release: () => Promise<void>
}

/**
 * Order refunds (AGL-287): full or partial via Stripe, site-admin only
 * (it moves money). Destination charges reverse the transfer and the
 * platform fee proportionally. Full refunds transition the order to
 * `refunded`; partial refunds accumulate `refundedCents` and stay in
 * the current status.
 *
 * Two SEPARATE controls guard the money (AGL-1696), and conflating them is
 * how the original went wrong:
 *
 *  - The idempotency key stops a DUPLICATE refund — one attempt sent twice
 *    because the response was lost, the admin double-clicked, or a client
 *    retried. It is minted per attempt by the console and deliberately not
 *    derived from the order or the amount: two $10 refunds on a $50 order are
 *    two real refunds, exactly as a cashier ringing the same coffee twice is a
 *    real second sale.
 *  - The cap stops an OVER-refund — several partials summing past what was
 *    captured, including two admins refunding at once, where the two attempts
 *    are genuinely distinct and no key can help. That needs the counter read
 *    and written inside one transaction.
 *
 * The original had a cap that looked like both and was neither: it read
 * `refundedCents` and wrote it back only AFTER the Stripe call, outside any
 * transaction. A guard that reads state the guarded operation writes too late
 * is not a guard — measured, two concurrent refunds each sent a full $50 to
 * Stripe with no idempotency header on either.
 */
export const refundHandler: PluginApiHandler = async (req, res) => {
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
  const orderId = String(body.orderId ?? '')
  const amountCents = body.amountCents == null ? null : Number(body.amountCents)
  // One refund attempt, minted by the console. Node lowercases incoming
  // headers, but read both spellings — the plugin API request type makes no
  // promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  )
    .trim()
    .slice(0, 200)
  if (!hostId || !orderId) {
    return res.status(400).json({ error: 'Missing hostId or orderId' })
  }

  let claim: RefundClaim | null = null
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return res.status(403).json({ error: 'Refunds require a site admin' })
    }
    const orderRef = hostRef.collection('orders').doc(orderId)
    const orderSnapshot = await orderRef.get()
    if (!orderSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown order' })
    }
    const order = CommerceModel.liftLegacyOrder(orderSnapshot.data() as any)

    // Replay a settled attempt before anything else can reject it. This read
    // is only a short-circuit, never the dedupe primitive — the atomic
    // `create()` below is. It has to run ahead of the status guard because a
    // retried FULL refund would otherwise be answered "orders in refunded
    // cannot refund", which is the right money outcome reported as a failure,
    // and an admin who reads it as a failure refunds again by hand.
    const claimRef = idempotencyKey
      ? firestore
          .collection('apiIdempotency')
          .doc(
            createHash('sha256')
              // Scoped by the order, so a client that reused one key across
              // two orders cannot dedupe two legitimately distinct refunds.
              // NOT by the amount: that would swallow a real second partial.
              .update(`refund:${hostId}:${orderId}:${idempotencyKey}`)
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
    }

    if (!CommerceModel.canTransitionOrder(order.status, 'refunded')) {
      return res
        .status(409)
        .json({ error: `Orders in "${order.status}" cannot refund` })
    }
    const paymentIntentId =
      order.paymentIntentId ??
      // Legacy rows stored the checkout session as the doc id; resolve
      // the payment intent from Stripe.
      (await (async () => {
        const response = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${orderId}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            },
          },
        )
        const session = await response.json()
        return response.ok ? session?.payment_intent : null
      })())
    if (!paymentIntentId) {
      return res.status(409).json({ error: 'No payment to refund' })
    }

    // Point of no return: everything past here moves money. The claim is
    // `create()` — Firestore rejects a create on an existing document, and
    // that rejection IS the dedupe primitive. A read-then-write would race
    // exactly the double-submit it exists to stop. Storage reuses the REST
    // API's shape and its `orgId` field (AGL-618) rather than inventing a
    // second replay store, so `eraseOrgIdempotencyKeys` (AGL-1448) already
    // sweeps these on org erasure with no change there.
    if (claimRef) {
      const ownerOrg = await getOrgForHost(hostId)
      try {
        await claimRef.create({
          orgId: String(ownerOrg?.org?.id ?? '') || null,
          hostId,
          orderId,
          kind: 'commerce-refund',
          status: 'pending',
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          createdAtMs: Date.now(),
        })
      } catch {
        const prior = await claimRef.get()
        const priorResponse = prior.get('response')
        if (priorResponse) {
          return res
            .status(Number(prior.get('responseStatus') ?? 200))
            .json(priorResponse)
        }
        // In flight, or stranded by a process that died mid-refund. Fail
        // CLOSED: the alternative is sending the money a second time.
        return res
          .status(409)
          .json({ error: 'This refund is already being processed' })
      }
      claim = {
        // The same digest goes to Stripe. That is the half that costs real
        // money: it covers the window where our claim is written but the
        // response never arrives, and makes Stripe replay its own refund
        // instead of moving the funds again.
        stripeKey: claimRef.id,
        record: async (status, payload) => {
          await claimRef
            .set(
              {
                status: 'done',
                responseStatus: status,
                response: payload,
                settledAtMs: Date.now(),
              },
              { merge: true },
            )
            .catch(() => undefined)
        },
        release: async () => {
          await claimRef.delete().catch(() => undefined)
        },
      }
    }

    // RESERVE. The cap is read and written in one transaction, so two
    // concurrent refunds cannot both see the same `refundedCents` — which is
    // the whole failure the old ordering had, since it wrote the counter only
    // after Stripe had already been asked to move the money. Reserving BEFORE
    // the call rather than after also fails in the safe direction: a lost
    // response leaves the amount counted, so the retry refunds less, never
    // more.
    let refundCents = 0
    let totalCents = 0
    await firestore.runTransaction(async (transaction) => {
      const fresh = CommerceModel.liftLegacyOrder(
        ((await transaction.get(orderRef)).data() ?? {}) as any,
      )
      totalCents = fresh.totals?.totalCents ?? Number(fresh.amountCents ?? 0)
      const alreadyRefunded = Number(fresh.refundedCents ?? 0)
      const remaining = totalCents - alreadyRefunded
      refundCents =
        amountCents == null
          ? remaining
          : Math.min(Math.round(amountCents), remaining)
      if (!(refundCents > 0)) {
        refundCents = 0
        return
      }
      transaction.set(
        orderRef,
        { refundedCents: alreadyRefunded + refundCents },
        { merge: true },
      )
    })
    if (!(refundCents > 0)) {
      // Nothing moved, so the attempt key is released rather than burned.
      await claim?.release()
      return res.status(400).json({ error: 'Nothing left to refund' })
    }

    const params = new URLSearchParams({
      payment_intent: String(paymentIntentId),
      amount: String(refundCents),
      reverse_transfer: 'true',
      refund_application_fee: 'true',
    })
    const response = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(claim?.stripeKey
          ? { 'Idempotency-Key': claim.stripeKey }
          : {}),
      },
      body: params.toString(),
    })
    const refund = await response.json()
    if (!response.ok) {
      console.error('Stripe refund error', refund?.error)
      // Stripe said no, so we KNOW no money moved: give the reservation back
      // and let the same attempt be tried again.
      await firestore
        .runTransaction(async (transaction) => {
          const current = Number(
            (await transaction.get(orderRef)).get('refundedCents') ?? 0,
          )
          transaction.set(
            orderRef,
            { refundedCents: Math.max(0, current - refundCents) },
            { merge: true },
          )
        })
        .catch(() => undefined)
      await claim?.release()
      return res
        .status(502)
        .json({ error: refund?.error?.message ?? 'Refund failed' })
    }

    // SETTLE. Re-read inside the transaction: a concurrent partial may have
    // reserved against the same order, and the timeline must be appended to
    // whatever is there now rather than to the snapshot read at the top.
    let refundedCents = 0
    let fullyRefunded = false
    let closedTheOrder = false
    await firestore.runTransaction(async (transaction) => {
      const fresh = CommerceModel.liftLegacyOrder(
        ((await transaction.get(orderRef)).data() ?? {}) as any,
      )
      refundedCents = Number(fresh.refundedCents ?? 0)
      fullyRefunded = refundedCents >= totalCents
      // Whether THIS settle moved the order into `refunded`, which is not the
      // same question as whether the order is now fully refunded (AGL-1754).
      // Two partials that between them close an order can both reserve before
      // either settles, so both re-read the completed total and both compute
      // `fullyRefunded`. Writing `status: 'refunded'` twice is harmless;
      // incrementing a count twice is not. Reading the status inside the same
      // transaction that writes it makes the flip observable exactly once.
      closedTheOrder = fullyRefunded && fresh.status !== 'refunded'
      transaction.set(
        orderRef,
        {
          ...(fullyRefunded ? { status: 'refunded' } : {}),
          timeline: CommerceModel.appendOrderEvent(
            fresh,
            'refund',
            `$${(refundCents / 100).toFixed(2)} refunded` +
              (fullyRefunded ? ' (full)' : ''),
          ),
        },
        { merge: true },
      )
    })
    const payload = { refundedCents, fullyRefunded }
    await claim?.record(200, payload)
    // The customer's side of the ledger (AGL-1754). Everything above records
    // the money on the ORDER; without this the buyer's `ltvCents` still counts
    // a sale they returned, and only ever rises.
    //
    // Placed AFTER the attempt is recorded so a slow contacts write cannot
    // strand the claim: a retry that arrives while this is in flight replays
    // the recorded 200 instead of being turned away with "already being
    // processed". Awaited rather than fired off with `void` — the handler is
    // serverless, and work left running past the response is work the
    // container may be frozen before it finishes. `recordContactRefund`
    // swallows its own failures, so awaiting adds no way for this to fail a
    // refund that has already left the merchant's account.
    //
    // Amount is THIS attempt's `refundCents`, already capped against what was
    // left, so several partials sum to at most the order total — the same
    // number the order's own `refundedCents` follows. The retried and racing
    // cases need no key of their own: a keyed retry never reaches here (it
    // replays at the claim), and a keyless one is a genuinely new refund that
    // moved more money and should be counted.
    await recordContactRefund({
      hostId,
      orderId,
      email: order.customerEmail,
      amountCents: refundCents,
      closedTheOrder,
    })
    // The shelf's side of the ledger (AGL-1797). The sale decremented variant
    // inventory and nothing put it back, so a fully refunded order read one
    // unit light forever. This FLAGS rather than releases — a refund with no
    // return leaves the goods gone, and inventing stock the merchant does not
    // have is worse than under-counting it — and the merchant answers from the
    // stock adjustment they already have. Same placement and same swallow-all
    // contract as the contact write above, for the same reason: the money has
    // moved and the order records it, so nothing here may fail the refund.
    await flagOrderRestock({ hostId, orderId, kind: 'refund', closedTheOrder })
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Deliberately NOT released, which is where this diverges from the POS
    // sale path (AGL-1691). If the refund call threw we do not know whether
    // Stripe moved the money, and the two failure directions are not
    // symmetric: a stranded key costs a support ticket, a released one costs a
    // second refund. The retry gets a 409 and a human reconciles.
    return res.status(500).json({ error: 'Refund failed' })
  }
}
