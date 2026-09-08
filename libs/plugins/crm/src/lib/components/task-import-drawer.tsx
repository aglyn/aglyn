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
'use client'

/**
 * IMPORTING A TASKS FILE — the task vocabulary over the shared drawer
 * (AGL-2662).
 *
 * The server half is `server/tasks-import.ts`. What is particular to
 * tasks: the title is the one cell every row needs, an assignee address
 * that names nobody on the team refuses the ROW rather than filing the
 * task unassigned, no notification is sent, and nothing is merged — a
 * task has no key, so every row is a new task.
 */

import {
  TASK_IMPORT_CHUNK_SIZE,
  TASK_IMPORT_FIELD_LABELS,
  TASK_IMPORT_FIELDS,
  TASK_IMPORT_MAX_ROWS,
  TASK_IMPORT_PREVIEW_ROWS,
  TASK_IMPORT_SKIP_LABELS,
  type TaskImportField,
  type TaskImportRawRow,
  type TaskImportSkippedRow,
  emptyTaskImportResult,
  guessTaskImportMapping,
  mapTaskImportRow,
  mergeTaskImportResults,
  pluginDocsHelp,
  taskImportSkippedCsv,
} from '@aglyn/aglyn'
import { tasksCsv } from '../model/tasks-csv'
import {
  CsvImportButton,
  CsvImportDrawer,
  type CsvImportVocabulary,
} from './csv-import-drawer'

/** The browser-side address of the route one chunk is posted to. */
export const TASKS_IMPORT_URL = '/api/crm/tasks-import'

/** Built once: nothing in it depends on a render. */
export const TASK_IMPORT_VOCABULARY: CsvImportVocabulary<
  TaskImportField,
  TaskImportRawRow & Record<string, unknown>,
  TaskImportSkippedRow
> = {
  title: 'Import tasks from CSV',
  help: pluginDocsHelp('crmTasks', { anchor: '#import-from-csv' }),
  sitePickerHelperText:
    'The site these tasks are filed from — it decides which of your sites ' +
    'may see them.',
  intro:
    'A CSV with a header row. Match its columns to task fields below, check ' +
    'the preview, then import. An assignee is a team member’s email address; ' +
    'a row naming somebody who is not on the team is skipped. Nobody is ' +
    'notified. Every row becomes a new task — importing a file twice files ' +
    `it twice. Up to ${TASK_IMPORT_MAX_ROWS.toLocaleString()} rows per file ` +
    '— split a larger one.',
  fields: TASK_IMPORT_FIELDS,
  fieldLabels: TASK_IMPORT_FIELD_LABELS,
  requiredField: 'title',
  requiredWarning:
    'Choose which column holds the task title. It is the one field every ' +
    'row needs.',
  unusableNotice: (count, total) =>
    `${count.toLocaleString()} of ${total.toLocaleString()} rows have no ` +
    'title and will be skipped. You can download them after the import.',
  guessMapping: guessTaskImportMapping,
  mapRow: (cells, mapping) =>
    mapTaskImportRow(cells, mapping) as TaskImportRawRow & Record<string, unknown>,
  route: TASKS_IMPORT_URL,
  maxRows: TASK_IMPORT_MAX_ROWS,
  chunkSize: TASK_IMPORT_CHUNK_SIZE,
  previewRows: TASK_IMPORT_PREVIEW_ROWS,
  emptyResult: emptyTaskImportResult,
  mergeResults: mergeTaskImportResults,
  skipLabels: TASK_IMPORT_SKIP_LABELS,
  skippedCsv: taskImportSkippedCsv,
  skippedFileName: 'skipped-tasks.csv',
  // The export's own header over no rows, so an export re-imports as is.
  templateCsv: () => tasksCsv([]),
  templateFileName: 'tasks-template.csv',
}

export interface TaskImportDrawerProps {
  open: boolean
  onClose: () => void
  /** The site the file is filed from, or `null` at the organization level. */
  hostId: string | null
}

export function TaskImportDrawer(props: TaskImportDrawerProps) {
  const { open, onClose, hostId } = props
  return (
    <CsvImportDrawer
      open={open}
      onClose={onClose}
      hostId={hostId}
      vocabulary={TASK_IMPORT_VOCABULARY}
    />
  )
}
TaskImportDrawer.displayName = 'TaskImportDrawer'

/** The "Import CSV" action on the tasks list, with the drawer it opens. */
export function TaskImportButton(props: { hostId: string | null }) {
  const { hostId } = props
  return (
    <CsvImportButton>
      {(open, onClose) => <TaskImportDrawer open={open} onClose={onClose} hostId={hostId} />}
    </CsvImportButton>
  )
}
TaskImportButton.displayName = 'TaskImportButton'

export default TaskImportDrawer
