/**
 * @jest-environment node
 *
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

/**
 * A complete-read staff list sorts on its route (AGL-3680, strategy 4s):
 * every matched row is ordered before the page is cut, so the second page
 * continues the order the first began — and a read that is not the whole
 * source refuses the order with a notice rather than ordering part of it.
 */

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import { answerStaffCompleteList } from '../utils/server/staff-complete-list'
import { staffCompleteListSorts } from '../utils/staff-complete-list-sort'
import type { StaffListQueryRequest } from '../utils/server/staff-list-query'
import { COUPON_COLUMN_SORTS, COUPON_SORT_COLUMNS } from '../utils/coupon-list-query'
import { DENY_COLUMN_SORTS, DENY_SORT_COLUMNS } from '../utils/media-quarantine-list-query'
import { TAX_FINDING_COLUMN_SORTS, TAX_FINDING_SORT_COLUMNS } from '../utils/tax-findings-list'

interface Row {
  id: string
  name: string | null
  count: number
}

const ROWS: Row[] = [
  { id: 'a', name: 'pear', count: 3 },
  { id: 'b', name: null, count: 1 },
  { id: 'c', name: 'Apple', count: 2 },
  { id: 'd', name: 'fig', count: 5 },
]
const FIELDS: readonly ListFilterField[] = [{ column: 'name', kind: 'text', path: 'name' }]
const COLUMNS = {
  name: { label: 'Name', value: (row: Row) => row.name },
  count: { label: 'Count', value: (row: Row) => row.count },
}

const request = (over: Partial<StaffListQueryRequest>): StaffListQueryRequest => ({
  clauses: [],
  search: [],
  cursor: null,
  pageSize: 2,
  sort: null,
  ...over,
})

const answer = (over: Partial<StaffListQueryRequest>, unsortable: string | null = null) =>
  answerStaffCompleteList({
    rows: ROWS,
    fields: FIELDS,
    searchPaths: ['name'],
    request: request(over),
    cursorOf: (row) => row.id,
    sorts: COLUMNS,
    unsortable,
  })

describe('a complete-read list sorts before it pages', () => {
  it('keeps the source order with no sort asked', () => {
    expect(answer({}).rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('orders every row, empty last, and the next page continues the order', () => {
    const first = answer({ sort: { path: 'name', direction: 'asc' } })
    expect(first.rows.map((row) => row.id)).toEqual(['c', 'd'])
    const second = answer({ sort: { path: 'name', direction: 'asc' }, cursor: first.nextCursor })
    expect(second.rows.map((row) => row.id)).toEqual(['a', 'b'])
    expect(second.hasMore).toBe(false)
  })

  it('descends', () => {
    expect(answer({ sort: { path: 'count', direction: 'desc' } }).rows.map((row) => row.id)).toEqual([
      'd',
      'a',
    ])
  })

  it('says so, and keeps its own order, for a column it does not sort', () => {
    const page = answer({ sort: { path: 'colour', direction: 'asc' } })
    expect(page.rows.map((row) => row.id)).toEqual(['a', 'b'])
    expect(page.notices).toEqual([expect.stringContaining('does not sort by colour')])
  })

  it('refuses the order over a read that is not the whole source', () => {
    const page = answer({ sort: { path: 'count', direction: 'asc' } }, 'the read was cut short')
    expect(page.rows.map((row) => row.id)).toEqual(['a', 'b'])
    expect(page.notices).toEqual(['Not sorted by Count: the read was cut short.'])
  })
})

describe('every complete-read list offers both directions of every column it declares', () => {
  it.each([
    ['coupons', COUPON_COLUMN_SORTS, COUPON_SORT_COLUMNS],
    ['deny list', DENY_COLUMN_SORTS, DENY_SORT_COLUMNS],
    ['tax findings', TAX_FINDING_COLUMN_SORTS, TAX_FINDING_SORT_COLUMNS],
  ] as const)('%s', (_name, sorts, columns) => {
    expect(sorts).toEqual(staffCompleteListSorts(columns as never))
    expect(sorts).toHaveLength(Object.keys(columns).length * 2)
    expect(sorts.every((sort) => sort.column === sort.path && !sort.alone)).toBe(true)
  })
})
