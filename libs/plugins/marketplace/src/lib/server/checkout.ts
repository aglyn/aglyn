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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  buildRoute,
  checkEntitlement,
  claimAttempt,
  resolveMarketplaceFeePct,
  Route,
  type AttemptClaim,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  canActAsPublisher,
  resolvePublisherProfile,
} from './publisher-profile'
import { hasLivePurchase } from './purchase-entitlement'

/**
 * Checkout for a paid marketplace listing (AGL-46): one-time destination
 * charge to the publisher's Express account. The platform's cut comes from
 * the seller org's ENTITLEMENTS (AGL-1543: 20%, 30% effective-free), sales
 * tax is collected platform-side per the marketplace-provider registration
 * (AGL-1544), and the seller receives a fixed transfer of their pre-tax
 * share. The webhook writes the purchase record on
 * `checkout.session.completed`; install stays gated on that record. 501
 * without Stripe env.
 */
export const checkoutHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(501)
      .json({ error: 'Purchases are not configured (STRIPE_SECRET_KEY).' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  // One purchase attempt, minted by the browser (AGL-1697). Node lowercases
  // incoming headers, but read both spellings — the plugin API request type
  // makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  )
    .trim()
    .slice(0, 200)
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  let claim: AttemptClaim | null = null
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const listingSnapshot = await firestore
      .collection('marketplaceListings')
      .doc(listingId)
      .get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    // Review gating holds on the PAID path too (AGL-1543): browse hides
    // rejected/submitted/in_review listings, so a direct checkout call must
    // not be a side door that takes money for one. Absent = legacy = listed
    // (AGL-432), and the same 404 as an unknown listing — purchasability is
    // not a probe for review state.
    const reviewStatus = listing.reviewStatus as string | undefined
    if (reviewStatus && reviewStatus !== 'listed' && reviewStatus !== 'verified') {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    const priceUsd = Number(listing.priceUsd ?? 0)
    if (!(priceUsd > 0)) {
      return res.status(400).json({ error: 'Listing is free' })
    }
    // Publishing is org-owned (AGL-652): `profileId` IS the publisher org id.
    const sellerOrgId = String(listing.profileId ?? '')
    if (await canActAsPublisher(firestore, decoded.uid, sellerOrgId)) {
      return res.status(400).json({ error: 'Your organization published this listing' })
    }
    // You cannot buy the same component twice (AGL-1697).
    //
    // This route validated review status, self-purchase and the seller's
    // entitlements, and then never asked the one question the buyer cares
    // about: do they already own it. A marketplace listing is a buy-once good —
    // a second purchase buys nothing, since `requirePurchase` is satisfied by
    // the first — so a buyer who clicked Buy again from a stale tab, or came
    // back through a bookmarked checkout, was simply charged twice for it.
    //
    // Deliberately the SAME predicate the seven install routes gate on
    // (AGL-1546/1699) rather than a second query beside it: "has this buyer
    // paid for this listing" must have one answer, or the marketplace can take
    // money for something it will not install, or refuse to sell something it
    // will not install either. That predicate reads a fully REFUNDED purchase
    // as absent, which is exactly right here too — a refunded buyer must be
    // able to buy again, and a refunded row sitting beside a live one does not
    // veto it.
    //
    // 409 rather than 400: nothing about the request is malformed, the buyer
    // is just asking for a state that already holds.
    if (await hasLivePurchase({ firestore, buyerUid: decoded.uid, listingId })) {
      return res.status(409).json({
        error: 'You already own this listing — install it from your library.',
        code: 'already_purchased',
      })
    }
    const publisher = await resolvePublisherProfile(firestore, sellerOrgId)
    const accountId = publisher?.stripeAccountId
    if (!accountId || !publisher?.stripeChargesEnabled) {
      return res
        .status(409)
        .json({ error: 'The publisher has not enabled payouts yet' })
    }

    // The platform's cut comes from ENTITLEMENTS (AGL-1543), never the raw
    // `plan` field: `resolveMarketplaceFeePct` prices a dead subscription
    // as free-plan (30%) while the stale field still says pro, and honors
    // a negotiated per-org `marketplaceFeePct` override. Same read gates
    // SALE time on `marketplaceSelling` — publish already refuses without
    // it, and a publisher who downgrades must stop selling, not merely
    // stop publishing. Resolved per request; entitlements are never cached.
    const sellerOrgDoc = await firestore.collection('orgs').doc(sellerOrgId).get()
    const sellerOrg = (sellerOrgDoc.data() ?? {}) as any
    if (!checkEntitlement(sellerOrg, 'marketplaceSelling')) {
      return res.status(409).json({
        error:
          "The publisher's current plan does not include marketplace selling",
      })
    }
    const feePercent = resolveMarketplaceFeePct(sellerOrg)
    const amountCents = Math.round(priceUsd * 100)
    const feeCents = Math.round((amountCents * feePercent) / 100)

    const origin = req.headers.origin ?? `https://${req.headers.host}`
    // Stripe returns the BUYER to the org marketplace (AGL-775) — the
    // per-site marketplace page it used to land on was retired. Only the
    // buyer's org slug is needed now (`sellerOrgId` is the wrong org), and
    // it's resolved from the host here since server code cannot call
    // useConsoleHostRoute. `/manage/marketplace` is the hostless fallback.
    const buyerIndex = hostId
      ? await firestore.collection('hostIndex').doc(hostId).get()
      : null
    const buyerOrgId = buyerIndex?.get('orgId') as string | undefined
    const buyerOrgSlug = buyerOrgId
      ? ((await firestore.collection('orgs').doc(buyerOrgId).get()).get(
          'slug',
        ) as string | undefined)
      : undefined
    const returnPath = buyerOrgSlug
      ? buildRoute(Route.ORG_MARKETPLACE, { orgSlug: buyerOrgSlug })
      : Route.ORG_MARKETPLACE
    // Tax + funds flow (AGL-1544). Aglyn registered as a marketplace
    // provider with the Texas Comptroller: it collects and remits sales tax
    // on sellers' behalf. That is the PLATFORM's charge — no `on_behalf_of`,
    // `automatic_tax` on the platform session, tax added ON TOP of the
    // listing price (`tax_behavior: exclusive`) with a full billing address
    // to compute from. The transfer is a FIXED amount (the seller's share of
    // the pre-tax price) rather than `application_fee_amount`, because the
    // fee form makes Stripe transfer `amount_total − fee` — and amount_total
    // includes the tax, which must stay with the platform that owes it.
    const transferCents = amountCents - feeCents
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][tax_behavior]': 'exclusive',
      'line_items[0][price_data][product_data][name]': String(
        listing.displayName ?? 'Marketplace component',
      ).slice(0, 120),
      'automatic_tax[enabled]': 'true',
      billing_address_collection: 'required',
      'payment_intent_data[transfer_data][destination]': String(accountId),
      'payment_intent_data[transfer_data][amount]': String(transferCents),
      // THE DISCRIMINATOR THE REFUND DOOR HAS NO OTHER WAY TO GET (AGL-2148).
      //
      // `metadata[type]` below rides on the SESSION, and `charge.refunded`
      // never sees a session — its object is the charge. The platform
      // endpoint receives `charge.refunded` for storefront orders and
      // subscription charges too, so the webhook cannot tell a marketplace
      // refund from any other one except by joining on the payment intent,
      // which is exactly the join that comes up empty during the window this
      // metadata exists to close (the purchase document is written by
      // `checkout.session.completed`, and that delivery retries).
      //
      // Stripe copies a PaymentIntent's metadata onto the charge it creates,
      // so stamping it here makes `charge.metadata.type` readable straight
      // off the refund event — no Firestore join, no Stripe round trip, and
      // no orphan record written for the commerce and subscription refunds
      // that share this endpoint.
      //
      // `listingId`/`buyerUid` ride along for forensics only: an orphan that
      // never drains is a support case, and the payment intent alone does not
      // say whose purchase of what it was.
      'payment_intent_data[metadata][type]': 'marketplace-purchase',
      'payment_intent_data[metadata][listingId]': listingId,
      'payment_intent_data[metadata][buyerUid]': decoded.uid,
      success_url: `${origin}${returnPath}?purchase=success`,
      cancel_url: `${origin}${returnPath}?purchase=canceled`,
      client_reference_id: decoded.uid,
      'metadata[type]': 'marketplace-purchase',
      'metadata[listingId]': listingId,
      'metadata[buyerUid]': decoded.uid,
      'metadata[sellerOrgId]': sellerOrgId,
      'metadata[feeCents]': String(feeCents),
      'metadata[transferCents]': String(transferCents),
      // The buyer's GA client id (AGL-1638), so the server-side `purchase`
      // the webhook sends joins the browser session that produced it. The
      // webhook has always READ `metadata.ga_client_id`; nothing wrote it,
      // so the read was dead and every marketplace sale fell through to a
      // synthesized, sessionless GA user — making plugin revenue permanently
      // unattributable to any channel.
      //
      // Carried on the SESSION rather than a subscription because this is a
      // one-time payment; `checkout.session.completed` is where it is read.
      //
      // Validated to GA's `<digits>.<digits>` shape and dropped otherwise:
      // the value is client-supplied and ends up in Stripe metadata, so it is
      // not accepted on trust. Same guard /api/billing/checkout applies.
      ...(/^\d+\.\d+$/.test(String(req.body?.gaClientId ?? ''))
        ? { 'metadata[ga_client_id]': String(req.body.gaClientId) }
        : {}),
      ...(decoded.email ? { customer_email: decoded.email } : {}),
    })
    // Point of no return (AGL-1697). The purchase check above closes the
    // SEQUENTIAL duplicate — a second buy after the webhook has written the
    // first purchase — and cannot close the concurrent one, because between two
    // clicks a second apart there is no purchase record yet to find. The claim
    // is what covers that window: `create()` on a document Firestore refuses to
    // create twice.
    //
    // Scoped to the listing AND the buyer, so two people buying the same
    // component at the same moment never contend, and one person's two tabs
    // always do.
    //
    // The claim is taken here rather than at the top so that every deterministic
    // refusal above it — unknown listing, free listing, self-purchase, already
    // owned, publisher not paid out, seller cannot sell — answers without
    // burning the key. Those are all states a buyer or publisher fixes and then
    // presses the same button again.
    const claimed = await claimAttempt(firestore, {
      kind: 'marketplace-checkout',
      scopeId: `${listingId}:${decoded.uid}`,
      // The BUYER's org, so `eraseOrgIdempotencyKeys` sweeps this with the
      // buyer's data (AGL-1448) — the seller keeps the sale.
      orgId: buyerOrgId ?? '',
      key: idempotencyKey,
      busyMessage: 'This purchase is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // The half that costs real money. Stripe replays the existing
          // session for a repeated key instead of opening a second one, which
          // covers the window where our own claim is written but the response
          // never arrives — the failure this route was most exposed to, since
          // it writes nothing of its own to reconcile against.
          ...(claim.stripeKey ? { 'Idempotency-Key': claim.stripeKey } : {}),
        },
        body: params.toString(),
      },
    )
    const session = (await response.json()) as { url?: string; error?: any }
    if (!response.ok || !session.url) {
      console.error('Stripe checkout error', session.error)
      // The purchase did not start — let the same key be tried again rather
      // than locking this buyer out of this listing over one flaky moment.
      await claim.release()
      return res.status(502).json({ error: 'Stripe checkout failed' })
    }
    const payload = { url: session.url }
    // A repeat of this attempt now replays the SAME session url. Better than
    // refusing it: the buyer lands back on the checkout they already had open.
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // and lock the buyer out of this listing until they reload.
    await claim?.release()
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
