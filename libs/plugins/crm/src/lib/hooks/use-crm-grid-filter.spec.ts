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
 * The grid's one-item Filters panel over a view's several clauses
 * (AGL-3313): one clause per field, the panel a window onto the last one
 * touched, and the stored shape unchanged.
 */

import { CRM_NO_NEXT_ACTIVITY_CLAUSE, type CrmViewFilterClause, isNoNextActivityClause } from '@aglyn/aglyn'
import { act, renderHook } from '@testing-library/react'
import { useCrmGridFilter } from './use-crm-grid-filter'

const owner: CrmViewFilterClause = { field: 'ownerUid', op: 'equals', value: 'u1' }

function setup(initial: CrmViewFilterClause[], extra: { single?: boolean } = {}) {
  let clauses = initial
  const onChange = jest.fn((next: CrmViewFilterClause[]) => {
    clauses = next
  })
  const hook = renderHook(() =>
    useCrmGridFilter({
      clauses,
      onChange,
      selectFields: ['ownerUid', 'stage'],
      keepAlongside: isNoNextActivityClause,
      ...extra,
    }),
  )
  const change = (items: Array<Record<string, unknown>>, quickFilterValues: string[] = []) => {
    act(() => hook.result.current.onFilterModelChange({ items: items as any, quickFilterValues }))
    hook.rerender()
  }
  return { hook, change, current: () => clauses, onChange }
}

describe('useCrmGridFilter', () => {
  it('shows the newest clause in the panel, as the select it is', () => {
    const { hook } = setup([owner])
    expect(hook.result.current.filterModel.items).toEqual([
      { id: 'crm', field: 'ownerUid', operator: 'is', value: 'u1' },
    ])
  })

  it('adds a second field beside the first, and a cleared value removes only its own', () => {
    const { change, current } = setup([owner])
    // Another column chosen: no value yet, the owner clause stands.
    change([{ id: 'crm', field: 'stage', operator: 'is' }])
    expect(current()).toEqual([owner])
    change([{ id: 'crm', field: 'stage', operator: 'is', value: 'lead' }])
    expect(current()).toEqual([owner, { field: 'stage', op: 'equals', value: 'lead' }])
    // The value cleared on the field shown.
    change([{ id: 'crm', field: 'stage', operator: 'is', value: '' }])
    expect(current()).toEqual([owner])
  })

  it('removes the shown clause when the panel row is deleted', () => {
    const { change, current } = setup([owner])
    change([])
    expect(current()).toEqual([])
  })

  it('carries the quick search words without touching the clauses', () => {
    const { hook, change, onChange } = setup([owner])
    change([{ id: 'crm', field: 'ownerUid', operator: 'is', value: 'u1' }], ['morgan', 'coffee'])
    expect(hook.result.current.searchWords).toEqual(['morgan', 'coffee'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('on a single-clause list replaces the served clause, and keeps "No next activity" beside it', () => {
    const { change, current } = setup([owner, CRM_NO_NEXT_ACTIVITY_CLAUSE], { single: true })
    change([{ id: 'crm', field: 'stage', operator: 'is', value: 'lead' }])
    expect(current()).toEqual([
      CRM_NO_NEXT_ACTIVITY_CLAUSE,
      { field: 'stage', op: 'equals', value: 'lead' },
    ])
  })
})
