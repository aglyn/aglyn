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
 * THE COLUMN MENU'S MOVE ITEMS (AGL-2635).
 *
 * What the menu has to hold: a column inside a view can be moved either
 * way through the view's own `move`, the edges are disabled rather than
 * absent, a pinned column is offered neither, and a list outside a view
 * gets the grid's own menu unchanged.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { CrmColumnOrder } from '../hooks/use-crm-view-grid'
import { CRM_LIST_SLOTS, CrmColumnOrderProvider } from './crm-column-menu'

const columns = [
  { field: 'name', headerName: 'Name' },
  { field: 'email', headerName: 'Email' },
  { field: 'actions', headerName: 'Actions', hideable: false },
]
const rows = [{ $id: 'a', name: 'Ada', email: 'ada@example.com' }]

/**
 * Opens the menu on the header named `label` and answers with it.
 *
 * The grid keeps the menu button out of the accessibility tree until the
 * header is hovered, so it is found by its label rather than its role.
 */
function openMenu(label: string) {
  const header = screen.getByRole('columnheader', { name: label })
  fireEvent.click(within(header).getByLabelText(`${label} column menu`))
  return screen.getByRole('menu')
}

function Harness(props: { order?: CrmColumnOrder }) {
  const table = <ListTable rows={rows} columns={columns} hideFooter slots={CRM_LIST_SLOTS} />
  return props.order ? (
    <CrmColumnOrderProvider value={props.order}>{table}</CrmColumnOrderProvider>
  ) : (
    table
  )
}

describe('the CRM column menu', () => {
  it('moves the column through the view, and is disabled at the edge', async () => {
    const move = jest.fn()
    render(<Harness order={{ order: ['name', 'email'], move }} />)
    const menu = openMenu('Name')
    // First of two: nothing to its left.
    expect(
      within(menu).getByRole('menuitem', { name: 'Move left' }).getAttribute('aria-disabled'),
    ).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }))
    expect(move).toHaveBeenCalledWith('name', 1)
    // The act closes the menu, as the grid's own items do — after its exit
    // transition, which is why this waits.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('keeps the grid’s own items beside the move', () => {
    render(<Harness order={{ order: ['name', 'email'], move: jest.fn() }} />)
    const menu = openMenu('Email')
    expect(within(menu).getByRole('menuitem', { name: 'Hide column' })).toBeTruthy()
    expect(
      within(menu).getByRole('menuitem', { name: 'Move right' }).getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('offers no move on a pinned column', () => {
    render(<Harness order={{ order: ['name', 'email'], move: jest.fn() }} />)
    const menu = openMenu('Actions')
    expect(within(menu).queryByRole('menuitem', { name: 'Move left' })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Move right' })).toBeNull()
  })

  it('is the grid’s own menu outside a view', () => {
    render(<Harness />)
    const menu = openMenu('Name')
    expect(within(menu).getByRole('menuitem', { name: 'Hide column' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitem', { name: 'Move right' })).toBeNull()
  })
})
