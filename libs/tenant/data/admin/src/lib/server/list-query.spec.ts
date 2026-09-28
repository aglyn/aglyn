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

/** The Admin twin puts every predicate, then the one order, on the query (AGL-3321). */

jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__id__' },
  Timestamp: { fromDate: (date: Date) => ({ ts: date.toISOString() }) },
}))

import { applyListQuery } from './list-query'

describe('applyListQuery', () => {
  it('adds each where, a date as a Timestamp and the id path as the id, then the order', () => {
    const calls: unknown[][] = []
    const query: any = {
      where: (...args: unknown[]) => (calls.push(['where', ...args]), query),
      orderBy: (...args: unknown[]) => (calls.push(['orderBy', ...args]), query),
    }
    const day = new Date(2026, 8, 17)
    applyListQuery(query, {
      filters: [
        { path: 'status', op: '==', value: 'open' },
        { path: 'createdAt', op: '>=', value: day },
        { path: '__name__', op: 'in', value: ['a'] },
      ],
      orderBy: { path: 'createdAt', direction: 'desc' },
    })
    expect(calls).toEqual([
      ['where', 'status', '==', 'open'],
      ['where', 'createdAt', '>=', { ts: day.toISOString() }],
      ['where', '__id__', 'in', ['a']],
      ['orderBy', 'createdAt', 'desc'],
    ])
  })
})
