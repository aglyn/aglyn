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
 * AGL-1462: what a delete costs in Firestore reads.
 *
 * Every assertion here is about a COUNT, because the issue is about cost. The
 * fake below is a real page-fetch counter standing in for `getDocs`: one call
 * is one query, and one query is `MEDIA_PAGE_SIZE` billed document reads. The
 * counter is what is measured; the document figures quoted in the commit are
 * that count multiplied by the page size.
 *
 * The library this models is the real one from the 2026-08-13 pass: 174
 * assets, pages of 60, a window of all three pages open, deleting 65 files.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useCallback, useMemo, useState } from 'react'

import { useMediaPages } from './use-media-pages'

/** Page size the DAM uses (AGL-174). */
const PAGE = 60
/** The org library on the day the issue was written. */
const LIBRARY = 174

interface Cursor {
  index: number
}

/** A counting stand-in for the paged `getDocs` call. */
function makeCorpus(size = LIBRARY) {
  const docs = Array.from({ length: size }, (_, index) => ({
    $id: `m${index}`,
    fileName: `file-${index}.png`,
    tags: ['keep'],
  }))
  const live = new Set(docs.map((item) => item.$id))
  const state = { fetches: 0, documentsRead: 0 }
  const fetchPage = async (cursor: Cursor | null) => {
    state.fetches += 1
    const remaining = docs.filter(
      (item, index) => live.has(item.$id) && index > (cursor?.index ?? -1),
    )
    const slice = remaining.slice(0, PAGE)
    state.documentsRead += slice.length
    const lastIndex = slice.length
      ? docs.findIndex((item) => item.$id === slice[slice.length - 1].$id)
      : -1
    return {
      docs: slice.map((item) => ({ ...item })),
      last: slice.length ? ({ index: lastIndex } as Cursor) : null,
      more: slice.length === PAGE,
    }
  }
  /** What the DELETE route does server-side. */
  const serverDelete = (id: string) => void live.delete(id)
  return { state, fetchPage, serverDelete }
}

/**
 * The hook under a stable `fetchPage`, exactly as the library holds it: a
 * `useCallback` whose deps are the filter set, so its identity changes when —
 * and only when — the query does.
 */
function renderPages(fetchPage: (cursor: Cursor | null) => Promise<any>) {
  return renderHook(() => {
    const [ready] = useState(true)
    const stable = useCallback(
      (cursor: Cursor | null) => fetchPage(cursor),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    )
    const onError = useMemo(() => jest.fn(), [])
    return useMediaPages<Cursor>({ fetchPage: stable, ready, onError })
  })
}

/** Open every page, as a person clicking "Load more" until it disappears. */
async function openWholeWindow(view: ReturnType<typeof renderPages>) {
  await waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))
  while (view.result.current.hasMore) {
    await act(async () => {
      await view.result.current.loadMore()
    })
  }
}

describe('the loaded window survives a delete (AGL-1462)', () => {
  it('keeps every page on screen and fetches nothing', async () => {
    const { state, fetchPage, serverDelete } = makeCorpus()
    const view = renderPages(fetchPage)
    await openWholeWindow(view)

    expect(view.result.current.docs).toHaveLength(LIBRARY)
    // 174 assets at 60 a page: one initial load plus two "Load more".
    expect(state.fetches).toBe(3)
    const fetchesBefore = state.fetches

    // Delete one file from the middle of the third page.
    const doomed = view.result.current.docs[150].$id
    serverDelete(doomed)
    act(() => view.result.current.dropLocal([doomed]))

    // The remaining items are STILL on screen…
    expect(view.result.current.docs).toHaveLength(LIBRARY - 1)
    expect(
      view.result.current.docs.some((item: any) => item.$id === doomed),
    ).toBe(false)
    // …and no page was fetched to keep them there.
    expect(state.fetches).toBe(fetchesBefore)

    // Nothing about "Load more" moved either: the button is still gone,
    // because the window still holds the whole library.
    expect(view.result.current.hasMore).toBe(false)
  })

  it('drops a whole bulk selection in one pass, still without a fetch', async () => {
    const { state, fetchPage, serverDelete } = makeCorpus()
    const view = renderPages(fetchPage)
    await openWholeWindow(view)
    const fetchesBefore = state.fetches

    const doomed = view.result.current.docs
      .slice(20, 85)
      .map((item: any) => item.$id)
    expect(doomed).toHaveLength(65)
    doomed.forEach(serverDelete)
    act(() => view.result.current.dropLocal(doomed))

    expect(view.result.current.docs).toHaveLength(LIBRARY - 65)
    expect(state.fetches).toBe(fetchesBefore)
  })

  it('applies a field the client already wrote without a fetch', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await openWholeWindow(view)
    const fetchesBefore = state.fetches

    act(() =>
      view.result.current.patchLocal(['m2'], (item: any) => ({
        tags: [...item.tags, 'hero'],
      })),
    )
    expect(
      view.result.current.docs.find((item: any) => item.$id === 'm2').tags,
    ).toEqual(['keep', 'hero'])
    expect(state.fetches).toBe(fetchesBefore)
  })
})

