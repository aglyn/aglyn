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
 * The stock ledger's filters are its QUERY's, and its pages are the query's
 * pages (AGL-3321).
 *
 * The ledger used to read its hundred newest movements and filter and page
 * those in the browser. A reason filter over that window answered "none"
 * about a ledger whose damage was older than the hundredth movement.
 *
 * ## What this file has to catch
 *
 *  - A CLAUSE THAT IS NOT ON THE QUERY. `useListQuery` is the contract's
 *    double, which runs the real plan and answers it the way Firestore would
 *    over a ledger far larger than any page, with every damage row past the
 *    first two pages. A card that matched its clause over the rows it had
 *    would find no damage at all here.
 *  - A REFUSAL READ AS AN ANSWER. A combination one query cannot hold is
 *    named above the table, through `listQueryRefusals`.
 *  - A MISSING INDEX. Every shape the declaration can put on the query has
 *    its composite in the index file, or it would throw FAILED_PRECONDITION
 *    in production and nowhere else.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { STOCK_MOVEMENT_QUERY } from '../../constants/stock-movement-query'
import { StockMovementsCard } from './stock-movements-card.component'

/*
 * The real grid, with its props kept so a case can set a filter the way the
 * grid's Filters panel does: through `onFilterModelChange`.
 */
let mockGrid: {
  filterModel: { quickFilterValues?: unknown[] }
  onFilterModelChange: (model: {
    items: Array<Record<string, unknown>>
    quickFilterValues?: unknown[]
  }) => void
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
/** Sets one item in the grid's Filters panel. */
const setFilter = (field: string, operator: string, value: unknown) =>
  act(() =>
    mockGrid.onFilterModelChange({
      items: [{ id: 'panel', field, operator, value }],
      quickFilterValues: mockGrid.filterModel.quickFilterValues,
    }),
  )

jest.setTimeout(30_000)

/** The double's page, which is the card's default. */
const PAGE = 10
/** How many movements the fixture holds: many pages deep. */
const LEDGER_SIZE = 140
const NOW = 1_800_000_000_000

/**
 * Newest first. Every damage row is deliberately deep — past the first page
 * and past the second — so a filter that narrowed a page, or a window,
 * would report a shop that has never damaged anything.
 */
const mockLedger = Array.from({ length: LEDGER_SIZE }, (_, index) => ({
  $id: `adj-${String(index).padStart(3, '0')}`,
  atMs: NOW - index * 60 * 60 * 1000,
  productId: `prod-${index % 7}`,
  variantId: 'v1',
  delta: index % 2 === 0 ? -1 : 2,
  reason: index >= 40 && index % 5 === 0 ? 'damage' : 'sale',
  ...(index % 3 === 0 ? { orderId: `ord-${index}` } : {}),
}))
const DAMAGE = mockLedger.filter((row) => row.reason === 'damage')

const mockProducts = Array.from({ length: 7 }, (_, index) => ({
  $id: `prod-${index}`,
  name: `Product ${index}`,
}))

/*
 * The contract's double in place of the hook. (`listQueryModule` would be the
 * one-liner, but it reaches `jest` through `globalThis`, which the runner does
 * not set — so the double's hook is wired here beside the real module.)
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    useListQuery: (options: unknown) => useListQueryDouble(() => mockLedger, options),
  }
})
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  useFirestoreCollection: (build: () => string) => ({
    data: build().endsWith('/products') ? mockProducts : [],
    status: 'success',
    fromCache: false,
  }),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const renderedIds = () =>
  Array.from(document.querySelectorAll('.MuiDataGrid-row')).map(
    (row) => row.getAttribute('data-id') ?? '',
  )
const renderedReasons = () =>
  Array.from(document.querySelectorAll('.MuiDataGrid-row')).map(
    (row) => row.querySelector('[data-field="reason"]')?.textContent?.trim() ?? '',
  )
const filtersAsked = () => lastListQueryPlan()?.filters ?? []

describe('the stock ledger pages its query (AGL-3321)', () => {
  it('THE CONTROL: the ledger is many pages deep and its damage is past two of them', () => {
    expect(LEDGER_SIZE).toBeGreaterThan(PAGE * 10)
    expect(DAMAGE.length).toBeGreaterThan(PAGE)
    expect(mockLedger.findIndex((row) => row.reason === 'damage')).toBeGreaterThan(PAGE * 2)
  })

  it('asks for the ledger newest first, with nothing narrowing it', () => {
    render(<StockMovementsCard hostId="host-1" />)
    expect(filtersAsked()).toEqual([])
    expect(lastListQueryPlan()?.orderBy).toMatchObject({ path: 'atMs', direction: 'desc' })
    expect(renderedIds()).toEqual(mockLedger.slice(0, PAGE).map((row) => row.$id))
    // "of more than": the footer knows there is a next page, not how many
    // movements the ledger holds.
    expect(
      document.querySelector('.MuiTablePagination-displayedRows')?.textContent,
    ).toContain('more than')
  })

  it('pages FORWARD through the query', async () => {
    render(<StockMovementsCard hostId="host-1" />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() =>
      expect(renderedIds()).toEqual(mockLedger.slice(PAGE, PAGE * 2).map((row) => row.$id)),
    )
  })

  it('puts the reason filter ON THE QUERY, and finds damage no unfiltered page held', async () => {
    render(<StockMovementsCard hostId="host-1" />)
    setFilter('reason', 'is', 'damage')
    await waitFor(() =>
      expect(filtersAsked()).toEqual([{ path: 'reason', op: '==', value: 'damage' }]),
    )
    // The first match sits past the first two unfiltered pages.
    expect(renderedIds()).toEqual(DAMAGE.slice(0, PAGE).map((row) => row.$id))
    expect(renderedReasons().every((reason) => reason === 'Damaged')).toBe(true)
  })

  it('composes product, reason and a date range into ONE query', async () => {
    render(<StockMovementsCard hostId="host-1" />)
    setFilter('reason', 'is', 'damage')
    setFilter('productId', 'is', 'prod-5')
    const day = new Date(DAMAGE[DAMAGE.length - 1].atMs)
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    setFilter('atMs', 'onOrAfter', ymd)
    await waitFor(() => expect(filtersAsked()).toHaveLength(3))
    const start = new Date(day)
    start.setHours(0, 0, 0, 0)
    expect(filtersAsked()).toEqual(
      expect.arrayContaining([
        { path: 'reason', op: '==', value: 'damage' },
        { path: 'productId', op: '==', value: 'prod-5' },
        // Epoch milliseconds, compared as the number the writers store.
        { path: 'atMs', op: '>=', value: start.getTime() },
      ]),
    )
    const expected = DAMAGE.filter(
      (row) => row.productId === 'prod-5' && row.atMs >= start.getTime(),
    )
    expect(expected.length).toBeGreaterThan(0)
    expect(renderedIds()).toEqual(expected.slice(0, PAGE).map((row) => row.$id))
  })

  it('finds an order’s movements by the Order filter, far past the first page', async () => {
    render(<StockMovementsCard hostId="host-1" />)
    setFilter('orderId', 'equals', 'ord-120')
    await waitFor(() =>
      expect(filtersAsked()).toEqual([{ path: 'orderId', op: '==', value: 'ord-120' }]),
    )
    expect(renderedIds()).toEqual(['adj-120'])
    expect(screen.getByText(/order ord-120/)).toBeTruthy()
  })

  it('names a combination one query cannot hold, rather than answering part of it', async () => {
    render(<StockMovementsCard hostId="host-1" />)
    // Seven products times two reasons is 14 disjunctions; then seven more
    // products would be 49, past Firestore's 30.
    setFilter('productId', 'isAnyOf', mockProducts.map((product) => product.$id))
    setFilter('reason', 'isAnyOf', ['sale', 'damage', 'restock', 'correction', 'refund'])
    await waitFor(() => expect(lastListQueryPlan()?.refused).toHaveLength(1))
    const notice = screen.getByRole('status', { name: 'Filter notices' })
    expect(notice.textContent).toContain('Reason is any of Sale, Damaged')
    expect(notice.textContent).toContain('is not applied: too many values at once')
    // The clause that WAS served still stands on the query.
    expect(filtersAsked()).toEqual([
      { path: 'productId', op: 'in', value: mockProducts.map((product) => product.$id) },
    ])
  })

  it('offers no quick search: the name a reader would type is not on the ledger', () => {
    render(<StockMovementsCard hostId="host-1" />)
    expect(STOCK_MOVEMENT_QUERY.search).toBeUndefined()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})

describe('every shape the ledger can ask has its index (AGL-3321)', () => {
  const indexFile = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'),
      'utf8',
    ),
  )
  const needed = listQueryIndexes(STOCK_MOVEMENT_QUERY)

  it('THE CONTROL: the declaration needs one composite per filtered field', () => {
    // Product, reason, order and location, each beneath `atMs` DESC. The date
    // filter is a range on the order itself and needs none.
    expect(
      needed.map((index) =>
        index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','),
      ),
    ).toEqual([
      'productId:ASCENDING,atMs:DESCENDING',
      'reason:ASCENDING,atMs:DESCENDING',
      'orderId:ASCENDING,atMs:DESCENDING',
      'locationId:ASCENDING,atMs:DESCENDING',
    ])
  })

  it('declares every one of them at collection scope', () => {
    expect(
      missingListQueryIndexes(indexFile, 'inventoryAdjustments', needed, 'COLLECTION'),
    ).toEqual([])
  })

  it('declares no stock composite the ledger does not need', () => {
    const shape = (fields: Array<{ fieldPath: string; order?: string }>) =>
      fields.map((field) => `${field.fieldPath}:${field.order}`).join(',')
    const declared = indexFile.indexes
      .filter((index: { collectionGroup: string }) => index.collectionGroup === 'inventoryAdjustments')
      .map((index: { fields: Array<{ fieldPath: string; order?: string }> }) => shape(index.fields))
    expect(declared.sort()).toEqual(needed.map((index) => shape(index.fields)).sort())
  })
})
