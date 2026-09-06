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
 * The tasks CSV — one file from the section's Export button and the bulk
 * bar's (AGL-2621).
 *
 * A task hangs off a contact, a company or a deal by id; the file names
 * each by the name the list already resolved for the row, so a spreadsheet
 * reads "Acme" and not a document id. The assignee is written by address
 * for the same reason. A due date is an INSTANT — a task due at nine is due
 * at nine in the assignee's zone — so it is written as an ISO timestamp,
 * and a spreadsheet renders it in whatever zone it is opened in.
 */

import {
  CRM_TASK_KIND_LABELS,
  type CrmTask,
  csvDocument,
} from '@aglyn/aglyn'
import { csvInstant } from './deals-csv'

/** As much of a task row as the file reads. */
export type TaskCsvRow = Partial<
  Pick<
    CrmTask,
    | 'title'
    | 'kind'
    | 'priority'
    | 'status'
    | 'dueAtMs'
    | 'completedAtMs'
    | 'assigneeUid'
    | 'contactId'
    | 'companyId'
    | 'dealId'
    | 'notes'
  >
>

export interface TaskCsvOptions {
  /** The assignee's address for a stored uid; absent, the uid is written. */
  assigneeEmail?: (uid: string) => string
  /** What a linked record is called; absent, the id is written. */
  recordName?: (kind: 'contact' | 'company' | 'deal', id: string) => string | undefined
}

export const TASK_CSV_COLUMNS = [
  'Title',
  'Kind',
  'Priority',
  'Status',
  'Due',
  'Assignee',
  'Contact',
  'Company',
  'Deal',
  'Completed',
  'Notes',
] as const

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  done: 'Done',
}

/** The whole file, header first. */
export function tasksCsv(
  rows: readonly TaskCsvRow[],
  options: TaskCsvOptions = {},
): string {
  const { assigneeEmail, recordName } = options
  const named = (kind: 'contact' | 'company' | 'deal', id: string | undefined) =>
    id ? (recordName?.(kind, id) || id) : ''
  return csvDocument(
    TASK_CSV_COLUMNS,
    rows.map((task) => [
      task.title ?? '',
      task.kind ? (CRM_TASK_KIND_LABELS[task.kind] ?? task.kind) : '',
      task.priority ? (PRIORITY_LABELS[task.priority] ?? task.priority) : '',
      task.status ? (STATUS_LABELS[task.status] ?? task.status) : '',
      csvInstant(task.dueAtMs),
      task.assigneeUid ? (assigneeEmail?.(task.assigneeUid) ?? task.assigneeUid) : '',
      named('contact', task.contactId),
      named('company', task.companyId),
      named('deal', task.dealId),
      csvInstant(task.completedAtMs),
      task.notes ?? '',
    ]),
  )
}
