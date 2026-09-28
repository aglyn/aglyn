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
import {
  ACTOR_ACTIVITY_MAX_PAGE,
  orgActivityFacets,
  orgActivityScopePaths,
  planActivityQuery,
  readOrgWideActivity,
  withResolvedActors,
} from '../../../../utils/server/actor-activity'
import {
  auditLogSearchWords,
  readAuditLogFilters,
} from '../../../../utils/server/audit-log-filter'
import {
  ACTIVITY_LIST_QUERY,
  ORG_ACTIVITY_FILTER_FIELDS,
  ORG_ACTIVITY_QUERY,
  activityActorBase,
  activityTargetBase,
  splitWhereClause,
} from '../../../../utils/activity-list-query'
import { applyListQuery } from '../../../../utils/server/list-filter'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — read-only, writes nothing, and it is the record of
// what happened to this organization. A locked owner working out why they are
// locked should not also lose the log that says. Every WRITE that produces an
// entry is behind its own route, and those answer the 423.

/**
 * The organization activity feed — the SERVER side of `org.auditLog`
 * (AGL-2444).
 *
 * ## Why this route exists at all
 *
 * `org.auditLog` was advertised in the permission catalog, tickable in the
 * custom-role editor, and read in exactly one place: the team page, deciding
 * whether to mount the card. That is a display gate, not a permission. A
 * member whose role revoked it opened the browser console — or any Firestore
 * client — and read `orgs/{orgId}/activity` directly, because the security
 * rule gated on `isOrgWideMember()` and knew nothing about the catalog.
 *
 * The rule now denies member reads outright and this route is the only door.
 * The Admin SDK bypasses rules, so the check below IS the access control for
 * every customer-facing reader of the feed: there is no second path that a
 * revoked permission could leak through.
 *
 * ## Why the granular check and not the roster one
 *
 * The old rule answered "is this person an org-wide member", which is the
 * roster question the feed's CONTENT needs — it names who did what across
 * every site, so a per-site collaborator must not see it. That check is
 * still made, by `resolveOrgMembership` returning nothing for a non-member.
 * `org.auditLog` is the narrower question layered on top: whether this
 * member's seat may see the audit trail at all.
 *
 * ## The page
 *
 * Newest-first, ordered server-side, and a real page rather than a window:
 * `pageSize` rows plus a `nextCursor` to continue from.
 *
 * It was a flat cap of 200 that the card then sliced 20 rows out of. That
 * read 200 documents to render 20 on every mount, and the other 180 were not
 * merely wasted — they were unreachable. Nothing rendered rows 21 through
 * 200, and an organization past its 200th entry could not reach entry 201 at
 * all. On the only audit surface a customer admin has, "the history stops
 * here" was a rendering accident.
 *
 * The cursor is a document ID rather than a path. The parent collection is
 * fixed by `orgId`, which is permission-checked above, so an id cannot be
 * used to page into another organization's feed the way a caller-supplied
 * path could.
 *
 * `createdAt` is flattened to `{ seconds }` because a Firestore `Timestamp`
 * through JSON arrives as `{_seconds}` and would silently sort everything to
 * the bottom. `formatWireTimestamp` is what reads it back.
 *
 * ## Filters and search
 *
 * Every mode reads `filters` (a JSON list of `{ field, op, value }`) and
 * `search`, and puts all of it on its query through `planListQuery`
 * (AGL-3321) — see `utils/activity-list-query.ts` for the declarations and
 * the indexes. What the plan could not put there comes back as `refused`,
 * with `notices` about what it did, and is NOT applied: the page says so
 * rather than narrowing some rows and not others.
 */
