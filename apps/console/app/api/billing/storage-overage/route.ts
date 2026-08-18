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
  planMetersInfraOverage,
  pluginRequestFromWeb,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  resolveStorageCap,
  storageOveragePricePerGbUsd,
  STORAGE_CAP_FALLBACK_USD,
} from '../../../../utils/storage-overage'

// lockdown-423: exempt — self-serve billing surface, same posture as
// billing/addons and billing/checkout. AGL-1501 keeps billing-locked sessions
// alive precisely so members can reach Billing; and this is the control that
// stops an org accruing charges, so a 423 would trap it accruing them.

/** The most a self-serve org may set as its monthly storage-overage cap. */
export const STORAGE_CAP_MAX_USD = 5_000

/**
 * Set or clear the org's own monthly storage-overage cap (AGL-1886, corrected
 * 2026-08-18).
 *
 * Zach, 2026-08-18, verbatim: *"it should be a control by the end user, to
 * prevent overage or usage alerts rather, we just want to minimize churn"*.
 * This route is that control, and nothing else — it is **not** a consent
 * surface and there is nothing here a customer must do before storage works.
 *
 *   `get`      → the cap in force (if any), whether the plan meters, and the
 *                per-GB rate the invoice uses
 *   `setCap`   → store the ceiling the customer typed
 *   `clearCap` → remove it; the org goes back to billing without a ceiling
 *
 * `billing.manage`-gated, because the cap bounds spend in both directions:
 * raising it raises what the org can be invoiced. Admin-SDK-only by
 * construction — `storageOverage` is an ENTITLEMENT INPUT and the rules deny
 * it to every client, so a member cannot raise their own spend ceiling.
 *
 * CLEARING IS ALWAYS AVAILABLE, including to a plan that no longer meters and
 * to an org already over its allowance. So is setting: an org that wants to
 * be stopped must be able to say so at any moment, and an org that wants the
 * brakes off must not have to argue with a precondition.
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
  if (!orgId || !['get', 'setCap', 'clearCap'].includes(action)) {
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

    const orgRef = firebaseAdmin.app().firestore().collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const org = (orgSnapshot.data() ?? {}) as any
    const entitlements = resolveOrgEntitlements(org)
    const metered = planMetersInfraOverage(org)
    const current = resolveStorageCap(org)

    if (action === 'get') {
      return Response.json(
        {
          ...current,
          metered,
          defaultCapUsd: STORAGE_CAP_FALLBACK_USD,
          maxCapUsd: STORAGE_CAP_MAX_USD,
          includedStoragePerSiteMb: entitlements.storagePerHostMb,
          // The card quotes the price storage bills at, and it must be the
          // rate the rollup bills (AGL-1957) — so it is served from the same
          // constants rather than duplicated into the client bundle. This
          // survived the 2026-08-18 correction unchanged and must keep doing
          // so: the quoted price IS the invoiced price.
          pricePerGbUsd: storageOveragePricePerGbUsd(),
        },
        { status: 200 },
      )
    }

    if (action === 'clearCap') {
      // Deletes the whole document, legacy consent fields included, so an org
      // that clears its cap is byte-identical to one that never set one.
      await orgRef.set(
        { storageOverage: FieldValue.delete() },
        { merge: true },
      )
      return Response.json(
        { ok: true, capSet: false, monthlyCapUsd: null },
        { status: 200 },
      )
    }

    // A plan that never bills for storage has no overage for a cap to bound.
    // Storing one would be a control that does nothing — and a control that
    // does nothing reads as protection, which is worse than none.
    //
    // Note this is NOT a gate on storing: a free org's uploads are refused at
    // its band whatever this route does. It is a gate on offering a knob.
    if (!metered) {
      return Response.json(
        {
          error:
            'Your plan never bills for storage — its allowance is a fixed ' +
            'cap and uploads stop there, so there is no overage to limit. ' +
            'Upgrade in Billing to store more.',
          code: 'not_metered',
        },
        { status: 409 },
      )
    }

    const requested = Number(body?.capUsd)
    const cap = Number.isFinite(requested) ? requested : STORAGE_CAP_FALLBACK_USD
    // The cap must be a real number in a real range. Zero or negative would
    // refuse every overage byte while reading as a limit; above the maximum
    // is a self-serve org writing itself an enterprise-sized commitment.
    if (cap <= 0 || cap > STORAGE_CAP_MAX_USD) {
      return Response.json(
        {
          error:
            `Set a monthly storage cap between $1 and $${STORAGE_CAP_MAX_USD}.`,
          code: 'invalid_cap',
        },
        { status: 400 },
      )
    }

    await orgRef.set(
      {
        storageOverage: {
          capUsd: cap,
          capSetAt: FieldValue.serverTimestamp(),
          capSetBy: decoded.uid,
          // The legacy consent pair is cleared on any write, so an org that
          // sets a cap today is not also carrying a stale acknowledgement
          // that `resolveStorageCap` would read as a second, different
          // ceiling.
          acknowledgedAt: FieldValue.delete(),
          acknowledgedBy: FieldValue.delete(),
          monthlyCeilingUsd: FieldValue.delete(),
        },
      },
      { merge: true },
    )
    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        actorEmail: decoded.email ?? null,
        action: 'billing.storageOverage.setCap',
        target: `orgs/${orgId}`,
        before: {
          capSet: current.capSet,
          monthlyCapUsd: current.monthlyCapUsd,
        },
        after: { capSet: true, monthlyCapUsd: cap },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json(
      { ok: true, capSet: true, monthlyCapUsd: cap },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'Storage overage update failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
