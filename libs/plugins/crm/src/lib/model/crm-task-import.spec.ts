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
 * The task-file normalizer (AGL-2662).
 *
 * What is pinned by name: a row is refused here ONLY for a missing title;
 * a kind, a priority, a status or a due date that cannot be read falls to
 * the drawer's default and is reported; the assignee travels as a
 * normalized address for the server to refuse or resolve; and the tasks
 * export's own header maps itself, its link columns left alone.
 */

import {
  TASK_IMPORT_FIELD_LABELS,
  TASK_IMPORT_FIELDS,
  TASK_IMPORT_SKIP_LABELS,
  guessTaskImportMapping,
  mapTaskImportRow,
  normalizeTaskImportRow,
  parseImportTaskKind,
  parseImportTaskPriority,
  parseImportTaskStatus,
  taskImportSkippedCsv,
} from './crm-task-import'

describe('the task vocabulary', () => {
  it('labels every field and every skip reason', () => {
    for (const field of TASK_IMPORT_FIELDS) {
      expect(TASK_IMPORT_FIELD_LABELS[field]).toBeTruthy()
    }
    expect(Object.keys(TASK_IMPORT_SKIP_LABELS).sort()).toEqual([
      'missing-title',
      'unknown-assignee',
      'write-failed',
    ])
  })
})

describe('guessTaskImportMapping', () => {
  it('reads the tasks export header, leaving the columns a file cannot set unmapped', () => {
    expect(
      guessTaskImportMapping([
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
      ]),
    ).toEqual({
      0: 'title',
      1: 'kind',
      2: 'priority',
      3: 'status',
      4: 'due',
      5: 'assigneeEmail',
      10: 'notes',
    })
  })

  it('reads another product’s headers', () => {
    expect(guessTaskImportMapping(['Subject', 'Type', 'Deadline', 'Assigned to'])).toEqual({
      0: 'title',
      1: 'kind',
      2: 'due',
      3: 'assigneeEmail',
    })
  })
})

describe('the cell readers', () => {
  it('reads a kind by id or by label', () => {
    expect(parseImportTaskKind('call')).toBe('call')
    expect(parseImportTaskKind('To-do')).toBe('todo')
    expect(parseImportTaskKind('to do')).toBe('todo')
    expect(parseImportTaskKind('Meeting')).toBe('meeting')
    expect(parseImportTaskKind('lunch')).toBeNull()
  })

  it('reads a priority with medium and urgent folded in', () => {
    expect(parseImportTaskPriority('High')).toBe('high')
    expect(parseImportTaskPriority('medium')).toBe('normal')
    expect(parseImportTaskPriority('urgent')).toBe('high')
    expect(parseImportTaskPriority('whenever')).toBeNull()
  })

  it('reads a status as open or done', () => {
    expect(parseImportTaskStatus('Done')).toBe('done')
    expect(parseImportTaskStatus('yes')).toBe('done')
    expect(parseImportTaskStatus('Open')).toBe('open')
    expect(parseImportTaskStatus('false')).toBe('open')
    expect(parseImportTaskStatus('maybe')).toBeNull()
  })
})

describe('normalizeTaskImportRow', () => {
  it('refuses only a missing title', () => {
    expect(normalizeTaskImportRow({ kind: 'call' })).toEqual({
      ok: false,
      reason: 'missing-title',
      input: '',
    })
  })

  it('normalizes every readable cell', () => {
    expect(
      normalizeTaskImportRow({
        title: ' Call  Maya ',
        kind: 'Call',
        priority: 'High',
        status: 'done',
        due: '2026-09-30T09:00:00.000Z',
        assigneeEmail: ' Ada@Example.com ',
        notes: 'About the renewal',
      }),
    ).toEqual({
      ok: true,
      row: {
        title: 'Call Maya',
        kind: 'call',
        priority: 'high',
        status: 'done',
        dueAtMs: Date.UTC(2026, 8, 30, 9),
        assigneeEmail: 'ada@example.com',
        notes: 'About the renewal',
        dropped: [],
      },
    })
  })

  it('falls to the drawer’s defaults for cells it cannot read, and names them', () => {
    const verdict = normalizeTaskImportRow({
      title: 'Follow up',
      kind: 'lunch',
      priority: 'whenever',
      status: 'maybe',
      due: 'next week',
      assigneeEmail: 'nobody',
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.row).toMatchObject({
      kind: 'todo',
      priority: 'normal',
      status: 'open',
      dueAtMs: null,
    })
    expect(verdict.row.assigneeEmail).toBeUndefined()
    expect(verdict.row.dropped.map((entry) => entry.field)).toEqual([
      'kind',
      'priority',
      'status',
      'due',
      'assigneeEmail',
    ])
  })
})

describe('mapTaskImportRow and the skipped file', () => {
  it('carries the mapped cells verbatim and writes the reason by label', () => {
    expect(mapTaskImportRow(['Call', '', 'x'], { 0: 'title', 1: 'kind', 2: 'notes' })).toEqual({
      title: 'Call',
      notes: 'x',
    })
    expect(
      taskImportSkippedCsv(['Title', 'Assignee'], [{ cells: ['Call', 'x@example.com'], reason: 'unknown-assignee' }]),
    ).toBe('Title,Assignee,Skipped because\nCall,x@example.com,No team member has that assignee address')
  })
})
