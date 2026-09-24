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
 * The quick search every list answers itself (AGL-3313, AGL-3315): any
 * word of a value, mid-string, case-insensitive, every word required; and
 * the in-memory half of the shared filter path (AGL-3317).
 */

import {
  filterListRows,
  inMemoryListField,
  listFilterGridColumns,
  listRowMatchesSearch,
} from './list-grid-filter'

describe('listRowMatchesSearch', () => {
  const deal = { title: 'Acme Coffee — annual renewal', tags: ['q4', 'Priority'] }

  it('finds a deal by a word from the middle of its title, whatever the case', () => {
    expect(listRowMatchesSearch(deal, ['title'], ['RENEWAL'])).toBe(true)
    expect(listRowMatchesSearch(deal, ['title'], ['newal'])).toBe(true)
    expect(listRowMatchesSearch(deal, ['title'], ['acme', 'annual'])).toBe(true)
    expect(listRowMatchesSearch(deal, ['title'], ['acme', 'globex'])).toBe(false)
  })

  it('matches every row on a blank search, and reads a list member by member', () => {
    expect(listRowMatchesSearch(deal, ['title'], [])).toBe(true)
    expect(listRowMatchesSearch(deal, ['title'], ['  '])).toBe(true)
    expect(listRowMatchesSearch(deal, ['tags'], ['priority'])).toBe(true)
    expect(listRowMatchesSearch({}, ['title'], ['acme'])).toBe(false)
  })
})

describe('filterListRows', () => {
  const fields = [inMemoryListField('name', 'text'), inMemoryListField('status', 'select')]
  const rows = [
    { name: 'Welcome series', status: 'active' },
    { name: 'Renewal nudge', status: 'paused' },
    { name: 'Win-back', status: 'active' },
  ]

  it('answers every clause and the search over the whole set', () => {
    expect(
      filterListRows(rows, fields, [{ field: 'status', op: 'equals', value: 'active' }], {
        paths: ['name'],
        words: ['back'],
      }),
    ).toEqual([rows[2]])
    expect(
      filterListRows(rows, fields, [{ field: 'status', op: 'isAnyOf', value: 'active,paused' }], {
        paths: ['name'],
        words: [],
      }),
    ).toHaveLength(3)
    expect(
      filterListRows(rows, fields, [{ field: 'status', op: 'doesNotEqual', value: 'active' }], {
        paths: ['name'],
        words: [],
      }),
    ).toEqual([rows[1]])
  })

  it('does not match again a clause the query already served', () => {
    expect(
      filterListRows(
        rows,
        fields,
        [{ field: 'status', op: 'equals', value: 'nothing-has-this' }],
        { paths: ['name'], words: [] },
        (clause) => clause.field === 'status',
      ),
    ).toHaveLength(3)
  })
})

describe('listFilterGridColumns', () => {
  it('turns a picked field into a select over its choices, and a text field keeps mid-string contains', () => {
    const [name, status, count] = listFilterGridColumns(
      [{ field: 'name' }, { field: 'status' }, { field: 'enrolled' }],
      [inMemoryListField('name', 'text'), inMemoryListField('status', 'select')],
      { status: [{ value: 'active', label: 'Active' }] },
    )
    expect(name.filterOperators?.map((operator) => operator.value)).toContain('contains')
    expect(status.type).toBe('singleSelect')
    expect((status as { valueOptions?: unknown }).valueOptions).toEqual([{ value: 'active', label: 'Active' }])
    expect(status.filterOperators?.map((operator) => operator.value)).toEqual(['is', 'not', 'isAnyOf'])
    // A column no field declares offers no filter the list could not answer.
    expect(count.filterable).toBe(false)
  })
})
