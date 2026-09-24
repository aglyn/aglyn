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
 * A list that holds its rows answers the grid's panel and search over all
 * of them (AGL-3317).
 */

import { act, renderHook } from '@testing-library/react'
import { inMemoryListField } from '../const/list-grid-filter'
import { useListRowsFilter } from './use-list-rows-filter'

const FIELDS = [inMemoryListField('name', 'text'), inMemoryListField('state', 'select')]
const OPTIONS = {
  state: [
    { value: 'sent', label: 'Sent' },
    { value: 'draft', label: 'Draft' },
  ],
}
const SEARCH = ['name'] as const
const ROWS = [
  { $id: '1', name: 'September newsletter', state: 'sent' },
  { $id: '2', name: 'October newsletter', state: 'draft' },
  { $id: '3', name: 'Win-back', state: 'sent' },
]

describe('useListRowsFilter', () => {
  it('narrows the rows by a picked clause and by the search, together', () => {
    const hook = renderHook(() =>
      useListRowsFilter({ rows: ROWS, fields: FIELDS, options: OPTIONS, search: SEARCH }),
    )
    expect(hook.result.current.rows).toHaveLength(3)
    expect(hook.result.current.filtering).toBe(false)
    act(() =>
      hook.result.current.gridProps.onFilterModelChange({
        items: [{ id: 'list', field: 'state', operator: 'is', value: 'sent' }],
        quickFilterValues: ['newsletter'],
      }),
    )
    expect(hook.result.current.rows.map((row) => row.$id)).toEqual(['1'])
    expect(hook.result.current.filtering).toBe(true)
    expect(hook.result.current.chipsProps.clauses).toEqual([
      { field: 'state', op: 'equals', value: 'sent' },
    ])
  })

  it('types the picked column as a select, and leaves the served clause to the query', () => {
    const served = (clause: { field: string }) => clause.field === 'state'
    const hook = renderHook(() =>
      useListRowsFilter({ rows: ROWS, fields: FIELDS, options: OPTIONS, search: SEARCH, served }),
    )
    const [, state] = hook.result.current.filterColumns([{ field: 'name' }, { field: 'state' }])
    expect(state.type).toBe('singleSelect')
    act(() =>
      hook.result.current.gridProps.onFilterModelChange({
        items: [{ id: 'list', field: 'state', operator: 'is', value: 'draft' }],
      }),
    )
    // The query answered it; the rows it handed back are not matched again.
    expect(hook.result.current.rows).toHaveLength(3)
  })
})
