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
  resolveMarketplaceFeePct,
  Route,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  canActAsPublisher,
  resolvePublisherProfile,
} from './publisher-profile'

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
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

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
      success_url: `${origin}${returnPath}?purchase=success`,
      cancel_url: `${origin}${returnPath}?purchase=canceled`,
      client_reference_id: decoded.uid,
      'metadata[type]': 'marketplace-purchase',
      'metadata[listingId]': listingId,
      'metadata[buyerUid]': decoded.uid,
      'metadata[sellerOrgId]': sellerOrgId,
      'metadata[feeCents]': String(feeCents),
      'metadata[transferCents]': String(transferCents),
      ...(decoded.email ? { customer_email: decoded.email } : {}),
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
      return res.status(502).json({ error: 'Stripe checkout failed' })
    }
    return res.status(200).json({ url: session.url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
