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
import {
  useFirestoreCollection,
  type UseFirestoreCollectionOptions,
  type UseFirestoreCollectionResult,
} from './use-firestore-collection'

export interface UsePagedCollectionOptions
  extends UseFirestoreCollectionOptions {
  /** Rows per page. The window grows by this much per `loadMore()`. */
  pageSize?: number
}

export interface UsePagedCollectionResult<T>
  extends UseFirestoreCollectionResult<T> {
  /** The page. `data` holds the over-fetched probe row; this never does. */
  rows: T[]
  /** A further page exists. A FACT from the probe row, not a guess. */
  hasMore: boolean
  loadMore: () => void
  /** Rows the window currently admits — what "showing N" should print. */
  windowSize: number
}

/**
 * A growing window over a collection, instead of a big read sliced small.
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
 * Here the window IS the query. A page costs `pageSize + 1` reads, and
 * `loadMore` widens it.
 *
 * ## Why over-fetch by one
 *
 * `hasMore` has to be a fact. Comparing `length === limit` is wrong exactly
 * when the count is an even multiple of the page size — the case that offers
 * a "Load more" leading nowhere, or hides one that leads somewhere. The probe
 * row answers it outright and is dropped before render.
 *
 * ## Why the window resets on `deps`
 *
 * `deps` identify the SUBJECT being listened to. Without the reset, a card
 * grown to two hundred rows on one site opens the next site two hundred rows
 * deep — a read the reader never asked for, charged to whoever they switched
 * to.
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
 *   { idField: '$id', pageSize: 25 },
 * )
 * ```
 */
export function usePagedCollection<T = DocumentData>(
  buildQuery: (pageLimit: number) => Query<DocumentData> | null | undefined,
  deps: DependencyList,
  options: UsePagedCollectionOptions = {},
): UsePagedCollectionResult<T> {
  const { pageSize = 25, ...collectionOptions } = options
  const [windowSize, setWindowSize] = useState(pageSize)
  const buildQueryRef = useRef(buildQuery)
  buildQueryRef.current = buildQuery

  /*
   * A new subject starts at page one. Spreading `deps` is the same contract
   * `useFirestoreCollection` documents — pass the primitive ids, not the
   * Query.
   */
  useEffect(() => {
    setWindowSize(pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pageSize])

  const result = useFirestoreCollection<T>(
    () => buildQueryRef.current(windowSize + 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, windowSize],
    collectionOptions,
  )

  const hasMore = (result.data?.length ?? 0) > windowSize
  const rows = useMemo(
    () => (result.data ?? []).slice(0, windowSize),
    [result.data, windowSize],
  )
  const loadMore = useCallback(
    () => setWindowSize((size) => size + pageSize),
    [pageSize],
  )

  return { ...result, rows, hasMore, loadMore, windowSize }
}
