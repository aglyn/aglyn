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

/** What both of this plugin's transfer resources read the same way. */

/** `items` in slices of `size`. */
export function slices<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
  return out
}

/**
 * How many of the selected ids name a document — what an export of the
 * selection will hold, so one holding a since-removed id is not promised a
 * row it lacks.
 */
export async function countExisting(
  collection: FirebaseFirestore.CollectionReference,
  ids: readonly string[],
): Promise<number> {
  let found = 0
  for (const chunk of slices(ids.filter((id) => id && !id.includes('/')), 300)) {
    const snapshots = await collection.firestore.getAll(...chunk.map((id) => collection.doc(id)))
    found += snapshots.filter((snapshot) => snapshot.exists).length
  }
  return found
}
