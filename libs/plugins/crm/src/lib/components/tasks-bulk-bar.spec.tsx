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
 *
 * Beneath the ORGANIZATION hub (AGL-2637) Complete and Assign are ONE
 * request each — the routes' org-level batch form — tallied off the
 * per-task answers, with a refused task still named by title, and the
 * bar's sentence posted once as the org feed's line.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
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

/**
 * The two routes, as the bar reaches them — every call recorded, refusals
 * by id. The batch forms answer per task, a refused one as a row.
 */
let calls: Array<{ route: string; body: Record<string, unknown> }>
let refuseIds: Set<string>
const REFUSAL = 'That task is not visible to you.'
jest.mock('../model/task-api', () => ({
  completeCrmTask: async (_user: unknown, body: { taskId: string }) => {
    calls.push({ route: 'complete', body })
    if (refuseIds.has(body.taskId)) throw new Error(REFUSAL)
    return { ok: true, completedAtMs: 1 }
  },
  saveCrmTask: async (_user: unknown, body: { taskId: string }) => {
    calls.push({ route: 'save', body })
    if (refuseIds.has(body.taskId)) throw new Error(REFUSAL)
    return { ok: true, taskId: body.taskId, notified: true }
  },
  completeCrmTasks: async (_user: unknown, body: { taskIds: string[] }) => {
    calls.push({ route: 'complete-batch', body })
    return {
      ok: true,
      results: body.taskIds.map((taskId) =>
        refuseIds.has(taskId)
          ? { taskId, ok: false, error: REFUSAL }
          : { taskId, ok: true, completedAtMs: 1 },
      ),
    }
  },
  saveCrmTasks: async (_user: unknown, body: { tasks: Array<{ taskId: string }> }) => {
    calls.push({ route: 'save-batch', body })
    return {
      ok: true,
      results: body.tasks.map(({ taskId }) =>
        refuseIds.has(taskId)
          ? { taskId, ok: false, error: REFUSAL }
          : { taskId, ok: true, notified: true },
      ),
    }
  },
}))

/** The org feed's line, posted through `crm/org-activity` beneath the org hub. */
let posted: Array<{ route: string; payload: Record<string, unknown> }>
jest.mock('../components/use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, unknown>) => {
    posted.push({ route, payload })
    return { response: { ok: true }, payload: { ok: true } }
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

/** The same bar beneath the org hub: no site, the org's mount published. */
function mountUnderOrg(selected: string[]) {
  return render(
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hosts: [{ id: 'host-1', name: 'Site 1', subdomain: 'one' }],
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
    >
      <TasksBulkBar
        hostId={null}
        scope={SCOPE}
        rows={rows}
        selected={selected}
        onSelectedChange={jest.fn()}
        directory={directory}
      />
    </CrmOrgMountProvider>,
  )
}

const dialog = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  ops = []
  calls = []
  posted = []
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

describe('beneath the organization hub (AGL-2637)', () => {
  it('completes the open selection in ONE request, names a refused task, and posts the org line once', async () => {
    refuseIds = new Set(['t3'])
    mountUnderOrg(['t1', 't2', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(notices).toEqual(['Completed 1 task']))
    // One request, the open tasks only — a done one is left alone — and
    // no per-task call at all.
    expect(calls).toEqual([
      { route: 'complete-batch', body: { orgId: 'org-1', taskIds: ['t1', 't3'] } },
    ])
    expect(ops).toEqual([])
    expect(screen.getByText(/Follow up — That task is not visible to you\./)).toBeTruthy()
    await waitFor(() =>
      expect(posted).toEqual([
        {
          route: 'org-activity',
          payload: { action: 'Completed 1 task', target: { type: 'task' } },
        },
      ]),
    )
  })

  it('assigns the selection in ONE request, each task with its own fields and the new assignee', async () => {
    mountUnderOrg(['t1', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    fireEvent.mouseDown(dialog().getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Assigned 2 tasks to Ada Lovelace']))
    expect(calls).toHaveLength(1)
    expect(calls[0].route).toBe('save-batch')
    expect(calls[0].body).toEqual({
      orgId: 'org-1',
      tasks: [
        {
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
        },
        {
          taskId: 't3',
          task: {
            title: 'Follow up',
            kind: 'call',
            priority: 'normal',
            dueAtMs: null,
            assigneeUid: 'uid-a',
            notes: '',
            contactId: null,
            companyId: null,
            dealId: null,
          },
        },
      ],
    })
  })

  it('makes no batch call under a site, and posts no org line there', async () => {
    mount(['t1', 't3'])
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(notices).toEqual(['Completed 2 tasks']))
    expect(calls.map((call) => call.route)).toEqual(['complete', 'complete'])
    expect(posted).toEqual([])
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
