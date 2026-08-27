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

import type { DocumentData, Query } from 'firebase/firestore'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
} from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  useFirestoreCollection,
  type UseFirestoreCollectionOptions,
  type UseFirestoreCollectionResult,
} from './use-firestore-collection'

export interface UsePagedCollectionOptions
  extends UseFirestoreCollectionOptions {
  /**
   * Rows per page. Defaults to the console-wide smallest option — a list
   * that picks its own number is how five different ones appear, and on a
   * query bounded by its page size the smallest page is the smallest bill.
   */
  pageSize?: number
}

export interface UsePagedCollectionResult<T>
  extends UseFirestoreCollectionResult<T> {
  /** The current page's rows. `data` holds the probe row; this never does. */
  rows: T[]
  /** A further page exists. A FACT from the probe row, not a guess. */
  hasMore: boolean
  /** Zero-based, to match `ListPagination` and MUI. */
  page: number
  setPage: (page: number) => void
  pageSize: number
  setPageSize: (pageSize: number) => void
}

/**
 * A paged window over a live collection, instead of a big read sliced small.
 *
 * ## The shape this replaces
 *
 * A card would listen with `limit(300)` and render `rows.slice(0, 50)`. That
 * is wrong twice over. Two hundred and fifty documents are read, billed and
 * discarded on every mount — and the rows past the slice are not merely
 * wasted, they are UNREACHABLE, because nothing renders them and no control
 * asks for more. A merchant with sixty gift cards sees fifty and no
 * indication that ten more exist; past three hundred, a card issued this
 * morning cannot be reached at all.
 *
 * Here the window IS the query, and it is expressed in PAGES so the same
 * `ListPagination` footer serves this and a cursor feed. The listener is
 * widened to cover every page up to the one being read, so paging BACK costs
 * nothing — the rows are already in the snapshot — and paging forward costs
 * one page more.
 *
 * ## Why the window covers page 0..n rather than page n alone
 *
 * This is a live `onSnapshot`, not a fetch. Firestore cursors need a document
 * snapshot to resume from, which a listener that has never read page n - 1
 * does not have. Widening the limit is what makes forward and backward
 * symmetrical without a second read path, and the cost is bounded by how deep
 * the reader actually goes — with the shared default of ten, page three is
 * thirty-one documents, and most readers never leave page one.
 *
 * ## Why over-fetch by one
 *
 * `hasMore` has to be a fact. Comparing `length === limit` is wrong exactly
 * when the count is an even multiple of the page size — the case that offers
 * a "next page" leading nowhere, or hides one that leads somewhere. The probe
 * row answers it outright and is never rendered.
 *
 * ## Why the window resets on `deps`
 *
 * `deps` identify the SUBJECT being listened to. Without the reset, a card
 * paged three deep on one site opens the next site three pages in — a read
 * the reader never asked for, charged to whoever they switched to.
 *
 * `buildQuery` receives the limit to apply, so the caller keeps ownership of
 * ordering and predicates:
 *
 * ```ts
 * usePagedCollection<Card>(
 *   (pageLimit) =>
 *     hostId
 *       ? query(collection(firestore, 'hosts', hostId, 'giftCards'),
 *               orderBy('createdAt', 'desc'), limit(pageLimit))
 *       : null,
 *   [firestore, hostId],
 *   { idField: '$id' },
 * )
 * ```
 */
export function usePagedCollection<T = DocumentData>(
  buildQuery: (pageLimit: number) => Query<DocumentData> | null | undefined,
  deps: DependencyList,
  options: UsePagedCollectionOptions = {},
): UsePagedCollectionResult<T> {
  const { pageSize: initialPageSize = TABLE_PAGE_SIZE_DEFAULT, ...collectionOptions } =
    options
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  const [page, setPage] = useState(0)
  const buildQueryRef = useRef(buildQuery)
  buildQueryRef.current = buildQuery

  /*
   * A new subject starts at page one. Spreading `deps` is the same contract
   * `useFirestoreCollection` documents — pass the primitive ids, not the
   * Query.
   */
  useEffect(() => {
    setPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps])

  // Everything up to and including the page being read, plus the probe row.
  const windowSize = pageSize * (page + 1)
  const result = useFirestoreCollection<T>(
    () => buildQueryRef.current(windowSize + 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, windowSize],
    collectionOptions,
  )

  const hasMore = (result.data?.length ?? 0) > windowSize
  const rows = useMemo(
    () => (result.data ?? []).slice(page * pageSize, windowSize),
    [result.data, page, pageSize, windowSize],
  )
  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next)
    // Page four of a ten-row list does not exist once the reader asks for
    // fifty at a time, and an out-of-range page renders as an empty list
    // with no explanation — which reads as the data having gone.
    setPage(0)
  }, [])

  return { ...result, rows, hasMore, page, setPage, pageSize, setPageSize }
}
