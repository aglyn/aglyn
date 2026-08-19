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
import { claimAttempt, deriveStripeObjectKey } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveManualTaxRateId } from './manual-tax-rate'
import {
  applyNativeCheckoutParams,
  nativeCheckoutStripeHeaders,
  readCheckoutSessionPayload,
  resolveNativeCheckoutMode,
} from './native-checkout'

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
  // One buy-now attempt, minted by the product page (AGL-1697). Node
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
    //
    // DELIBERATELY UNCHANGED for subscription sessions. For a PHYSICAL
    // subscription the gate is honest again since AGL-1750: every paid cycle
    // mints an order and decrements the variant (the webhook's invoice
    // branch), so the number this checks now moves as boxes ship. For a
    // digital or service subscription nothing decrements, and the console
    // withdraws the field there (`stockTrackingApplies`, AGL-1744) rather
    // than skipping this gate — it is the one shared by every purchase path,
    // and skipping it for subscription mode would silently RESUME selling
    // for any merchant who set 0 to stop new subscribers.
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
      // Stripe's charge minimum is 50¢ — never discount below it. The
      // percentage comes off the ORDER total, matching `cart-checkout.ts`'s
      // `Math.round(itemsCents * percentOff / 100)`, so the same code takes
      // the same money whichever button the shopper pressed. What the SESSION
      // is built from this figure is where the two used to diverge — see the
      // line-item construction below (AGL-2159).
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
    // AGL-1999: an unset tax mode is NOT a decision, and it must not sell.
    // `mode` was `undefined` for every store whose owner never opened the
    // Taxes card — the default state of every new storefront — and each
    // branch below tested for a specific string, so no branch was taken, no
    // tax was computed, and the shopper was charged an untaxed total. See
    // `commerce-tax-decision.ts` for why refusing beats defaulting to either
    // mode. `mode: 'none'` is the explicit opt-out and passes straight
    // through.
    const taxDecision = CommerceModel.storefrontTaxDecision({
      settings: taxSettings,
      taxExempt: lifted.taxExempt,
    })
    if (taxDecision.kind === 'undecided') {
      // Above the attempt claim, like every other deterministic refusal on
      // this path — there is no claim to release yet.
      return res
        .status(409)
        .json({ error: CommerceModel.STOREFRONT_TAX_UNDECIDED_MESSAGE })
    }
    const taxMisconfigured =
      CommerceModel.storefrontTaxMisconfiguration(taxSettings)
    if (taxMisconfigured) {
      // AGL-2145: the merchant DECIDED to collect and the sale would have
      // charged zero anyway — an unfinished settings card, not a
      // jurisdiction miss. Refused in the same words and the same place as
      // the undecided case above.
      return res.status(409).json({ error: taxMisconfigured })
    }
    const useStripeTax = taxDecision.kind === 'stripe-automatic'
    let taxCents = 0
    let taxLabel = ''
    let taxPct = 0
    if (taxSettings.mode === 'manual' && !lifted.taxExempt) {
      const rate = CommerceModel.resolveTaxRate(taxSettings, taxSettings.origin ?? {})
      if (rate && !taxSettings.pricesIncludeTax) {
        taxCents = CommerceModel.computeTaxCents(amountCents, rate.pct)
        taxLabel = rate.label || `Tax (${rate.pct}%)`
        taxPct = rate.pct
      }
    }

    // Recurring manual tax (AGL-1751). The manual tax cannot ride the
    // `line_items[1]` product line on a SUBSCRIPTION session: a non-recurring
    // price in `mode: subscription` is a one-time item, and Stripe bills
    // one-time items on the FIRST invoice only — so the merchant's tax was
    // collected once and then, on every renewal the buyer had been shown a
    // taxed price for, never again. A Stripe Tax Rate attached to the
    // subscription line recurs: Checkout carries `line_items[][tax_rates]`
    // onto the subscription item, every invoice applies it, and the figure
    // lands where the records already look — the session's
    // `total_details.amount_tax` for the sale (AGL-1732) and the invoice's
    // own tax fields for each renewal (AGL-1743). No webhook change.
    //
    // The rate is created on the PLATFORM account — no Stripe-Account header,
    // matching the session call below — because that is where the
    // subscription lives (destination transfer); a connected-account rate id
    // would not resolve. Tax rates are immutable, so one is minted per
    // (percentage, label) and cached under the host; a merchant editing their
    // zone rate misses the cache and mints a fresh object, while the old one
    // stays behind on the subscriptions that already carry it, exactly as it
    // should.
    //
    // A creation failure is a VISIBLE 502, never a fallback: the one-time
    // line is this very bug, and a session with no tax at all would
    // under-collect every invoice silently.
    // Point of no return (AGL-1697): everything past here creates Stripe
    // objects — possibly a Tax Rate, then the session. Server-side a retry
    // looked free, but for `mode: subscription` two completed sessions are
    // two RECURRING subscriptions for the same member and product. The
    // shipping refusals BELOW this line release the claim: they are
    // deterministic asks the shopper answers and retries under the same key,
    // and the released key re-derives the same digests so Stripe replays the
    // tax rate rather than minting a twin (AGL-1714's rule).
    const claimed = await claimAttempt(firestore, {
      kind: 'commerce-checkout',
      scopeId: hostId,
      orgId: String(ownerOrg?.org?.id ?? ''),
      key: idempotencyKey,
      busyMessage: 'This checkout is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim
    // Derived per OBJECT, never the raw digest (AGL-1714): Stripe
    // parameter-compares a repeated key account-wide, so one digest sent to
    // `/v1/tax_rates` and then `checkout/sessions` would error the second.
    const stripeKeyHeader = (object: string): Record<string, string> => {
      const derived = deriveStripeObjectKey(claimed.claim.stripeKey, object)
      return derived ? { 'Idempotency-Key': derived } : {}
    }

    // Minting and caching now live in `manual-tax-rate.ts` (AGL-1953), which
    // the cart path needs too — two copies of a money-shaped cache is how two
    // paths quietly diverge. Behaviour here is unchanged.
    let recurringTaxRateId = ''
    if (isSubscription && taxCents > 0) {
      recurringTaxRateId =
        (await resolveManualTaxRateId({
          hostRef,
          taxPct,
          taxLabel,
          headers: stripeKeyHeader('tax-rate'),
        })) ?? ''
      if (!recurringTaxRateId) {
        // Nothing was sold — hand the key back so the same button works
        // once Stripe does (AGL-1697).
        await claim.release()
        return res.status(502).json({ error: 'Checkout failed' })
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
    //     Both halves of that are now closed: AGL-1732 decomposed the initial
    //     charge onto the subscription document, `amount_shipping` included,
    //     and AGL-1743 records every renewal invoice — `shipping_cost` read
    //     the same way — so a recurring shipping charge would now land.
    //
    //     What remains is the PRODUCT question, and only it: a rate editor
    //     written for one-time orders never asks the merchant whether a rate
    //     should be re-charged every cycle, and Stripe bills a subscription's
    //     one-time line items on the FIRST invoice only, so a shipping rate
    //     added as a session line item would be charged once and then silently
    //     stop. Answering that is AGL-1720's revisit, not wiring.
    //
    // Weight is per unit TIMES the quantity bought. `weightGrams` alone would
    // quote the lightest tier on a multi-unit order — the same under-collection
    // this issue is about, and adjacent to the hardcoded `quantity: 1` that
    // AGL-1711 just removed from this function.
    //
    // The subtotal fed to the resolver is the PRE-discount list total, matching
    // the cart's, so "free over $50" means what the shopper saw it mean.
    //
    // WHICH DESTINATIONS the session may serve is decided with the rates and
    // not after them (AGL-1721): a session that declared every zone's rates
    // while accepting an address in any country let a shopper pick a domestic
    // rate for an international parcel, and Stripe re-checks nothing — a
    // `shipping_rate_data` carries no country. `planCheckoutShipping` pairs
    // the two lists, and refuses rather than guessing.
    const shippingSettings = storeSettings.get('shipping') as
      | CommerceModel.ShippingSettings
      | undefined
    const shipsPhysically =
      (lifted.type ?? 'physical') === 'physical' && !isSubscription
    const shippingPlan = shipsPhysically
      ? CommerceModel.planCheckoutShipping(
          shippingSettings,
          {
            subtotalCents: listUnitAmountCents * quantity,
            totalGrams:
              Math.max(0, Number(variant.weightGrams ?? 0)) * quantity,
          },
          body.shippingCountry,
        )
      : { countries: CommerceModel.CHECKOUT_SHIPPING_COUNTRIES, options: [] }
    if (shippingPlan.refusal === 'destination-required') {
      // A deterministic ask the shopper answers and retries under the same
      // key — released, not burned (AGL-1697). The tax rate possibly minted
      // above replays from its cache (or its derived key) on the retry.
      await claim.release()
      return res.status(400).json({
        error: 'Choose where you’re shipping to.',
        needsShippingCountry: true,
        shippingCountries: [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
      })
    }
    if (shippingPlan.refusal === 'destination-unserved') {
      const declared = CommerceModel.normalizeCheckoutShippingCountry(
        body.shippingCountry,
      )
      await claim.release()
      return res.status(409).json({
        error: `This store does not ship to ${
          CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[declared as string] ??
          'that country'
        }.`,
        needsShippingCountry: true,
        shippingCountries: [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
      })
    }

    // The unit price Stripe actually charges — the coupon is priced INTO it
    // rather than sent as a Stripe discount, which is why `amount_discount` is
    // 0 on every buy-now session and the discount has to ride the metadata
    // (AGL-1711). Hoisted so the Stripe param and the metadata cannot drift.
    // THE SESSION CHARGES `amountCents`, EXACTLY (AGL-2159).
    //
    // A Stripe line is `quantity` units at ONE integer `unit_amount`, so it can
    // only express totals divisible by `quantity` — and a percentage coupon
    // does not respect that. This used to be
    // `Math.round(amountCents / quantity)` multiplied back by `quantity`, which
    // missed `amountCents` by up to `quantity / 2` cents in either direction:
    // the shopper was charged something the storefront never quoted, and the
    // fee and the manual tax were computed on a base nothing collected.
    // Rounding UP was worse still — `discountCents` below is
    // `list - charged` under a `Math.max(0, …)`, so a charge that met or passed
    // the list price clamped it to ZERO and the order recorded no discount on a
    // sale the shopper had applied a coupon to. On a 99-unit order of a 50¢
    // item with 1% off that is not a cent of drift: the shopper paid the full
    // $49.50 and the promotion vanished from the merchant's own record.
    //
    // So when the total does not divide evenly, the line becomes ONE unit at
    // the exact total, with the count moved into the display name. The
    // shopper's real quantity was never carried by this field anyway —
    // `metadata[quantity]` is what `computeBuyNowOrder` builds the order's line
    // item from, and it is untouched — so nothing downstream can tell the
    // difference except that the arithmetic now closes.
    //
    // The even case (every sale with no coupon, and most with one) keeps the
    // per-unit shape byte for byte, so the ordinary Stripe checkout page is
    // unchanged.
    const evenUnitAmountCents = Math.floor(amountCents / quantity)
    const remainderCents = amountCents - evenUnitAmountCents * quantity
    const chargedQuantity = remainderCents === 0 ? quantity : 1
    const chargedUnitAmountCents =
      remainderCents === 0 ? evenUnitAmountCents : amountCents
    const chargedLineName = `${String(product.name ?? 'Product')}${
      remainderCents === 0 ? '' : ` × ${quantity}`
    }`.slice(0, 120)
    // What was ACTUALLY discounted, now that the charge and `amountCents` are
    // the same number. `Math.max(0, …)` stays as a guard against a future floor
    // lifting the charge above list; it no longer erases a real discount,
    // because there is no longer a rounding that can push the charge past it.
    const discountCents = Math.max(
      0,
      listUnitAmountCents * quantity - amountCents,
    )

    // Subscriptions (AGL-303): recurring prices bill on the platform with
    // a destination transfer + percent fee; the webhook records the sub.
    // `isSubscription` resolved above (AGL-545).
    const params = new URLSearchParams({
      mode: isSubscription ? 'subscription' : 'payment',
      'line_items[0][quantity]': String(chargedQuantity),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(chargedUnitAmountCents),
      'line_items[0][price_data][product_data][name]': chargedLineName,
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
      // One-time sales keep the AGL-1711 construction — an ordinary product
      // line Stripe is never told is tax; subscriptions get the recurring
      // tax rate resolved above instead (AGL-1751). Never both: the rate
      // would tax the opening invoice a second time on top of the line.
      ...(taxCents > 0 && !isSubscription
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
      ...(recurringTaxRateId
        ? { 'line_items[0][tax_rates][0]': recurringTaxRateId }
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
      //
      // EXCEPT the tax on a subscription (AGL-1751): there it is a real tax
      // rate, `amount_tax` carries it, and this snapshot must say 0 —
      // `computeBuyNowOrder` SUMS the metadata figure with Stripe's, on the
      // documented ground that the two are mutually exclusive, so carrying
      // both would double-count the tax on the recorded sale.
      'metadata[unitAmountCents]': String(listUnitAmountCents),
      'metadata[taxCents]': String(isSubscription ? 0 : taxCents),
      'metadata[discountCents]': String(discountCents),
      ...(appliedCoupon ? { 'metadata[couponCode]': appliedCoupon } : {}),
    })
    // Both keys or neither (AGL-1720). Stripe will not apply a shipping rate
    // without an address to ship to, and a merchant who configured nothing
    // resolves to no options and so gets neither key — a session byte-identical
    // to the one this handler built before shipping existed on it. Buy-now has
    // never collected an address, so declaring one unconditionally would put a
    // shipping form in front of every shopper on a store that charges none.
    if (shippingPlan.options.length > 0) {
      CommerceModel.appendShippingAddressCollectionParams(
        params,
        shippingPlan.countries,
      )
      CommerceModel.appendCheckoutShippingParams(params, shippingPlan.options)
    }
    // The Payment Element (AGL-1944), and the LAST thing done to the params on
    // purpose. Everything above — price, coupon, tax, shipping, the Connect
    // destination, the fee, every metadata key the webhook reads — is computed
    // identically for both checkout paths, and this rewrite touches none of it:
    // it swaps the redirect's URL pair for `ui_mode` + `return_url` and stops.
    // A native session that priced differently from the hosted one would be the
    // under-collection AGL-1944 warns about, and the only defence that actually
    // holds is that there is nowhere for the two to diverge.
    //
    // Off unless the flag is on for this org AND a publishable key exists, so
    // the default remains the redirect — see `resolveNativeCheckoutMode`.
    const nativeMode = await resolveNativeCheckoutMode(
      String(ownerOrg?.org?.id ?? ''),
    )
    if (nativeMode.native) {
      applyNativeCheckoutParams(
        params,
        `${backUrl}${separator}order=success&session_id={CHECKOUT_SESSION_ID}`,
      )
    }
    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // The half that costs real money (AGL-1697): Stripe replays the
          // existing session for a repeated key instead of opening a second
          // one — for subscription mode, instead of a second RECURRING
          // subscription — covering the window where the claim is written
          // but the response never arrives.
          ...stripeKeyHeader('session'),
          // Empty on the hosted path, so its request is byte-identical to the
          // one this handler sent before AGL-1944 (AGL-1944).
          ...nativeCheckoutStripeHeaders(nativeMode),
        },
        body: params.toString(),
      },
    )
    const session = (await response.json()) as {
      url?: string
      id?: string
      client_secret?: string
      error?: any
    }
    // `!session.url` was the liveness check, and a `ui_mode` session HAS no
    // url — so the check moves with the mode rather than staying behind and
    // reading every successful native session as a Stripe failure (AGL-1944).
    const payload = response.ok
      ? readCheckoutSessionPayload(session, nativeMode)
      : null
    if (!payload) {
      console.error('Stripe checkout error', session.error)
      // Nothing was sold — hand the key back so one flaky moment does not
      // lock this product out for the shopper.
      await claim.release()
      return res.status(502).json({ error: 'Checkout failed' })
    }
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule).
    await claim?.release()
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
