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
 * BRINGING A SPREADSHEET OF TASKS INTO THE CRM — the pure half (AGL-2662).
 *
 * The contact import's three stages (`crm-import.ts`) over the task
 * vocabulary. A task is the simplest CRM record — a title, what kind of
 * thing it is, how urgent, when it is due, whose it is — and the file
 * carries exactly that.
 *
 * ## The assignee is resolved by address, and a stranger refuses the row
 *
 * A contact or a company whose owner address matches nobody is filed
 * without an owner and the address is named at the end, because the
 * record is worth having either way. A task is different: a task nobody
 * holds is a task nobody does, and a file that names an assignee meant
 * that person. So an address that matches no member of the organization
 * refuses the ROW as `unknown-assignee`, and the operator fixes the sheet.
 * A row with no assignee cell is filed unassigned, which is a choice.
 *
 * ## A task has no key, so nothing is merged
 *
 * Every row CREATES; importing a file twice files it twice. An imported
 * task does not notify its assignee: forty notifications for a spreadsheet
 * is noise, and the drawer's assignment notice is for one task at a time.
 *
 * ## A bad cell is dropped and named; a bad row is skipped and named
 *
 * A kind or a priority the CRM does not have falls back to the drawer's
 * own defaults (`todo`, `normal`) and is REPORTED under
 * {@link TaskImportRow.dropped}; a due date that is not a date is dropped
 * the same way; a status other than open or done reads as open.
 */

import { normalizeContactEmail } from './contacts'
import { parseImportDate } from './crm-deal-import'
import {
  CRM_TASK_KIND_LABELS,
  type CrmTaskKind,
  type CrmTaskPriority,
  type CrmTaskStatus,
  isCrmTaskKind,
} from './crm'
import {
  CSV_IMPORT_CHUNK_SIZE,
  CSV_IMPORT_MAX_BODY_BYTES,
  CSV_IMPORT_MAX_ROWS,
  CSV_IMPORT_PREVIEW_ROWS,
  emptyImportResult,
  guessImportMapping,
  importAliasKeys,
  type ImportChunkResult,
  type ImportDroppedValue,
  importSkippedCsv,
  importTextValue,
  mapImportRow,
  mergeImportResults,
} from './csv-import'

/** The shared ceilings, under this collection's names. */
export const TASK_IMPORT_MAX_ROWS = CSV_IMPORT_MAX_ROWS
export const TASK_IMPORT_CHUNK_SIZE = CSV_IMPORT_CHUNK_SIZE
export const TASK_IMPORT_MAX_BODY_BYTES = CSV_IMPORT_MAX_BODY_BYTES
export const TASK_IMPORT_PREVIEW_ROWS = CSV_IMPORT_PREVIEW_ROWS

/** The same caps the task drawer holds a typed task to. */
export const TASK_IMPORT_TITLE_MAX = 200
export const TASK_IMPORT_NOTES_MAX = 4000

/** The fields a column may be mapped to, in the order the mapping menu lists them. */
export const TASK_IMPORT_FIELDS = [
  'title',
  'kind',
  'priority',
  'status',
  'due',
  'assigneeEmail',
  'notes',
] as const

export type TaskImportField = (typeof TASK_IMPORT_FIELDS)[number]

/** How each field reads in the mapping menu. Typed so a field cannot ship unlabeled. */
export const TASK_IMPORT_FIELD_LABELS: Record<TaskImportField, string> = {
  title: 'Title (required)',
  kind: 'Kind (call, email, meeting, to-do)',
  priority: 'Priority (low, normal, high)',
  status: 'Status (open or done)',
  due: 'Due (date or timestamp)',
  assigneeEmail: 'Assignee (team member email)',
  notes: 'Notes',
}

/**
 * Header aliases per field, matched after the shared header normalization.
 *
 * First in each list is the header this CRM's own tasks export writes, so
 * an export re-imports without a hand mapping; the export's Contact,
 * Company, Deal and Completed columns are deliberately absent, because a
 * link is made on the record, not from a file, and the completion is
 * stamped by the import when the status says done.
 */
const FIELD_ALIASES: Record<TaskImportField, readonly string[]> = {
  title: ['title', 'task', 'task title', 'task name', 'name', 'subject', 'summary'],
  kind: ['kind', 'type', 'task type', 'activity type'],
  priority: ['priority', 'importance', 'urgency'],
  status: ['status', 'state', 'done', 'completed'],
  due: ['due', 'due date', 'due at', 'deadline', 'due on'],
  assigneeEmail: ['assignee', 'assignee email', 'assigned to', 'owner', 'owner email', 'rep'],
  notes: ['notes', 'note', 'description', 'comments', 'details'],
}

const FIELD_ALIAS_KEYS = importAliasKeys(TASK_IMPORT_FIELDS, FIELD_ALIASES)

/** Column index → field. A column absent from the map is not imported. */
export type TaskImportMapping = Record<number, TaskImportField>

/** A proposed mapping from a file's header row, each field taken at most once. */
export function guessTaskImportMapping(columns: readonly string[]): TaskImportMapping {
  return guessImportMapping(columns, TASK_IMPORT_FIELDS, FIELD_ALIAS_KEYS)
}

/**
 * What the browser posts for one line: the cells the mapping selected,
 * under the field they were mapped to, verbatim. `unknown` because the
 * server reads this off an untrusted body.
 */
export type TaskImportRawRow = Partial<Record<TaskImportField, unknown>>

