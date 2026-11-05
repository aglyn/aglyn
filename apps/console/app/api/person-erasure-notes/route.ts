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

import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { readPersonErasureNotes } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure-notes'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  lockdownRefusal,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../_lib/invalid-id-token-response'

/**
 * `GET /api/person-erasure-notes?orgId=…` (AGL-4042): what the plugins say a
 * person erasure keeps, for the Erase a person card to print before anyone
 * files one (`@aglyn/aglyn/plugin-manager/plugin-person-erasure-notes`).
 *
 * Asks what filing asks: "Privacy requests" (`org.privacy`) over the whole
 * workspace, and not staff acting alone (`/api/crm/erase-person`). Read-only,
 * and never a gate: the erasure takes no notice of it.
 */
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const orgId = String(new URL(request.url).searchParams.get('orgId') ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orgId)) return json({ error: 'Missing orgId' }, 400)

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    const member = (await resolveOrgMembership(decoded.uid, orgId))?.member ?? null
    if (
      !member ||
      !isOrgWideMember(member) ||
      !(await memberHasOrgPermission(orgId, member, 'org.privacy'))
    ) {
      return json({ error: permissionRefusalText('org.privacy') }, 403)
    }
    const org = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
    if (!org.exists) return json({ error: 'Unknown organization' }, 404)
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: org.data(),
    })
    if (locked) return locked
    return json(await readPersonErasureNotes({ orgId }))
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[person-erasure-notes]', error)
    return json({ error: 'Person erasure notes failed' }, 500)
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
