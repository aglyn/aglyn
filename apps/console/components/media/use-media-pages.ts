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

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  dropMediaFromPages,
  type MediaPage,
  patchMediaInPages,
} from './media-selection'

/** What one page fetch answers with. */
export interface MediaPageResult<TCursor> {
  docs: any[]
  /** Cursor for the next page — the last document of this one. */
  last: TCursor | null
  /** A full page came back, so there is probably another. */
  more: boolean
}

export interface UseMediaPagesOptions<TCursor> {
  /** Runs one query. Its IDENTITY is the filter set — see below. */
  fetchPage: (cursor: TCursor | null) => Promise<MediaPageResult<TCursor>>
  /** Hold every read until the caller's read set is known. */
  ready: boolean
  /** Called with the raw error so the caller can name its own scope. */
  onError?: (error: any) => void
}

export interface MediaPages {
  /** Every loaded page, in fetch order. */
  pages: MediaPage[]
  /** The window, flattened — what the grid filters and draws. */
  docs: any[]
  loading: boolean
  /** Firestore error code when the last load failed, else null. */
  loadError: string | null
  hasMore: boolean
  /** Bumped by `refresh`; exposed for effects that must re-run with it. */
  refreshKey: number
  loadMore: () => Promise<void>
  /** Throw the window away and read page one again. Costs the reads. */
  refresh: () => void
  /** Remove documents the client knows are gone. Costs nothing. */
  dropLocal: (ids: Iterable<string>) => void
  /** Apply a field the client has already written. Costs nothing. */
  patchLocal: (
    ids: Iterable<string>,
    patch:
      | Record<string, unknown>
      | ((item: any) => Record<string, unknown> | null | undefined),
  ) => void
}

/**
 * The DAM's paged read window (AGL-174), and the two ways to change it
 * without paying for it again (AGL-1462).
 *
 * ## Why this is a hook and not four `useState`s in the component
 *
 * Because the expensive property is a property of the STATE MACHINE, not of
 * any one call site: "a mutation must not drop pages two and three". That
 * cannot be asserted against a 3,400-line component that mounts a Firestore
 * listener stack, the org context, the DAM counters and a dnd-kit surface —
 * a render test there is a test of the mocks. Extracted, it is exercised for
 * real: load, load more, delete, and count the fetches.
 *
 * ## What still costs reads, deliberately
 *
 * `refresh` re-reads page one and drops the rest. It is the honest answer
 * whenever the server decided something the client cannot: an upload (new
 * documents, unknown ids, unknown sort position), a folder move (the folder
 * COUNTS come from server-side aggregates), a scope change (the document may
 * have left the caller's read set entirely).
 *
 * `dropLocal` and `patchLocal` are for the cases where the client already
 * holds the whole answer. They deliberately do NOT touch the cursor: it is a
 * snapshot of the last document of the last page, and Firestore positions
 * `startAfter` from the order-by values held in that snapshot rather than by
 * re-reading the document — so deleting the document a cursor names does not
 * invalidate it.
 *
 * ## The reset is keyed on `fetchPage`
 *
 * A filter, folder or sort change SHOULD throw the window away: it is a
 * different query and page two of the old one means nothing. That is exactly
 * what a changed `fetchPage` identity says, so the callers' `useCallback`
 * dependency list is the definition of "a different query" and no separate
 * key is needed. A mutation that leaves the query alone must therefore leave
 * `fetchPage` alone too — which, before this issue, is precisely what
 * `refreshKey` was being used to defeat.
 */
export function useMediaPages<TCursor>(
  options: UseMediaPagesOptions<TCursor>,
): MediaPages {
  const { fetchPage, ready, onError } = options
  const [pages, setPages] = useState<MediaPage[]>([])
  const [cursor, setCursor] = useState<TCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])

  useEffect(() => {
    let active = true
    if (!ready) return undefined
    setLoading(true)
    setLoadError(null)
    void fetchPage(null)
      .then((page) => {
        if (!active) return
        setPages([page.docs])
        setCursor(page.last)
        setHasMore(page.more)
      })
      .catch((error) => {
        if (!active) return
        onError?.(error)
        // A FAILED load and an EMPTY library are different facts, and the
        // library reported both as "No media here — upload images…".
        setLoadError(error?.code ?? 'unavailable')
      })
      .then(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // `onError` is a reporting callback, not an input to the query: taking it
    // as a dependency would re-read the collection on every render of a
    // caller that declares it inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, ready, refreshKey])

  const loadMore = useCallback(async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const page = await fetchPage(cursor)
      setPages((prev) => [...prev, page.docs])
      setCursor(page.last)
      setHasMore(page.more)
    } catch (error) {
      onError?.(error)
    } finally {
      setLoading(false)
    }
    // Same reasoning as above for `onError`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, cursor])

  const dropLocal = useCallback((ids: Iterable<string>) => {
    const doomed = [...ids]
    if (!doomed.length) return
    setPages((prev) => dropMediaFromPages(prev, doomed))
  }, [])

  const patchLocal = useCallback<MediaPages['patchLocal']>((ids, patch) => {
    const targets = [...ids]
    if (!targets.length) return
    setPages((prev) => patchMediaInPages(prev, targets, patch))
  }, [])

  const docs = useMemo(() => pages.flat(), [pages])

  return {
    pages,
    docs,
    loading,
    loadError,
    hasMore,
    refreshKey,
    loadMore,
    refresh,
    dropLocal,
    patchLocal,
  }
}

export default useMediaPages
