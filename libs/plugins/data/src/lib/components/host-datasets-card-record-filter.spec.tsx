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
 * The records grid filters the DATASET, not the page on screen (AGL-3321).
 *
 * The fixture puts the only matching records past the first page of the
 * unfiltered walk, so a filter that narrowed the loaded page would find
 * nothing. Every clause and the search word are predicates on the records
 * query — equalities on `filterValues`, one word-level clause on
 * `filterKeys` — answered here the way Firestore answers them, so a record
 * past the first page is found and nothing is matched over loaded rows.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { datasetIntegrityFields } from '@aglyn/aglyn'
import { rowAnswers } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { HostDatasetsCard } from './host-datasets-card.component'

jest.setTimeout(30_000)

const ORG = { $id: 'org-1', plan: 'scale' } as any

const MODEL = {
  order: ['name', 'status', 'price', 'active', 'tags', 'due'],
  fields: {
    name: { name: 'Name', type: 'text' },
    status: {
      name: 'Status',
      type: 'text',
      validation: { options: ['Open', 'Closed'] },
    },
    price: { name: 'Price', type: 'float' },
    active: { name: 'Active', type: 'bool' },
    tags: { name: 'Tags', type: 'sorted' },
    due: { name: 'Due', type: 'timestamp' },
  },
} as const

const DATASET = {
  $id: 'ds-1',
  displayName: 'Products',
  model: MODEL,
  visibleTo: ['org'],
}
// One array for every render, as a listener hands back until it changes.
const DATASETS = [DATASET]

/**
 * Sixty records, id-ordered, each carrying the filter fields its writers
 * stamp. Only the last few are kettles, only rec-57 is Closed, and only the
 * red kettles are tagged `gift` — all far past the first page of ten.
 */
const recordDocs = Array.from({ length: 60 }, (_, index) => {
  const values = {
    name: index >= 55 ? (index % 2 ? 'Red Kettle' : 'Blue Kettle') : `Mug ${index}`,
    status: index === 57 ? 'Closed' : 'Open',
    price: index,
    active: index % 2 === 1,
    tags: index >= 55 && index % 2 ? ['gift'] : ['kitchen'],
    due: 1_700_000_000_000 + index,
  }
  return {
    $id: `rec-${String(index).padStart(2, '0')}`,
    values,
    ...datasetIntegrityFields(MODEL as any, values),
  }
})

type Constraint = Record<string, any>

