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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  projectedHostFieldsUpdate,
  syncHostProjectionForMembers,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Write a site's mirrored name or favicon, and re-fan its per-member
 * `hostMemberships` rows from the host doc (AGL-844, AGL-3972).
 *
 * The rows are what every site list and switcher reads, and they are written
 * here and at the other Admin-SDK writers of their source fields, never by a
 * client. The console used to write `displayName` and `seo.favicon` from the
 * browser and then ping this route, chained on the write's acknowledgement,
 * which can take a minute under the multi-tab cache (AGL-3806); a page left
 * in that minute or a failed ping left every member's list on the old name
 * for good. So a body naming `displayName` or `favicon` is WRITTEN here, then
 * re-fanned, in one awaited request. A body naming neither only re-fans.
 *
 * Open to the roles the rules let write those fields from the browser
 * (`canWriteHostContent`): an `author` may rename a site there, so refusing
 * the author here left an author's rename unmirrored. It grants nothing the
 * rules do not already.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  const fields = projectedHostFieldsUpdate(body as Record<string, unknown> | null)
  if ('error' in fields) return Response.json({ error: fields.error }, { status: 400 })

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
    // "Edit site content" (`site.edit`, AGL-4047): the site's name and icon.
    if (decoded['staff'] !== true && !holdsSiteKey(hostSnapshot, decoded.uid, 'site.edit')) {
      return Response.json({ error: siteKeyRefusal('site.edit') }, { status: 403 })
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

    if (fields.update) {
      await hostSnapshot.ref.update({
        ...fields.update,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    }
    const orgId = hostSnapshot.get('orgId') as string | undefined
    if (orgId) await syncHostProjectionForMembers(orgId, hostId)
    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Sync failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
