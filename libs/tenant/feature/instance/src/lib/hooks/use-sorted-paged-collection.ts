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

import type { DocumentData, Query } from 'firebase/firestore'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  planKeyedSegment,
  planSortedWindow,
  sortedKeyedQuery,
  sortedScanLimit,
  sortedUnkeyedQuery,
  sortFieldIsTotal,
  type CollectionSort,
} from './sorted-collection-window'
import {
  useFirestoreCollection,
  type FirestoreCollectionStatus,
  type UseFirestoreCollectionOptions,
} from './use-firestore-collection'
import type { UsePagedCollectionResult } from './use-paged-collection'

export interface UseSortedPagedCollectionOptions
  extends UseFirestoreCollectionOptions {
  /**
   * Required: the keyed and unkeyed segments are two listeners, and a
   * document moving between them is recognized by its id.
   */
  idField: string
  /** Rows per page. Defaults to the console-wide smallest option. */
  pageSize?: number
  /**
   * The fields `buildBase` pins by EQUALITY. A sort on one of them needs no
   * unkeyed segment — see `sortFieldIsTotal`.
   */
  equalityFields?: readonly string[]
}

/** `Object.is` over two dependency lists, the comparison React itself uses. */
const sameDeps = (a: DependencyList, b: DependencyList) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

/**
 * The request a read's CURRENT rows were delivered for.
 *
 * `useFirestoreCollection` re-subscribes in an effect, so the render in which
 * its inputs change still returns the previous subscription's rows — rows for
 * another limit, sort or subject. Planning on them would judge a window by a
 * read that was never made for it: page two's window measured against page
 * one's eleven rows looks like a walk that ran out.
 *
 * So rows are labeled with the request that was current when they ARRIVED,
 * which is the render their array first appears in, and a render whose request
 * has since moved on treats them as unread. Held as state and adjusted during
 * render — the pattern React documents for state that follows a prop — so no
 * render ever pairs a request with rows read for another.
 */
function useCurrentRows(rows: unknown, request: DependencyList): boolean {
  const [delivered, setDelivered] = useState<{
    rows: unknown
    request: DependencyList
  }>(() => ({ rows, request }))
  if (delivered.rows !== rows) {
    setDelivered({ rows, request })
    return true
  }
  return sameDeps(delivered.request, request)
}

/**
 * A paged window over a live collection SORTED BY A FIELD, which still drops
 * no document that lacks the field (AGL-2853).
 *
 * The same contract as `usePagedCollection` — the window is the query, one
 * page plus a probe row, `hasMore` a fact — over the two-segment walk in
 * `sorted-collection-window.ts`: the documents that carry the sort field in
 * its order, then the ones that do not, in name order. See that module for why
 * both segments are needed and what the second one costs.
 *
 * `buildBase` returns the collection with any EQUALITY predicates and nothing
 * else; the ordering and the limits are this hook's. `deps` identify the
 * subject as they do for `useFirestoreCollection`. A new subject, sort or
 * filter starts again from page one.
 *
 * ```ts
 * useSortedPagedCollection<Entry>(
 *   () => query(
 *     collection(firestore, 'hosts', hostId, 'collections', collectionId, 'entries'),
 *     where('status', '==', status),
 *   ),
 *   { field: 'publishedAt', direction: 'desc' },
 *   [firestore, hostId, collectionId, status],
 *   { idField: '$id', equalityFields: ['status'] },
 * )
 * ```
 */
