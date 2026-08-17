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
import {
  buildRoute,
  claimAttempt,
  Route,
  type AttemptClaim,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'

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
  // One draft attempt, minted by the console dialog (AGL-1697). Node
  // lowercases incoming headers, but read both spellings — the plugin API
  // request type makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)
  if (!hostId || !productId) {
    return res.status(400).json({ error: 'Missing hostId or productId' })
  }

  let claim: AttemptClaim | null = null
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

    // Shipping (AGL-1792), from the same settings document the two storefront
    // paths read. This handler contained no `shipping` string at all: a
    // merchant who configured zones and rates collected them on a cart
    // (AGL-1707) and on buy-now (AGL-1720), and nothing when they invoiced the
    // same buyer for the same parcel through a payment link. The session
    // collected no address either, so the merchant was not even told where to
    // send it — the webhook records one now that Stripe is asked for it.
    //
    // The premise AGL-1792 filed this under was that "the destination IS known
    // — the merchant typed it". It is not: the draft dialog collects a product,
    // a variant, a quantity and an email, and this handler reads exactly those.
    // So the destination is as unknown here as it is in the cart, and the same
    // asking machinery applies rather than none of it.
    //
    // CONDITIONAL on the product being physical, exactly as buy-now is: this
    // dialog invoices downloads and consulting too, and charging that buyer
    // postage would be worse than the bug. A missing `type` reads as physical,
    // matching the fee ladder above — the two reads must not disagree about
    // what a part-migrated doc is. The one-time condition buy-now also carries
    // is structural here: this path only ever builds `mode: 'payment'`.
    //
    // RESOLVED BEFORE THE ORDER DOCUMENT, because the plan can refuse and the
    // order is written before Stripe is called. Refusing after it would strand
    // a `pending` draft on the merchant's orders list for every attempt —
    // this path's version of the orphaned coupon AGL-1721 kept out of the cart.
    const storeSettings = await hostRef
      .collection('settings')
      .doc('store')
      .get()
    const shippingSettings = storeSettings.get('shipping') as
      CommerceModel.ShippingSettings | undefined
    const shippingPlan =
      (product.type ?? 'physical') === 'physical'
        ? CommerceModel.planCheckoutShipping(
            shippingSettings,
            {
              subtotalCents: itemsCents,
              totalGrams:
                Math.max(0, Number(variant.weightGrams ?? 0)) * quantity,
            },
            body.shippingCountry,
          )
        : { countries: CommerceModel.CHECKOUT_SHIPPING_COUNTRIES, options: [] }
    if (shippingPlan.refusal === 'destination-required') {
      return res.status(400).json({
        error: 'Choose where this order ships to.',
        needsShippingCountry: true,
        shippingCountries: [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
      })
    }
    if (shippingPlan.refusal === 'destination-unserved') {
      const declared = CommerceModel.normalizeCheckoutShippingCountry(
        body.shippingCountry,
      )
      return res.status(409).json({
        error: `This store does not ship to ${
          CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[declared as string] ??
          'that country'
        }.`,
        needsShippingCountry: true,
        shippingCountries: [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
      })
    }

    // Point of no return (AGL-1697): everything past here writes an order and
    // mints a live payment link. Every deterministic refusal — unknown
    // product, payments not set up, the shipping-destination ask — sits above
    // this line, so none of them burns the key: the merchant fixes the input
    // and presses the same button. Before the claim, a double-submit minted a
    // SECOND order doc, burned a second sequential number, and returned two
    // live payment links bound to different orders, both payable.
    const claimed = await claimAttempt(firestore, {
      kind: 'commerce-draft',
      scopeId: hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
      busyMessage: 'This draft order is already being created',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

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
    // Both keys or neither (AGL-1720's rule, inherited). Stripe will not apply
    // a shipping rate without an address to ship to, and a merchant who
    // configured nothing plans to no options and so gets neither — a payment
    // link byte-identical to the one this handler built before shipping
    // existed on it.
    if (shippingPlan.options.length > 0) {
      CommerceModel.appendShippingAddressCollectionParams(
        params,
        shippingPlan.countries,
      )
      CommerceModel.appendCheckoutShippingParams(params, shippingPlan.options)
    }
    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // The half that is a live payment link (AGL-1697). Stripe replays
          // the existing session for a repeated key instead of opening a
          // second one on the merchant's account, which covers the window
          // where our claim is written but the response never arrives.
          ...(claim.stripeKey ? { 'Idempotency-Key': claim.stripeKey } : {}),
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
      // The draft did not happen — hand the key back rather than locking this
      // dialog out over one flaky moment. The retry re-derives the SAME
      // digest, so if Stripe did create the session it replays it.
      await claim.release()
      return res.status(502).json({ error: 'Payment link creation failed' })
    }
    await orderRef.set(
      { checkoutSessionId: session.id, paymentLinkUrl: session.url },
      { merge: true },
    )
    const payload = { orderId: orderRef.id, url: session.url }
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule). The order write may or may not have landed; the
    // merchant reconciles from the orders list, the same position they were
    // in before this endpoint had a claim at all.
    await claim?.release()
    return res.status(500).json({ error: 'Draft order failed' })
  }
}
