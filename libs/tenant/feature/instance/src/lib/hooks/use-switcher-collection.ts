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

import { compareScored, nameSearchKey, scoreMatch } from '@aglyn/aglyn'
import {
  collection,
  documentId,
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
import {
  reportFirestoreDenial,
  reportFirestoreServerRead,
} from './firestore-denial-reporter'

/**
 * Collection KEY for the session-health verdict (AGL-2486).
 *
 * The even path segments only — `['users', uid, 'hostMemberships']` becomes
 * `users/hostMemberships`. That is the convention `use-org-hosts` already
 * uses for the same collection, so the two report the SAME key and still
 * count as one collection rather than inflating each other toward the
 * two-collection threshold. It also keeps document ids — a uid among them —
 * out of a module-scope map.
 */
export function switcherCollectionKey(path: string[]): string {
  return path.filter((_, index) => index % 2 === 0).join('/')
}

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
  /**
   * The field holding the human-readable name, matched client-side.
   *
   * Both switchers store it as `displayName`, which is the default; a caller
   * whose rows name themselves differently passes its own.
   */
  nameField?: string
  /**
   * How many documents the client-side pass reads (default 50).
   *
   * Fetched ONCE per scope and cached for the life of the mount, so typing
   * costs nothing after the first character — see the search-mode note on the
   * hook itself.
   */
  searchWindow?: number
  /** Field written with the doc id (default `$id`). */
  idField?: string
  /** Client post-filter, e.g. drop soft-deleted or email screens. */
  filter?: (item: T) => boolean
  /** Stable scope dependencies (firestore, ids) — like a useEffect dep array. */
  deps: DependencyList
  /** Debounce for the search query in ms (default 200). */
  debounceMs?: number
  /**
   * Hold off entirely, because a value this listen must be SCOPED BY is not
   * resolved yet (AGL-2350).
   *
   * The empty-path-segment hold-off below covers a scope that appears IN the
   * path. A `where` filter is the other kind, and it fails the opposite way:
   * an unresolved id makes `where` `undefined`, which does not error — it
   * silently drops the filter and returns the UNSCOPED collection. For
   * `users/{uid}/hostMemberships` that is every site the person holds in
   * every org, which on an agency running one workspace per client puts two
   * clients' site names in one dropdown.
   *
   * Defaults to `false`, so this is inert for any caller that does not scope
   * by a filter.
   */
  skip?: boolean
}

