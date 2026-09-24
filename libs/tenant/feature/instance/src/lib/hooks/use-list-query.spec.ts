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

/** The plan as web-SDK constraints (AGL-3321). */

jest.mock('firebase/firestore', () => ({
  where: (path: unknown, op: string, value: unknown) => ({ where: path, op, value }),
  orderBy: (path: unknown, direction?: string) => ({ orderBy: path, direction }),
  documentId: () => '__name__',
  limit: (count: number) => ({ limit: count }),
  query: jest.fn(),
  Timestamp: { fromDate: (date: Date) => ({ ts: date.toISOString() }) },
}))

import { listQueryConstraints } from './use-list-query'

describe('listQueryConstraints', () => {
  it('adds every predicate, a date as a Timestamp, then the one order', () => {
    const day = new Date(2026, 8, 17)
    expect(
      listQueryConstraints({
        filters: [
          { path: 'status', op: '==', value: 'open' },
          { path: 'createdAt', op: '>=', value: day },
          { path: '__name__', op: 'in', value: ['a', 'b'] },
        ],
        orderBy: { path: 'createdAt', direction: 'desc' },
        served: [],
        searched: null,
        refused: [],
        notices: [],
      }),
    ).toEqual([
      { where: 'status', op: '==', value: 'open' },
      { where: 'createdAt', op: '>=', value: { ts: day.toISOString() } },
      { where: '__name__', op: 'in', value: ['a', 'b'] },
      { orderBy: 'createdAt', direction: 'desc' },
    ])
  })
})
