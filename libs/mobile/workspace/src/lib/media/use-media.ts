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

import { listQueryConstraints, listWindowLimit, listWindowRows, MOBILE_LIST_PAGE_SIZE } from '@aglyn/mobile-core'
import type { ListQueryPlan } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { collection, type Firestore, limit, onSnapshot, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import type { MediaFolderDoc } from './media-model'

/*==========================================
 * A LIVE WINDOW OVER A PLAN ALREADY MADE.
 *
 * `useMobileListQuery` plans from a declaration; the media library's plan is
 * `mediaQuery`'s, which adds what the planner alone does not (the scoped
 * search as a name range, the sort's direction under a range), so the plan
 * comes in made and this runs it the same way: every predicate, its one
 * order, a window that grows a page at a time and a probe row past it.
 *=========================================*/

export interface LivePlanResult<T> {
  rows: T[]
  ready: boolean
  error: Error | null
  hasMore: boolean
  loadMore: () => void
}

export function useLivePlan<T extends { $id: string }>(options: {
  firestore: unknown
  path: readonly string[] | null
  plan: ListQueryPlan
  enabled?: boolean
  pageSize?: number
}): LivePlanResult<T> {
  const { firestore, path, plan, enabled = true } = options
  const pageSize = options.pageSize ?? MOBILE_LIST_PAGE_SIZE
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
  return { rows, ready: state.ready, error: state.error, hasMore, loadMore }
}

/** The console's folder ceiling for one library (`limit(500)`). */
export const MEDIA_FOLDER_WINDOW = 500

/**
 * A library's folders, as the console's folder rail reads them: the scope
 * clause for a reader who needs one, at most 500, by `order` then name.
 */
export function useMediaFolders(options: {
  firestore: unknown
  path: readonly string[] | null
  scopeTokens: readonly string[] | null
  enabled: boolean
}): MediaFolderDoc[] {
  const { firestore, path, scopeTokens, enabled } = options
  const pathKey = path && path.every(Boolean) ? path.join('/') : null
  const tokensKey = scopeTokens ? scopeTokens.join(',') : null
  const [folders, setFolders] = useState<MediaFolderDoc[]>([])
  useEffect(() => {
    setFolders([])
    if (!enabled || !pathKey || !firestore) return
    const [first, ...rest] = pathKey.split('/')
    return onSnapshot(
      query(
        collection(firestore as Firestore, first, ...rest),
        ...(tokensKey !== null ? [where('visibleTo', 'array-contains-any', tokensKey.split(','))] : []),
        limit(MEDIA_FOLDER_WINDOW),
      ),
      (snapshot) =>
        setFolders(
          snapshot.docs
            .map((row) => ({ ...(row.data() as object), $id: row.id }) as MediaFolderDoc)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name))),
        ),
      () => setFolders([]),
    )
  }, [firestore, pathKey, tokensKey, enabled])
  return folders
}
