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
import {
  deliveryRecordFrom,
  EMAIL_DELIVERY_MESSAGES_COLLECTION,
  EMAIL_DELIVERIES_COLLECTION,
} from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  STAFF_LIST_DEFAULT_PAGE,
  STAFF_LIST_MAX_PAGE,
} from '../../../../utils/server/staff-list-query'

/**
 * Firestore's `in` takes at most thirty values; an organization with more
 * sites reads its first thirty, and the response says how many it left out.
 */
const MAX_SITES = 30

/**
 * The mail a site sent, or every site of an organization sent (AGL-3380):
 * `?hostId=` or `?orgId=`, newest first, paged by `cursor`.
 *
 * `GET ?hostId=<id>|orgId=<id>&cursor=<path>&pageSize=<n>` →
 * `{ rows, nextCursor, hasMore, sitesOmitted }`.
 *
 * The same per-recipient delivery log the staff account page reads
 * (`emailDeliveries/{key}/messages`), queried across recipients by the
 * `hostId` every site send tags its messages with — the direction the
 * campaign-engagement read already takes, on a `(hostId, firstSeenAtMs DESC)`
 * collection-group index. Mail the platform sends to an organization's
 * members (invites, billing) carries no site and is on each member's own
 * staff page instead.
 *
 * `messages` is not a unique collection name, so every row is checked to
 * sit under `emailDeliveries`; `firstSeenAtMs`, the order, is a field only a
 * delivery record carries, so nothing else reaches the page in practice.
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

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const db = app.firestore()
    const hostId = String(query['hostId'] ?? '').trim()
    const orgId = String(query['orgId'] ?? '').trim()
    if (!hostId && !orgId) {
      return Response.json({ error: 'Name a site or an organization' }, { status: 400 })
    }
    let hostIds = hostId ? [hostId] : []
    let sitesOmitted = 0
    if (!hostId) {
      const org = await db.collection('orgs').doc(orgId).get()
      if (!org.exists) return Response.json({ error: 'No such organization' }, { status: 404 })
      const directory = (org.get('hosts') ?? {}) as Record<string, unknown>
      const all = Object.keys(directory)
        .filter((id) => Boolean(directory[id]))
        .sort()
      hostIds = all.slice(0, MAX_SITES)
      sitesOmitted = all.length - hostIds.length
    }
    if (hostIds.length === 0) {
      return Response.json({ rows: [], nextCursor: null, hasMore: false, sitesOmitted })
    }
    const asked = Math.floor(Number(query['pageSize'] ?? STAFF_LIST_DEFAULT_PAGE))
    const pageSize =
      Number.isFinite(asked) && asked > 0
        ? Math.min(asked, STAFF_LIST_MAX_PAGE)
        : STAFF_LIST_DEFAULT_PAGE
    let ref = db
      .collectionGroup(EMAIL_DELIVERY_MESSAGES_COLLECTION)
      .where('hostId', hostIds.length === 1 ? '==' : 'in', hostIds.length === 1 ? hostIds[0] : hostIds)
      .orderBy('firstSeenAtMs', 'desc')
    const cursor = String(query['cursor'] ?? '').trim()
    // A path, re-read as a snapshot: a value cursor would skip every message
    // sharing the last one's millisecond.
    if (cursor.startsWith(`${EMAIL_DELIVERIES_COLLECTION}/`)) {
      const after = await db.doc(cursor).get()
      if (after.exists) ref = ref.startAfter(after)
    }
    const snapshot = await ref.limit(pageSize + 1).get()
    const docs = snapshot.docs.slice(0, pageSize)
    const hasMore = snapshot.docs.length > pageSize
    const rows = docs
      .filter((docSnap) => docSnap.ref.path.startsWith(`${EMAIL_DELIVERIES_COLLECTION}/`))
      .map((docSnap) => ({ $id: docSnap.ref.path, ...deliveryRecordFrom(docSnap) }))
    return Response.json(
      {
        rows,
        hasMore,
        nextCursor: hasMore ? (docs[docs.length - 1]?.ref.path ?? null) : null,
        sitesOmitted,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/email-deliveries] failed', error)
    return Response.json({ error: 'Delivery log failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
