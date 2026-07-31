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
import { checkDiscountMargin, orgMonthlyCogsUsd } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * Apply or remove a per-org subscription discount (AGL-1105). Staff attaches
 * an existing Stripe coupon (created on the Coupons page) to a specific org's
 * live subscription and mirrors it onto `org.discount` so net-of-discount MRR
 * is computed without a Stripe round-trip.
 *
 *   POST { orgId, action: 'apply', couponId, reason?, confirmBelowFloor? }
 *   POST { orgId, action: 'remove' }
 *
 * Apply runs `checkDiscountMargin` for THAT org first: a `block` rating —
 * too deep a discount, or a margin well below the net-margin floor — is
 * refused unless the caller passes `confirmBelowFloor`. StaffGuard-gated;
 * audited to `adminAudit`; 501 without Stripe env. Uses Stripe's REST API
 * directly (no SDK).
 */

/**
 * The org's most recent measured monthly cost, priced by the shared cost
 * model (AGL-1134) from the usage rollup at `orgs/{id}/usage/{month}`.
 *
 * It used to read the rollup's `costUsd` field directly. That field prices
 * only storage, page views and form submissions — the same document also
 * records `dataStorageMb`, `apiRequests` and `contactsCount`, and the metering
 * estimate charges nothing for any of them. `orgMonthlyCogsUsd` prices all
 * six, and is the same function the staff overview now uses, so the guardrail
 * and the MRR view cannot answer "what does this org cost" differently.
 *
 * Returns null when there is no rollup, which is the honest answer —
 * `checkDiscountMargin` then falls back to the flat per-site estimate rather
 * than treating "not measured" as "costs nothing". Best-effort: a missing
 * index or a read failure must not block a staff action, and the flat floor
 * still applies.
 *
 * NOTE: on production data this is currently inert. The largest real org's
 * measured cost was $0.0000054 against a $4.00 two-site floor, so the floor
 * wins for every org today and will until there is real traffic.
 */
