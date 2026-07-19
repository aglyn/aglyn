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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { requireActiveMember } from './membership'

/**
 * Subscriber self-service (AGL-303): opens the Stripe Billing Portal for
 * the signed-in member's storefront subscription (cancel, switch
 * payment method). Member-gated; the portal customer is matched by the
 * member's email through the recorded subscription doc.
 */
export const subscriptionPortalHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ error: 'Billing is not configured.' })
  }
  const hostId = String(req.body?.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  try {
    // Suspension gate (AGL-550): suspended members (AGL-546) cannot
    // open the billing portal — 403'd with the session cookie cleared.
    const auth = await requireActiveMember(req, res, hostId)
    if (!auth) return
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const email = String(auth.member.get('email') ?? '')
    if (!email) return res.status(401).json({ error: 'Not signed in' })
    const subscriptions = await hostRef
      .collection('subscriptions')
      .where('customerEmail', '==', email)
      .limit(1)
      .get()
    const customerId = subscriptions.docs[0]?.get('stripeCustomerId')
    if (!customerId) {
      return res.status(404).json({ error: 'No subscription found' })
    }
    const referer = String(req.headers.referer ?? '')
    const origin = `https://${req.headers.host}`
    const response = await fetch(
      'https://api.stripe.com/v1/billing_portal/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          customer: String(customerId),
          return_url: referer.startsWith('http') ? referer : origin,
        }).toString(),
      },
    )
    const session = await response.json()
    if (!response.ok || !session.url) {
      console.error('Portal error', session?.error)
      return res.status(502).json({ error: 'Portal unavailable' })
    }
    return res.status(200).json({ url: session.url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Portal unavailable' })
  }
}
