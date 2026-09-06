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
 * THE BULK BAR OVER THE DEALS TABLE (AGL-2621).
 *
 * What it must hold: a stage move and a loss go through the route ONE
 * DEAL AT A TIME, in order, and a refusal carries the route's sentence
 * under the deal's title; Set stage offers one pipeline's stages and
 * declines a selection that spans two; the owner and the delete are
 * batched document writes; the delete is logged per deal; the export is
 * the table's file over the selection.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DealDoc, PipelineDoc } from '../model/deal-board-model'
import { DealsBulkBar } from './deals-bulk-bar'

let ops: Array<{ via: 'batch' | 'single'; kind: string; path: string; data?: any }>
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => ({ op: 'delete' }),
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

let logged: Array<{ action: string; target: Record<string, unknown> }>
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostActivityLogger: () => (action: string, target: Record<string, unknown>) =>
    void logged.push({ action, target }),
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
const SALES: PipelineDoc = {
  $id: 'sales',
  name: 'Sales',
  visibleTo: ['org'],
  hostId: 'host-1',
  stages: [
    { id: 'qualified', name: 'Qualified', order: 0, probability: 20, kind: 'open' },
    { id: 'negotiation', name: 'Negotiation', order: 1, probability: 60, kind: 'open' },
    { id: 'won', name: 'Won', order: 2, probability: 100, kind: 'won' },
    { id: 'lost', name: 'Lost', order: 3, probability: 0, kind: 'lost' },
  ],
} as PipelineDoc
const OTHER: PipelineDoc = { ...SALES, $id: 'other', name: 'Renewals' }
const pipelineById = (id: string | undefined) =>
  id === 'sales' ? SALES : id === 'other' ? OTHER : null

const deal = (id: string, title: string, pipelineId = 'sales'): DealDoc =>
  ({
    $id: id,
    title,
    pipelineId,
    stageId: 'qualified',
    status: 'open',
    visibleTo: ['org'],
    hostId: 'host-1',
  }) as DealDoc
const rows = [deal('d1', 'Acme renewal'), deal('d2', 'Globex pilot'), deal('d3', 'Initech', 'other')]

const roster = {
  members: [{ uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' }],
  loading: false,
  error: null,
  nameOf: (ref: string | null | undefined) => (ref === 'uid-a' ? 'Ada Lovelace' : String(ref ?? '')),
}

/** The route, as the bar sees it — every call recorded, refusals by id. */
let calls: Array<{ kind: string; dealId: string; arg?: string }>
let refuseIds: Set<string>
const api = {
  moveToStage: jest.fn(async (dealId: string, stageId: string) => {
    calls.push({ kind: 'move', dealId, arg: stageId })
    if (refuseIds.has(dealId)) throw new Error('This deal is not visible to this site.')
    return {} as never
  }),
  markWon: jest.fn(async (dealId: string) => {
    calls.push({ kind: 'won', dealId })
    return {} as never
  }),
  markLost: jest.fn(async (dealId: string, reason?: string) => {
    calls.push({ kind: 'lost', dealId, arg: reason })
    return {} as never
  }),
}

function mount(selected: string[], onSelectedChange = jest.fn()) {
  render(
    <DealsBulkBar
      hostId="host-1"
      scope={SCOPE}
      rows={rows}
      selected={selected}
      onSelectedChange={onSelectedChange}
      pipelineById={pipelineById}
      roster={roster}
      api={api}
      csv={{ pipelineName: (id) => pipelineById(id)?.name }}
    />,
  )
  return { onSelectedChange }
}

const dialog = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  ops = []
  logged = []
  notices = []
  calls = []
  refuseIds = new Set()
  downloads.length = 0
})

describe('the bar and its selection', () => {
  it('renders nothing when nothing is selected, and every action otherwise', () => {
    const { container } = render(
      <DealsBulkBar
        hostId="host-1"
        scope={SCOPE}
        rows={rows}
        selected={[]}
        onSelectedChange={jest.fn()}
        pipelineById={pipelineById}
        roster={roster}
        api={api}
      />,
    )
    expect(container.innerHTML).toBe('')
    mount(['d1', 'd2'])
    expect(screen.getByText('2 selected')).toBeTruthy()
    for (const name of ['Set stage', 'Set owner', 'Mark lost', 'Export CSV', 'Delete', 'Clear']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('the stage, through the route', () => {
  it('moves each deal through the route in order, and names a refusal by title with the route’s sentence', async () => {
    refuseIds = new Set(['d2'])
    mount(['d1', 'd2'])
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(dialog().getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Negotiation' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Moved 1 deal to Negotiation']))
    expect(calls).toEqual([
      { kind: 'move', dealId: 'd1', arg: 'negotiation' },
      { kind: 'move', dealId: 'd2', arg: 'negotiation' },
    ])
    expect(ops).toEqual([])
    expect(screen.getByText(/Globex pilot — This deal is not visible to this site\./)).toBeTruthy()
  })

  it('offers no stages to a selection that spans two pipelines', () => {
    mount(['d1', 'd3'])
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    expect(dialog().queryByRole('combobox')).toBeNull()
    expect(dialog().getByText(/different pipelines/)).toBeTruthy()
    expect((dialog().getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks each deal lost through the route with the one reason', async () => {
    mount(['d1', 'd2'])
    fireEvent.click(screen.getByRole('button', { name: 'Mark lost' }))
    expect(screen.getByText('Mark 2 deals lost?')).toBeTruthy()
    fireEvent.change(dialog().getByLabelText('Reason'), { target: { value: 'Budget cut' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Mark lost' }))
    await waitFor(() => expect(notices).toEqual(['Marked 2 deals lost']))
    expect(calls).toEqual([
      { kind: 'lost', dealId: 'd1', arg: 'Budget cut' },
      { kind: 'lost', dealId: 'd2', arg: 'Budget cut' },
    ])
  })
})

describe('the owner and the delete, as document writes', () => {
  it('writes the chosen owner to every row in one batch', async () => {
    mount(['d1', 'd2'])
    fireEvent.click(screen.getByRole('button', { name: 'Set owner' }))
    fireEvent.mouseDown(dialog().getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Owner set on 2 deals']))
    expect(ops.map((op) => [op.via, op.path, (op.data as any).ownerUid])).toEqual([
      ['batch', 'orgs/org-1/deals/d1', 'uid-a'],
      ['batch', 'orgs/org-1/deals/d2', 'uid-a'],
    ])
    expect(calls).toEqual([])
  })

  it('deletes the selection in one batch, logs one line per deal, and clears it', async () => {
    const { onSelectedChange } = mount(['d1', 'd2'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(notices).toEqual(['Deleted 2 deals']))
    expect(ops.map((op) => `${op.kind} ${op.path}`)).toEqual([
      'delete orgs/org-1/deals/d1',
      'delete orgs/org-1/deals/d2',
    ])
    expect(logged).toEqual([
      { action: 'Deleted deal', target: { type: 'deal', id: 'd1', name: 'Acme renewal' } },
      { action: 'Deleted deal', target: { type: 'deal', id: 'd2', name: 'Globex pilot' } },
    ])
    expect(onSelectedChange).toHaveBeenCalledWith([])
  })
})

describe('the file', () => {
  it('exports the selection with the pipeline by name', () => {
    mount(['d1'])
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('deals-selected.csv')
    const [header, line] = downloads[0].body.split('\n')
    expect(header.startsWith('Title,Pipeline,Stage')).toBe(true)
    expect(line.startsWith('Acme renewal,Sales,qualified')).toBe(true)
  })
})
