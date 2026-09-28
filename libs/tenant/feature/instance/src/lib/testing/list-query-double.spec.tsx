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

/** The double answers a plan the way Firestore does (AGL-3321). */

import { act, renderHook } from '@testing-library/react'
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { answerListQuery, lastListQueryPlan, useListQueryDouble } from './list-query-double'

const DECLARATION: ListQueryDeclaration = {
  fields: [{ column: 'status', kind: 'exact', path: 'status', presence: 'always' }],
  sorts: [{ path: 'createdAt', direction: 'desc' }],
  search: { tokensPath: 'nameTokens' },
}
const ROWS = Array.from({ length: 25 }, (_unused, at) => ({
  $id: `r${String(at).padStart(2, '0')}`,
  status: at === 3 ? 'closed' : 'open',
  createdAt: new Date(2026, 0, at + 1),
  nameTokens: at === 3 ? ['w', 'wi', 'win'] : ['o', 'ot', 'oth'],
}))

describe('the useListQuery double', () => {
  it('finds a match that the unfiltered first page would not hold', () => {
    const hook = renderHook(() =>
      useListQueryDouble(() => ROWS, {
        collection: null,
        declaration: DECLARATION,
        request: { clauses: [{ field: 'status', op: 'equals', value: 'closed' }] },
        deps: [],
      }),
    )
    expect(hook.result.current.rows.map((row: any) => row.$id)).toEqual(['r03'])
    expect(lastListQueryPlan()?.filters).toEqual([{ path: 'status', op: '==', value: 'closed' }])
  })

  it('pages the answer in the plan order', () => {
    const hook = renderHook(() =>
      useListQueryDouble(() => ROWS, {
        collection: null,
        declaration: DECLARATION,
        request: { clauses: [] },
        deps: [],
      }),
    )
    expect(hook.result.current.rows[0]).toMatchObject({ $id: 'r24' })
    expect(hook.result.current.hasMore).toBe(true)
    act(() => hook.result.current.setPage(2))
    expect(hook.result.current.rows.map((row: any) => row.$id)).toEqual([
      'r04',
      'r03',
      'r02',
      'r01',
      'r00',
    ])
  })

  it('answers a search token as array-contains', () => {
    const plan = lastListQueryPlan()
    expect(plan).not.toBeNull()
    expect(
      answerListQuery(ROWS, {
        filters: [{ path: 'nameTokens', op: 'array-contains', value: 'win' }],
        orderBy: { path: 'createdAt', direction: 'desc' },
        served: [],
        searched: 'win',
        refused: [],
        notices: [],
      }).map((row) => row.$id),
    ).toEqual(['r03'])
  })
})
