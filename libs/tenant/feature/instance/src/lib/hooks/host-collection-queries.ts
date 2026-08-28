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
  type CollectionReference,
  type Query,
} from 'firebase/firestore'

/**
 * ONE ordering decision for the console lists a plugin renders (AGL-693).
 *
 * ## What an unordered `limit()` actually answers
 *
 * Firestore answers a capped query with no `orderBy` in DOCUMENT-ID order, and
 * every collection these cards read is keyed by a generated `createResourceUid`
 * or by `add()`. So `limit(100)` is not "the first hundred variables" — it is a
 * pseudo-random hundred, and the rows past it are not merely unrendered, they
 * are UNREACHABLE, because nothing shows them and nothing asks for more. A
 * client `.sort()` over that sample is what hides it: the rows on screen run in
 * a believable order, they are simply the wrong rows, and the ones missing
 * leave no gap to notice.
 *
 * The console's site-artifact lists reached this answer first
 * (`hostArtifactQuery`) and could not share it: an app cannot be imported from
 * a library, so every plugin card faced the same question alone and eleven of
 * them answered it by not ordering at all. This is that decision, where a
 * plugin can ask for it.
 *
 * ## Why the walk orders on the document ID, and not on a field
 *
 * The obvious fix is `orderBy` on the field the list is sorted by — `name` for
 * most of these. It cannot be used. `orderBy` matches only documents that HAVE
 * the field, so ordering on one that any writer omits does not mis-order the
 * list, it HIDES rows from it: a worse failure than the one being fixed, and a
 * silent one.
 *
 * Every collection these cards read has such a writer:
 *
 *  * `/api/hosts/resources` stores an ALLOW-LIST of fields and validates none
 *    of them for presence, so a create that sends no name produces a document
 *    with no `name` at all.
 *  * `/api/hosts/import` copies only the keys a bundle actually carries through
 *    `IMPORTABLE_FIELDS` — `variables`, `functions`, `workflows` and `actions`
 *    are all in it — so a restored document carries a name only if the exported
 *    one had it.
 *  * `createdAt`/`updatedAt` are no better: the resources route stamps them
 *    server-side and an import's `cleanDoc` stamps `updatedAt` only.
 *
 * A document's NAME is not a field and cannot be absent, so ordering on it
 * drops nothing and the walk is TOTAL: every row is reachable by paging, which
 * is the property the old queries lacked. It is not insertion order — the ids
 * are random — so no list built on it may claim to be in one. What it is is
 * stable, complete, and the same on every load.
 *
 * ## Callers must not re-sort the page
 *
 * Re-sorting a window of an id-ordered walk by name is the same lie the old
 * code told: rows would run in one order within a page and another across
 * pages, and the first page would still not be the alphabetical first page. A
 * caller that holds a whole CEILING may sort — see `ceilingedWindow` — because
 * it is sorting the entire collection rather than a slice of it.
 */
export function collectionPage(
  ref: CollectionReference,
  pageLimit: number,
): Query {
  return query(ref, orderBy(documentId()), limit(pageLimit))
}

/**
 * The same ordering, for a list that is BOUNDED rather than paged.
 *
 * Asks for one document more than the ceiling, which is what turns "there is
 * more than this" into a fact. Pair it with `ceilingedWindow` to drop the probe
 * row before rendering.
 */
export function collectionCeiling(
  ref: CollectionReference,
  ceiling: number,
): Query {
  return query(ref, orderBy(documentId()), limit(ceiling + 1))
}

/** A ceilinged read, and whether the ceiling actually bit. */
export interface CeilingedWindow<T> {
  /** At most `ceiling` rows — the probe is never among them. */
  rows: T[]
  /** The collection holds MORE than the ceiling. A fact, not an estimate. */
  truncated: boolean
}

/**
 * A read that is bounded but not paged, and can say when it is short.
 *
 * Some lists cannot be windowed by document and must still be bounded: a
 * hierarchy sliced by row separates a child from its parent, a bundle
 * straddling a page renders twice and partial each time, a precedence list
 * paged by ten cannot swap its tenth row with its eleventh, and a table
 * assembled from two collections cannot dedupe across a page boundary.
 *
 * A bare ceiling is silent, which is the half that matters. Every consequence
 * on those surfaces is computed from what was read, so a collection above the
 * ceiling is drawn as a whole one with nothing to distinguish "there is no such
 * row" from "this card did not read it".
 *
 * Asking for ONE document more than the ceiling turns that into a fact for the
 * price of a single read. The probe is never handed on: a caller that rendered
 * `ceiling + 1` rows would be describing a window it did not draw.
 *
 * `hasMore` in `usePagedCollection` is the same trick for a paged list, and for
 * the same reason — a comparison against the cap is wrong exactly when the
 * count is an even multiple of it.
 */
export function ceilingedWindow<T>(
  read: readonly T[] | undefined,
  ceiling: number,
): CeilingedWindow<T> {
  const rows = read ?? []
  return { rows: rows.slice(0, ceiling), truncated: rows.length > ceiling }
}
