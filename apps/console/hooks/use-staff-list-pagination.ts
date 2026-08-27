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
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

/**
 * ONE cursor-pagination mechanism for the staff list screens (AGL-2486).
 *
 * The Organizations list grew Previous/Next in AGL-878 and kept the whole
 * thing inline: a `pageCursorsRef` array holding the cursor that STARTS each
 * page, a `loadPage(index)` that refetches rather than accumulates, and a
 * strip reading `Page n · m shown`. Users had none of it — it rendered every
 * account it had ever fetched in one table behind a `Load more` button. The
 * obvious fix was to paste the org page's block into the user page, which is
 * how a codebase ends up with two paginations that drift; this is that block
 * lifted out instead, so there is one.
 *
 * ## Why the cursor is remembered per page rather than only forwards
 *
 * A cursor names where a page STARTS. Going back is therefore not "undo the
 * last fetch" — it is a fresh read from a cursor the caller has already been
 * handed once and must still have. Keeping the array (index → starting
 * cursor) is what makes Previous a real request rather than a cache of rows
 * that may since have changed. Page 0 has no cursor, which is why the array
 * starts `[null]` and never `[]`.
 *
 * ## Why a ref and not state
 *
 * The cursor table is written DURING a load and read by the next one. As
 * state it would either lag a render behind (Next reading the cursor the
 * previous page had) or force a re-render that changes nothing on screen.
 * Nothing renders off it, so it is a ref.
 */
export interface StaffListPage<TRow> {
  /** The rows on this page — they REPLACE the previous page, never append. */
  rows: TRow[]
  /** Where the following page starts, or null/undefined when this is the end. */
  nextCursor?: string | null
  /**
   * Whether a following page exists. Defaults to "there is a cursor", which
   * is the honest reading for a route that only emits one when it has more.
   */
  hasMore?: boolean
}

export interface UseStaffListPaginationOptions<TRow> {
  /**
   * Read one page. `cursor` is null for the first page. `pageIndex` is passed
   * so a caller that needs to remember something per page (the Users list
   * keeps the rows of every page it has visited, to merge cross-pool twins
   * that land on different pages) can key it without tracking the index a
   * second time.
   */
  fetchPage: (
    cursor: string | null,
    pageIndex: number,
    pageSize: number,
  ) => Promise<StaffListPage<TRow>>
  /** Reported to the caller so each screen keeps its own wording. */
  onError?: (error: unknown) => void
  /**
   * Hold the first load until the caller is ready — the Users screen must not
   * fetch before the staff claim has resolved. Loading starts as soon as this
   * turns true; it is not a permanent opt-out.
   */
  enabled?: boolean
  /**
   * The page size to start at, when the ROUTE dictates one.
   *
   * The Users list does: `listUsersAcrossPools` only appends tenant-pool
   * users once the project-level walk has run out of pages, so a smaller page
   * would push every enterprise SSO account behind several Next clicks — the
   * invisible-users bug AGL-1122 fixed. Its size is Firebase Auth's, not a
   * preference, and it renders without the menu.
   */
  pageSize?: number
}

export interface StaffListPagination<TRow> {
  rows: TRow[]
  pageIndex: number
  hasMore: boolean
  loading: boolean
  /** Rows the ROUTE is asked for — the console-wide default until changed. */
  pageSize: number
  /**
   * Change it, and restart the walk.
   *
   * A cursor names a position in a walk of a given width; the same cursor
   * under a different page size points somewhere else entirely, so every
   * cursor collected so far is discarded rather than reused. Restarting at
   * page 0 is the only honest answer.
   */
  setPageSize: (pageSize: number) => void
  /** Load a page by index. Only an index whose cursor is known is reachable. */
  loadPage: (index: number) => Promise<void>
  /** Re-read the page currently shown — the post-mutation refresh. */
  refresh: () => void
  /**
   * Replace the list with rows that did NOT come from the cursor walk (the
   * Users screen's exact-email lookup). The walk is reset to page 0 with it,
   * because a cursor from the old walk does not describe this list.
   */
  showRows: (rows: TRow[]) => void
}

export function useStaffListPagination<TRow>({
  fetchPage,
  onError,
  enabled = true,
  pageSize: initialPageSize = TABLE_PAGE_SIZE_DEFAULT,
}: UseStaffListPaginationOptions<TRow>): StaffListPagination<TRow> {
  const [rows, setRows] = useState<TRow[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  // Cursor that STARTS each page; page 0 has none.
  const pageCursorsRef = useRef<Array<string | null>>([null])

  const loadPage = useCallback(
    async (index: number) => {
      setLoading(true)
      try {
        const cursor = pageCursorsRef.current[index] ?? null
        const page = await fetchPage(cursor, index, pageSize)
        setRows(page?.rows ?? [])
        const more =
          page?.hasMore === undefined
            ? Boolean(page?.nextCursor)
            : Boolean(page.hasMore)
        setHasMore(more)
        // Remember where the NEXT page starts. Guarded on the cursor as well
        // as on `hasMore`: a route that says "more" without saying where
        // would otherwise leave Next enabled onto the page it just showed.
        if (more && page?.nextCursor) {
          pageCursorsRef.current[index + 1] = page.nextCursor
        }
        setPageIndex(index)
      } catch (error) {
        console.error(error)
        onError?.(error)
      } finally {
        setLoading(false)
      }
    },
    [fetchPage, onError, pageSize],
  )

  const showRows = useCallback((next: TRow[]) => {
    pageCursorsRef.current = [null]
    setRows(next ?? [])
    setHasMore(false)
    setPageIndex(0)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!enabled) return
    void loadPage(0)
  }, [enabled, loadPage])

  const refresh = useCallback(() => void loadPage(pageIndex), [loadPage, pageIndex])

  const setPageSize = useCallback((next: number) => {
    // Every cursor collected so far described a walk of the OLD width and
    // points somewhere else under the new one, so they go rather than get
    // reused. The effect below reloads page 0.
    pageCursorsRef.current = [null]
    setPageSizeState(next)
    setPageIndex(0)
  }, [])

  return {
    rows,
    pageIndex,
    hasMore,
    loading,
    pageSize,
    setPageSize,
    loadPage,
    refresh,
    showRows,
  }
}

export default useStaffListPagination