describe('what the old mechanism cost (AGL-1462)', () => {
  /**
   * `refresh()` is still here and still correct for an upload or a folder
   * move — but this is what it does, and what routing a delete through it was
   * charging on every single file.
   */
  it('refresh() collapses the window back to one page', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await openWholeWindow(view)
    expect(view.result.current.docs).toHaveLength(LIBRARY)

    act(() => view.result.current.refresh())
    await waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))
    expect(state.fetches).toBe(4)
    expect(view.result.current.hasMore).toBe(true)
  })

  /**
   * The measurement, run rather than argued. Deleting 65 files with the
   * window collapsing each time costs the re-paging 65 times over; deleting
   * them locally costs nothing beyond the three pages already loaded.
   */
  it('measures both paths over the 65-file pass that raised the issue', async () => {
    const old = makeCorpus()
    const oldView = renderPages(old.fetchPage)
    await openWholeWindow(oldView)
    const oldBaseline = old.state.documentsRead

    for (let index = 0; index < 65; index += 1) {
      old.serverDelete(oldView.result.current.docs[0].$id)
      // The pre-AGL-1462 delete path: bump the key, re-read page one, then
      // click "Load more" back to where you were.
      act(() => oldView.result.current.refresh())
      await waitFor(() =>
        expect(oldView.result.current.loading).toBe(false),
      )
      await openWholeWindow(oldView)
    }
    const oldCost = old.state.documentsRead - oldBaseline

    const now = makeCorpus()
    const nowView = renderPages(now.fetchPage)
    await openWholeWindow(nowView)
    const nowBaseline = now.state.documentsRead
    const nowFetches = now.state.fetches

    for (let index = 0; index < 65; index += 1) {
      const doomed = nowView.result.current.docs[0].$id
      now.serverDelete(doomed)
      act(() => nowView.result.current.dropLocal([doomed]))
    }
    const nowCost = now.state.documentsRead - nowBaseline

    expect(nowView.result.current.docs).toHaveLength(LIBRARY - 65)
    expect(nowCost).toBe(0)
    expect(now.state.fetches).toBe(nowFetches)
    // Not a threshold anybody has to maintain — a floor that fails loudly if
    // a delete ever goes back through `refresh()`.
    expect(oldCost).toBeGreaterThan(5000)
    // Printed so the number in the commit message is one this suite produced.
    // eslint-disable-next-line no-console
    console.log(
      `[AGL-1462] 65 deletes: before ${oldCost} document reads in ` +
        `${old.state.fetches} page fetches; after ${nowCost} in 0.`,
    )
  }, 60000)
})

describe('a query change still resets the window (AGL-1462)', () => {
  /**
   * The reset is not a bug in general — it is the right answer when the QUERY
   * changed, and that has to keep working. A new `fetchPage` identity is what
   * says so.
   */
  it('re-reads page one when the filter set changes', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderHook(
      ({ folder }: { folder: string }) => {
        // A new identity per filter set, exactly as the library's
        // `buildConstraints`/`fetchPage` pair produces one.
        const stable = useCallback(
          (cursor: Cursor | null) => fetchPage(cursor),
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [folder],
        )
        return useMediaPages<Cursor>({ fetchPage: stable, ready: true })
      },
      { initialProps: { folder: 'all' } },
    )
    await waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))
    await act(async () => {
      await view.result.current.loadMore()
    })
    expect(view.result.current.docs).toHaveLength(PAGE * 2)

    view.rerender({ folder: 'brand' })
    await waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))
    expect(state.fetches).toBe(3)
  })

  it('reads nothing at all until the caller is ready', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderHook(
      ({ ready }: { ready: boolean }) => {
        const stable = useCallback(
          (cursor: Cursor | null) => fetchPage(cursor),
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [],
        )
        return useMediaPages<Cursor>({ fetchPage: stable, ready })
      },
      { initialProps: { ready: false } },
    )
    expect(state.fetches).toBe(0)
    view.rerender({ ready: true })
    await waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))
    expect(state.fetches).toBe(1)
  })
})
