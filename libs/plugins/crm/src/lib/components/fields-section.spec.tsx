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
 * THE FIELDS SECTION'S TABS (AGL-2661).
 *
 * What the tabs have to hold: the list asks the definitions hook for the
 * tab's object and nothing else, a field created on a tab is STAMPED with
 * that object, and the drawer's copy names it — so a company field can
 * never be filed as a contact field by a tab that forgot to say which.
 *
 * Since AGL-3335 each tab is the console's list table: paged, sorted by
 * Field, Key and Type, filtered by Type and Required, searched by name and
 * key — with the stored order still moved by the arrows, which wait while
 * any sort, filter or search is in force.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { ContactsFieldsSection } from './fields-section'

const definitionsFor = jest.fn()

// The org's lead source list (AGL-3298), read as the starter set.
jest.mock('../hooks/use-lead-source-picklist', () => {
  const { effectiveCrmLeadSourcePicklist } = jest.requireActual('@aglyn/aglyn/app-utils/crm')
  const picklist = effectiveCrmLeadSourcePicklist(null)
  return {
    useLeadSourcePicklist: () => ({ picklist, stored: false, ready: true, fromCache: false }),
  }
})

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  // `doc(db, ...segments)` and `doc(collectionRef, id)` both land here; the
  // db handle is `{}` and contributes nothing, a ref contributes its path.
  doc: (...segments: unknown[]) => ({
    path: segments
      .map((segment) =>
        typeof segment === 'string' ? segment : String((segment as { path?: string }).path ?? ''),
      )
      .filter(Boolean)
      .join('/'),
  }),
  setDoc: jest.fn(async () => undefined),
  serverTimestamp: () => 'server-time',
  updateDoc: jest.fn(async () => undefined),
  deleteDoc: jest.fn(async () => undefined),
  writeBatch: () => ({
    update: (ref: { path: string }, data: Record<string, unknown>) =>
      void batched.push({ path: ref.path, data }),
    commit: jest.fn(async () => undefined),
  }),
}))

/** Every update a reorder batched, by document path. */
let batched: Array<{ path: string; data: Record<string, unknown> }> = []

/*
 * The real grid, with its props kept so a case can sort, filter and search
 * the way the grid's own toolbar does: through the change handlers.
 */
let mockGrid: {
  rows: Array<{ key: string }>
  filterModel: { quickFilterValues?: unknown[] }
  onFilterModelChange: (model: {
    items: Array<Record<string, unknown>>
    quickFilterValues?: unknown[]
  }) => void
  onSortModelChange: (model: Array<{ field: string; sort: 'asc' | 'desc' }>) => void
}
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-jsx/components/list-table.component')
  return {
    ...actual,
    ListTable: (props: typeof mockGrid) => {
      mockGrid = props
      return <actual.ListTable {...props} />
    },
  }
})
jest.mock('../hooks/use-crm-scope', () => ({
  useCrmScope: () => ({
    scope: ['orgs', 'org-1'],
    orgId: 'org-1',
    ready: true,
    createHostId: 'host-1',
  }),
}))
jest.mock('../hooks/use-contact-field-definitions', () => ({
  useContactFieldDefinitions: (orgId: string, object: string) => definitionsFor(orgId, object),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  // The maintenance recompute (AGL-2661) calls the route as the signed-in user.
  useUser: () => ({ data: null }),
  writeGuardedBySeed: async (_seed: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => {
  // The card's empty state, and the grid's no-rows overlay, which draws it too.
  const EmptyState = ({ label, action }: { label: string; action?: ReactNode }) => (
    <div>
      <p>{label}</p>
      {action}
    </div>
  )
  return { __esModule: true, default: EmptyState, EmptyStateComponent: EmptyState }
})
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: () => null,
}))

const empty = { definitions: [], active: [], ready: true, fromCache: false }

beforeEach(() => {
  jest.clearAllMocks()
  definitionsFor.mockReturnValue(empty)
  batched = []
})

