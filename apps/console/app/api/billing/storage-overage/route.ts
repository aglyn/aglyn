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
  resolveStorageOverage,
  storageOveragePricePerGbUsd,
  STORAGE_OVERAGE_DEFAULT_CEILING_USD,
} from '../../../../utils/storage-overage'

// lockdown-423: exempt — self-serve billing surface, same posture as
// billing/addons and billing/checkout. AGL-1501 keeps billing-locked sessions
// alive precisely so members can reach Billing; and this is the control that
// stops an org accruing charges, so a 423 would trap it accruing them.

/** The most a self-serve org may set as its monthly storage-overage bound. */
export const STORAGE_OVERAGE_MAX_CEILING_USD = 5_000

/**
 * Acknowledge metered storage overage, and set the monthly bound (AGL-1886).
 *
 * Zach's condition on billing org-library storage from today, verbatim: "also
 * give overage protection and usage alerts, so customers don't get a surprise
 * bill." This route is the consent half of the protection.
 *
 *   `get`         → the current acknowledgement, ceiling, and whether the
 *                   plan meters storage at all
 *   `acknowledge` → stamp consent and store the ceiling
 *   `revoke`      → withdraw consent; the hard cap returns immediately
 *
 * `billing.manage`-gated: agreeing to a charge is the permission that buys
 * things. Admin-SDK-only by construction — `storageOverage` is an ENTITLEMENT
 * INPUT (it is what lets an upload past `storagePerHostMb`) and the rules deny
 * it to every client, so a member cannot grant their own org unbounded
 * storage and raise their own spend limit in one write.
 *
 * REVOKE IS ALWAYS AVAILABLE, including to a plan that no longer meters and
 * to an org already over its allowance: withdrawing consent must never be
 * gated on the same conditions as giving it, or an org that changed its mind
 * would be stuck accruing.
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
  if (!orgId || !['get', 'acknowledge', 'revoke'].includes(action)) {
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
    const current = resolveStorageOverage(org)

    if (action === 'get') {
      return Response.json(
        {
          ...current,
          metered,
          defaultCeilingUsd: STORAGE_OVERAGE_DEFAULT_CEILING_USD,
          maxCeilingUsd: STORAGE_OVERAGE_MAX_CEILING_USD,
          includedStoragePerSiteMb: entitlements.storagePerHostMb,
          // The card quotes a price before asking for consent, and it must be
          // the rate the rollup bills (AGL-1957) — so it is served from the
          // same constants rather than duplicated into the client bundle.
          pricePerGbUsd: storageOveragePricePerGbUsd(),
        },
        { status: 200 },
      )
    }

    if (action === 'revoke') {
      await orgRef.set(
        { storageOverage: FieldValue.delete() },
        { merge: true },
      )
      return Response.json(
        { ok: true, acknowledged: false, monthlyCeilingUsd: 0 },
        { status: 200 },
      )
    }

    // Free hard-bands and enterprise is UNLIMITED — neither has a metered
    // storage line for consent to attach to, and pretending otherwise would
    // store an acknowledgement that the upload gate then ignores. A stored
    // consent nothing reads is worse than none: it reads as protection.
    if (!metered) {
      return Response.json(
        {
          error:
            'Your plan does not meter storage — its storage allowance is a ' +
            'fixed cap. Upgrade in Billing to store more.',
          code: 'upgrade_required',
        },
        { status: 409 },
      )
    }

    const requested = Number(body?.monthlyCeilingUsd)
    const ceiling = Number.isFinite(requested)
      ? requested
      : STORAGE_OVERAGE_DEFAULT_CEILING_USD
    // A ceiling is the BOUND on the consent, so it must be a real number in a
    // real range. Zero or negative would be consent that refuses every byte —
    // indistinguishable from not acknowledging, but stored as if it were —
    // and an unbounded one is the surprise bill this exists to prevent.
    if (ceiling <= 0 || ceiling > STORAGE_OVERAGE_MAX_CEILING_USD) {
      return Response.json(
        {
          error:
            `Set a monthly storage limit between $1 and ` +
            `$${STORAGE_OVERAGE_MAX_CEILING_USD}.`,
          code: 'invalid_ceiling',
        },
        { status: 400 },
      )
    }

    await orgRef.set(
      {
        storageOverage: {
          acknowledgedAt: FieldValue.serverTimestamp(),
          acknowledgedBy: decoded.uid,
          monthlyCeilingUsd: ceiling,
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
        action: 'billing.storageOverage.acknowledge',
        target: `orgs/${orgId}`,
        before: {
          acknowledged: current.acknowledged,
          monthlyCeilingUsd: current.monthlyCeilingUsd,
        },
        after: { acknowledged: true, monthlyCeilingUsd: ceiling },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json(
      { ok: true, acknowledged: true, monthlyCeilingUsd: ceiling },
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
