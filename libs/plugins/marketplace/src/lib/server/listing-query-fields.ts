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

import { FieldValue } from 'firebase-admin/firestore'
import { listingQueryFieldsPatch } from '../model/listing-query'

/**
 * Re-derive a listing's query fields from the document as stored (AGL-3321).
 *
 * Called by every writer that changes what the fields follow from — the
 * name, `deletedAt`, `visibility`, `hiddenAt`, `reviewStatus`, the artifact
 * discriminators — AFTER its own write. Reading back rather than deriving
 * from the writer's patch is deliberate: most of those writes are merges
 * carrying sentinels (`serverTimestamp()`, `FieldValue.delete()`), and a
 * `delete()` sentinel is a truthy object, so a patch-side derivation would
 * read an un-hidden listing as still hidden.
 *
 * A merge of only the fields that moved, so a current listing is not written
 * at all and a listing that is gone is left alone. Not in a transaction: two
 * writers racing on one listing each read back AFTER their own write, so the
 * later refresh derives from the later state; the window in which an earlier
 * refresh's write can land after a later one's is two round trips wide on a
 * document staff and its publisher rarely touch in the same second, and the
 * next write to the listing, or the backfill, re-derives it. A missing
 * `installCount` is stamped as an increment of zero, so an install landing
 * between the read and the write is counted rather than overwritten.
 */
export async function refreshListingQueryFields(
  listingRef: FirebaseFirestore.DocumentReference,
): Promise<void> {
  const snapshot = await listingRef.get()
  if (!snapshot.exists) return
  const patch = listingQueryFieldsPatch(snapshot.data() ?? {})
  if (!patch) return
  if ('installCount' in patch) patch['installCount'] = FieldValue.increment(0)
  await listingRef.set(patch, { merge: true })
}
