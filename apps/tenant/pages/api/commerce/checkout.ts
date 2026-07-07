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
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Commerce Starter checkout (AGL-90): a site visitor buys a product. The
 * price ALWAYS comes from the host's product doc (never the request), the
 * money goes to the host owner's Connect account (AGL-46 onboarding) with a
 * 2% platform fee, and the webhook records the order under the host.
 * Selling is gated on the owner's `marketplaceSelling` plan flag
 * (dark-launch: no plan = allowed). 501 without Stripe env.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(501)
      .json({ error: 'Purchases are not configured on this site.' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const productId = String(body.productId ?? '')
  if (!hostId || !productId) {
    return res.status(400).json({ error: 'Missing hostId or productId' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, productSnapshot] = await Promise.all([
      hostRef.get(),
      hostRef.collection('products').doc(productId).get(),
    ])
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const product = productSnapshot.data() as any
    if (!product || product.deletedAt) {
      return res.status(404).json({ error: 'Unknown product' })
    }
    const priceUsd = Number(product.priceUsd ?? 0)
    if (!(priceUsd > 0) || priceUsd > Aglyn.COMMERCE_MAX_PRICE_USD) {
      return res.status(400).json({ error: 'Product is not purchasable' })
    }

    const ownerId =
      hostSnapshot.get('tenantId') ??
      Object.keys(hostSnapshot.get('admins') ?? {})[0]
    const [ownerTenant, ownerProfile] = await Promise.all([
      firestore.collection('tenants').doc(String(ownerId)).get(),
      firestore.collection('profiles').doc(String(ownerId)).get(),
    ])
    if (
      ownerTenant.get('plan') &&
      !Aglyn.checkEntitlement(ownerTenant.data() as any, 'marketplaceSelling')
    ) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }
    const accountId = ownerProfile.get('stripeAccountId')
    if (!accountId || !ownerProfile.get('stripeChargesEnabled')) {
      return res
        .status(409)
        .json({ error: 'This site has not enabled payments yet' })
    }

    const amountCents = Math.round(priceUsd * 100)
    const feeCents = Math.max(
      1,
      Math.round((amountCents * Aglyn.COMMERCE_PLATFORM_FEE_PERCENT) / 100),
    )
    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const backUrl = referer.startsWith('http') ? referer : origin
    const separator = backUrl.includes('?') ? '&' : '?'

    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': String(
        product.name ?? 'Product',
      ).slice(0, 120),
      'payment_intent_data[application_fee_amount]': String(feeCents),
      'payment_intent_data[transfer_data][destination]': String(accountId),
      success_url: `${backUrl}${separator}order=success`,
      cancel_url: `${backUrl}${separator}order=canceled`,
      'metadata[type]': 'commerce-order',
      'metadata[hostId]': hostId,
      'metadata[productId]': productId,
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
      console.error('Stripe checkout error', session.error)
      return res.status(502).json({ error: 'Checkout failed' })
    }
    return res.status(200).json({ url: session.url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
