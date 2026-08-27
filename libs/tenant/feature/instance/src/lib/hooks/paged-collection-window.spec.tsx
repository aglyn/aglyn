/**
 * @jest-environment jsdom
 */

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
 * The growing window, in isolation from Firestore.
 *
 * `useFirestoreCollection` is mocked because none of the properties here are
 * about Firestore: they are about the arithmetic between "what the query was
 * asked for" and "what the caller may render". Five commerce cards now depend
 * on that arithmetic, and an off-by-one in it is a row that silently never
 * renders.
 */
import { act, renderHook } from '@testing-library/react'

/** Every page limit the hook asked its query builder for, in order. */
let limitsAsked: number[] = []
/** What the mocked collection hook answers with. */
let docs: Array<Record<string, unknown>> = []

jest.mock('./use-firestore-collection', () => ({
  useFirestoreCollection: (buildQuery: () => unknown) => {
    // Invoking the builder is what records the limit — the real hook calls it
    // the same way, so a hook that stopped calling it would fail here rather
    // than quietly serve a stale window.
    buildQuery()
    return {
      data: docs,
      status: 'success',
      error: undefined,
      fromCache: false,
      serverDenied: false,
    }
  },
}))

import { usePagedCollection } from './use-paged-collection'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

const rowsNamed = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ $id: `row-${index}` }))

beforeEach(() => {
  limitsAsked = []
  docs = []
})

const render = (deps: unknown[] = ['host-1'], pageSize = 3) =>
  renderHook(
    ({ scope }: { scope: unknown[] }) =>
      usePagedCollection<{ $id: string }>(
        (pageLimit) => {
          limitsAsked.push(pageLimit)
          return null
        },
        scope,
        { pageSize },
      ),
    { initialProps: { scope: deps } },
  )

describe('usePagedCollection', () => {
  it('asks for one row MORE than the page', () => {
    render()
    // The probe row. Without it `hasMore` would have to guess from
    // `length === pageSize`, which is wrong exactly when the total is an even
    // multiple of the page — offering a next page that leads nowhere, or
    // hiding one that leads somewhere.
    expect(limitsAsked[0]).toBe(4)
  })

  it('never renders the probe row', () => {
    docs = rowsNamed(4)
    const { result } = render()
    expect(result.current.rows).toHaveLength(3)
    expect(result.current.rows.map((row) => row.$id)).toEqual([
      'row-0',
      'row-1',
      'row-2',
    ])
    expect(result.current.hasMore).toBe(true)
  })

  it('a full page with no probe row is the LAST page', () => {
    // The even-multiple case: exactly pageSize rows exist. `hasMore` must be
    // false, or the caller offers a next page onto nothing.
    docs = rowsNamed(3)
    const { result } = render()
    expect(result.current.rows).toHaveLength(3)
    expect(result.current.hasMore).toBe(false)
  })

  it('page two widens the query and slices the SECOND page out of it', () => {
    /*
     * The listener covers page 0..n rather than page n alone, because this is
     * a live `onSnapshot` and a Firestore cursor needs a document snapshot to
     * resume from — which a listener that never read page n-1 does not have.
     * Widening is what makes forward and back symmetrical on one read path.
     */
    docs = rowsNamed(7)
    const { result } = render()
    act(() => result.current.setPage(1))
    expect(limitsAsked.at(-1)).toBe(7)
    expect(result.current.rows.map((row) => row.$id)).toEqual([
      'row-3',
      'row-4',
      'row-5',
    ])
    expect(result.current.page).toBe(1)
  })

  it('paging BACK costs no further read', () => {
    docs = rowsNamed(7)
    const { result } = render()
    act(() => result.current.setPage(1))
    const asked = limitsAsked.length
    act(() => result.current.setPage(0))
    // The rows are already in the snapshot; only the slice moves.
    expect(result.current.rows.map((row) => row.$id)).toEqual([
      'row-0',
      'row-1',
      'row-2',
    ])
    expect(limitsAsked.length).toBeLessThanOrEqual(asked + 1)
  })

  it('changing the page size returns to the FIRST page', () => {
    // Page four of a ten-row list does not exist once the reader asks for
    // fifty at a time, and an out-of-range page renders as an empty list with
    // no explanation — which reads as the data having gone.
    docs = rowsNamed(20)
    const { result } = render()
    act(() => result.current.setPage(2))
    expect(result.current.page).toBe(2)
    act(() => result.current.setPageSize(5))
    expect(result.current.page).toBe(0)
    expect(result.current.pageSize).toBe(5)
  })

  it('a NEW subject starts at page one again', () => {
    // Without the reset, a card paged three deep on one site opens the next
    // site three pages in — a read the reader never asked for, charged to
    // whoever they switched to.
    docs = rowsNamed(20)
    const { result, rerender } = render()
    act(() => result.current.setPage(2))
    expect(result.current.page).toBe(2)
    rerender({ scope: ['host-2'] })
    expect(result.current.page).toBe(0)
    expect(limitsAsked.at(-1)).toBe(4)
  })

  it('defaults to the console-wide page size when none is given', () => {
    renderHook(() =>
      usePagedCollection<{ $id: string }>(
        (pageLimit) => {
          limitsAsked.push(pageLimit)
          return null
        },
        ['host-1'],
      ),
    )
    expect(limitsAsked.at(-1)).toBe(TABLE_PAGE_SIZE_DEFAULT + 1)
  })

  it('passes the underlying read state through', () => {
    // Callers still need `status`/`serverDenied` to tell "no rows" from
    // "could not read" — paging must not swallow that.
    docs = rowsNamed(1)
    const { result } = render()
    expect(result.current.status).toBe('success')
    expect(result.current.serverDenied).toBe(false)
  })
})
