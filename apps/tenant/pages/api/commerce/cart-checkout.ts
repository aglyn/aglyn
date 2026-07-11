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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Cart checkout (AGL-293): the whole cart in one Stripe Checkout
 * session on the merchant's account. Every line re-prices from its
 * product doc, unavailable lines block with a visible error, the
 * platform fee sums per line by product type (AGL-278 ladder), and the
 * webhook creates one multi-line order and clears the cart.
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
  const couponCode = String(body.couponCode ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 40)
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  const cartId = String(req.cookies[`aglyn_cart_${hostId}`] ?? '')
  if (!cartId) return res.status(400).json({ error: 'Your cart is empty' })

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const cartSnapshot = await hostRef.collection('carts').doc(cartId).get()
    const cart = (cartSnapshot.data() as Aglyn.HostCart | undefined) ?? {
      lines: [],
    }
    if (cart.lines.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty' })
    }

    const ownerOrg = await getOrgForHost(hostId)
    const ownerId = ownerOrg?.org?.ownerUid
    if (!ownerId) {
      return res.status(409).json({ error: 'This site cannot sell yet' })
    }
    if (!Aglyn.checkEntitlement(ownerOrg.org as any, 'marketplaceSelling')) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }
    const ownerProfile = await firestore
      .collection('profiles')
      .doc(String(ownerId))
      .get()
    const accountId = ownerProfile.get('stripeAccountId')
    if (!accountId || !ownerProfile.get('stripeChargesEnabled')) {
      return res
        .status(409)
        .json({ error: 'This site has not enabled payments yet' })
    }

    // Re-price every line from its doc; any unavailable line blocks.
    const productSnapshots = await Promise.all(
      [...new Set(cart.lines.map((line) => line.productId))].map((id) =>
        hostRef.collection('products').doc(id).get(),
      ),
    )
    const productsById = new Map(
      productSnapshots.map((snapshot) => [
        snapshot.id,
        snapshot.exists ? Aglyn.liftLegacyProduct(snapshot.data() as any) : null,
      ]),
    )
    let itemsCents = 0
    let feeCents = 0
    const params = new URLSearchParams({ mode: 'payment' })
    cart.lines.forEach((line, index) => {
      const product = productsById.get(line.productId)
      if (!product || product.deletedAt || product.status !== 'active') {
        throw Object.assign(new Error('unavailable'), {
          visible: `"${product?.name ?? 'A product'}" is no longer available`,
        })
      }
      const variant = line.variantId
        ? product.variants.find((item) => item.id === line.variantId)
        : product.variants[0]
      if (!variant || !Aglyn.canPurchase(product, variant.id, line.quantity)) {
        throw Object.assign(new Error('unavailable'), {
          visible: `"${product.name}" is sold out`,
        })
      }
      const unitCents = Math.round(Number(variant.priceUsd) * 100)
      itemsCents += unitCents * line.quantity
      const feePct = Aglyn.resolveTransactionFeePct(
        ownerOrg.org as any,
        product.type,
      )
      feeCents += Math.round((unitCents * line.quantity * feePct) / 100)
      params.set(`line_items[${index}][quantity]`, String(line.quantity))
      params.set(`line_items[${index}][price_data][currency]`, 'usd')
      params.set(
        `line_items[${index}][price_data][unit_amount]`,
        String(unitCents),
      )
      params.set(
        `line_items[${index}][price_data][product_data][name]`,
        `${product.name}${
          Object.keys(variant.options ?? {}).length
            ? ` (${Object.values(variant.options ?? {}).join(' / ')})`
            : ''
        }`.slice(0, 120),
      )
    })

    // Coupons (AGL-96 semantics): percent off the items total, applied
    // as a Stripe coupon so line prices stay honest.
    if (couponCode) {
      const couponSnapshot = await hostRef
        .collection('coupons')
        .doc(couponCode)
        .get()
      const coupon = couponSnapshot.data() as any
      const percentOff = Number(coupon?.percentOff ?? 0)
      const expired =
        coupon?.expiresAtMs != null && Number(coupon.expiresAtMs) < Date.now()
      const exhausted =
        coupon?.maxRedemptions != null &&
        Number(coupon.redemptions ?? 0) >= Number(coupon.maxRedemptions)
      if (
        !coupon ||
        coupon.enabled === false ||
        expired ||
        exhausted ||
        !(percentOff > 0 && percentOff <= 100)
      ) {
        return res.status(400).json({ error: 'Invalid or expired coupon' })
      }
      const stripeCoupon = await fetch('https://api.stripe.com/v1/coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          percent_off: String(percentOff),
          duration: 'once',
        }).toString(),
      }).then((response) => response.json())
      if (stripeCoupon?.id) {
        params.set('discounts[0][coupon]', stripeCoupon.id)
        params.set('metadata[couponCode]', couponCode)
        feeCents = Math.round((feeCents * (100 - percentOff)) / 100)
      }
    }

    if (feeCents > 0) {
      params.set(
        'payment_intent_data[application_fee_amount]',
        String(Math.max(1, feeCents)),
      )
    }
    params.set(
      'payment_intent_data[transfer_data][destination]',
      String(accountId),
    )
    // Address collection feeds order shipping + destination tax later.
    params.set('shipping_address_collection[allowed_countries][0]', 'US')
    params.set('shipping_address_collection[allowed_countries][1]', 'CA')
    params.set('shipping_address_collection[allowed_countries][2]', 'GB')
    params.set('shipping_address_collection[allowed_countries][3]', 'AU')
    params.set('shipping_address_collection[allowed_countries][4]', 'DE')
    params.set('shipping_address_collection[allowed_countries][5]', 'FR')

    // Stripe Tax when opted in (manual destination tax lands with the
    // AGL-296 checkout, which knows the address before the session).
    const storeSettings = await hostRef
      .collection('settings')
      .doc('store')
      .get()
    const taxSettings = (storeSettings.get('tax') ?? {}) as Aglyn.TaxSettings
    if (taxSettings.mode === 'stripe') {
      params.set('automatic_tax[enabled]', 'true')
    }

    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const backUrl = referer.startsWith('http') ? referer : origin
    const separator = backUrl.includes('?') ? '&' : '?'
    params.set('success_url', `${backUrl}${separator}order=success`)
    params.set('cancel_url', `${backUrl}${separator}order=canceled`)
    params.set('metadata[type]', 'commerce-cart')
    params.set('metadata[hostId]', hostId)
    params.set('metadata[cartId]', cartId)
    params.set('metadata[feeCents]', String(Math.max(0, feeCents)))

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
      console.error('Stripe cart checkout error', session.error)
      return res.status(502).json({ error: 'Checkout failed' })
    }
    return res.status(200).json({ url: session.url })
  } catch (error: any) {
    if (error?.visible) {
      return res.status(409).json({ error: error.visible })
    }
    console.error(error)
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
