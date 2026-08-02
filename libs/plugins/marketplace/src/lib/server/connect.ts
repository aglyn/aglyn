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

import { firebaseAdmin, getOrgForUser } from '@aglyn/tenant-data-admin'
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'
import { canActAsPublisher } from './publisher-profile'

async function stripe(path: string, params?: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(params && {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    },
    ...(params && { body: params.toString() }),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe ${path} failed`)
  }
  return payload
}

/**
 * Stripe Connect onboarding for marketplace publishers (AGL-46): creates an
 * Express account on first call (id stored on the profile via Admin SDK),
 * refreshes `stripeChargesEnabled` on every call, and returns an
 * account-link URL while onboarding is incomplete. 501 without Stripe env.
 */
export const connectHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(501)
      .json({ error: 'Payouts are not configured (STRIPE_SECRET_KEY).' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    // Payouts belong to the publishing ORG (AGL-652) — the marketplace pays
    // the organization that published, not whoever set the account up. Only
    // a manager may bind a payout destination.
    //
    // The acting org comes from the client (AGL-861): the URL is the source of
    // truth for which workspace the seller is in, and a member can belong to
    // several. Guessing with `getOrgForUser(uid)` returned the FIRST org from
    // the reverse index, so the profile check ran against the wrong org and
    // 412'd even when the acting org's profile was fully set up. Passing the
    // requested org resolves membership for that specific org; falling back to
    // the first only when the client omits it keeps older callers working.
    const requestedOrgId =
      String((req.body as { orgId?: string } | undefined)?.orgId ?? '').trim() ||
      undefined
    const orgForUser = await getOrgForUser(decoded.uid, requestedOrgId)
    const orgId = orgForUser?.orgId
    if (!orgId || !(await canActAsPublisher(firestore, decoded.uid, orgId))) {
      return res.status(403).json({
        error: 'Only an organization owner or admin can set up payouts',
      })
    }
    const profileRef = firestore.collection('publisherProfiles').doc(orgId)
    const profileSnapshot = await profileRef.get()
    if (!profileSnapshot.exists) {
      return res.status(412).json({
        error:
          'Set up your publisher profile first — Marketplace → Profile.',
      })
    }

    let accountId = profileSnapshot.get('stripeAccountId') as
      | string
      | undefined
    if (!accountId) {
      const account = await stripe(
        'accounts',
        new URLSearchParams({
          type: 'express',
          'metadata[publisherOrgId]': orgId,
          ...(decoded.email ? { email: decoded.email } : {}),
        }),
      )
      accountId = account.id
      await profileRef.set(
        { stripeAccountId: accountId, stripeChargesEnabled: false },
        { merge: true },
      )
    }

    const account = await stripe(`accounts/${accountId}`)
    const chargesEnabled = Boolean(account?.charges_enabled)
    await profileRef.set(
      { stripeChargesEnabled: chargesEnabled },
      { merge: true },
    )
    if (chargesEnabled) {
      return res.status(200).json({ accountId, chargesEnabled: true })
    }

    const origin = req.headers.origin ?? `https://${req.headers.host}`
    const orgSlug = (
      await firestore.collection('orgs').doc(orgId).get()
    ).get('slug') as string | undefined
    // Return people to the Marketplace page (AGL-861), not the retired
    // `/[orgSlug]/marketplace` surface. Stripe bakes these URLs into the
    // onboarding link, so an extra redirect hop mid-onboarding is avoidable.
    const payoutsPath = orgSlug
      ? buildRoute(Route.ORG_MARKETPLACE, { orgSlug })
      : Route.ORG_MARKETPLACE
    const link = await stripe(
      'account_links',
      new URLSearchParams({
        account: accountId as string,
        type: 'account_onboarding',
        refresh_url: `${origin}${payoutsPath}?connect=refresh`,
        return_url: `${origin}${payoutsPath}?connect=done`,
      }),
    )
    return res
      .status(200)
      .json({ accountId, chargesEnabled: false, url: link.url })
  } catch (error) {
    console.error(error)
    return res.status(502).json({ error: 'Payout setup failed' })
  }
}
