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
import { waiverRetentionStamp, waiverRetentionStampMoved } from '../model/waiver-retention'
import type { StoredWaiverSignature } from '../model/waiver-signature'
import { waiversDb, waiversRefs } from './db'
import { deleteSignatureFiles, waiversBucket } from './person-eraser'
import { siteRetentionYears, type WaiverRetentionState } from './retention'

/*==========================================
 * THE RETENTION JOB (AGL-4042): keeps every signed waiver for its store's
 * retention period, then deletes it.
 *
 * Two steps each tick, the console's fifteen minutes:
 *
 * 1. A PERIOD THE STORE CHANGED. Each site with signatures has a retention
 *    state (`retention.ts`) naming the period its signatures are stamped
 *    with. Once an hour per site the job reads the period the store set; when
 *    it differs, it stamps the site's signatures again, a page at a time,
 *    carrying on next tick from where it stopped if it runs out of time, and
 *    then records the new period. A shorter period brings deletions nearer,
 *    and step 2 takes them.
 * 2. DELETIONS DUE. Every signature whose `retainUntilMs` has passed, oldest
 *    first: its private Storage objects first and the document after, so a
 *    run cut short leaves a record the next run finds again rather than files
 *    nothing points at. The period is read again before anything is deleted,
 *    so a store that lengthened it since keeps the record, stamped with its
 *    new date.
 *
 * A job rather than a Firestore TTL policy, because a signature's drawn
 * signature and paper photo are private Storage objects under the org
 * prefix, which no bucket lifecycle rule may name (`DATA_RETENTION.md`), and
 * a TTL deletes the document and leaves them behind. Bounded per run and by
 * the tick's deadline; what is left over is the next tick's.
 *=========================================*/

/** The most signatures one run deletes. */
const PER_RUN = 100

/** How often each site's period is compared with the store's setting. */
export const RETENTION_RECHECK_MS = 60 * 60 * 1000

/** The most sites one run compares. */
const SITES_PER_RUN = 50

/** Signatures stamped again per page of a re-stamp. */
const RESTAMP_PAGE = 200

/**
 * Compares sites' periods with the stores' settings and stamps the
 * signatures of each site whose period moved. Answers how many sites it
 * looked at and how many signatures it stamped again.
 */
async function reconcileChangedPeriods(context: PluginConsoleCronContext): Promise<{ sites: number; restamped: number }> {
  const states = await waiversDb()
    .collectionGroup(WAIVERS_COLLECTIONS.retention)
    .where('checkedAtMs', '<=', context.nowMs - RETENTION_RECHECK_MS)
    .orderBy('checkedAtMs', 'asc')
    .limit(SITES_PER_RUN)
    .get()
  let restamped = 0
  for (const doc of states.docs) {
    if (Date.now() > context.deadlineMs) break
    const state = doc.data() as WaiverRetentionState
    const orgId = String(state.orgId ?? '')
    const hostId = String(state.hostId ?? doc.id)
    if (!orgId || !hostId) continue
    const years = await siteRetentionYears(orgId, hostId)
    if (state.years === years && !state.restamp) {
      await doc.ref.update({ checkedAtMs: context.nowMs })
      continue
    }
    // Carry on a re-stamp left half done, unless the period moved again.
    let after = state.restamp?.years === years ? state.restamp.afterId : null
    let finished = false
    while (Date.now() <= context.deadlineMs) {
      let page = waiversRefs
        .signatures(orgId)
        .where('hostId', '==', hostId)
        .orderBy('signedAtMs', 'desc')
        .limit(RESTAMP_PAGE)
      if (after) {
        const cursor = await waiversRefs.signature(orgId, after).get()
        // The signature it stopped at is gone: start again, which stamps nothing twice.
        if (cursor.exists) page = page.startAfter(cursor)
      }
      const found = await page.get()
      const batch = waiversDb().batch()
      let writes = 0
      for (const signatureDoc of found.docs) {
        const signature = signatureDoc.data() as StoredWaiverSignature
        const stamp = waiverRetentionStamp(signature, years)
        if (!waiverRetentionStampMoved(signature, stamp)) continue
        batch.update(signatureDoc.ref, { ...stamp })
        writes += 1
      }
      if (writes) await batch.commit()
      restamped += writes
      if (found.size < RESTAMP_PAGE) {
        finished = true
        break
      }
      after = found.docs[found.docs.length - 1].id
    }
    await doc.ref.update(
      finished
        ? { years, checkedAtMs: context.nowMs, restamp: null }
        : { restamp: { years, afterId: after } },
    )
  }
  return { sites: states.size, restamped }
}

export async function runWaiversRetentionJob(context: PluginConsoleCronContext): Promise<PluginConsoleCronReport> {
  const { sites, restamped } = await reconcileChangedPeriods(context)
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
    if (!orgId) continue
    const stamp = waiverRetentionStamp(signature, await siteRetentionYears(orgId, String(signature.hostId ?? '')))
    if (stamp.retainUntilMs > context.nowMs) {
      await doc.ref.update({ ...stamp })
      extended += 1
      continue
    }
    await deleteSignatureFiles(bucket, orgId, doc.id)
    await doc.ref.delete()
    deleted += 1
  }
  return { sites, restamped, due: due.size, deleted, extended }
}