/** Firestore's answer: every predicate, then document-name order, then the limit. */
const answer = (constraints: Constraint[]) => {
  const predicates = constraints
    .filter((item) => 'op' in item)
    .map((item) => ({ path: item.field, op: item.op, value: item.value }))
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const matching = recordDocs.filter((doc) =>
    predicates.every((predicate) => rowAnswers(doc as any, predicate)),
  )
  const sorted = [...matching].sort((a, b) => (a.$id < b.$id ? -1 : 1))
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every records query the card ran: its predicates, order and limit. */
let mockRecordQueries: Array<{
  where: Array<[string, string, unknown]>
  orderBy: unknown
  limit: number
}> = []
const record = (built: any) => {
  const constraints: Constraint[] = built?.constraints ?? []
  mockRecordQueries.push({
    where: constraints
      .filter((item) => 'op' in item)
      .map((item) => [item.field, item.op, item.value]),
    orderBy: constraints.find((item) => 'orderBy' in item)?.orderBy,
    limit: constraints.find((item) => 'limit' in item)?.limit,
  })
  return answer(constraints)
}
const lastQuery = () => mockRecordQueries.at(-1)

// Stable across renders, as the real hooks are: the card's count effects
// re-run whenever either changes identity.
const mockFirestore = {}
const mockDataScope = { scope: ['orgs', 'org-1'], orgId: 'org-1' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useOrgDataScope: () => mockDataScope,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const path = String(built?.path ?? '')
    if (path.endsWith('/datasets')) {
      return { data: DATASETS, status: 'success', fromCache: false }
    }
    // The records table reads no listener: a window read here is the bug.
    if (path.endsWith('/records')) throw new Error('records read through a listener')
    return { data: [], status: 'success', fromCache: false }
  },
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(10)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const answered = String(built?.path ?? '').endsWith('/records')
      ? record(built)
      : []
    return {
      rows: answered.slice(page * pageSize, windowSize),
      hasMore: answered.length > windowSize,
      page,
      setPage,
      pageSize,
      setPageSize,
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  Timestamp: { fromDate: (date: Date) => date },
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => Symbol('deleteField'),
  getCountFromServer: async () => ({ data: () => ({ count: 60 }) }),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

const mockSnackbar = { enqueueSnackbar: jest.fn() }
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => mockSnackbar,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

beforeEach(() => {
  mockRecordQueries = []
})

const mountCard = async () => {
  render(<HostDatasetsCard orgId="org-1" org={ORG} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The Name cell of every rendered row. */
const shownNames = () =>
  Array.from(document.querySelectorAll('[role="row"][data-id]')).map(
    (row) =>
      row.querySelector('[data-field="values.name"]')?.textContent?.trim() ?? '',
  )

const search = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } })

/** Picks an option from one of the panel's selects. */
const pick = async (panel: HTMLElement, label: string, option: string) => {
  fireEvent.mouseDown(within(panel).getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

/** Sets the Filters panel's one row: a column, an operator, a value. */
const filterBy = async (column: string, operator: string | null, value: string) => {
  // The panel stays open after a value is set; clicking Filters again would close it.
  let panel = screen.queryByRole('tooltip') as HTMLElement | null
  if (!panel) {
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    panel = (await screen.findByRole('tooltip')) as HTMLElement
  }
  await pick(panel, 'Column', column)
  if (operator) await pick(panel, 'Operator', operator)
  const select = within(panel).queryByRole('combobox', { name: 'Value' })
  if (select) {
    await pick(panel, 'Value', value)
    return
  }
  const input =
    within(panel).queryByRole('spinbutton', { name: 'Value' }) ??
    within(panel).getByRole('textbox', { name: 'Value' })
  fireEvent.change(input, { target: { value } })
}

/** The notices above the table: refusals and what was served. */
const notices = () =>
  Array.from(document.querySelectorAll('[aria-label="Filter notices"] .MuiAlert-message')).map(
    (alert) => alert.textContent ?? '',
  )

describe('THE CONTROL', () => {
  it('the matching records are not on the first page of the walk', async () => {
    await mountCard()
    expect(shownNames()).toHaveLength(10)
    expect(shownNames().some((name) => name.includes('Kettle'))).toBe(false)
    expect(lastQuery()).toEqual({ where: [], orderBy: '__name__', limit: 11 })
  })
})

describe('every condition is on the query', () => {
  it('a search word asks the search token', async () => {
    await mountCard()
    search('kett')
    await waitFor(() =>
      expect(lastQuery()?.where).toEqual([['filterKeys', 'array-contains', 's:kett']]),
    )
    await waitFor(() =>
      expect(shownNames()).toEqual([
        'Red Kettle',
        'Blue Kettle',
        'Red Kettle',
        'Blue Kettle',
        'Red Kettle',
      ]),
    )
  })

  it('a picked option asks filterValues, and its chip reads as picked', async () => {
    await mountCard()
    await filterBy('Status', null, 'Closed')
    await waitFor(() =>
      expect(lastQuery()?.where).toEqual([['filterValues.status', '==', 'Closed']]),
    )
    await waitFor(() => expect(shownNames()).toEqual(['Red Kettle']))
    const chip = within(screen.getByRole('list', { name: 'Filters' })).getByRole('listitem')
    expect(chip.textContent).toContain('Status is Closed')
  })

  it('an equality and the search are ONE query, not a window', async () => {
    await mountCard()
    await filterBy('Status', null, 'Open')
    search('kett')
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        where: [
          ['filterKeys', 'array-contains', 's:kett'],
          ['filterValues.status', '==', 'Open'],
        ],
        orderBy: '__name__',
        limit: 11,
      }),
    )
    await waitFor(() =>
      expect(shownNames()).toEqual(['Red Kettle', 'Blue Kettle', 'Blue Kettle', 'Red Kettle']),
    )
    expect(notices()).toEqual([])
  })

  it('a text equality asks the lower-cased key; a number asks the number', async () => {
    await mountCard()
    await filterBy('Name', 'equals', '  RED kettle ')
    await waitFor(() =>
      expect(lastQuery()?.where).toEqual([['filterValues.name', '==', 'red kettle']]),
    )
    await filterBy('Price', '=', '57')
    await waitFor(() =>
      expect(lastQuery()?.where).toEqual([
        ['filterValues.name', '==', 'red kettle'],
        ['filterValues.price', '==', 57],
      ]),
    )
    await waitFor(() => expect(shownNames()).toEqual(['Red Kettle']))
  })

  it('a many-word contains asks the first word, and says so', async () => {
    await mountCard()
    await filterBy('Name', 'contains', 'red kettle')
    await waitFor(() =>
      expect(lastQuery()?.where).toEqual([['filterKeys', 'array-contains', 'f:name^red']]),
    )
    await waitFor(() => expect(shownNames()).toEqual(['Red Kettle', 'Red Kettle', 'Red Kettle']))
    expect(notices()).toEqual([
      'Name contains matches one word at a time: showing records with a word starting "red".',
    ])
  })
})

describe('what one query cannot hold is refused by name, never half-applied', () => {
  it('a list contains beside the search is refused, and the search stands', async () => {
    await mountCard()
    search('kett')
    await filterBy('Tags', 'contains', 'gift')
    await waitFor(() =>
      expect(notices()).toEqual([
        'Tags contains gift is not applied: cannot be combined with the search — clear the search to use it.',
      ]),
    )
    expect(lastQuery()?.where).toEqual([['filterKeys', 'array-contains', 's:kett']])
    // The refused clause keeps its chip, so the reader can remove it.
    expect(
      within(screen.getByRole('list', { name: 'Filters' })).getByRole('listitem').textContent,
    ).toContain('Tags contains gift')
  })

  it('offers no range, negation or empty check, and nothing on a timestamp', async () => {
    await mountCard()
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    const panel = (await screen.findByRole('tooltip')) as HTMLElement
    await pick(panel, 'Column', 'Price')
    fireEvent.mouseDown(within(panel).getByRole('combobox', { name: 'Operator' }))
    const operators = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(operators).toEqual(['='])
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.mouseDown(within(panel).getByRole('combobox', { name: 'Column' }))
    const columns = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(columns).not.toContain('Due')
    expect(columns).toEqual(expect.arrayContaining(['Name', 'Status', 'Price', 'Active', 'Tags']))
  })
})
