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

import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'

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
 * Merchant payments onboarding (AGL-284): Stripe Connect Express for
 * storefront selling. Same account storage the checkout reads
 * (`profiles/{ownerUid}.stripeAccountId`, AGL-46) but without the
 * community-profile prerequisite — commerce merchants aren't necessarily
 * publishers. Only the owning org's owner may onboard (payouts land on
 * their account). 501 without Stripe env.
 */
export const connectHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(501)
      .json({ error: 'Payments are not configured (STRIPE_SECRET_KEY).' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const ownerOrg = await getOrgForHost(hostId)
    const ownerUid = ownerOrg?.org?.ownerUid
    if (!ownerUid) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    if (String(ownerUid) !== decoded.uid) {
      return res
        .status(403)
        .json({ error: 'Only the organization owner can set up payments' })
    }
    const firestore = firebaseAdmin.app().firestore()
    const profileRef = firestore.collection('profiles').doc(decoded.uid)
    const profileSnapshot = await profileRef.get()

    let accountId = profileSnapshot.get('stripeAccountId') as
      | string
      | undefined
    if (!accountId) {
      const account = await stripe(
        'accounts',
        new URLSearchParams({
          type: 'express',
          'metadata[profileId]': decoded.uid,
          'metadata[purpose]': 'commerce',
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
    // Stripe bakes these into the onboarding link, so they have to be real
    // console paths. They were `/{hostDocId}/products` — the pre-AGL-621/622
    // shape — so finishing Connect onboarding dropped the seller on a 404
    // (AGL-685). Console products is the plugin route under the org slug and
    // the host SUBDOMAIN, both of which have to be resolved here; the client
    // hook (useConsoleHostRoute) is not available to server code.
    const index = await firebaseAdmin
      .app()
      .firestore()
      .collection('hostIndex')
      .doc(hostId)
      .get()
    const subdomain = index.get('subdomain') as string | undefined
    const orgSlug = ownerOrg?.org?.slug as string | undefined
    // No slug/subdomain means no route to send them to; Stripe requires
    // both URLs, so fall back to the origin root rather than a fabricated
    // path that 404s.
    const productsUrl =
      orgSlug && subdomain
        ? `${origin}${buildRoute(Route.HOST_PLUGIN, {
            orgSlug,
            host: subdomain,
            pluginSlug: 'products',
          })}`
        : origin
    const link = await stripe(
      'account_links',
      new URLSearchParams({
        account: accountId as string,
        type: 'account_onboarding',
        refresh_url: `${productsUrl}?connect=refresh`,
        return_url: `${productsUrl}?connect=done`,
      }),
    )
    return res
      .status(200)
      .json({ accountId, chargesEnabled: false, url: link.url })
  } catch (error) {
    console.error(error)
    return res.status(502).json({ error: 'Payment setup failed' })
  }
}
