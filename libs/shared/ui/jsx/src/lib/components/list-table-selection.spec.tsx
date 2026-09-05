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
 * `ListTable` selection is OPT-IN (AGL-2595).
 *
 * Every artifact list shipped navigation-only on purpose — a selection with
 * no bulk action is a state the reader has to dismiss and cannot use — and
 * the CRM is the first surface with something to do with one: tag, assign,
 * export, delete a chosen set of contacts. So the grid grows a `selectable`
 * prop, and the two things this file has to hold are:
 *
 *  - **With it, a checkbox selection reports the caller's ids.** Two rows
 *    ticked → both `$id`s, in the caller's vocabulary rather than MUI's
 *    `{ type, ids: Set }` model.
 *  - **Without it, nothing changed.** No checkbox column, for every list
 *    that never asked for one.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { ListTable, type ListTableProps } from './list-table.component'

const rows = [
  { $id: 'row-a', name: 'Account A' },
  { $id: 'row-b', name: 'Account B' },
  { $id: 'row-c', name: 'Account C' },
]

const columns = [{ field: 'name', headerName: 'Name', flex: 1 }]

/** The checkbox in the row that names `label`. */
const rowCheckbox = (label: string) => {
  const cell = screen.getByRole('gridcell', { name: label })
  const row = cell.closest('[role="row"]') as HTMLElement
  return within(row).getByRole('checkbox')
}

/**
 * The controlled shape a caller has: state in, the full selection back out.
 * Recording every change proves the grid reports the WHOLE selection each
 * time rather than the delta.
 */
function Controlled(props: {
  onChange: (ids: string[]) => void
  extra?: Partial<ListTableProps>
}) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <ListTable
      rows={rows}
      columns={columns}
      hideFooter
      selectable={{
        selected,
        onChange: (ids) => {
          setSelected(ids)
          props.onChange(ids)
        },
      }}
      {...props.extra}
    />
  )
}

describe('ListTable selection', () => {
  it('renders no checkbox column without the prop — every existing list is untouched', () => {
    render(<ListTable rows={rows} columns={columns} hideFooter />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('reports both ids after two rows are ticked', () => {
    const onChange = jest.fn()
    render(<Controlled onChange={onChange} />)

    fireEvent.click(rowCheckbox('Account A'))
    fireEvent.click(rowCheckbox('Account C'))

    expect(onChange).toHaveBeenLastCalledWith(['row-a', 'row-c'])
    // The full selection every time, never the delta.
    expect(onChange.mock.calls[0][0]).toEqual(['row-a'])
  })

  it('folds the header "select all" back into the row ids the caller knows', () => {
    const onChange = jest.fn()
    render(<Controlled onChange={onChange} />)

    // The header checkbox produces MUI's `exclude` model — "everything but
    // these" — and the caller must still receive plain ids.
    const [selectAll] = screen.getAllByRole('checkbox')
    fireEvent.click(selectAll)

    expect(onChange).toHaveBeenLastCalledWith(['row-a', 'row-b', 'row-c'])
  })

  it('still opens the record on a row click rather than selecting it', () => {
    const onChange = jest.fn()
    const onOpen = jest.fn()
    render(<Controlled onChange={onChange} extra={{ onOpen }} />)

    fireEvent.click(screen.getByRole('gridcell', { name: 'Account B' }))

    expect(onOpen).toHaveBeenCalledWith('row-b', rows[1])
    expect(onChange).not.toHaveBeenCalled()
  })
})
