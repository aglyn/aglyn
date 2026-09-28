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
 * @jest-environment jsdom
 */

/**
 * The orders list's filters and search are its QUERY's, and its pages are the
 * query's pages (AGL-3321).
 *
 * The card used to read the newest two hundred orders and match its Filters
 * panel and search over them, so a Status filter on a busy store answered
 * "none" about every order past the two hundredth.
 *
 * ## What this file has to catch
 *
 *  - A CLAUSE OR SEARCH THAT IS NOT ON THE QUERY. `useListQuery` is the
 *    contract's double, which runs the real plan and answers it the way
 *    Firestore would over a store far larger than any page, with every match
 *    deep past the first pages. A card that matched over the rows it had
 *    would find nothing here.
 *  - A BANNER COUNTED OVER A PAGE. The open-dispute banner is its own query,
 *    so a deadline on an order no page shows is still raised.
 *  - AN EXPORT OF THE PAGE. Export CSV walks the list's plan, not the rows
 *    on screen.
 *  - A REFUSAL READ AS AN ANSWER. A combination one query cannot hold is
 *    named above the table, through `listQueryRefusals`.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  answerListQuery,
  lastListQueryPlan,
} from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { orderListFields } from '../../model/order-list-fields'

/*
 * The real grid, with its props kept so a case can set a filter and a search
 * the way the grid's toolbar does: through `onFilterModelChange`.
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
const setFilter = (field: string, operator: string, value: unknown) =>
  act(() =>
    mockGrid.onFilterModelChange({
      items: [{ id: 'panel', field, operator, value }],
      quickFilterValues: mockGrid.filterModel.quickFilterValues,
    }),
  )
const setSearch = (words: string[]) =>
  act(() =>
    mockGrid.onFilterModelChange({
      items: [],
      quickFilterValues: words,
    }),
  )

jest.setTimeout(30_000)

const NOW = Date.UTC(2026, 8, 20, 12, 0)
const DAY = 86_400_000
/** Many pages deep: the double's page is ten. */
const STORE_SIZE = 140

/**
 * Newest first. Every match below is deliberately deep — past the first page
 * and the second — so a card that narrowed a page, or a window of the first
 * few, would report a store that has none.
 */
const mockOrders = Array.from({ length: STORE_SIZE }, (_unused, index) => {
  const id = `order-${String(index).padStart(3, '0')}`
  const order: Record<string, unknown> = {
    number: 5000 - index,
    status: index >= 60 && index % 20 === 0 ? 'refunded' : 'paid',
    channel: 'online',
    customerEmail: index === 131 ? 'deep@buyer.test' : `buyer${index}@example.com`,
    createdAtMs: NOW - index * DAY,
    lineItems: [
      {
        productId: index === 97 ? 'p-kettle' : 'p-mug',
        name: index === 97 ? 'Copper Kettle' : 'Mug',
        quantity: 1,
        unitAmountCents: 2500,
      },
    ],
    totals: { itemsCents: 2500, shippingCents: 0, taxCents: 0, discountCents: 0, feeCents: 0, totalCents: 2500 },
    timeline: [],
    ...(index === 120
      ? {
          dispute: {
            id: 'dp_deep',
            status: 'needs_response',
            amountCents: 2500,
            openedAtMs: NOW - 2 * DAY,
            evidenceDueByMs: NOW + 4 * DAY,
          },
        }
      : {}),
  }
  // As the writers leave it: the fields the list's query reads.
  return { $id: id, ...order, ...orderListFields(order, id) }
})

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
    useListQuery: (options: unknown) => useListQueryDouble(() => mockOrders, options),
  }
})

/** What Export CSV asked Firestore for, one entry per page. */
const mockExportReads: Array<{ constraints: Array<{ kind: string; args: unknown[] }> }> = []

jest.mock('firebase/firestore', () => {
  const marker =
    (kind: string) =>
    (...args: unknown[]) => ({ kind, args })
  return {
    collection: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
    query: (base: { __path: string }, ...constraints: unknown[]) => ({
      __path: base.__path,
      constraints,
    }),
    where: marker('where'),
    orderBy: marker('orderBy'),
    limit: marker('limit'),
    startAfter: marker('startAfter'),
    documentId: () => '__name__',
    doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
    getDoc: jest.fn(),
    Timestamp: { fromDate: (date: Date) => date },
    /*
     * Firestore's answer to the export's query: the plan the list is showing
     * (the double's last), from the cursor, to the page's limit.
     */
    getDocs: jest.fn(
      async (asked: { constraints: Array<{ kind: string; args: unknown[] }> }) => {
        mockExportReads.push(asked)
        const { answerListQuery: answer, lastListQueryPlan: last } = jest.requireActual(
          '@aglyn/tenant-feature-instance/testing/list-query-double',
        )
        const matched = answer(mockOrders, last())
        const after = asked.constraints.find((entry) => entry.kind === 'startAfter')
        const from = after
          ? matched.findIndex((row: { $id: string }) => row.$id === (after.args[0] as { id: string }).id) + 1
          : 0
        const size = Number(asked.constraints.find((entry) => entry.kind === 'limit')?.args[0])
        const docs = matched.slice(from, from + size).map((row: Record<string, unknown>) => ({
          id: row.$id,
          data: () => row,
        }))
        return { docs, size: docs.length }
      },
    ),
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgPlan: () => ({ org: { plan: 'starter' }, ready: true }),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
  useFirestoreCollection: (build: () => { __path: string } | null) => {
    const ref = build()
    return {
      data: ref?.__path.endsWith('/products')
        ? [
            { $id: 'p-mug', name: 'Mug' },
            { $id: 'p-kettle', name: 'Copper Kettle' },
          ]
        : [],
      status: 'success',
    }
  },
}))

