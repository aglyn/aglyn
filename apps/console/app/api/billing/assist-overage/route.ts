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
  ASSIST_OVERAGE_CAP_CONTROL_LABEL,
  ASSIST_OVERAGE_CAP_MAX_USD,
  ASSIST_OVERAGE_CAP_MIN_USD,
  resolveAssistCreditBudget,
  resolveAssistHardCap,
  resolveAssistOverageCapUsd,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  logAiOverageControl,
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
 * Read or set the org's own assist controls: the hard-cap switch (AGL-2653)
 * and the dollar ceiling on overage (AGL-2898).
 *
 * Credits past the plan's assist band are SOLD by default, at
 * `PLAN_PRICING.extraAssistCreditsUsdPer1k`. This route holds the two
 * controls a customer has over that, and nothing else — it is not a consent
 * surface, and there is nothing here an org must do before assist works.
 *
 *   `get`        → whether the switch is on, the ceiling if any, the band,
 *                  the rate the overage bills at, and whether the plan sells
 *                  overage at all
 *   `setHardCap` → store `hardCap: true | false`
 *   `setCap`     → store `capUsd: number`, or `null` to clear the ceiling
 *
 * `billing.manage`-gated, because both controls bound spend in both
 * directions: lifting either is what lets the org be invoiced further past
 * its band, and setting either is what stops a workspace's assistant.
 * Admin-SDK-only by construction — `assistOverage` is denied to every client
 * in the rules, so a member cannot lift their own ceiling or lower somebody
 * else's.
 *
 * TURNING THE SWITCH OFF AND CLEARING THE CEILING ARE ALWAYS AVAILABLE, on
 * any plan and at any usage level: an org that wants the sale back on must
 * not have to argue with a precondition. Turning the switch on, or setting a
 * ceiling, is refused, 409, on a plan that sells no overage — there the band
 * is already the wall (`assistBandRefuses`), and storing a control that
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
  if (!orgId || !['get', 'setHardCap', 'setCap'].includes(action)) {
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
    const capUsd = resolveAssistOverageCapUsd(org as never)
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
          capUsd,
          bandCredits,
          overageRateUsdPer1k,
          sellsOverage,
          label: ASSIST_HARD_CAP_CONTROL_LABEL,
          capLabel: ASSIST_OVERAGE_CAP_CONTROL_LABEL,
          minCapUsd: ASSIST_OVERAGE_CAP_MIN_USD,
          maxCapUsd: ASSIST_OVERAGE_CAP_MAX_USD,
        },
        { status: 200 },
      )
    }

    if (action === 'setCap') {
      const raw = body?.capUsd
      // `null` clears; anything else must be a real number in a real range.
      // A string "25" is refused rather than coerced, the way the switch
      // refuses a string "false": the resolver reads the field strictly, so
      // a value that reached the document as a string would be no ceiling
      // at all while the card said one was set.
      const clearing = raw === null
      if (
        !clearing &&
        (typeof raw !== 'number' ||
          !Number.isFinite(raw) ||
          raw < ASSIST_OVERAGE_CAP_MIN_USD ||
          raw > ASSIST_OVERAGE_CAP_MAX_USD)
      ) {
        return Response.json(
          {
            error:
              `Set a monthly AI overage ceiling between ` +
              `$${ASSIST_OVERAGE_CAP_MIN_USD} and ` +
              `$${ASSIST_OVERAGE_CAP_MAX_USD.toLocaleString('en-US')}, ` +
              `or clear it.`,
            code: 'invalid_cap',
          },
          { status: 400 },
        )
      }
      if (!clearing && !sellsOverage) {
        return Response.json(
          {
            error:
              bandCredits === null
                ? 'Your plan includes no AI assist credits, so there is no ' +
                  'overage to cap. Upgrade in Billing to add AI assist.'
                : 'Your plan already stops AI assist at its included band — ' +
                  'it sells no credits past it, so there is no overage to cap.',
            code: 'not_sold',
          },
          { status: 409 },
        )
      }
      const requestedCap = clearing ? null : (raw as number)
      await orgRef.set(
        {
          assistOverage: {
            capUsd: requestedCap,
            capSetAt: FieldValue.serverTimestamp(),
            capSetBy: decoded.uid,
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
          action: 'billing.assistOverage.setCap',
          target: `orgs/${orgId}`,
          before: { capUsd },
          after: { capUsd: requestedCap },
          at: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
      // The customer's own feed (AGL-2929): `adminAudit` is staff-only, and
      // the workspace should see who set its ceiling. Nothing when the value
      // did not move.
      await logAiOverageControl(
        orgId,
        { uid: decoded.uid, email: decoded.email ?? null },
        { control: 'cap', before: capUsd, after: requestedCap },
      )
      return Response.json({ ok: true, capUsd: requestedCap }, { status: 200 })
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
    await logAiOverageControl(
      orgId,
      { uid: decoded.uid, email: decoded.email ?? null },
      { control: 'hardCap', before: hardCap, after: requested },
    )

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
