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
 * A paged live list, filtered over what its window read (AGL-3317).
 */

import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { inMemoryListField } from '../const/list-grid-filter'
import { usePagedRowsFilter } from './use-paged-rows-filter'

const FIELDS = [inMemoryListField('name', 'text')]
const SEARCH = ['name'] as const
const ALL = Array.from({ length: 45 }, (_unused, at) => ({
  $id: String(at),
  name: at % 10 === 7 ? `Match ${at}` : `Row ${at}`,
}))

/** A stand-in for `usePagedCollection`: the window is page 0..n plus a probe. */
function usePaged(pageSize = 10) {
  const [page, setPage] = useState(0)
  const windowSize = pageSize * (page + 1)
  const data = ALL.slice(0, windowSize + 1)
  return {
    data,
    rows: data.slice(page * pageSize, windowSize),
    hasMore: data.length > windowSize,
    page,
    setPage,
    pageSize,
    setPageSize: () => undefined,
  }
}

describe('usePagedRowsFilter', () => {
  it('is the pager it wraps until something narrows the list', () => {
    const hook = renderHook(() => usePagedRowsFilter(usePaged(), { fields: FIELDS, search: SEARCH }))
    expect(hook.result.current.rows.map((row) => row.$id)).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    )
    expect(hook.result.current.pagination.hasMore).toBe(true)
  })

  it('widens the window once, matches over all of it, and goes back when cleared', () => {
    const hook = renderHook(() => usePagedRowsFilter(usePaged(), { fields: FIELDS, search: SEARCH }))
    act(() =>
      hook.result.current.gridProps.onFilterModelChange({ items: [], quickFilterValues: ['match'] }),
    )
    // Every "Match" among the 45 rows, not only the one on page one.
    expect(hook.result.current.rows.map((row) => row.name)).toEqual([
      'Match 7',
      'Match 17',
      'Match 27',
      'Match 37',
    ])
    expect(hook.result.current.read).toBe(45)
    act(() =>
      hook.result.current.gridProps.onFilterModelChange({ items: [], quickFilterValues: [] }),
    )
    expect(hook.result.current.pagination.page).toBe(0)
    expect(hook.result.current.rows).toHaveLength(10)
  })
})