const mockSnackbars: string[] = []
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: string) => mockSnackbars.push(message),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

import { HostOrdersCard } from './host-orders-card.component'

/** The order numbers the grid is showing. */
const shownNumbers = () =>
  screen
    .queryAllByText(/^#\d+$/)
    .map((cell) => cell.textContent)

const numberOf = (index: number) => `#${5000 - index}`

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockExportReads.length = 0
  mockSnackbars.length = 0
})
afterEach(() => jest.restoreAllMocks())

describe('the orders list asks its query, not its page (AGL-3321)', () => {
  it('shows the first page of the store, newest first, and says there is more', () => {
    render(<HostOrdersCard hostId="host-1" />)
    expect(shownNumbers()[0]).toBe(numberOf(0))
    expect(shownNumbers()).not.toContain(numberOf(60))
    expect(lastListQueryPlan()?.orderBy).toMatchObject({ path: 'createdAtMs', direction: 'desc' })
  })

  it('finds refunded orders that no early page holds', () => {
    render(<HostOrdersCard hostId="host-1" />)
    setFilter('statusKey', 'is', 'refunded')
    expect(lastListQueryPlan()?.filters).toEqual([{ path: 'status', op: '==', value: 'refunded' }])
    expect(shownNumbers()).toEqual([60, 80, 100, 120].map(numberOf))
  })

  it('searches item names, buyers and numbers deep in the store', () => {
    render(<HostOrdersCard hostId="host-1" />)
    setSearch(['kettle'])
    expect(lastListQueryPlan()?.searched).toBe('kettle')
    expect(shownNumbers()).toEqual([numberOf(97)])
    setSearch(['deep@buyer'])
    expect(shownNumbers()).toEqual([numberOf(131)])
    setSearch([numberOf(110)])
    expect(shownNumbers()).toEqual([numberOf(110)])
  })

  it('finds an order by product, picked from the product picker', () => {
    render(<HostOrdersCard hostId="host-1" />)
    setFilter('productIds', 'isAnyOf', ['p-kettle'])
    expect(lastListQueryPlan()?.filters).toEqual([
      { path: 'productIds', op: 'array-contains-any', value: ['p-kettle'] },
    ])
    expect(shownNumbers()).toEqual([numberOf(97)])
  })

  it('names a combination one query cannot hold instead of half-applying it', () => {
    render(<HostOrdersCard hostId="host-1" />)
    setSearch(['mug'])
    setFilter('productIds', 'isAnyOf', ['p-kettle'])
    expect(
      screen.getByText(
        'Product is any of Copper Kettle is not applied: cannot be combined with the search — clear the search to use it.',
      ),
    ).toBeTruthy()
    // The search still stands, whole, on the query.
    expect(lastListQueryPlan()?.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'mug' },
    ])
  })

  it('keeps the grid, not the empty store, when a search matches nothing', () => {
    render(<HostOrdersCard hostId="host-1" />)
    setSearch(['teapot'])
    expect(screen.getByText('No orders match these filters')).toBeTruthy()
    expect(screen.queryByText(/No orders yet/)).toBeNull()
  })

  it('raises a deadline on an order no page shows, and filters to it', () => {
    render(<HostOrdersCard hostId="host-1" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('A shopper has disputed a charge')
    expect(alert.textContent).toContain('due to Stripe in 4 days')
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    expect(lastListQueryPlan()?.filters).toEqual([
      { path: 'disputeKey', op: '==', value: 'open' },
    ])
    expect(shownNumbers()).toEqual([numberOf(120)])
  })

  it('exports every match of the query, not the page on screen', async () => {
    const blobs: string[] = []
    const RealBlob = global.Blob
    global.Blob = class {
      constructor(parts: string[]) {
        blobs.push(parts.join(''))
      }
    } as unknown as typeof Blob
    global.URL.createObjectURL = jest.fn(() => 'blob:orders')
    global.URL.revokeObjectURL = jest.fn()
    // The download itself: jsdom cannot navigate.
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    try {
      render(<HostOrdersCard hostId="host-1" />)
      setSearch(['mug'])
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
      await waitFor(() => expect(blobs).toHaveLength(1))
      const plan = lastListQueryPlan()
      expect(mockExportReads[0].constraints).toContainEqual({
        kind: 'where',
        args: ['searchTokens', 'array-contains', 'mug'],
      })
      // Every Mug order in the store — 139 — over the page's ten.
      const expected = answerListQuery(mockOrders, plan!).length
      expect(expected).toBe(STORE_SIZE - 1)
      expect(blobs[0].trim().split('\n')).toHaveLength(expected + 1)
      expect(mockSnackbars).toEqual([])
    } finally {
      global.Blob = RealBlob
    }
  })
})
