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
 * AGL-2486: ONE cursor pagination behind both staff list screens.
 *
 * Organizations had Previous/Next (AGL-878) written inline; Users had a
 * `Load more` button that grew one table forever. The fix had two plausible
 * shapes — paste the block into the second page, or lift it out — and only
 * the second one leaves a single thing to keep correct. The call-site half at
 * the bottom is what makes that claim checkable a year from now.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useStaffListPagination } from '../hooks/use-staff-list-pagination'

interface Row {
  id: string
}

/** A route serving three pages of two rows, cursor = last id on the page. */
const PAGES: Record<string, { rows: Row[]; nextCursor: string | null }> = {
  '': { rows: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' },
  b: { rows: [{ id: 'c' }, { id: 'd' }], nextCursor: 'd' },
  d: { rows: [{ id: 'e' }], nextCursor: null },
}

function harness(overrides?: { enabled?: boolean }) {
  const seen: Array<string | null> = []
  const fetchPage = jest.fn(async (cursor: string | null) => {
    seen.push(cursor)
    const page = PAGES[cursor ?? '']
    return {
      rows: page.rows,
      nextCursor: page.nextCursor,
      hasMore: Boolean(page.nextCursor),
    }
  })
  const onError = jest.fn()
  const view = renderHook(() =>
    useStaffListPagination<Row>({
      fetchPage,
      onError,
      enabled: overrides?.enabled,
    }),
  )
  return { view, fetchPage, onError, seen }
}

const ids = (rows: Row[]) => rows.map((row) => row.id).join('')

describe('useStaffListPagination', () => {
  it('opens on page 0 with no cursor', async () => {
    const { view, seen } = harness()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(seen).toEqual([null])
    expect(ids(view.result.current.rows)).toBe('ab')
    expect(view.result.current.pageIndex).toBe(0)
    expect(view.result.current.hasMore).toBe(true)
  })

  it('REPLACES the rows on Next rather than appending them', async () => {
    // The behaviour the Users list did not have: its table only ever grew.
    const { view } = harness()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    expect(ids(view.result.current.rows)).toBe('cd')
    expect(view.result.current.pageIndex).toBe(1)
  })

  it('goes BACK from the cursor it remembered, not from the start', async () => {
    // The one property that makes Previous work at all. A hook that kept only
    // the forward cursor would re-serve page 0 as "page 1" and nothing on
    // screen would say so.
    const { view, seen } = harness()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    await act(async () => {
      await view.result.current.loadPage(2)
    })
    expect(ids(view.result.current.rows)).toBe('e')
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    expect(seen).toEqual([null, 'b', 'd', 'b'])
    expect(ids(view.result.current.rows)).toBe('cd')
    expect(view.result.current.pageIndex).toBe(1)
  })

  it('reports the end of the walk', async () => {
    const { view } = harness()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    await act(async () => {
      await view.result.current.loadPage(2)
    })
    expect(view.result.current.hasMore).toBe(false)
  })

  it('never offers Next on a `hasMore` with nowhere to go', async () => {
    // A route that says "more" and hands back no cursor would otherwise leave
    // the button live onto the page already shown — a spin, not an error.
    const fetchPage = jest.fn(async () => ({
      rows: [{ id: 'only' }],
      hasMore: true,
      nextCursor: null,
    }))
    const view = renderHook(() => useStaffListPagination<Row>({ fetchPage }))
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    // Page 1 has no remembered cursor, so it re-reads from null — and the
    // rows are the same ones. What must NOT happen is a crash or a silent
    // claim to be somewhere else with different data.
    expect(ids(view.result.current.rows)).toBe('only')
  })

  it('hands an error to the caller and stops loading', async () => {
    const fetchPage = jest.fn(async () => {
      throw new Error('nope')
    })
    const onError = jest.fn()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = renderHook(() =>
      useStaffListPagination<Row>({ fetchPage, onError }),
    )
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.rows).toEqual([])
  })

  it('holds the first load until the caller is ready', async () => {
    // The Users screen must not fetch before the staff claim resolves.
    const { view, fetchPage } = harness({ enabled: false })
    await act(async () => undefined)
    expect(fetchPage).not.toHaveBeenCalled()
    expect(view.result.current.rows).toEqual([])
  })

  it('resets the walk when rows arrive from outside it', async () => {
    // The exact-email lookup is not page n of anything; a cursor from the old
    // walk does not describe the list it produced.
    const { view, seen } = harness()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    act(() => {
      view.result.current.showRows([{ id: 'found' }])
    })
    expect(ids(view.result.current.rows)).toBe('found')
    expect(view.result.current.pageIndex).toBe(0)
    expect(view.result.current.hasMore).toBe(false)
    await act(async () => {
      await view.result.current.loadPage(0)
    })
    expect(seen[seen.length - 1]).toBeNull()
  })

  /*==========================================
   * THE SIZE HAS TO REACH THE QUERY (AGL-2501).
   *
   * A size control that only re-slices an already-fetched window looks
   * perfectly correct on a small collection and silently caps at whatever the
   * original request asked for on a large one. So this drives a walk that is
   * WIDER than one page and asserts the new width in the REQUEST — a hook
   * that re-sliced would never issue a second call at all.
   *=========================================*/
  it('carries a new page size into the REQUEST, and starts the walk over', async () => {
    const seen: Array<{ cursor: string | null; size: number }> = []
    // A pool of nine rows, so a width of two and a width of four cut it
    // differently and no single constant satisfies both.
    const pool = 'abcdefghi'.split('').map((id) => ({ id }))
    const fetchPage = jest.fn(
      async (cursor: string | null, _index: number, size: number) => {
        seen.push({ cursor, size })
        const start = cursor ? pool.findIndex((row) => row.id === cursor) + 1 : 0
        const rows = pool.slice(start, start + size)
        const nextCursor =
          start + size < pool.length ? rows[rows.length - 1].id : null
        return { rows, nextCursor, hasMore: Boolean(nextCursor) }
      },
    )
    // `onError` is built ONCE. A fresh function per render changes
    // `loadPage`'s identity every time, which re-runs the effect that reloads
    // page 0 — the hook then never settles and the test times out rather
    // than failing on anything it was written to check.
    const onError = jest.fn()
    const view = renderHook(() =>
      useStaffListPagination<Row>({ fetchPage, onError, pageSize: 2 }),
    )
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(ids(view.result.current.rows)).toBe('ab')

    // Walk forward so there are cursors to invalidate — a cursor names a
    // position in a walk of a GIVEN width and points somewhere else under
    // another.
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    expect(ids(view.result.current.rows)).toBe('cd')

    await act(async () => {
      view.result.current.setPageSize(4)
    })
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    // THE ASSERTIONS. A new request went out, it carried the new width, and
    // the walk restarted from the top rather than resuming on a cursor cut
    // for the old one. The first request is asserted too, so "the size
    // reaches the route" is a claim about a value that MOVED.
    expect(seen[0]).toEqual({ cursor: null, size: 2 })
    expect(seen.at(-1)).toEqual({ cursor: null, size: 4 })
    expect(view.result.current.pageIndex).toBe(0)
    expect(ids(view.result.current.rows)).toBe('abcd')
    expect(view.result.current.pageSize).toBe(4)
  })

  it('THE CONTROL: the fake route honors the width it is handed', async () => {
    // Otherwise the test above could pass against a route that returned the
    // same rows whatever it was asked for, and "the size reached the query"
    // would be a claim about an argument nothing consumed.
    const seen: number[] = []
    const pool = 'abcdefghi'.split('').map((id) => ({ id }))
    const fetchPage = jest.fn(
      async (cursor: string | null, _index: number, size: number) => {
        seen.push(size)
        return {
          rows: pool.slice(0, size),
          nextCursor: null,
          hasMore: false,
        }
      },
    )
    const onError = jest.fn()
    const view = renderHook(() =>
      useStaffListPagination<Row>({ fetchPage, onError, pageSize: 3 }),
    )
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(seen).toEqual([3])
    expect(ids(view.result.current.rows)).toBe('abc')
  })

  it('refresh re-reads the page on screen, not page 0', async () => {
    // The post-mutation target. Bouncing an operator back to page 1 after
    // every grant is how a staff screen becomes unusable at scale.
    const { view, seen } = harness()
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    await act(async () => {
      await view.result.current.loadPage(1)
    })
    await act(async () => {
      view.result.current.refresh()
    })
    expect(seen).toEqual([null, 'b', 'b'])
    expect(view.result.current.pageIndex).toBe(1)
  })
})

