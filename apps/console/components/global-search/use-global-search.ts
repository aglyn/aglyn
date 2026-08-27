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

import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Firestore,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compareScored, isSearchableQuery, scoreMatch } from '@aglyn/aglyn'
import type {
  GlobalSearchEntity,
  GlobalSearchEntityDef,
} from './global-search-scope'

/**
 * The read layer of console search, and the whole of its cost story
 * (AGL-2486).
 *
 * ## The three controls, and what each one is worth
 *
 * the requirement was for search over roughly a dozen collections and in the same
 * breath asked that it not cost too many reads. Those pull against each other
 * only if the reads are per keystroke, which is the naive shape and the one
 * this deliberately is not.
 *
 * 1. **Nothing is read until the query is worth reading for.** Under
 *    `MIN_QUERY_LENGTH` no query is issued at all, so OPENING the palette
 *    costs zero. The previous implementation spent a read per group on open,
 *    to populate a recently-updated list that answered a question nobody had
 *    asked, on a control mounted in the top bar of every console page.
 * 2. **At most two fetches per collection per page mount.** The window is
 *    cached in a ref for the life of the mount, so the second character, the
 *    tenth, and reopening the palette entirely are all free. This is sound
 *    rather than merely cheap: matching happens client-side over the whole
 *    window, so a different query is a different filter over the same rows,
 *    not a different question for the database. The second fetch is the
 *    escalation — see `SEARCH_ESCALATION_WINDOW` — and it is spent only on a
 *    collection that filled its window and still matched nothing.
 * 3. **Two entities that share a collection share its read.** `screens` and
 *    `emails` are the same Firestore collection partitioned by `kind`, so
 *    they are fetched once and split here. Fetching per ENTITY instead would
 *    have doubled that collection's cost for no new information.
 *
 * A group the caller is not entitled to never reaches this hook at all —
 * `resolveGlobalSearchScope` drops it — so a free workspace, which has no
 * workflows, products, services or redirects, fans out to strictly fewer
 * collections than a paid one.
 *
 * ## No new index, and that is checked rather than hoped
 *
 * Every read here is either `orderBy(documentId())` on a collection, or one
 * equality plus `orderBy(documentId())`. Firestore's automatic single-field
 * indexes cover both at COLLECTION scope, which is why this adds nothing to
 * `cloud/firebase-firestore.indexes.json`. Nothing here is a collection-GROUP
 * query, which would get no free index at all. The escalation adds a
 * `startAfter` cursor and nothing else — a cursor is a position within an
 * ordering that already exists, so it needs no index the ordering did not.
 *
 * ## Why `documentId()` and not `updatedAt`
 *
 * Because ordering by a field is how this feature broke in the first place.
 * The search mode it replaces was `orderBy('nameLower')`, and Firestore
 * **omits every document that lacks the ordered field** — which silently hid
 * every screen written by any path that does not stamp it. Measured on the
 * seeded emulator: a screen named "Home" sits in the list, and typing `home`
 * returns nothing.
 *
 * `documentId()` is present on every document by construction, so this
 * ordering cannot hide anything. It is the same reasoning `/api/admin/orgs`
 * records for the same choice: *"a stable ordering that drops no doc (an
 * `orderBy` on a field some org docs lack would silently hide them)"*. The
 * price is that the window is an arbitrary slice rather than the most recent
 * one, which is why `truncated` exists and why the caption says so.
 */

/**
 * How many documents are read per collection.
 *
 * The number is a cost decision, so it is stated as one. Worst case is this
 * times the number of entitled groups, ONCE per page mount — and the worst
 * case only arises for an org that actually owns thirty of everything, which
 * is a large paying customer rather than the free tier that has to hard-cap.
 * A typical site returns far fewer, because a query that matches nothing
 * still costs the one-read minimum and most of these collections hold single
 * digits.
 */
export const SEARCH_WINDOW = 30

