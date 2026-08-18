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

/**
 * Is Stripe still able to tell us about money? (AGL-1924)
 *
 * Nothing paged when payments or webhook deliveries started failing, and the
 * billing path is the one subsystem where a failure nobody notices converts
 * directly into lost revenue — one support incident per affected customer.
 * The history is not hypothetical: AGL-1551 (every delivery rejected for a
 * week behind a green "Active" badge), AGL-1560, AGL-1552, AGL-1798. None of
 * them would have paged anyone.
 *
 * This speaks the same 200/503 contract as the sibling health endpoints, so
 * the AGL-1502 uptime check + alert + email path that already watches serving
 * also watches billing. The verdict logic is `billingWebhookHealth` in the
 * shared health lib, spec-covered branch by branch, including why it cannot
 * false-page on a quiet night.
 *
 * ## The two facts it reads, and why they come from Stripe
 *
 * `stripeEvents` alone cannot answer this: the webhook returns 400 BEFORE
 * claiming the idempotency document, so a rejected delivery writes nothing
 * and an empty collection is indistinguishable from a totally broken
 * endpoint. Stripe holds the denominator.
 *
 * 1. `GET /v1/webhook_endpoints` — is our production destination still
 *    present and enabled? A destination deleted or switched off in the
 *    dashboard stops Stripe attempting at all, so no delivery-based rule
 *    would ever see it.
 * 2. `GET /v1/events?delivery_success=false` — what did Stripe attempt and
 *    fail to deliver inside the window? This is the count that goes red on
 *    the AGL-1551 and AGL-1560 shapes, and it reads zero on a night with no
 *    activity, so quiet is never mistaken for broken.
 *
 * A third number, the count of events our handler actually claimed, is read
 * from `stripeEvents` and REPORTED but never gated on — see the lib for why
 * inventing a floor before the beta produces a baseline would be a threshold
 * nobody could defend.
 *
 * ## Not a duplicate of the AGL-1906 audit
 *
 * `tools/scripts/audit-stripe-webhook-health.mjs` is the point-in-time,
 * run-by-hand evidence gatherer, and it asserts the full subscribed-event
 * list. This is the standing alarm for the two facts that move continuously.
 * The event list is deliberately not copied here.
 *
 * ## READ-ONLY, and it stays that way by construction
 *
 * Two GETs to Stripe and one Firestore aggregation. It never writes, never
 * creates, never touches a customer or a subscription. This route lives
 * OUTSIDE `app/api/billing/` on purpose: it is a monitoring probe that reads
 * billing, not part of the billing surface.
 *
 * Same three rules as every sibling — never cached, checks the real thing,
 * cost-bounded: the probe is memoised per instance, which is what stops a
 * public unauthenticated endpoint from turning into a Stripe rate-limit
 * problem. The body carries COUNTS and a status word — never a customer, an
 * event id, an endpoint secret or a Stripe error message.
 */
import { getApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  billingWebhookHealth,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  meteredPricingHealth,
  WEBHOOK_FAILURE_WINDOW_MINUTES,
  type BillingWebhookCheck,
  type BillingWebhookFacts,
} from '@aglyn/aglyn/server'
// Read through the SAME helper the attach paths use (AGL-1931). A guard that
// reads its own copy of the env key names is a guard that keeps reporting
// green after somebody renames one — it would be asserting its own literals,
// not the configuration the checkout actually resolves.
import { meteredPriceId } from '../../../../utils/server/billing-addons'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Five minutes bounds the Stripe call volume (two GETs per probe, so ~576
 * requests a day against a 100/s account limit) without letting a broken
 * webhook hide longer than one monitor interval.
 */
const PROBE_TTL_MS = 5 * 60_000

/** Stripe's own timeout, so a slow API cannot hold the health check open. */
const STRIPE_TIMEOUT_MS = 6_000

/**
 * The production destination. Overridable so a staging account can be pointed
 * somewhere else without a code change, and so the forced-failure knob exists
 * (point it at a URL Stripe does not hold and every probe reports
 * `endpoint-missing` — the way this alert path was proven red).
 */
function webhookUrl(): string {
  return (
    process.env['STRIPE_WEBHOOK_URL'] ?? 'https://app.aglyn.com/api/billing/webhook'
  )
}

