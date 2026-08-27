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
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { readActorActivity } from '../../../../utils/server/actor-activity'
import { readListFilter } from '../../../../utils/server/list-filter'

// lockdown-423: exempt — read-only, writes nothing, and it is the record of
// what someone did. A lockdown is often the reason staff are reading it.

/**
 * Everything one account has done, across every organization (AGL-1488).
 *
 * The staff user page could see who someone is, what they accepted and where
 * they have signed in from, and nothing at all about what they DID — the
 * question that is being asked whenever that page is open for a reason.
 * "Recent audit trail" on it is the log of STAFF actions taken against the
 * account, which is a different log answering a different question.
 *
 * Staff only, and Admin-SDK by necessity: this is a collection-group read
 * across every site and org on the platform, which is not a query any client
 * should be able to run and which no security rule grants.
 */
async function handler(request: Request): Promise<Response> {
  const { query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const uid = String(query['uid'] ?? '').trim()
    if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })
    const page = await readActorActivity({
      actorId: uid,
      pageSize: Number(query['pageSize'] ?? 25),
      cursor: String(query['cursor'] ?? '') || null,
      // The column filter, answered by the query rather than by the page.
      filter: readListFilter(query),
    })
    return Response.json(page, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a 500 (AGL-1993): an expired token
    // answered as a server error tells the client to retry the same dead
    // token, and tells us nothing is wrong.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Activity lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