describe('the Fields section tabs (AGL-2661)', () => {
  it('opens on Contacts and asks the hook for that object alone', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    expect(screen.getByRole('tab', { name: 'Contacts' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Companies' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Deals' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Leads' })).toBeTruthy()
    expect(definitionsFor).toHaveBeenLastCalledWith('org-1', 'contact')
    expect(screen.getByText('No custom contact fields yet')).toBeTruthy()
  })

  it('switches the list, the copy and the drawer to the picked object', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Companies' }))
    expect(definitionsFor).toHaveBeenLastCalledWith('org-1', 'company')
    expect(screen.getByText('No custom company fields yet')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'New field' })[0])
    expect(screen.getByText('New company field')).toBeTruthy()
    expect(screen.getByText(/saves into contact fields only/)).toBeTruthy()
  })

  it('stamps a field created on the Deals tab with object: deal', async () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'New field' })[0])
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Tier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create field' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, data] = (setDoc as jest.Mock).mock.calls[0]
    expect(ref.path).toMatch(/^orgs\/org-1\/contactFields\//)
    expect(data).toMatchObject({ key: 'tier', label: 'Tier', object: 'deal', hostId: 'host-1' })
  })

  /*
   * THE LEADS TAB (AGL-3272). A lead is a record of its own and was the
   * one CRM record an org could not describe in its own words; these two
   * hold the seam the other tabs hold — the hook is asked for `lead`
   * alone, and what is created is STAMPED `object: 'lead'` rather than
   * filed as a contact field by a tab that forgot to say which.
   */
  it('switches the list and the copy to leads', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }))
    expect(definitionsFor).toHaveBeenLastCalledWith('org-1', 'lead')
    expect(screen.getByText('No custom lead fields yet')).toBeTruthy()
  })

  it('stamps a field created on the Leads tab with object: lead, and promises no import', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'New field' })[0])
    expect(screen.getByText('New lead field')).toBeTruthy()
    // The leads file carries the standard columns only, so the drawer must
    // not offer a CSV import that would silently drop the column.
    expect(screen.getByText(/filled on the record or over the API/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Budget' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create field' }))
    return waitFor(() => {
      expect(setDoc).toHaveBeenCalledTimes(1)
      const [, data] = (setDoc as jest.Mock).mock.calls[0]
      expect(data).toMatchObject({ key: 'budget', label: 'Budget', object: 'lead' })
    })
  })
})

/*
 * Lead source values (AGL-3298) — Salesforce's Lead Source picklist, kept
 * on the Leads tab. The list is the org's (here the starter set, which an
 * org reads until it writes its own), and a list-only move such as Add is
 * one write of the whole document, stamped org-wide the first time.
 */
describe('the lead source values on the Leads tab (AGL-3298)', () => {
  it('lists the values only on the Leads tab', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    expect(screen.queryByRole('table', { name: 'Lead source values' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }))
    const table = screen.getByRole('table', { name: 'Lead source values' })
    for (const label of ['Web', 'Phone inquiry', 'Referral', 'Trade show', 'Other']) {
      expect(table.textContent).toContain(label)
    }
    expect(screen.getByText(/This is the starter list/)).toBeTruthy()
  })

  it('adds a value last, writing the whole list with the org-wide stamp', async () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'Webinar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, written, options] = (setDoc as jest.Mock).mock.calls[0]
    expect(ref.path).toBe('orgs/org-1/crmPicklists/leadSource')
    expect(options).toEqual({ merge: true })
    expect(written.values.at(-1)).toEqual({ id: 'webinar', label: 'Webinar', active: true })
    expect(written.values).toHaveLength(8)
    expect(written).toMatchObject({ hostId: 'host-1', visibleTo: ['org'], defaultValueId: null })
  })

  it('refuses a value the list already holds, in any case, and writes nothing', () => {
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'trade SHOW' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('“Trade show” is already in the list.')).toBeTruthy()
    expect(setDoc).not.toHaveBeenCalled()
  })
})

/*
 * THE LIST TABLE (AGL-3335). Order is data — where a field appears on every
 * record and form — so it stays editable, and only while the table shows it.
 */