/**
 * How many MORE documents one collection may be read for, once — and why a
 * second read exists at all (AGL-2179).
 *
 * ## The measurement that put this here
 *
 * Driven against a real signed-in console on `aglyn-marketing`, a site with 54
 * screens: typing `pric` returned **"Nothing matched."** The site's own
 * `/pricing` page exists, is published, and is named "Pricing". It was simply
 * not among the first `SEARCH_WINDOW` documents in `documentId()` order, and
 * the window is an arbitrary slice rather than a relevant one — that is stated
 * plainly in the ordering note above and is the price paid for an ordering no
 * document can be missing.
 *
 * A caption saying so would have been honest, and was not even shown (see
 * `groups` below, which used to DROP a zero-match group and take its caveat
 * with it). But honest is not the bar here. A console search that cannot find
 * the pricing page of the flagship site is the same defect this issue opened
 * with, one layer down: an affordance that promises more than it answers.
 *
 * ## Why escalate rather than just raise the window
 *
 * the constraint on this feature was that it not cost too many reads, and a
 * flat window is charged to EVERY entitled group on every mount where somebody
 * types. Raising it from 30 to 300 multiplies the common case by ten to fix an
 * uncommon one.
 *
 * Escalation charges the extra reads only where the cheap answer was proven
 * inadequate — a group that BOTH filled its window and matched nothing in it.
 * A site with eight screens never escalates. `aglyn-marketing` escalates once,
 * on `screens`, for 24 more reads, and finds Pricing. And because the widened
 * window is cached like the first one, it is paid at most once per collection
 * per mount however much more is typed.
 *
 * The ceiling is real: a collection larger than `SEARCH_MAX_ITEMS` is still
 * only partly searched, and `truncated` survives to say so.
 */
export const SEARCH_ESCALATION_WINDOW = 270

/** The most documents one collection can cost in a single mount. */
export const SEARCH_MAX_ITEMS = SEARCH_WINDOW + SEARCH_ESCALATION_WINDOW

/** How many rows of one kind are shown. Display only — costs no reads. */
export const MAX_ROWS_PER_GROUP = 5

/** One collection's worth of fetched rows, or the reason there are none. */
interface WindowState {
  rows: Array<Record<string, any>>
  /** The fetch failed. NOT the same as "matched nothing" and never rendered as it. */
  failed: boolean
  /** The window filled, so the collection may hold matches that were not read. */
  truncated: boolean
  /**
   * The escalation read has been spent on this collection for this mount.
   *
   * The loop-stop as well as the cost cap: escalation is triggered by a query
   * matching nothing, and a query that matches nothing in the widened window
   * still matches nothing, so without this the effect would re-fire forever.
   */
  escalated: boolean
  /**
   * The last document of the window, for `startAfter`.
   *
   * The snapshot rather than its id: with `orderBy(documentId())` a cursor
   * must be a document reference or an id, and passing the snapshot is the one
   * form that cannot be misread as a field value.
   */
  lastDoc: any | null
}

export interface GlobalSearchGroup {
  definition: GlobalSearchEntityDef
  rows: Array<Record<string, any> & { $score: number; $label: string }>
  /** This group could not be read. Say so; never render it as zero matches. */
  failed: boolean
  /** Matching was over a partial window, so absence is not proof of absence. */
  truncated: boolean
  /**
   * How many documents were actually matched against.
   *
   * Rendered in the caveat rather than `SEARCH_WINDOW`, because after an
   * escalation those two numbers differ and the reader is owed the real one.
   */
  searched: number
}

export interface UseGlobalSearchResult {
  groups: GlobalSearchGroup[]
  loading: boolean
  /** The query is long enough to have been run. */
  active: boolean
  /** Total rows shown across every group. */
  total: number
  /** Documents actually read from Firestore during this mount. */
  readCount: number
}

/**
 * Which rows of a shared collection belong to which entity.
 *
 * Only `screens` needs it, and it needs it in both directions: an email-kind
 * screen is an email and is NOT a page, and a soft-deleted screen is
 * neither. Written as a total function per entity rather than a filter on one
 * of them, so adding the second reader of a collection cannot silently change
 * what the first one sees.
 */
export function rowBelongsTo(
  entity: GlobalSearchEntity,
  row: Record<string, any>,
): boolean {
  if (row?.deletedAt) return false
  if (entity === 'screens') return row?.kind !== 'email'
  if (entity === 'emails') return row?.kind === 'email'
  return true
}

/** Score one row the way the group would, so the two can never disagree. */
function scoreRow(
  definition: GlobalSearchEntityDef,
  row: Record<string, any>,
  text: string,
): { score: number; label: string } | null {
  const label = String(row[definition.nameField] ?? '').trim()
  const score = scoreMatch(
    {
      name: label,
      extra: (definition.extraFields ?? []).map((field) => row[field]),
    },
    text,
  )
  return score === null ? null : { score, label }
}

