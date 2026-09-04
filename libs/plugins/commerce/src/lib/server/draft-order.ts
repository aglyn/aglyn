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
import { connectLinkageIsReady } from '@aglyn/tenant-data-admin/server/stripe-account-mode'
import { resolveManualTaxRateId } from './manual-tax-rate'
import {
  type PromotionSlotHold,
  holdPromotionSlot,
  promotionHoldKey,
} from './promotion-hold'
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
  // A code the MERCHANT types while composing the order (AGL-305). The
  // storefront doors read this same field name, so one resolver answers it the
  // same way whoever pressed the button.
  const couponCode = String(body.couponCode ?? '').trim()
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
  /**
   * The redemption slot this attempt reserved (AGL-305), hoisted so every
   * refusal below the claim — and the catch — can hand it back. A throw after
   * the hold is placed is exactly the case where a slot would otherwise stand
   * invisibly against the merchant's cap until its TTL lapsed, and this path
   * rolls its order document back on two of those refusals already.
   */
  let discountSlot: PromotionSlotHold | null = null
  let discountHoldKey = ''
  const releaseDiscountSlot = async (): Promise<void> => {
    const slot = discountSlot
    discountSlot = null
    discountHoldKey = ''
    if (slot) await slot.release()
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    // AN ALLOWLIST (AGL-2262), matching `cancel-order.ts`, `fulfill-order.ts`
    // and the Firestore rules, whose host-write predicate is
    // `hostMemberRole(hostId) in ['admin','editor']`. The old
    // `!role || role === 'viewer'` denylist caught the stranger but admitted
    // every OTHER string — a legacy value, a typo, any role added later — on
    // the one route that mints a live Stripe payment link. `HostAccessRole`
    // has since grown an `author` (AGL-2334), which this allowlist refuses on
    // purpose — an author edits content and does not mint payment links — and
    // which the old denylist would have admitted. That is the allowlist form
    // earning its keep on a union that changed under it.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
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
    // Plan gate, re-asked per request exactly as the storefront checkout
    // asks it (AGL-1873, the AGL-481 pattern): a free or lapsed org must not
    // keep minting payment links — at the free plan's 0% transaction fee —
    // through the one commerce door that skipped the entitlement. Sits
    // ABOVE the attempt claim with the other deterministic refusals, so it
    // never burns the merchant's idempotency key.
    if (!Aglyn.checkEntitlement(ownerOrg?.org as any, 'commerce')) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }
    const ownerId = ownerOrg?.org?.ownerUid
    const ownerProfile = ownerId
      ? await firestore.collection('profiles').doc(String(ownerId)).get()
      : null
    const accountId = ownerProfile?.get('stripeAccountId')
    if (
      !connectLinkageIsReady(
        {
          accountId,
          chargesEnabled: ownerProfile?.get('stripeChargesEnabled'),
          accountLivemode: ownerProfile?.get('stripeAccountLivemode'),
        },
        { subject: `draft order host ${hostId}` },
      )
    ) {
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

    // WHAT THE COUNT SAYS, said out loud (AGL-2452).
    //
    // This handler contained no `canPurchase` and no `stockShortfall` — no
    // reference to inventory of any kind. It is the door that mints a LIVE,
    // payable Stripe link, and it would mint one for a sold-out variant whose
    // merchant had chosen `oversellPolicy: 'deny'`, with the `commerce-draft`
    // webhook branch then completing it into a `paid` order. `pos-order.ts`'s
    // own comment asserts "every storefront door gates on it"; that claim was
    // false for this one.
    //
    // WARN, NEVER BLOCK, matching the register (AGL-2357, the decision).
    // Both of these are MERCHANT-initiated doors rather than shopper-initiated
    // ones — the merchant may well be taking a deliberate pre-order or
    // backorder — so a stale count must not refuse a sale the merchant means to
    // make. What the merchant is entitled to is to be TOLD, which is the part
    // that was missing entirely. The refusal variant is a separate decision and
    // is not taken here.
    //
    // Computed from the SERVER's product document, and reported on the same
    // `stockWarnings` key and in the same `StockShortfall` shape the register
    // already returns, so one console surface can read either door.
    const shortfall = CommerceModel.stockShortfall(
      product,
      variantId || product.variants[0]?.id,
      quantity,
    )
    const stockWarnings: CommerceModel.StockShortfall[] = shortfall
      ? [
          {
            productId,
            ...(variantId ? { variantId } : {}),
            name: product.name,
            requested: quantity,
            available: shortfall.available,
          },
        ]
      : []

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
    const itemsCents = unitAmountCents * quantity
    // THE DISCOUNTS HUB, ON THIS PATH TOO (AGL-305).
    //
    // `hosts/{hostId}/discounts` reached the cart and buy-now and stopped
    // there, so a store running "Summer sale, 10% off" sold at 10% off through
    // both storefront doors and at FULL price the moment the merchant invoiced
    // the same buyer for the same goods through a payment link. No code has to
    // be typed for that gap to open: an automatic promotion applies itself on
    // the storefront and applied itself nowhere here, so the merchant's own
    // payment link quietly undercut — and here overcharged against — their own
    // advertised price.
    //
    // Resolved through the SAME `resolveDiscount` the other doors use, so one
    // code cannot mean two amounts.
    //
    // RESOLVED BEFORE THE TAX BLOCK BELOW, and that ordering is the whole
    // point rather than a convenience: the manual rate is computed against
    // `chargedItemsCents`, so the discount lands BEFORE tax and the taxable
    // base is the discounted one. It has to be — the session applies that same
    // rate as `line_items[0][tax_rates][0]`, which Stripe evaluates against the
    // line amount it actually charges. Reducing the line while taxing the list
    // price would make our stored `taxCents` disagree with the tax Stripe
    // collects, on every discounted draft.
    const draftDiscountLines = [{ productId, amountCents: itemsCents }]
    const hubDiscounts = await hostRef.collection('discounts').limit(100).get()
    const resolvedDiscount = CommerceModel.resolveDiscount(
      hubDiscounts.docs.map((docSnapshot) => ({
        ...(docSnapshot.data() as CommerceModel.HostDiscount),
        $id: docSnapshot.id,
      })),
      {
        ...(couponCode ? { code: couponCode } : {}),
        subtotalCents: itemsCents,
        productIds: [productId],
        lines: draftDiscountLines,
      },
    )
    // Above the claim and above the order write with every other deterministic
    // refusal, so a merchant who fixes the code and presses Send again strands
    // no `pending` draft and burns no key. A code that RESOLVES but confers
    // nothing leaves through here too — `codeProblem` carries the benefit's own
    // reason — which is what stops this door repeating the defect that charged
    // full shipping on a free-shipping code.
    if (resolvedDiscount?.codeProblem) {
      return res.status(400).json({ error: resolvedDiscount.codeProblem })
    }
    const appliedDiscountId =
      resolvedDiscount && resolvedDiscount.benefit.kind !== 'none'
        ? resolvedDiscount.discountId
        : ''
    const discountCents = appliedDiscountId ? resolvedDiscount!.discountCents : 0
    // Stripe's charge minimum is 50¢ — never price a payment link below it,
    // the same floor buy-now applies.
    const chargedItemsCents = discountCents
      ? Math.max(50, itemsCents - discountCents)
      : itemsCents
    // What was ACTUALLY taken off, after that floor. The stored totals record
    // this rather than the resolver's figure, so the parts sum to the total on
    // a draft the floor moved.
    const appliedDiscountCents = itemsCents - chargedItemsCents
    // The fee and `totals` are both built BELOW the shipping plan (AGL-2152):
    // Stripe's card cost rides the whole payment-link total, so neither can be
    // known until the tax (AGL-1953) and the shipping options are.

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

    // Taxes (AGL-1953), from the same settings document. This handler had no
    // tax code at all in either mode, so a merchant who invoiced a buyer for
    // the same product they sell on the storefront charged them no tax — the
    // cart's defect, one door over, and worse here because the merchant
    // composed this order deliberately and would reasonably assume it matched
    // their store.
    //
    // Origin-based, exactly as buy-now and the cart resolve it. The AGL-1792
    // note above already established the premise: this dialog collects a
    // product, a variant, a quantity and an email, so the DESTINATION is as
    // unknown here as it is in the cart.
    //
    // Computed pure and BEFORE the claim so the stored totals can carry it;
    // the Stripe object it needs is minted below the point of no return.
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
      taxExempt: product.taxExempt,
    })
    if (taxDecision.kind === 'undecided') {
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
    const manualRate =
      taxDecision.kind === 'manual' &&
      !taxSettings.pricesIncludeTax
        ? CommerceModel.resolveTaxRate(taxSettings, taxSettings.origin ?? {})
        : null
    // THE DISCOUNTED BASE (AGL-305). `chargedItemsCents` is what the line
    // will actually be worth, and the session applies this same rate to that
    // line as a Stripe Tax Rate — so taxing `itemsCents` here would record a
    // figure Stripe never charges.
    const taxCents = manualRate
      ? CommerceModel.computeTaxCents(chargedItemsCents, manualRate.pct)
      : 0
    // Stripe Tax mode leaves this 0 at composition time and the webhook folds
    // the computed figure in — the same additive shape AGL-1792 used for
    // shipping, and for the same reason: only Stripe knows it.
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
    // No rate of the merchant's reaches this order (AGL-2232). Above the
    // order write and the payment link, like every other refusal here, so a
    // manager who fixes the tier table and presses Send again strands nothing.
    if (shippingPlan.refusal === 'cart-unpriceable') {
      return res
        .status(409)
        .json({ error: CommerceModel.CART_UNPRICEABLE_SHIPPING_MESSAGE })
    }
    // FREE SHIPPING IS A ZEROED RATE, NOT A REDUCTION (AGL-305), the same
    // construction the cart uses and for the same reason: nothing has picked a
    // rate yet, so there is no amount to take off. The buyer chooses after the
    // link is minted, so the only exact answer is to offer every rate at zero.
    //
    // Every rate rather than the cheapest, because `free_shipping` carries no
    // field naming one — and zeroing them all keeps the fee, the transfer floor
    // and the ceiling below honest, since all three read these same options.
    //
    // Derived from `shippingPlan.options` and read EVERYWHERE below in its
    // place; a reader that reached past this to `shippingPlan.options` would
    // price carriage the buyer is not being charged for.
    const shippingOptions =
      resolvedDiscount?.freeShipping === true
        ? shippingPlan.options.map((option) => ({ ...option, amountCents: 0 }))
        : shippingPlan.options

    // THE PLATFORM FEE (AGL-2152) — the advertised take PLUS Stripe's card
    // cost, passed through at cost. A payment link is a destination charge, so
    // Stripe debits 2.9% + 30¢ from the PLATFORM's balance; the old take-only
    // figure meant every tier carrying a 0% rate invoiced a buyer at a loss to
    // Aglyn, and Starter's 2% is below 2.9% so it lost money at every size too.
    //
    // `?? 'physical'` (AGL-2251), matching `checkout.ts` and the cart. Without
    // it a product doc carrying no `type` fell to `resolveTransactionFeePct`'s
    // digital branch, so a merchant's payment link took a different cut of the
    // same product than their storefront did.
    //
    // The base is the whole card total: the goods, the manual tax line, and the DEAREST shipping
    // option the link offers (the buyer picks after the link is minted and
    // `application_fee_amount` is fixed at creation, so reaching for the
    // cheapest would put the difference back on Aglyn). A store on Stripe Tax
    // is the one residual — that tax is computed inside Stripe afterwards.
    const shippingCeilingCents = shippingOptions.reduce(
      (most, option) =>
        Math.max(most, Math.max(0, Number(option.amountCents ?? 0))),
      0,
    )
    // Both bases are the DISCOUNTED goods (AGL-305). The platform take is a
    // cut of what the merchant actually sells for, and Stripe's card cost is
    // passed through on what the card actually runs for — reading `itemsCents`
    // here would invoice the merchant a fee on money nobody paid.
    const feeCents = Aglyn.resolveTransactionFeeCents(
      ownerOrg?.org as any,
      product.type ?? 'physical',
      chargedItemsCents,
      chargedItemsCents + taxCents + shippingCeilingCents,
    )
    // Stripe Tax mode leaves the tax 0 at composition time and the webhook
    // folds the computed figure in — the same additive shape AGL-1792 used for
    // shipping, and for the same reason: only Stripe knows it.
    const totals = CommerceModel.computeOrderTotals(lineItems, {
      feeCents,
      taxCents,
      // The line item still carries the LIST price, so the discount has to be
      // a named part of the totals or `itemsCents - discountCents + tax` would
      // not be the number on the payment link.
      discountCents: appliedDiscountCents,
    })

    // THE LINK CHARGES `chargedItemsCents`, EXACTLY (the AGL-2159 construction,
    // reused here because this path grew the same problem the moment it grew a
    // discount).
    //
    // A Stripe line is `quantity` units at ONE integer `unit_amount`, so it can
    // only express totals divisible by `quantity` — and a percentage discount
    // does not respect that. Dividing and multiplying back misses the intended
    // total by up to `quantity / 2` cents in either direction, which on this
    // path is worse than on buy-now: the frozen `totals` above are written to
    // the order document BEFORE the session is minted, so a link that charged
    // a different number would leave the merchant's own books disagreeing with
    // what their buyer paid, permanently and silently.
    //
    // So when the total does not divide evenly, the line becomes ONE unit at
    // the exact total with the count moved into the display name. The real
    // quantity is carried by the order document's line item, which is
    // untouched, so nothing downstream can tell the difference.
    //
    // The even case — every undiscounted draft, and most discounted ones —
    // keeps the per-unit shape byte for byte.
    const evenUnitAmountCents = Math.floor(chargedItemsCents / quantity)
    const remainderCents = chargedItemsCents - evenUnitAmountCents * quantity
    const chargedQuantity = remainderCents === 0 ? quantity : 1
    const chargedUnitAmountCents =
      remainderCents === 0 ? evenUnitAmountCents : chargedItemsCents
    const chargedLineName = `${product.name}${
      remainderCents === 0 ? '' : ` × ${quantity}`
    }`.slice(0, 120)

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

    // THE REDEMPTION SLOT IS RESERVED HERE (AGL-305), on the same terms the
    // storefront doors reserve it.
    //
    // A payment link lives until the buyer pays it, so between this handler and
    // the `commerce-draft` webhook branch that settles the slot there is a
    // window measured in days — far wider than a Checkout Session's. Reading
    // `redemptions` and hoping would let a merchant mint ten links against a
    // cap of one and have all ten pay.
    //
    // BELOW the claim because the hold is keyed by the attempt: a retry of one
    // attempt must be able to re-claim the slot it already holds rather than be
    // refused by it. An uncapped promotion writes nothing and returns an empty
    // `holdKey`, which is what tells the webhook to fall back to the plain
    // increment.
    if (appliedDiscountId) {
      const slot = await holdPromotionSlot({
        firestore,
        ref: hostRef.collection('discounts').doc(appliedDiscountId),
        holdKey: promotionHoldKey(claimed.claim.stripeKey),
        label: `draft discount ${appliedDiscountId}`,
      })
      if (!slot.ok) {
        // Refused rather than quietly repriced, and that is deliberate for the
        // AUTOMATIC case too: the merchant composed this order at a price the
        // promotion was part of, and minting the link at full price would
        // invoice their buyer more than the store advertises without saying so.
        // Nothing has been written yet, so the key goes back and the retry
        // prices correctly — `resolveDiscount` counts live holds and simply
        // stops offering an exhausted promotion.
        await claim.release()
        return res.status(409).json({
          error:
            couponCode && resolvedDiscount?.discount.code
              ? CommerceModel.PROMOTION_EXHAUSTED_MESSAGE
              : CommerceModel.PROMOTION_UNAVAILABLE_MESSAGE,
        })
      }
      if (slot.holdKey) {
        discountSlot = slot
        discountHoldKey = slot.holdKey
      }
    }

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
        // WHICH TAX REGIME THIS ORDER IS COMPOSED UNDER (AGL-2451), from the
        // decision taken above rather than from the frozen `taxCents` — a
        // Stripe Tax draft freezes 0 there and only the paid session knows the
        // figure, so a mode read back off the amount would call it `none`.
        //
        // Stamped at composition so a draft that is never paid still says what
        // it was priced under, and RESTATED by the `commerce-draft` webhook
        // branch from the session that actually charged it. The webhook's is
        // authoritative — it has Stripe's computed tax in hand — and for a
        // manual draft the two agree by construction.
        taxMode: CommerceModel.storefrontTaxModeForDecision(
          taxDecision,
          taxCents,
        ),
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

    // The tax rate is minted here, BELOW the claim, because it creates a real
    // Stripe object (AGL-1953). Cached per host, so it is usually a read.
    let draftTaxRateId = ''
    if (taxCents > 0 && manualRate) {
      draftTaxRateId =
        (await resolveManualTaxRateId({
          hostRef,
          taxPct: manualRate.pct,
          taxLabel: manualRate.label || `Tax (${manualRate.pct}%)`,
          ...(claim.stripeKey
            ? { headers: { 'Idempotency-Key': `${claim.stripeKey}-tax-rate` } }
            : {}),
        })) ?? ''
      if (!draftTaxRateId) {
        // A VISIBLE refusal rather than an untaxed payment link — the silent
        // under-collection is the defect. The order doc is rolled back the
        // same way the session failure below rolls it back.
        await orderRef.delete().catch(() => undefined)
        await releaseDiscountSlot()
        await claim.release()
        return res.status(502).json({ error: 'Payment link creation failed' })
      }
    }
    const params = new URLSearchParams({
      mode: 'payment',
      ...(useStripeTax ? { 'automatic_tax[enabled]': 'true' } : {}),
      ...(draftTaxRateId ? { 'line_items[0][tax_rates][0]': draftTaxRateId } : {}),
      'line_items[0][quantity]': String(chargedQuantity),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(chargedUnitAmountCents),
      'line_items[0][price_data][product_data][name]': chargedLineName,
      // THE CONNECT SPLIT (AGL-1956). A Stripe Tax payment link computes its
      // tax against AGLYN's registrations and Aglyn remits it (AGL-1904), so
      // the merchant gets a FIXED `transfer_data[amount]` and no
      // `application_fee_amount`: the fee form transfers `amount_total − fee`,
      // and `amount_total` includes that tax. A manual-rate or untaxed link is
      // unchanged. See `commerce-connect-transfer.ts`.
      ...CommerceModel.destinationChargeParams({
        accountId: String(accountId),
        feeCents,
        taxOwner: useStripeTax ? 'platform' : 'merchant',
        // The DISCOUNTED goods (AGL-305): this is what the merchant is
        // transferred, and paying out the list price on a discounted link
        // would move money Stripe never collected.
        merchantGoodsCents: chargedItemsCents,
        shippingFloorCents: CommerceModel.shippingFloorCents(shippingOptions),
      }),
      ...(email ? { customer_email: email } : {}),
      success_url: `${consoleProductsUrl}?draft=paid`,
      cancel_url: `${consoleProductsUrl}?draft=canceled`,
      'metadata[type]': 'commerce-draft',
      'metadata[hostId]': hostId,
      'metadata[orderId]': orderRef.id,
      'metadata[productId]': productId,
      ...(variantId ? { 'metadata[variantId]': variantId } : {}),
      'metadata[feeCents]': String(feeCents),
      // WHAT THE WEBHOOK SETTLES (AGL-305), in the field names the
      // `checkout.session.completed` branch already reads for the cart. The
      // hold key's ABSENCE is what tells it to fall back to the unconditional
      // increment, which is right for an uncapped promotion.
      ...(appliedDiscountId
        ? { 'metadata[discountId]': appliedDiscountId }
        : {}),
      ...(discountHoldKey ? { 'metadata[discountHoldKey]': discountHoldKey } : {}),
      // See the AGL-1956 note in `checkout.ts` — recorded only on the shape
      // where the merchant's payout is no longer the whole charge.
      ...(useStripeTax
        ? {
            'metadata[transferCents]': String(
              CommerceModel.platformLiableTransferCents({
                feeCents,
                merchantGoodsCents: chargedItemsCents,
                shippingFloorCents:
                  CommerceModel.shippingFloorCents(shippingOptions),
              }),
            ),
            'metadata[transferShippingCents]': String(
              CommerceModel.shippingFloorCents(shippingOptions),
            ),
          }
        : {}),
    })
    // Both keys or neither (AGL-1720's rule, inherited). Stripe will not apply
    // a shipping rate without an address to ship to, and a merchant who
    // configured nothing plans to no options and so gets neither — a payment
    // link byte-identical to the one this handler built before shipping
    // existed on it.
    if (shippingOptions.length > 0) {
      CommerceModel.appendShippingAddressCollectionParams(
        params,
        shippingPlan.countries,
      )
      CommerceModel.appendCheckoutShippingParams(params, shippingOptions)
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
      await releaseDiscountSlot()
      await claim.release()
      return res.status(502).json({ error: 'Payment link creation failed' })
    }
    await orderRef.set(
      { checkoutSessionId: session.id, paymentLinkUrl: session.url },
      { merge: true },
    )
    // Spread on the same terms as the register's: present only when there is
    // something to say, so a caller can test the key rather than a length.
    const payload = {
      orderId: orderRef.id,
      url: session.url,
      ...(stockWarnings.length > 0 ? { stockWarnings } : {}),
    }
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule). The order write may or may not have landed; the
    // merchant reconciles from the orders list, the same position they were
    // in before this endpoint had a claim at all. The redemption slot goes
    // back for the same reason — a throw is the one path that would otherwise
    // leave it standing against the cap until its TTL lapsed.
    await releaseDiscountSlot()
    await claim?.release()
    return res.status(500).json({ error: 'Draft order failed' })
  }
}
