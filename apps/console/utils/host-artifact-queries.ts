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
  collection,
  documentId,
  limit,
  orderBy,
  query,
  type Firestore,
  type Query,
} from 'firebase/firestore'

/** The per-site artifact collections that render as a console list. */
export type HostArtifactCollection =
  | 'screens'
  | 'layouts'
  | 'components'
  | 'templates'

/**
 * ONE ordering decision for the site artifact lists (AGL-693).
 *
 * ## What an unordered `limit()` actually answers
 *
 * Firestore answers a capped query with no `orderBy` in DOCUMENT-ID order,
 * and every artifact here is keyed by a generated `createResourceUid`. So a
 * bare `limit(100)` is not "the first hundred components" — it is a
 * pseudo-random hundred, and the rows past it are not merely unrendered, they
 * are UNREACHABLE, because nothing shows them and nothing asks for more. A
 * client `.sort()` over that sample is what hides it: the rows on screen run
 * in a believable order, they are simply the wrong rows, and the ones missing
 * leave no gap to notice.
 *
 * ## Why the walk orders on the document ID, and not on a field
 *
 * The obvious fix is `orderBy` on the field the list is sorted by —
 * `displayName` for all three. It cannot be used. `orderBy` matches only
 * documents that HAVE the field, so ordering on one that any writer omits
 * does not mis-order the list, it HIDES rows from it: a worse failure than
 * the one being fixed, and a silent one.
 *
 * Every one of these collections has a writer that can omit `displayName`:
 *
 *  * `/api/hosts/resources` stores an ALLOW-LIST of fields
 *    (`RESOURCES.reusableComponent.fields` and the screen/layout equivalents)
 *    and validates none of them for presence, so a create that sends no name
 *    produces a document with no `displayName` at all.
 *  * `/api/hosts/import` copies only the keys a bundle actually carries
 *    through `IMPORTABLE_FIELDS`, so a restored artifact carries a name only
 *    if the exported document had one.
 *  * The marketplace installers are the one writer that always sets it
 *    (`install.ts` writes `displayName: listing.displayName`), which is
 *    exactly the shape that makes this dangerous — most documents have the
 *    field, so ordering on it looks right on every site that has never hit
 *    the gap.
 *
 * `createdAt`/`updatedAt` are no better: the resources route stamps them
 * server-side, and an import's `cleanDoc` stamps `updatedAt` only.
 *
 * A document's NAME is not a field and cannot be absent, so ordering on it
 * drops nothing and the walk is TOTAL: every artifact is reachable by paging,
 * which is the property the old query lacked. It is not insertion order — the
 * ids are random — so no list built on it may claim to be in one. What it is
 * is stable, complete, and the same on every load.
 *
 * ## Callers must not re-sort the page
 *
 * Re-sorting a window of an id-ordered walk by name is the same lie the old
 * code told: rows would run in one order within a page and another across
 * pages, and the first page would still not be the alphabetical first page.
 * The rows are rendered as they arrive.
 */
export function hostArtifactQuery(
  firestore: Firestore,
  hostId: string,
  artifact: HostArtifactCollection,
  pageLimit: number,
): Query {
  return query(
    collection(firestore, 'hosts', hostId, artifact),
    orderBy(documentId()),
    limit(pageLimit),
  )
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
 * Two console lists cannot be windowed by document and must still be bounded:
 * the screens tree (slicing a hierarchy by row separates a child from its
 * parent, and the route each screen composes walks that chain) and the
 * template library (a multi-page starter collapses into ONE row, so a page
 * boundary through a bundle renders it twice, each time partial). Both read a
 * ceiling instead.
 *
 * A bare ceiling is silent, which is the half that matters. Every consequence
 * on those surfaces is computed from what was read — the tree, the routes, the
 * plan count — so a site above the ceiling is shown a partial site with
 * nothing to distinguish "I have no such screen" from "this page did not read
 * it".
 *
 * Asking for ONE document more than the ceiling turns that into a fact for the
 * price of a single read. The probe is never handed on: a caller that rendered
 * `ceiling + 1` rows would be describing a window it did not draw.
 *
 * `hasMore` in `usePagedCollection` is the same trick for a paged list, and
 * for the same reason — a comparison against the cap is wrong exactly when the
 * count is an even multiple of it.
 */
export function ceilingedWindow<T>(
  read: readonly T[] | undefined,
  ceiling: number,
): CeilingedWindow<T> {
  const rows = read ?? []
  return { rows: rows.slice(0, ceiling), truncated: rows.length > ceiling }
}
