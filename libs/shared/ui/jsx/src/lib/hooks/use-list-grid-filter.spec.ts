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
 * The grid's one-item Filters panel over a list's several clauses
 * (AGL-3313, shared since AGL-3317): one clause per field, the panel a
 * window onto the last one touched, and the stored shape unchanged.
 */

import { act, renderHook } from '@testing-library/react'
import type { ListFilterClause } from '../const/list-grid-filter'
import { useListGridFilter } from './use-list-grid-filter'

const owner: ListFilterClause = { field: 'ownerUid', op: 'equals', value: 'u1' }
/** A clause that narrows the loaded page, so it may stand beside a served one. */
const NO_NEXT_ACTIVITY: ListFilterClause = { field: 'nextActivityAt', op: 'isEmpty', value: '' }
const isNoNextActivity = (clause: ListFilterClause) =>
  clause.field === NO_NEXT_ACTIVITY.field && clause.op === NO_NEXT_ACTIVITY.op

function setup(initial: ListFilterClause[], extra: { single?: boolean } = {}) {
  let clauses = initial
  const onChange = jest.fn((next: ListFilterClause[]) => {
    clauses = next
  })
  const hook = renderHook(() =>
    useListGridFilter({
      clauses,
      onChange,
      selectFields: ['ownerUid', 'stage'],
      keepAlongside: isNoNextActivity,
      ...extra,
    }),
  )
  const change = (items: Array<Record<string, unknown>>, quickFilterValues: string[] = []) => {
    act(() => hook.result.current.onFilterModelChange({ items: items as any, quickFilterValues }))
    hook.rerender()
  }
  return { hook, change, current: () => clauses, onChange }
}

describe('useListGridFilter', () => {
  it('shows the newest clause in the panel, as the select it is', () => {
    const { hook } = setup([owner])
    expect(hook.result.current.filterModel.items).toEqual([
      { id: 'list', field: 'ownerUid', operator: 'is', value: 'u1' },
    ])
  })

  it('adds a second field beside the first, and a cleared value removes only its own', () => {
    const { change, current } = setup([owner])
    // Another column chosen: no value yet, the owner clause stands.
    change([{ id: 'list', field: 'stage', operator: 'is' }])
    expect(current()).toEqual([owner])
    change([{ id: 'list', field: 'stage', operator: 'is', value: 'lead' }])
    expect(current()).toEqual([owner, { field: 'stage', op: 'equals', value: 'lead' }])
    // The value cleared on the field shown.
    change([{ id: 'list', field: 'stage', operator: 'is', value: '' }])
    expect(current()).toEqual([owner])
  })

  it('removes the shown clause when the panel row is deleted', () => {
    const { change, current } = setup([owner])
    change([])
    expect(current()).toEqual([])
  })

  it('carries the quick search words without touching the clauses', () => {
    const { hook, change, onChange } = setup([owner])
    change([{ id: 'list', field: 'ownerUid', operator: 'is', value: 'u1' }], ['morgan', 'coffee'])
    expect(hook.result.current.searchWords).toEqual(['morgan', 'coffee'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('on a single-clause list replaces the served clause, and keeps "No next activity" beside it', () => {
    const { change, current } = setup([owner, NO_NEXT_ACTIVITY], { single: true })
    change([{ id: 'list', field: 'stage', operator: 'is', value: 'lead' }])
    expect(current()).toEqual([
      NO_NEXT_ACTIVITY,
      { field: 'stage', op: 'equals', value: 'lead' },
    ])
  })

  it('holds its own clauses when the list passes none', () => {
    const hook = renderHook(() => useListGridFilter({ selectFields: ['status'] }))
    act(() =>
      hook.result.current.onFilterModelChange({
        items: [{ id: 'list', field: 'status', operator: 'is', value: 'active' }],
      }),
    )
    expect(hook.result.current.clauses).toEqual([
      { field: 'status', op: 'equals', value: 'active' },
    ])
    act(() => hook.result.current.setClauses([]))
    expect(hook.result.current.clauses).toEqual([])
    expect(hook.result.current.filterModel.items).toEqual([])
  })
})