/**
 * Did anything in this window match?
 *
 * The escalation predicate. Written against the same `scoreRow` the rendered
 * group uses, because an escalation triggered by a DIFFERENT notion of
 * "matched" than the one the reader sees would either spend reads on a group
 * that already had an answer or withhold them from one that did not.
 */
export function matchesIn(
  definition: GlobalSearchEntityDef,
  rows: Array<Record<string, any>>,
  text: string,
): boolean {
  return rows.some(
    (row) =>
      rowBelongsTo(definition.id, row) && scoreRow(definition, row, text) !== null,
  )
}

/** The cache key for one collection read. */
function windowKey(
  definition: GlobalSearchEntityDef,
  orgId: string | null,
  hostId: string | null,
): string {
  return definition.scopeKind === 'org'
    ? `org:${orgId}:${definition.collection}`
    : `host:${hostId}:${definition.collection}`
}

export interface UseGlobalSearchOptions {
  firestore: Firestore
  entities: GlobalSearchEntityDef[]
  uid: string | null
  orgId: string | null
  hostId: string | null
  /** Raw text from the field. */
  text: string
}

export function useGlobalSearch(
  options: UseGlobalSearchOptions,
): UseGlobalSearchResult {
  const { firestore, entities, uid, orgId, hostId, text } = options
  const active = isSearchableQuery(text)

  // The whole cost control: one entry per collection, for the life of the
  // mount. A ref rather than state because filling it must not itself cause
  // a render — `version` below is what tells React something arrived.
  const cacheRef = useRef(new Map<string, WindowState>())
  const inFlightRef = useRef(new Set<string>())
  const readCountRef = useRef(0)
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(false)

  // A scope change invalidates everything: rows from site A must never be
  // matched against and rendered while standing on site B.
  const scopeSignature = `${uid ?? ''}|${orgId ?? ''}|${hostId ?? ''}`
  const lastScopeRef = useRef(scopeSignature)
  if (lastScopeRef.current !== scopeSignature) {
    lastScopeRef.current = scopeSignature
    cacheRef.current = new Map()
    inFlightRef.current = new Set()
    readCountRef.current = 0
  }

  const fetchWindow = useCallback(
    async (
      definition: GlobalSearchEntityDef,
      /**
       * The window already held for this collection, when this is the
       * escalation read. `null` for the first read of a mount.
       */
      previous: WindowState | null,
    ) => {
      const key = windowKey(definition, orgId, hostId)
      if (inFlightRef.current.has(key)) return
      if (!previous && cacheRef.current.has(key)) return
      // Escalating twice would spend the ceiling repeatedly for one query.
      if (previous && (previous.escalated || !previous.truncated)) return
      const path =
        definition.scopeKind === 'org'
          ? ['users', uid ?? '', definition.collection]
          : ['hosts', hostId ?? '', definition.collection]
      // A momentarily empty path segment would address `hosts//screens`.
      // Holding is the same discipline `skip` enforces for the `where` case
      // below, where an unresolved id widens the query instead of breaking it.
      if (path.some((segment) => !segment)) return
      inFlightRef.current.add(key)
      setLoading(true)
      try {
        const reference = collection(firestore, path[0], ...path.slice(1))
        // The sites read is the caller's OWN membership projection, narrowed
        // to the open workspace. Without the narrowing this returns their
        // memberships across EVERY org they belong to (AGL-2350) — which on
        // an agency running one workspace per client puts one client's site
        // names in another's search results. The scope resolver already
        // refuses to offer this entity without an org; this is the second
        // layer, and it is deliberate duplication.
        const size = previous ? SEARCH_ESCALATION_WINDOW : SEARCH_WINDOW
        const constraints: any[] =
          definition.scopeKind === 'org'
            ? [where('orgId', '==', orgId), orderBy(documentId())]
            : [orderBy(documentId())]
        // The cursor goes between the ordering and the limit, which is the
        // only position Firestore accepts it in.
        if (previous?.lastDoc) constraints.push(startAfter(previous.lastDoc))
        constraints.push(limit(size))
        if (definition.scopeKind === 'org' && !orgId) {
          throw new Error('refusing an unscoped site read')
        }
        const snapshot = await getDocs(query(reference, ...constraints))
        readCountRef.current += Math.max(snapshot.docs.length, 1)
        const fetched = snapshot.docs.map((document) => ({
          ...document.data(),
          $id: document.id,
        }))
        const rows = previous ? [...previous.rows, ...fetched] : fetched
        cacheRef.current.set(key, {
          rows,
          failed: false,
          // The bound is whether THIS page filled: a short final page proves
          // the collection ran out, however much came before it.
          truncated: fetched.length >= size,
          escalated: Boolean(previous),
          lastDoc: snapshot.docs[snapshot.docs.length - 1] ?? previous?.lastDoc ?? null,
        })
      } catch {
        // Recorded as a FAILURE, never folded into an empty result. A
        // swallowed query renders as a measured zero, which is worse than an
        // error because nothing looks wrong — the reader concludes they do
        // not have the thing they are searching for.
        //
        // Not cached as a permanent verdict either: the entry is dropped on
        // the next scope change, and `failed` is what the UI renders.
        readCountRef.current += 1
        cacheRef.current.set(key, {
          rows: previous?.rows ?? [],
          failed: true,
          truncated: false,
          escalated: true,
          lastDoc: previous?.lastDoc ?? null,
        })
      } finally {
        inFlightRef.current.delete(key)
        setVersion((previous) => previous + 1)
        if (inFlightRef.current.size === 0) setLoading(false)
      }
    },
    [firestore, orgId, hostId, uid],
  )

  // Reads are triggered by the query becoming worth running, not by opening
  // the palette and not by every keystroke: once a collection is cached the
  // effect finds it and issues nothing.
  //
  // The one exception is the escalation, and it is deliberately conditioned on
  // the OUTCOME rather than on the size of the collection: a group that filled
  // its window AND matched nothing has proved the cheap read insufficient for
  // this query, and only then is the wider read worth its cost.
  useEffect(() => {
    if (!active) return
    for (const definition of entities) {
      const state = cacheRef.current.get(windowKey(definition, orgId, hostId))
      if (!state) {
        void fetchWindow(definition, null)
        continue
      }
      if (state.failed || state.escalated || !state.truncated) continue
      if (matchesIn(definition, state.rows, text)) continue
      void fetchWindow(definition, state)
    }
    // `version` is a dependency because escalation is decided from the CACHE,
    // which a landed read mutates without re-rendering on its own.
  }, [active, entities, fetchWindow, orgId, hostId, text, version])

  const groups = useMemo<GlobalSearchGroup[]>(() => {
    if (!active) return []
    // `version` is read so the memo recomputes when a window lands; the ref
    // it guards is mutable and would otherwise be invisible to React.
    void version
    const out: GlobalSearchGroup[] = []
    for (const definition of entities) {
      const state = cacheRef.current.get(windowKey(definition, orgId, hostId))
      if (!state) continue
      const scored = state.rows
        .filter((row) => rowBelongsTo(definition.id, row))
        .map((row) => {
          const hit = scoreRow(definition, row, text)
          return hit === null
            ? null
            : { ...row, $score: hit.score, $label: hit.label }
        })
        .filter(Boolean) as GlobalSearchGroup['rows']
      scored.sort((a, b) =>
        compareScored(
          { score: a.$score, label: a.$label },
          { score: b.$score, label: b.$label },
        ),
      )
      // A failed group is emitted even with no rows, because its whole job is
      // to say it failed. So is a TRUNCATED one (AGL-2179): this used to drop
      // any group with no matches, which threw away the truncation caveat at
      // exactly the moment it carried information — the reader saw a bare
      // "Nothing matched." over a collection that had only been partly read,
      // which is the measured zero this feature is not allowed to render.
      // A group that was fully read and matched nothing is still dropped;
      // there is nothing to say about it.
      const incomplete = state.truncated && !state.failed
      if (scored.length === 0 && !state.failed && !incomplete) continue
      out.push({
        definition,
        rows: scored.slice(0, MAX_ROWS_PER_GROUP),
        failed: state.failed,
        truncated: state.truncated,
        searched: state.rows.filter((row) => rowBelongsTo(definition.id, row))
          .length,
      })
    }
    return out
  }, [active, entities, orgId, hostId, text, version])

  return {
    groups,
    loading,
    active,
    total: groups.reduce((sum, group) => sum + group.rows.length, 0),
    readCount: readCountRef.current,
  }
}

export default useGlobalSearch
