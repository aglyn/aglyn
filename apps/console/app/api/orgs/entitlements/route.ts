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

import { resolveEffectivePlan, resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  getOrgDoc,
  isImpersonationSession,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — read-only, writes nothing; it only says what the
// workspace's plan includes, which a locked workspace's owner needs too.

/**
 * What a workspace's plan includes, resolved (AGL-3670): the effective plan,
 * every feature flag and every quota, through the same
 * `resolveOrgEntitlements` the console's gates call over the org document it
 * already holds. The native apps hold no copy of the plan table, so they ask
 * here and gate a screen exactly where the console does (the Analytics
 * page's per-page table, a site's service quota).
 *
 * `GET ?orgId=` for a member of the workspace, or `GET ?hostId=` for anyone
 * the site counts as a member (its collaborators included), answered for the
 * workspace that owns the site. Nothing a member cannot already see: the
 * console resolves the same answer in their browser from the org document.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query['orgId'] ?? '').trim()
  const hostId = String(query['hostId'] ?? '').trim()
  if (!orgId && !hostId) return Response.json({ error: 'Missing orgId or hostId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    let org: Record<string, unknown> | null = null
    let resolvedOrgId = orgId
    if (hostId) {
      const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
      const memberRoles = (host.get('memberRoles') ?? {}) as Record<string, unknown>
      if (!host.exists || (!isStaff && !memberRoles[decoded.uid])) {
        return Response.json({ error: 'Not a member of this site' }, { status: 403 })
      }
      const owner = await getOrgForHost(hostId)
      if (!owner || (orgId && owner.orgId !== orgId)) {
        return Response.json({ error: 'Unknown workspace' }, { status: 404 })
      }
      resolvedOrgId = owner.orgId
      org = owner.org as Record<string, unknown>
    } else {
      if (!isStaff && !(await resolveOrgMembership(decoded.uid, orgId))?.member) {
        return Response.json({ error: 'Not a member of this workspace' }, { status: 403 })
      }
      org = (await getOrgDoc(orgId)) as Record<string, unknown> | null
      if (!org) return Response.json({ error: 'Unknown workspace' }, { status: 404 })
    }
    const { features, ...quotas } = resolveOrgEntitlements(org as never)
    return Response.json(
      { orgId: resolvedOrgId, plan: resolveEffectivePlan(org as never), features, quotas },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Entitlement lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