async function stripeGet(
  path: string,
  key: string,
): Promise<{ ok: boolean; data: { data?: unknown[] } }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    // GET only, hard-coded: this file must never be able to write to Stripe.
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  })
  if (!response.ok) return { ok: false, data: {} }
  return { ok: true, data: (await response.json()) as { data?: unknown[] } }
}

/**
 * How many webhook events our handler actually claimed in the window.
 *
 * An aggregation over the automatic single-field `receivedAt` index — one
 * integer, zero documents read, so there is nothing here to leak or to pay
 * for. The webhook DELETES the claim when a handler throws, so this counts
 * successes only, which is what makes it worth reporting next to Stripe's
 * count.
 *
 * Returns null rather than throwing: a Firestore hiccup must not turn the
 * Stripe verdict — the one that actually answers the question — into a red.
 */
async function processedInWindow(cutoffMs: number): Promise<number | null> {
  try {
    void firebaseAdmin
    const db = getFirestore(getApp())
    const snapshot = await db
      .collection('stripeEvents')
      .where('receivedAt', '>=', Timestamp.fromMillis(cutoffMs))
      .count()
      .get()
    return snapshot.data().count
  } catch {
    return null
  }
}

const billingProbe = memoizeWithTtl<BillingWebhookCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    const key = process.env['STRIPE_SECRET_KEY']
    // No key means this deployment cannot see billing at all, which is not a
    // healthy state to report from a probe whose whole job is billing.
    if (!key) return billingWebhookHealth(null, Date.now() - startedAt)

    const cutoffMs = Date.now() - WEBHOOK_FAILURE_WINDOW_MINUTES * 60_000
    const createdGte = Math.floor(cutoffMs / 1000)
    try {
      const [endpoints, failures, emitted] = await Promise.all([
        stripeGet('webhook_endpoints?limit=100', key),
        stripeGet(
          `events?limit=100&delivery_success=false&created[gte]=${createdGte}`,
          key,
        ),
        stripeGet(`events?limit=100&created[gte]=${createdGte}`, key),
      ])
      // Any arm failing means the census is incomplete, and an incomplete
      // census reports `unknown`, never `pass` — the AGL-1906 rule.
      if (!endpoints.ok || !failures.ok || !emitted.ok) {
        return billingWebhookHealth(null, Date.now() - startedAt)
      }

      const url = webhookUrl()
      const match = (endpoints.data.data ?? []).find(
        (entry) => (entry as { url?: string })?.url === url,
      ) as { status?: string } | undefined
      const facts: BillingWebhookFacts = {
        endpointStatus: !match
          ? 'missing'
          : match.status === 'enabled'
            ? 'enabled'
            : 'disabled',
        undelivered: (failures.data.data ?? []).length,
        emitted: (emitted.data.data ?? []).length,
        processed: await processedInWindow(cutoffMs),
      }
      return billingWebhookHealth(facts, Date.now() - startedAt)
    } catch {
      // Codes, not messages: this body is public and a Stripe error can carry
      // account identifiers.
      return billingWebhookHealth(null, Date.now() - startedAt)
    }
  },
)

/**
 * Pure env read — no network, no memoisation needed (AGL-1931).
 *
 * Deliberately NOT inside `billingProbe`'s 5-minute TTL: that memo exists to
 * bound Stripe call volume, and folding a free check into it would mean a
 * corrected env var still reported red for five minutes after the redeploy
 * that fixed it.
 */
function meteredPricingProbe() {
  const startedAt = Date.now()
  return meteredPricingHealth(
    {
      stripeConfigured: Boolean(process.env['STRIPE_SECRET_KEY']),
      monthly: Boolean(meteredPriceId('month')),
      yearly: Boolean(meteredPriceId('year')),
    },
    Date.now() - startedAt,
  )
}

export async function GET(): Promise<Response> {
  const checks = {
    billingWebhook: await billingProbe(),
    meteredPricing: meteredPricingProbe(),
  }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-billing',
      checks,
      commit: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
      environment: process.env['VERCEL_ENV'] ?? 'development',
      region: process.env['VERCEL_REGION'] ?? null,
    }),
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/** Cheap liveness for monitors that only issue HEAD. Touches nothing. */
export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: healthHeaders('ok'),
  })
}
