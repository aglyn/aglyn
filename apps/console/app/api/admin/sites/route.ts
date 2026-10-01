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
  resolveUidsToPeople,
} from '@aglyn/tenant-data-admin'
import { leavingNoticeEndsAt } from '@aglyn/tenant-data-admin/server/leaving-notice'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../utils/server/staff-list-query'
import { STAFF_SITE_LIST_QUERY } from '../../../../utils/staff-site-list-query'
import { homeScreenId } from '../../../../utils/staff-site-links'
import {
  LAPSED_SUSPENSIONS_NOTICE,
  asksAboutSuspension,
  settleLapsedSuspensions,
  suspensionInForce,
} from '../../../../utils/server/suspended-flag'

/**
 * The staff Sites list (AGL-3378): every site on the platform, one page at a
 * time, with the organization it belongs to and that organization's owner.
 *
 * The staff list wire (`utils/server/staff-list-query.ts`):
 * `?filters=<JSON>&search=<words>&cursor=<path>&pageSize=<n>` →
 * `{ sites, nextCursor, hasMore, refused, notices }`.
 *
 * A separate route from `/api/admin/hosts`, which is the id-cursor picker
 * walk the org page and the system-email drawer read (and a spec pins): this
 * one is the query the Filters panel and the search are planned onto
 * (`STAFF_SITE_LIST_QUERY`), and nothing is matched after it runs.
 *
 * Read with the Admin SDK for the reason `/api/admin/hosts` gives: a client
 * list over `hosts` is gated per document, and a verdict that flips mid-query
 * can tombstone a site in the local cache for every other reader.
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
    const listRequest = readStaffListQuery(query)
    if (!listRequest) {
      return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    }
    // A lapsed timed takedown keeps its stored flag until something clears
    // it, so a query that asks about the flag clears them first
    // (`utils/server/suspended-flag.ts`).
    const settled = asksAboutSuspension(listRequest.clauses)
      ? await settleLapsedSuspensions(db.collection('hosts'))
      : null
    const page = await runStaffListQuery({
      firestore: db,
      collection: db.collection('hosts'),
      declaration: STAFF_SITE_LIST_QUERY,
      request: listRequest,
      row: (docSnap) => docSnap,
    })
    const ts = (value: unknown) =>
      value && typeof (value as { seconds?: unknown }).seconds === 'number'
        ? { seconds: (value as { seconds: number }).seconds }
        : null

    /*
     * The organizations the page's sites belong to, in one `getAll`, and
     * their owners in one resolve — both bounded by the page size. A site
     * whose organization is gone reads `org: null`, which the row names
     * rather than hiding the site.
     */
    const orgIds = [
      ...new Set(
        page.rows
          .map((docSnap) => docSnap.get('orgId'))
          .filter((orgId): orgId is string => typeof orgId === 'string' && !!orgId),
      ),
    ]
    const nowMs = Date.now()
    const orgSnaps = orgIds.length
      ? await db.getAll(...orgIds.map((orgId) => db.collection('orgs').doc(orgId)))
      : []
    const orgs = new Map(
      orgSnaps
        .filter((snap) => snap.exists)
        .map((snap) => [
          snap.id,
          {
            $id: snap.id,
            name: snap.get('name') ?? null,
            slug: snap.get('slug') ?? null,
            plan: snap.get('plan') ?? null,
            ownerUid: snap.get('ownerUid') ?? null,
            suspendedAt: ts(snap.get('suspendedAt')),
            // When this workspace's sites stop routing outside links through
            // the leaving notice (AGL-3452), or null when they never do —
            // from the same rule the published site applies.
            leavingNoticeUntil: leavingNoticeEndsAt(snap.data(), nowMs),
          },
        ]),
    )
    const people = await resolveUidsToPeople(
      [...orgs.values()].map((org) => org.ownerUid),
    ).catch(() => ({}) as Awaited<ReturnType<typeof resolveUidsToPeople>>)

    const sites = page.rows.map((docSnap) => {
      const orgId = docSnap.get('orgId') ?? null
      const org = orgId ? (orgs.get(orgId) ?? null) : null
      const owner = org?.ownerUid ? (people[org.ownerUid] ?? null) : null
      // The routing map: its size is the published page count, and its root
      // entry is the page the site's preview opens. The map itself is not
      // shipped — it can hold hundreds of paths.
      const screens = docSnap.get('screens') as Record<string, unknown> | undefined
      return {
        $id: docSnap.id,
        displayName: docSnap.get('displayName') ?? null,
        subdomain: docSnap.get('subdomain') ?? null,
        cname: docSnap.get('cname') ?? null,
        cnameAttachmentPending: docSnap.get('cnameAttachmentPending') === true,
        orgId,
        org,
        owner: owner
          ? { uid: owner.uid, email: owner.email, displayName: owner.displayName }
          : org?.ownerUid
            ? { uid: org.ownerUid, email: null, displayName: null }
            : null,
        publishedPages: screens && typeof screens === 'object' ? Object.keys(screens).length : 0,
        homeScreenId: homeScreenId(screens),
        // Suspended NOW: a timed suspension lapses with no write at all, so
        // the chip reads the window against the clock, as the stored flag
        // the Suspended filter queries is settled against it.
        suspended: suspensionInForce(docSnap.get('suspendedAt'), docSnap.get('suspendedUntilMs')),
        maintenance: Boolean(docSnap.get('maintenance')),
        createdAt: ts(docSnap.get('createdAt')),
      }
    })
    return Response.json(
      {
        sites,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        refused: page.refused,
        notices: settled?.bounded
          ? [...page.notices, LAPSED_SUSPENSIONS_NOTICE]
          : page.notices,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/sites] failed', error)
    return Response.json({ error: 'Site list failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
