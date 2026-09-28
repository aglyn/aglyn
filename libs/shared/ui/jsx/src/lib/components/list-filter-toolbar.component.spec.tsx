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
 * The toolbar a card or feed list filters by (AGL-3321): the clauses it
 * hands back are the grid panel's shape, one per field, with only the
 * operators the field declares; and the search box asks once the reader
 * pauses.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ListFilterField } from '../const/list-filter'
import { ListFilterToolbar } from './list-filter-toolbar.component'

const FIELDS: ListFilterField[] = [
  { column: 'hasCustomDomain', kind: 'boolean', path: 'hasCustomDomain', operators: ['is'] },
  {
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    operators: ['after', 'onOrBefore'],
  },
]
const HEADERS = { hasCustomDomain: 'Custom domain', createdAt: 'Created' }
const OPTIONS = {
  hasCustomDomain: [
    { value: 'true', label: 'Connected' },
    { value: 'false', label: 'None' },
  ],
}

const choose = (label: string, option: string) => {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(within(screen.getByRole('listbox')).getByText(option))
}

describe('ListFilterToolbar', () => {
  it('adds a clause in the grid panel\'s shape, picked by the option\'s label', () => {
    const onChange = jest.fn()
    render(
      <ListFilterToolbar
        fields={FIELDS}
        headers={HEADERS}
        options={OPTIONS}
        clauses={[]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    choose('Value', 'Connected')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith([{ field: 'hasCustomDomain', op: 'is', value: 'true' }])
  })

  it('offers only the operators the field declares, and replaces a field\'s clause', () => {
    const onChange = jest.fn()
    render(
      <ListFilterToolbar
        fields={FIELDS}
        headers={HEADERS}
        options={OPTIONS}
        clauses={[
          { field: 'hasCustomDomain', op: 'is', value: 'true' },
          { field: 'createdAt', op: 'after', value: '2026-01-01' },
        ]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    choose('Field', 'Created')
    fireEvent.mouseDown(screen.getByLabelText('Operator'))
    const offered = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(offered).toEqual(['after', 'on or before'])
    fireEvent.click(within(screen.getByRole('listbox')).getByText('on or before'))
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '2026-03-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith([
      { field: 'hasCustomDomain', op: 'is', value: 'true' },
      { field: 'createdAt', op: 'onOrBefore', value: '2026-03-01' },
    ])
  })

  it('asks the search once the reader pauses, as words', () => {
    jest.useFakeTimers()
    try {
      const onSearch = jest.fn()
      render(
        <ListFilterToolbar
          fields={FIELDS}
          headers={HEADERS}
          clauses={[]}
          onChange={jest.fn()}
          search={{ words: [], onChange: onSearch, placeholder: 'Search sites' }}
        />,
      )
      fireEvent.change(screen.getByLabelText('Search sites'), { target: { value: ' harbor  bakery ' } })
      expect(onSearch).not.toHaveBeenCalled()
      act(() => {
        jest.advanceTimersByTime(400)
      })
      expect(onSearch).toHaveBeenCalledWith(['harbor', 'bakery'])
    } finally {
      jest.useRealTimers()
    }
  })
})
