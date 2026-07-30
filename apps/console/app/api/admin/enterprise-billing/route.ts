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
import { PLAN_PRICING } from '@aglyn/aglyn/server'
import type { OrgPlan } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * Enterprise custom-billing provisioning (AGL-1110) — the staff door that
 * makes onboarding a custom-priced enterprise org fully native to Aglyn, with
 * no trip to the Stripe dashboard. Given a monthly amount, a billing interval,
 * and the base plan the deal maps to, it:
 *
 *   1. creates (or reuses) a per-org Stripe Product "Enterprise — {org}",
 *   2. creates an ad-hoc recurring Price on it (annual bills 12× the monthly),
 *   3. and provisions the deal one of two ways:
 *        - `mode: 'invoice'`  — creates the subscription now on send-invoice
 *          collection (net terms; no card needed), so capability applies
 *          immediately and Stripe bills by invoice.
 *        - `mode: 'checkout'` — returns a Checkout link to send the customer,
 *          who enters payment themselves; the webhook activates it.
 *
 * Every Stripe object is stamped `metadata.custom='true'` + `plan` + `orgId`,
 * so the billing webhook (AGL-1110) mirrors the amount onto
 * `org.subscription.customMonthlyUsd` and `orgMonthlyRevenueUsd` reports the
 * real figure. For `invoice` mode the org's plan/subscription are also written
 * optimistically so staff see capability without waiting for the webhook.
 *
 * StaffGuard-gated (staff claim); 501 without Stripe env; audited to
 * `adminAudit`. Uses Stripe's REST API directly (no SDK), like the coupons and
 * report-usage routes.
 */
