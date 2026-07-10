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

import {
  COMMUNITY_PLATFORM_FEE_PERCENT,
  COMMUNITY_PLATFORM_FEE_PERCENT_FREE_PLAN,
} from '@aglyn/aglyn'
import { firebaseAdmin, getOrgForUser } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Checkout for a paid community listing (AGL-46): one-time destination
 * charge to the publisher's Express account with the platform fee taken
 * automatically (20%, 30% for free-plan publishers). The webhook writes the
 * purchase record on `checkout.session.completed`; install stays gated on
 * that record. 501 without Stripe env.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
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

  const authorization = req.headers.authorization ?? ''
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
    if (listing.profileId === decoded.uid) {
      return res.status(400).json({ error: 'You published this listing' })
    }
    const profileSnapshot = await firestore
      .collection('profiles')
      .doc(listing.profileId)
      .get()
    const accountId = profileSnapshot.get('stripeAccountId')
    if (!accountId || !profileSnapshot.get('stripeChargesEnabled')) {
      return res
        .status(409)
        .json({ error: 'The publisher has not enabled payouts yet' })
    }

    // Publisher's plan sets the platform share (free plan pays more);
    // it rides the seller's org doc (AGL-238).
    const sellerOrg = await getOrgForUser(String(listing.profileId))
    const sellerPlan = sellerOrg?.org?.plan ?? 'free'
    const feePercent =
      sellerPlan === 'free'
        ? COMMUNITY_PLATFORM_FEE_PERCENT_FREE_PLAN
        : COMMUNITY_PLATFORM_FEE_PERCENT
    const amountCents = Math.round(priceUsd * 100)
    const feeCents = Math.round((amountCents * feePercent) / 100)

    const origin = req.headers.origin ?? `https://${req.headers.host}`
    const returnPath = hostId ? `/${hostId}/community` : '/manage/community'
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
      'metadata[sellerUid]': String(listing.profileId),
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
