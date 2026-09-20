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

// By path, not `@aglyn/aglyn/server`: this module is also read in the browser
// (the besigner's repeat preview, AGL-3111), and the server entry carries
// `node:` modules no browser bundle can hold.
import {
  type HostDatasetRecord,
  sortDatasetRecords,
} from '@aglyn/aglyn/app-utils/datasets'
import { REPEAT_MAX_RECORDS } from '@aglyn/aglyn/app-utils/expand-repeatables'

/** One record document as either Firestore SDK hands it back. */
export interface RepeatRecordSnapshot {
  id: string
  data: HostDatasetRecord
}

/**
 * The records a repeat renders, in the order it renders them, from the two
 * bounded reads that find them (AGL-1302).
 *
 * The rows a repeat shows are the ones `sortDatasetRecords` puts first: every
 * record with an editor `order`, ascending, then the records without one —
 * forms and Actions append those — by document id. A `limit()` with no
 * `orderBy` cannot find them: Firestore answers it in document-id order, so on
 * a dataset past the bound it reads an arbitrary sample, and sorting that
 * sample afterwards only makes it look ordered.
 *
 * `byOrder` is the page ordered by `order`, bounded by
 * {@link REPEAT_MAX_RECORDS}, which matches only documents that carry the
 * field. When it comes back short every ordered record is already in hand, so
 * `byId` — the same bound over the document id — supplies exactly the first
 * unordered ones; a caller whose `byOrder` came back full does not need to
 * read it, and passes an empty list.
 *
 * The published page's composition and the besigner's canvas preview both
 * read through this, with the Admin SDK and the client SDK respectively, so
 * the canvas cannot preview a row the page would not render.
 *
 * Each row is the record's value map, with `$id` inside it so incoming
 * reference hops (AGL-180) can resolve rows.
 */
export function repeatRecordsFromPages(
  byOrder: readonly RepeatRecordSnapshot[],
  byId: readonly RepeatRecordSnapshot[],
): Array<Record<string, unknown>> {
  const snapshots = [...byOrder]
  if (byOrder.length < REPEAT_MAX_RECORDS) {
    const held = new Set(byOrder.map((snapshot) => snapshot.id))
    snapshots.push(...byId.filter((snapshot) => !held.has(snapshot.id)))
  }
  return sortDatasetRecords(
    snapshots.map((snapshot) => ({ $id: snapshot.id, ...snapshot.data })),
  )
    .slice(0, REPEAT_MAX_RECORDS)
    .map((record) => ({ ...(record.values ?? {}), $id: record.$id }))
}
