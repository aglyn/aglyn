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
  CRM_TASK_PICKLIST_IDS,
  type CrmPicklist,
  type CrmPicklistId,
  crmPicklistLabelForNew,
  type CrmTask,
  type CrmTaskKind,
  type CrmTaskPicklists,
  type CrmTaskPriority,
  type CrmTaskStatus,
  resolveCrmSemanticPicklistWrite,
} from '@aglyn/aglyn/app-utils/crm'

/** What a task write stores for its type, priority and status. */
export interface CrmTaskPicklistWrite {
  kind: CrmTaskKind
  priority: CrmTaskPriority
  typeLabel: string | null
  priorityLabel: string | null
  statusLabel: string | null
}

/** What a writer asked for: a meaning, a label beside it, or both. */
export interface CrmTaskPicklistRequest {
  kind: CrmTaskKind
  priority: CrmTaskPriority
  typeLabel?: string | null
  priorityLabel?: string | null
  statusLabel?: string | null
}

/** The stored task an edit starts from, or `null` for a new one. */
export type CrmTaskPicklistExisting = Partial<
  Pick<CrmTask, 'kind' | 'priority' | 'status' | 'typeLabel' | 'priorityLabel' | 'statusLabel'>
> | null

/**
 * One semantic field: a label wins and carries its value's meaning; with
 * none, the task keeps its own label while it still means `meaning`, and
 * otherwise takes the label a new task of that meaning starts with.
 */
function resolveOne(
  id: CrmPicklistId,
  picklist: CrmPicklist,
  meaning: string,
  label: string | null | undefined,
  held: { meaning?: string; label?: string | null } | null,
): { ok: true; meaning: string; label: string | null } | { ok: false; error: string } {
  if (label) {
    const resolved = resolveCrmSemanticPicklistWrite(id, picklist, label, held?.label)
    if (resolved) return resolved
  }
  if (held?.label && held.meaning === meaning) return { ok: true, meaning, label: held.label }
  return { ok: true, meaning, label: crmPicklistLabelForNew(picklist, meaning) }
}

/**
 * The type, priority and status labels a save stores (AGL-3517), against
 * the org's lists — or the sentence it is refused with.
 *
 * Type and priority follow the label when one is named. Status does not
 * move: a save may relabel an open task with another open value ("In
 * Progress") or a done one with another done value, but the tick is what
 * completes a task — it fires the workflow event — so a label of the other
 * meaning is refused rather than taken as a completion.
 */
export function resolveCrmTaskPicklistWrite(
  picklists: CrmTaskPicklists,
  request: CrmTaskPicklistRequest,
  existing: CrmTaskPicklistExisting,
): { ok: true; write: CrmTaskPicklistWrite } | { ok: false; error: string } {
  const type = resolveOne(
    CRM_TASK_PICKLIST_IDS.type,
    picklists.type,
    request.kind,
    request.typeLabel,
    existing ? { meaning: existing.kind, label: existing.typeLabel } : null,
  )
  if (type.ok === false) return type
  const priority = resolveOne(
    CRM_TASK_PICKLIST_IDS.priority,
    picklists.priority,
    request.priority,
    request.priorityLabel,
    existing ? { meaning: existing.priority, label: existing.priorityLabel } : null,
  )
  if (priority.ok === false) return priority
  const status: CrmTaskStatus = existing?.status === 'done' ? 'done' : 'open'
  const statusLabel = resolveOne(
    CRM_TASK_PICKLIST_IDS.status,
    picklists.status,
    status,
    request.statusLabel,
    existing ? { meaning: existing.status, label: existing.statusLabel } : { meaning: 'open' },
  )
  if (statusLabel.ok === false) return statusLabel
  if (statusLabel.meaning !== status) {
    return {
      ok: false,
      error:
        status === 'open'
          ? `“${statusLabel.label}” completes a task. Tick the task done instead.`
          : `“${statusLabel.label}” is an open status. Reopen the task instead.`,
    }
  }
  return {
    ok: true,
    write: {
      kind: type.meaning as CrmTaskKind,
      priority: priority.meaning as CrmTaskPriority,
      typeLabel: type.label,
      priorityLabel: priority.label,
      statusLabel: statusLabel.label,
    },
  }
}
