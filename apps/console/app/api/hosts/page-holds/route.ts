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

/**
 * A site's HELD AND FLAGGED PAGES (AGL-3374), for the console surfaces an
 * owner works in — the screens, layouts and components lists and their
 * editors — to put the hold on the page, template, layout or component it is
 * about.
 *
 * `GET ?hostId=` lists the open page notices (`listHostPageHolds`): each
 * page by name, what visitors see, its status, and whether a review can be
 * requested. Read-only: a review is requested through
 * `/api/orgs/risk-notices`, and nothing a site member can reach releases a
 * page — that is staff's decision in the abuse queue.
 *
 * Site members and staff. `canRequestReview` says whether THIS reader is an
 * owner or admin of the workspace, the people `/api/orgs/risk-notices`
 * takes a request from.
 */

// lockdown-423: exempt — read-only, and part of the appeal path: a locked site's members must
// still see which of its pages is held and why before they ask for a review.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listHostPageHolds,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

const MANAGER_ROLES = new Set(['owner', 'admin'])

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
  const hostId = String(query.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
    if (!host.exists) return Response.json({ error: 'Unknown site' }, { status: 404 })
    const memberRole = (host.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole && !isStaff) {
      return Response.json({ error: 'Not a member of this site' }, { status: 403 })
    }
    const orgId = await resolveOrgIdForHost(hostId)
    const actor = orgId ? await resolveOrgMembership(decoded.uid, orgId) : null
    const holds = await listHostPageHolds({ hostId })
    return Response.json(
      {
        holds,
        orgId,
        canRequestReview: MANAGER_ROLES.has(String(actor?.member?.role)),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[hosts/page-holds] failed', error)
    return Response.json({ error: 'Reading held pages failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
