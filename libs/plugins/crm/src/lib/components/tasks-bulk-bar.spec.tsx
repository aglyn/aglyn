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
 * THE BULK BAR OVER THE TASKS LIST (AGL-2621).
 *
 * What it must hold: Complete goes through `crm/task-complete` one open
 * task at a time and leaves a done task alone; Assign goes through
 * `crm/task-save` with the task's own fields and the new assignee, so the
 * assignee is told; the due date and the delete are batched document
 * writes, the due date written as `null` rather than deleted; a refusal
 * is named by title; the export is the list's file over the selection.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CrmTaskRow } from '../hooks/use-crm-tasks'
import { TasksBulkBar } from './tasks-bulk-bar'

let ops: Array<{ via: 'batch' | 'single'; kind: string; path: string; data?: any }>
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  writeBatch: () => {
    const staged: typeof ops = []
    return {
      update: (ref: { path: string }, data: unknown) =>
        void staged.push({ via: 'batch', kind: 'update', path: ref.path, data }),
      delete: (ref: { path: string }) =>
        void staged.push({ via: 'batch', kind: 'delete', path: ref.path }),
      commit: async () => void ops.push(...staged),
    }
  },
  updateDoc: async (ref: { path: string }, data: unknown) =>
    void ops.push({ via: 'single', kind: 'update', path: ref.path, data }),
  deleteDoc: async (ref: { path: string }) =>
    void ops.push({ via: 'single', kind: 'delete', path: ref.path }),
}))

const USER = { uid: 'uid-me', getIdToken: async () => 'token' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: USER }),
}))

/** The two routes, as the bar reaches them — every call recorded, refusals by id. */
let calls: Array<{ route: string; body: Record<string, unknown> }>
let refuseIds: Set<string>
jest.mock('../model/task-api', () => ({
  completeCrmTask: async (_user: unknown, body: { taskId: string }) => {
    calls.push({ route: 'complete', body })
    if (refuseIds.has(body.taskId)) throw new Error('That task is not visible to you.')
    return { ok: true, completedAtMs: 1 }
  },
  saveCrmTask: async (_user: unknown, body: { taskId: string }) => {
    calls.push({ route: 'save', body })
    if (refuseIds.has(body.taskId)) throw new Error('That task is not visible to you.')
    return { ok: true, taskId: body.taskId, notified: true }
  },
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: () => Promise.resolve() }),
}))
const downloads: Array<{ name: string; body: string }> = []
jest.mock('../model/contacts-csv', () => ({
  downloadTextFile: (name: string, _type: string, body: string) =>
    void downloads.push({ name, body }),
}))

const SCOPE = ['orgs', 'org-1'] as const
const task = (id: string, title: string, extra: Partial<CrmTaskRow> = {}): CrmTaskRow =>
  ({
    $id: id,
    title,
    kind: 'call',
    priority: 'normal',
    status: 'open',
    dueAtMs: null,
    notes: '',
    createdByUid: 'uid-me',
    visibleTo: ['org'],
    hostId: 'host-1',
    ...extra,
  }) as CrmTaskRow
const rows = [
  task('t1', 'Call Ada', { contactId: 'c-ada' }),
  task('t2', 'Send deck', { status: 'done', completedAtMs: 5 }),
  task('t3', 'Follow up'),
]
const directory = {
  members: [{ uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' }],
  loading: false,
  error: null,
  nameOf: (ref: string | null | undefined) => (ref === 'uid-a' ? 'Ada Lovelace' : String(ref ?? '')),
}

function mount(selected: string[], onSelectedChange = jest.fn()) {
  const result = render(
    <TasksBulkBar
      hostId="host-1"
      scope={SCOPE}
      rows={rows}
      selected={selected}
      onSelectedChange={onSelectedChange}
      directory={directory}
      csv={{ recordName: (kind, id) => (kind === 'contact' && id === 'c-ada' ? 'Ada' : undefined) }}
    />,
  )
  return { ...result, onSelectedChange }
}

const dialog = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  ops = []
  calls = []
  refuseIds = new Set()
  notices = []
  downloads.length = 0
})

describe('the bar and its selection', () => {
  it('renders nothing when nothing is selected, and every action otherwise', () => {
    const { container } = mount([])
    expect(container.innerHTML).toBe('')
    mount(['t1', 't3'])
    expect(screen.getByText('2 selected')).toBeTruthy()
    for (const name of ['Complete', 'Assign', 'Set due', 'Export CSV', 'Delete', 'Clear']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('through the routes', () => {
  it('completes each open task through its route, leaves a done one alone, and names a refusal', async () => {
    refuseIds = new Set(['t3'])
    mount(['t1', 't2', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(notices).toEqual(['Completed 1 task']))
    expect(calls).toEqual([
      { route: 'complete', body: { hostId: 'host-1', taskId: 't1' } },
      { route: 'complete', body: { hostId: 'host-1', taskId: 't3' } },
    ])
    expect(ops).toEqual([])
    expect(screen.getByText(/Follow up — That task is not visible to you\./)).toBeTruthy()
  })

  it('assigns each task through the save route with its own fields and the new assignee', async () => {
    mount(['t1', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    fireEvent.mouseDown(dialog().getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Assigned 2 tasks to Ada Lovelace']))
    expect(calls.map((call) => call.route)).toEqual(['save', 'save'])
    expect(calls[0].body).toEqual({
      hostId: 'host-1',
      taskId: 't1',
      task: {
        title: 'Call Ada',
        kind: 'call',
        priority: 'normal',
        dueAtMs: null,
        assigneeUid: 'uid-a',
        notes: '',
        contactId: 'c-ada',
        companyId: null,
        dealId: null,
      },
    })
  })
})

describe('as document writes', () => {
  it('sets the due date on every row in one batch', async () => {
    mount(['t1', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Set due' }))
    fireEvent.change(dialog().getByLabelText('Due'), { target: { value: '2026-09-10T09:00' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Due date set on 2 tasks']))
    expect(ops.map((op) => op.path)).toEqual(['orgs/org-1/crmTasks/t1', 'orgs/org-1/crmTasks/t3'])
    expect(ops[0].data.dueAtMs).toBe(new Date('2026-09-10T09:00').getTime())
    expect(calls).toEqual([])
  })

  it('clears the due date as null rather than a deleted field', async () => {
    mount(['t1'])
    fireEvent.click(screen.getByRole('button', { name: 'Set due' }))
    fireEvent.change(dialog().getByLabelText('Due'), { target: { value: '' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Due date cleared on 1 task']))
    expect(ops[0].data.dueAtMs).toBeNull()
  })

  it('deletes the selection in one batch and clears it', async () => {
    const { onSelectedChange } = mount(['t1', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(notices).toEqual(['Deleted 2 tasks']))
    expect(ops.map((op) => `${op.kind} ${op.path}`)).toEqual([
      'delete orgs/org-1/crmTasks/t1',
      'delete orgs/org-1/crmTasks/t3',
    ])
    expect(onSelectedChange).toHaveBeenCalledWith([])
  })
})

describe('the file', () => {
  it('exports the selection with the linked record by name', () => {
    mount(['t1'])
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('tasks-selected.csv')
    const [header, line] = downloads[0].body.split('\n')
    expect(header.startsWith('Title,Kind,Priority')).toBe(true)
    expect(line).toBe('Call Ada,Call,Normal,Open,,,Ada,,,,')
  })
})
