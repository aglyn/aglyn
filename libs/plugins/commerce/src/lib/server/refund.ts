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

import * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn'

/**
 * Order refunds (AGL-287): full or partial via Stripe, site-admin only
 * (it moves money). Destination charges reverse the transfer and the
 * platform fee proportionally. Full refunds transition the order to
 * `refunded`; partial refunds accumulate `refundedCents` and stay in
 * the current status.
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
  if (!hostId || !orderId) {
    return res.status(400).json({ error: 'Missing hostId or orderId' })
  }

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
    const order = Aglyn.liftLegacyOrder(orderSnapshot.data() as any)
    if (!Aglyn.canTransitionOrder(order.status, 'refunded')) {
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

    const totalCents =
      order.totals?.totalCents ?? Number(order.amountCents ?? 0)
    const alreadyRefunded = Number(order.refundedCents ?? 0)
    const refundCents =
      amountCents == null
        ? totalCents - alreadyRefunded
        : Math.min(Math.round(amountCents), totalCents - alreadyRefunded)
    if (!(refundCents > 0)) {
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
      },
      body: params.toString(),
    })
    const refund = await response.json()
    if (!response.ok) {
      console.error('Stripe refund error', refund?.error)
      return res
        .status(502)
        .json({ error: refund?.error?.message ?? 'Refund failed' })
    }

    const refundedCents = alreadyRefunded + refundCents
    const fullyRefunded = refundedCents >= totalCents
    await orderRef.set(
      {
        refundedCents,
        ...(fullyRefunded ? { status: 'refunded' } : {}),
        timeline: Aglyn.appendOrderEvent(
          order,
          'refund',
          `$${(refundCents / 100).toFixed(2)} refunded` +
            (fullyRefunded ? ' (full)' : ''),
        ),
      },
      { merge: true },
    )
    return res.status(200).json({ refundedCents, fullyRefunded })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Refund failed' })
  }
}
