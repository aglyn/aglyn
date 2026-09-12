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
  PLAN_PRICING,
  pluginRequestFromWeb,
  resolveEffectivePlan,
} from '@aglyn/aglyn/server'
import {
  ASSIST_HARD_CAP_CONTROL_LABEL,
  resolveAssistCreditBudget,
  resolveAssistHardCap,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — self-serve billing surface, same posture as
// billing/storage-overage beside it. AGL-1501 keeps billing-locked sessions
// alive precisely so members can reach Billing, and this is the control that
// stops an org accruing assist charges, so a 423 would trap it accruing them.

/**
 * Read or set the org's own assist hard-cap switch (AGL-2653).
 *
 * Credits past the plan's assist band are SOLD by default, at
 * `PLAN_PRICING.extraAssistCreditsUsdPer1k`. This route is the one control a
 * customer has over that, and nothing else — it is not a consent surface,
 * and there is nothing here an org must do before assist works.
 *
 *   `get`        → whether the switch is on, the band, the rate the overage
 *                  bills at, and whether the plan sells overage at all
 *   `setHardCap` → store `hardCap: true | false`
 *
 * `billing.manage`-gated, because the switch bounds spend in both directions:
 * turning it off is what lets the org be invoiced past its band, and turning
 * it on is what stops a workspace's assistant at the band. Admin-SDK-only by
 * construction — `assistOverage` is denied to every client in the rules, so a
 * member cannot lift their own ceiling or lower somebody else's.
 *
 * TURNING IT OFF IS ALWAYS AVAILABLE, on any plan and at any usage level: an
 * org that wants the sale back on must not have to argue with a precondition.
 * Turning it ON is refused, 409, on a plan that sells no overage — there the
 * band is already the wall (`assistBandRefuses`), and storing a switch that
 * changes nothing would read as protection the org does not have.
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
  if (!orgId || !['get', 'setHardCap'].includes(action)) {
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
    const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
    const hardCap = resolveAssistHardCap(org as never)
    const bandCredits = resolveAssistCreditBudget(org as never)
    // The rate the card quotes must be the rate the rollup bills, so it is
    // served from the same table rather than duplicated into the bundle.
    const overageRateUsdPer1k =
      PLAN_PRICING[resolveEffectivePlan(org as never)].extraAssistCreditsUsdPer1k
    const sellsOverage = bandCredits !== null && overageRateUsdPer1k !== null

    if (action === 'get') {
      return Response.json(
        {
          hardCap,
          bandCredits,
          overageRateUsdPer1k,
          sellsOverage,
          label: ASSIST_HARD_CAP_CONTROL_LABEL,
        },
        { status: 200 },
      )
    }

    // Strictly a boolean, the same way the resolver reads it strictly: a
    // string "false" arriving here would otherwise be stored as `true`.
    if (typeof body?.hardCap !== 'boolean') {
      return Response.json(
        { error: 'hardCap must be true or false', code: 'invalid_value' },
        { status: 400 },
      )
    }
    const requested = body.hardCap as boolean

    if (requested && !sellsOverage) {
      return Response.json(
        {
          error:
            bandCredits === null
              ? 'Your plan includes no AI assist credits, so there is no band ' +
                'to stop at. Upgrade in Billing to add AI assist.'
              : 'Your plan already stops AI assist at its included band — ' +
                'it sells no credits past it, so there is nothing to switch off.',
          code: 'not_sold',
        },
        { status: 409 },
      )
    }

    await orgRef.set(
      {
        assistOverage: {
          hardCap: requested,
          hardCapSetAt: FieldValue.serverTimestamp(),
          hardCapSetBy: decoded.uid,
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
        action: 'billing.assistOverage.setHardCap',
        target: `orgs/${orgId}`,
        before: { hardCap },
        after: { hardCap: requested },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json({ ok: true, hardCap: requested }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json(
      { error: 'Assist overage update failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
