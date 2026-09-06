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
 * THE BULK BAR OVER THE CONTACTS TABLE (AGL-2603).
 *
 * What it must hold: it exists only for a selection and says how many; a tag
 * or a stage set on the selection lands as one facet patch per row, batched;
 * a row the store refuses is named by address on screen; removing rows is
 * the drawer's detach per row, behind the confirm.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import { ContactsBulkBar } from './contacts-bulk-bar'

/** Every write the store received, in order. */
let ops: Array<{ via: 'batch' | 'single'; kind: string; path: string; data?: any }>
/** Whether the next batch commit is refused wholesale. */
let batchFails: boolean
/** Ids a single write is refused for. */
let refuseSingle: Set<string>

const refuse = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: unknown) => base,
  orderBy: () => undefined,
  limit: () => undefined,
  arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
  writeBatch: () => {
    const staged: typeof ops = []
    return {
      update: (ref: { path: string }, data: unknown) =>
        void staged.push({ via: 'batch', kind: 'update', path: ref.path, data }),
      delete: (ref: { path: string }) =>
        void staged.push({ via: 'batch', kind: 'delete', path: ref.path }),
      commit: async () => {
        if (batchFails) throw refuse()
        ops.push(...staged)
      },
    }
  },
  updateDoc: async (ref: { path: string }, data: unknown) => {
    const id = ref.path.split('/').pop() ?? ''
    if (refuseSingle.has(id)) throw refuse()
    ops.push({ via: 'single', kind: 'update', path: ref.path, data })
  },
  deleteDoc: async (ref: { path: string }) => {
    const id = ref.path.split('/').pop() ?? ''
    if (refuseSingle.has(id)) throw refuse()
    ops.push({ via: 'single', kind: 'delete', path: ref.path })
  },
}))

const FIRESTORE = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useUser: () => ({ data: { uid: 'uid-me', getIdToken: async () => 'token' } }),
  useOrgMemberOptions: () => ({
    options: [{ uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com' }],
    ready: true,
    error: null,
  }),
}))

/** Everything the bar put in front of the reader through the snackbar. */
let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

/** Confirm resolves (proceed) or rejects (cancel), the way the real one does. */
let confirmAnswer: 'proceed' | 'cancel'
const confirmSpy = jest.fn(() =>
  confirmAnswer === 'proceed' ? Promise.resolve() : Promise.reject(new Error('cancel')),
)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: confirmSpy }),
}))
jest.mock('./add-to-list-dialog', () => ({
  __esModule: true,
  default: () => <div data-testid="add-to-list-dialog" />,
}))

const GROUP = soloConsentGroup('host-1')
const rows = [
  {
    $id: 'c1',
    email: 'a@example.com',
    name: 'Ada',
    tags: [],
    visibleTo: ['host:host-1'],
  },
  {
    $id: 'c2',
    email: 'b@example.com',
    name: 'Bea',
    tags: ['vip'],
    visibleTo: ['host:host-1', 'host:other'],
  },
  { $id: 'c3', email: 'c@example.com', name: 'Cy', tags: [], visibleTo: ['host:host-1'] },
]

function Harness(props: { initial: string[]; children?: ReactNode }) {
  return (
    <ContactsBulkBar
      hostId="host-1"
      scope={['orgs', 'org-1']}
      consentGroup={GROUP}
      rows={rows}
      selected={props.initial}
      onSelectedChange={onSelectedChange}
    />
  )
}
const onSelectedChange = jest.fn()

beforeEach(() => {
  ops = []
  notices = []
  batchFails = false
  refuseSingle = new Set()
  confirmAnswer = 'proceed'
  confirmSpy.mockClear()
  onSelectedChange.mockClear()
})

const facetPath = (field: string) => `facets.${GROUP.groupId}.${field}`