const DEFAULT_PAGE_SIZE = 25

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
  const orgId = String(query.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'org.auditLog'))
    ) {
      return Response.json({ error: 'org.auditLog required' }, { status: 403 })
    }
    /** The panel's clauses, and the search box's words. */
    const clauses = readAuditLogFilters(query, ORG_ACTIVITY_FILTER_FIELDS)
    if (!clauses) return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    const search = auditLogSearchWords(query['search'])
    const pageSize = Math.min(
      Math.max(
        1,
        Math.floor(Number(query['pageSize'] ?? query['limit'] ?? DEFAULT_PAGE_SIZE)) ||
          DEFAULT_PAGE_SIZE,
      ),
      ACTOR_ACTIVITY_MAX_PAGE,
    )
    const cursor = String(query['cursor'] ?? '').trim() || null

    /**
     * One member's activity across the WHOLE organization.
     *
     * The feed below answers "what happened in this org", from the org's own
     * activity collection. `actorId` asks a different question — "what has
     * this person done here" — and the answer is not in that collection: most
     * of what a member does happens on a SITE, and lands in
     * `hosts/{hostId}/activity`. The team page's own "Activity by this
     * member" card filtered the org feed client-side and so could only ever
     * show the handful of org-level events.
     *
     * Same permission, deliberately. It is the same audit log read by a
     * narrower question, so `org.auditLog` is the right gate for both — and
     * it reads only this organization's subjects, the member's equality on
     * each, so it cannot become a cross-organization view of a person who is
     * also a member elsewhere, and reads nothing it then throws away.
     */
    const actorId = String(query['actorId'] ?? '').trim()
    if (actorId) {
      const page = await readOrgWideActivity({
        orgId,
        limit: pageSize,
        cursor,
        clauses,
        search,
        base: activityActorBase(actorId),
        paths: await orgActivityScopePaths(orgId),
      })
      return Response.json(
        { ...page, entries: await withResolvedActors(page.entries, { staff: isStaff }) },
        { status: 200 },
      )
    }
    /**
     * The whole organization, sites included.
     *
     * `scope=org-wide` because the default has a caller that depends on it:
     * the team page's "Changes to this member" card reads the ORG collection
     * and filters by target, and folding site activity into that would show
     * a member's own page edits under a heading about changes made TO them.
     *
     * Without it, a card headed "Organization activity" tells a brand-new
     * organization it has done nothing on the day it published three pages,
     * because everything a team does happens on a SITE.
     */
    if (String(query['scope'] ?? '') === 'org-wide') {
      /*
       * Where picks which subjects are read; Action, Who, When and the
       * search go onto every subject's query, the same plan on each.
       */
      const { where, rest, refused } = splitWhereClause(clauses)
      const allPaths = await orgActivityScopePaths(orgId)
      // A subject is `hosts/{id}` or `orgs/{id}`; Where names the id. A site
      // that is not this organization's is a place with nothing in its log.
      const paths = where
        ? new Set([...allPaths].filter((path) => path.split('/')[1] === where))
        : allPaths
      const page = await readOrgWideActivity({
        orgId,
        limit: pageSize,
        cursor,
        clauses: rest,
        search,
        declaration: ORG_ACTIVITY_QUERY,
        paths,
      })
      const facets =
        String(query['facets'] ?? '') === '1' ? await orgActivityFacets(orgId) : null
      return Response.json(
        {
          ...page,
          entries: await withResolvedActors(page.entries, { staff: isStaff }),
          refused: [...refused, ...page.refused],
          ...(facets ? { facets } : {}),
        },
        { status: 200 },
      )
    }
    /**
     * The organization's own feed, or the changes made TO one member, host
     * or screen (AGL-389).
     *
     * Filtered by the SERVER. The card once fetched the window and filtered
     * it in the browser, which cannot survive pagination: a page of 25 org
     * entries might contain two that touch this member, and the card would
     * render those two and call it the page. `logOrgActivity` writes
     * `target: { type, id }`, so the target is the query's base, and every
     * clause and the search merge with it by index
     * (`cloud/firebase-firestore.indexes.json`).
     */
    const targetId = String(query['targetId'] ?? '').trim()
    const activityRef = firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .collection('activity')
    const plan = planActivityQuery(
      ACTIVITY_LIST_QUERY,
      { clauses, search },
      targetId ? activityTargetBase(targetId) : [],
    )
    /*
     * A cursor that no longer resolves restarts at the top rather than
     * throwing. An audit log left open in a tab while its oldest entries are
     * pruned should answer the next click with the newest page, not a 500.
     */
    const after = cursor
      ? await activityRef
          .doc(cursor)
          .get()
          .catch(() => null)
      : null
    let pageQuery = applyListQuery(activityRef, plan)
    if (after?.exists) pageQuery = pageQuery.startAfter(after)
    // One extra row answers "is there another page" without a second query.
    const snapshot = await pageQuery.limit(pageSize + 1).get()
    const pageDocs = snapshot.docs.slice(0, pageSize)
    const entries = pageDocs.map((doc) => {
      const data = { ...(doc.data() as Record<string, unknown>) }
      // The search's index, not something a reader is shown.
      delete data['searchTokens']
      const createdAt = data['createdAt'] as { seconds?: number } | undefined
      return {
        ...data,
        $id: doc.id,
        createdAt:
          typeof createdAt?.seconds === 'number'
            ? { seconds: createdAt.seconds }
            : null,
      }
    })
    return Response.json(
      {
        entries: await withResolvedActors(entries, { staff: isStaff }),
        nextCursor:
          snapshot.docs.length > pageSize
            ? (pageDocs[pageDocs.length - 1]?.id ?? null)
            : null,
        refused: plan.refused,
        notices: plan.notices,
      },
      { status: 200 },
    )
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Activity lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