async function latestMeasuredCogsUsd(orgId: string): Promise<number | null> {
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('usage')
      .orderBy('month', 'desc')
      .limit(1)
      .get()
    const rollup = snapshot.docs[0]
    if (!rollup) return null
    const { measuredUsd } = orgMonthlyCogsUsd(
      {
        storageGb: rollup.get('storageGb'),
        pageViews: rollup.get('pageViews'),
        formSubmissions: rollup.get('formSubmissions'),
        dataStorageMb: rollup.get('dataStorageMb'),
        apiRequests: rollup.get('apiRequests'),
        contactsCount: rollup.get('contactsCount'),
      },
      // Site count comes from `checkDiscountMargin`, which applies the flat
      // floor itself — passing 0 here keeps this the MEASURED half only, so
      // the floor is not applied twice.
      0,
    )
    return Number.isFinite(measuredUsd) ? measuredUsd : null
  } catch (error) {
    console.error('[admin/org-discount] usage rollup read failed', error)
    return null
  }
}
async function stripe(
  secretKey: string,
  path: string,
  params?: Record<string, string>,
  httpMethod?: 'DELETE',
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: httpMethod ?? (params ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

/** The customer's first live subscription (active/trialing/past_due). */
async function liveSubscriptionId(
  secretKey: string,
  customerId: string,
): Promise<string | null> {
  const res = await stripe(
    secretKey,
    `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
  )
  if (!res.ok) return null
  const live = (res.body?.data ?? []).find((sub: any) =>
    ['active', 'trialing', 'past_due'].includes(sub?.status),
  )
  return live?.id ?? null
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
  const action = String(body?.action ?? 'apply')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

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
    const customerId = orgData?.stripeCustomerId as string | undefined

    if (action === 'remove') {
      const before = orgData?.discount ?? null
      if (customerId) {
        const subId = await liveSubscriptionId(secretKey, customerId)
        if (subId) {
          // Legacy discount endpoint clears the subscription's coupon.
          await stripe(
            secretKey,
            `subscriptions/${encodeURIComponent(subId)}/discount`,
            undefined,
            'DELETE',
          )
        }
      }
      await orgRef.set(
        { discount: firebaseAdmin.firestore.FieldValue.delete() },
        { merge: true },
      )
      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: 'org.discount.remove',
        target: `orgs/${orgId}`,
        before,
        after: null,
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true, removed: true }, { status: 200 })
    }

    if (action !== 'apply') {
      return Response.json({ error: 'Bad action' }, { status: 400 })
    }

    const couponId = String(body?.couponId ?? '')
    if (!couponId) return Response.json({ error: 'Missing couponId' }, { status: 400 })
    if (!customerId) {
      return Response.json(
        { error: 'This org has no Stripe customer / subscription to discount' },
        { status: 409 },
      )
    }

    // Fetch the coupon to learn its shape (percent vs fixed) — the same shape
    // we store on org.discount and rate the margin against.
    const couponRes = await stripe(
      secretKey,
      `coupons/${encodeURIComponent(couponId)}`,
    )
    if (!couponRes.ok) {
      return Response.json(
        { error: couponRes.body?.error?.message ?? 'No such coupon' },
        { status: 404 },
      )
    }
    const coupon = couponRes.body
    const percentOff =
      coupon.percent_off != null ? Number(coupon.percent_off) : undefined
    const amountOffUsd =
      coupon.amount_off != null ? Number(coupon.amount_off) / 100 : undefined

    // Margin guardrail for THIS org (AGL-1105): a blocked discount needs an
    // explicit override.
    //
    // This is the moment the money is actually committed, and the only one
    // that knows the org — so it rates against that org's MEASURED cost
    // (AGL-1120) rather than the flat per-site placeholder. Coupon creation
    // cannot do this: no org has been chosen yet.
    const measuredCogsUsd = await latestMeasuredCogsUsd(orgId)
    const rating = checkDiscountMargin(
      orgData,
      { percentOff, amountOffUsd },
      { measuredCogsUsd },
    )
    if (rating.rating === 'block' && body?.confirmBelowFloor !== true) {
      return Response.json(
        {
          error:
            rating.reason === 'depth'
              ? 'This discount gives away more of list price than the ' +
                'guardrail allows. Re-submit with confirmBelowFloor to ' +
                'override.'
              : 'This discount pushes net margin below the floor. Re-submit ' +
                'with confirmBelowFloor to override.',
          rating,
          requiresConfirmation: true,
        },
        { status: 400 },
      )
    }

    const subId = await liveSubscriptionId(secretKey, customerId)
    if (!subId) {
      return Response.json(
        { error: 'No live subscription to apply the coupon to' },
        { status: 409 },
      )
    }
    const applied = await stripe(
      secretKey,
      `subscriptions/${encodeURIComponent(subId)}`,
      { coupon: couponId },
    )
    if (!applied.ok) {
      return Response.json(
        { error: applied.body?.error?.message ?? 'Failed to apply coupon' },
        { status: 502 },
      )
    }

    const before = orgData?.discount ?? null
    const discount: Record<string, unknown> = {
      couponId,
      appliedBy: decoded.uid,
      appliedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }
    if (percentOff != null) discount.percentOff = percentOff
    if (amountOffUsd != null) discount.amountOffUsd = amountOffUsd
    if (coupon.name) discount.code = String(coupon.name)
    const reason = String(body?.reason ?? '').trim()
    if (reason) discount.reason = reason.slice(0, 500)

    await orgRef.set({ discount }, { merge: true })
    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: 'org.discount.apply',
      target: `orgs/${orgId}`,
      before,
      after: {
        couponId,
        percentOff: percentOff ?? null,
        amountOffUsd: amountOffUsd ?? null,
        rating: rating.rating,
        marginPct: rating.marginPct,
        reason: reason || null,
      },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    return Response.json({ ok: true, rating }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Discount request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
