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
  findUserByUidAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { resolveAccountAddresses } from '@aglyn/tenant-data-admin/server/account-addresses'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import { readStaffListQuery } from '../../../../../utils/server/staff-list-query'
import { readUserEmailHistoryPage } from '../../../../../utils/server/user-email-history'

// lockdown-423: exempt — read-only, writes nothing; the record of what we
// sent a person is what a lockdown investigation reads.

/**
 * What we sent one account, a page at a time (AGL-3321): its staff page's
 * Email delivery table. Every Filters-panel clause and the search word go
 * onto the query of each address the account holds
 * (`utils/server/user-email-history.ts`), and what the query could not take
 * comes back as `refused` rather than being matched over the rows read.
 * Staff only. Reading the list is not audited, for the reason the delivery
 * log's other staff reads are not; opening one message's body is.
 *
 *   GET ?uid=<uid>&filters=…&search=…&cursor=…&pageSize=…
 *   →  { rows, nextCursor, hasMore, refused, notices, addressesIncomplete }
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
  const uid = String(query['uid'] ?? '')
  if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })
  const listRequest = readStaffListQuery(query)
  if (!listRequest) return Response.json({ error: 'Unreadable filters' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const found = await findUserByUidAcrossPools(uid)
    if (!found) return Response.json({ error: 'No such account' }, { status: 404 })
    /*
     * Every address the account holds — primary, provider-supplied, and the
     * ones it has been moved off — because the log files mail under the
     * address it went to, and an account whose primary changed would
     * otherwise read an empty history under the new hash.
     */
    const addresses = await resolveAccountAddresses({
      uid,
      record: found.record,
      firestore,
    })
    const page = await readUserEmailHistoryPage({
      firestore,
      addresses: addresses.addresses.map((entry) => entry.address),
      request: listRequest,
    })
    return Response.json(
      { ...page, addressesIncomplete: addresses.incomplete },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/users/email-history] read failed', error)
    return Response.json({ error: 'The delivery log could not be read' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
