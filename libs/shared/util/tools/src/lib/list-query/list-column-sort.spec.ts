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
 * A page sort compares as a reader reads, empty last either way (AGL-3680).
 */

import { compareListSortValues, sortListRows } from './list-column-sort'

describe('sortListRows', () => {
  const rows = [
    { id: 'a', name: 'item 10', at: new Date('2026-01-02') },
    { id: 'b', name: null, at: null },
    { id: 'c', name: 'Item 9', at: new Date('2026-03-01') },
    { id: 'd', name: 'apple', at: new Date('2026-02-01') },
  ]

  it('orders text case-blind with digits as numbers, empty last', () => {
    expect(sortListRows(rows, (row) => row.name, 'asc').map((row) => row.id)).toEqual(['d', 'c', 'a', 'b'])
    expect(sortListRows(rows, (row) => row.name, 'desc').map((row) => row.id)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('orders dates by time, empty last in both directions', () => {
    expect(sortListRows(rows, (row) => row.at, 'desc').map((row) => row.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(sortListRows(rows, (row) => row.at, 'asc').map((row) => row.id)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('keeps equal values in the order they came, and copies', () => {
    const same = sortListRows(rows, () => 1, 'asc')
    expect(same.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(same).not.toBe(rows)
  })

  it('treats Infinity as the largest number, not as empty', () => {
    expect(compareListSortValues(Number.POSITIVE_INFINITY, 3, 'asc')).toBeGreaterThan(0)
  })
})
