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
 * A HIDDEN FOOTER STILL PAGED THE ROWS (AGL-2501).
 *
 * `hideFooter` is how a caller says "something else owns the page": a
 * server-paged staff list, a cursor feed, a card whose `ListPagination` sits
 * under the grid. It hides the CONTROL and nothing else — the free DataGrid
 * always paginates — so the grid went on slicing at the shared default of ten
 * while the outer footer described the rows it had been HANDED. On a page of
 * twelve that reads "1–12 of 12" over ten rows, with no next-page affordance,
 * because by the footer's own arithmetic there is nothing more.
 *
 * Eight lists in the console pass `hideFooter`. Every one of them was losing
 * rows past the tenth, and none of them showed it, because a list has to hold
 * more than one page before the symptom exists.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **A fixture that fits on one page.** Twelve rows against a default of
 *    ten, asserted through `TABLE_PAGE_SIZE_DEFAULT` rather than the literal,
 *    so the premise cannot rot when the default moves. A ten-row fixture
 *    passes on the bug, which is presumably how it shipped.
 *  - **A fix that just turns pagination off.** The unhidden case is asserted
 *    too: a grid that still owns its footer must still page at the shared
 *    default, or the fix has traded a silent truncation for a wall of rows.
 *  - **The count read off the wrong thing.** The assertions count RENDERED
 *    rows, never the array handed in.
 */

import { render, screen, within } from '@testing-library/react'
import { ListTable } from './list-table.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '../const/table-pagination'

/** Comfortably more than one page, whatever the shared default becomes. */
const ROW_COUNT = TABLE_PAGE_SIZE_DEFAULT + 2

const rows = Array.from({ length: ROW_COUNT }, (_, index) => ({
  $id: `row-${String(index).padStart(2, '0')}`,
  name: `Account ${String(index).padStart(2, '0')}`,
}))

const columns = [{ field: 'name', headerName: 'Name', flex: 1 }]

/**
 * The names actually drawn.
 *
 * Read off `gridcell` rather than off the `rows` array, because the whole
 * defect is the gap between what a grid is given and what it draws.
 */
const drawn = () =>
  screen
    .queryAllByRole('gridcell')
    .map((cell) => cell.textContent ?? '')
    .filter((text) => text.startsWith('Account '))

describe('a grid whose footer is hidden draws every row it was given', () => {
  it('THE CONTROL: the fixture is larger than one page', () => {
    // Without this the assertions below are satisfied by a list that never
    // had a second page to lose, which is exactly the fixture that let the
    // bug ship.
    expect(rows.length).toBeGreaterThan(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('renders all of them when something else owns the page', () => {
    render(<ListTable rows={rows} columns={columns} hideFooter />)

    // Every row, not the first ten. The two past the default are the ones
    // that were drawn by nothing and reachable by nothing.
    expect(drawn()).toHaveLength(ROW_COUNT)
    expect(drawn()).toContain(rows[ROW_COUNT - 1].name)
    // And no second footer: the caller's own is the only one on screen.
    expect(screen.queryByText('Rows per page:')).toBeNull()
  })

  it('still pages at the shared default when it owns its own footer', () => {
    render(<ListTable rows={rows} columns={columns} />)

    // The other direction, and it matters as much: a fix that disabled
    // pagination outright would trade a silent truncation for every list in
    // the console rendering its whole collection in one wall.
    expect(drawn()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(drawn()).not.toContain(rows[ROW_COUNT - 1].name)
    expect(screen.getByText('Rows per page:')).toBeTruthy()
  })

  it('a caller cannot re-slice a grid whose footer is hidden', () => {
    // "Footer hidden, every row on screen" is an invariant of the component,
    // not a default. A call site that could page here would put back exactly
    // the rows nobody can reach.
    render(
      <ListTable
        rows={rows}
        columns={columns}
        hideFooter
        paginationModel={{ page: 0, pageSize: 5 }}
        onPaginationModelChange={() => undefined}
      />,
    )
    expect(drawn()).toHaveLength(ROW_COUNT)
  })

  it('draws an empty grid without asking for a page size of zero', () => {
    // MUI rejects `pageSize: 0`, and an empty server page is an ordinary
    // state — the last page of a walk that came out even.
    render(<ListTable rows={[]} columns={columns} hideFooter />)
    expect(drawn()).toHaveLength(0)
  })

  it('keeps each row whole — the twelfth is a row, not a stray cell', () => {
    render(<ListTable rows={rows} columns={columns} hideFooter />)
    const cell = screen.getByRole('gridcell', {
      name: rows[ROW_COUNT - 1].name,
    })
    const row = cell.closest('[role="row"]')
    expect(row).toBeTruthy()
    expect(
      within(row as HTMLElement).getByText(rows[ROW_COUNT - 1].name),
    ).toBeTruthy()
  })
})
