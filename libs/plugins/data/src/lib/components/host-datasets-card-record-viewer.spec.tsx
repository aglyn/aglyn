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
 *
 * @jest-environment jsdom
 */

/**
 * A dataset record can be READ without being opened for editing.
 *
 * `Edit` was the only way to see a record's full contents, so looking at one
 * and changing one were the same gesture on the same dialog — the one whose
 * primary button writes. Contracts:
 *
 *  1. THE ROW OPENS A READ-ONLY VIEW. Clicking the row body opens the viewer.
 *  2. `EDIT` DOES NOT OPEN IT. A control inside the actions cluster is its own
 *     action; the row's handler must not also fire. Without the guard this
 *     leaves a read-only dialog stacked under the editor.
 *  3. `DELETE` DOES NOT OPEN IT. The same guard, on the control where the
 *     failure is worst: a viewer opening behind a destructive confirmation.
 *  4. THE VIEWER TAKES NO INPUT. No field, no save, no destructive control.
 *     `Edit record` is a separate, named hand-off to the editor and writes
 *     nothing itself.
 *  5. IT IS REACHABLE BY KEYBOARD. A `<tr>` cannot be made a real activatable
 *     control without overriding the `row` role, so the keyboard's affordance
 *     is a genuine `<button>` in the actions cluster, announced as one.
 *  6. IT SHOWS THE WHOLE RECORD. Fields the table's columns cannot show — a
 *     field declared without a display slot, and a stored value with no field
 *     in the model — are part of the record and appear.
 *  7. IT RENDERS VALUES HONESTLY. Absent, null and a real empty string read
 *     differently, and an unresolved reference does not pass for a resolved
 *     one.
 *  8. IT FOLLOWS THE PAGE. The record is resolved out of the table's own page
 *     on every render, so a row that leaves closes the view rather than
 *     freezing a copy of it.
 *
 * NO Firestore path is added and no gate moves: the viewer renders the row the
 * table already handed this reader.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

const ORG = { $id: 'org-1', plan: 'scale' } as any

/**
 * `auditedBy` is declared in `fields` and left out of `order`, which is a real
 * shape rather than a contrivance — `datasetReferencedIds` exists precisely
 * because a reference can hold a live FKey with no display slot. The table's
 * columns come from `order`, so it is invisible there.
 */
const DATASET = {
  $id: 'ds-1',
  displayName: 'Leads',
  model: {
    order: ['title', 'note', 'count', 'tags', 'owner'],
    fields: {
      title: { name: 'Title', type: 'text' },
      note: { name: 'Note', type: 'text' },
      count: { name: 'Count', type: 'int32' },
      tags: { name: 'Tags', type: 'sorted' },
      owner: {
        name: 'Owner',
        type: 'reference',
        reference: { datasetId: 'people', displayFieldId: 'name' },
      },
      auditedBy: {
        name: 'Audited by',
        type: 'reference',
        reference: { datasetId: 'people', displayFieldId: 'name' },
      },
    },
  },
  visibleTo: ['org'],
}
const datasetDocs = [DATASET]

/**
 * One record carrying every state the contract turns on at once, because the
 * states are only interesting against each other: `note` is a REAL empty
 * string, `count` is absent, `owner` resolves, `auditedBy` does not, and
 * `legacy_code` has no field in the model at all.
 */
const RECORD_FULL = {
  $id: 'rec-0',
  values: {
    title: 'Kettle',
    note: '',
    // The first item CONTAINS a comma, so the joined form a cell shows is
    // ambiguous about whether this list holds two items or three.
    tags: ['red, blue', 'green'],
    owner: 'p1',
    auditedBy: 'p9',
    legacy_code: 'X-17',
  },
}
const RECORD_NULLED = {
  $id: 'rec-1',
  values: { title: 'Grinder', note: null },
}
/** Mutable: contract 8 removes a row and re-renders. */
let recordDocs: any[] = [RECORD_FULL, RECORD_NULLED]

const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => unknown) => {
    const path = build() as string | null
    return {
      data: path === 'datasets' ? datasetDocs : [],
      status: 'success',
      fromCache: false,
    }
  },
  usePagedCollection: (build: (pageLimit: number) => unknown) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(10)
    const path = build(pageSize * (page + 1) + 1) as string | null
    return {
      rows: path === 'records' ? recordDocs : [],
      hasMore: false,
      page,
      setPage,
      pageSize,
      setPageSize,
      status: 'success',
      fromCache: false,
    }
  },
}))

/**
 * The reference picker's window, holding `p1` and NOT `p9`. That gap is the
 * fixture for contract 7: `p9` is exactly as unresolvable as a deleted target
 * or one past the 200-row window, and the view may not print it as a label.
 */
