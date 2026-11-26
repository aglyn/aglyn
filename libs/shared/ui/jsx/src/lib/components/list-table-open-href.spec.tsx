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
 * A row opened by `onOpen` (a dialog, as the Catalog's products are) has no
 * anchor of its own, so the gestures that mean "in a new tab" go to
 * `openHref` instead: a cmd-, ctrl- or shift-click, and a middle-click.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { ListTable, listActionsColumn } from './list-table.component'

const rows = [{ $id: 'row-a', name: 'Racing shirt' }]
const columns = [
  { field: 'name', headerName: 'Name', minWidth: 200 },
  listActionsColumn(() => <button type="button">{'Menu'}</button>),
]

describe('ListTable openHref', () => {
  let open: jest.SpyInstance
  beforeEach(() => {
    open = jest.spyOn(window, 'open').mockImplementation(() => null)
  })
  afterEach(() => open.mockRestore())

  const mount = () => {
    const onOpen = jest.fn()
    render(
      <ListTable
        rows={rows}
        columns={columns}
        hideFooter
        onOpen={onOpen}
        openHref={(id) => `/catalog?product=${id}`}
      />,
    )
    return onOpen
  }

  it('opens the row on a plain click, in place', () => {
    const onOpen = mount()
    fireEvent.click(screen.getByText('Racing shirt'))
    expect(onOpen).toHaveBeenCalledWith('row-a', rows[0])
    expect(open).not.toHaveBeenCalled()
  })

  it.each([['metaKey'], ['ctrlKey'], ['shiftKey']])(
    'opens its address in a new tab on a %s click',
    (key) => {
      const onOpen = mount()
      fireEvent.click(screen.getByText('Racing shirt'), { [key]: true })
      expect(open).toHaveBeenCalledWith('/catalog?product=row-a', '_blank', 'noopener')
      expect(onOpen).not.toHaveBeenCalled()
    },
  )

  it('opens its address in a new tab on a middle-click', () => {
    const onOpen = mount()
    fireEvent(
      screen.getByText('Racing shirt'),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    )
    expect(open).toHaveBeenCalledWith('/catalog?product=row-a', '_blank', 'noopener')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leaves a middle-click in the actions cell to the actions', () => {
    mount()
    fireEvent(screen.getByText('Menu'), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(open).not.toHaveBeenCalled()
  })
})
