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
import {
  type StaffMediaPage,
  staffMediaScopeBase,
  staffMediaScopeFrom,
  staffMediaSort,
} from '../../../../utils/staff-media-library'
import {
  readStaffListQuery,
  STAFF_LIST_DEFAULT_PAGE,
  STAFF_LIST_MAX_PAGE,
} from '../../../../utils/server/staff-list-query'
import {
  recordStaffMediaView,
  staffMediaPageQuery,
  staffMediaRowFrom,
} from '../../../../utils/server/staff-media-library'

/**
 * One page of a media library, for the staff organization and site pages —
 * read-only.
 *
 * `GET ?orgId=<id>|hostId=<id>&cursor=<mediaId>&pageSize=<n>&sort=<path:dir>`
 * → `{ rows, hasMore, nextCursor }`.
 *
 * `orgId` reads the workspace's shared library (`orgs/{id}/media`), `hostId`
 * a site's own (`hosts/{id}/media`). Paged on the query
 * (`staffMediaPageQuery`); a private asset's thumbnail is a staff-minted
 * signed URL; every page is recorded as a `media.library-viewed` access row
 * before it is served. See `utils/server/staff-media-library.ts`.
 *
 * Trashed assets are listed and marked: staff asking "what does this
 * workspace hold" are owed the bytes it still stores.
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
  const scope = staffMediaScopeFrom(query ?? {})
  if (!scope) {
    return Response.json({ error: 'Name one organization or one site' }, { status: 400 })
  }

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
    const parent = db.doc(staffMediaScopeBase(scope))
    const parentSnap = await parent.get()
    if (!parentSnap.exists) {
      return Response.json(
        { error: scope.kind === 'org' ? 'No such organization' : 'No such site' },
        { status: 404 },
      )
    }
    const asked = readStaffListQuery(query ?? {})
    const requestedSize = Math.floor(Number(query['pageSize'] ?? STAFF_LIST_DEFAULT_PAGE))
    const pageSize =
      Number.isFinite(requestedSize) && requestedSize > 0
        ? Math.min(requestedSize, STAFF_LIST_MAX_PAGE)
        : STAFF_LIST_DEFAULT_PAGE
    const sort = staffMediaSort(asked?.sort ?? null)
    const media = parent.collection('media')

    // A document id, re-read as a snapshot: a value cursor would skip every
    // asset sharing the last one's timestamp or size.
    const cursorId = String(query['cursor'] ?? '').trim()
    let after: FirebaseFirestore.DocumentSnapshot | null = null
    if (/^[A-Za-z0-9_-]{1,128}$/.test(cursorId)) {
      const snapshot = await media.doc(cursorId).get()
      if (snapshot.exists) after = snapshot
    }
    const snapshot = await staffMediaPageQuery(media, sort, pageSize, after).get()
    const docs = snapshot.docs.slice(0, pageSize)
    const hasMore = snapshot.docs.length > pageSize
    const nowMs = Date.now()
    const page: StaffMediaPage = {
      rows: docs.map((doc) => staffMediaRowFrom(scope, doc.id, doc.data() ?? {}, nowMs)),
      hasMore,
      nextCursor: hasMore ? (docs[docs.length - 1]?.id ?? null) : null,
    }

    // Written before the page leaves: a read the log cannot record is not served.
    await recordStaffMediaView({
      actorUid: decoded.uid,
      scope,
      note:
        `${page.rows.length} assets, sorted by ${sort.label ?? sort.path} ${sort.direction}` +
        (after ? ', a later page' : ', first page'),
    })

    return Response.json(page, {
      status: 200,
      // Rows carry signed URLs: a per-caller, time-boxed capability.
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/media-library] failed', error)
    return Response.json({ error: 'The media library could not be read' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
