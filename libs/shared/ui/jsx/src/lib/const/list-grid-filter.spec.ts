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

import type { ListFilterField } from './list-filter'
import { listFilterGridColumns, listRowMatchesSearch } from './list-grid-filter'

/** A text field that offers a mid-string contains, and a picked field. */
const field = (column: string, kind: 'text' | 'select'): ListFilterField =>
  kind === 'text'
    ? { column, path: column, kind: 'text', operators: ['contains', 'equals'] }
    : { column, path: column, kind: 'exact', operators: ['equals', 'doesNotEqual', 'isAnyOf'] }

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

describe('listFilterGridColumns', () => {
  it('turns a picked field into a select over its choices, and a text field keeps mid-string contains', () => {
    const [name, status, count] = listFilterGridColumns(
      [{ field: 'name' }, { field: 'status' }, { field: 'enrolled' }],
      [field('name', 'text'), field('status', 'select')],
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

describe('a column made a select keeps what it drew (AGL-3321)', () => {
  const fields = [field('actorId', 'select'), field('status', 'select')]
  const options = {
    actorId: [{ value: 'uid-1', label: 'ann@example.test' }],
    status: [{ value: 'open', label: 'Open' }],
  }

  it('draws a label its valueGetter returned, which matches no option value', () => {
    const [actor] = listFilterGridColumns(
      [{ field: 'actorId', valueGetter: () => 'ann@example.test' }],
      fields,
      options,
    )
    expect((actor.renderCell as any)({ value: 'ann@example.test' })).toBe('ann@example.test')
  })

  it('draws the option label for a raw stored value, and leaves its own renderCell alone', () => {
    const own = () => 'chip'
    const [status, custom] = listFilterGridColumns(
      [{ field: 'status' }, { field: 'actorId', renderCell: own }],
      fields,
      options,
    )
    expect((status.renderCell as any)({ value: 'open' })).toBe('Open')
    expect(custom.renderCell).toBe(own)
  })
})

describe('a Yes/No field with no column of its own is still offered (AGL-3332)', () => {
  const fields: readonly ListFilterField[] = [
    { column: 'status', kind: 'exact', path: 'status', operators: ['equals'] },
    { column: 'clicked', kind: 'boolean', path: 'clicked', operators: ['equals'] },
  ]
  const yesNo = [
    { value: 'true', label: 'Yes' },
    { value: 'false', label: 'No' },
  ]

  it('adds it as a hidden, filterable select over its choices', () => {
    const columns = listFilterGridColumns([{ field: 'status' }], fields, { clicked: yesNo })
    const clicked = columns.find((column) => column.field === 'clicked')
    expect(clicked).toMatchObject({ type: 'singleSelect', filterable: true, hideable: false })
    expect(clicked?.filterOperators?.map((operator) => operator.value)).toEqual(['is'])
  })

  it('still leaves out a hidden field the grid cannot filter and that has no choices', () => {
    const columns = listFilterGridColumns([{ field: 'status' }], fields)
    expect(columns.map((column) => column.field)).toEqual(['status'])
  })
})
