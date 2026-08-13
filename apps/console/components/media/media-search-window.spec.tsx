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
 * AGL-1460: what searching the whole library costs.
 *
 * AGL-1462 took 9,165 documents out of a 65-file delete pass and this must
 * not give any of it back, so every assertion here is a fetch COUNT — the
 * same counter that spec uses, one call standing for one query of up to
 * `MEDIA_PAGE_SIZE` billed reads.
 *
 * The claim being tested: making search honest costs the REST OF THE CURRENT
 * QUERY, once, and nothing per keystroke. `loadAll` is the whole cost, it is
 * idempotent, it is capped, and it is thrown away only when the query itself
 * changes.
 */

import { useDebounce } from '@aglyn/shared-util-vendor'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useMediaPages } from './use-media-pages'

const PAGE = 60
/** The org library on the day the issue was written. */
const LIBRARY = 174
/** The component's cap — high enough to be irrelevant here. */
const CAP = 1200

interface Cursor {
  index: number
}

function makeCorpus(size = LIBRARY) {
  const docs = Array.from({ length: size }, (_, index) => ({
    $id: `m${index}`,
    fileName: `file-${index}.png`,
  }))
  const state = { fetches: 0, documentsRead: 0 }
  const fetchPage = async (cursor: Cursor | null) => {
    state.fetches += 1
    const slice = docs.slice(
      (cursor?.index ?? -1) + 1,
      (cursor?.index ?? -1) + 1 + PAGE,
    )
    state.documentsRead += slice.length
    return {
      docs: slice.map((item) => ({ ...item })),
      last: slice.length
        ? ({ index: (cursor?.index ?? -1) + slice.length } as Cursor)
        : null,
      more: slice.length === PAGE,
    }
  }
  return { state, fetchPage }
}

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

const firstPage = async (view: ReturnType<typeof renderPages>) =>
  waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))

describe('completing the set so search can tell the truth (AGL-1460)', () => {
  it('starts partial, and says so', async () => {
    const { fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await firstPage(view)

    // 60 of 174. Everything the old search claimed about the other 114 was
    // an answer about documents it had never read.
    expect(view.result.current.docs).toHaveLength(PAGE)
    expect(view.result.current.complete).toBe(false)
  })

  it('pages to the end of the query and nothing further', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await firstPage(view)
    expect(state.fetches).toBe(1)

    await act(async () => {
      await view.result.current.loadAll(CAP)
    })

    expect(view.result.current.docs).toHaveLength(LIBRARY)
    expect(view.result.current.complete).toBe(true)
    expect(view.result.current.truncated).toBe(false)
    // The cost, stated: two more page fetches, 114 more documents. That is
    // the same read a person pays clicking "Load more" twice — which is what
    // they had to do before this to search their own library.
    expect(state.fetches).toBe(3)
    expect(state.documentsRead).toBe(LIBRARY)
  })

  /**
   * The property that keeps a per-keystroke design honest. The component
   * debounces the CALL; this makes the call itself free once the answer is
   * in hand, so a slow typist who out-waits the debounce still pays once.
   */
  it('costs nothing the second time, or the hundredth', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await firstPage(view)
    await act(async () => {
      await view.result.current.loadAll(CAP)
    })
    const afterFirst = state.fetches

    for (let keystroke = 0; keystroke < 100; keystroke += 1) {
      await act(async () => {
        await view.result.current.loadAll(CAP)
      })
    }

    expect(state.fetches).toBe(afterFirst)
  })

  it('collapses overlapping calls into one pass', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await firstPage(view)

    await act(async () => {
      await Promise.all([
        view.result.current.loadAll(CAP),
        view.result.current.loadAll(CAP),
        view.result.current.loadAll(CAP),
      ])
    })

    expect(state.fetches).toBe(3)
    expect(view.result.current.docs).toHaveLength(LIBRARY)
  })

  it('stops at the cap and admits it rather than reading a huge library', async () => {
    const { state, fetchPage } = makeCorpus(9000)
    const view = renderPages(fetchPage)
    await firstPage(view)

    await act(async () => {
      await view.result.current.loadAll(120)
    })

    expect(view.result.current.docs).toHaveLength(120)
    expect(view.result.current.truncated).toBe(true)
    expect(view.result.current.complete).toBe(false)
    // Two fetches, not 150. The cap is the read ceiling, not a display one.
    expect(state.fetches).toBe(2)
  })

  it('leaves "Load more" working past a capped completion', async () => {
    const { fetchPage } = makeCorpus(9000)
    const view = renderPages(fetchPage)
    await firstPage(view)
    await act(async () => {
      await view.result.current.loadAll(120)
    })

    expect(view.result.current.hasMore).toBe(true)
    await act(async () => {
      await view.result.current.loadMore()
    })
    expect(view.result.current.docs).toHaveLength(180)
  })
})

