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
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  logHostActivity,
  logOrgActivity,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  HostTransferRefusedError,
  planHostTransfer,
  transferHost,
} from '@aglyn/tenant-data-admin/server/transfer-host'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { revalidateEntireHost } from '../../../../utils/server/tenant-revalidate'

/** The shortest reason the audit row will carry. */
const MIN_REASON = 8

/**
 * Staff move a site to another organization (AGL-3381). Super staff only.
 *
 *   GET  ?hostId=&toOrgId=&overrideSiteLimit=1
 *        → the plan: what moves, what stays, what refuses (writes nothing)
 *   POST { hostId, toOrgId, overrideSiteLimit?, reason }
 *        → the transfer, re-planned first; 409 with the plan when it holds
 *
 * The rules of the move — what goes with the site, what stays with the old
 * organization and what refuses it — are `transfer-host.ts`'s, not this
 * route's. This route authenticates, records who did it and why on both
 * organizations' activity, the site's, and `adminAudit`, and drops the live
 * site's caches so it renders under its new owner's plan at once.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const input = method === 'GET' ? query : (body ?? {})
  const hostId = String(input['hostId'] ?? '').trim()
  const toOrgId = String(input['toOrgId'] ?? '').trim()
  const override = input['overrideSiteLimit']
  const overrideSiteLimit = override === true || override === '1' || override === 'true'
  if (!hostId || !toOrgId) {
    return Response.json({ error: 'Name the site and the destination organization' }, { status: 400 })
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return Response.json({ error: 'Staff only' }, { status: 403 })
    if (String(decoded['staffRole'] ?? 'support') !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }

    if (method === 'GET') {
      const plan = await planHostTransfer({ hostId, toOrgId, overrideSiteLimit })
      return Response.json({ plan }, { status: 200 })
    }

    const reason = String(input['reason'] ?? '').trim()
    if (reason.length < MIN_REASON) {
      return Response.json(
        { error: `Say why, in at least ${MIN_REASON} characters — it is recorded on the audit row` },
        { status: 400 },
      )
    }

    let plan
    try {
      plan = await transferHost({ hostId, toOrgId, overrideSiteLimit })
    } catch (error) {
      if (error instanceof HostTransferRefusedError) {
        return Response.json({ error: error.message, plan: error.plan }, { status: 409 })
      }
      throw error
    }

    const firestore = app.firestore()
    const staff = { uid: decoded.uid, email: decoded.email ? String(decoded.email) : null }
    const site = { type: 'host' as const, id: hostId, name: plan.siteName ?? undefined }
    // Each organization's log says what happened to it, attributed to staff
    // and not to anyone in the workspace.
    await Promise.all([
      plan.fromOrgId
        ? logOrgActivity(
            plan.fromOrgId,
            { uid: null },
            `Moved a site to ${plan.toOrgName ?? plan.toOrgId}`,
            site,
            { staffActorId: decoded.uid },
          ).catch(() => undefined)
        : Promise.resolve(),
      logOrgActivity(
        toOrgId,
        { uid: null },
        `Received a site from ${plan.fromOrgName ?? plan.fromOrgId ?? 'no organization'}`,
        site,
        { staffActorId: decoded.uid },
      ).catch(() => undefined),
      logHostActivity(
        hostId,
        { uid: decoded.uid, email: staff.email },
        `Moved to the organization ${plan.toOrgName ?? plan.toOrgId}`,
        { type: 'host', id: hostId, name: plan.siteName ?? undefined },
      ).catch(() => undefined),
      addAdminAudit(firestore, {
        actorUid: decoded.uid,
        action: 'host.transfer',
        target: `hosts/${hostId}`,
        reason,
        before: { orgId: plan.fromOrgId },
        after: { orgId: toOrgId, overrideSiteLimit },
        at: FieldValue.serverTimestamp(),
      }).catch(() => undefined),
    ])
    // Plan, plugins and suspension are read through the owner: every cached
    // page was rendered under the old one.
    await revalidateEntireHost(firestore, hostId).catch(() => undefined)

    return Response.json({ ok: true, plan }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/site-transfer] failed', error)
    return Response.json({ error: 'Site transfer failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
