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
  documentId,
  limit,
  orderBy,
  query,
  type Query,
} from 'firebase/firestore'

/**
 * A paged list SORTED BY A FIELD that still drops nothing (AGL-2853).
 *
 * ## The trap a field sort walks into
 *
 * `orderBy(field)` matches only documents that HAVE the field. A document
 * without it is not sorted last, it is not in the result at all, so a list
 * ordered that way does not mis-order the documents a writer left the field
 * off — it hides them, and the rows it does show look complete. That is why
 * `collectionPage` orders on the document name, which no document can lack.
 *
 * Content entries are the case that made the name order untenable: a
 * changelog read in id order puts its newest release on whichever page the
 * random id lands. And they carry exactly the gaps the trap feeds on —
 * unpublishing deletes `publishedAt`, and a restored archive has no
 * `createdAt`. Ordering on either hides every draft or every import.
 *
 * ## Two segments, one sequence
 *
 * The list is split by whether a document carries the sort field, and each
 * half is walked by a query that can see all of it:
 *
 *   KEYED    `orderBy(field, dir), orderBy(documentId(), dir)` — every document
 *            that has the field, including an explicit `null`, in the
 *            requested order. The name is the tiebreak, so the order is total
 *            and a page boundary cannot fall between two equal values
 *            differently on two reads.
 *   UNKEYED  `orderBy(documentId())` over the same base, kept to the documents
 *            that LACK the field. Firestore cannot query for an absent field,
 *            so this segment is a scan: it reads the base in name order and
 *            keeps what the keyed walk could not see.
 *
 * The two are disjoint and together are the whole base, so the list is the
 * keyed segment followed by the unkeyed one — documents missing the sorted
 * value come after every document that has one, in both directions. Every
 * page is a slice of that one sequence, which is what keeps a document from
 * being skipped or shown twice across a page boundary.
 *
 * ## What it costs
 *
 * The keyed walk is a window like `usePagedCollection`'s: one page plus a
 * probe row, widened a page at a time. The scan opens only once the keyed
 * walk has come back SHORT of its window — a server-confirmed fact that the
 * keyed segment ends on this page — so the first pages of a long list cost
 * exactly what an unsorted list costs. The scan starts at the number of rows
 * the window still needs and doubles while it holds its whole limit without
 * finding them; it stops the moment it has enough or reads past the end of the
 * base. Its worst case is the base itself, reached only on the last pages.
 *
 * A base narrowed by an equality predicate narrows the scan with it, which is
 * what keeps a filtered view cheap: a status filter scans only that status.
 *
 * ## Why the planner is pure
 *
 * `planKeyedSegment` and `planSortedWindow` are the whole decision — which
 * limits to ask for, when the scan widens, which rows the page shows and
 * whether another page exists. The hook adapts them to live listeners; the
 * emulator spec drives the same two functions against a real Firestore, so
 * the proof that nothing is dropped runs the code the console runs rather
 * than a copy of it.
 */

export type CollectionSortDirection = 'asc' | 'desc'

/** A field to sort a collection by, and which way. */
export interface CollectionSort {
  /** A Firestore field path. Dotted paths address nested fields. */
  field: string
  direction: CollectionSortDirection
}

/**
 * The KEYED segment: every document of `base` that carries `sort.field`, in
 * that order, one window at a time.
 *
 * A field `base` already pins by EQUALITY holds one value across every
 * matching document, so ordering on it orders nothing and neither direction
 * means anything — the walk orders by the document name, ascending, which is
 * the shape the field's automatic index serves. Every document of such a base
 * carries the field, so no unkeyed segment exists; see `sortFieldIsTotal`.
 */
export function sortedKeyedQuery(
  base: Query,
  sort: CollectionSort,
  pageLimit: number,
  equalityFields: readonly string[] = [],
): Query {
  if (equalityFields.includes(sort.field)) {
    return query(base, orderBy(documentId()), limit(pageLimit))
  }
  return query(
    base,
    orderBy(sort.field, sort.direction),
    orderBy(documentId(), sort.direction),
    limit(pageLimit),
  )
}

/**
 * The scan behind the UNKEYED segment: `base` in document-name order.
 *
 * Always ascending. The names are generated ids, so neither direction means
 * anything to a reader, and an equality predicate followed by an ascending
 * name order is the one shape every automatic index serves.
 */
export function sortedUnkeyedQuery(base: Query, scanLimit: number): Query {
  return query(base, orderBy(documentId()), limit(scanLimit))
}

/**
 * Whether every document `base` matches carries the sort field, because
 * `base` pins that field by equality. Such a base has no unkeyed segment.
 */
export function sortFieldIsTotal(
  sort: CollectionSort,
  equalityFields: readonly string[] = [],
): boolean {
  return equalityFields.includes(sort.field)
}

/**
 * Whether a row read off a snapshot LACKS `field` — the membership test of
 * the unkeyed segment, and the exact complement of what `orderBy(field)`
 * returns.
 *
 * `undefined` and nothing else. Firestore cannot store `undefined`, so a
 * missing key is the only way to read one; an explicit `null` is a stored
 * value, indexed and returned by the keyed walk, and must not be read twice.
 */
export function lacksSortField(row: unknown, field: string): boolean {
  let value: unknown = row
  for (const key of field.split('.')) {
    if (value === null || typeof value !== 'object') return true
    value = (value as Record<string, unknown>)[key]
  }
  return value === undefined
}

