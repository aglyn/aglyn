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
 * KEEPING THE CRM'S "ALL SITES EXCEPT…" GRANTS LEVEL (AGL-4047).
 *
 * A grant shared with all sites except some keeps the sites it reaches in its
 * `tokens`, and so in the record's `visibleTo`, the one list readers enforce.
 * A record's sharing is recomputed on every server write, which brings such a
 * grant level as a side effect. A record nobody touches still has to gain a
 * site the workspace adds, and lose one it erases, so a change to the
 * workspace's sites walks the records that carry one: `sharing.hasExcept`,
 * one equality query per kind of record, answering nothing in a workspace
 * that never shared this way.
 *
 * The walk is started by the core sweep's site-change hook
 * (`registerPluginScopeSharingSiteChange`), works for the few seconds the
 * person creating or deleting the site waits, and leaves the rest in
 * `orgs/{orgId}/crmSharingRuns/{runId}` for the CRM's job, which carries on
 * from the cursor. That document exists only while work is left, so the
 * job's query answers nothing on a quiet beat. No Firestore rule opens the
 * path: only this server code reads or writes it.
 *
 * Every step is idempotent: a record already level reads `unchanged` and is
 * not written.
 */

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldPath } from 'firebase-admin/firestore'
import {
  CRM_SHARING_EXCEPT_PATH,
  CRM_SHARING_OBJECTS,
  type CrmSharingObject,
  isCrmSharingObject,
} from '../model/crm-sharing'
import { crmSharingContextFor, crmSharingRulesOf, recomputeMany } from './crm-sharing'

type Firestore = FirebaseFirestore.Firestore

/** Where a walk with work left records its cursor. */
export const CRM_SHARING_RUNS_COLLECTION = 'crmSharingRuns'
/** Records read at a time. */
const PAGE_SIZE = 100
/** How long one job beat spends, across every run it takes. */
const JOB_BUDGET_MS = 20_000
/** Runs one beat reads. */
const RUNS_PER_BEAT = 10
/** Beats a failing run gets before it is dropped and reported. */
export const MAX_RUN_ATTEMPTS = 5

/** A position in {@link CRM_SHARING_OBJECTS}. */
export interface CrmSharingRunCursor {
  object: CrmSharingObject
  afterId: string | null
}

export interface CrmExceptRefreshResult {
  /** Records read. */
  read: number
  /** Records whose sharing moved. */
  changed: number
  /** Every kind of record was walked to its end. */
  complete: boolean
  cursor: CrmSharingRunCursor | null
}

const platformFirestore = () => firebaseAdmin.app().firestore() as unknown as Firestore

/**
 * Walks the records carrying an all-except grant and recomputes each, from
 * `from` until the budget runs out. Throws only on a failed query.
 */
export async function refreshCrmExceptGrants(input: {
  orgId: string
  budgetMs?: number
  from?: CrmSharingRunCursor | null
  firestore?: Firestore
}): Promise<CrmExceptRefreshResult> {
  const firestore = input.firestore ?? platformFirestore()
  const orgRef = firestore.collection('orgs').doc(input.orgId)
  const deadline = input.budgetMs == null ? null : Date.now() + input.budgetMs
  const startAt = input.from ? Math.max(0, CRM_SHARING_OBJECTS.indexOf(input.from.object)) : 0
  const result: CrmExceptRefreshResult = { read: 0, changed: 0, complete: true, cursor: null }
  let read: Awaited<ReturnType<typeof crmSharingRulesOf>> | null = null
  for (const object of CRM_SHARING_OBJECTS.slice(startAt)) {
    let afterId = input.from?.object === object ? input.from.afterId : null
    for (;;) {
      if (deadline != null && Date.now() >= deadline) {
        return { ...result, complete: false, cursor: { object, afterId } }
      }
      let query = orgRef
        .collection(object)
        .where(CRM_SHARING_EXCEPT_PATH, '==', true)
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE)
      if (afterId) query = query.startAfter(afterId)
      const page = await query.get()
      if (page.empty) break
      // The rules and the sites, read once, and only once a record turns up.
      read ??= await crmSharingRulesOf(firestore, input.orgId, { fresh: true })
      const context = {
        ...(await crmSharingContextFor(firestore, input.orgId, read.rules, object)),
        orgHostIds: read.orgHostIds,
      }
      const outcome = await recomputeMany(
        {
          firestore,
          orgId: input.orgId,
          object,
          rules: read.rules,
          fresh: true,
          context,
          atMs: Date.now(),
        },
        page.docs.map((doc) => doc.id),
      )
      result.read += page.size
      result.changed += outcome.changed.length
      afterId = page.docs[page.docs.length - 1].id
      if (page.size < PAGE_SIZE) break
    }
  }
  return result
}

