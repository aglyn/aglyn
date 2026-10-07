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

import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryNormalizers,
  type ListQueryPlan,
  type ListQueryRequest,
  planListQuery,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  collection,
  documentId,
  type Firestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QueryConstraint,
  Timestamp,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'

/*==========================================
 * A LIST ON ITS QUERY, NATIVELY (AGL-3622).
 *
 * The console's lists put every clause and the search word on ONE Firestore
 * query (AGL-3321: `planListQuery`) and page it; nothing is matched over a
 * loaded window. The app runs the same plan from the same declaration, so a
 * list asks exactly what the console asks, under the same rules and served
 * by the same composite indexes. Only the paging differs: a phone list grows
 * as it scrolls, so the live window widens a page at a time and one probe
 * row past it says whether there is more.
 *
 * The search normalizers are the caller's (a plugin passes the console's
 * `nameSearchNormalizers`), so this stays free of any one domain.
 *=========================================*/

/** Rows a native list asks for at a time. */
export const MOBILE_LIST_PAGE_SIZE = 25

const fieldPath = (value: string) => (value === LIST_QUERY_ID_PATH ? documentId() : value)

const valueOf = (value: ListQueryFilter['value']): unknown =>
  value instanceof Date ? Timestamp.fromDate(value) : Array.isArray(value) ? [...value] : value

/** The plan as JS-SDK constraints: every predicate, then its one order. */
export function listQueryConstraints(plan: ListQueryPlan): QueryConstraint[] {
  return [
    ...plan.filters.map((filter) =>
      where(fieldPath(filter.path) as never, filter.op, valueOf(filter.value)),
    ),
    orderBy(fieldPath(plan.orderBy.path) as never, plan.orderBy.direction),
  ]
}

/** How many rows a window of `pages` asks for: one more than it shows, the probe. */
export function listWindowLimit(pages: number, pageSize: number = MOBILE_LIST_PAGE_SIZE): number {
  return Math.max(1, pages) * pageSize + 1
}

/** The rows a window shows, and whether the probe row says there is more. */
export function listWindowRows<T>(
  docs: readonly T[],
  pages: number,
  pageSize: number = MOBILE_LIST_PAGE_SIZE,
): { rows: T[]; hasMore: boolean } {
  const shown = Math.max(1, pages) * pageSize
  return { rows: docs.slice(0, shown), hasMore: docs.length > shown }
}

/** A quick-search box's text as the words the planner takes. */
export function searchWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
}

export interface UseMobileListQueryOptions {
  firestore: unknown
  /** The collection's path segments, or null while it is not known. */
  path: readonly string[] | null
  declaration: ListQueryDeclaration
  request: ListQueryRequest
  /** The search token normalizers the list's index was written with. */
  normalizers: ListQueryNormalizers
  /** False holds the read. */
  enabled?: boolean
  pageSize?: number
}

export interface UseMobileListQueryResult<T> {
  rows: T[]
  plan: ListQueryPlan
  ready: boolean
  error: Error | null
  hasMore: boolean
  /** Widens the window by a page; a no-op when there is no more. */
  loadMore: () => void
}

/**
 * A live list over the plan's query: `onSnapshot` on the window, each row
 * as `{ $id, ...data }` the way the console's lists read them. A new plan
 * is a new query, and the window starts over.
 */
export function useMobileListQuery<T extends { $id: string }>(
  options: UseMobileListQueryOptions,
): UseMobileListQueryResult<T> {
  const { firestore, path, declaration, request, normalizers, enabled = true } = options
  const pageSize = options.pageSize ?? MOBILE_LIST_PAGE_SIZE
  const requestKey = JSON.stringify(request)
  const plan = useMemo(
    () => planListQuery(declaration, request, normalizers),
    // The request is data; its JSON is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [declaration, requestKey, normalizers],
  )
  const pathKey = path && path.every(Boolean) ? path.join('/') : null
  const planKey = JSON.stringify({ filters: plan.filters, orderBy: plan.orderBy })
  const [pages, setPages] = useState(1)
  const [state, setState] = useState<{ docs: T[]; ready: boolean; error: Error | null }>({
    docs: [],
    ready: false,
    error: null,
  })
  useEffect(() => setPages(1), [pathKey, planKey])
  useEffect(() => {
    setState((prior) => ({ docs: prior.docs, ready: false, error: null }))
    if (!enabled || !pathKey || !firestore) return
    const [first, ...rest] = pathKey.split('/')
    return onSnapshot(
      query(
        collection(firestore as Firestore, first, ...rest),
        ...listQueryConstraints(plan),
        limit(listWindowLimit(pages, pageSize)),
      ),
      (snapshot) =>
        setState({
          docs: snapshot.docs.map((row) => ({ ...(row.data() as object), $id: row.id }) as T),
          ready: true,
          error: null,
        }),
      (error) => setState({ docs: [], ready: true, error }),
    )
    // The plan is keyed by planKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, pathKey, planKey, pages, pageSize, enabled])
  const { rows, hasMore } = listWindowRows(state.docs, pages, pageSize)
  const loadMore = useCallback(() => {
    if (hasMore) setPages((current) => current + 1)
  }, [hasMore])
  return { rows, plan, ready: state.ready, error: state.error, hasMore, loadMore }
}
