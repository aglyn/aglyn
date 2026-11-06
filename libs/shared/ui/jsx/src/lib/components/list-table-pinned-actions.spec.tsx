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
 * A table in a narrow panel keeps its row controls in reach (AGL-4047): with
 * `pinActions`, the Actions column is held at the right edge while the other
 * columns scroll beneath it, and it is always drawn.
 */

import { render } from '@testing-library/react'
import { ListTable, listActionsColumn } from './list-table.component'

const rows = [{ $id: 'row-a', name: 'Custom cakes', description: 'Tiered event cakes' }]
const columns = [
  { field: 'name', headerName: 'Name', minWidth: 400 },
  { field: 'description', headerName: 'Description', minWidth: 400 },
  listActionsColumn(() => <button type="button">{'Edit'}</button>),
]

const actionsCell = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.MuiDataGrid-cell[data-field="actions"]')

describe('ListTable pinActions', () => {
  it('holds the Actions column at the right edge, on the paper the rows are drawn on', () => {
    const { container } = render(<ListTable rows={rows} columns={columns} hideFooter pinActions />)
    const cell = actionsCell(container)
    expect(cell).not.toBeNull()
    const style = window.getComputedStyle(cell as HTMLElement)
    expect(style.position).toBe('sticky')
    expect(style.right).toBe('0px')
  })

  it('THE CONTROL: leaves every other table as it was', () => {
    const { container } = render(<ListTable rows={rows} columns={columns} hideFooter />)
    const cell = actionsCell(container)
    if (cell) expect(window.getComputedStyle(cell).position).not.toBe('sticky')
  })
})
