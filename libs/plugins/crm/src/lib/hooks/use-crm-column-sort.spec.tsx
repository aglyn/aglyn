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
 * A CRM list's header sorts, kept in its saved view (AGL-3680).
 */

import { act, renderHook } from '@testing-library/react'
import type { GridColDef } from '@mui/x-data-grid'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { planListQuery } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { CONTACT_LIST_DECLARATION, CONTACT_LIST_SORTS } from '../constants/contact-filters'
import { COMPANY_LIST_SORTS } from '../constants/company-filters'
import { DEAL_LIST_SORTS } from '../constants/deal-filters'
import { LEAD_LIST_DECLARATION, LEAD_LIST_SORTS, leadStatusBase } from '../model/lead-filters'
import { TASK_LIST_SORTS } from '../model/task-views'
import { crmPageSorts, crmViewQuerySort, useCrmColumnSort } from './use-crm-column-sort'

interface Row {
  $id: string
  name: string
  ownerUid?: string
  tags?: string[]
}

const ROWS: Row[] = [
  { $id: 'a', name: 'Beta', ownerUid: 'u2', tags: ['x'] },
  { $id: 'b', name: 'alpha', ownerUid: 'u1' },
  { $id: 'c', name: 'Gamma' },
]

const NAMES: Record<string, string> = { u1: 'Zed', u2: 'Ann' }

const COLUMNS: GridColDef[] = [
  { field: 'name', headerName: 'Contact' },
  {
    field: 'ownerUid',
    headerName: 'Owner',
    valueGetter: (_value, row: Row) => (row.ownerUid ? NAMES[row.ownerUid] : ''),
  },
  { field: 'tags', headerName: 'Tags' },
  { field: 'actions', headerName: '' },
]

describe('a view’s sort as the list’s declared order', () => {
  const [byUpdated] = CONTACT_LIST_SORTS
  it('is the default with no sort saved', () => {
    expect(crmViewQuerySort(CONTACT_LIST_SORTS, null, byUpdated)).toEqual({
      sort: byUpdated,
      unserved: null,
    })
  })

  it('is the declared order a header sort names', () => {
    const asked = crmViewQuerySort(
      CONTACT_LIST_SORTS,
      { field: 'name', direction: 'desc' },
      byUpdated,
    )
    expect(asked.sort).toMatchObject({ path: 'nameSortKey', direction: 'desc', alone: true })
    expect(asked.unserved).toBeNull()
  })

  it('falls back to the default, naming what it could not serve, for a page column', () => {
    const saved = { field: 'ownerUid', direction: 'asc' } as const
    expect(crmViewQuerySort(CONTACT_LIST_SORTS, saved, byUpdated)).toEqual({
      sort: byUpdated,
      unserved: saved,
    })
  })
})

describe('the page sorts', () => {
  it('read each column the way its cell does, skipping the query’s and the actions column', () => {
    const sorts = crmPageSorts<Row>(COLUMNS, new Set(['name']))
    expect(Object.keys(sorts).sort()).toEqual(['ownerUid', 'tags'])
    expect(sorts['ownerUid'](ROWS[0])).toBe('Ann')
    expect(sorts['tags'](ROWS[0])).toBe('x')
    expect(sorts['tags'](ROWS[1])).toBeNull()
  })
})

