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

/*
 * `HostArtifactCollection` is declared beside `useLiveArtifactCount`, which is
 * the other half of the same answer and is reachable from a plugin. Re-exported
 * here so the kind and the query that walks it are still named together.
 */
export type { HostArtifactCollection } from '@aglyn/tenant-feature-instance'
import type { HostArtifactCollection } from '@aglyn/tenant-feature-instance'

/**
 * ONE ordering decision for the site artifact lists (AGL-2501).
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

/**
 * The ceilinged-read helper, re-exported rather than re-implemented.
 *
 * It moved to `@aglyn/tenant-feature-instance` when the plugin console cards
 * needed the same probe (AGL-2501): an app cannot be imported from a library,
 * so a copy here would have been a second implementation of the one rule that
 * decides whether a bounded list can admit it is bounded. The console's own
 * callers keep importing it from this module, beside the query builder they
 * already ask through.
 */
export {
  ceilingedWindow,
  type CeilingedWindow,
  // The MODULE, not the barrel. Several console specs mock
  // `@aglyn/tenant-feature-instance` wholesale to stage their Firestore hooks,
  // and a re-export through the barrel would vanish under those mocks — the
  // helper is a pure function with no hooks in it, so it has no reason to
  // travel through a surface that gets replaced.
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
