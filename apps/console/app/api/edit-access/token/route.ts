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

import { isReleaseFlagOn, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  getServerReleaseFlagValues,
  isImpersonationSession,
  lockdownRefusal,
  mintEditAccessToken,
} from '@aglyn/tenant-data-admin'

/**
 * Mint an edit-access token for the tenant admin bar (admin edit bar,
 * AGL-1302 follow-on).
 *
 * Called by the `/edit-access` popup, which is the first-party context where
 * the console session actually exists — a published site cannot see it, so
 * the site sends the visitor HERE, and this route sends back a verdict it
 * can carry home. Authorization is deliberately the SAME gate the presence
 * broker applies for co-editing writes (`/api/presence/token`): host
 * `memberRoles` admin/editor, or an org roster role above viewer. Membership
 * is proven against the host the caller names — never against a caller-
 * supplied orgId, which would let anyone pick a friendly org.
 *
 * The response also carries the host's PUBLIC origins, read from the host
 * doc — the popup refuses to postMessage the token anywhere else, so a page
 * that opened the popup under a hostId it does not serve gets nothing.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()

    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const orgId = host.get('orgId') as string | undefined
    if (!orgId) {
      return Response.json({ error: 'Site has no organization' }, { status: 409 })
    }

    // Dark until released (and the kill switch): tokens stop being minted
    // the moment the flag flips off, and the tenant verify route refuses
    // outstanding ones too.
    const flags = await getServerReleaseFlagValues()
    if (!isReleaseFlagOn('release_edit_bar', flags.release_edit_bar, orgId)) {
      return Response.json({ error: 'Not available' }, { status: 404 })
    }

    const membership = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(decoded.uid)
      .get()
    if (!membership.exists) {
      return Response.json({ error: 'Not a member of this site' }, { status: 403 })
    }

    // The co-editing gate, verbatim: this bar deep-links into the editor,
    // so only people who could WRITE there should see it. A viewer gets a
    // plain 403 rather than a read-only bar — a convenience surface earns
    // no half-states.
    const hostRole = ((host.get('memberRoles') ?? {}) as Record<string, string>)[
      decoded.uid
    ]
    const orgRole = membership.get('role') as string | undefined
    const canEdit =
      hostRole === 'admin' ||
      hostRole === 'editor' ||
      orgRole === 'owner' ||
      orgRole === 'admin' ||
      orgRole === 'editor'
    if (!canEdit) {
      return Response.json({ error: 'No edit access' }, { status: 403 })
    }

    // Lockdown verdict (AGL-1506): a locked org/host mints no edit
    // capability. Host doc already in hand; the org scope rides the member
    // doc's `orgSuspended` projection (also already read) — the org doc is
    // fetched only when the projection trips, so the happy path adds no
    // org read. Staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org:
        membership.get('orgSuspended') === true
          ? ((await getOrgDoc(orgId)) ?? {})
          : undefined,
      host: host.data(),
    })
    if (locked) return locked

    const { token, expiresAtMs } = mintEditAccessToken(hostId, decoded.uid)

    // Where the popup may deliver the token: the host's own public names,
    // nothing else. Off-production, the local tenant dev server and its
    // subdomain form join the list so the flow is testable on localhost.
    const cname = host.get('cname') as string | undefined
    const subdomain = host.get('subdomain') as string | undefined
    const origins: string[] = []
    if (cname) origins.push(`https://${cname}`)
    if (subdomain) origins.push(`https://${subdomain}.aglyn.app`)
    if (process.env.NODE_ENV !== 'production') {
      origins.push('http://localhost:4500')
      if (subdomain) origins.push(`http://${subdomain}.localhost:4500`)
    }

    return Response.json(
      {
        token,
        expiresAtMs,
        origins,
        siteName: (host.get('displayName') as string | undefined) ?? subdomain,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Could not verify edit access' }, { status: 500 })
  }
}

export const POST = handler
