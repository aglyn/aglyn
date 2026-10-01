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

import {
  applyRepeatQuery,
  parseRepeatFilter,
  parseRepeatSort,
} from './repeat-query'

const rows = [
  { $id: 'a', title: 'Alpha', price: 10, tags: ['red'], live: true },
  { $id: 'b', title: 'Beta', price: 25, tags: ['blue'], live: false },
  { $id: 'c', title: 'Gamma', price: 5, tags: ['red', 'blue'], live: true },
]

describe('parseRepeatFilter / parseRepeatSort', () => {
  it('parses the field-op-value shorthand', () => {
    expect(parseRepeatFilter('price <= 20')).toEqual({
      fieldId: 'price',
      op: '<=',
      value: '20',
    })
    expect(parseRepeatFilter('tags contains red')).toEqual({
      fieldId: 'tags',
      op: 'contains',
      value: 'red',
    })
    expect(parseRepeatFilter('nonsense')).toBeNull()
  })

  it('parses sort with optional direction', () => {
    expect(parseRepeatSort('price desc')).toEqual({
      fieldId: 'price',
      direction: 'desc',
    })
    expect(parseRepeatSort('title')).toEqual({
      fieldId: 'title',
      direction: 'asc',
    })
    expect(parseRepeatSort('9bad')).toBeNull()
  })
})

describe('applyRepeatQuery', () => {
  it('filters with typed comparisons', () => {
    expect(
      applyRepeatQuery(rows, {
        where: [{ fieldId: 'price', op: '<=', value: '20' }],
      }).map((row) => row.$id),
    ).toEqual(['a', 'c'])
    expect(
      applyRepeatQuery(rows, {
        where: [{ fieldId: 'live', op: '==', value: 'true' }],
      }).map((row) => row.$id),
    ).toEqual(['a', 'c'])
    expect(
      applyRepeatQuery(rows, {
        where: [{ fieldId: 'tags', op: 'contains', value: 'blue' }],
      }).map((row) => row.$id),
    ).toEqual(['b', 'c'])
  })

  it('sorts and limits', () => {
    expect(
      applyRepeatQuery(rows, {
        orderBy: { fieldId: 'price', direction: 'desc' },
        limit: 2,
      }).map((row) => row.$id),
    ).toEqual(['b', 'a'])
    expect(
      applyRepeatQuery(rows, {
        orderBy: { fieldId: 'title', direction: 'asc' },
      }).map((row) => row.$id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('composes where + orderBy + limit', () => {
    expect(
      applyRepeatQuery(rows, {
        where: [{ fieldId: 'tags', op: 'contains', value: 'red' }],
        orderBy: { fieldId: 'price', direction: 'asc' },
        limit: 1,
      }).map((row) => row.$id),
    ).toEqual(['c'])
  })
})
