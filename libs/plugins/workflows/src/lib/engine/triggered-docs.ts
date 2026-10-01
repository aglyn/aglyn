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

/**
 * EVERY LIVE AUTOMATION ON AN EVENT RUNS (AGL-3458).
 *
 * The dispatch read ten documents for the event, in no order, and dropped the
 * deleted and the switched-off ones AFTER the limit — so a site with one
 * auto-reply per form ran some ten of them, fewer once any had been deleted,
 * and an eleventh form's reply silently never went. This reads the event's
 * documents in pages, in document-id order, keeps the ones that may run, and
 * hands back every one of them, in that order, up to `max`.
 *
 * `deletedAt` and a missing `enabled` cannot be asked of a query — a field's
 * absence matches nothing — so `keep` still judges them here, but on every
 * page rather than on a truncated first one. Equality on `trigger.event` and
 * an order by document id need only the automatic single-field index. The
 * reads are bounded twice: by `max`, and by `maxReads` for a site whose
 * deleted automations on one event have piled up.
 */

/** One page of an event's automations. */
export const TRIGGERED_DOCS_PAGE = 100

export async function triggeredDocsForEvent(
  collection: FirebaseFirestore.CollectionReference,
  event: string,
  options: {
    keep: (doc: FirebaseFirestore.QueryDocumentSnapshot) => boolean
    max: number
    maxReads: number
  },
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const kept: FirebaseFirestore.QueryDocumentSnapshot[] = []
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (let read = 0; read < options.maxReads; ) {
    let query = collection
      .where('trigger.event', '==', event)
      .orderBy('__name__')
      .limit(TRIGGERED_DOCS_PAGE)
    if (cursor) query = query.startAfter(cursor)
    const { docs } = await query.get()
    read += docs.length
    for (const doc of docs) if (options.keep(doc)) kept.push(doc)
    if (docs.length < TRIGGERED_DOCS_PAGE || kept.length >= options.max) break
    cursor = docs[docs.length - 1]
  }
  return kept.slice(0, options.max)
}
