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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  planThemeLibraryAction,
  THEME_FIELD_DELETE,
  THEME_LIBRARY_COLLECTION,
  type ThemeLibraryAction,
  type ThemeLibraryEntry,
  type ThemeLibraryPlan,
} from '@aglyn/aglyn/app-utils/theme-library'
import type { DocumentReference, Transaction } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'

/**
 * Plans a theme-library action against the host and its library as read
 * INSIDE `tx`, and writes the plan in the same transaction (AGL-3404).
 *
 * One executor for every route that changes which theme a site runs — the
 * console's library route and the marketplace install — so a switch cannot
 * be filed one way by one of them and another way by the other.
 *
 * Reading in the transaction is the point: the console's copy of the host is
 * a listener that can be serving a cache (AGL-1358), and a switch planned from
 * a stale override would stash the wrong edits.
 *
 * Host fields are written with `update`, which replaces each named field
 * wholesale. A deep merge would union two override patches and keep the
 * tokens of the theme being replaced. Existing entries are updated the same
 * way; new ones are created whole.
 */
export async function runThemeLibraryAction(
  tx: Transaction,
  hostRef: DocumentReference,
  action: ThemeLibraryAction,
  extra?: Record<string, unknown>,
): Promise<ThemeLibraryPlan> {
  const library = hostRef.collection(THEME_LIBRARY_COLLECTION)
  const [hostSnapshot, entriesSnapshot] = await Promise.all([
    tx.get(hostRef),
    tx.get(library),
  ])
  const entries: Record<string, ThemeLibraryEntry> = {}
  for (const doc of entriesSnapshot.docs) {
    entries[doc.id] = doc.data() as ThemeLibraryEntry
  }
  const plan = planThemeLibraryAction({
    host: hostSnapshot.data() ?? {},
    entries,
    action,
    newId: createResourceUid,
  })
  if (plan.ok === false) return plan

  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
  const stored = (fields: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        value === THEME_FIELD_DELETE
          ? firebaseAdmin.firestore.FieldValue.delete()
          : value,
      ]),
    )

  if (Object.keys(plan.host).length || extra) {
    tx.update(hostRef, { ...stored(plan.host), ...extra, updatedAt: now })
  }
  for (const write of plan.entries) {
    const ref = library.doc(write.id)
    if (write.op === 'delete') tx.delete(ref)
    else if (write.op === 'create') {
      tx.set(ref, {
        ...(write.data as unknown as Record<string, unknown>),
        createdAt: now,
        updatedAt: now,
      })
    } else tx.update(ref, { ...stored(write.data), updatedAt: now })
  }
  return plan
}