/** One parsed line under the mapping. Empty cells are left absent; a task has no custom fields. */
export function mapTaskImportRow(
  cells: readonly string[],
  mapping: Record<number, TaskImportField | `custom:${string}`>,
): TaskImportRawRow {
  const { custom: _custom, ...row } = mapImportRow(cells, mapping)
  return row
}

export type TaskImportSkipReason =
  | 'missing-title'
  | 'unknown-assignee'
  | 'write-failed'

/** How a skip reason reads on screen and in the downloaded file. */
export const TASK_IMPORT_SKIP_LABELS: Record<TaskImportSkipReason, string> = {
  'missing-title': 'No title',
  'unknown-assignee': 'No team member has that assignee address',
  'write-failed': 'Could not be saved',
}

/** One row, ready for the server to resolve and write. */
export interface TaskImportRow {
  title: string
  kind: CrmTaskKind
  priority: CrmTaskPriority
  status: CrmTaskStatus
  /** Epoch ms, or `null` for no due date — the shape the document stores. */
  dueAtMs: number | null
  /** Normalized, for the server to resolve against the org's members. */
  assigneeEmail?: string
  notes?: string
  dropped: ImportDroppedValue[]
}

export type TaskImportRowVerdict =
  | { ok: true; row: TaskImportRow }
  | { ok: false; reason: 'missing-title'; input: string }

/** A kind cell by id or by label — `todo`, `To-do`, `to do` are one kind. */
export function parseImportTaskKind(value: unknown): CrmTaskKind | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null
  if (isCrmTaskKind(text)) return text
  const bare = text.replace(/[\s-]+/g, '')
  for (const [kind, label] of Object.entries(CRM_TASK_KIND_LABELS)) {
    if (label.toLowerCase().replace(/[\s-]+/g, '') === bare) return kind as CrmTaskKind
  }
  return null
}

const PRIORITIES: Record<string, CrmTaskPriority> = {
  low: 'low',
  normal: 'normal',
  medium: 'normal',
  high: 'high',
  urgent: 'high',
}

/** A priority cell as one of the three, `medium` and `urgent` folded in. */
export function parseImportTaskPriority(value: unknown): CrmTaskPriority | null {
  return PRIORITIES[String(value ?? '').trim().toLowerCase()] ?? null
}

/** A status cell as open or done — `done`, `complete`, `yes`, `true` all close it. */
export function parseImportTaskStatus(value: unknown): CrmTaskStatus | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null
  if (['done', 'complete', 'completed', 'closed', 'yes', 'y', 'true', '1'].includes(text)) {
    return 'done'
  }
  if (['open', 'todo', 'to do', 'pending', 'no', 'n', 'false', '0', 'incomplete'].includes(text)) {
    return 'open'
  }
  return null
}

/**
 * One raw row as the values that will be written, or the reason it cannot
 * be. Refused here only for a missing title; the assignee is refused by
 * the server, which alone can look them up.
 */
export function normalizeTaskImportRow(raw: TaskImportRawRow): TaskImportRowVerdict {
  const title = importTextValue(raw.title, TASK_IMPORT_TITLE_MAX)?.replace(/\s+/g, ' ')
  if (!title) {
    return { ok: false, reason: 'missing-title', input: '' }
  }
  const dropped: ImportDroppedValue[] = []
  const drop = (field: TaskImportField, value: unknown) => {
    dropped.push({ field, value: String(value ?? '').trim() })
  }
  const row: TaskImportRow = {
    title,
    kind: 'todo',
    priority: 'normal',
    status: 'open',
    dueAtMs: null,
    dropped,
  }

  const kindText = importTextValue(raw.kind, 32)
  if (kindText) {
    const kind = parseImportTaskKind(kindText)
    if (kind) row.kind = kind
    else drop('kind', kindText)
  }

  const priorityText = importTextValue(raw.priority, 32)
  if (priorityText) {
    const priority = parseImportTaskPriority(priorityText)
    if (priority) row.priority = priority
    else drop('priority', priorityText)
  }

  const statusText = importTextValue(raw.status, 32)
  if (statusText) {
    const status = parseImportTaskStatus(statusText)
    if (status) row.status = status
    else drop('status', statusText)
  }

  const dueText = importTextValue(raw.due, 64)
  if (dueText) {
    const ms = parseImportDate(dueText)
    if (ms !== null) row.dueAtMs = ms
    else drop('due', dueText)
  }

  const assigneeText = importTextValue(raw.assigneeEmail, 320)
  if (assigneeText) {
    const assignee = normalizeContactEmail(assigneeText)
    if (assignee) row.assigneeEmail = assignee
    else drop('assigneeEmail', assigneeText)
  }

  const notes = importTextValue(raw.notes, TASK_IMPORT_NOTES_MAX)
  if (notes) row.notes = notes

  return { ok: true, row }
}

/** One row the server did not store, by its index in the request, named by the task. */
export interface TaskImportSkippedRow {
  index: number
  title: string
  reason: TaskImportSkipReason
}

/** What one request did. The drawer sums these across a file. */
export type TaskImportChunkResult = ImportChunkResult<TaskImportSkippedRow>

export function emptyTaskImportResult(): TaskImportChunkResult {
  return emptyImportResult<TaskImportSkippedRow>()
}

export function mergeTaskImportResults(
  total: TaskImportChunkResult,
  chunk: TaskImportChunkResult,
  offset = 0,
): TaskImportChunkResult {
  return mergeImportResults(total, chunk, offset)
}

/** The skipped rows as a file the operator can fix and re-import. */
export function taskImportSkippedCsv(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: TaskImportSkipReason }[],
): string {
  return importSkippedCsv(columns, entries, TASK_IMPORT_SKIP_LABELS)
}
