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
} from '@aglyn/tenant-data-admin'
import { resolveAccountEmails } from '../../../../utils/server/actor-activity'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/** The most uids one request resolves — a page of the feed, not a directory. */
const ACTIVITY_ACTORS_MAX = 50

/**
 * The current address of each account a SITE's activity log names by uid
 * alone (AGL-3369).
 *
 *   GET ?hostId=…&uids=a,b,c  →  { actors: { [uid]: email } }
 *
 * The site feeds read `hosts/{hostId}/activity` in the browser, which can
 * see a uid but cannot turn one into an address. The org feed resolves on
 * its own route; this is the same lookup for the site feeds.
 *
 * Gated exactly as the log itself is: staff, or any member of the site —
 * whoever may read the entry may read who wrote it. And bounded to the log:
 * a uid is resolved only when an entry on THIS site names it as its actor,
 * so a member cannot use the route as a uid-to-address directory for
 * accounts that never acted here.
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
  const hostId = String(query['hostId'] ?? '').trim()
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  const uids = [
    ...new Set(
      String(query['uids'] ?? '')
        .split(',')
        .map((uid) => uid.trim())
        .filter((uid) => uid && uid !== 'api' && !uid.startsWith('system:')),
    ),
  ]
  if (uids.length > ACTIVITY_ACTORS_MAX) {
    return Response.json(
      { error: `At most ${ACTIVITY_ACTORS_MAX} uids per request` },
      { status: 400 },
    )
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // The rules' `isHostMember`: any role on the site's `memberRoles`.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (decoded['staff'] !== true && memberRole == null) {
      return Response.json({ error: 'Not a member of this site' }, { status: 403 })
    }
    const named = await Promise.all(
      uids.map(async (uid) => {
        const hit = await hostRef
          .collection('activity')
          .where('actorId', '==', uid)
          .select()
          .limit(1)
          .get()
        return hit.empty ? null : uid
      }),
    )
    const emails = await resolveAccountEmails(named)
    return Response.json({ actors: Object.fromEntries(emails) }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Actor lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
