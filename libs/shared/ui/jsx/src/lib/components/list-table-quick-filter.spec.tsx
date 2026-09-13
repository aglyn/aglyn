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
 * A SEARCH BOX THAT TYPES INTO NOTHING.
 *
 * `ListTable` shows the grid's toolbar, and the toolbar's free-text search
 * sets `quickFilterValues` on the filter model. A grid filtering its own rows
 * answers that search itself. Under `filterMode="server"` the grid applies
 * nothing, and the model goes to the caller — so on a list whose handler reads
 * only the column filter (`gridFilterRequest`), the box accepts typing and
 * narrows nothing, which reads as "no match" rather than "not supported".
 *
 * So the box follows the filter mode: shown where the grid answers it, hidden
 * under server filtering unless the list says it reads the search itself.
 */

import { render, screen } from '@testing-library/react'
import { ListTable, type ListTableProps } from './list-table.component'

const rows = [
  { $id: 'row-a', name: 'Account A' },
  { $id: 'row-b', name: 'Account B' },
]

const columns = [{ field: 'name', headerName: 'Name', flex: 1 }]

const mount = (props: Partial<ListTableProps> = {}) =>
  render(<ListTable rows={rows} columns={columns} hideFooter {...props} />)

const searchBox = () => screen.queryByRole('searchbox')

describe('ListTable free-text search', () => {
  it('THE CONTROL: the toolbar renders, and its search box is findable', () => {
    // Without this, "hidden" below could be a search for a role the box
    // never had, passing on every build.
    mount()
    expect(searchBox()).not.toBeNull()
  })

  it('is hidden on a server-filtered list, which reads the column filter', () => {
    mount({ filterMode: 'server', onFilterModelChange: () => undefined })
    expect(searchBox()).toBeNull()
    // The column filter is still offered: only the dead control goes.
    expect(screen.getByRole('button', { name: /filters/i })).toBeTruthy()
  })

  it('is shown on a server-filtered list that answers the search', () => {
    mount({
      filterMode: 'server',
      onFilterModelChange: () => undefined,
      quickFilter: true,
    })
    expect(searchBox()).not.toBeNull()
  })

  it('lets a caller’s own toolbar slot props decide', () => {
    mount({ slotProps: { toolbar: { showQuickFilter: false } } })
    expect(searchBox()).toBeNull()
  })
})
