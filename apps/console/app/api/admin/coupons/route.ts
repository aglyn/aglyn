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
  couponCaseLabel,
  rateCouponAgainstFullUse,
  type CouponDuration,
} from '@aglyn/aglyn/app-utils/full-use-cost'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  COUPON_FILTER_FIELDS,
  COUPON_READ_BOUND,
  COUPON_SEARCH_PATHS,
  type CouponRow,
  couponListRow,
  PROMOTION_CODE_READ_BOUND,
  STRIPE_LIST_PAGE,
} from '../../../../utils/coupon-list-query'
import { answerStaffCompleteList } from '../../../../utils/server/staff-complete-list'
import { readStaffListQuery } from '../../../../utils/server/staff-list-query'

/**
 * Staff coupon management (AGL-1105). Coupons live in Stripe — the source of
 * truth for redemption — and this route is the audited staff door to them.
 *
 *   GET  — lists existing Stripe coupons (with any promotion codes) so the
 *          staff Coupons page and the per-org apply picker can show them.
 *          Every coupon and every code, paging Stripe to the end; past the
 *          read bounds it answers 413 rather than a first page of them.
 *          `view=list` is the Coupons page's list: the staff list wire
 *          (`readStaffListQuery`), its Filters clauses and search matched
 *          over that complete read (`utils/coupon-list-query.ts` says why
 *          Stripe cannot be asked instead). Without it, the whole set as
 *          `{ coupons }`, which the apply picker reads.
 *   POST — dispatches on `action`, defaulting to `create`:
 *
 *          `create` builds a Stripe coupon (percent OR fixed amount; once/
 *          repeating/forever; optional max redemptions and expiry) and, when
 *          a code is given, a promotion code customers can type at checkout.
 *          A ≥`DISCOUNT_APPROVAL_THRESHOLD_PCT`% coupon needs an explicit
 *          `confirmHighDiscount` flag. Every create answers with the
 *          coupon's full-use verdict (`fullUseVerdict`) — a warning when a
 *          discounted charge falls under a plan's full-use cost, never a
 *          refusal.
 *
 *          `activate` / `deactivate` flip `active` on an existing promotion
 *          code named by `promotionCodeId`. Checkout resolves a typed code
 *          with `active=true`, so an inactive code is reported to the
 *          customer as unrecognized — the flip back is a customer-facing
 *          repair, and it belongs here rather than in a Stripe Dashboard
 *          session no audit trail can see. Activating is minting again, so
 *          it answers with the same full-use verdict.
 *
 *          Both actions are audited to `adminAudit`.
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

/**
 * The documented shape of a Stripe promotion code id. The id is interpolated
 * into the Stripe request path, so it is matched rather than passed through —
 * an unconstrained string would let a caller address a different Stripe
 * resource entirely.
 */
const PROMOTION_CODE_ID = /^promo_[A-Za-z0-9]+$/

/**
 * A coupon's full-use verdict, for the response and the audit row (AGL-3473).
 *
 * A coupon here carries no plan restriction, so its code can be redeemed on
 * any paid plan at either interval by a customer using everything the plan
 * includes. The verdict says whether each discounted charge — on the charges
 * its duration actually reaches — still covers that plan's full-use cost net
 * of Stripe, and by how much the worst one falls short. It is a WARNING: a
 * coupon is a tool for closing a deal, so a discount that spends cost is
 * created all the same, and staff are shown what it spends.
 */
function fullUseVerdict(
  discount: { percentOff?: number; amountOffUsd?: number },
  duration: CouponDuration,
) {
  const verdict = rateCouponAgainstFullUse(discount, duration)
  const worst = verdict.worst
  return {
    ok: verdict.ok,
    warning: verdict.warning,
    under: verdict.under,
    worst: {
      plan: worst.plan,
      interval: worst.interval,
      label: couponCaseLabel(worst),
      coverage: worst.coverage,
      chargeNetUsd: worst.chargeNetUsd,
      chargeCogsUsd: Number.isFinite(worst.chargeCogsUsd) ? worst.chargeCogsUsd : null,
      chargeUnderCostUsd: Number.isFinite(worst.chargeUnderCostUsd)
        ? worst.chargeUnderCostUsd
        : null,
      monthsOfFirstYear: worst.reach.monthsOfFirstYear,
      firstYearCoverage: worst.firstYearCoverage,
      firstYearUnderCostUsd: Number.isFinite(worst.firstYearUnderCostUsd)
        ? worst.firstYearUnderCostUsd
        : null,
    },
  }
}