export function useSortedPagedCollection<T = DocumentData>(
  buildBase: () => Query<DocumentData> | null | undefined,
  sort: CollectionSort,
  deps: DependencyList,
  options: UseSortedPagedCollectionOptions,
): UsePagedCollectionResult<T> {
  const {
    pageSize: initialPageSize = TABLE_PAGE_SIZE_DEFAULT,
    equalityFields = [],
    ...collectionOptions
  } = options
  const idField = options.idField
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  const buildBaseRef = useRef(buildBase)
  buildBaseRef.current = buildBase

  const equalityKey = equalityFields.join('\n')
  const subject: DependencyList = [
    ...deps,
    sort.field,
    sort.direction,
    equalityKey,
  ]

  /*
   * The reader's position belongs to ONE subject. It resets in the render the
   * subject changes in, not in an effect after it: an effect would let that
   * render subscribe the new sort at the old page's limit, and a sort change
   * on page four would bill forty-one documents to show ten.
   */
  const [cursor, setCursor] = useState(() => ({
    subject,
    page: 0,
    widenedTo: 0,
  }))
  const sameSubject = sameDeps(cursor.subject, subject)
  const position = sameSubject ? cursor : { subject, page: 0, widenedTo: 0 }
  if (!sameSubject) setCursor(position)
  const { page } = position

  const keyedIsTotal = sortFieldIsTotal(sort, equalityFields)
  const { keyedLimit } = planKeyedSegment({
    page,
    pageSize,
    keyed: undefined,
    keyedSettled: false,
    keyedIsTotal,
  })

  const keyedRequest: DependencyList = [...subject, keyedLimit]
  const keyedRead = useFirestoreCollection<T>(
    () => {
      const base = buildBaseRef.current()
      return base
        ? sortedKeyedQuery(base, sort, keyedLimit, equalityFields)
        : null
    },
    keyedRequest,
    collectionOptions,
  )
  const keyedCurrent = useCurrentRows(keyedRead.data, keyedRequest)
  const keyed =
    keyedCurrent && keyedRead.status !== 'loading' ? keyedRead.data : undefined
  const keyedSettled =
    keyedCurrent && keyedRead.status === 'success' && !keyedRead.fromCache

  const keyedPlan = planKeyedSegment({
    page,
    pageSize,
    keyed,
    keyedSettled,
    keyedIsTotal,
  })
  const scanLimit = sortedScanLimit(keyedPlan, position.widenedTo)

  const scanRequest: DependencyList = [...subject, scanLimit]
  const scanRead = useFirestoreCollection<T>(
    () => {
      if (scanLimit <= 0) return null
      const base = buildBaseRef.current()
      return base ? sortedUnkeyedQuery(base, scanLimit) : null
    },
    scanRequest,
    collectionOptions,
  )
  const scanCurrent = useCurrentRows(scanRead.data, scanRequest)
  const scanOpen = scanLimit > 0

  const sorted = planSortedWindow<T>({
    page,
    pageSize,
    sort,
    keyedIsTotal,
    keyed,
    keyedSettled,
    scan:
      scanOpen && scanCurrent && scanRead.status !== 'loading'
        ? scanRead.data
        : undefined,
    scanSettled:
      scanOpen &&
      scanCurrent &&
      scanRead.status === 'success' &&
      !scanRead.fromCache,
    scanLimit,
    idOf: (row) => String((row as Record<string, unknown>)[idField]),
  })

  /*
   * Widening is remembered for the subject, so paging back to where the scan
   * is not needed and forward again re-opens it at the width it reached
   * instead of doubling its way back up.
   */
  const widenTo = sorted.scanLimit
  useEffect(() => {
    if (widenTo <= position.widenedTo) return
    setCursor((previous) =>
      sameDeps(previous.subject, position.subject) &&
      widenTo > previous.widenedTo
        ? { ...previous, widenedTo: widenTo }
        : previous,
    )
  }, [widenTo, position.widenedTo, position.subject])

  const setPage = useCallback((next: number) => {
    setCursor((previous) => ({ ...previous, page: next }))
  }, [])
  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next)
    // Page four of a ten-row list does not exist once the reader asks for
    // fifty at a time, and an out-of-range page renders as an empty list.
    setCursor((previous) => ({ ...previous, page: 0 }))
  }, [])

  /*
   * A short window is a claim that the list ENDS here, so it is `loading`
   * until the server has confirmed both segments. A window holding its probe
   * row claims only that more exists, which a cached read can say.
   */
  const errored =
    keyedRead.status === 'error' || (scanOpen && scanRead.status === 'error')
  const status: FirestoreCollectionStatus = errored
    ? 'error'
    : keyed === undefined
      ? 'loading'
      : sorted.hasMore || sorted.settled
        ? 'success'
        : 'loading'

  return {
    data: sorted.ordered,
    rows: sorted.rows,
    hasMore: sorted.hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    status,
    error: keyedRead.error ?? (scanOpen ? scanRead.error : undefined),
    fromCache: keyedRead.fromCache || (scanOpen && scanRead.fromCache),
    serverDenied:
      keyedRead.serverDenied || (scanOpen && scanRead.serverDenied),
  }
}

export default useSortedPagedCollection