describe('the Fields list table (AGL-3335)', () => {
  const field = (key: string, label: string, order: number, extra: Record<string, unknown> = {}) => ({
    $id: `f-${key}`,
    key,
    label,
    type: 'text',
    order,
    required: false,
    retiredAt: null,
    ...extra,
  })
  const TWELVE = [
    field('plan_interest', 'Plan interest', 0, { type: 'select', options: ['Starter', 'Pro'] }),
    field('tier', 'Tier', 1, { required: true }),
    ...Array.from({ length: 10 }, (_, index) => field(`extra_${index}`, `Extra ${index}`, index + 2, {
      type: index % 2 ? 'number' : 'date',
    })),
  ]
  const withFields = (definitions: unknown[]) =>
    definitionsFor.mockReturnValue({ definitions, active: definitions, ready: true, fromCache: false })
  const arrow = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

  jest.setTimeout(30_000)

  it('draws each field with its key, type and choices, and pages past ten', () => {
    withFields(TWELVE)
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    expect(screen.getByText('plan_interest')).toBeTruthy()
    expect(screen.getByText('Choice · 2 choices')).toBeTruthy()
    // The eleventh and twelfth fields are on the next page.
    expect(screen.queryByText('Extra 9')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(screen.getByText('Extra 9')).toBeTruthy()
    expect(screen.queryByText('plan_interest')).toBeNull()
  })

  it('finds plan_interest by searching "plan", and holds the arrows while it does', () => {
    withFields(TWELVE)
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    expect(arrow('Move Tier up').disabled).toBe(false)
    act(() => mockGrid.onFilterModelChange({ items: [], quickFilterValues: ['plan'] }))
    expect(mockGrid.rows.map((row) => row.key)).toEqual(['plan_interest'])
    expect(arrow('Move Plan interest down').disabled).toBe(true)
    expect(screen.getByLabelText('Clear sorting and filters to reorder')).toBeTruthy()
  })

  it('filters by Type and by Required', () => {
    withFields(TWELVE)
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    act(() =>
      mockGrid.onFilterModelChange({
        items: [{ id: 'panel', field: 'type', operator: 'is', value: 'number' }],
      }),
    )
    expect(mockGrid.rows).toHaveLength(5)
    act(() =>
      mockGrid.onFilterModelChange({
        items: [{ id: 'panel', field: 'required', operator: 'is', value: 'required' }],
      }),
    )
    // Filtering one column and then another is both: no number is required.
    expect(mockGrid.rows).toHaveLength(0)
  })

  it('disables reorder while sorted by Type, and clearing the sort brings it back', () => {
    withFields(TWELVE)
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    act(() => mockGrid.onSortModelChange([{ field: 'type', sort: 'asc' }]))
    // Choice sorts first, so the choice field leads the page.
    expect(arrow('Move Plan interest down').disabled).toBe(true)
    // Every row's arrows say why.
    expect(screen.getAllByLabelText('Clear sorting and filters to reorder')).toHaveLength(10)
    act(() => mockGrid.onSortModelChange([]))
    expect(arrow('Move Plan interest down').disabled).toBe(false)
    expect(arrow('Move Tier up').disabled).toBe(false)
    expect(screen.queryByLabelText('Clear sorting and filters to reorder')).toBeNull()
  })

  it('still writes the stored order when a field is moved', async () => {
    withFields(TWELVE.slice(0, 3))
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    fireEvent.click(arrow('Move Tier up'))
    await waitFor(() => expect(batched).toHaveLength(2))
    expect(batched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'orgs/org-1/contactFields/f-tier', data: expect.objectContaining({ order: 0 }) }),
        expect.objectContaining({
          path: 'orgs/org-1/contactFields/f-plan_interest',
          data: expect.objectContaining({ order: 1 }),
        }),
      ]),
    )
  })

  it('keeps the header actions and the note on what is not counted', () => {
    withFields(TWELVE.slice(0, 2))
    render(<ContactsFieldsSection hostId="host-1" org={{}} />)
    const card = screen.getByRole('region', { name: 'Fields' })
    expect(within(card).getByRole('button', { name: 'Recompute next activity' })).toBeTruthy()
    expect(within(card).getAllByRole('button', { name: 'New field' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/is not counted/)).toBeTruthy()
  })
})