describe('the bar and its selection', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(<Harness initial={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('says how many are selected and offers every action', () => {
    render(<Harness initial={['c1', 'c2']} />)
    expect(screen.getByText('2 selected')).toBeTruthy()
    for (const label of [
      'Add tag',
      'Remove tag',
      'Set owner',
      'Set stage',
      'Add to list',
      'Export CSV',
      'Remove from this site',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })
})

describe('tagging the selection', () => {
  it('unions the tag into each selected row’s facet, in one batch', async () => {
    render(<Harness initial={['c1', 'c2']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: ' Wholesale ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(ops).toHaveLength(2))
    expect(ops.map((op) => op.path)).toEqual([
      'orgs/org-1/contacts/c1',
      'orgs/org-1/contacts/c2',
    ])
    expect(ops[0].via).toBe('batch')
    expect(ops[0].data[facetPath('tags')]).toEqual({ op: 'union', values: ['wholesale'] })
    // A nested `facets` object would replace every other holder's records.
    expect(ops[0].data.facets).toBeUndefined()
    expect(notices).toContain('Tagged 2 contacts')
  })

  it('removes a tag only from the rows that carry it', async () => {
    render(<Harness initial={['c1', 'c2']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }))
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'vip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices.length).toBeGreaterThan(0))
    expect(ops.map((op) => op.path)).toEqual(['orgs/org-1/contacts/c2'])
    expect(ops[0].data[facetPath('tags')]).toEqual({ op: 'remove', values: ['vip'] })
  })
})

describe('setting the stage and the owner', () => {
  it('writes the stage into each facet', async () => {
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(ops).toHaveLength(2))
    expect(ops.map((op) => op.data[facetPath('lifecycleStage')])).toEqual([
      'customer',
      'customer',
    ])
    expect(notices).toContain('Stage set on 2 contacts')
  })

  it('offers the team as owners and writes the chosen uid', async () => {
    render(<Harness initial={['c1']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set owner' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Owner' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Ada Lovelace'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(ops).toHaveLength(1))
    expect(ops[0].data[facetPath('ownerUid')]).toBe('uid-a')
  })
})

describe('a refused row', () => {
  it('fails the batch, and the rows that can be written still are — one at a time', async () => {
    batchFails = true
    refuseSingle = new Set(['c3'])
    render(<Harness initial={['c1', 'c2', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    // c2 already carries `vip`, so the plan is c1 and c3; c3 is refused.
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'vip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(notices.length).toBeGreaterThan(0))
    expect(ops).toEqual([
      expect.objectContaining({ via: 'single', path: 'orgs/org-1/contacts/c1' }),
    ])
    expect(notices).toContain('Tagged 1 contact')
  })

  it('reports the refused address rather than a count', async () => {
    batchFails = true
    refuseSingle = new Set(['c3'])
    render(<Harness initial={['c1', 'c3']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Lead'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const line = await screen.findByText(/c@example\.com — not permitted/)
    expect(line).toBeTruthy()
    expect(screen.getByText('One contact was not changed:')).toBeTruthy()
    expect(ops.map((op) => op.path)).toEqual(['orgs/org-1/contacts/c1'])
    expect(notices).toContain('Stage set on 1 contact')
  })
})

describe('removing the selection from this site', () => {
  it('deletes a row this site alone holds and detaches from a shared one, after the confirm', async () => {
    render(<Harness initial={['c1', 'c2']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this site' }))
    await waitFor(() => expect(ops).toHaveLength(2))
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove 2 contacts?',
        confirmationText: 'Remove contacts',
      }),
    )
    expect(ops[0]).toMatchObject({ kind: 'delete', path: 'orgs/org-1/contacts/c1' })
    expect(ops[1]).toMatchObject({ kind: 'update', path: 'orgs/org-1/contacts/c2' })
    expect(ops[1].data[`facets.${GROUP.groupId}`]).toEqual({ op: 'delete' })
    expect(ops[1].data.visibleTo).toEqual({ op: 'remove', values: ['host:host-1'] })
    // The rows are gone from the table, so the selection lets go of them.
    expect(onSelectedChange).toHaveBeenLastCalledWith([])
    expect(notices).toContain('2 contacts removed from this site')
  })

  it('writes nothing when the confirm is cancelled', async () => {
    confirmAnswer = 'cancel'
    render(<Harness initial={['c1']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from this site' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ops).toEqual([])
    expect(onSelectedChange).not.toHaveBeenCalled()
  })
})

describe('the audience door', () => {
  it('opens the shared add-to-list dialog for the selection', () => {
    render(<Harness initial={['c1', 'c2']} />)
    expect(screen.queryByTestId('add-to-list-dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }))
    expect(screen.getByTestId('add-to-list-dialog')).toBeTruthy()
  })
})
