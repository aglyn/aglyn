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

import type { CrmTask, CrmTaskKind, CrmTaskPriority } from '@aglyn/aglyn'

/**
 * The contract between the tasks console and the plugin's two task routes
 * (AGL-2599), in one module both halves import so the field a drawer sends
 * and the field a handler reads cannot drift apart.
 *
 * Route PATHS are relative to the console's plugin API prefix: the handler
 * registers `crm/task-save` and the browser calls `/api/crm/task-save`.
 */
export const CRM_TASK_ROUTES = {
  save: 'crm/task-save',
  complete: 'crm/task-complete',
} as const

/** The browser-side address of a route: `/api/` + the registered path. */
export const crmTaskRouteUrl = (
  route: (typeof CRM_TASK_ROUTES)[keyof typeof CRM_TASK_ROUTES],
): string => `/api/${route}`

/**
 * What a person may set on a task. Everything else on the document — scope,
 * provenance, status, timestamps — is the server's to stamp.
 */
export interface CrmTaskFields {
  title: string
  kind: CrmTaskKind
  priority: CrmTaskPriority
  dueAtMs: number | null
  assigneeUid: string | null
  notes: string
  contactId: string | null
  companyId: string | null
  dealId: string | null
}

/**
 * Which level a task route call runs at (AGL-2637), the way
 * `readCrmRouteScope` reads it off the body.
 *
 * `hostId` alone is the SITE variant every route has always had: the org is
 * resolved from the site, the caller's role checked on it, the task stamped
 * with the site's scope. `orgId` is the ORGANIZATION variant, authorized by
 * the org for an org-wide member; a `hostId` beside it names the site a NEW
 * task is filed from, and absent, the task is the organization's own — no
 * site, `hostId: null`, the org scope token alone.
 */
export type CrmTaskRouteScope =
  | { hostId: string; orgId?: undefined }
  | { orgId: string; hostId?: string | null }

/**
 * The scope a surface calls with, from what it holds: the mounted site, or
 * at the organization level the org the scope hook resolved. `null` until
 * the org is known, which is when a surface has nothing to call with.
 */
export function crmTaskCallScope(
  hostId: string | null | undefined,
  orgId: string | null | undefined,
): CrmTaskRouteScope | null {
  if (hostId) return { hostId }
  if (orgId) return { orgId }
  return null
}

export type CrmTaskSaveRequest = CrmTaskRouteScope & {
  /** Absent on create. */
  taskId?: string
  task: CrmTaskFields
}

export interface CrmTaskSaveResponse {
  ok: true
  taskId: string
  /** Whether the assignee was told — false when they assigned it to themselves. */
  notified: boolean
}

export type CrmTaskCompleteRequest = CrmTaskRouteScope & { taskId: string }

export interface CrmTaskCompleteResponse {
  ok: true
  completedAtMs: number
  /** The task was already done; nothing was written and no event fired. */
  alreadyDone?: boolean
}

/**
 * THE BATCH FORMS, organization level only (AGL-2637).
 *
 * The org hub's bulk bar completes or reassigns a selection in ONE request
 * per action: the same two routes, with `taskIds` (complete) or `tasks`
 * (save) in place of one `taskId`, authorized once by the org. Each task is
 * answered on its own — a refusal names the task and carries the route's
 * sentence — so a selection that reaches a task that has since been deleted
 * still completes the rest. The site hub keeps one request per task, where
 * each is authorized against the site.
 *
 * Capped at the list's own window: a selection cannot be larger than what
 * the list showed.
 */
export const CRM_TASK_BATCH_MAX = 200

export interface CrmTasksCompleteRequest {
  orgId: string
  taskIds: string[]
}

export type CrmTaskCompleteOutcome =
  | { taskId: string; ok: true; completedAtMs: number; alreadyDone?: boolean }
  | { taskId: string; ok: false; error: string }

export interface CrmTasksCompleteResponse {
  ok: true
  results: CrmTaskCompleteOutcome[]
}

export interface CrmTasksSaveRequest {
  orgId: string
  /** Updates only — a batch never creates. */
  tasks: Array<{ taskId: string; task: CrmTaskFields }>
}

