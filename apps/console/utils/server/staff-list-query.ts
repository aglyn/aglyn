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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryPlan,
  type ListQueryRefusal,
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
// From the leaf: `./list-filter` re-exports it beside a barrel import that
// reaches the render cache, which a spec of this module would then load.
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'

/*
 * A STAFF LIST READ BY ITS ROUTE, EVERY CLAUSE ON THE QUERY (AGL-3321).
 *
 * The staff console's lists are read by Admin-SDK routes, and each used to
 * read a window — the newest few hundred rows, or the whole collection — and
 * narrow it in the browser. A match read that way stops where the window
 * stops, so a row past it is reported as not there.
 *
 * Every such route now reads its request here (`readStaffListQuery`) and
 * answers it here (`runStaffListQuery`): the Filters panel's clauses and the
 * search word planned by `planListQuery` against the list's declaration, put
 * on the Admin query by `applyListQuery`, and paged by a cursor in the plan's
 * own order. Nothing is matched afterwards. What the plan refused comes back
 * as `refused`, and the page shows it (`ListQueryNotices`) rather than
 * narrowing some rows and not others.
 *
 * The wire shape is one for every staff list, so the page side is one hook
 * (`useStaffListQuery`):
 *
 *   GET ?filters=<JSON [{field, op, value}]>&search=<words>&cursor=<path>&pageSize=<n>&sort=<path:dir>
 *   →  { rows, nextCursor, hasMore, refused, notices }
 */

/** What one request asks of a staff list. */
export interface StaffListQueryRequest {
  clauses: ListFilterRequest[]
  search: string[]
  /** The full path of the last document of the previous page, or null. */
  cursor: string | null
  pageSize: number
  /** The order asked for, when the list offers more than one. */
  sort: ListQuerySort | null
}

export interface StaffListQueryPage<Row> {
  rows: Row[]
  /** The cursor that reads the next page, or null at the end. */
  nextCursor: string | null
  hasMore: boolean
  refused: ListQueryRefusal[]
  notices: string[]
}

/** The largest page any staff list reads at once. */
export const STAFF_LIST_MAX_PAGE = 100

/** The page a request that names none reads. */
export const STAFF_LIST_DEFAULT_PAGE = 25

const words = (raw: unknown): string[] =>
  String(raw ?? '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

/**
 * The request, or `null` when its filters are unreadable — which the route
 * refuses (400) rather than reading as "no filter": an unreadable ask
 * answered with the whole list would be listed under chips that say it was
 * narrowed.
 */
export function readStaffListQuery(
  query: Partial<Record<string, unknown>>,
  options: { maxPageSize?: number; defaultPageSize?: number } = {},
): StaffListQueryRequest | null {
  const max = options.maxPageSize ?? STAFF_LIST_MAX_PAGE
  const fallback = options.defaultPageSize ?? STAFF_LIST_DEFAULT_PAGE
  const clauses: ListFilterRequest[] = []
  const raw = query['filters']
  if (raw !== undefined && raw !== '') {
    if (typeof raw !== 'string') return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    if (!Array.isArray(parsed) || parsed.length > 20) return null
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') return null
      const { field, op, value } = entry as Record<string, unknown>
      if (typeof field !== 'string' || typeof op !== 'string') return null
      clauses.push({ field, op, value: typeof value === 'string' ? value : '' })
    }
  }
  const asked = Math.floor(Number(query['pageSize'] ?? query['limit'] ?? fallback))
  const pageSize = Number.isFinite(asked) && asked > 0 ? Math.min(asked, max) : fallback
  const cursor = String(query['cursor'] ?? '').trim() || null
  const [sortPath, sortDirection] = String(query['sort'] ?? '').split(':')
  const sort: ListQuerySort | null =
    sortPath && (sortDirection === 'asc' || sortDirection === 'desc')
      ? { path: sortPath, direction: sortDirection }
      : null
  return { clauses, search: words(query['search']), cursor, pageSize, sort }
}

/** The plan a request makes of a declaration, for a route that reads it itself. */
export function planStaffListQuery(
  declaration: ListQueryDeclaration,
  request: Pick<StaffListQueryRequest, 'clauses' | 'search' | 'sort'>,
  base: readonly ListQueryFilter[] = [],
): ListQueryPlan {
  return planListQuery(
    declaration,
    { clauses: request.clauses, search: request.search, sort: request.sort, base },
    nameSearchNormalizers,
  )
}

/**
 * One page of the list: every predicate the plan holds, its one order, and
 * a cursor after the last row read. Reads one row past the page so "is there
 * more" is an observation, not a guess.
 *
 * `collection` is the collection (or collection group) the list reads; the
 * cursor is a document path under it, resolved with `firestore.doc`. A cursor
 * that names a document that no longer exists starts the list over rather
 * than failing, since a row deleted between pages is ordinary on a staff
 * queue.
 */
export async function runStaffListQuery<Row>(options: {
  firestore: FirebaseFirestore.Firestore
  collection: FirebaseFirestore.Query
  declaration: ListQueryDeclaration
  request: StaffListQueryRequest
  base?: readonly ListQueryFilter[]
  row: (doc: FirebaseFirestore.QueryDocumentSnapshot) => Row
}): Promise<StaffListQueryPage<Row>> {
  const { firestore, collection, declaration, request, base = [], row } = options
  const plan = planStaffListQuery(declaration, request, base)
  let query = applyListQuery(collection, plan)
  if (request.cursor) {
    const after = await firestore.doc(request.cursor).get()
    if (after.exists) query = query.startAfter(after)
  }
  const snapshot = await query.limit(request.pageSize + 1).get()
  const docs = snapshot.docs.slice(0, request.pageSize)
  const hasMore = snapshot.docs.length > request.pageSize
  return {
    rows: docs.map(row),
    nextCursor: hasMore ? (docs[docs.length - 1]?.ref.path ?? null) : null,
    hasMore,
    refused: plan.refused,
    notices: plan.notices,
  }
}
