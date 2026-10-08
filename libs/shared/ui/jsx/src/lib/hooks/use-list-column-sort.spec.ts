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
 * A list's header sorts: the query's orders and the page's, one bridge to
 * the grid (AGL-3680).
 */

import { act, renderHook } from '@testing-library/react'
import type { ListQuerySort } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { useListColumnSort } from './use-list-column-sort'

interface Row {
  $id: string
  name: string
  seats: number | null
}
const ROWS: Row[] = [
  { $id: 'a', name: 'Beta', seats: 3 },
  { $id: 'b', name: 'alpha', seats: null },
  { $id: 'c', name: 'Gamma', seats: 10 },
]
const SORTS: ListQuerySort[] = [
  { path: '__name__', direction: 'asc' },
  { path: 'createdAt', direction: 'desc', column: 'createdAt' },
  { path: 'createdAt', direction: 'asc', column: 'createdAt', alone: true },
  { path: 'nameLower', direction: 'asc', column: 'name', alone: true },
  { path: 'nameLower', direction: 'desc', column: 'name', alone: true },
]

function setup(orderBy?: ListQuerySort) {
  return renderHook(() =>
    useListColumnSort<Row>({
      sorts: SORTS,
      defaultSort: SORTS[1],
      orderBy,
      rows: ROWS,
      pageSorts: { seats: (row) => row.seats },
      headers: { seats: 'Seats' },
    }),
  )
}

describe('useListColumnSort', () => {
  it('asks the query for the default order and shows it on its header', () => {
    const { result } = setup()
    expect(result.current.sort).toBe(SORTS[1])
    expect(result.current.sortModel).toEqual([{ field: 'createdAt', sort: 'desc' }])
    expect(result.current.sortingMode).toBe('server')
    expect(result.current.rows).toBe(ROWS)
  })

  it('names every sortable column, the default header with nowhere to clear to', () => {
    const { result } = setup()
    expect(result.current.columns).toEqual({
      createdAt: { mode: 'query', sortingOrder: ['desc', 'asc'] },
      name: { mode: 'query', sortingOrder: ['asc', 'desc', null] },
      seats: { mode: 'page', sortingOrder: ['asc', 'desc', null] },
    })
  })

  it('a query header asks the query, and clearing it comes back to the default', () => {
    const { result } = setup()
    act(() => result.current.onSortModelChange([{ field: 'name', sort: 'desc' }]))
    expect(result.current.sort).toBe(SORTS[4])
    expect(result.current.sortModel).toEqual([{ field: 'name', sort: 'desc' }])
    act(() => result.current.onSortModelChange([]))
    expect(result.current.sort).toBe(SORTS[1])
  })

  it('a page header sorts the loaded rows, empty last, keeps the query order, and says so', () => {
    const { result } = setup()
    act(() => result.current.onSortModelChange([{ field: 'seats', sort: 'desc' }]))
    expect(result.current.rows.map((row) => row.$id)).toEqual(['c', 'a', 'b'])
    expect(result.current.sort).toBe(SORTS[1])
    expect(result.current.sortModel).toEqual([{ field: 'seats', sort: 'desc' }])
    expect(result.current.notices[0]).toMatch(/^Sorted by Seats on this page only/)
  })

  it('shows the order the query reads in, not the one clicked', () => {
    const { result } = setup(SORTS[1])
    act(() => result.current.onSortModelChange([{ field: 'name', sort: 'asc' }]))
    expect(result.current.sort).toBe(SORTS[3])
    expect(result.current.sortModel).toEqual([{ field: 'createdAt', sort: 'desc' }])
  })

  it('takes a comparator a column hands over, and hands the order back on a header click', () => {
    const { result } = setup()
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name)
    act(() => result.current.sortPage('plugin.seats', byName))
    expect(result.current.pageSortedBy).toBe('plugin.seats')
    expect(result.current.rows.map((row) => row.$id)).toEqual(['b', 'a', 'c'])
    expect(result.current.sortModel).toEqual([])
    act(() => result.current.onSortModelChange([{ field: 'createdAt', sort: 'asc' }]))
    expect(result.current.pageSortedBy).toBeNull()
    expect(result.current.sort).toBe(SORTS[2])
  })
})
