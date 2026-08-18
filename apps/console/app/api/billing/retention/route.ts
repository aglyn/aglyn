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
  isLiveSubscriptionStatus,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  assertBoundedWinbackCoupon,
  CHURN_SURVEY_DETAIL_COLLECTION,
  CHURN_SURVEY_DETAIL_MAX_LENGTH,
  CHURN_SURVEY_REASONS,
  churnSurveyDetailExpiry,
  downsellTargetPlan,
  RETENTION_COLLECTION,
  RETENTION_SURFACES,
  WINBACK_DURATION_MONTHS,
  WINBACK_PERCENT_OFF,
} from '../../_lib/retention'

// lockdown-423: exempt — the retention funnel is part of the LEAVE path
// (survey → downsell → winback → cancel); a billing lockdown must not trap
// an org in a subscription, the same posture as /api/billing/subscription.

async function stripeRequest(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: URLSearchParams,
): Promise<any> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
    },
    ...(body ? { body: body.toString() } : {}),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe ${path} failed`)
  }
  return payload
}

/**
 * Whether a Stripe subscription already carries a discount (AGL-2117).
 *
 * Both shapes are checked because both are real: `discounts` is the current
 * list-valued field, and `discount` is the singular legacy one that older API
 * versions still return. Reading only the modern name would answer "no
 * discount" for exactly the long-lived subscriptions most likely to hold a
 * promo — the ones this guard exists to protect.
 *
 * A `discounts` array that exists but is empty is not a discount; a live
 * subscription reports `discounts: []` routinely.
 */
function hasExistingDiscount(subscription: any): boolean {
  const list = subscription?.discounts
  if (Array.isArray(list) && list.some((entry: unknown) => Boolean(entry))) {
    return true
  }
  return Boolean(subscription?.discount)
}

/**
 * Cancellation/deletion funnel storage + winback minting (AGL-1863, under
 * AGL-1859 — Zach's twice-given retention directive). billing.manage-gated,
 * POST only:
 *
 * - `survey`  → stores one why-are-you-leaving answer in
 *   `orgs/{orgId}/retention` (Admin-SDK-only — the orgs rules block matches
 *   subcollections by name, so this one is default-deny for every client)
 *   and returns its id as the `funnelId` the cancel/delete endpoints accept.
 * - `winback` → mints THE bounded winback coupon (50% off, 2 months — never
 *   client-chosen, never forever; `assertBoundedWinbackCoupon` throws before
 *   any Stripe call otherwise) and applies it to the org's live
 *   subscription. Once per org, ever: the `retention/winback` doc is
 *   `create()`d as a reservation, so a second mint loses the race at the
 *   database rather than at a code check.
 */
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
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId || !['survey', 'winback'].includes(action)) {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'billing.manage'))
    ) {
      return Response.json({ error: 'billing.manage required' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const retention = orgRef.collection(RETENTION_COLLECTION)

    if (action === 'survey') {
      const surface = String(body?.surface ?? '')
      const reason = String(body?.reason ?? '')
      if (!(RETENTION_SURFACES as readonly string[]).includes(surface)) {
        return Response.json({ error: 'Unknown surface' }, { status: 400 })
      }
      if (!(CHURN_SURVEY_REASONS as readonly string[]).includes(reason)) {
        return Response.json({ error: 'Unknown reason' }, { status: 400 })
      }
      // Bounded free text; absent stays absent (never a hole of `undefined`,
      // which Firestore rejects).
      const rawDetail = typeof body?.detail === 'string' ? body.detail.trim() : ''
      const detail = rawDetail.slice(0, CHURN_SURVEY_DETAIL_MAX_LENGTH)
      const plan = (orgSnapshot.get('plan') as string | undefined) ?? null
      const surveyRef = retention.doc()
      await surveyRef.create({
        kind: 'churn_survey',
        surface,
        reason,
        plan,
        uid: decoded.uid,
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      // The free text lives in its own document so it can expire without
      // taking the reason breakdown with it (AGL-1978). Written SECOND and
      // not batched deliberately: if this write fails the survey still
      // stands and the funnel keeps its number, which is the correct
      // direction to fail in. A batch would trade that for atomicity nobody
      // needs — the two are joined by id, and a detail with no survey is the
      // combination that would actually be wrong.
      if (detail) {
        await orgRef
          .collection(CHURN_SURVEY_DETAIL_COLLECTION)
          .doc(surveyRef.id)
          .create({
            detail,
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            expiresAt: churnSurveyDetailExpiry(),
          })
      }
      // The next two steps' TERMS ride the survey response rather than being
      // decided in the browser. The dialog renders what it is told: which tier
      // to offer, what the discount is, and whether the org still has its one
      // winback. A client that computed any of these would eventually offer a
      // tier the server refuses, or a discount the guard will not mint.
      const winbackUsed = (await retention.doc('winback').get()).exists
      return Response.json(
        {
          ok: true,
          funnelId: surveyRef.id,
          downsellPlan: downsellTargetPlan(plan),
          winbackAvailable: !winbackUsed,
          winbackPercentOff: WINBACK_PERCENT_OFF,
          winbackDurationMonths: WINBACK_DURATION_MONTHS,
        },
        { status: 200 },
      )
    }

    // --- winback -----------------------------------------------------------
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      return Response.json({ error: 'Billing is not configured' }, { status: 501 })
    }
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId
    if (!customerId) {
      return Response.json({ error: 'No billing account yet' }, { status: 409 })
    }
    const subscriptions = await stripeRequest(
      secretKey,
      'GET',
      `subscriptions?customer=${encodeURIComponent(String(customerId))}&status=all&limit=5`,
    )
    const subscription = (subscriptions?.data ?? []).find((entry: any) =>
      isLiveSubscriptionStatus(entry?.status),
    )
    if (!subscription) {
      return Response.json({ error: 'No active subscription' }, { status: 409 })
    }
    // A subscription that already carries a discount is refused rather than
    // overwritten (AGL-2117). The apply below sets `discounts[0][coupon]`, and
    // Stripe's `discounts` parameter SETS the list — it does not append. On a
    // customer who checked out with a promotion code (checkout sends
    // `allow_promotion_codes`) that write silently deletes the promo they
    // were promised: they take 50% for two months, lose whatever months
    // remained, and land on full list price at month three — a price rise
    // nobody agreed to, delivered by the flow whose whole job is retention.
    //
    // Refused, not stacked. Stacking the winback on top of an existing large
    // discount walks toward the free account `assertBoundedWinbackCoupon`
    // exists to make impossible, and a retained org still has to cover its
    // costs. Checked BEFORE the reservation below so the org keeps its one
    // shot without needing the reservation released.
    if (hasExistingDiscount(subscription)) {
      return Response.json(
        {
          error:
            'This subscription already has a discount applied — the winback ' +
            'offer would replace it. Contact support to change the discount.',
        },
        { status: 409 },
      )
    }

    const funnelId = typeof body?.funnelId === 'string' ? body.funnelId : null
    // One winback per org, EVER — reserved by `create()` on a fixed doc id,
    // which is atomic at the database: two racing requests cannot both win,
    // and an org cannot re-run the funnel every other month for a permanent
    // half-price subscription (that would be the forever coupon with extra
    // steps).
    const winbackRef = retention.doc('winback')
    try {
      await winbackRef.create({
        kind: 'winback_reserved',
        uid: decoded.uid,
        ...(funnelId ? { funnelId } : {}),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    } catch {
      return Response.json(
        { error: 'The winback offer has already been used for this organization' },
        { status: 409 },
      )
    }

    try {
      // The guard runs BEFORE any Stripe call, on the exact shape about to be
      // minted. Constants, not request fields — but the assert stays in the
      // live path so a future edit that unbounds the constants fails every
      // request loudly instead of minting quietly.
      assertBoundedWinbackCoupon({
        percentOff: WINBACK_PERCENT_OFF,
        duration: 'repeating',
        durationInMonths: WINBACK_DURATION_MONTHS,
      })
      const coupon = await stripeRequest(
        secretKey,
        'POST',
        'coupons',
        new URLSearchParams({
          percent_off: String(WINBACK_PERCENT_OFF),
          duration: 'repeating',
          duration_in_months: String(WINBACK_DURATION_MONTHS),
          name: `Winback ${WINBACK_PERCENT_OFF}% × ${WINBACK_DURATION_MONTHS}mo`,
          'metadata[orgId]': orgId,
          'metadata[source]': 'retention_funnel',
          ...(funnelId ? { 'metadata[funnelId]': funnelId } : {}),
          // Single-use even if it leaks: it is applied server-side below,
          // never handed to the customer as a code.
          max_redemptions: '1',
        }),
      )
      await stripeRequest(
        secretKey,
        'POST',
        `subscriptions/${subscription.id}`,
        new URLSearchParams({ 'discounts[0][coupon]': String(coupon.id) }),
      )
      await winbackRef.set(
        {
          kind: 'winback_applied',
          couponId: String(coupon.id),
          percentOff: WINBACK_PERCENT_OFF,
          durationMonths: WINBACK_DURATION_MONTHS,
          appliedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return Response.json({
        ok: true,
        percentOff: WINBACK_PERCENT_OFF,
        durationMonths: WINBACK_DURATION_MONTHS,
      }, { status: 200 })
    } catch (error) {
      // The reservation must not survive a failed mint/apply — the offer was
      // never delivered, so the org keeps its one shot.
      await winbackRef.delete().catch(() => undefined)
      throw error
    }
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Retention operation failed' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
