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
 * `POST /api/crm/tasks-import` — one chunk of a tasks file, written
 * (AGL-2662).
 *
 * The browser has already read the file and applied the operator's column
 * mapping; what arrives here is up to {@link TASK_IMPORT_CHUNK_SIZE} raw
 * rows in the vocabulary `crm-task-import.ts` defines. This route judges
 * each one through the same normalizer, resolves the assignee against the
 * org's roster, and writes the document in the shape the task-save route
 * writes — the optional ids absent rather than null, `dueAtMs` null when
 * unset so the ordered views keep the row.
 *
 * ## A stranger refuses the row
 *
 * The task-save route refuses an assignee who is not a member, because a
 * notification to a stranger's inbox is the one thing it must never do.
 * The import refuses the same way, per row, as `unknown-assignee`: the
 * roster is read once for the request, and an address it does not hold
 * sends the row back to the operator's skipped file. No notification is
 * sent for an imported task, so nothing here reaches an inbox at all.
 *
 * ## Every task is the site's
 *
 * The shared drawer names a site even at the organization level, so an
 * imported task carries that site's scope the way a task typed under it
 * does. The organization's own tasks — no site — are filed one at a time
 * from the organization hub, not from a file.
 *
 * Tasks are not CRM records for the band: no quota is asked.
 */

import {
  CRM_COLLECTIONS,
  type PluginApiHandler,
  TASK_IMPORT_CHUNK_SIZE,
  TASK_IMPORT_MAX_BODY_BYTES,
  type TaskImportChunkResult,
  type TaskImportRawRow,
  type TaskImportRow,
  type TaskImportSkippedRow,
  normalizeTaskImportRow,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { ownerDirectory, readImportRows, resolveImportContext } from './import-context'

/**
 * `POST crm/tasks-import` — `{ hostId, rows }` → a {@link TaskImportChunkResult}.
 *
 * The writes are batched: a task has no key to collide on and no count to
 * keep honest between rows, so a chunk is one commit.
 */
export const crmTasksImportHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const read = readImportRows<TaskImportRawRow>(req, {
    maxBodyBytes: TASK_IMPORT_MAX_BODY_BYTES,
    chunkSize: TASK_IMPORT_CHUNK_SIZE,
  })
  if ('error' in read) return res.status(read.status).json({ error: read.error })
  try {
    const context = await resolveImportContext(req)
    if (context.ok === false) return res.status(context.status).json(context.body)

    const skipped: TaskImportSkippedRow[] = []
    const dropped: Record<string, number> = {}
    const normalized: { index: number; row: TaskImportRow }[] = []
    read.rows.forEach((raw, index) => {
      const verdict = normalizeTaskImportRow(raw)
      if (verdict.ok === false) {
        skipped.push({ index, title: verdict.input, reason: verdict.reason })
        return
      }
      for (const entry of verdict.row.dropped) {
        dropped[entry.field] = (dropped[entry.field] ?? 0) + 1
      }
      normalized.push({ index, row: verdict.row })
    })

    // The roster reader keys on `ownerEmail`; a task's word for it is assignee.
    const members = await ownerDirectory(
      context.orgId,
      normalized.map((entry) => ({ ownerEmail: entry.row.assigneeEmail })),
    )
    const firestore = firebaseAdmin.app().firestore()
    const tasks = firestore
      .collection('orgs')
      .doc(context.orgId)
      .collection(CRM_COLLECTIONS.tasks)
    const batch = firestore.batch()
    const nowMs = Date.now()
    let created = 0

    for (const { index, row } of normalized) {
      let assigneeUid: string | undefined
      if (row.assigneeEmail) {
        assigneeUid = members.get(row.assigneeEmail)
        if (!assigneeUid) {
          skipped.push({ index, title: row.title, reason: 'unknown-assignee' })
          continue
        }
      }
      batch.set(tasks.doc(), {
        title: row.title,
        kind: row.kind,
        priority: row.priority,
        status: row.status,
        dueAtMs: row.dueAtMs,
        notes: row.notes ?? '',
        completedAtMs: row.status === 'done' ? nowMs : null,
        ...(row.status === 'done' ? { completedByUid: context.uid } : {}),
        ...(assigneeUid ? { assigneeUid } : {}),
        visibleTo: context.scopeTokens,
        hostId: context.hostId,
        createdByUid: context.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      created += 1
    }
    if (created) await batch.commit()

    const result: TaskImportChunkResult = {
      received: read.rows.length,
      created,
      merged: 0,
      skipped: skipped.sort((a, b) => a.index - b.index),
      dropped,
      ownersUnresolved: [],
    }
    return res.status(200).json(result)
  } catch (error) {
    console.error('crm/tasks-import failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}