/**
 * The CRM's share of a change to a workspace's sites, called by the core
 * sweep. NEVER THROWS: the site change is done. Work it could not finish is
 * left for the job.
 */
export async function crmSharingAfterSiteChange(input: {
  orgId: string
  reason: string
  hostId?: string
  budgetMs: number
  firestore?: Firestore
}): Promise<void> {
  const firestore = input.firestore ?? platformFirestore()
  const leave = (cursor: CrmSharingRunCursor | null, attempts: number) =>
    firestore
      .collection('orgs')
      .doc(input.orgId)
      .collection(CRM_SHARING_RUNS_COLLECTION)
      .doc(createResourceUid())
      .set({
        kind: 'except-grants',
        reason: input.reason,
        ...(input.hostId ? { hostId: input.hostId } : {}),
        cursor,
        attempts,
        createdAtMs: Date.now(),
      })
  try {
    const result = await refreshCrmExceptGrants({
      orgId: input.orgId,
      budgetMs: input.budgetMs,
      firestore,
    })
    if (!result.complete) await leave(result.cursor, 0)
  } catch (error) {
    console.error(`[crm] sharing grants were not brought level after ${input.reason} in ${input.orgId}`, error)
    await leave(null, 1).catch((writeError: unknown) => {
      console.error(`[crm] could not leave ${input.orgId}'s sharing run for the job`, writeError)
    })
  }
}

function readCursor(raw: unknown): CrmSharingRunCursor | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (!isCrmSharingObject(value['object'])) return null
  return {
    object: value['object'],
    afterId: typeof value['afterId'] === 'string' ? value['afterId'] : null,
  }
}

/**
 * Carries on every unfinished run: the job's handler. A run document exists
 * only while work is left, so the unfiltered query needs no index and answers
 * nothing on a quiet beat, for one read.
 */
export async function resumeCrmSharingRuns(
  options: { budgetMs?: number; firestore?: Firestore } = {},
): Promise<{ resumed: number; finished: number; droppedAfterFailing: number }> {
  const firestore = options.firestore ?? platformFirestore()
  const pending = await firestore.collectionGroup(CRM_SHARING_RUNS_COLLECTION).limit(RUNS_PER_BEAT).get()
  const tally = { resumed: 0, finished: 0, droppedAfterFailing: 0 }
  const deadline = Date.now() + (options.budgetMs ?? JOB_BUDGET_MS)
  for (const run of pending.docs) {
    const budgetMs = deadline - Date.now()
    if (budgetMs <= 0) break
    tally.resumed += 1
    const orgRef = run.ref.parent.parent
    const attempts = Number(run.get('attempts') ?? 0)
    try {
      const org = orgRef ? await orgRef.get() : null
      // The workspace was erased after this was left: nothing to bring level.
      if (!org?.exists) {
        await run.ref.delete()
        tally.finished += 1
        continue
      }
      const result = await refreshCrmExceptGrants({
        orgId: org.id,
        budgetMs,
        from: readCursor(run.get('cursor')),
        firestore,
      })
      if (!result.complete) {
        await run.ref.update({ cursor: result.cursor })
        continue
      }
      await run.ref.delete()
      tally.finished += 1
    } catch (error) {
      console.error(`[crm] ${run.ref.path} failed on attempt ${attempts + 1}`, error)
      if (attempts + 1 >= MAX_RUN_ATTEMPTS) {
        await run.ref.delete().catch(() => undefined)
        tally.droppedAfterFailing += 1
      } else {
        await run.ref.update({ attempts: attempts + 1 }).catch(() => undefined)
      }
    }
  }
  return tally
}
