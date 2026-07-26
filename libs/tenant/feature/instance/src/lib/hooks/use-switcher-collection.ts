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

import { nameSearchKey } from '@aglyn/aglyn'
import {
  collection,
  endAt,
  type DocumentData,
  type Firestore,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
  type WhereFilterOp,
} from 'firebase/firestore'
import {
  type DependencyList,
  useEffect,
  useRef,
  useState,
} from 'react'

export interface UseSwitcherCollectionOptions<T> {
  firestore: Firestore
  /** Collection path segments, e.g. `['hosts', hostId, 'screens']`. */
  path: string[]
  /** Optional single filter, e.g. `['orgId', '==', orgId]`. */
  where?: readonly [string, WhereFilterOp, unknown]
  /** Raw search text from the field; debounced and normalized internally. */
  query: string
  /** Recent-first window size when the query is empty (default 10). */
  idleLimit?: number
  /** Result cap for the name-prefix search (default 20). */
  searchLimit?: number
  /** Field written with the doc id (default `$id`). */
  idField?: string
  /** Client post-filter, e.g. drop soft-deleted or email screens. */
  filter?: (item: T) => boolean
  /** Stable scope dependencies (firestore, ids) — like a useEffect dep array. */
  deps: DependencyList
  /** Debounce for the search query in ms (default 200). */
  debounceMs?: number
}

export interface UseSwitcherCollectionResult<T> {
  items: T[]
  /** A fetch is in flight and there are no prior rows to show yet. */
  loading: boolean
  /** The (debounced) query is non-empty — results are name-search matches. */
  hasQuery: boolean
}

function useDebouncedValue<V>(value: V, ms: number): V {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/**
 * Data source for the org/site/screen switchers that scales past a switcher's
 * naive "load the whole collection and filter in memory" (AGL-838). Two modes:
 *
 * - **idle** (empty query): a recent-first window, `orderBy(updatedAt desc)`
 *   capped at `idleLimit` — the handful of docs you actually cycle between, not
 *   a full read.
 * - **search** (non-empty query): a true Firestore prefix range over the
 *   normalized `nameLower` (`orderBy(nameLower) startAt(key)..endAt(key+'\uf8ff')`),
 *   capped at `searchLimit` — finds a match anywhere in the collection without
 *   loading it, where the old client-side filter could only match already-
 *   loaded rows.
 *
 * Reads are one-shot `getDocs` (a switcher list doesn't need live updates), so
 * there is no per-keystroke listener churn and no flash: prior rows stay
 * visible while the next fetch is in flight, and only a scope change (a
 * dependency in `deps`) clears them — the same hold-the-right-scope rule as
 * `useFirestoreCollection` (AGL-591), without its clear-to-empty-then-refill.
 * Out-of-order responses are dropped by request id.
 */
export function useSwitcherCollection<T = DocumentData>(
  options: UseSwitcherCollectionOptions<T>,
): UseSwitcherCollectionResult<T> {
  const {
    firestore,
    path,
    where: whereClause,
    query: rawQuery,
    idleLimit = 10,
    searchLimit = 20,
    idField = '$id',
    filter,
    deps,
    debounceMs = 200,
  } = options

  const debounced = useDebouncedValue(rawQuery.trim(), debounceMs)
  const key = nameSearchKey(debounced)
  const hasQuery = key.length > 0

  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const requestRef = useRef(0)

  // Clear on a genuine scope change (host A → host B) so the previous scope's
  // rows never bleed into the new one; a query change keeps the prior rows so
  // the list doesn't flash (AGL-591 rule, applied per-scope not per-fetch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setItems([])
    setLoading(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const requestId = ++requestRef.current
    // A path segment can be momentarily empty (e.g. the uid before auth
    // resolves); hold rather than build an invalid collection ref.
    if (path.some((segment) => !segment)) {
      setItems([])
      setLoading(true)
      return
    }
    setLoading(true)
    const ref = collection(firestore, path[0], ...path.slice(1))
    const constraints = [
      ...(whereClause
        ? [where(whereClause[0], whereClause[1], whereClause[2])]
        : []),
      ...(hasQuery
        ? [orderBy('nameLower'), startAt(key), endAt(key + '\uf8ff'), limit(searchLimit)]
        : [orderBy('updatedAt', 'desc'), limit(idleLimit)]),
    ]
    getDocs(query(ref, ...constraints))
      .then((snapshot) => {
        if (requestRef.current !== requestId) return // superseded
        const rows = snapshot.docs.map((docSnap) => {
          const value = { ...docSnap.data() } as Record<string, unknown>
          if (idField) value[idField] = docSnap.id
          return value as T
        })
        setItems(filter ? rows.filter(filter) : rows)
        setLoading(false)
      })
      .catch(() => {
        // A missing composite index or transient error leaves the prior rows
        // in place rather than blanking the menu; the caller's "view all"
        // escape hatch still reaches everything.
        if (requestRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, key, hasQuery, idleLimit, searchLimit])

  return { items, loading, hasQuery }
}

export default useSwitcherCollection
