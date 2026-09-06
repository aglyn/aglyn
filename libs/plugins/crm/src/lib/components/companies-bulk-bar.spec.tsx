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
 * THE BULK BAR OVER THE COMPANIES TABLE (AGL-2621).
 *
 * What it must hold: it exists only for a selection and says how many; a
 * tag or an owner set on the selection lands as one top-level patch per
 * row, batched; the export is the table's file over the selection; and
 * Delete is the record page's detach-then-delete per company, behind the
 * confirm, logged per company, with a company past the bound NAMED and
 * left selected.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CompaniesBulkBar } from './companies-bulk-bar'

/** Every write the store received, in order. */
let ops: Array<{ via: 'batch' | 'single'; kind: string; path: string; data?: any }>
/** How many contacts each company has linked, for the detach probe. */
let linked: Record<string, number>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: { path: string }, ...clauses: Array<{ kind: string; value?: unknown }>) => ({
    ...base,
    companyId: clauses.find((clause) => clause.kind === 'where')?.value,
    limit: clauses.find((clause) => clause.kind === 'limit')?.value,
  }),
  where: (_field: string, _op: string, value: unknown) => ({ kind: 'where', value }),
  limit: (value: number) => ({ kind: 'limit', value }),
  getDocs: async (spec: { companyId: string; limit: number }) => {
    const count = Math.min(linked[spec.companyId] ?? 0, spec.limit)
    return {
      docs: Array.from({ length: count }, (_, index) => ({
        ref: { path: `orgs/org-1/contacts/${spec.companyId}-${index}` },
        data: () => ({ companyIds: [spec.companyId], facets: {} }),
      })),
    }
  },
  arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
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

/** Every activity line the bar wrote. */
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

let confirmAnswer: 'proceed' | 'cancel'
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({
    confirm: () =>
      confirmAnswer === 'proceed' ? Promise.resolve() : Promise.reject(new Error('cancel')),
  }),
}))

const downloads: Array<{ name: string; body: string }> = []
jest.mock('../model/contacts-csv', () => ({
  downloadTextFile: (name: string, _type: string, body: string) =>
    void downloads.push({ name, body }),
}))

const SCOPE = ['orgs', 'org-1'] as const
const members = {
  options: [{ uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com' }],
  labelFor: (ref: string | null | undefined) => (ref === 'uid-a' ? 'Ada Lovelace' : String(ref ?? '')),
  emailFor: (ref: string | null | undefined) => (ref === 'uid-a' ? 'ada@example.com' : String(ref ?? '')),
  ready: true,
  loading: false,
  error: null,
}
const rows = [
  { $id: 'c1', name: 'Acme', tags: [], ownerUid: 'uid-a' },
  { $id: 'c2', name: 'Globex', tags: ['vip'] },
  { $id: 'c3', name: 'Initech', tags: Array.from({ length: 20 }, (_, i) => `t${i}`) },
]

function mount(selected: string[], onSelectedChange = jest.fn()) {
  const result = render(
    <CompaniesBulkBar
      hostId="host-1"
      scope={SCOPE}
      rows={rows}
      selected={selected}
      onSelectedChange={onSelectedChange}
      members={members}
      csv={{ ownerEmail: members.emailFor }}
    />,
  )
  return { ...result, onSelectedChange }
}

const dialog = () => within(screen.getByRole('dialog'))
const applyValue = async (button: string, value: string, field = 'Tag') => {
  fireEvent.click(screen.getByRole('button', { name: button }))
  fireEvent.change(dialog().getByLabelText(field), { target: { value } })
  fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(notices.length).toBeGreaterThan(0))
}

beforeEach(() => {
  ops = []
  linked = {}
  logged = []
  notices = []
  confirmAnswer = 'proceed'
  downloads.length = 0
})

describe('the bar and its selection', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = mount([])
    expect(container.innerHTML).toBe('')
  })

  it('says how many are selected and offers every action', () => {
    mount(['c1', 'c2'])
    expect(screen.getByText('2 selected')).toBeTruthy()
    for (const name of ['Add tag', 'Remove tag', 'Set owner', 'Export CSV', 'Delete', 'Clear']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('tagging and the owner', () => {
  it('unions the tag into each row that lacks it in one batch, and names the one at the cap', async () => {
    mount(['c1', 'c2', 'c3'])
    await applyValue('Add tag', ' VIP ')
    expect(ops).toEqual([
      expect.objectContaining({
        via: 'batch',
        path: 'orgs/org-1/companies/c1',
        data: expect.objectContaining({ tags: { op: 'union', values: ['vip'] } }),
      }),
    ])
    expect(notices).toEqual(['Tagged 1 company'])
    expect(screen.getByText(/Initech — already has 20 tags/)).toBeTruthy()
  })

  it('writes the chosen owner to every row', async () => {
    mount(['c1', 'c2'])
    fireEvent.click(screen.getByRole('button', { name: 'Set owner' }))
    fireEvent.mouseDown(dialog().getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices).toEqual(['Owner set on 2 companies']))
    expect(ops.map((op) => [op.path, (op.data as any).ownerUid])).toEqual([
      ['orgs/org-1/companies/c1', 'uid-a'],
      ['orgs/org-1/companies/c2', 'uid-a'],
    ])
  })
})

describe('the file', () => {
  it('exports the selection under the import’s header, the owner by address', () => {
    mount(['c1'])
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toBe('companies-selected.csv')
    const [header, line] = downloads[0].body.split('\n')
    expect(header.startsWith('Company,Domain,Website')).toBe(true)
    expect(line).toContain('Acme')
    expect(line).toContain('ada@example.com')
  })
})

describe('deleting the selection', () => {
  it('detaches each company’s contacts, deletes it, and logs one line per company', async () => {
    linked = { c1: 2 }
    const { onSelectedChange } = mount(['c1', 'c2'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(notices).toEqual(['Deleted 2 companies']))
    expect(ops.map((op) => `${op.kind} ${op.path}`)).toEqual([
      'update orgs/org-1/contacts/c1-0',
      'update orgs/org-1/contacts/c1-1',
      'delete orgs/org-1/companies/c1',
      'delete orgs/org-1/companies/c2',
    ])
    expect(logged).toEqual([
      { action: 'Deleted company', target: { type: 'company', id: 'c1', name: 'Acme' } },
      { action: 'Deleted company', target: { type: 'company', id: 'c2', name: 'Globex' } },
    ])
    expect(onSelectedChange).toHaveBeenCalledWith([])
  })

  it('names a company past the detach bound, keeps it, and leaves it selected', async () => {
    linked = { c1: 501 }
    const { onSelectedChange } = mount(['c1', 'c2'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(notices).toEqual(['Deleted 1 company']))
    expect(ops.some((op) => op.kind === 'delete' && op.path.endsWith('/c1'))).toBe(false)
    expect(screen.getByText(/Acme — 500 contacts were unlinked and more remain/)).toBeTruthy()
    expect(onSelectedChange).toHaveBeenCalledWith(['c1'])
  })

  it('writes nothing when the confirm is cancelled', async () => {
    confirmAnswer = 'cancel'
    mount(['c1'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ops).toEqual([])
    expect(logged).toEqual([])
  })
})
