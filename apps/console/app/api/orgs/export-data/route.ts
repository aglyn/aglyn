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
  exportFilename,
  exportOrgData,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Download everything the workspace holds (AGL-1974).
 *
 * Six surfaces have been telling customers to export before deleting — the
 * settings Delete tab, the Close account card, `erase-org-cli.mjs`, the staff
 * org actions, live DPA §11 ("Customer is responsible for exporting its data
 * before termination") and Terms §13.3 — and there was nothing to export with.
 * This is that thing. It is deliberately reachable from the same tab that
 * gives the instruction, because an instruction whose fulfilment is somewhere
 * else is most of the way to no instruction at all.
 *
 * **Not `GET /api/hosts/export`**, which is a Pro+ site-design backup whose
 * own header comment says it never includes bookings, leads, submissions or
 * secrets. Offering that as a portability answer would be misdescribing it.
 *
 * ## Authorization
 *
 * Owner or admin, and no entitlement gate. A portability right is not a
 * feature to be sold: gating it on a plan would make the published §7 promise
 * conditional on paying us, which is not what it says and not what the
 * regulation permits. Everyone below owner/admin is refused because this is
 * the whole workspace — its members' emails, its customers' orders and form
 * submissions, its support threads — and a viewer or a site collaborator
 * invited to one site has no claim on the rest of it.
 */

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String((query as any)?.orgId ?? '')
  if (!orgId) {
    return Response.json({ error: 'Missing orgId' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const peek = await auth.verifyIdToken(idToken)
    const tenantId = peek.firebase?.tenant
    const decoded = tenantId
      ? await auth.tenantManager().authForTenant(tenantId).verifyIdToken(idToken)
      : peek
    if (isImpersonationSession(decoded)) {
      return Response.json(
        {
          error:
            'An impersonated session cannot export a customer’s workspace data.',
        },
        { status: 403 },
      )
    }
    if (!decoded.email_verified && !tenantId) {
      return emailUnverifiedResponse()
    }

    // Membership resolved for the NAMED org, never the caller's default —
    // a route that fell back to "their first workspace" on an unrecognized id
    // would hand somebody their own data while looking like it honoured the
    // request for another one.
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const role = String((membership?.member as any)?.role ?? '')
    const staff = decoded['staff'] === true
    if (!staff && (!membership || (role !== 'owner' && role !== 'admin'))) {
      // 404, not 403: an org id a caller has no standing in should not be
      // confirmed to exist, which is the same posture the staff console takes.
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const org = await getOrgDoc(orgId)
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: (org ?? {}) as Record<string, unknown>,
    })
    if (locked) return locked

    const exported = await exportOrgData(orgId)

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'org.exported',
        target: `orgs/${orgId}`,
        before: null,
        // Ids and counts, never content (AGL-1443).
        after: {
          sources: Object.keys(exported.data),
          documents: Object.values(exported.data).reduce(
            (total, rows) => total + rows.length,
            0,
          ),
        },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return new Response(JSON.stringify(exported, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(exported)}"`,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    console.error('[orgs/export-data] failed', error)
    return Response.json({ error: 'Preparing the export failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