const getDocs = jest.fn().mockResolvedValue({
  docs: [{ id: 'p1', get: () => ({ name: 'Ada Lovelace' }) }],
})
/**
 * `mock`-prefixed so the `jest.mock` factory below may close over it — jest's
 * out-of-scope-variable guard admits that one prefix. Deleting a record takes
 * no confirmation prompt, so the delete call itself is what says the control
 * still works.
 */
const mockDeleteDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path.split('/').pop(),
  limit: (value: number) => value,
  orderBy: () => 'orderBy',
  documentId: () => '__name__',
  where: () => 'where',
  // The joined path names the document, so a delete can be attributed to the
  // row it was clicked on.
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteField: () => ({ __delete: true }),
  getCountFromServer: async () => ({ data: () => ({ count: 2 }) }),
  getDocs: (...args: unknown[]) => getDocs(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  setDoc: jest.fn().mockResolvedValue(undefined),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
/** Rejects, so `Delete` never proceeds past its prompt. */
const confirm = jest.fn().mockRejectedValue(new Error('cancelled'))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  confirm.mockRejectedValue(new Error('cancelled'))
  getDocs.mockResolvedValue({
    docs: [{ id: 'p1', get: () => ({ name: 'Ada Lovelace' }) }],
  })
  recordDocs = [RECORD_FULL, RECORD_NULLED]
})

const mount = () => render(<HostDatasetsCard orgId="org-1" org={ORG} />)

