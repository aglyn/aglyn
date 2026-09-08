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
 * The `nextTaskAtMs` a record carries, as the Admin SDK writes it (AGL-2661).
 *
 * A contact, a company and a deal each denormalize when their earliest OPEN
 * task is due, so a list can draw a "Next activity" column and answer
 * "which deals have nothing scheduled" without a task query per row. This
 * is the writer: given the records a task names, read that record's tasks
 * back and store the answer `nextTaskAtMsOf` gives. Every server-side task
 * writer — the console's task routes, the REST resource, the workflow step
 * that files a task, the merge that repoints one — calls it after its own
 * write; a client-direct task write asks the console's `crm/next-activity`
 * route, which calls it too.
 *
 * Imported by module path rather than from the `@aglyn/aglyn/server`
 * barrel, for the reason `contact-company-link.ts` gives.
 *
 * The task query is ONE equality on the link field, the query the record
 * cards already run, and the status is judged in memory — no composite
 * index, and a record with a hundred done tasks reads a hundred small
 * documents once per write against it, which is the price of never being
 * wrong. The record write is a bare `update()` of the one field, so
 * `updatedAt` stays where the person's last edit left it: a task moving is
 * not the record being edited, and the lists order by `updatedAt`.
 */

import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import {
  CRM_NEXT_ACTIVITY_FIELD,
  type CrmNextActivityLink,
  type CrmNextActivityLinkField,
  mergeNextActivityLinks,
  nextActivityLinksOfTask,
  nextTaskAtMsOf,
  readNextTaskAtMs,
} from '@aglyn/aglyn/app-utils/crm-next-activity'

/** The collection each link field's record lives in, under `orgs/{orgId}/`. */
export const CRM_NEXT_ACTIVITY_COLLECTIONS: Readonly<Record<CrmNextActivityLinkField, string>> = {
  contactId: 'contacts',
  companyId: CRM_COLLECTIONS.companies,
  dealId: CRM_COLLECTIONS.deals,
}

export interface CrmNextActivityRecompute {
  /** Records whose stored value was written (or rewritten to the same figure). */
  records: number
  /** Records that no longer exist — a task can outlive what it was filed against. */
  missing: number
}

const isNotFound = (error: unknown): boolean => {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  return (
    code === 5 ||
    code === 'not-found' ||
    code === 'NOT_FOUND' ||
    (typeof message === 'string' && message.includes('NOT_FOUND'))
  )
}

/**
 * Store one record's `nextTaskAtMs` from its tasks. `null` for a record
 * that no longer exists, else the value written.
 */
async function recomputeOne(
  orgRef: FirebaseFirestore.DocumentReference,
  field: CrmNextActivityLinkField,
  id: string,
): Promise<{ written: true; value: number | null } | { written: false }> {
  const tasks = await orgRef
    .collection(CRM_COLLECTIONS.tasks)
    .where(field, '==', id)
    .get()
  const value = nextTaskAtMsOf(
    tasks.docs.map((doc) => ({
      status: doc.get('status'),
      dueAtMs: doc.get('dueAtMs'),
    })),
  )
  try {
    await orgRef
      .collection(CRM_NEXT_ACTIVITY_COLLECTIONS[field])
      .doc(id)
      .update({ [CRM_NEXT_ACTIVITY_FIELD]: value })
  } catch (error) {
    if (isNotFound(error)) return { written: false }
    throw error
  }
  return { written: true, value }
}

/**
 * Recompute `nextTaskAtMs` for every record the links name, once each.
 *
 * Hand in BOTH sides of a change — the links a task carried before an
 * update and the ones it carries after — so a task moved from one deal to
 * another leaves neither stale. A record the task named that has since been
 * deleted is counted in `missing` and skipped; nothing here creates one.
 */
export async function recomputeCrmNextTaskAt(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  links: readonly (CrmNextActivityLink | null | undefined)[],
): Promise<CrmNextActivityRecompute> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const result: CrmNextActivityRecompute = { records: 0, missing: 0 }
  for (const { field, id } of mergeNextActivityLinks(links)) {
    const outcome = await recomputeOne(orgRef, field, id)
    if (outcome.written) result.records += 1
    else result.missing += 1
  }
  return result
}