export interface UseSwitcherCollectionResult<T> {
  items: T[]
  /** A fetch is in flight and there are no prior rows to show yet. */
  loading: boolean
  /** The (debounced) query is non-empty — results are name-search matches. */
  hasQuery: boolean
  /**
   * The most recent fetch FAILED (AGL-1066).
   *
   * Keeping the prior rows on a failure is right and stays (see the catch
   * below), but the failure was previously erased along with `loading` — so
   * the first fetch of a scope, which has no prior rows, settled on
   * `{ items: [], loading: false }` and every switcher read that as "this
   * person holds no sites". Consumers must render "couldn't load", never a
   * zero-state, when this is true.
   */
  error: boolean
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
    nameField = 'displayName',
    searchWindow = 50,
    idField = '$id',
    filter,
    deps,
    debounceMs = 200,
    skip = false,
  } = options

  const debounced = useDebouncedValue(rawQuery.trim(), debounceMs)
  const key = nameSearchKey(debounced)
  const hasQuery = key.length > 0

  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestRef = useRef(0)
  /**
   * The client-side search window, cached for the life of this SCOPE.
   *
   * A ref rather than state: filling it must not itself cause a render, and
   * the render that matters is the one `setItems` already causes. Cleared by
   * the scope effect below, which is the same place the rows are cleared —
   * keeping the two together is what stops site A's window being matched
   * against while standing on site B.
   */
  const windowRef = useRef<{ rows: any[]; fromCache?: boolean } | null>(null)

  // Clear on a genuine scope change (host A → host B) so the previous scope's
  // rows never bleed into the new one; a query change keeps the prior rows so
  // the list doesn't flash (AGL-591 rule, applied per-scope not per-fetch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setItems([])
    setLoading(true)
    setError(false)
    windowRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const requestId = ++requestRef.current
    // A path segment can be momentarily empty (e.g. the uid before auth
    // resolves); hold rather than build an invalid collection ref. `skip` is
    // the same hold for a scope that lives in `where` rather than the path,
    // where an unresolved id would widen the query instead of breaking it.
    if (skip || path.some((segment) => !segment)) {
      setItems([])
      setLoading(true)
      setError(false)
      // A hold means the scope is not trustworthy yet, so anything already
      // read under it must not survive into the scope that unblocks.
      windowRef.current = null
      return
    }
    setLoading(true)
    const ref = collection(firestore, path[0], ...path.slice(1))
    const scopeFilter = whereClause
      ? [where(whereClause[0], whereClause[1], whereClause[2])]
      : []
    const toRows = (snapshot: { docs: any[] }) =>
      snapshot.docs.map((docSnap) => {
        const value = { ...docSnap.data() } as Record<string, unknown>
        if (idField) value[idField] = docSnap.id
        return value as T
      })

    /**
     * SEARCH MODE (AGL-2486) — a client-side window first, the prefix range
     * only when the window cannot have held everything.
     *
     * This used to be the prefix range alone, and that had two defects which
     * look like one from the outside.
     *
     * **It hid documents.** `orderBy('nameLower')` makes Firestore OMIT every
     * document that does not carry the field — and `nameLower` is optional,
     * stamped by three write paths for one resource kind. A document written
     * any other way stayed visible in the idle list and vanished the instant
     * you typed. Measured against the seeded emulator: a screen named "Home"
     * listed, and `home` returned nothing. Production happens to be clean
     * today (68/68 live screens and 10/10 membership rows carry it, checked
     * with the Admin SDK), so this is a LATENT defect rather than a firing
     * one — but it is armed for the next write path that forgets, and nothing
     * would fail when it does. Ordering the window by `documentId()`, which no
     * document can be missing, disarms it permanently: correctness stops
     * depending on a field staying in step across write paths.
     *
     * **And it could not match the way people type.** A prefix over the whole
     * stored name means somebody looking for "Main Layout" who types `layout`
     * gets nothing. That one IS firing, on every surface, today.
     *
     * The window is read ONCE per scope and cached for the life of the mount,
     * so the common case — a site whose collection fits inside it — costs one
     * read burst and then nothing at all per keystroke, which is CHEAPER than
     * the query it replaces. The prefix range is kept and issued only when the
     * window came back full, because that is the case AGL-838 built it for: a
     * host with hundreds of screens must still find one that is not in the
     * window. Dropping it to simplify would have regressed exactly the
     * property the switcher exists to provide.
     */
    const searchRead = async () => {
      let windowRows = windowRef.current
      if (!windowRows) {
        const windowSnapshot = await getDocs(
          query(ref, ...scopeFilter, orderBy(documentId()), limit(searchWindow)),
        )
        windowRows = {
          rows: toRows(windowSnapshot),
          fromCache: windowSnapshot.metadata?.fromCache,
        }
        windowRef.current = windowRows
      }
      const scored = windowRows.rows
        .map((row: any) => {
          const label = String(row?.[nameField] ?? '')
          const score = scoreMatch({ name: label }, debounced)
          return score === null ? null : { row, score, label }
        })
        .filter(Boolean) as Array<{ row: T; score: number; label: string }>

      // Only reach past the window when the window could not have held the
      // whole collection. A partial window is proof there is nothing beyond it.
      let beyond: T[] = []
      let beyondFromCache: boolean | undefined
      if (windowRows.rows.length >= searchWindow) {
        const prefixSnapshot = await getDocs(
          query(
            ref,
            ...scopeFilter,
            orderBy('nameLower'),
            startAt(key),
            endAt(key + '\uf8ff'),
            limit(searchLimit),
          ),
        )
        beyondFromCache = prefixSnapshot.metadata?.fromCache
        beyond = toRows(prefixSnapshot)
      }

      const seen = new Set(scored.map((hit) => (hit.row as any)?.[idField]))
      const merged = [
        ...scored
          .sort((a, b) => compareScored(a, b))
          .map((hit) => hit.row),
        ...beyond.filter((row: any) => !seen.has(row?.[idField])),
      ]
      return {
        rows: merged.slice(0, searchLimit),
        fromCache: windowRows.fromCache === false ? false : beyondFromCache,
      }
    }

    const read = hasQuery
      ? searchRead()
      : getDocs(
          query(ref, ...scopeFilter, orderBy('updatedAt', 'desc'), limit(idleLimit)),
        ).then((snapshot) => ({
          rows: toRows(snapshot),
          fromCache: snapshot.metadata?.fromCache,
        }))

    read
      .then((result) => {
        if (requestRef.current !== requestId) return // superseded
        const snapshot = { metadata: { fromCache: result.fromCache } }
        const rows = result.rows
        setItems(filter ? rows.filter(filter) : rows)
        setError(false)
        setLoading(false)
        // A SERVER answer is proof the session can read, and it clears the
        // denial evidence outright (AGL-2486). Guarded on `fromCache`
        // because `getDocs` falls back to the cache while offline, and the
        // reporter contract is explicit that a cached snapshot proves
        // nothing.
        //
        // Written as `=== false` rather than `!fromCache` on purpose: the
        // claim being made is "the server answered", so absent metadata
        // must report NOTHING rather than be read as a server read. It also
        // keeps this branch from throwing on a snapshot shape it did not
        // expect — a throw here lands in the `catch` below and would show
        // the user a refusal for a fetch that actually succeeded.
        if (snapshot.metadata?.fromCache === false) reportFirestoreServerRead()
      })
      .catch((error: unknown) => {
        // A missing composite index or transient error leaves the prior rows
        // in place rather than blanking the menu; the caller's "view all"
        // escape hatch still reaches everything.
        //
        // But SAY SO (AGL-1066). Swallowing the failure into `loading: false`
        // meant the no-prior-rows case — a cold load, or the first fetch
        // after a scope change — was indistinguishable from a genuinely
        // empty collection, and the site switcher printed "No sites yet."
        // at people who hold sites.
        if (requestRef.current !== requestId) return
        setError(true)
        setLoading(false)
        // …and tell the session detector, which this read used to keep to
        // itself (AGL-2486). Zach's production report was a Sites list that
        // "could not be loaded" while the console had no idea the session
        // was the reason: the switcher is one of the first reads on the
        // page and it contributed ZERO evidence toward the stale verdict,
        // so the very list that failed could never be what raised the
        // prompt. Only `permission-denied` — a missing index
        // (`failed-precondition`) or a dropped network (`unavailable`) is
        // not a session problem and must never be counted as one.
        if ((error as { code?: string })?.code === 'permission-denied') {
          reportFirestoreDenial(switcherCollectionKey(path))
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `skip` is listed even though it is derived from a value already in
    // `deps` for every caller today — a future caller whose skip condition is
    // independent of its scope would otherwise stay held after unblocking.
  }, [...deps, key, hasQuery, idleLimit, searchLimit, skip])

  return { items, loading, hasQuery, error }
}

export default useSwitcherCollection