/** What the keyed read has established about the window. */
export interface KeyedSegmentPlan {
  /** Rows before the page being read. */
  offset: number
  /** Every page up to and including the one being read. */
  windowSize: number
  /** The keyed walk's limit: the window plus a single probe row. */
  keyedLimit: number
  /**
   * Rows the unkeyed segment must supply to fill the window and its probe —
   * `0` until the server has confirmed the keyed walk ends inside the window.
   */
  tailNeeded: number
}

/** The keyed read, as the planner needs to see it. */
export interface KeyedSegmentInput<T> {
  page: number
  pageSize: number
  /** The keyed rows read at this window's limit, or `undefined` if unread. */
  keyed: readonly T[] | undefined
  /** The server has answered the keyed read — not only the local cache. */
  keyedSettled: boolean
  /** See `sortFieldIsTotal`. */
  keyedIsTotal: boolean
}

/**
 * The keyed half of the plan: the limit to ask for, and how many rows the
 * scan owes the window.
 *
 * The scan is owed rows only when the keyed walk came back holding LESS than
 * its limit, and only once the server said so. A cached answer can be short
 * because the cache is, and opening a scan on it would pay to read documents
 * the server's answer is about to render unnecessary.
 */
export function planKeyedSegment<T>(
  input: KeyedSegmentInput<T>,
): KeyedSegmentPlan {
  const offset = input.page * input.pageSize
  const windowSize = offset + input.pageSize
  const keyedLimit = windowSize + 1
  const held = input.keyed?.length ?? 0
  const exhausted =
    input.keyed !== undefined && input.keyedSettled && held < keyedLimit
  return {
    offset,
    windowSize,
    keyedLimit,
    tailNeeded: exhausted && !input.keyedIsTotal ? keyedLimit - held : 0,
  }
}

/**
 * The limit the scan should be open at: `0` when no rows are owed, otherwise
 * never less than it has already been widened to, so a keyed row arriving
 * mid-scan does not re-open the scan one document narrower.
 */
export function sortedScanLimit(
  plan: KeyedSegmentPlan,
  widenedTo: number,
): number {
  return plan.tailNeeded > 0 ? Math.max(widenedTo, plan.tailNeeded) : 0
}

/** Both reads, as the planner needs to see them. */
export interface SortedWindowInput<T> extends KeyedSegmentInput<T> {
  sort: CollectionSort
  /** The scan rows read at `scanLimit`, or `undefined` if unread. */
  scan: readonly T[] | undefined
  /** The server has answered the scan — not only the local cache. */
  scanSettled: boolean
  /** The limit `scan` was read at; `0` when no scan is open. */
  scanLimit: number
  /** A row's document id, which dedupes the two segments. */
  idOf: (row: T) => string
}

/** The window a list renders. */
export interface SortedWindow<T> extends KeyedSegmentPlan {
  /**
   * The limit the scan should be open at. Greater than the input's when the
   * scan held its whole limit without finding the rows it owes, which is the
   * signal to widen it.
   */
  scanLimit: number
  /** The page being read. Never the probe row. */
  rows: T[]
  /** A further page exists. A fact from the probe row, not a comparison. */
  hasMore: boolean
  /**
   * `rows` and `hasMore` are the server's answer for this window: the keyed
   * walk is confirmed, and the scan is confirmed at its final limit whenever
   * the window needed one.
   */
  settled: boolean
  /** The keyed rows then the unkeyed rows, deduped — probe row included. */
  ordered: T[]
}

/**
 * The page, from the keyed rows and the scan rows.
 *
 * The scan is widened only on a CONFIRMED short read: it held its whole limit
 * (so the base continues past it) and kept fewer rows than the window owes.
 * A scan that read past the end of the base has found every document the
 * keyed walk cannot see, however few, and is done.
 *
 * Rows are deduped by id across the two segments. A document gaining or
 * losing the sort field reaches the two listeners separately, and for the
 * moment between their snapshots one of them still describes it the old way;
 * the keyed copy wins, because the keyed walk is the one that orders it.
 */
export function planSortedWindow<T>(
  input: SortedWindowInput<T>,
): SortedWindow<T> {
  const plan = planKeyedSegment(input)
  const keyed = input.keyed ?? []
  const keyedSettled = input.keyed !== undefined && input.keyedSettled

  let scanLimit = 0
  let tail: readonly T[] = []
  let tailSettled = true
  if (plan.tailNeeded > 0) {
    const scanned = input.scanLimit > 0 ? input.scan : undefined
    const scanSettled = scanned !== undefined && input.scanSettled
    const scanExhausted =
      scanSettled && (scanned?.length ?? 0) < input.scanLimit
    tail = (scanned ?? []).filter((row) =>
      lacksSortField(row, input.sort.field),
    )
    if (scanExhausted || (scanSettled && tail.length >= plan.tailNeeded)) {
      scanLimit = input.scanLimit
    } else if (scanSettled) {
      scanLimit = Math.max(input.scanLimit * 2, plan.tailNeeded)
      tailSettled = false
    } else {
      scanLimit = Math.max(input.scanLimit, plan.tailNeeded)
      tailSettled = false
    }
  }

  const seen = new Set<string>()
  const ordered: T[] = []
  for (const row of [...keyed, ...tail]) {
    const id = input.idOf(row)
    if (seen.has(id)) continue
    seen.add(id)
    ordered.push(row)
  }

  return {
    ...plan,
    scanLimit,
    rows: ordered.slice(plan.offset, plan.windowSize),
    hasMore: ordered.length > plan.windowSize,
    settled: keyedSettled && tailSettled,
    ordered,
  }
}
