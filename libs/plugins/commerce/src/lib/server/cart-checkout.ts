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
import { readCartId } from './cart-cookie'
import { resolveManualTaxRateId } from './manual-tax-rate'

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
        snapshot.exists ? CommerceModel.liftLegacyProduct(snapshot.data() as any) : null,
      ]),
    )
    let itemsCents = 0
    let feeCents = 0
    // Weight-tier shipping rates price off this (AGL-1707). Without it every
    // `weight_tiers` rate would resolve at 0g and quote the lightest tier.
    let totalGrams = 0
    // Whether anything in this cart is posted at all (AGL-1721). Buy-now has
    // always resolved shipping for physical products only; the cart never
    // asked, so a cart of downloads could be charged to ship. It matters more
    // now that an unresolvable destination REFUSES: a shopper buying two PDFs
    // must not be asked which country to ship them to.
    let hasPhysicalLine = false
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
      const unitCents = Math.round(Number(variant.priceUsd) * 100)
      itemsCents += unitCents * line.quantity
      totalGrams += Math.max(0, Number(variant.weightGrams ?? 0)) * line.quantity
      // A missing `type` reads as physical, exactly as the fee ladder below
      // reads it — `liftLegacyProduct` only defaults the field on docs it
      // synthesizes variants for, so a part-migrated doc can reach here
      // without one and the two reads must not disagree about what it is.
      if ((product.type ?? 'physical') === 'physical') hasPhysicalLine = true
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

    if (resolvedDiscount && resolvedDiscount.discountCents > 0) {
      const stripeCoupon = await fetch('https://api.stripe.com/v1/coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...stripeKeyHeader('coupon-discount'),
        },
        body: new URLSearchParams({
          amount_off: String(resolvedDiscount.discountCents),
          currency: 'usd',
          duration: 'once',
        }).toString(),
      }).then((response) => response.json())
      if (stripeCoupon?.id) {
        params.set('discounts[0][coupon]', stripeCoupon.id)
        params.set('metadata[discountId]', resolvedDiscount.discountId)
        feeCents = Math.round(
          (feeCents * (itemsCents - resolvedDiscount.discountCents)) /
            Math.max(1, itemsCents),
        )
      }
    }
    // Coupons (AGL-96 semantics): percent off the items total, applied
    // as a Stripe coupon so line prices stay honest.
    if (couponCode && !resolvedDiscount) {
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
        // Deterministic and retryable — the shopper fixes the code and
        // presses the same button, so the key survives (AGL-1697).
        await claim.release()
        return res.status(400).json({ error: 'Invalid or expired coupon' })
      }
      const stripeCoupon = await fetch('https://api.stripe.com/v1/coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...stripeKeyHeader('coupon-code'),
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

    // Gift cards (AGL-322): balance applies as amount-off; the webhook
    // decrements the balance on completion.
    if (giftCardCode) {
      const cardSnapshot = await hostRef
        .collection('giftCards')
        .doc(giftCardCode)
        .get()
      const balanceCents = Number(cardSnapshot.get('balanceCents') ?? 0)
      if (!cardSnapshot.exists || balanceCents <= 0) {
        // Deterministic and retryable, but a discount coupon may already
        // exist by now. Releasing means the retry re-derives the SAME derived
        // key for it, so Stripe replays that coupon rather than minting a
        // twin (AGL-1714's rule).
        await claim.release()
        return res.status(400).json({ error: 'Gift card is empty or invalid' })
      }
      const applyCents = Math.min(balanceCents, itemsCents)
      const stripeCoupon = await fetch('https://api.stripe.com/v1/coupons', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...stripeKeyHeader('coupon-gift'),
        },
        body: new URLSearchParams({
          amount_off: String(applyCents),
          currency: 'usd',
          duration: 'once',
        }).toString(),
      }).then((response) => response.json())
      if (stripeCoupon?.id) {
        params.set('discounts[0][coupon]', stripeCoupon.id)
        params.set('metadata[giftCardCode]', giftCardCode)
        params.set('metadata[giftCardCents]', String(applyCents))
        feeCents = Math.round(
          (feeCents * Math.max(0, itemsCents - applyCents)) /
            Math.max(1, itemsCents),
        )
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
    // Address collection feeds order shipping + destination tax later, and is
    // the enforcing half of the plan above (AGL-1721) — emitted from the
    // plan's own country list, never a default, so it cannot widen past the
    // destinations the declared rates were resolved for. The emission is
    // shared with buy-now (AGL-1720).
    CommerceModel.appendShippingAddressCollectionParams(
      params,
      shippingPlan.countries,
    )
    CommerceModel.appendCheckoutShippingParams(params, shippingPlan.options)

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
    if (taxSettings.mode === 'stripe') {
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
          // The half that costs real money (AGL-1697): Stripe replays the
          // existing session for a repeated key instead of opening a second
          // one, covering the window where the claim is written but the
          // response never arrives.
          ...stripeKeyHeader('session'),
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
      console.error('Stripe cart checkout error', session.error)
      // The checkout did not happen — hand the key back so one flaky moment
      // does not lock this cart out. The retry re-derives the same derived
      // keys, so Stripe replays whatever objects the first run did create.
      await claim.release()
      return res.status(502).json({ error: 'Checkout failed' })
    }
    // Recoverable checkout (AGL-296): email captured before the redirect
    // makes abandonment actionable (AGL-323 sends the recovery emails).
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
    const payload = { url: session.url }
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error: any) {
    if (error?.visible) {
      // Line-availability refusals throw from the pricing loop, which sits
      // ABOVE the claim — so there is nothing to release and the key
      // survives, as a deterministic refusal should (AGL-1697).
      await claim?.release()
      return res.status(409).json({ error: error.visible })
    }
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule).
    await claim?.release()
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
