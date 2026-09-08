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
 * AN EMPTY LIST HAS TO HOLD ITS OWN EMPTY STATE.
 *
 * MUI X sizes the no-rows overlay from `--DataGrid-overlayHeight`, and where
 * nothing declares it the slot is two rows — 96px on a console list. What goes
 * in it is a 120px illustration, a label, a description and a create button:
 * 287px on the Companies list, measured on a live page.
 *
 * The overflow is not a crop at the bottom. The overlay is CENTERED in its
 * slot and `.MuiDataGrid-main` is what clips, so 191px of empty state leaves
 * the slot in both directions at once — the illustration painted across the
 * column headers as a grey smear, the description stopping mid-sentence.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **A grid that declares no reserve at all.** That is the state the console
 *    shipped in, and every list built on this grid clipped, worst on the one
 *    whose sentence was longest.
 *  - **A reserve trimmed to exactly fit.** The floor asserted here is the
 *    tallest empty state the console draws PLUS room for the copy to grow. A
 *    reserve that only just fits today's longest sentence is the same bug
 *    waiting for the next rewrite, and it fails toward overlapping content
 *    rather than toward a gap.
 *  - **A fix made at one call site.** Asserted through `DataTableComponent`
 *    as well as `ListTable`: the overlay belongs to the shared grid, so a
 *    reserve declared in a card would leave every other list clipping.
 *  - **A seam that has moved.** The variable is MUI's, not ours. If an upgrade
 *    sizes the overlay some other way the reserve becomes decorative, so the
 *    slot is asserted to be sized FROM the variable.
 *  - **A reserve charged to a grid that has rows.** A list with content must
 *    measure its own height and gain no dead space from any of this.
 */

import { render, screen } from '@testing-library/react'
import {
  TABLE_EMPTY_STATE_HEIGHT,
  TABLE_ROW_HEIGHT,
} from '../const/table-pagination'
import { DataTableComponent } from './data-table.component'
import { ListTable } from './list-table.component'

/**
 * The tallest empty state the console draws, measured on the Companies list:
 * illustration, label, a description that wraps to three lines and a create
 * button. A floor, not a target — copy only ever grows.
 */
const TALLEST_EMPTY_STATE = 287

/** One wrapped line of `body2` description, at its 20px line box. */
const DESCRIPTION_LINE = 20

const columns = [{ field: 'name', headerName: 'Name', flex: 1 }]

/** Among the longest shipping, and the one the defect was reported against. */
const DESCRIPTION =
  'A company groups the contacts who work at one business, with its domain, ' +
  'owner and address. Create the first one, or link a contact to a company ' +
  'from their page.'

const emptyList = () =>
  render(
    <ListTable
      rows={[]}
      columns={columns}
      noRowsLabel="No companies yet"
      noRowsDescription={DESCRIPTION}
    />,
  )

/** The reserve as the grid inside `root` reads it. */
const reserveOn = (root: HTMLElement) =>
  getComputedStyle(root).getPropertyValue('--DataGrid-overlayHeight').trim()

describe('a grid reserves the room its empty state needs', () => {
  it('declares the reserve on an empty list', () => {
    const { container } = emptyList()

    // The fixture is the real thing: an empty state with all of its parts,
    // which is what does not fit in two rows.
    expect(screen.getByText('No companies yet')).toBeTruthy()
    expect(screen.getByText(DESCRIPTION)).toBeTruthy()

    expect(reserveOn(container.firstElementChild as HTMLElement)).toBe(
      `${TABLE_EMPTY_STATE_HEIGHT}px`,
    )
  })

  it('declares it on the grid every list is built from', () => {
    // Not on `ListTable`, and not in a card: `DataTableComponent` owns the
    // overlay, so this is the only place a reserve reaches every list.
    const { container } = render(
      <DataTableComponent
        rows={[]}
        columns={columns}
        noRowsLabel="Nothing here"
        noRowsDescription={DESCRIPTION}
      />,
    )
    expect(reserveOn(container.firstElementChild as HTMLElement)).toBe(
      `${TABLE_EMPTY_STATE_HEIGHT}px`,
    )
  })

  it('reserves more than the tallest empty state, with room to spare', () => {
    // Bigger than MUI's fallback, which is the shape of the defect: two rows
    // of room for something six rows tall.
    expect(TABLE_EMPTY_STATE_HEIGHT).toBeGreaterThan(2 * TABLE_ROW_HEIGHT)
    // And bigger than what the console actually draws, by more than a couple
    // of lines — the next sentence somebody writes is longer than this one.
    expect(TABLE_EMPTY_STATE_HEIGHT).toBeGreaterThanOrEqual(
      TALLEST_EMPTY_STATE + 2 * DESCRIPTION_LINE,
    )
  })

  it('THE PREMISE: the empty slot is sized from that variable', () => {
    const { container } = emptyList()

    // MUI writes the variable into the overlay's own height and into the
    // filler that gives an empty grid its size. Both are read here rather
    // than assumed, because the reserve is worth nothing if an upgrade sizes
    // the overlay some other way.
    const sizedFromReserve = [
      '.MuiDataGrid-overlayWrapperInner',
      '.MuiDataGrid-contentFiller',
    ].map((selector) => container.querySelector(selector))

    for (const element of sizedFromReserve) {
      expect(element).toBeTruthy()
      expect((element as HTMLElement).getAttribute('style')).toContain(
        'var(--DataGrid-overlayHeight',
      )
    }
  })

  it('THE CONTROL: a grid with rows is charged nothing for it', () => {
    const { container } = render(
      <ListTable
        rows={[{ $id: 'acme', name: 'Acme' }]}
        columns={columns}
        noRowsLabel="No companies yet"
        noRowsDescription={DESCRIPTION}
      />,
    )

    // No overlay to size, and the filler measures the rows instead of the
    // reserve: a list with content is exactly as tall as its content.
    expect(container.querySelector('.MuiDataGrid-overlayWrapper')).toBeNull()
    const filler = container.querySelector(
      '.MuiDataGrid-contentFiller',
    ) as HTMLElement
    expect(filler.getAttribute('style')).not.toContain(
      '--DataGrid-overlayHeight',
    )
  })
})
