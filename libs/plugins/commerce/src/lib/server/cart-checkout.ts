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
import { connectLinkageIsReady } from '@aglyn/tenant-data-admin/server/stripe-account-mode'
import { readCartId } from './cart-cookie'
import { resolveManualTaxRateId } from './manual-tax-rate'
import {
  type PromotionSlotHold,
  holdPromotionSlot,
  promotionHoldKey,
} from './promotion-hold'
import { type StockHoldLine, holdStock, stockHoldKey } from './stock-hold'
import {
  applyNativeCheckoutParams,
  nativeCheckoutStripeHeaders,
  readCheckoutSessionPayload,
  resolveNativeCheckoutMode,
} from './native-checkout'

/**
 * Cart checkout (AGL-293): the whole cart in one Stripe Checkout
 * session on the merchant's account. Every line re-prices from its
 * product doc, unavailable lines block with a visible error, the
 * platform fee sums per line by product type (AGL-278 ladder), and the
 * webhook creates one multi-line order and clears the cart.
 */

export const cartCheckoutHandler: PluginApiHandler = async (req, res) => {
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
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 120)
  const marketingOptIn = Boolean(body.marketingOptIn)
  const giftCardCode = String(body.giftCardCode ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 24)
  const couponCode = String(body.couponCode ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 40)
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  // AGL-1769: validated here even though this handler only READS the cart,
  // because it is where the raw cookie left the request — `:342` stamps it
  // into `metadata[cartId]`, and the billing webhook builds a document path
  // from that copy. Closing it at the source is what lets the webhook keep
  // taking its metadata at face value.
  const cartId = readCartId(req.cookies, hostId)
  if (!cartId) return res.status(400).json({ error: 'Your cart is empty' })
  // One checkout attempt, minted by the cart drawer (AGL-1697). Node
  // lowercases incoming headers, but read both spellings — the plugin API
  // request type makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)

  let claim: AttemptClaim | null = null
  /**
   * Promotion slots this attempt reserved (AGL-2453), hoisted so the catch
   * below can hand them back too. A throw after a hold is placed is exactly the
   * case where an invisible slot would sit against a merchant's cap for a day.
   */
  const heldPromotions: PromotionSlotHold[] = []
  const releasePromotionHolds = async (): Promise<void> => {
    for (const hold of heldPromotions.splice(0)) await hold.release()
  }
  /**
   * The units this attempt reserved (AGL-2356), hoisted for the same reason —
   * a throw after the hold is placed is exactly the case where a merchant's
   * last unit would sit invisibly spoken for until the TTL lapsed.
   */
  let stockHold: { holdKey: string; release: () => Promise<void> } | null = null
  let heldStockKey = ''
  const releaseStock = async (): Promise<void> => {
    const held = stockHold
    stockHold = null
    heldStockKey = ''
    if (held) await held.release()
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const cartSnapshot = await hostRef.collection('carts').doc(cartId).get()
    const cart = (cartSnapshot.data() as CommerceModel.HostCart | undefined) ?? {
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
    // Storefront selling is the `commerce` entitlement (Starter+) — not
    // `marketplaceSelling`, which gates the marketplace marketplace (AGL-470).
    if (!Aglyn.checkEntitlement(ownerOrg.org as any, 'commerce')) {
      return res.status(403).json({ error: 'Selling is not enabled' })
    }
    const ownerProfile = await firestore
      .collection('profiles')
      .doc(String(ownerId))
      .get()
    const accountId = ownerProfile.get('stripeAccountId')
    if (
      !connectLinkageIsReady(
        {
          accountId,
          chargesEnabled: ownerProfile.get('stripeChargesEnabled'),
          accountLivemode: ownerProfile.get('stripeAccountLivemode'),
        },
        { subject: `cart checkout host ${hostId}` },
      )
    ) {
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
        snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as any) : null,
      ]),
    )
    let itemsCents = 0
    /** Per-line values for scoped discount pricing (AGL-2517). */
    const discountLines: { productId: string; amountCents: number }[] = []
    let feeCents = 0
    /** Whether any line carries a fee rate above zero (AGL-2232). */
    let feeApplies = false
    /**
     * The goods the shopper actually pays for, after any discount that reached
     * the session (AGL-2232). Starts as the whole basket and is lowered only
     * when a Stripe coupon is minted, which is the one reduction the fee is
     * scaled by.
     */
    let chargedItemsCents = 0
    // Weight-tier shipping rates price off this (AGL-1707). Without it every
    // `weight_tiers` rate would resolve at 0g and quote the lightest tier.
    let totalGrams = 0
    // Whether anything in this cart is posted at all (AGL-1721). Buy-now has
    // always resolved shipping for physical products only; the cart never
    // asked, so a cart of downloads could be charged to ship. It matters more
    // now that an unresolvable destination REFUSES: a shopper buying two PDFs
    // must not be asked which country to ship them to.
    let hasPhysicalLine = false
    /**
     * What this cart will RESERVE (AGL-2356), collected as the loop below
     * resolves each line's variant rather than re-derived afterwards: the
     * reservation and the price must be taken against the same variant, and a
     * second resolution is a second chance to pick a different one.
     */
    const reserveLines: StockHoldLine[] = []
    // Cart checkout never builds subscription sessions — every line bills
    // one-time in `payment` mode (recurring products subscribe through the
    // PDP's direct checkout, AGL-303) — so the buyer-chosen billing field
    // (AGL-545) does not apply here.
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
      if (!variant || !CommerceModel.canPurchase(product, variant.id, line.quantity)) {
        throw Object.assign(new Error('unavailable'), {
          visible: `"${product.name}" is sold out`,
        })
      }
      // Gift cards are a Business+ entitlement, checked per sale (AGL-470).
      if (
        product.giftCard &&
        !Aglyn.checkEntitlement(ownerOrg.org as any, 'giftCards')
      ) {
        throw Object.assign(new Error('unavailable'), {
          visible: `"${product.name}" is not available on this store's plan`,
        })
      }
      // Only the lines there is something to reserve ON. An untracked variant
      // and a `backorder` product have no finite shelf, so a hold could never
      // change what they answer — and collecting them would open a transaction
      // over the products of a purely digital storefront to write nothing at
      // all. The same decision `holdPromotionSlot` makes for an UNCAPPED
      // promotion: the unlimited case stays off the write path entirely.
      //
      // A pre-filter, so the authority is still the in-transaction re-check in
      // `holdStock`. The only thing it can get wrong is skipping a hold for a
      // variant that became tracked between this read and that transaction,
      // which is the behaviour that shipped before this issue.
      if (CommerceModel.stockIsReservable(product, variant.id, Date.now())) {
        reserveLines.push({
          productId: line.productId,
          variantId: variant.id,
          quantity: line.quantity,
        })
      }
      const unitCents = Math.round(Number(variant.priceUsd) * 100)
      itemsCents += unitCents * line.quantity
      // What THIS line is worth, so a product-scoped discount can be priced
      // against the lines it actually covers rather than the whole basket
      // (AGL-2517).
      discountLines.push({
        productId: line.productId,
        amountCents: unitCents * line.quantity,
      })
      totalGrams += Math.max(0, Number(variant.weightGrams ?? 0)) * line.quantity
      // A missing `type` reads as physical, exactly as the fee ladder below
      // reads it — `liftLegacyProduct` only defaults the field on docs it
      // synthesizes variants for, so a part-migrated doc can reach here
      // without one and the two reads must not disagree about what it is.
      if ((product.type ?? 'physical') === 'physical') hasPhysicalLine = true
      // `?? 'physical'`, which the comment four lines up already promised and
      // the code did not deliver (AGL-2251). `resolveTransactionFeePct` keys
      // on `productType === 'physical'` and sends everything else — `undefined`
      // included — to the DIGITAL rate, so a part-migrated product doc with no
      // `type` was priced at 3%/2%/1% here while `checkout.ts` (`lifted.type ??
      // 'physical'`) priced the identical product at the physical rate. The
      // same basket cost the merchant a different fee depending on which
      // button the shopper pressed.
      const feePct = Aglyn.resolveTransactionFeePct(
        ownerOrg.org as any,
        product.type ?? 'physical',
      )
      // WHETHER a rate applies is not the same fact as what it rounds to
      // (AGL-2232), and only the sum was being kept. `checkout.ts`,
      // `draft-order.ts` and `reserve.ts` all floor at `Math.max(1, …)` when
      // `feePct > 0`; the cart floored nothing, so a Scale-plan cart of $0.30
      // digital lines rounded every line to 0, the emission guard below read
      // `feeCents > 0` as "this plan charges nothing", and the session went out
      // with no application fee at all.
      if (feePct > 0) feeApplies = true
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

    // Shipping (AGL-1707), from the settings document tax is also read from.
    // This is the ONLY thing that makes Stripe charge shipping: without
    // `shipping_options` it presents no shipping choice,
    // `total_details.amount_shipping` is 0, and the zones and rates the
    // merchant configured in the console are silently worth nothing.
    //
    // RESOLVED BEFORE ANY STRIPE CALL, ahead of the discount block below,
    // because the plan can refuse — and the discount block creates real coupon
    // objects on the merchant's account. Refusing after them would leave one
    // orphaned on every attempt.
    //
    // A merchant who has configured nothing plans to no options and gets a
    // session byte-identical to today's: no shipping charged, exactly as
    // before. Only a merchant who set rates up starts collecting them.
    const storeSettings = await hostRef
      .collection('settings')
      .doc('store')
      .get()
    const shippingPlan = hasPhysicalLine
      ? CommerceModel.planCheckoutShipping(
          storeSettings.get('shipping') as
            | CommerceModel.ShippingSettings
            | undefined,
          { subtotalCents: itemsCents, totalGrams },
          body.shippingCountry,
        )
      : { countries: CommerceModel.CHECKOUT_SHIPPING_COUNTRIES, options: [] }
    // The shopper is asked, then the answer is ENFORCED (AGL-1721): a declared
    // destination narrows `allowed_countries` to itself, so the rate resolved
    // for it is the only one on the session and no other address can be
    // entered against it. Answering the 400 is not optional — a caller that
    // skips the field is refused again rather than served the union.
    if (shippingPlan.refusal === 'destination-required') {
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
      return res.status(409).json({
        error: `This store does not ship to ${
          CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[declared as string] ??
          'that country'
        }.`,
        needsShippingCountry: true,
        shippingCountries: [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
      })
    }
    // The merchant priced shipping and their table cannot reach this cart
    // (AGL-2232) — a 3 kg basket at a store whose weight tiers stop at 2 kg.
    // No `needsShippingCountry`: asking where it goes cannot price it, and a
    // shopper handed the country select would answer it and be refused again.
    if (shippingPlan.refusal === 'cart-unpriceable') {
      return res
        .status(409)
        .json({ error: CommerceModel.CART_UNPRICEABLE_SHIPPING_MESSAGE })
    }

    chargedItemsCents = itemsCents
    // Discounts engine (AGL-305): entered codes and automatic
    // promotions from hosts/{id}/discounts; the AGL-96 coupons remain a
    // fallback for unknown codes.
    const discountsSnapshot = await hostRef
      .collection('discounts')
      .limit(100)
      .get()
    const resolvedDiscount = CommerceModel.resolveDiscount(
      discountsSnapshot.docs.map((docSnapshot) => ({
        ...(docSnapshot.data() as CommerceModel.HostDiscount),
        $id: docSnapshot.id,
      })),
      {
        ...(couponCode ? { code: couponCode } : {}),
        subtotalCents: itemsCents,
        productIds: cart.lines.map((line) => line.productId),
        lines: discountLines,
      },
    )
    if (resolvedDiscount?.codeProblem) {
      return res.status(400).json({ error: resolvedDiscount.codeProblem })
    }

    // Point of no return (AGL-1697): everything past here creates Stripe
    // objects — up to two coupons and the session — on the merchant's live
    // account. The cart is not consumed until the webhook clears it, so
    // before the claim one cart could spawn unlimited sessions, each retry
    // leaving an orphan `checkouts/{sessionId}` doc (which feeds the AGL-323
    // abandoned-cart emails) plus a stray coupon.
    //
    // The two refusals that remain BELOW this line (invalid legacy coupon,
    // empty gift card) each release the claim: they are deterministic, the
    // shopper fixes the code and presses the same button, and because the
    // retry re-derives the same digest Stripe replays any coupon the first
    // run already minted rather than creating a twin (AGL-1714's rule).
    const claimed = await claimAttempt(firestore, {
      kind: 'commerce-cart',
      scopeId: `${hostId}:${cartId}`,
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
    // `/v1/coupons` and then `checkout/sessions` would error the second call.
    const stripeKeyHeader = (object: string): Record<string, string> => {
      const derived = deriveStripeObjectKey(claimed.claim.stripeKey, object)
      return derived ? { 'Idempotency-Key': derived } : {}
    }

    // THE UNITS ARE RESERVED HERE (AGL-2356), not merely read in the loop
    // above.
    //
    // `canPurchase` up there is a plain `.get()` compared against a number, and
    // the webhook decremented minutes later without ever re-asking. Nothing was
    // written, so there was no document to contend on: every shopper who
    // reached this line while the shelf held one unit passed it, and they all
    // paid. This is the write that makes them serialise.
    //
    // ONE transaction across every product in the cart, so a two-product basket
    // reserves both or neither — a partial reservation would charge a shopper
    // for goods the store cannot fill, which is this issue's own defect
    // arriving through its fix. See `stock-hold.ts`.
    //
    // FIRST among the three holds this handler takes, before the promotion
    // slots and the gift card below: stock is the likeliest refusal, and
    // reserving a merchant's capped discount for a basket the store cannot fill
    // is a slot held for nothing.
    {
      const held = await holdStock({
        firestore,
        hostRef,
        holdKey: stockHoldKey(claimed.claim.stripeKey),
        lines: reserveLines,
        label: `cart ${hostId}/${cartId}`,
      })
      if (!held.ok) {
        // Nothing has been minted yet, so the key goes back and the same
        // button works when the units return (AGL-1697). `sold-out` names the
        // shelf being SPOKEN FOR rather than empty — the merchant has stock and
        // another shopper is in checkout with it, and telling this one to come
        // back in a few minutes is the difference between a wait and a loss.
        await releaseStock()
        await claim.release()
        return res.status(409).json({
          error:
            held.reason === 'sold-out'
              ? held.productName
                ? `"${held.productName}" — ${CommerceModel.STOCK_HELD_MESSAGE}`
                : CommerceModel.STOCK_HELD_MESSAGE
              : 'Your cart is no longer available',
        })
      }
      if (held.holdKey) {
        stockHold = held
        heldStockKey = held.holdKey
      }
    }

    // ONE Stripe discount, and that is the whole shape of this block
    // (AGL-2112).
    //
    // A Checkout Session takes exactly one entry in `discounts`. This used to
    // be three independent blocks — an AGL-305 discount, a legacy AGL-96
    // coupon code, and an AGL-322 gift card — each minting its own Stripe
    // coupon and each doing `params.set('discounts[0][coupon]', …)`.
    // `URLSearchParams.set` REPLACES, so a cart carrying a discount AND a gift
    // card minted two real coupon objects on the merchant's account and sent
    // only the LAST one. The shopper paid full price minus the gift card; the
    // discount silently evaporated — and the webhook still burned its
    // redemption against `maxRedemptions`, so the code was spent on an order
    // that never got it.
    //
    // The fee was wrong in the same combination and in Aglyn's favour by
    // accident, then against it: `feeCents` was scaled DOWN once per block, so
    // two reductions compounded for one discount that was actually applied.
    //
    // So: resolve every reduction FIRST, add them up, and mint a single
    // `amount_off` coupon for the sum. A percentage coupon becomes its cash
    // equivalent against `itemsCents` — which is what the fee arithmetic here
    // has always assumed it was, and what `checkout.ts` already does for
    // buy-now (`amountCents * (100 - percentOff) / 100`).
    //
    // Validation still happens in the same order and still 400s the same way,
    // BEFORE anything is minted — the shopper fixes the code and presses the
    // same button, so the claim is released and the key survives (AGL-1697).
    // REDEMPTION SLOTS ARE HELD, NOT MERELY READ (AGL-2453).
    //
    // `resolveDiscount` above and the coupon `.get()` below both answered "is
    // there a slot left?" from a plain read, and the webhook incremented the
    // counter minutes later without ever re-asking. The gap is the whole
    // Checkout Session lifetime — up to 24 hours — so every shopper who reached
    // this line while a cap of 100 sat at 99 passed it, and the counter
    // finished at 99+N. Nothing was lost; nothing was ever CHECKED.
    //
    // The AGL-2449 shape, reused: the slot is claimed in a transaction here and
    // settled in one at the webhook. Both redemption paths hold — the typed
    // coupon and the automatic discount — because holding one of two doors onto
    // the same counter fixes neither, and the automatic path is the one a
    // shopper does not even have to opt into.
    //
    // A held slot COUNTS while its session is live and is released when the
    // session expires, is cancelled, or this handler refuses below. See
    // `model/commerce-promotions.ts` for why that is the right way round.
    const slotKey = promotionHoldKey(claim.stripeKey)
    let totalOffCents = 0
    if (resolvedDiscount && resolvedDiscount.benefit.kind !== 'none') {
      const discountRef = hostRef
        .collection('discounts')
        .doc(resolvedDiscount.discountId)
      const slot = await holdPromotionSlot({
        firestore,
        ref: discountRef,
        holdKey: slotKey,
        label: `discount ${resolvedDiscount.discountId}`,
      })
      if (!slot.ok) {
        // Refused rather than silently dropped, and that is a deliberate
        // choice for the AUTOMATIC case: this discount was in the price the
        // storefront showed, so continuing without it would charge more than
        // the shopper agreed to and tell them nothing. Nothing has been minted
        // yet, so this is retryable — and the retry prices correctly, because
        // `resolveDiscount` counts holds too and simply stops offering it.
        await claim.release()
        return res.status(409).json({
          error:
            couponCode && resolvedDiscount.discount.code
              ? CommerceModel.PROMOTION_EXHAUSTED_MESSAGE
              : CommerceModel.PROMOTION_UNAVAILABLE_MESSAGE,
        })
      }
      if (slot.holdKey) heldPromotions.push(slot)
      totalOffCents += resolvedDiscount.discountCents
      params.set('metadata[discountId]', resolvedDiscount.discountId)
      // Only when a slot was actually reserved. Its ABSENCE is what tells the
      // webhook to fall back to the unconditional increment, which is right for
      // an uncapped promotion and for a session minted before this deploy.
      if (slot.holdKey) {
        params.set('metadata[discountHoldKey]', slot.holdKey)
      }
    }
    // FREE SHIPPING IS A ZEROED RATE, NOT A COUPON (AGL-2508).
    //
    // A session-level Stripe coupon discounts LINE ITEMS; shipping is a
    // separate `shipping_options` concept and a coupon never touches it. There
    // is also no amount to discount at this point — the shopper picks their
    // rate after the session is created — so the only construction that can be
    // exact is to offer every rate at zero.
    //
    // Every rate, not just the cheapest: `free_shipping` carries no field
    // scoping it to one, so the merchant asked for shipping to be free rather
    // than for one particular rate to be. Zeroing the dearest too also keeps
    // the fee and transfer arithmetic below honest, since both read these same
    // options and the shopper is paying nothing for carriage either way.
    const shippingOptions =
      resolvedDiscount?.freeShipping === true
        ? shippingPlan.options.map((option) => ({ ...option, amountCents: 0 }))
        : shippingPlan.options

    // Coupons (AGL-96 semantics): percent off the items total.
    if (couponCode && !resolvedDiscount) {
      const couponRef = hostRef.collection('coupons').doc(couponCode)
      const couponSnapshot = await couponRef.get()
      const coupon = couponSnapshot.data() as any
      const percentOff = Number(coupon?.percentOff ?? 0)
      const expired =
        coupon?.expiresAtMs != null && Number(coupon.expiresAtMs) < Date.now()
      if (
        !coupon ||
        coupon.enabled === false ||
        expired ||
        !(percentOff > 0 && percentOff <= 100)
      ) {
        // Deterministic and retryable — the shopper fixes the code and
        // presses the same button, so the key survives (AGL-1697).
        await claim.release()
        return res.status(400).json({ error: 'Invalid or expired coupon' })
      }
      // The exhaustion test moved INTO a transaction that also writes
      // (AGL-2453). It used to be a comparison against a plain `.get()` here,
      // and the webhook incremented the counter minutes later without
      // re-asking — so the check bounded nothing once two shoppers held
      // sessions at the same time.
      const slot = await holdPromotionSlot({
        firestore,
        ref: couponRef,
        holdKey: slotKey,
        label: `coupon ${couponCode}`,
      })
      if (!slot.ok) {
        await claim.release()
        return res.status(400).json({
          error:
            slot.reason === 'exhausted'
              ? CommerceModel.PROMOTION_EXHAUSTED_MESSAGE
              : 'Invalid or expired coupon',
        })
      }
      if (slot.holdKey) {
        heldPromotions.push(slot)
        params.set('metadata[couponHoldKey]', slot.holdKey)
      }
      totalOffCents += Math.round((itemsCents * percentOff) / 100)
      params.set('metadata[couponCode]', couponCode)
    }

    // Gift cards (AGL-322): balance applies as amount-off; the webhook settles
    // the hold this places on completion.
    //
    // The read is a TRANSACTION and it WRITES (AGL-2449). A gift card is cash,
    // and a plain `.get()` here was the last unreserved limited resource in the
    // order path: two checkouts entering the same code both read $50, both got
    // $50 off, and the webhook's bare `increment(-N)` settled the card at
    // -$50 — $100 of goods against a $50 card, and a negative row in the
    // outstanding-liability total. The increment was atomic the whole time;
    // nothing ever CHECKED.
    //
    // Unlike stock (AGL-2320), this door can still refuse: the card is applied
    // BEFORE Stripe is contacted, so no money has moved yet and a shortfall is
    // a 400 rather than a shipped parcel and an apology. That is why this
    // reserves instead of merely reporting.
    //
    // `giftCardCents` stays in the session metadata because the webhook still
    // needs to know what to settle, but it is no longer the AUTHORITY for the
    // decrement — the hold is, and it is keyed by the session id below.
    // Set only once a hold actually stands, so the refusals below can call it
    // unconditionally without knowing whether there was a gift card at all.
    let releaseGiftCardHold: () => Promise<void> = async () => undefined
    if (giftCardCode) {
      const cardRef = hostRef.collection('giftCards').doc(giftCardCode)
      // Placed before the Stripe session exists, so it is keyed by the
      // idempotency claim's derived key rather than by a session id we do not
      // have yet — the same string the session is minted under below, so a
      // retry of this attempt re-places the SAME hold rather than a second one.
      const holdKey = claim.stripeKey
      const nowMs = Date.now()
      const held = await firestore
        .runTransaction(async (transaction: any) => {
          const fresh = await transaction.get(cardRef)
          if (!fresh.exists) return null
          const card = (fresh.data() ?? {}) as CommerceModel.HostGiftCard
          const holds = CommerceModel.pruneGiftCardHolds(card.holds, nowMs)
          // This attempt's own prior hold does not stand in its way — a retry
          // must be able to re-claim what it already reserved, or the second
          // press of the same button refuses the shopper their own money.
          const mine = Number(holds[holdKey]?.cents ?? 0)
          delete holds[holdKey]
          const available = CommerceModel.giftCardAvailableCents(
            { ...card, holds },
            nowMs,
          )
          if (available <= 0 && mine <= 0) return null
          // Against what is LEFT after the discount, not against the whole
          // basket (AGL-2112). The old cap was `min(balance, itemsCents)`, so a
          // $50 card on a $100 basket already 30% off consumed $50 of card
          // against $70 of goods — the webhook decrements by exactly this
          // number, so the extra was burned off the customer's card for nothing.
          const applyCents = Math.min(
            available + mine,
            Math.max(0, itemsCents - totalOffCents),
          )
          if (applyCents <= 0) return 0
          // Lapsed holds are deleted by SENTINEL, not by writing back a pruned
          // copy of the map: `set(…, { merge: true })` merges nested maps
          // rather than replacing them, so a locally-pruned object leaves every
          // stale key exactly where it was. Correctness does not depend on this
          // — every read prunes again — but the document would otherwise grow
          // without bound, one dead key per abandoned checkout, forever.
          const swept: Record<string, unknown> = {}
          for (const stale of Object.keys(card.holds ?? {})) {
            if (stale !== holdKey && !holds[stale]) {
              swept[stale] = firebaseAdmin.firestore.FieldValue.delete()
            }
          }
          transaction.set(
            cardRef,
            {
              holds: {
                ...swept,
                [holdKey]: {
                  cents: applyCents,
                  expiresAtMs: nowMs + CommerceModel.GIFT_CARD_HOLD_TTL_MS,
                },
              },
            },
            { merge: true },
          )
          return applyCents
        })
        .catch((error: unknown) => {
          console.error('Gift card hold failed', giftCardCode, error)
          return null
        })
      if (held == null) {
        // Deterministic and retryable; nothing has been minted yet. Covers the
        // unknown card, the empty card, and the card whose whole balance is
        // already held by someone else's live checkout — the shopper is told
        // the same thing in each case, because "someone is spending it right
        // now" is not a distinction a storefront should draw.
        await claim.release()
        return res.status(400).json({ error: 'Gift card is empty or invalid' })
      }
      if (held > 0) {
        totalOffCents += held
        params.set('metadata[giftCardCode]', giftCardCode)
        params.set('metadata[giftCardCents]', String(held))
        params.set('metadata[giftCardHoldKey]', holdKey)
        // Every refusal BELOW this point releases the claim so the shopper can
        // retry; the hold has to come back with it or the retry finds the card
        // empty and the shopper is locked out of their own balance until the
        // TTL lapses. The expiry is the backstop for a crash, not the
        // mechanism for a refusal the code can see happening.
        releaseGiftCardHold = async () => {
          await cardRef
            .set(
              {
                holds: {
                  [holdKey]: firebaseAdmin.firestore.FieldValue.delete(),
                },
              },
              { merge: true },
            )
            .catch((error: unknown) => {
              // Best effort: the TTL still releases it. Never let tidying up a
              // hold turn a clean 409 into a 500.
              console.error('Gift card hold release failed', giftCardCode, error)
            })
        }
      }
    }

    if (totalOffCents > 0) {
      const stripeCoupon = await fetch('https://api.stripe.com/v1/coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // ONE derived object key now, because there is one coupon. The
          // three old keys existed only because there were three mints.
          ...stripeKeyHeader('coupon'),
        },
        body: new URLSearchParams({
          amount_off: String(Math.min(totalOffCents, itemsCents)),
          currency: 'usd',
          duration: 'once',
        }).toString(),
      }).then((response) => response.json())
      if (stripeCoupon?.id) {
        params.set('discounts[0][coupon]', stripeCoupon.id)
        // Scaled ONCE, by the reduction that actually reached the session.
        feeCents = Math.round(
          (feeCents * Math.max(0, itemsCents - totalOffCents)) /
            Math.max(1, itemsCents),
        )
        chargedItemsCents = Math.max(0, itemsCents - totalOffCents)
      }
    }
    // THE FLOOR (AGL-2232). A rate above zero on goods the shopper actually
    // pays for is a fee, however small the arithmetic makes it — the same rule
    // the other three doors already hold. Gated on `chargedItemsCents` so a
    // basket a gift card covered entirely still takes nothing: the fee is a cut
    // of the goods, and there are no goods left to cut.
    if (feeApplies && chargedItemsCents > 0 && feeCents < 1) feeCents = 1
    // STRIPE'S CARD COST, PASSED THROUGH AT COST (AGL-2152). The loop above
    // accumulates the platform's advertised TAKE per line and nothing else; on
    // a destination charge Stripe debits 2.9% + 30¢ of the whole card total
    // from the PLATFORM's balance, so a cart on any tier carrying a 0% rate
    // cost Aglyn money on every single order — and Starter's 2% is below 2.9%,
    // so it lost money too. Added ONCE per charge, not per line: the 30¢ is a
    // per-charge cost.
    //
    // The base is everything the card will be run for that can be seen from
    // here: the goods the shopper actually pays for, the DEAREST shipping
    // option on the session (the shopper picks after this and
    // `application_fee_amount` is fixed at creation), and the manual origin tax
    // rate the lines carry. A store on Stripe Tax is the one residual — its tax
    // is computed inside Stripe after the session is made.
    if (chargedItemsCents > 0) {
      const shippingCeilingCents = shippingOptions.reduce(
        (most, option) =>
          Math.max(most, Math.max(0, Number(option.amountCents ?? 0))),
        0,
      )
      const cartTaxSettings = (storeSettings.get('tax') ??
        {}) as CommerceModel.TaxSettings
      const manualRate =
        cartTaxSettings.mode === 'manual' && !cartTaxSettings.pricesIncludeTax
          ? CommerceModel.resolveTaxRate(
              cartTaxSettings,
              cartTaxSettings.origin ?? {},
            )
          : null
      const manualTaxPct =
        manualRate && manualRate.pct > 0 ? manualRate.pct : 0
      const chargeCents =
        chargedItemsCents +
        Math.round((chargedItemsCents * manualTaxPct) / 100) +
        shippingCeilingCents
      feeCents = Math.min(
        chargeCents,
        feeCents + Aglyn.storefrontProcessingCostCents(chargeCents),
      )
    }
    // THE CONNECT SPLIT IS EMITTED BELOW, NOT HERE (AGL-1956). It used to be
    // written at this point, which is ABOVE the tax decision — and the shape
    // of the split now depends on that decision: a Stripe Tax sale must send a
    // fixed `transfer_data[amount]` instead of `application_fee_amount`,
    // because the fee form transfers `amount_total − fee` and `amount_total`
    // carries tax that AGLYN owes. `feeCents` is final as of this line; only
    // its emission moved. See `commerce-connect-transfer.ts`.
    //
    // Address collection feeds order shipping + destination tax later, and is
    // the enforcing half of the plan above (AGL-1721) — emitted from the
    // plan's own country list, never a default, so it cannot widen past the
    // destinations the declared rates were resolved for. The emission is
    // shared with buy-now (AGL-1720).
    CommerceModel.appendShippingAddressCollectionParams(
      params,
      shippingPlan.countries,
    )
    CommerceModel.appendCheckoutShippingParams(params, shippingOptions)

    // Taxes (AGL-1953). This block used to be the `stripe` line alone, and a
    // `manual`-mode store — the mode the AGL-285 zone editor leaves a merchant
    // in by default — collected tax on a buy-now sale and NOTHING on a cart
    // sale of the same goods. Same store, same shopper, same items, two totals
    // depending on which button was pressed, with the merchant left owing the
    // destination tax they never charged.
    //
    // The manual tax rides a real Stripe Tax Rate on each taxable line rather
    // than buy-now's `line_items[1]` product line (AGL-1711). That is not a
    // gratuitous difference: THIS path applies its discounts, coupons and gift
    // cards as session-level Stripe coupons, which spread across every line,
    // so a fake tax line would be discounted along with the goods. Stripe
    // applies a tax rate AFTER the discount — measured, see
    // `manual-tax-rate.ts` — so the arithmetic stays right and
    // `total_details.amount_tax` becomes real, which is what lets the webhook
    // record the tax with no metadata snapshot to keep in step.
    //
    // `automatic_tax.enabled` stays false on a manual sale, so
    // `storefront-tax.ts` still classifies it `manual` and it is never summed
    // into the Aglyn-liable figure (AGL-1904).
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
    })
    if (taxDecision.kind === 'undecided') {
      // BELOW the claim on this path, so release it: the merchant fixes the
      // setting and the shopper retries under the same key (AGL-1697).
      await releaseGiftCardHold()
      await releasePromotionHolds()
      await releaseStock()
      await claim.release()
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
      // Below the claim here too, so release it for the same reason.
      await releaseGiftCardHold()
      await releasePromotionHolds()
      await releaseStock()
      await claim.release()
      return res.status(409).json({ error: taxMisconfigured })
    }
    if (taxDecision.kind === 'stripe-automatic') {
      params.set('automatic_tax[enabled]', 'true')
    } else if (taxSettings.mode === 'manual' && !taxSettings.pricesIncludeTax) {
      // Origin-based, exactly as buy-now resolves it: the cart collects the
      // shopper's address inside Stripe Checkout, so there is no destination
      // to resolve against before the session exists. Destination-based manual
      // tax is AGL-296's checkout, and taxing by origin here is what makes the
      // two paths agree — which is the whole point of this issue.
      //
      // `pricesIncludeTax` stores charge no separate tax on ANY path (buy-now
      // skips it the same way); the tax is already inside the displayed price.
      const rate = CommerceModel.resolveTaxRate(
        taxSettings,
        taxSettings.origin ?? {},
      )
      // Tax-exempt products are excluded per LINE, which a single session-wide
      // figure could not express — a cart mixing a taxable chair with an exempt
      // download must tax only the chair.
      const taxableIndexes = cart.lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => !productsById.get(line.productId)?.taxExempt)
        .map(({ index }) => index)
      if (rate && rate.pct > 0 && taxableIndexes.length > 0) {
        const taxRateId = await resolveManualTaxRateId({
          hostRef,
          taxPct: rate.pct,
          taxLabel: rate.label || `Tax (${rate.pct}%)`,
          headers: stripeKeyHeader('tax-rate'),
        })
        if (!taxRateId) {
          // A VISIBLE refusal, never a fallback to an untaxed session — that
          // silent under-collection is this issue. Nothing was sold, so the
          // key goes back and the same button works once Stripe does
          // (AGL-1697); the retry re-derives the same digest, so Stripe
          // replays any rate the first run did mint.
          await releaseGiftCardHold()
          await releasePromotionHolds()
          await releaseStock()
          await claim.release()
          return res.status(502).json({ error: 'Checkout failed' })
        }
        for (const index of taxableIndexes) {
          params.set(`line_items[${index}][tax_rates][0]`, taxRateId)
        }
      }
    }

    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const backUrl = referer.startsWith('http') ? referer : origin
    const separator = backUrl.includes('?') ? '&' : '?'
    // `{CHECKOUT_SESSION_ID}` is substituted by Stripe on redirect (AGL-1641).
    // Without it the return URL said only that SOMETHING succeeded, so the
    // storefront could not name the order it had just completed — which is why
    // `purchase` could not be reported at all. It is also the order doc id and
    // becomes the GA `transaction_id`, so GA4's own de-duplication makes a
    // refresh of this page harmless.
    params.set(
      'success_url',
      `${backUrl}${separator}order=success&session_id={CHECKOUT_SESSION_ID}`,
    )
    params.set('cancel_url', `${backUrl}${separator}order=canceled`)
    if (email) params.set('customer_email', email)
    // THE CONNECT SPLIT (AGL-1956), emitted here because it needs the tax
    // decision taken above. On a Stripe Tax cart the tax is computed against
    // AGLYN's registrations and is Aglyn's to remit (AGL-1904), so the
    // merchant is paid a FIXED `transfer_data[amount]` and no
    // `application_fee_amount` is sent at all — the fee form would have Stripe
    // transfer `amount_total − fee`, handing the state's money to the
    // merchant. A manual-rate or untaxed cart keeps the fee form byte for
    // byte. See `commerce-connect-transfer.ts` for why only one of the two
    // knobs may ever be present.
    const cartTaxOwner =
      taxDecision.kind === 'stripe-automatic' ? 'platform' : 'merchant'
    const cartShippingFloorCents = CommerceModel.shippingFloorCents(
      shippingOptions,
    )
    Object.entries(
      CommerceModel.destinationChargeParams({
        accountId: String(accountId),
        feeCents,
        taxOwner: cartTaxOwner,
        merchantGoodsCents: chargedItemsCents,
        shippingFloorCents: cartShippingFloorCents,
      }),
    ).forEach(([key, value]) => params.set(key, value))
    params.set('metadata[type]', 'commerce-cart')
    params.set('metadata[hostId]', hostId)
    params.set('metadata[cartId]', cartId)
    params.set('metadata[feeCents]', String(Math.max(0, feeCents)))
    // Only on the shape where `transfer.amount` is no longer `charge.amount`,
    // so the merchant's actual payout stops being derivable from the charge
    // (AGL-1956). The shipping baseline is the other half: the difference
    // between it and the option the shopper chose is owed back to the merchant.
    if (cartTaxOwner === 'platform') {
      params.set(
        'metadata[transferCents]',
        String(
          CommerceModel.platformLiableTransferCents({
            feeCents,
            merchantGoodsCents: chargedItemsCents,
            shippingFloorCents: cartShippingFloorCents,
          }),
        ),
      )
      params.set(
        'metadata[transferShippingCents]',
        String(cartShippingFloorCents),
      )
    }
    // Set only when units were actually reserved (AGL-2356). Its ABSENCE is
    // what tells the webhook there is nothing to release — right for a cart of
    // untracked or backorder lines, and right for a session minted before this
    // deploy, neither of which reserved anything.
    if (heldStockKey) params.set('metadata[stockHoldKey]', heldStockKey)
    // A HALF-HOUR SESSION, AND IT IS THE HOLD'S WHOLE SAFETY ARGUMENT
    // (AGL-2356). Stripe's default is 24 hours, and a hold must outlive any
    // session that can still be paid — so the default would mean one abandoned
    // cart standing on a merchant's last unit for a day, which is exactly the
    // unbounded, invisible UNDER-sell this issue was held back for. Shortening
    // the SESSION is what bounds it; see `CHECKOUT_SESSION_TTL_MS` for why the
    // figure is 31 minutes and not Stripe's advertised 30-minute floor.
    params.set(
      'expires_at',
      String(
        Math.floor((Date.now() + CommerceModel.CHECKOUT_SESSION_TTL_MS) / 1000),
      ),
    )

    // The Payment Element (AGL-1944), LAST and touching nothing above it. Every
    // figure the shopper is charged — line prices, the discount coupon, the tax
    // construction, the shipping rates, the fee — was decided before this line
    // and is identical on both checkout paths. This swaps the redirect's URL
    // pair for `ui_mode` + `return_url` and stops. Off unless the flag is on for
    // this org AND a publishable key exists; see `resolveNativeCheckoutMode`.
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
          // one, covering the window where the claim is written but the
          // response never arrives.
          ...stripeKeyHeader('session'),
          // Empty on the hosted path (AGL-1944).
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
    // `!session.url` was the liveness check and a `ui_mode` session has no url,
    // so it moves with the mode (AGL-1944) — otherwise every successful native
    // session reads as a Stripe failure: a 502 at the shopper, a released claim,
    // and a real Checkout Session left open on the merchant's account.
    const payload = response.ok
      ? readCheckoutSessionPayload(session, nativeMode)
      : null
    if (!payload) {
      console.error('Stripe cart checkout error', session.error)
      // The checkout did not happen — hand the key back so one flaky moment
      // does not lock this cart out. The retry re-derives the same derived
      // keys, so Stripe replays whatever objects the first run did create.
      await releaseGiftCardHold()
      await releasePromotionHolds()
      await releaseStock()
      await claim.release()
      return res.status(502).json({ error: 'Checkout failed' })
    }
    // THE SESSION NOW EXISTS, SO THE SLOTS BELONG TO IT (AGL-2453). Past this
    // line a hold must survive: the shopper can still pay, and the webhook
    // settles against the reservation. A catch that released one here would
    // leave a paid order whose redemption is never counted — the same
    // over-redemption this fix closes, arriving through the release path.
    heldPromotions.length = 0
    // And so do the units (AGL-2356), for the stronger version of the same
    // reason: releasing here would hand the last unit to the next shopper while
    // this one still holds a payable session, which is the oversell itself.
    stockHold = null
    // Recoverable checkout (AGL-296): email captured before the redirect
    // makes abandonment actionable (AGL-323 sends the recovery emails). Written
    // for the native path too, and it matters MORE there: a shopper who
    // abandons an in-page form never leaves the store, so this row is the only
    // trace that a cart reached checkout at all.
    await hostRef
      .collection('checkouts')
      .doc(String(session.id))
      .set({
        cartId,
        ...(email ? { email } : {}),
        ...(marketingOptIn ? { marketingOptIn: true } : {}),
        itemsCents,
        resumeUrl: backUrl,
        status: 'open',
        createdAtMs: Date.now(),
      })
      .catch(() => undefined)
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error: any) {
    if (error?.visible) {
      // Line-availability refusals throw from the pricing loop, which sits
      // ABOVE the claim — so there is nothing to release and the key
      // survives, as a deterministic refusal should (AGL-1697).
      await releasePromotionHolds()
      await releaseStock()
      await claim?.release()
      return res.status(409).json({ error: error.visible })
    }
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule) — nor a merchant's promotion slot (AGL-2453).
    await releasePromotionHolds()
    await releaseStock()
    await claim?.release()
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