/**
 * The same, from a task document rather than a link — what a writer holds
 * after it has read the task it is about to change or has just changed.
 */
export function crmNextActivityLinksOf(
  task: Record<string, unknown> | null | undefined,
): CrmNextActivityLink {
  return nextActivityLinksOfTask(task as Parameters<typeof nextActivityLinksOfTask>[0])
}

/** The most open tasks one org-wide recompute walks. */
export const CRM_NEXT_ACTIVITY_SWEEP_MAX = 20_000

export interface CrmNextActivitySweep {
  /** Open tasks read. */
  tasks: number
  /** Records that now carry a time. */
  scheduled: number
  /** Records that carried a time and now carry `null`. */
  cleared: number
  /** Whether the org held more open tasks than the sweep reads. */
  truncated: boolean
}

/**
 * The one-off recompute for a whole organization — the Fields section's
 * "Recompute next activity" (AGL-2661), for the records written before the
 * field existed and for whatever a client-direct write left behind.
 *
 * Two passes and no per-record task query: every OPEN task once, grouped
 * by the records it names, so each record with something scheduled is
 * written its earliest due time; then every record in the three
 * collections that CARRIES a time and was not in that group, cleared to
 * `null`. A record that was never written is left alone — every reader
 * already treats absent as `null`, and writing a null onto every contact
 * an org holds would cost a write per person to say nothing.
 *
 * The clearing pass runs only when the first pass read EVERY open task.
 * "No open task names this record" is a statement about all of them, and
 * an organization holding more than the cap has open tasks the sweep never
 * saw — clearing on a partial read would blank records that are perfectly
 * scheduled. Past the cap the sweep is the writing half alone, and
 * `truncated` says so.
 */
export async function sweepCrmNextTaskAt(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  options: { max?: number } = {},
): Promise<CrmNextActivitySweep> {
  const max = options.max ?? CRM_NEXT_ACTIVITY_SWEEP_MAX
  const orgRef = firestore.collection('orgs').doc(orgId)
  const open = await orgRef
    .collection(CRM_COLLECTIONS.tasks)
    .where('status', '==', 'open')
    .limit(max + 1)
    .get()
  const truncated = open.docs.length > max
  const docs = open.docs.slice(0, max)

  const earliest = new Map<CrmNextActivityLinkField, Map<string, number | null>>()
  for (const field of Object.keys(CRM_NEXT_ACTIVITY_COLLECTIONS) as CrmNextActivityLinkField[]) {
    earliest.set(field, new Map())
  }
  for (const doc of docs) {
    const task = { status: doc.get('status'), dueAtMs: doc.get('dueAtMs') }
    const links = nextActivityLinksOfTask({
      contactId: doc.get('contactId'),
      companyId: doc.get('companyId'),
      dealId: doc.get('dealId'),
    })
    for (const { field, id } of mergeNextActivityLinks([links])) {
      const byId = earliest.get(field) as Map<string, number | null>
      byId.set(id, nextTaskAtMsOf([task, { status: 'open', dueAtMs: byId.get(id) ?? null }]))
    }
  }

  const sweep: CrmNextActivitySweep = { tasks: docs.length, scheduled: 0, cleared: 0, truncated }
  for (const [field, byId] of earliest) {
    const records = orgRef.collection(CRM_NEXT_ACTIVITY_COLLECTIONS[field])
    for (const [id, value] of byId) {
      try {
        await records.doc(id).update({ [CRM_NEXT_ACTIVITY_FIELD]: value })
        sweep.scheduled += 1
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
    /*
     * The stale half: a record that says something is scheduled when no
     * open task names it any more. `> 0` is the one query a stored time
     * answers without an index of its own, and matches what
     * `readNextTaskAtMs` calls a usable value.
     */
    if (truncated) continue
    const carrying = await records.where(CRM_NEXT_ACTIVITY_FIELD, '>', 0).get()
    for (const doc of carrying.docs) {
      if (byId.has(doc.id)) continue
      if (readNextTaskAtMs({ nextTaskAtMs: doc.get(CRM_NEXT_ACTIVITY_FIELD) }) === null) continue
      await doc.ref.update({ [CRM_NEXT_ACTIVITY_FIELD]: null })
      sweep.cleared += 1
    }
  }
  return sweep
}