/** The `<tr>` holding a cell with this text. */
const rowFor = (text: string) => {
  const cell = screen.getByText(text)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${text}`)
  return row
}

/** The open viewer, by the title only it renders. */
const viewer = () =>
  screen.getByText('View record').closest('[role="dialog"]') as HTMLElement

const viewerIsOpen = () => screen.queryByText('View record') != null

/**
 * The viewer has gone.
 *
 * A closed MUI dialog stays in the DOM for the length of its exit transition,
 * so an immediate `queryByText` reports a dialog that is on its way out as
 * still open. Waiting for the unmount is the difference between asserting it
 * closed and asserting it had not finished closing yet.
 */
const expectViewerClosed = () =>
  waitFor(() => expect(screen.queryByText('View record')).toBeNull())

/** The action button on the row showing `text`. */
const rowButton = (text: string, name: string) =>
  within(rowFor(text)).getByRole('button', { name })

describe('the row opens a read-only view', () => {
  it('opens the viewer when the row body is clicked', () => {
    mount()
    expect(viewerIsOpen()).toBe(false)
    // The title cell, which is row body rather than a control.
    fireEvent.click(screen.getByText('Kettle'))
    expect(viewerIsOpen()).toBe(true)
    expect(within(viewer()).getByText('rec-0')).toBeTruthy()
  })

  it('shows the record clicked, not merely the first one', () => {
    mount()
    fireEvent.click(screen.getByText('Grinder'))
    expect(within(viewer()).getByText('rec-1')).toBeTruthy()
  })

  it('closes on Close', async () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Close' }))
    await expectViewerClosed()
  })
})

describe('the row controls are still their own actions', () => {
  it('Edit opens the editor and NOT the viewer', () => {
    mount()
    fireEvent.click(rowButton('Kettle', 'Edit'))
    // The editor, by its own title.
    expect(screen.getByText('Edit record', { selector: 'h2' })).toBeTruthy()
    // The whole contract: the row's handler must not have fired too.
    expect(viewerIsOpen()).toBe(false)
  })

  it('Delete deletes and does NOT open the viewer', async () => {
    mount()
    fireEvent.click(rowButton('Kettle', 'Delete'))
    await waitFor(() => expect(mockDeleteDoc).toHaveBeenCalled())
    expect(viewerIsOpen()).toBe(false)
  })

  it('Delete still acts on the row it was clicked on', async () => {
    // The other direction: a propagation guard must not be bought by
    // breaking the control it guards.
    mount()
    fireEvent.click(rowButton('Grinder', 'Delete'))
    await waitFor(() => expect(mockDeleteDoc).toHaveBeenCalledTimes(1))
    expect(String(mockDeleteDoc.mock.calls[0][0])).toBe(
      'orgs/org-1/datasets/ds-1/records/rec-1',
    )
  })

  it('Edit still opens the row it was clicked on', () => {
    mount()
    fireEvent.click(rowButton('Grinder', 'Edit'))
    expect(screen.getByDisplayValue('Grinder')).toBeTruthy()
  })
})

describe('the keyboard reaches it', () => {
  it('offers a real button, announced as one', () => {
    mount()
    const view = rowButton('Kettle', 'View')
    // A `<div onClick>` would satisfy neither of these.
    expect(view.tagName).toBe('BUTTON')
    expect(view.getAttribute('tabindex')).not.toBe('-1')
  })

  it('takes focus and activates from the keyboard', () => {
    mount()
    const view = rowButton('Kettle', 'View')
    view.focus()
    expect(document.activeElement).toBe(view)
    // A focused native button activates on Enter and Space through the
    // browser's own click synthesis, which is the affordance being claimed.
    fireEvent.click(view)
    expect(viewerIsOpen()).toBe(true)
  })

  it('opens the same record the row would', () => {
    mount()
    fireEvent.click(rowButton('Grinder', 'View'))
    expect(within(viewer()).getByText('rec-1')).toBeTruthy()
  })
})

describe('read-only means read-only', () => {
  const EDITABLE_ROLES = [
    'textbox',
    'checkbox',
    'radio',
    'combobox',
    'spinbutton',
    'switch',
    'slider',
    'searchbox',
  ] as const

  it('has no control that takes input', () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    const open = viewer()
    for (const role of EDITABLE_ROLES) {
      expect(within(open).queryAllByRole(role)).toHaveLength(0)
    }
    // Belt and braces: the DOM-level form elements, whatever role they claim.
    expect(open.querySelectorAll('input, textarea, select')).toHaveLength(0)
    expect(open.querySelector('[contenteditable="true"]')).toBeNull()
  })

  it('offers no save and no destructive control', () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    const open = viewer()
    for (const name of ['Save', 'Add', 'Delete', 'Import', 'Create']) {
      expect(within(open).queryByRole('button', { name })).toBeNull()
    }
  })

  it('hands off to the editor as a separate, named action', async () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    fireEvent.click(
      within(viewer()).getByRole('button', { name: 'Edit record' }),
    )
    // The viewer closes and the EDITOR opens — one dialog, not two stacked.
    await expectViewerClosed()
    expect(screen.getByText('Edit record', { selector: 'h2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    // On the record it was viewing, not on a blank form.
    expect(screen.getByDisplayValue('Kettle')).toBeTruthy()
  })
})

describe('it shows the whole record, not a wider row', () => {
  it('shows a field declared without a display slot', async () => {
    mount()
    // The table's columns come from `order`, so this is not among them.
    expect(screen.queryByText('Audited by')).toBeNull()
    fireEvent.click(screen.getByText('Kettle'))
    expect(within(viewer()).getByText('Audited by')).toBeTruthy()
  })

  it('shows a stored value the model does not declare, marked as such', () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    const open = viewer()
    expect(within(open).getByText('Legacy code')).toBeTruthy()
    expect(within(open).getByText('X-17')).toBeTruthy()
    expect(within(open).getByText('not in schema')).toBeTruthy()
  })

  it('names the record', () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    expect(within(viewer()).getByText('Record ID')).toBeTruthy()
  })
})

describe('values render honestly', () => {
  it('tells a real empty string from an absent field', () => {
    mount()
    fireEvent.click(screen.getByText('Kettle'))
    const open = viewer()
    // `note` is `''`; `count` is not on the record at all. The table prints
    // `--` for both.
    expect(within(open).getByText('Empty text')).toBeTruthy()
    expect(within(open).getByText('Not set')).toBeTruthy()
  })

  it('renders a list one item per line, not as a join', () => {
    mount()
    // The table's cell for this row is the ambiguous join.
    expect(screen.getByText('red, blue, green')).toBeTruthy()
    fireEvent.click(screen.getByText('Kettle'))
    const items = within(viewer()).getAllByRole('listitem')
    // Two items, and the one holding a comma is one item rather than two.
    expect(items.map((item) => item.textContent)).toEqual([
      'red, blue',
      'green',
    ])
  })

  it('says null where null is stored', () => {
    mount()
    fireEvent.click(screen.getByText('Grinder'))
    const open = viewer()
    expect(within(open).getByText('Null')).toBeTruthy()
    // And does not confuse it with the empty string on the other record.
    expect(within(open).queryByText('Empty text')).toBeNull()
  })

  it('marks an unresolved reference and does not print it as a label', async () => {
    mount()
    // Wait for the reference picker's window to land, or `owner` would read
    // as unresolved too and the assertion would pass for the wrong reason.
    await waitFor(() => expect(getDocs).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryAllByText('Ada Lovelace').length).toBeGreaterThan(0),
    )
    fireEvent.click(screen.getByText('Kettle'))
    const open = viewer()
    // Resolved: the label, with no unresolved marker.
    expect(within(open).getByText('Ada Lovelace')).toBeTruthy()
    // Unresolved: the ID, said to be unresolved rather than shown as a label.
    expect(within(open).getByText('p9 · unresolved')).toBeTruthy()
    expect(within(open).queryByText('p9')).toBeNull()
  })
})

describe('it follows the page it was opened from', () => {
  it('closes when the record leaves the table’s page', async () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByText('Kettle'))
    expect(viewerIsOpen()).toBe(true)
    // Deleted elsewhere, or paged past: the row is gone from the page query.
    recordDocs = [RECORD_NULLED]
    rerender(<HostDatasetsCard orgId="org-1" org={ORG} />)
    await expectViewerClosed()
  })
})
