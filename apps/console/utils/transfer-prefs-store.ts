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
  TRANSFER_PREFS_COLLECTION,
  normalizeTransferPrefs,
  type TransferPrefs,
} from '@aglyn/aglyn/data-transfer'
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore'

/**
 * Remembers a person's export choices for one resource (AGL-3525):
 * `users/{uid}/transferPrefs/{resourceKey}`, which only its owner may read
 * or write. `prefs` is merged over what is stored — a last choice without
 * presets keeps the saved presets — and the whole document is written back
 * as `normalizeTransferPrefs` reads it, so it never holds a shape the
 * dialog cannot open.
 */
export async function saveTransferPrefs(
  firestore: Firestore,
  uid: string,
  resource: string,
  prefs: Partial<TransferPrefs>,
): Promise<TransferPrefs> {
  const ref = doc(firestore, 'users', uid, TRANSFER_PREFS_COLLECTION, resource)
  const current = normalizeTransferPrefs((await getDoc(ref)).data() ?? null)
  const next = normalizeTransferPrefs({
    ...current,
    ...prefs,
    presets: prefs.presets ?? current.presets,
  })
  await setDoc(ref, next)
  return next
}
