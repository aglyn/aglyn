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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

const PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
  advanced: process.env.STRIPE_PRICE_ADVANCED,
}

/** Annual prices (AGL-269); absent envs make the toggle degrade to 501. */
const YEARLY_PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER_YEARLY,
  pro: process.env.STRIPE_PRICE_PRO_YEARLY,
  business: process.env.STRIPE_PRICE_BUSINESS_YEARLY,
  advanced: process.env.STRIPE_PRICE_ADVANCED_YEARLY,
}

/**
 * Creates a Stripe Checkout session for a plan upgrade. Uses Stripe's REST
 * API directly (no SDK dependency); degrades to 501 when Stripe isn't
 * configured so the Billing UI can message it. Auth: Firebase ID token in
 * the Authorization header; the tenant doc is keyed by the caller's uid
 * (billing v1 single-user tenancy).
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secretKey = process.env.STRIPE_SECRET_KEY
  const plan = String(body?.plan ?? '')
  // Billing interval (AGL-269): 'year' maps to the *_YEARLY price ids.
  const interval = body?.interval === 'year' ? 'year' : 'month'
  const priceId =
    interval === 'year' ? YEARLY_PRICE_ENV[plan] : PRICE_ENV[plan]
  if (!secretKey || !priceId) {
    return Response.json({
      error:
        'Billing is not configured (missing STRIPE_SECRET_KEY / price ids).',
    }, { status: 501 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // Org metadata (AGL-445): orgId is the only billing key — the webhook
    // mirrors the subscription onto this org doc. Explicit orgId from
    // the workspace-scoped console wins; otherwise the user's first org.
    const orgMembership = await resolveOrgMembership(
      decoded.uid,
      String(body?.orgId ?? '') || null,
    )
    if (!orgMembership) {
      return Response.json({ error: 'No workspace to bill' }, { status: 403 })
    }
    const orgId = orgMembership.orgId
    // Opening a checkout session commits the org to a plan/charge, so it is
    // billing.manage-gated (AGL-511) like subscription management — not just
    // any-member as before.
    if (
      !(await memberHasOrgPermission(orgId, orgMembership.member, 'billing.manage'))
    ) {
      return Response.json({ error: 'billing.manage required' }, { status: 403 })
    }
    const origin = headers.origin ?? `https://${headers.host}`

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${origin}/org/billing?status=success`,
      cancel_url: `${origin}/org/billing?status=canceled`,
      client_reference_id: orgId,
      'subscription_data[metadata][orgId]': orgId,
      'subscription_data[metadata][plan]': plan,
      ...(decoded.email ? { customer_email: decoded.email } : {}),
    })

    // Attach the shared metered price (AGL-635) as a second subscription
    // item so usage overage — storage AND API requests, both reported to
    // the aglyn_metered_usage Billing Meter by the report-usage cron —
    // actually lands on the invoice. Metered prices carry no quantity in
    // Checkout, and the item bills $0 until usage is reported, so it is safe
    // on every paid plan. Absent env (Stripe unprovisioned) → plan-only.
    const meteredPriceId = process.env.STRIPE_PRICE_METERED
    if (meteredPriceId) {
      params.set('line_items[1][price]', meteredPriceId)
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const session = (await response.json()) as { url?: string; error?: any }
    if (!response.ok || !session.url) {
      console.error('Stripe checkout error', session.error)
      return Response.json({ error: 'Stripe checkout failed' }, { status: 502 })
    }
    return Response.json({ url: session.url }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Checkout failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
