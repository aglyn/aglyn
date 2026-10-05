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
 * PAGED SWEEPS BY ONE FIELD (AGL-2623, AGL-3080): delete, or patch, every
 * document in a collection whose field equals a value, a batch at a time.
 *
 * What an erasure does to each collection that files a person under a key —
 * the platform's own sweeps and every plugin's share of a person erasure use
 * the same two, so a bound or a failure reads the same in each.
 *
 * Bounded: a pathological collection must not hold the caller open
 * indefinitely, so a sweep stops after {@link SWEEP_MAX_PAGES} pages of
 * {@link SWEEP_PAGE}. Never throws: a failure is logged under the caller's
 * label and the sweep stops, and the count says how far it got.
 */

/** Firestore caps a batch at 500 writes; a page under it keeps a margin. */
export const SWEEP_PAGE = 400

/**
 * Twenty pages of four hundred is eight thousand rows of one kind for one
 * key, past anything a real relationship produces.
 */
export const SWEEP_MAX_PAGES = 20

/**
 * Deletes every document in `collection` whose `field` equals `value`, a page
 * at a time. Returns how many went.
 */
export async function deleteWhereEquals(
  db: Pick<FirebaseFirestore.Firestore, 'batch'>,
  collection: FirebaseFirestore.Query,
  field: string,
  value: string,
  label: string,
): Promise<number> {
  let removed = 0
  try {
    for (let pass = 0; pass < SWEEP_MAX_PAGES; pass += 1) {
      const page = await collection.where(field, '==', value).limit(SWEEP_PAGE).get()
      if (page.empty) break
      const batch = db.batch()
      page.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
      removed += page.size
      if (page.size < SWEEP_PAGE) break
    }
  } catch (error) {
    console.error(`${label}: delete sweep failed on ${field}`, error)
  }
  return removed
}

/**
 * Applies `patch` — or what it answers for each document's data — to every
 * document in `collection` whose `field` equals `value`. Returns how many
 * changed.
 *
 * The patch must clear the very field that was matched on: a second page then
 * never sees the first page's rows again, so the loop needs no cursor and the
 * page cap is the only bound.
 */
export async function updateWhereEquals(
  db: Pick<FirebaseFirestore.Firestore, 'batch'>,
  collection: FirebaseFirestore.Query,
  field: string,
  value: string,
  patch:
    | Record<string, unknown>
    | ((data: FirebaseFirestore.DocumentData) => Record<string, unknown>),
  label: string,
): Promise<number> {
  let changed = 0
  try {
    for (let pass = 0; pass < SWEEP_MAX_PAGES; pass += 1) {
      const page = await collection.where(field, '==', value).limit(SWEEP_PAGE).get()
      if (page.empty) break
      const batch = db.batch()
      page.docs.forEach((doc) =>
        batch.update(doc.ref, typeof patch === 'function' ? patch(doc.data()) : patch),
      )
      await batch.commit()
      changed += page.size
      if (page.size < SWEEP_PAGE) break
    }
  } catch (error) {
    console.error(`${label}: update sweep failed on ${field}`, error)
  }
  return changed
}