/** Shape one Stripe promotion code for the console. */
function serializePromotionCode(code: any) {
  return {
    id: code.id as string,
    code: code.code as string,
    active: code.active === true,
    timesRedeemed: code.times_redeemed ?? 0,
    maxRedemptions: code.max_redemptions ?? null,
  }
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
      .map(serializePromotionCode),
  }
}

/**
 * Every object of one Stripe list, paged by `starting_after` to the end, or
 * `complete: false` when there are more than `bound` of them. A failed page
 * is a failed read: the caller gets Stripe's status, never a partial list.
 */
async function readAllStripe(
  secretKey: string,
  path: string,
  bound: number,
): Promise<
  | { ok: true; data: any[]; complete: boolean }
  | { ok: false; status: number; body: any }
> {
  const data: any[] = []
  let after: string | null = null
  for (;;) {
    const page = await stripe(
      secretKey,
      `${path}?limit=${STRIPE_LIST_PAGE}${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`,
    )
    if (!page.ok) return { ok: false, status: page.status, body: page.body }
    const objects: any[] = Array.isArray(page.body?.data) ? page.body.data : []
    data.push(...objects)
    const last = objects[objects.length - 1]?.id
    if (page.body?.has_more !== true || typeof last !== 'string') {
      return { ok: true, data, complete: true }
    }
    if (data.length >= bound) return { ok: true, data, complete: false }
    after = last
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
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
      const listView = String(query?.['view'] ?? '') === 'list'
      const listRequest = listView ? readStaffListQuery(query ?? {}) : null
      if (listView && !listRequest) {
        return Response.json({ error: 'Unreadable filters' }, { status: 400 })
      }
      const [couponsRead, codesRead] = await Promise.all([
        readAllStripe(secretKey, 'coupons', COUPON_READ_BOUND),
        readAllStripe(secretKey, 'promotion_codes', PROMOTION_CODE_READ_BOUND),
      ])
      if (!couponsRead.ok || !codesRead.ok) {
        const failed = [couponsRead, codesRead].find((read) => 'body' in read)
        const message = failed && 'body' in failed ? failed.body?.error?.message : null
        return Response.json(
          { error: message ?? 'Stripe lookup failed' },
          { status: 502 },
        )
      }
      // A coupon's codes come from the code list, so a code list cut short
      // would show coupons without codes they have. Both must be whole.
      if (!couponsRead.complete || !codesRead.complete) {
        return Response.json(
          {
            error:
              `Stripe holds more than ${COUPON_READ_BOUND} coupons or ` +
              `${PROMOTION_CODE_READ_BOUND} promotion codes. This list reads ` +
              'every one to filter them, and will not answer from part of them.',
          },
          { status: 413 },
        )
      }
      const coupons: CouponRow[] = couponsRead.data.map((coupon: any) =>
        serializeCoupon(coupon, codesRead.data),
      )
      if (!listRequest) return Response.json({ coupons }, { status: 200 })
      // Newest first, the order Stripe lists them in.
      return Response.json(
        answerStaffCompleteList({
          rows: coupons.map(couponListRow),
          fields: COUPON_FILTER_FIELDS,
          searchPaths: COUPON_SEARCH_PATHS,
          request: listRequest,
          cursorOf: (row) => row.id,
        }),
        { status: 200 },
      )
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const action = String(body?.action ?? 'create')

    // ---- Flip an existing promotion code's redeemability ----
    if (action === 'activate' || action === 'deactivate') {
      const promotionCodeId = String(body?.promotionCodeId ?? '').trim()
      if (!PROMOTION_CODE_ID.test(promotionCodeId)) {
        return Response.json({ error: 'Bad promotionCodeId' }, { status: 400 })
      }
      const active = action === 'activate'

      // Read before writing: the audit row's `before` has to be the state
      // Stripe actually held, not the state the caller assumed, and an
      // unknown id has to fail before anything is written.
      const current = await stripe(
        secretKey,
        `promotion_codes/${promotionCodeId}`,
      )
      if (!current.ok) {
        return Response.json(
          {
            error:
              current.body?.error?.message ?? 'Promotion code lookup failed',
          },
          { status: current.status === 404 ? 404 : 502 },
        )
      }
      const wasActive = current.body?.active === true

      // The same sign-off creation asks for: making a ≥threshold discount
      // redeemable again is the same revenue commitment as minting it.
      // Deactivating carries no gate — it can only shrink what is redeemable,
      // and a gate on the safe direction would slow the repair down.
      const percentOff = current.body?.coupon?.percent_off
      if (
        active &&
        typeof percentOff === 'number' &&
        percentOff >= DISCOUNT_APPROVAL_THRESHOLD_PCT &&
        body?.confirmHighDiscount !== true
      ) {
        return Response.json(
          {
            error:
              `Activating a ${percentOff}% code needs sign-off (≥` +
              `${DISCOUNT_APPROVAL_THRESHOLD_PCT}%). Re-submit with ` +
              `confirmHighDiscount to proceed.`,
            requiresConfirmation: true,
          },
          { status: 400 },
        )
      }

      const amountOff = current.body?.coupon?.amount_off
      const fullUse = active
        ? fullUseVerdict(
            typeof percentOff === 'number'
              ? { percentOff }
              : typeof amountOff === 'number'
                ? { amountOffUsd: amountOff / 100 }
                : {},
            {
              duration: current.body?.coupon?.duration ?? null,
              durationInMonths: current.body?.coupon?.duration_in_months ?? null,
            },
          )
        : null

      const updated = await stripe(
        secretKey,
        `promotion_codes/${promotionCodeId}`,
        { active: String(active) },
      )
      if (!updated.ok) {
        return Response.json(
          {
            error:
              updated.body?.error?.message ?? 'Promotion code update failed',
          },
          { status: 502 },
        )
      }

      await addAdminAudit(firebaseAdmin.app().firestore(), {
        actorUid: decoded.uid,
        action: 'coupon.promotion_code.update',
        target: `stripe/promotion_codes/${promotionCodeId}`,
        before: { active: wasActive },
        after: {
          active: updated.body?.active === true,
          code: updated.body?.code ?? null,
          couponId: updated.body?.coupon?.id ?? null,
          ...(fullUse
            ? { fullUseOk: fullUse.ok, fullUseWorstCoverage: fullUse.worst.coverage }
            : {}),
        },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })

      // Answer with a fresh read of what was written, so the console renders
      // Stripe's state rather than the state it asked for — and, turning a
      // code on, with its full-use verdict for the console to warn with.
      return Response.json(
        {
          code: serializePromotionCode(updated.body),
          ...(fullUse ? { fullUse } : {}),
        },
        { status: 200 },
      )
    }

    if (action !== 'create') {
      return Response.json({ error: 'Unknown action' }, { status: 400 })
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

    const fullUse = fullUseVerdict(
      hasPercent ? { percentOff: percentOff! } : { amountOffUsd: amountOffUsd! },
      { duration, durationInMonths: durationInMonths ?? null },
    )

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

    await addAdminAudit(firebaseAdmin.app().firestore(), {
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
        // What the staff member was warned about when they created it.
        fullUseOk: fullUse.ok,
        fullUseWorstCoverage: fullUse.worst.coverage,
      },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })

    return Response.json(
      {
        coupon: serializeCoupon(coupon, promotionCode ? [promotionCode] : []),
        fullUse,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Coupon request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
