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
 * The stock ledger gets a footer, and its filters keep their reach (AGL-693).
 *
 * The card rendered a hundred rows in one wall with no control over them. The
 * read was already correct — `orderBy('atMs','desc')`, a single-field index —
 * so the fix here is the CONTROL and not the query, and that distinction is
 * what this file is really about.
 *
 * ## Why the query is not paged
 *
 * Both filters run in the browser, because an equality filter plus this
 * ordering is a composite index and an index that has to be deployed by hand
 * is an index the feature ships without. On a ten-row server page "Damaged"
 * would therefore search ten movements instead of a hundred and answer "no
 * stock movements" about a ledger full of them. The fixture puts every damage
 * row deep in the ledger, past the first page, so a filter that had shrunk to
 * the page would find nothing and this file would fail.
 *
 * ## The ceiling now says when it bit
 *
 * `length >= WINDOW` is wrong at exactly the count that equals the ceiling: a
 * ledger of precisely one hundred movements was told rows were missing when
 * none were. Reading one document past the ceiling answers it outright, and
 * both directions are asserted below.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { StockMovementsCard } from './stock-movements-card.component'

jest.setTimeout(30_000)

/** The card's own ceiling. */
const WINDOW = 100

/**
 * How many movements the fixture holds. Mutable, because the interesting
 * cases are "fewer than the ceiling", "exactly the ceiling" and "more".
 */
let ledgerSize = 140

/**
 * Newest first, matching the ordering the query asks for. Every damage row is
 * deliberately deep in the ledger — past the first page and past the second —
 * so a filter narrowed to a page would report a clean shop.
 */
const ledger = () =>
  Array.from({ length: ledgerSize }, (_, index) => ({
    $id: `adj-${String(index).padStart(3, '0')}`,
    atMs: 1_800_000_000_000 - index * 60_000,
    productId: 'prod-1',
    delta: index % 2 === 0 ? -1 : 2,
    reason: index >= 40 && index % 10 === 0 ? 'damage' : 'sale',
  }))

const DAMAGE_ROWS = () =>
  ledger()
    .slice(0, WINDOW)
    .filter((row) => row.reason === 'damage').length

const products = [{ $id: 'prod-1', name: 'Desk lamp' }]

/** Every cap the card asked for. */
let mockCapsAsked: number[] = []
const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const path = String(built?.path ?? '')
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (path.endsWith('/inventoryAdjustments')) {
      mockCapsAsked.push(cap)
      return {
        data: ledger().slice(0, cap),
        status: 'success',
        fromCache: false,
      }
    }
    return { data: products, status: 'success', fromCache: false }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction?: string) => ({
    orderBy: field,
    direction,
  }),
}))

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  ledgerSize = 140
  mockCapsAsked = []
})

const renderedIds = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelectorAll('td')[3]?.textContent?.trim() ?? '',
  )

const chooseReason = (label: string) => {
  // MUI's select opens on mousedown, not click.
  const trigger = screen.getByLabelText('Reason')
  fireEvent.mouseDown(trigger)
  fireEvent.click(screen.getByRole('option', { name: label }))
}

describe('the stock ledger pages what it holds (AGL-693)', () => {
  it('THE CONTROL: the fixture is bigger than a page and than the ceiling', () => {
    // Otherwise "one page is on screen" and "the wall is on screen" are the
    // same assertion, and the truncation notice could never fire.
    expect(ledgerSize).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
    expect(ledgerSize).toBeGreaterThan(WINDOW)
    // And the damage rows really are past the first page.
    expect(DAMAGE_ROWS()).toBeGreaterThan(0)
    expect(
      ledger().findIndex((row) => row.reason === 'damage'),
    ).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('renders one page instead of the whole window', () => {
    render(<StockMovementsCard hostId="host-1" />)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
    // The count line describes the window, which is what the card holds.
    expect(
      document.querySelector('.MuiTablePagination-displayedRows')?.textContent,
    ).toContain(`of ${WINDOW}`)
  })

  it('the reason filter reaches the WINDOW, not the page it is standing on', () => {
    render(<StockMovementsCard hostId="host-1" />)
    // Every damage row is past the first page. A filter narrowed to the page
    // would render an empty table here, which reads as a shop that has never
    // damaged anything.
    chooseReason('Damaged')
    const rows = document.querySelectorAll('tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    expect(
      document.querySelector('.MuiTablePagination-displayedRows')?.textContent,
    ).toContain(`of ${DAMAGE_ROWS()}`)
  })

  it('a filter returns to the first page', async () => {
    render(<StockMovementsCard hostId="host-1" />)
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(renderedIds()[0]).toBe('Sale'))
    chooseReason('Damaged')
    // Page four of the unfiltered ledger is not a position in the filtered
    // one, and MUI renders an out-of-range page as an empty table with no
    // explanation — which reads as the filter having matched nothing.
    await waitFor(() =>
      expect(
        document.querySelector('.MuiTablePagination-displayedRows')?.textContent,
      ).toMatch(/^1–/),
    )
  })

  it('PROBES past the ceiling rather than comparing against it', () => {
    render(<StockMovementsCard hostId="host-1" />)
    expect(mockCapsAsked).toEqual([WINDOW + 1])
    expect(screen.getByText(/Older rows are/)).toBeTruthy()
  })

  it('a ledger of EXACTLY the ceiling is not called truncated', () => {
    // The off-by-one the old `length >= WINDOW` got wrong, in the one size
    // where it mattered: a shop with precisely a hundred movements was told
    // rows were missing and none were.
    ledgerSize = WINDOW
    render(<StockMovementsCard hostId="host-1" />)
    expect(screen.queryByText(/Older rows are/)).toBeNull()
  })
})
