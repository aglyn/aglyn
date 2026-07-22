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

import { COMMUNITY_PLATFORM_FEE_PERCENT, COMMUNITY_PLATFORM_FEE_PERCENT_FREE_PLAN } from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'
import {
  canActAsPublisher,
  resolvePublisherProfile,
} from './publisher-profile'

/**
 * Checkout for a paid community listing (AGL-46): one-time destination
 * charge to the publisher's Express account with the platform fee taken
 * automatically (20%, 30% for free-plan publishers). The webhook writes the
 * purchase record on `checkout.session.completed`; install stays gated on
 * that record. 501 without Stripe env.
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
      .collection('communityListings')
      .doc(listingId)
      .get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt) {
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

    // Publisher's plan sets the platform share (free plan pays more); read
    // the seller org directly now that profileId is its id (AGL-652).
    const sellerOrgDoc = await firestore.collection('orgs').doc(sellerOrgId).get()
    const sellerPlan = (sellerOrgDoc.get('plan') as string | undefined) ?? 'free'
    const feePercent =
      sellerPlan === 'free'
        ? COMMUNITY_PLATFORM_FEE_PERCENT_FREE_PLAN
        : COMMUNITY_PLATFORM_FEE_PERCENT
    const amountCents = Math.round(priceUsd * 100)
    const feeCents = Math.round((amountCents * feePercent) / 100)

    const origin = req.headers.origin ?? `https://${req.headers.host}`
    // Stripe returns the BUYER to the community page they bought from. This
    // was `/{hostDocId}/community`, the pre-AGL-621/622 shape, so every
    // completed marketplace purchase landed on a 404 (AGL-685). The route
    // needs the buyer's org slug and the host SUBDOMAIN — `sellerOrgId` is
    // the wrong org — and server code cannot call useConsoleHostRoute, so
    // both are resolved from the host here. `/manage/community` (a real
    // route, and the existing hostless fallback) covers the rest.
    const buyerIndex = hostId
      ? await firestore.collection('hostIndex').doc(hostId).get()
      : null
    const buyerSubdomain = buyerIndex?.get('subdomain') as string | undefined
    const buyerOrgId = buyerIndex?.get('orgId') as string | undefined
    const buyerOrgSlug = buyerOrgId
      ? ((await firestore.collection('orgs').doc(buyerOrgId).get()).get(
          'slug',
        ) as string | undefined)
      : undefined
    const returnPath =
      buyerOrgSlug && buyerSubdomain
        ? buildRoute(Route.HOST_COMMUNITY, {
            orgSlug: buyerOrgSlug,
            host: buyerSubdomain,
          })
        : Route.MANAGE_MY_COMMUNITY
    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': String(
        listing.displayName ?? 'Community component',
      ).slice(0, 120),
      'payment_intent_data[application_fee_amount]': String(feeCents),
      'payment_intent_data[transfer_data][destination]': String(accountId),
      success_url: `${origin}${returnPath}?purchase=success`,
      cancel_url: `${origin}${returnPath}?purchase=canceled`,
      client_reference_id: decoded.uid,
      'metadata[type]': 'community-purchase',
      'metadata[listingId]': listingId,
      'metadata[buyerUid]': decoded.uid,
      'metadata[sellerOrgId]': sellerOrgId,
      'metadata[feeCents]': String(feeCents),
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