export type CrmTaskSaveOutcome =
  | { taskId: string; ok: true; notified: boolean }
  | { taskId: string; ok: false; error: string }

export interface CrmTasksSaveResponse {
  ok: true
  results: CrmTaskSaveOutcome[]
}

export const CRM_TASK_TITLE_MAX = 200
export const CRM_TASK_NOTES_MAX = 4000
const RECORD_ID_MAX = 200

const KINDS: ReadonlySet<string> = new Set(['call', 'email', 'meeting', 'todo'])
const PRIORITIES: ReadonlySet<string> = new Set(['low', 'normal', 'high'])

/**
 * A typed record id, or `null` for anything that is not one.
 *
 * A Firestore id is opaque but bounded, and it never contains a slash — a
 * slash would make it a path. Refusing here rather than storing keeps a
 * malformed link from becoming a `where` clause nothing can match.
 */
function recordId(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text || text.length > RECORD_ID_MAX || text.includes('/')) return null
  return text
}

/**
 * The request body as a task, or the reason it is not one.
 *
 * Coerces where a person could not have meant anything else (whitespace
 * around a title, a due date sent as a string of digits) and refuses where a
 * guess would store something the list cannot show (an unknown kind, a title
 * that is nothing but spaces). The refusal is a sentence because the drawer
 * puts it in front of the person who typed the value.
 */
export function readCrmTaskFields(
  input: unknown,
): { ok: true; fields: CrmTaskFields } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>
  const title = String(raw['title'] ?? '').trim()
  if (!title) return { ok: false, error: 'A task needs a title.' }
  if (title.length > CRM_TASK_TITLE_MAX) {
    return {
      ok: false,
      error: `A title is at most ${CRM_TASK_TITLE_MAX} characters.`,
    }
  }
  const kind = String(raw['kind'] ?? 'todo')
  if (!KINDS.has(kind)) {
    return { ok: false, error: `"${kind}" is not a kind of task.` }
  }
  const priority = String(raw['priority'] ?? 'normal')
  if (!PRIORITIES.has(priority)) {
    return { ok: false, error: `"${priority}" is not a priority.` }
  }
  const dueRaw = raw['dueAtMs']
  let dueAtMs: number | null = null
  if (dueRaw !== null && dueRaw !== undefined && dueRaw !== '') {
    const ms = Number(dueRaw)
    if (!Number.isFinite(ms) || ms <= 0) {
      return { ok: false, error: 'The due date could not be read.' }
    }
    dueAtMs = Math.round(ms)
  }
  const assigneeRaw = String(raw['assigneeUid'] ?? '').trim()
  const notes = String(raw['notes'] ?? '').slice(0, CRM_TASK_NOTES_MAX)
  const ids = {
    contactId: raw['contactId'] == null || raw['contactId'] === ''
      ? null
      : recordId(raw['contactId']),
    companyId: raw['companyId'] == null || raw['companyId'] === ''
      ? null
      : recordId(raw['companyId']),
    dealId: raw['dealId'] == null || raw['dealId'] === ''
      ? null
      : recordId(raw['dealId']),
  }
  for (const [field, value] of Object.entries(ids)) {
    if (value === null && raw[field] != null && raw[field] !== '') {
      return { ok: false, error: `The linked ${field.replace('Id', '')} could not be read.` }
    }
  }
  return {
    ok: true,
    fields: {
      title,
      kind: kind as CrmTaskKind,
      priority: priority as CrmTaskPriority,
      dueAtMs,
      assigneeUid: assigneeRaw || null,
      notes,
      ...ids,
    },
  }
}

/**
 * The stored document's editable half, as the drawer's form reads it.
 *
 * The inverse of what the save route writes, so opening a task and saving it
 * untouched is a no-op on every field the form owns.
 */
export function crmTaskFieldsOf(task: Partial<CrmTask>): CrmTaskFields {
  return {
    title: task.title ?? '',
    kind: task.kind ?? 'todo',
    priority: task.priority ?? 'normal',
    dueAtMs: typeof task.dueAtMs === 'number' ? task.dueAtMs : null,
    assigneeUid: task.assigneeUid || null,
    notes: task.notes ?? '',
    contactId: task.contactId || null,
    companyId: task.companyId || null,
    dealId: task.dealId || null,
  }
}
