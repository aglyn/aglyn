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

import { act, renderHook } from '@testing-library/react'
import type { GridColDef } from '@mui/x-data-grid'
import { useCrmViewGrid } from './use-crm-view-grid'

const COLUMNS: readonly GridColDef[] = [
  { field: 'email' },
  { field: 'name' },
  { field: 'lastEmailEngagementAtMs' },
  { field: 'tags' },
]

/** The optional column starts hidden; the filter-only one never shows. */
const HIDDEN = { lastEmailEngagementAtMs: false, tags: false } as const

function controller(columns: string[] = []) {
  const setColumns = jest.fn()
  const setSort = jest.fn()
  return {
    controller: { state: { filters: [], columns, sort: null }, setColumns, setSort },
    setColumns,
    setSort,
  }
}

describe('useCrmViewGrid', () => {
  it('opens on the hidden default when the view names no columns', () => {
    const { controller: views } = controller()
    const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
    expect(result.current.columnVisibilityModel).toEqual({
      lastEmailEngagementAtMs: false,
      tags: false,
    })
  })

  it('shows an optional column a saved view names, and hides one it does not', () => {
    const { controller: views } = controller(['email', 'lastEmailEngagementAtMs'])
    const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
    expect(result.current.columnVisibilityModel).toEqual({
      email: true,
      name: false,
      lastEmailEngagementAtMs: true,
      tags: false,
    })
  })

  it('stores the columns by name when an optional column is turned on', () => {
    const { controller: views, setColumns } = controller()
    const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
    act(() => {
      result.current.onColumnVisibilityModelChange({
        lastEmailEngagementAtMs: true,
        tags: false,
      })
    })
    // Not the empty list: that means the default, and the default hides it.
    expect(setColumns).toHaveBeenCalledWith(['email', 'name', 'lastEmailEngagementAtMs'])
  })

  it('stores the empty list when the columns are the ones the list opens with', () => {
    const { controller: views, setColumns } = controller(['email'])
    const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
    act(() => {
      result.current.onColumnVisibilityModelChange({
        email: true,
        name: true,
        lastEmailEngagementAtMs: false,
        tags: false,
      })
    })
    expect(setColumns).toHaveBeenCalledWith([])
  })

  /**
   * The order is the view's (AGL-2635). `columns` names the visible set IN
   * ORDER, the grid rebuilds its own order from the array it is handed, and
   * the column menu's Move left / Move right go through `columnOrder`.
   */
  describe('the column order', () => {
    it('hands the grid the columns in the order the view names them', () => {
      const { controller: views } = controller(['name', 'email'])
      const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
      // The named ones as named, then the rest — hidden here — in list order.
      expect(result.current.columns.map((column) => column.field)).toEqual([
        'name',
        'email',
        'lastEmailEngagementAtMs',
        'tags',
      ])
      expect(result.current.columnOrder.order).toEqual(['name', 'email'])
    })

    it('opens on the list order when the view names nothing', () => {
      const { controller: views } = controller()
      const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
      expect(result.current.columns).toBe(result.current.columns)
      expect(result.current.columns.map((column) => column.field)).toEqual(
        COLUMNS.map((column) => column.field),
      )
      expect(result.current.columnOrder.order).toEqual(['email', 'name'])
    })

    it('keeps a pinned column in its slot and drops a name the list no longer has', () => {
      const pinned: readonly GridColDef[] = [
        { field: 'actions', hideable: false },
        ...COLUMNS,
      ]
      const { controller: views } = controller(['tags', 'retired', 'email'])
      const { result } = renderHook(() => useCrmViewGrid(views, pinned, HIDDEN))
      expect(result.current.columns.map((column) => column.field)).toEqual([
        'actions',
        'tags',
        'email',
        'name',
        'lastEmailEngagementAtMs',
      ])
    })

    it('moves a column past its visible neighbor and stores the order by name', () => {
      const { controller: views, setColumns } = controller()
      const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
      act(() => result.current.columnOrder.move('name', -1))
      // Not the empty list: the set is the default, the order is not.
      expect(setColumns).toHaveBeenCalledWith(['name', 'email'])
      // Nothing to swap with at the front; nothing is written.
      act(() => result.current.columnOrder.move('email', -1))
      expect(setColumns).toHaveBeenCalledTimes(1)
    })

    it('stores the empty list when a move arrives back at the default order', () => {
      const { controller: views, setColumns } = controller(['name', 'email'])
      const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
      act(() => result.current.columnOrder.move('name', 1))
      expect(setColumns).toHaveBeenCalledWith([])
    })

    it('keeps the order when a column is shown or hidden', () => {
      const { controller: views, setColumns } = controller(['name', 'email'])
      const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
      act(() => {
        result.current.onColumnVisibilityModelChange({
          email: true,
          name: true,
          lastEmailEngagementAtMs: true,
          tags: false,
        })
      })
      // The reader's order survives; the newly shown column joins after it.
      expect(setColumns).toHaveBeenCalledWith(['name', 'email', 'lastEmailEngagementAtMs'])
    })
  })

  it('writes the first sort back as the view sort, and none as null', () => {
    const { controller: views, setSort } = controller()
    const { result } = renderHook(() => useCrmViewGrid(views, COLUMNS, HIDDEN))
    act(() => {
      result.current.onSortModelChange([{ field: 'name', sort: 'desc' }])
    })
    expect(setSort).toHaveBeenCalledWith({ field: 'name', direction: 'desc' })
    act(() => {
      result.current.onSortModelChange([])
    })
    expect(setSort).toHaveBeenLastCalledWith(null)
  })
})