async function stripe(
  secretKey: string,
  path: string,
  params?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

/** Find this org's existing "Enterprise — …" product, or create one. */
async function enterpriseProduct(
  secretKey: string,
  orgId: string,
  orgName: string,
): Promise<{ ok: boolean; productId?: string; error?: string }> {
  // Products can't be queried by metadata via the core list, so search.
  const search = await stripe(
    secretKey,
    `products/search?query=${encodeURIComponent(
      `active:'true' AND metadata['orgId']:'${orgId}' AND metadata['custom']:'true'`,
    )}`,
  )
  const existing = search.ok ? (search.body?.data ?? [])[0] : null
  if (existing?.id) return { ok: true, productId: existing.id }

  const created = await stripe(secretKey, 'products', {
    name: `Enterprise — ${orgName}`.slice(0, 250),
    'metadata[orgId]': orgId,
    'metadata[custom]': 'true',
  })
  if (!created.ok) {
    return {
      ok: false,
      error: created.body?.error?.message ?? 'Product creation failed',
    }
  }
  return { ok: true, productId: created.body.id }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 501 })
  }

  const orgId = String(body?.orgId ?? '')
  const amountMonthlyUsd = Number(body?.amountMonthlyUsd)
  const interval = body?.interval === 'year' ? 'year' : 'month'
  const plan = String(body?.plan ?? '') as OrgPlan
  const mode = body?.mode === 'checkout' ? 'checkout' : 'invoice'
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
  if (!(amountMonthlyUsd > 0)) {
    return Response.json(
      { error: 'amountMonthlyUsd must be greater than 0' },
      { status: 400 },
    )
  }
  if (!PLAN_PRICING[plan] || plan === 'free') {
    return Response.json(
      { error: 'Provide a valid paid base plan for the enterprise deal' },
      { status: 400 },
    )
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnap = await orgRef.get()
    if (!orgSnap.exists) {
      return Response.json({ error: 'No such org' }, { status: 404 })
    }
    const orgData = orgSnap.data() as any
    const orgName = String(orgData?.displayName ?? orgId)
    let customerId = orgData?.stripeCustomerId as string | undefined

    // A Stripe customer is required to invoice or check out. Mint one if the
    // org has never billed (enterprise orgs often start on free).
    if (!customerId) {
      const customer = await stripe(secretKey, 'customers', {
        name: orgName,
        'metadata[orgId]': orgId,
      })
      if (!customer.ok) {
        return Response.json(
          { error: customer.body?.error?.message ?? 'Customer creation failed' },
          { status: 502 },
        )
      }
      customerId = customer.body.id as string
      await orgRef.set({ stripeCustomerId: customerId }, { merge: true })
    }

    // Per-org product + ad-hoc recurring price. Annual bills 12× the monthly
    // figure; the webhook normalizes it back to monthly for MRR.
    const product = await enterpriseProduct(secretKey, orgId, orgName)
    if (!product.ok) {
      return Response.json({ error: product.error }, { status: 502 })
    }
    const unitAmountCents = Math.round(
      amountMonthlyUsd * (interval === 'year' ? 12 : 1) * 100,
    )
    const price = await stripe(secretKey, 'prices', {
      product: product.productId!,
      currency: 'usd',
      unit_amount: String(unitAmountCents),
      'recurring[interval]': interval,
      'metadata[orgId]': orgId,
      'metadata[custom]': 'true',
      'metadata[plan]': plan,
      'metadata[monthlyUsd]': String(amountMonthlyUsd),
    })
    if (!price.ok) {
      return Response.json(
        { error: price.body?.error?.message ?? 'Price creation failed' },
        { status: 502 },
      )
    }
    const priceId = price.body.id as string

    let result: Record<string, unknown> = { priceId, mode }

    if (mode === 'checkout') {
      const origin =
        headers.origin ??
        process.env.NEXT_PUBLIC_APP_URL ??
        'https://app.aglyn.com'
      const session = await stripe(secretKey, 'checkout/sessions', {
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        success_url: `${origin}/admin/orgs/${orgId}?enterprise=done`,
        cancel_url: `${origin}/admin/orgs/${orgId}?enterprise=canceled`,
        'subscription_data[metadata][orgId]': orgId,
        'subscription_data[metadata][plan]': plan,
        'subscription_data[metadata][custom]': 'true',
      })
      if (!session.ok) {
        return Response.json(
          { error: session.body?.error?.message ?? 'Checkout link failed' },
          { status: 502 },
        )
      }
      result = { ...result, checkoutUrl: session.body.url }
    } else {
      // Invoice mode: create the subscription now on send-invoice collection
      // (net-30). Capability applies immediately; Stripe bills by invoice.
      const subscription = await stripe(secretKey, 'subscriptions', {
        customer: customerId,
        'items[0][price]': priceId,
        collection_method: 'send_invoice',
        days_until_due: '30',
        'metadata[orgId]': orgId,
        'metadata[plan]': plan,
        'metadata[custom]': 'true',
        'expand[0]': 'latest_invoice',
      })
      if (!subscription.ok) {
        return Response.json(
          {
            error:
              subscription.body?.error?.message ?? 'Subscription creation failed',
          },
          { status: 502 },
        )
      }
      const sub = subscription.body
      // Optimistic mirror so staff see capability without waiting for the
      // webhook; the webhook reconciles from Stripe as the source of truth.
      await orgRef.set(
        {
          plan,
          subscription: {
            status: sub.status ?? 'active',
            priceId,
            interval,
            customMonthlyUsd: Math.round(amountMonthlyUsd * 100) / 100,
            currentPeriodEnd: sub.current_period_end
              ? new Date(sub.current_period_end * 1000)
              : null,
          },
        },
        { merge: true },
      )
      result = {
        ...result,
        subscriptionId: sub.id,
        status: sub.status,
        hostedInvoiceUrl: sub.latest_invoice?.hosted_invoice_url ?? null,
      }
    }

    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: 'org.enterprise.provision',
      target: `orgs/${orgId}`,
      before: { plan: orgData?.plan ?? null },
      after: {
        plan,
        amountMonthlyUsd,
        interval,
        mode,
        priceId,
        customerId,
      },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })

    return Response.json({ ok: true, ...result }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Enterprise billing request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
