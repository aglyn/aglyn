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
import {
  hiddenFilterColumns,
  listFilterCellText,
  listFilterGridColumns,
  listRowMatchesSearch,
} from './list-grid-filter'

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
    expect(clicked).toMatchObject({ type: 'singleSelect', filterable: true })
    expect(clicked?.filterOperators?.map((operator) => operator.value)).toEqual(['is'])
  })

  /*
   * MUI's Manage columns draws a column that cannot be hidden as a disabled,
   * greyed-out checkbox, so a filter-only column must be an ordinary one: it
   * draws the row's value, and a reader can show it.
   */
  it('is an ordinary column in Manage columns, never locked, and draws the row’s value', () => {
    const columns = listFilterGridColumns([{ field: 'status' }], fields, { clicked: yesNo })
    const clicked = columns.find((column) => column.field === 'clicked')!
    expect(clicked.hideable).not.toBe(false)
    const value = (clicked.valueGetter as any)(undefined, { clicked: true })
    expect(value).toBe(true)
    expect((clicked.renderCell as any)({ value })).toBe('Yes')
    expect((clicked.renderCell as any)({ value: null })).toBe('')
  })
})

describe('a filter-only column reads the stored value as a person would', () => {
  const fields: readonly ListFilterField[] = [
    { column: 'name', kind: 'text', path: 'name', operators: ['equals'] },
    { column: 'ownerUid', kind: 'exact', path: 'owner.uid', operators: ['equals'] },
    { column: 'providers', kind: 'exact', path: 'providers', operators: ['equals'] },
    { column: 'staff', kind: 'boolean', path: 'staff', operators: ['equals'] },
  ]
  const columns = listFilterGridColumns([{ field: 'name' }], fields)
  const cell = (field: string, row: Record<string, unknown>) => {
    const column = columns.find((entry) => entry.field === field)!
    expect(column.hideable).not.toBe(false)
    return (column.renderCell as any)({ value: (column.valueGetter as any)(undefined, row) })
  }

  it('by the column name, else the field’s stored path', () => {
    expect(cell('ownerUid', { ownerUid: 'u1' })).toBe('u1')
    expect(cell('ownerUid', { owner: { uid: 'u2' } })).toBe('u2')
  })

  it('joins a list and says Yes or No for a flag', () => {
    expect(cell('providers', { providers: ['password', 'google.com'] })).toBe('password, google.com')
    expect(listFilterCellText(false)).toBe('No')
  })

  it('reads a timestamp as a date and time, and an option value as its label', () => {
    expect(listFilterCellText({ seconds: 0 })).toBe(new Date(0).toLocaleString())
    expect(listFilterCellText('true', new Map([['true', 'Suspended']]))).toBe('Suspended')
    expect(listFilterCellText(true, new Map([['true', 'Suspended']]))).toBe('Suspended')
  })

  it('hiddenFilterColumns builds the same ordinary columns', () => {
    const [owner] = hiddenFilterColumns(fields, ['name', 'providers', 'staff'])
    expect(owner.field).toBe('ownerUid')
    expect(owner.hideable).not.toBe(false)
    expect((owner.renderCell as any)({ value: (owner.valueGetter as any)(undefined, { ownerUid: 'u3' }) })).toBe('u3')
  })
})

describe('a hidden field with nothing to filter by', () => {
  it('is still left out when the grid cannot filter it and it has no choices', () => {
    const fields: readonly ListFilterField[] = [
      { column: 'status', kind: 'exact', path: 'status', operators: ['equals'] },
      { column: 'clicked', kind: 'boolean', path: 'clicked', operators: ['equals'] },
    ]
    const columns = listFilterGridColumns([{ field: 'status' }], fields)
    expect(columns.map((column) => column.field)).toEqual(['status'])
  })
})
