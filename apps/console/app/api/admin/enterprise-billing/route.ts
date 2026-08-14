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

import { claimAttempt, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { isOrgSubscriptionLive, PLAN_PRICING } from '@aglyn/aglyn/server'
import type { OrgPlan } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  readOrgBilling,
  writeOrgBilling,
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
 *
 * AGL-1714 — the ninth unkeyed Stripe site, and the only one where a plain
 * retry creates a live subscription with no buyer interaction at all. See
 * `claimAttempt` below for the two layers that close it.
 */
async function stripe(
  secretKey: string,
  path: string,
  params?: Record<string, string>,
  idempotencyKey?: string | null,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      // Stripe documents idempotency keys as having no effect on GET, so only
      // the writes carry one (AGL-1714).
      ...(params && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

/**
 * One Stripe idempotency key per OBJECT this attempt creates (AGL-1714).
 *
 * Stripe's idempotency layer is account-scoped, not endpoint-scoped: it
 * "compares incoming parameters to those of the original request and errors if
 * they're not the same". Sending the claim digest unchanged to `/v1/prices` and
 * then to `/v1/subscriptions` would therefore make the second call fail
 * outright, so each write derives its own key from the one digest. Same shape
 * as the only other Stripe-side key in the repo (`metered-backfill.ts`), which
 * likewise names what it is protecting.
 */
function objectKey(digest: string | null, object: string): string | null {
  return digest ? `${digest}:${object}` : null
}

/** Find this org's existing "Enterprise — …" product, or create one. */
async function enterpriseProduct(
  secretKey: string,
  orgId: string,
  orgName: string,
  idempotencyKey: string | null,
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

  // Keyed too (AGL-1714). The search above is Stripe's search index, which is
  // eventually consistent — two submits a second apart can both miss it — so
  // "reuse if found" is not on its own a guard against a duplicate Product.
  const created = await stripe(
    secretKey,
    'products',
    {
      name: `Enterprise — ${orgName}`.slice(0, 250),
      'metadata[orgId]': orgId,
      'metadata[custom]': 'true',
    },
    idempotencyKey,
  )
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
  // Minted by the admin form once per provisioning attempt (AGL-1714). Absent
  // means an older cached console bundle, which must keep provisioning rather
  // than start failing.
  const idempotencyKey = String(
    headers['idempotency-key'] ?? headers['Idempotency-Key'] ?? '',
  )

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
    // AGL-1028: moved to `orgs/{orgId}/billing/stripe`, org doc as fallback.
    // Read ONCE for two decisions: may this org be provisioned at all, and
    // which Stripe customer does the deal attach to.
    const billing = await readOrgBilling(orgId)
    let customerId = billing.stripeCustomerId as string | undefined

    // ONE ORG, ONE SUBSCRIPTION (AGL-1714) — the business rule half, and it is
    // not the same hole as the missing key. A key collapses a retry of ONE
    // attempt; it says nothing about staff provisioning a deal an hour after
    // the org already bought a self-serve plan, which is the same two charges.
    //
    // This route is worse than `/api/billing/checkout` was (17b0628c3), because
    // the invoice branch below does not merely add a second subscription: it
    // then writes `plan` and `subscription` over the org's existing record, so
    // the FIRST subscription becomes invisible from every screen we have while
    // both keep billing. Stripe's dashboard would be the only place it shows.
    //
    // Refused rather than offered an override. The right way to re-price a live
    // deal is to change the price on the existing subscription or cancel it
    // first — creating a second one is never the answer, so a "provision
    // anyway" checkbox would only be a slower path to the same double bill.
    //
    // `isOrgSubscriptionLive` is deliberately a STATUS test: the record and the
    // customer id both survive cancellation, so a "has a subscription record"
    // test would lock every churned enterprise org out of ever being
    // re-provisioned.
    if (isOrgSubscriptionLive(billing)) {
      return Response.json(
        {
          error:
            'This organization already has a live subscription. Cancel or ' +
            're-price it in Stripe before provisioning an enterprise deal — ' +
            'provisioning now would bill them twice.',
          code: 'subscription_exists',
        },
        { status: 409 },
      )
    }

    // POINT OF NO RETURN (AGL-1714). Everything above is a deterministic
    // refusal — bad plan, bad amount, no such org, not staff, already
    // subscribed — and staff fixes those and presses the same button, so none
    // of them may burn the attempt key.
    //
    // Below this line every path talks to Stripe, and in `invoice` mode the
    // subscription is created IMMEDIATELY on net-30 terms: there is no Checkout
    // session for anyone to abandon, so a double-submit is a second four-figure
    // invoice that may not surface for weeks. `create()` on a document
    // Firestore refuses to create twice is what covers the window between two
    // clicks, where there is nothing written yet to reconcile against.
    const claimed = await claimAttempt(firestore, {
      kind: 'enterprise-billing',
      scopeId: orgId,
      orgId,
      key: idempotencyKey,
      busyMessage:
        'This enterprise provisioning attempt is already being processed',
    })
    if ('replay' in claimed) {
      return Response.json(claimed.replay.body as object, {
        status: claimed.replay.status,
      })
    }
    // Scoped to the try and never released by the catch — see the comment
    // there. A `let` hoisted above the try would only invite that.
    const claim = claimed.claim

    // A Stripe customer is required to invoice or check out. Mint one if the
    // org has never billed (enterprise orgs often start on free).
    if (!customerId) {
      const customer = await stripe(
        secretKey,
        'customers',
        {
          name: orgName,
          'metadata[orgId]': orgId,
        },
        objectKey(claim.stripeKey, 'customer'),
      )
      if (!customer.ok) {
        await claim.release()
        return Response.json(
          { error: customer.body?.error?.message ?? 'Customer creation failed' },
          { status: 502 },
        )
      }
      customerId = customer.body.id as string
      // AGL-1028: the customer id lives on the manager-gated billing doc,
      // and `writeOrgBilling` also stamps the `stripeCustomers` reverse index
      // the webhook resolves through.
      await writeOrgBilling(orgId, { stripeCustomerId: customerId })
    }

    // Per-org product + ad-hoc recurring price. Annual bills 12× the monthly
    // figure; the webhook normalizes it back to monthly for MRR.
    const product = await enterpriseProduct(
      secretKey,
      orgId,
      orgName,
      objectKey(claim.stripeKey, 'product'),
    )
    if (!product.ok) {
      await claim.release()
      return Response.json({ error: product.error }, { status: 502 })
    }
    const unitAmountCents = Math.round(
      amountMonthlyUsd * (interval === 'year' ? 12 : 1) * 100,
    )
    // Keyed (AGL-1714). Unkeyed, this minted a fresh custom Price on every
    // attempt — duplicates carrying identical `metadata[orgId]`/`plan`/`custom`
    // that are indistinguishable in the dashboard and that nothing cleans up.
    // It is also the half that survives a RELEASED claim: on a deterministic
    // failure below we hand the key back, and the retry re-derives this same
    // digest so Stripe replays the first Price rather than minting a twin.
    const price = await stripe(
      secretKey,
      'prices',
      {
        product: product.productId!,
        currency: 'usd',
        unit_amount: String(unitAmountCents),
        'recurring[interval]': interval,
        'metadata[orgId]': orgId,
        'metadata[custom]': 'true',
        'metadata[plan]': plan,
        'metadata[monthlyUsd]': String(amountMonthlyUsd),
      },
      objectKey(claim.stripeKey, 'price'),
    )
    if (!price.ok) {
      // Stripe answered, so we KNOW nothing was created: give the key back and
      // let staff fix the figure and press the same button.
      await claim.release()
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
      const session = await stripe(
        secretKey,
        'checkout/sessions',
        {
          mode: 'subscription',
          customer: customerId,
          'line_items[0][price]': priceId,
          'line_items[0][quantity]': '1',
          success_url: `${origin}/admin/orgs/${orgId}?enterprise=done`,
          cancel_url: `${origin}/admin/orgs/${orgId}?enterprise=canceled`,
          'subscription_data[metadata][orgId]': orgId,
          'subscription_data[metadata][plan]': plan,
          'subscription_data[metadata][custom]': 'true',
        },
        objectKey(claim.stripeKey, 'session'),
      )
      if (!session.ok) {
        await claim.release()
        return Response.json(
          { error: session.body?.error?.message ?? 'Checkout link failed' },
          { status: 502 },
        )
      }
      result = { ...result, checkoutUrl: session.body.url }
    } else {
      // Invoice mode: create the subscription now on send-invoice collection
      // (net-30). Capability applies immediately; Stripe bills by invoice.
      const subscription = await stripe(
        secretKey,
        'subscriptions',
        {
          customer: customerId,
          'items[0][price]': priceId,
          collection_method: 'send_invoice',
          days_until_due: '30',
          'metadata[orgId]': orgId,
          'metadata[plan]': plan,
          'metadata[custom]': 'true',
          'expand[0]': 'latest_invoice',
        },
        // The call that costs real money. Covers the window where our claim is
        // written but the response never arrives: Stripe replays the existing
        // subscription rather than opening a second net-30 one (AGL-1714).
        objectKey(claim.stripeKey, 'subscription'),
      )
      if (!subscription.ok) {
        // An explicit Stripe refusal means no subscription exists.
        await claim.release()
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
      // `plan` stays on the org doc (feature gating reads it); the negotiated
      // rate and price id go to the manager-gated billing doc (AGL-1028).
      await orgRef.set({ plan }, { merge: true })
      await writeOrgBilling(orgId, {
        subscription: {
          status: sub.status ?? 'active',
          priceId,
          interval,
          customMonthlyUsd: Math.round(amountMonthlyUsd * 100) / 100,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null,
        },
      } as never)
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

    const payload = { ok: true, ...result }
    // A repeat of this attempt now replays the same answer — the same checkout
    // link, or the same subscription id and hosted invoice url — rather than
    // provisioning again (AGL-1714).
    await claim.record(200, payload)
    return Response.json(payload, { status: 200 })
  } catch (error) {
    console.error(error)
    // Deliberately NOT released (AGL-1714), which is where this diverges from
    // the POS sale and marketplace checkout paths and follows the refund one
    // (2dd52f01c). Reaching here means we do not know how far the attempt got:
    // in `invoice` mode `POST /v1/subscriptions` may already have created a
    // live net-30 subscription and thrown on the mirror write or the audit
    // append afterwards — which is precisely the window where the org record
    // does NOT yet say "subscribed", so the business rule above would wave a
    // retry straight through.
    //
    // The two failure directions are not symmetric. A stranded key costs a
    // reload and a look at the Stripe dashboard, on a staff-only screen, for
    // one deal. A released key costs a duplicate four-figure invoice on net-30
    // terms that nobody may notice for weeks. The retry gets a 409 and a human
    // reconciles.
    //
    // Not split by mode. `checkout` mode strands a key that cost nothing, which
    // is a page reload — cheaper than a second branch a future reader has to
    // reason about on the path where getting it wrong sends an invoice.
    return Response.json({ error: 'Enterprise billing request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
