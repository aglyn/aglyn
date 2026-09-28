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

/** `listQueryModule` works inside a real `jest.mock` factory (AGL-3321). */

import { renderHook } from '@testing-library/react'
import { listQueryConstraints, useListQuery } from '../hooks/use-list-query'

const mockRows = [
  { $id: 'a', status: 'open' },
  { $id: 'b', status: 'closed' },
]

jest.mock('../hooks/use-list-query', () =>
  jest
    .requireActual('./list-query-double')
    .listQueryModule(() => mockRows, jest.requireActual('../hooks/use-list-query')),
)

describe('listQueryModule', () => {
  it('stands the double in for useListQuery and keeps the real constraints', () => {
    expect(typeof listQueryConstraints).toBe('function')
    const hook = renderHook(() =>
      useListQuery({
        collection: null,
        declaration: {
          fields: [{ column: 'status', kind: 'exact', path: 'status', presence: 'always' }],
          sorts: [{ path: 'status', direction: 'asc' }],
        },
        request: { clauses: [{ field: 'status', op: 'equals', value: 'closed' }] },
        deps: [],
      } as unknown as Parameters<typeof useListQuery>[0]),
    )
    expect(hook.result.current.rows.map((row) => row['$id'])).toEqual(['b'])
  })
})
