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

import type {
  PluginConsoleCronContext,
  PluginConsoleCronReport,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { WAIVERS_COLLECTIONS } from '../constants/bundle-common'
import { waiverRetainUntilMs } from '../model/waiver-retention'
import type { StoredWaiverSignature } from '../model/waiver-signature'
import { waiversDb } from './db'
import { deleteSignatureFiles, siteRetentionYears, waiversBucket } from './person-eraser'

/*==========================================
 * THE RETENTION JOB (AGL-4042): deletes each signed waiver kept after its
 * signer asked to be erased, once the store's retention period has run out.
 *
 * A job rather than a Firestore TTL policy, because a signature's drawn
 * signature and paper photo are private Storage objects under the org
 * prefix, which no bucket lifecycle rule may name (`DATA_RETENTION.md`), and
 * a TTL deletes the document and leaves them behind. Here the files go
 * first and the document after, so a run cut short leaves a record that the
 * next run finds again rather than files nothing points at.
 *
 * The period is read again before anything is deleted: a store that has
 * lengthened its retention period since the request keeps the record for
 * the longer one, and the signature is stamped with its new date instead.
 *
 * One collection-group query on `retainUntilMs` per run, which only a kept
 * signature carries, so a quiet run is one read. Bounded per run and by the
 * tick's deadline; what is left over is the next tick's.
 *=========================================*/

/** The most kept signatures one run deletes. */
const PER_RUN = 100

export async function runWaiversRetentionJob(context: PluginConsoleCronContext): Promise<PluginConsoleCronReport> {
  const due = await waiversDb()
    .collectionGroup(WAIVERS_COLLECTIONS.signatures)
    .where('retainUntilMs', '<=', context.nowMs)
    .orderBy('retainUntilMs', 'asc')
    .limit(PER_RUN)
    .get()
  const bucket = waiversBucket()
  let deleted = 0
  let extended = 0
  for (const doc of due.docs) {
    if (Date.now() > context.deadlineMs) break
    const signature = doc.data() as StoredWaiverSignature
    const orgId = String(signature.orgId ?? '')
    if (!orgId || !signature.erasure) continue
    const retainUntilMs = waiverRetainUntilMs(signature, await siteRetentionYears(orgId, String(signature.hostId ?? '')))
    if (retainUntilMs > context.nowMs) {
      await doc.ref.update({ retainUntilMs })
      extended += 1
      continue
    }
    await deleteSignatureFiles(bucket, orgId, doc.id)
    await doc.ref.delete()
    deleted += 1
  }
  return { due: due.size, deleted, extended }
}
