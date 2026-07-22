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
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'

/**
 * Draft orders (AGL-287, Shopify parity): a manager builds an order in
 * the console and sends the buyer a payment link. Creates the order doc
 * (status `pending`, channel `draft`) with a sequential number, then a
 * Stripe Checkout session on the merchant's connected account whose
 * webhook completion flips the SAME doc to `paid`
 * (metadata type `commerce-draft`).
 */
export const draftOrderHandler: PluginApiHandler = async (req, res) => {
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
  const productId = String(body.productId ?? '')
  const variantId = String(body.variantId ?? '')
  const quantity = Math.max(1, Math.min(99, Math.round(Number(body.quantity ?? 1))))
  const email = String(body.email ?? '').trim()
  if (!hostId || !productId) {
    return res.status(400).json({ error: 'Missing hostId or productId' })
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
    if (!memberRole || memberRole === 'viewer') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const productSnapshot = await hostRef
      .collection('products')
      .doc(productId)
      .get()
    const raw = productSnapshot.data() as any
    if (!raw || raw.deletedAt) {
      return res.status(404).json({ error: 'Unknown product' })
    }
    const product = CommerceModel.liftLegacyProduct(raw)
    const variant = variantId
      ? product.variants.find((item) => item.id === variantId)
      : product.variants[0]
    if (!variant) return res.status(404).json({ error: 'Unknown variant' })

    // Merchant account like the storefront checkout (AGL-284).
    const ownerOrg = await getOrgForHost(hostId)
    const ownerId = ownerOrg?.org?.ownerUid
    const ownerProfile = ownerId
      ? await firestore.collection('profiles').doc(String(ownerId)).get()
      : null
    const accountId = ownerProfile?.get('stripeAccountId')
    if (!accountId || !ownerProfile?.get('stripeChargesEnabled')) {
      return res.status(409).json({ error: 'Payments are not set up yet' })
    }

    // Stripe returns the merchant to the console Products page. This was
    // `/{hostDocId}/products`, the pre-AGL-621/622 shape, so paying (or
    // cancelling) a draft order landed on a 404 (AGL-685). Console products
    // is the plugin route keyed by org slug + host SUBDOMAIN; server code
    // cannot call useConsoleHostRoute, so resolve them here. Without both,
    // fall back to the origin root rather than a fabricated dead path.
    const consoleSubdomain = (
      await firestore.collection('hostIndex').doc(hostId).get()
    ).get('subdomain') as string | undefined
    const consoleOrgSlug = ownerOrg?.org?.slug as string | undefined
    const origin = req.headers.origin ?? `https://${req.headers.host}`
    const consoleProductsUrl =
      consoleOrgSlug && consoleSubdomain
        ? `${origin}${buildRoute(Route.HOST_PLUGIN, {
            orgSlug: consoleOrgSlug,
            host: consoleSubdomain,
            pluginSlug: 'products',
          })}`
        : origin

    const unitAmountCents = Math.round(Number(variant.priceUsd) * 100)
    const lineItems: CommerceModel.OrderLineItem[] = [
      {
        productId,
        ...(variantId ? { variantId } : {}),
        name: product.name,
        ...(variant.sku ? { sku: variant.sku } : {}),
        productType: product.type,
        quantity,
        unitAmountCents,
      },
    ]
    const feePct = Aglyn.resolveTransactionFeePct(
      ownerOrg?.org as any,
      product.type,
    )
    const itemsCents = unitAmountCents * quantity
    const feeCents =
      feePct > 0 ? Math.max(1, Math.round((itemsCents * feePct) / 100)) : 0
    const totals = CommerceModel.computeOrderTotals(lineItems, { feeCents })

    // Order doc first (transactional number), then the payment link.
    const orderRef = hostRef.collection('orders').doc()
    const counterRef = hostRef.collection('counters').doc('orders')
    await firestore.runTransaction(async (transaction) => {
      const counter = await transaction.get(counterRef)
      const number = Number(counter.get('next') ?? 1)
      transaction.set(counterRef, { next: number + 1 }, { merge: true })
      transaction.set(orderRef, {
        number,
        status: 'pending',
        channel: 'draft',
        lineItems,
        totals,
        customerEmail: email || null,
        timeline: [
          {
            atMs: Date.now(),
            event: 'draft',
            detail: `Draft created by ${decoded.email ?? decoded.uid}`,
          },
        ],
        createdAtMs: Date.now(),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    })

    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': String(quantity),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(unitAmountCents),
      'line_items[0][price_data][product_data][name]': product.name.slice(
        0,
        120,
      ),
      ...(feeCents > 0
        ? { 'payment_intent_data[application_fee_amount]': String(feeCents) }
        : {}),
      'payment_intent_data[transfer_data][destination]': String(accountId),
      ...(email ? { customer_email: email } : {}),
      success_url: `${consoleProductsUrl}?draft=paid`,
      cancel_url: `${consoleProductsUrl}?draft=canceled`,
      'metadata[type]': 'commerce-draft',
      'metadata[hostId]': hostId,
      'metadata[orderId]': orderRef.id,
      'metadata[productId]': productId,
      ...(variantId ? { 'metadata[variantId]': variantId } : {}),
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
    const session = (await response.json()) as {
      url?: string
      id?: string
      error?: any
    }
    if (!response.ok || !session.url) {
      console.error('Stripe draft-order error', session.error)
      await orderRef.delete().catch(() => undefined)
      return res.status(502).json({ error: 'Payment link creation failed' })
    }
    await orderRef.set(
      { checkoutSessionId: session.id, paymentLinkUrl: session.url },
      { merge: true },
    )
    return res.status(200).json({ orderId: orderRef.id, url: session.url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Draft order failed' })
  }
}
