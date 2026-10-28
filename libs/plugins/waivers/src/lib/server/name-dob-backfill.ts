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

import { WAIVERS_COLLECTIONS } from '../constants/bundle-common'
import { waiverNameDobKeys, waiverNameDobKeysCurrent } from '../model/waiver-match'

/*==========================================
 * STAMPING `nameDobKeys` ON SIGNATURES TAKEN BEFORE IT (AGL-4042), for
 * `tools/scripts/backfill-waiver-name-dob-keys.mts`. Kept here, beside the
 * rule that writes the keys at signing, so the script and its spec run the
 * same code.
 *
 * It writes that one field and nothing else: no signer, store or console
 * sees a change, only check-in's name-and-birth-date match starts finding
 * the signature. Dry run unless `commit`. Each write carries a precondition
 * on the document it was judged from, so one changed in between is skipped
 * and a re-run picks it up.
 *=========================================*/

export interface NameDobBackfillOptions {
  /** Only this workspace's signatures; every workspace's when absent. */
  orgId?: string
  /** Writes when true; reads and counts only when false. */
  commit: boolean
  pageSize?: number
  warn?: (line: string) => void
}

export interface NameDobBackfillCounts {
  read: number
  /** Already carrying the keys their people give. */
  current: number
  /** Missing or stale keys: what a commit stamps. */
  toStamp: number
  stamped: number
  skipped: number
}

type Firestore = FirebaseFirestore.Firestore

export async function backfillWaiverNameDobKeys(
  firestore: Firestore,
  options: NameDobBackfillOptions,
): Promise<NameDobBackfillCounts> {
  const counts: NameDobBackfillCounts = { read: 0, current: 0, toStamp: 0, stamped: 0, skipped: 0 }
  const pageSize = options.pageSize ?? 300
  const base: FirebaseFirestore.Query = options.orgId
    ? firestore.collection('orgs').doc(options.orgId).collection(WAIVERS_COLLECTIONS.signatures)
    : firestore.collectionGroup(WAIVERS_COLLECTIONS.signatures)
  let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    const page: FirebaseFirestore.QuerySnapshot = await (after
      ? base.limit(pageSize).startAfter(after)
      : base.limit(pageSize)
    ).get()
    for (const doc of page.docs) {
      counts.read += 1
      const signature = doc.data() as Parameters<typeof waiverNameDobKeysCurrent>[0]
      if (waiverNameDobKeysCurrent(signature)) {
        counts.current += 1
        continue
      }
      counts.toStamp += 1
      if (!options.commit) continue
      try {
        await doc.ref.update({ nameDobKeys: waiverNameDobKeys(signature) }, { lastUpdateTime: doc.updateTime })
        counts.stamped += 1
      } catch (error) {
        options.warn?.(`  skip  ${doc.ref.path} (changed since it was read: ${String((error as Error)?.message).slice(0, 80)})`)
        counts.skipped += 1
      }
    }
    if (page.docs.length < pageSize) break
    after = page.docs[page.docs.length - 1]
  }
  return counts
}
