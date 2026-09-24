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
 * The records grid filters the DATASET, not the page on screen.
 *
 * The fixture puts the only matching records past the first page of the
 * unfiltered walk, so a filter that narrowed the loaded page would find
 * nothing. A served filter reaches them because the query itself carries the
 * `filterKeys` token; a filter the query cannot serve alone reads a window
 * and matches the rest in memory.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { datasetFilterKeys } from '@aglyn/aglyn'
import { HostDatasetsCard } from './host-datasets-card.component'
import { RECORD_FILTER_WINDOW } from './dataset-record-filter'

jest.setTimeout(30_000)

const ORG = { $id: 'org-1', plan: 'scale' } as any

const MODEL = {
  order: ['name', 'status', 'price'],
  fields: {
    name: { name: 'Name', type: 'text' },
    status: {
      name: 'Status',
      type: 'text',
      validation: { options: ['Open', 'Closed'] },
    },
    price: { name: 'Price', type: 'float' },
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
 * Sixty records, id-ordered. Only the last few are kettles, and only rec-57
 * is Closed — all far past the first page of ten.
 */
const recordDocs = Array.from({ length: 60 }, (_, index) => {
  const values = {
    name: index >= 55 ? (index % 2 ? 'Red Kettle' : 'Blue Kettle') : `Mug ${index}`,
    status: index === 57 ? 'Closed' : 'Open',
    price: index,
  }
  return {
    $id: `rec-${String(index).padStart(2, '0')}`,
    values,
    filterKeys: datasetFilterKeys(MODEL as any, values),
  }
})

/** Firestore's answer: `array-contains`, then document-name order, then the limit. */
const answer = (constraints: Array<Record<string, any>>) => {
  const contains = constraints.find((item) => item.op === 'array-contains')
  const cap = constraints.find((item) => 'limit' in item)?.limit
  const matching = contains
    ? recordDocs.filter((doc) => doc.filterKeys.includes(contains.value))
    : recordDocs
  const sorted = [...matching].sort((a, b) => (a.$id < b.$id ? -1 : 1))
  return typeof cap === 'number' ? sorted.slice(0, cap) : sorted
}

/** Every records query the card ran: its token and its limit. */
let mockRecordQueries: Array<{ via: 'page' | 'window'; token: string | null; limit: number }> = []
const record = (via: 'page' | 'window', built: any) => {
  const constraints = built?.constraints ?? []
  mockRecordQueries.push({
    via,
    token: constraints.find((item: any) => item.op === 'array-contains')?.value ?? null,
    limit: constraints.find((item: any) => 'limit' in item)?.limit,
  })
  return answer(constraints)
}

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
    return {
      data: path.endsWith('/records') ? record('window', built) : [],
      status: 'success',
      fromCache: false,
    }
  },
  usePagedCollection: (build: (pageLimit: number) => any) => {
    const { useState } = require('react')
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(10)
    const windowSize = pageSize * (page + 1)
    const built = build(windowSize + 1)
    const answered = String(built?.path ?? '').endsWith('/records')
      ? record('page', built)
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
  fireEvent.click(screen.getByRole('button', { name: /filters/i }))
  const panel = (await screen.findByRole('tooltip')) as HTMLElement
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

describe('THE CONTROL', () => {
  it('the matching records are not on the first page of the walk', async () => {
    await mountCard()
    expect(shownNames()).toHaveLength(10)
    expect(shownNames().some((name) => name.includes('Kettle'))).toBe(false)
    expect(mockRecordQueries.at(-1)).toEqual({ via: 'page', token: null, limit: 11 })
  })
})

describe('a served condition reaches every record', () => {
  it('a search word narrows the QUERY by its token', async () => {
    await mountCard()
    search('kett')
    await waitFor(() =>
      expect(mockRecordQueries.at(-1)).toEqual({
        via: 'page',
        token: 's:kett',
        limit: 11,
      }),
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

  it('a field filter narrows the QUERY by its token, and its chip says so', async () => {
    await mountCard()
    await filterBy('Status', null, 'Closed')
    await waitFor(() =>
      expect(mockRecordQueries.at(-1)).toEqual({
        via: 'page',
        token: 'f:status=Closed',
        limit: 11,
      }),
    )
    await waitFor(() => expect(shownNames()).toEqual(['Red Kettle']))
    const chip = within(screen.getByRole('list', { name: 'Filters' })).getByRole(
      'listitem',
    )
    expect(chip.textContent).toContain('Status')
    // Marked as the one that reached every record.
    expect(chip.className).toContain('MuiChip-colorPrimary')
  })
})

describe('what one token cannot serve is matched over a window', () => {
  it('two search words: the first is served, the second matched in memory', async () => {
    await mountCard()
    search('red kettle')
    await waitFor(() =>
      expect(mockRecordQueries.at(-1)).toEqual({
        via: 'window',
        token: 's:red',
        limit: RECORD_FILTER_WINDOW + 1,
      }),
    )
    await waitFor(() =>
      expect(shownNames()).toEqual(['Red Kettle', 'Red Kettle', 'Red Kettle']),
    )
  })

  it('a number range reads the plain walk as a window', async () => {
    await mountCard()
    await filterBy('Price', '>', '57')
    await waitFor(() =>
      expect(mockRecordQueries.at(-1)).toEqual({
        via: 'window',
        token: null,
        limit: RECORD_FILTER_WINDOW + 1,
      }),
    )
    await waitFor(() => expect(shownNames()).toEqual(['Blue Kettle', 'Red Kettle']))
    // A range narrows the window, so its chip is not marked as served.
    const chip = within(screen.getByRole('list', { name: 'Filters' })).getByRole(
      'listitem',
    )
    expect(chip.className).not.toContain('MuiChip-colorPrimary')
  })
})
