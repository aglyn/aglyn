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
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  syncHostProjectionForMembers,
} from '@aglyn/tenant-data-admin'

/**
 * Re-fan a host's per-member `hostMemberships` rows from its current doc
 * (AGL-844). The site displayName is a client write to the host doc that
 * bypasses the membership funnel, so after such an edit the Setup page pings
 * this to propagate the new name into every member's projection. It only
 * re-reads authoritative host data and rewrites the convenience index — it
 * grants nothing — so a host member (editor+) may trigger it.
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
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (decoded['staff'] !== true && memberRole !== 'admin' && memberRole !== 'editor') {
      return Response.json({ error: 'Not permitted' }, { status: 403 })
    }

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes; distinct
    // 423 body; staff bypass is the un-panic invariant. The org doc is
    // fetched deliberately — an org lock never stamps host docs, so a
    // host-only verdict would silently miss it.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    const orgId = hostSnapshot.get('orgId') as string | undefined
    if (orgId) await syncHostProjectionForMembers(orgId, hostId)
    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Sync failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
