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
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { readBundleLinkDomain } from '@aglyn/tenant-data-admin/server/bundle-links'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — a read of the self-serve billing surface, which stays
// whole under a lock so members can see and pay what they owe (see
// billing/checkout); it answers one line of a link staff minted and writes nothing.

/**
 * The domain line of a staff-minted bundle link (AGL-3955), for the Billing
 * page the link opens.
 *
 * `GET ?orgId=&id=` answers the chosen name, its first-year and renewal
 * prices as quoted when the link was minted, and the site it is for — read
 * from the `bundleLinks` record, never from the URL, so an edited link cannot
 * show a name or a price nobody quoted. `available: false` says this
 * deployment does not sell domains, so the page shows the line disabled with
 * the reason instead of a purchase it cannot make.
 *
 * Any member who can see Billing may read it: the record names the workspace
 * it is for, and a link for another workspace answers no line at all.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const url = new URL(request.url)
  const orgIdParam = String(url.searchParams.get('orgId') ?? '').trim()
  const linkId = String(url.searchParams.get('id') ?? '').trim()
  if (!linkId) return Response.json({ error: 'Missing id' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const membership = await resolveOrgMembership(decoded.uid, orgIdParam || null)
    if (!membership) {
      return Response.json({ error: 'No workspace' }, { status: 403 })
    }
    if (!(await memberHasOrgPermission(membership.orgId, membership.member, 'billing.view'))) {
      return Response.json({ error: 'billing.view required' }, { status: 403 })
    }
    const answer = await readBundleLinkDomain(membership.orgId, linkId)
    return Response.json(answer, { status: 200 })
  } catch (error) {
    // A refused credential is a 401 (AGL-1993); anything else is ours.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The bundle link could not be read' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
