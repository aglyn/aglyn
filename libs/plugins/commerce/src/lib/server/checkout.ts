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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'

/**
 * Commerce Starter checkout (AGL-90): a site visitor buys a product. The
 * price ALWAYS comes from the host's product doc (never the request), the
 * money goes to the host owner's Connect account (AGL-46 onboarding) with a
 * 2% platform fee, and the webhook records the order under the host.
 * Selling is gated on the owner's `marketplaceSelling` plan flag
 * (plan-less orgs resolve as free, AGL-247). 501 without Stripe env.
 */
export const checkoutHandler: PluginApiHandler = async (req, res) => {
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
  const variantId = String(body.variantId ?? '')
  const quantity = Math.max(
    1,
    Math.min(99, Math.round(Number(body.quantity ?? 1))),
  )
  const couponCode = String(body.couponCode ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 40)
  // Buyer-chosen billing (AGL-545): a request, never an instruction —
  // the session mode re-resolves from the product doc below.
  const billingRaw = String(body.billing ?? '')
  const billing: CommerceModel.CheckoutBillingChoice | undefined =
    billingRaw === 'once' || billingRaw === 'subscribe' ? billingRaw : undefined
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
    // Variant pricing (AGL-292): the buyer's selection maps to a variant;
    // absent variantId keeps the legacy default-variant behavior.
    const lifted = CommerceModel.liftLegacyProduct(product)
    const variant = variantId
      ? lifted.variants.find((item) => item.id === variantId)
      : lifted.variants[0]
    if (!variant) return res.status(404).json({ error: 'Unknown variant' })
    const priceUsd = Number(variant.priceUsd ?? 0)
    if (!(priceUsd > 0) || priceUsd > CommerceModel.COMMERCE_MAX_PRICE_USD) {
      return res.status(400).json({ error: 'Product is not purchasable' })
    }
    // Inventory (AGL-281): variant-aware, honoring the product's oversell
    // policy (backorder products keep selling at zero). Enforced here (the
    // block's display is cosmetic) and decremented by the webhook.
    if (!CommerceModel.canPurchase(lifted, variant.id, quantity)) {
      return res.status(409).json({ error: 'Sold out' })
    }

    // Seller resolution rides the owning org (AGL-238): plan gate from
    // the org doc, Stripe account from the owner's marketplace profile.
    const ownerOrg = await getOrgForHost(hostId)
    const ownerId = ownerOrg?.org?.ownerUid
    if (!ownerId) {
      return res.status(409).json({ error: 'This site cannot sell yet' })
    }
    const ownerProfile = await firestore
      .collection('profiles')
      .doc(String(ownerId))
      .get()
    // Storefront selling is the `commerce` entitlement (Starter+) — not
    // `marketplaceSelling`, which gates the marketplace marketplace (AGL-470).
    if (!Aglyn.checkEntitlement(ownerOrg.org as any, 'commerce')) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }
    // Session mode (AGL-545): 'subscribe' only takes effect on
    // subscriptionOptional products, 'once' never applies to
    // subscription-only products, and price/interval always come from
    // the product doc — never the request.
    const isSubscription =
      CommerceModel.resolveCheckoutBillingMode(lifted, billing) ===
      'subscription'
    // Tiered product types (AGL-470): recurring subscriptions and gift
    // cards are Business+ entitlements, checked per sale — the product doc
    // alone must not unlock them. Gated whenever the session ends up in
    // subscription mode (a subscriptionOptional one-time sale is a plain
    // order, so it rides the base `commerce` entitlement).
    if (
      isSubscription &&
      !Aglyn.checkEntitlement(ownerOrg.org as any, 'storefrontSubscriptions')
    ) {
      return res
        .status(403)
        .json({ error: 'Subscription products require a Business plan' })
    }
    if (
      product.giftCard &&
      !Aglyn.checkEntitlement(ownerOrg.org as any, 'giftCards')
    ) {
      return res
        .status(403)
        .json({ error: 'Gift cards require a Business plan' })
    }
    const accountId = ownerProfile.get('stripeAccountId')
    if (!accountId || !ownerProfile.get('stripeChargesEnabled')) {
      return res
        .status(409)
        .json({ error: 'This site has not enabled payments yet' })
    }

    // The list price per unit, before any coupon (AGL-1711). This is what the
    // order's line-item snapshot records, and it is carried in the session
    // metadata so the webhook never has to re-price from the product doc.
    const listUnitAmountCents = Math.round(priceUsd * 100)
    let amountCents = listUnitAmountCents * quantity
    // Coupons (AGL-96): host-defined percent-off codes; invalid codes are
    // a visible 400, never a silent full-price charge.
    let appliedCoupon = ''
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
      // Stripe's charge minimum is 50¢ — never discount below it.
      amountCents = Math.max(
        50,
        Math.round((amountCents * (100 - percentOff)) / 100),
      )
      appliedCoupon = couponCode
    }
    // Platform fee (AGL-284): per-plan ladder from the entitlement matrix
    // (AGL-278) by product type — 0% plans genuinely charge no fee.
    const feePct = Aglyn.resolveTransactionFeePct(
      ownerOrg.org as any,
      lifted.type ?? 'physical',
    )
    const feeCents =
      feePct > 0 ? Math.max(1, Math.round((amountCents * feePct) / 100)) : 0
    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const backUrl = referer.startsWith('http') ? referer : origin
    const separator = backUrl.includes('?') ? '&' : '?'

    // Taxes (AGL-285): Stripe Tax when the host opted in; manual mode
    // taxes by store origin here (destination-based arrives with our own
    // checkout, AGL-296). Exempt products skip both.
    const storeSettings = await hostRef
      .collection('settings')
      .doc('store')
      .get()
    const taxSettings = (storeSettings.get('tax') ?? {}) as CommerceModel.TaxSettings
    const useStripeTax = taxSettings.mode === 'stripe' && !lifted.taxExempt
    let taxCents = 0
    let taxLabel = ''
    if (taxSettings.mode === 'manual' && !lifted.taxExempt) {
      const rate = CommerceModel.resolveTaxRate(taxSettings, taxSettings.origin ?? {})
      if (rate && !taxSettings.pricesIncludeTax) {
        taxCents = CommerceModel.computeTaxCents(amountCents, rate.pct)
        taxLabel = rate.label || `Tax (${rate.pct}%)`
      }
    }

    // Shipping (AGL-1720), from the same settings document tax was just read
    // from. Buy-now declared neither `shipping_address_collection` nor
    // `shipping_options`, so a merchant who configured zones and rates in the
    // console collected them on cart orders (AGL-1707) and nothing at all on
    // buy-now — same merchant, same product, two totals depending on which
    // button the shopper pressed.
    //
    // CONDITIONAL, unlike the cart's, on two things the cart cannot know:
    //
    //   - PHYSICAL PRODUCTS ONLY. This is the PDP path for one product, and it
    //     sells digital downloads and services too. Asking a shopper buying a
    //     PDF for a shipping address, then charging them to ship it, would be
    //     a worse bug than the one being fixed. A missing `type` reads as
    //     physical, exactly as the fee ladder above already reads it —
    //     `liftLegacyProduct` only defaults the field on docs it synthesizes
    //     variants for, so a part-migrated doc can reach here without one, and
    //     the two reads must not disagree about what that doc is.
    //   - ONE-TIME SALES ONLY. Originally because the webhook's
    //     `commerce-subscription` branch never touched `total_details`, so
    //     shipping charged there would have been real money recorded NOWHERE.
    //     AGL-1732 closed that half — the initial charge now decomposes onto
    //     the subscription document, `amount_shipping` included — but the
    //     exclusion stands on the reason that outlived it: RENEWALS are still
    //     recorded nowhere (`invoice.payment_succeeded` is unhandled), and a
    //     rate editor written for one-time orders does not ask the merchant
    //     whether a rate should be re-charged every cycle. Both are product
    //     decisions, not wiring.
    //
    // Weight is per unit TIMES the quantity bought. `weightGrams` alone would
    // quote the lightest tier on a multi-unit order — the same under-collection
    // this issue is about, and adjacent to the hardcoded `quantity: 1` that
    // AGL-1711 just removed from this function.
    //
    // The subtotal fed to the resolver is the PRE-discount list total, matching
    // the cart's, so "free over $50" means what the shopper saw it mean.
    const shippingSettings = storeSettings.get('shipping') as
      | CommerceModel.ShippingSettings
      | undefined
    const shippingOptions =
      (lifted.type ?? 'physical') === 'physical' && !isSubscription
        ? CommerceModel.resolveCheckoutShippingOptions(
            shippingSettings,
            CommerceModel.CHECKOUT_SHIPPING_COUNTRIES,
            {
              subtotalCents: listUnitAmountCents * quantity,
              totalGrams:
                Math.max(0, Number(variant.weightGrams ?? 0)) * quantity,
            },
          )
        : []

    // The unit price Stripe actually charges — the coupon is priced INTO it
    // rather than sent as a Stripe discount, which is why `amount_discount` is
    // 0 on every buy-now session and the discount has to ride the metadata
    // (AGL-1711). Hoisted so the Stripe param and the metadata cannot drift.
    const chargedUnitAmountCents = Math.round(amountCents / quantity)
    const discountCents = Math.max(
      0,
      listUnitAmountCents * quantity - chargedUnitAmountCents * quantity,
    )

    // Subscriptions (AGL-303): recurring prices bill on the platform with
    // a destination transfer + percent fee; the webhook records the sub.
    // `isSubscription` resolved above (AGL-545).
    const params = new URLSearchParams({
      mode: isSubscription ? 'subscription' : 'payment',
      'line_items[0][quantity]': String(quantity),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(chargedUnitAmountCents),
      'line_items[0][price_data][product_data][name]': String(
        product.name ?? 'Product',
      ).slice(0, 120),
      ...(isSubscription
        ? {
            'line_items[0][price_data][recurring][interval]':
              lifted.subscription!.interval,
            ...(lifted.subscription!.trialDays
              ? {
                  'subscription_data[trial_period_days]': String(
                    lifted.subscription!.trialDays,
                  ),
                }
              : {}),
            'subscription_data[transfer_data][destination]':
              String(accountId),
            ...(feePct > 0
              ? {
                  'subscription_data[application_fee_percent]':
                    String(feePct),
                }
              : {}),
            'subscription_data[metadata][type]': 'commerce-subscription',
            'subscription_data[metadata][hostId]': hostId,
            'subscription_data[metadata][productId]': productId,
          }
        : {}),
      ...(taxCents > 0
        ? {
            'line_items[1][quantity]': '1',
            'line_items[1][price_data][currency]': 'usd',
            'line_items[1][price_data][unit_amount]': String(taxCents),
            'line_items[1][price_data][product_data][name]': taxLabel.slice(
              0,
              120,
            ),
          }
        : {}),
      ...(useStripeTax ? { 'automatic_tax[enabled]': 'true' } : {}),
      // Stripe rejects a zero application fee — omit it on 0% plans.
      ...(!isSubscription && feeCents > 0
        ? { 'payment_intent_data[application_fee_amount]': String(feeCents) }
        : {}),
      ...(!isSubscription
        ? {
            'payment_intent_data[transfer_data][destination]':
              String(accountId),
          }
        : {}),
      // Substituted by Stripe on redirect — see the note in `cart-checkout.ts`
      // (AGL-1641). The single-product path returns the shopper to the product
      // page, so the `purchase` is reported by the PDP rather than the cart.
      success_url: `${backUrl}${separator}order=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${backUrl}${separator}order=canceled`,
      'metadata[type]': isSubscription
        ? 'commerce-subscription'
        : 'commerce-order',
      'metadata[hostId]': hostId,
      'metadata[productId]': productId,
      ...(variantId ? { 'metadata[variantId]': variantId } : {}),
      'metadata[quantity]': String(quantity),
      'metadata[feeCents]': String(feeCents),
      // The order's decomposition, snapshotted as we compute it (AGL-1711).
      // Two of these three are invisible to Stripe's own `total_details` BY
      // OUR OWN CONSTRUCTION — the manual tax goes over as an ordinary
      // `line_items[1]` product line, and the coupon is priced into
      // `line_items[0]`'s unit amount — so the webhook cannot recover them
      // from the session. Frozen here rather than re-derived from the product
      // doc at webhook time, which a price edit in between would falsify.
      'metadata[unitAmountCents]': String(listUnitAmountCents),
      'metadata[taxCents]': String(taxCents),
      'metadata[discountCents]': String(discountCents),
      ...(appliedCoupon ? { 'metadata[couponCode]': appliedCoupon } : {}),
    })
    // Both keys or neither (AGL-1720). Stripe will not apply a shipping rate
    // without an address to ship to, and a merchant who configured nothing
    // resolves to no options and so gets neither key — a session byte-identical
    // to the one this handler built before shipping existed on it. Buy-now has
    // never collected an address, so declaring one unconditionally would put a
    // shipping form in front of every shopper on a store that charges none.
    if (shippingOptions.length > 0) {
      CommerceModel.appendShippingAddressCollectionParams(params)
      CommerceModel.appendCheckoutShippingParams(params, shippingOptions)
    }
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
