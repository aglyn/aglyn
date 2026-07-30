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
import { DISCOUNT_APPROVAL_THRESHOLD_PCT } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * Staff coupon management (AGL-1105). Coupons live in Stripe — the source of
 * truth for redemption — and this route is the audited staff door to them.
 *
 *   GET  — lists existing Stripe coupons (with any promotion codes) so the
 *          staff Coupons page and the per-org apply picker can show them.
 *   POST — creates a Stripe coupon (percent OR fixed amount; once/repeating/
 *          forever; optional max redemptions and expiry) and, when a code is
 *          given, a promotion code customers can type at checkout. A
 *          ≥`DISCOUNT_APPROVAL_THRESHOLD_PCT`% coupon needs an explicit
 *          `confirmHighDiscount` flag. Audited to `adminAudit`.
 *
 * StaffGuard-gated (staff claim); 501 without Stripe env. Uses Stripe's REST
 * API directly, matching the rest of the billing routes (no SDK).
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

/** Shape one Stripe coupon (+ any promotion codes) for the console. */
function serializeCoupon(coupon: any, promotionCodes: any[] = []) {
  return {
    id: coupon.id as string,
    name: (coupon.name as string) ?? null,
    percentOff: coupon.percent_off ?? null,
    amountOffUsd:
      coupon.amount_off != null ? coupon.amount_off / 100 : null,
    currency: coupon.currency ?? null,
    duration: coupon.duration ?? null,
    durationInMonths: coupon.duration_in_months ?? null,
    maxRedemptions: coupon.max_redemptions ?? null,
    timesRedeemed: coupon.times_redeemed ?? 0,
    redeemBy: coupon.redeem_by
      ? new Date(coupon.redeem_by * 1000).toISOString()
      : null,
    valid: coupon.valid === true,
    created: coupon.created
      ? new Date(coupon.created * 1000).toISOString()
      : null,
    codes: promotionCodes
      .filter((code) => code?.coupon?.id === coupon.id || code?.coupon === coupon.id)
      .map((code) => ({
        id: code.id as string,
        code: code.code as string,
        active: code.active === true,
        timesRedeemed: code.times_redeemed ?? 0,
        maxRedemptions: code.max_redemptions ?? null,
      })),
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return Response.json({ error: 'Stripe is not configured' }, { status: 501 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    if (method === 'GET') {
      const [couponsRes, codesRes] = await Promise.all([
        stripe(secretKey, 'coupons?limit=100'),
        stripe(secretKey, 'promotion_codes?limit=100'),
      ])
      if (!couponsRes.ok) {
        return Response.json(
          { error: couponsRes.body?.error?.message ?? 'Stripe lookup failed' },
          { status: 502 },
        )
      }
      const promotionCodes = Array.isArray(codesRes.body?.data)
        ? codesRes.body.data
        : []
      const coupons = (couponsRes.body?.data ?? []).map((coupon: any) =>
        serializeCoupon(coupon, promotionCodes),
      )
      return Response.json({ coupons }, { status: 200 })
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    // ---- Validate the requested coupon shape ----
    const percentOff =
      body?.percentOff != null && body.percentOff !== ''
        ? Number(body.percentOff)
        : undefined
    const amountOffUsd =
      body?.amountOffUsd != null && body.amountOffUsd !== ''
        ? Number(body.amountOffUsd)
        : undefined
    const hasPercent = typeof percentOff === 'number' && !Number.isNaN(percentOff)
    const hasAmount = typeof amountOffUsd === 'number' && !Number.isNaN(amountOffUsd)
    if (hasPercent === hasAmount) {
      return Response.json(
        { error: 'Provide exactly one of percentOff or amountOffUsd' },
        { status: 400 },
      )
    }
    if (hasPercent && (percentOff! <= 0 || percentOff! > 100)) {
      return Response.json({ error: 'percentOff must be 1–100' }, { status: 400 })
    }
    if (hasAmount && amountOffUsd! <= 0) {
      return Response.json({ error: 'amountOffUsd must be > 0' }, { status: 400 })
    }

    const duration = String(body?.duration ?? 'once')
    if (!['once', 'repeating', 'forever'].includes(duration)) {
      return Response.json({ error: 'Bad duration' }, { status: 400 })
    }
    const durationInMonths =
      duration === 'repeating' ? Number(body?.durationInMonths ?? 0) : undefined
    if (duration === 'repeating' && (!durationInMonths || durationInMonths < 1)) {
      return Response.json(
        { error: 'durationInMonths required for a repeating coupon' },
        { status: 400 },
      )
    }

    // Approval gate (AGL-1105): a big percent-off coupon is a real revenue
    // commitment. Fixed-amount coupons are bounded by the amount, so the gate
    // is on the percent path only. Requires an explicit confirm.
    if (
      hasPercent &&
      percentOff! >= DISCOUNT_APPROVAL_THRESHOLD_PCT &&
      body?.confirmHighDiscount !== true
    ) {
      return Response.json(
        {
          error:
            `A ${percentOff}% coupon needs sign-off (≥` +
            `${DISCOUNT_APPROVAL_THRESHOLD_PCT}%). Re-submit with ` +
            `confirmHighDiscount to proceed.`,
          requiresConfirmation: true,
        },
        { status: 400 },
      )
    }

    const couponParams: Record<string, string> = { duration }
    if (hasPercent) couponParams.percent_off = String(percentOff)
    if (hasAmount) {
      couponParams.amount_off = String(Math.round(amountOffUsd! * 100))
      couponParams.currency = 'usd'
    }
    if (durationInMonths) {
      couponParams.duration_in_months = String(durationInMonths)
    }
    const name = String(body?.name ?? '').trim()
    if (name) couponParams.name = name.slice(0, 200)
    const maxRedemptions = Number(body?.maxRedemptions ?? 0)
    if (maxRedemptions > 0) {
      couponParams.max_redemptions = String(Math.floor(maxRedemptions))
    }
    const expiresAt = String(body?.expiresAt ?? '').trim()
    if (expiresAt) {
      const ts = Math.floor(new Date(expiresAt).getTime() / 1000)
      if (Number.isFinite(ts) && ts > Date.now() / 1000) {
        couponParams.redeem_by = String(ts)
      }
    }
    couponParams['metadata[createdBy]'] = decoded.uid

    const created = await stripe(secretKey, 'coupons', couponParams)
    if (!created.ok) {
      return Response.json(
        { error: created.body?.error?.message ?? 'Coupon creation failed' },
        { status: 502 },
      )
    }
    const coupon = created.body

    // Optional promotion code (a code customers can type at checkout).
    let promotionCode: any = null
    const code = String(body?.code ?? '').trim()
    if (code) {
      const codeParams: Record<string, string> = {
        coupon: coupon.id,
        code: code.toUpperCase().slice(0, 40),
      }
      if (maxRedemptions > 0) {
        codeParams.max_redemptions = String(Math.floor(maxRedemptions))
      }
      if (couponParams.redeem_by) codeParams.expires_at = couponParams.redeem_by
      const codeRes = await stripe(secretKey, 'promotion_codes', codeParams)
      if (codeRes.ok) promotionCode = codeRes.body
      else {
        // The coupon exists; surface the code failure without pretending the
        // whole thing failed.
        console.error('promotion_code creation failed', codeRes.body?.error)
      }
    }

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'coupon.create',
        target: `stripe/coupons/${coupon.id}`,
        before: null,
        after: {
          couponId: coupon.id,
          percentOff: hasPercent ? percentOff : null,
          amountOffUsd: hasAmount ? amountOffUsd : null,
          duration,
          code: promotionCode?.code ?? null,
          maxRedemptions: maxRedemptions > 0 ? maxRedemptions : null,
        },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })

    return Response.json(
      { coupon: serializeCoupon(coupon, promotionCode ? [promotionCode] : []) },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Coupon request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