/**
 * The claim the issue asked to be measured rather than assumed: what typing
 * costs. The harness below is the library's own completion effect — the same
 * `useDebounce`, the same guards, the same call — wired to the same counter,
 * so the number is a measurement of the shipped path and not of a mock.
 */
const DEBOUNCE_MS = 400
const MIN_CHARS = 2

function renderTyping(fetchPage: (cursor: Cursor | null) => Promise<any>) {
  return renderHook(() => {
    const [ready] = useState(true)
    const [search, setSearch] = useState('')
    const stable = useCallback(
      (cursor: Cursor | null) => fetchPage(cursor),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    )
    const pages = useMediaPages<Cursor>({ fetchPage: stable, ready })
    const [debouncedSearch] = useDebounce(search.trim(), DEBOUNCE_MS)
    const { hasMore, loadAll } = pages
    useEffect(() => {
      if (debouncedSearch.length < MIN_CHARS) return
      if (!hasMore) return
      void loadAll(CAP)
    }, [debouncedSearch, hasMore, loadAll])
    return { ...pages, setSearch }
  })
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('what typing costs, measured (AGL-1460)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('costs nothing per keystroke, and one completion for the phrase', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderTyping(fetchPage)
    await flush()
    expect(view.result.current.docs).toHaveLength(PAGE)
    expect(state.fetches).toBe(1)

    // Every keystroke of a real query, faster than the debounce.
    const phrase = 'mock-*-noshadow.png'
    for (let index = 1; index <= phrase.length; index += 1) {
      await act(async () => {
        view.result.current.setSearch(phrase.slice(0, index))
        jest.advanceTimersByTime(50)
      })
    }
    // Not one read yet — 19 characters, zero page fetches beyond the mount.
    expect(state.fetches).toBe(1)

    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS)
    })
    await flush()

    // The whole phrase cost the rest of the library, once: 2 fetches, 114
    // documents. That is the same read the author was already paying by hand
    // in "Load more" clicks in order to search a library they could see the
    // size of but not search.
    expect(state.fetches).toBe(3)
    expect(state.documentsRead).toBe(LIBRARY)
    expect(view.result.current.complete).toBe(true)

    // And every keystroke after that costs nothing at all.
    await act(async () => {
      view.result.current.setSearch(`${phrase} tag:hero`)
      jest.advanceTimersByTime(DEBOUNCE_MS * 3)
    })
    await flush()
    expect(state.fetches).toBe(3)
  })

  it('does not complete on a single character', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderTyping(fetchPage)
    await flush()

    await act(async () => {
      view.result.current.setSearch('m')
      jest.advanceTimersByTime(DEBOUNCE_MS * 3)
    })
    await flush()

    expect(state.fetches).toBe(1)
    expect(view.result.current.complete).toBe(false)
  })
})

describe('a completed window is still a window (AGL-1460 / AGL-1462)', () => {
  /**
   * `complete` is a claim about the CURRENT query. Changing the folder, the
   * type facet or the sort is a different query, and the AGL-1462 reset
   * throws the window away — so the claim has to go with it, or the helper
   * text would promise a full search over a fresh first page.
   */
  it('drops the claim when the query changes', async () => {
    const { fetchPage } = makeCorpus()
    let generation = 0
    const view = renderHook(
      () => {
        const [ready] = useState(true)
        const stable = useCallback(
          (cursor: Cursor | null) => fetchPage(cursor),
          // eslint-disable-next-line react-hooks/exhaustive-deps
          [generation],
        )
        return useMediaPages<Cursor>({ fetchPage: stable, ready })
      },
      { initialProps: {} },
    )
    await firstPage(view)
    await act(async () => {
      await view.result.current.loadAll(CAP)
    })
    expect(view.result.current.complete).toBe(true)

    generation = 1
    view.rerender({})
    await waitFor(() => expect(view.result.current.docs.length).toBe(PAGE))
    expect(view.result.current.complete).toBe(false)
  })

  /** A delete still costs nothing, completed or not (AGL-1462). */
  it('survives a delete without re-reading', async () => {
    const { state, fetchPage } = makeCorpus()
    const view = renderPages(fetchPage)
    await firstPage(view)
    await act(async () => {
      await view.result.current.loadAll(CAP)
    })
    const before = state.fetches

    act(() => view.result.current.dropLocal(['m150']))

    expect(view.result.current.docs).toHaveLength(LIBRARY - 1)
    expect(state.fetches).toBe(before)
    expect(view.result.current.complete).toBe(true)
  })
})
