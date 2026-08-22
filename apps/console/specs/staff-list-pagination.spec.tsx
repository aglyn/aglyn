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

  it.each(SCREENS)('%s paginates through the shared hook', (file) => {
    const text = read(file)
    expect(text).toContain('useStaffListPagination')
    expect(text).toContain('StaffListPaginationControls')
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