describe('useCrmColumnSort', () => {
  const [defaultSort] = CONTACT_LIST_SORTS
  const render = (setSort: jest.Mock, saved: { field: string; direction: 'asc' | 'desc' } | null) =>
    renderHook(() => {
      const asked = crmViewQuerySort(CONTACT_LIST_SORTS, saved, defaultSort)
      return useCrmColumnSort<Row>({
        views: { setSort },
        sorts: CONTACT_LIST_SORTS,
        defaultSort,
        asked,
        orderBy: asked.sort,
        rows: ROWS,
        columns: COLUMNS,
      })
    })

  it('keeps a query header’s order in the view, and the default as none', () => {
    const setSort = jest.fn()
    const { result } = render(setSort, null)
    expect(result.current.columns['name']).toMatchObject({ mode: 'query' })
    expect(result.current.columns['ownerUid']).toMatchObject({ mode: 'page' })
    expect(result.current.columns['actions']).toBeUndefined()
    act(() => result.current.onSortModelChange([{ field: 'name', sort: 'asc' }]))
    expect(setSort).toHaveBeenLastCalledWith({ field: 'name', direction: 'asc' })
    act(() => result.current.onSortModelChange([{ field: 'updatedAt', sort: 'desc' }]))
    expect(setSort).toHaveBeenLastCalledWith(null)
  })

  it('sorts the page by a joined column without touching the view, and says so', () => {
    const setSort = jest.fn()
    const { result } = render(setSort, null)
    act(() => result.current.onSortModelChange([{ field: 'ownerUid', sort: 'asc' }]))
    expect(setSort).not.toHaveBeenCalled()
    expect(result.current.rows.map((row) => row.$id)).toEqual(['a', 'b', 'c'])
    expect(result.current.notices.join(' ')).toMatch(/Owner on this page only/)
  })

  it('says when a saved view’s sort is one the query cannot serve', () => {
    const { result } = render(jest.fn(), { field: 'ownerUid', direction: 'desc' })
    expect(result.current.notices.join(' ')).toMatch(/saved sorted by Owner/)
    expect(result.current.sort).toBe(defaultSort)
  })
})

describe('every CRM list’s header orders (AGL-3680)', () => {
  it.each([
    ['Contacts', CONTACT_LIST_SORTS],
    ['Leads', LEAD_LIST_SORTS],
    ['Companies', COMPANY_LIST_SORTS],
    ['Deals', DEAL_LIST_SORTS],
    ['Tasks', TASK_LIST_SORTS],
  ] as const)('%s: each header order is labelled, and only the default holds under a filter', (_list, sorts) => {
    const headers = sorts.filter((sort) => sort.column)
    expect(headers.length).toBeGreaterThan(2)
    for (const sort of headers) expect(sort.label).toBeTruthy()
    // An order that is not `alone` costs a composite per filterable field.
    expect(sorts.filter((sort) => !sort.alone).length).toBeLessThanOrEqual(2)
  })

  it('serves a header order on the Open leads, the Status riding the base', () => {
    const [, ...headers] = LEAD_LIST_SORTS
    const byCompany = headers.find((sort) => sort.path === 'companyLower')
    const base = leadStatusBase({ field: 'status', op: 'isAnyOf', value: 'new,nurturing,working' })
    expect(base).toEqual([{ path: 'status', op: 'in', value: ['new', 'nurturing', 'working'] }])
    const plan = planListQuery(
      LEAD_LIST_DECLARATION,
      { clauses: [], sort: byCompany, base },
      nameSearchNormalizers,
    )
    expect(plan.orderBy).toBe(byCompany)
    expect(plan.sortFallback).toBeUndefined()
  })

  it('falls back to the default with a notice once a filter narrows the list', () => {
    const byName = CONTACT_LIST_SORTS.find((sort) => sort.path === 'nameSortKey')
    const plan = planListQuery(
      CONTACT_LIST_DECLARATION,
      { clauses: [{ field: 'emailStatus', op: 'equals', value: 'ok' }], sort: byName },
      nameSearchNormalizers,
    )
    expect(plan.orderBy).toBe(CONTACT_LIST_SORTS[0])
    expect(plan.notices.join(' ')).toMatch(/Contact sorts only with no filter or search on/)
  })

  it('reads no status base for All', () => {
    expect(leadStatusBase(undefined)).toEqual([])
    expect(leadStatusBase({ field: 'status', op: 'equals', value: 'working' })).toEqual([
      { path: 'status', op: '==', value: 'working' },
    ])
  })
})