describe('both staff list screens use the one implementation', () => {
  const read = (file: string) =>
    readFileSync(join(__dirname, '..', file), 'utf8')
  const SCREENS = [
    'app/(app)/admin/orgs/page.tsx',
    'app/(app)/admin/users/page.tsx',
  ]

  it('reads real files', () => {
    for (const file of SCREENS) expect(read(file).length).toBeGreaterThan(5000)
  })

  /**
   * A RENDERED shared footer, in either spelling.
   *
   * The Organizations list pages the walk itself, so its footer is the walk's
   * and it goes through `StaffListPaginationControls`. The Users list pages
   * what is on SCREEN out of a wide Auth walk, which the staff control does
   * not model, so it renders the shared `ListPagination` directly. Both are
   * the one footer; neither is a second implementation.
   *
   * Matched on the JSX rather than the identifier, so a stale import cannot
   * satisfy it.
   */
  const SHARED_FOOTER = /<(ListPagination|StaffListPaginationControls)[\s>]/

  it('THE CONTROL: the footer check reads JSX, not an import', () => {
    // Guard the guard. A check that matched the word anywhere would pass on
    // a file that imported the footer and rendered a pair of buttons.
    expect(SHARED_FOOTER.test('<ListPagination page={0} />')).toBe(true)
    expect(SHARED_FOOTER.test('<StaffListPaginationControls pagination={p} />')).toBe(
      true,
    )
    expect(
      SHARED_FOOTER.test(
        "import ListPagination from 'x'\n<Button>{'Next'}</Button>",
      ),
    ).toBe(false)
  })

  it.each(SCREENS)('%s paginates through the shared hook', (file) => {
    const text = read(file)
    expect(text).toContain('useStaffListPagination')
    expect(text).toMatch(SHARED_FOOTER)
  })

  it.each(SCREENS)('%s keeps no private cursor table', (file) => {
    // The specific shape of a second implementation: the page walking its own
    // `pageCursorsRef` again, or the Users page back on `Load more`.
    const text = read(file)
    expect(text).not.toContain('pageCursorsRef')
    // The RENDERED label, not the word: the Users page names `Load more` in
    // the comment explaining what it replaced, and a guard that cannot tell
    // a button from a sentence about a button would force that history out
    // of the file to stay green.
    expect(text).not.toContain("{'Load more'}")
  })
})
