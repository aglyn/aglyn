/**
 * @jest-environment node
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
 * AGL-1462. The arithmetic behind "delete one file without re-reading the
 * library" and "⇧-click selects the run between two cards".
 *
 * The case that earns the module: a delete removes an item from the MIDDLE of
 * a range that is still selected, and the next ⇧-click has to measure against
 * the list as it is now. An implementation that remembers the anchor as an
 * index passes every other test here and fails that one silently — it selects
 * a range that is off by the number of deleted files above it.
 */

import {
  dropMediaFromPages,
  EMPTY_MEDIA_SELECTION,
  forgetMediaSelection,
  mediaSelectionRange,
  type MediaSelectionState,
  nextMediaSelection,
  patchMediaInPages,
} from './media-selection'

/** `n` documents named `a0…`, split into pages of `size`. */
function windowOf(n: number, size = 3): any[][] {
  const pages: any[][] = []
  for (let index = 0; index < n; index += size) {
    pages.push(
      Array.from({ length: Math.min(size, n - index) }, (_, offset) => ({
        $id: `a${index + offset}`,
        fileName: `a${index + offset}.png`,
        tags: ['keep'],
      })),
    )
  }
  return pages
}

const idsOf = (pages: any[][]) => pages.flat().map((item) => item.$id)

describe('dropMediaFromPages (AGL-1462)', () => {
  it('removes the deleted document and keeps every other page', () => {
    const pages = windowOf(9)
    const next = dropMediaFromPages(pages, ['a4'])
    expect(next).toHaveLength(3)
    expect(idsOf(next)).toEqual(['a0', 'a1', 'a2', 'a3', 'a5', 'a6', 'a7', 'a8'])
  })

  it('removes a whole bulk selection in one pass', () => {
    const next = dropMediaFromPages(windowOf(9), ['a0', 'a4', 'a8'])
    expect(idsOf(next)).toEqual(['a1', 'a2', 'a3', 'a5', 'a6', 'a7'])
  })

  /**
   * An empty page is kept rather than spliced out. "Load more" resumes from a
   * cursor tied to the last document of the last page; re-slicing the pages
   * underneath it is how that cursor stops meaning what it says.
   */
  it('keeps the page structure when a page empties', () => {
    const next = dropMediaFromPages(windowOf(9), ['a3', 'a4', 'a5'])
    expect(next).toHaveLength(3)
    expect(next[1]).toEqual([])
  })

  it('returns the same array when nothing matched', () => {
    const pages = windowOf(6)
    expect(dropMediaFromPages(pages, ['nope'])).toBe(pages)
    expect(dropMediaFromPages(pages, [])).toBe(pages)
  })
})

describe('patchMediaInPages (AGL-1462)', () => {
  it('applies a flat patch to the named documents only', () => {
    const next = patchMediaInPages(windowOf(6), ['a1'], { private: true })
    expect(next.flat().find((item) => item.$id === 'a1').private).toBe(true)
    expect(next.flat().filter((item) => item.private)).toHaveLength(1)
  })

  it('applies a per-document patch computed from the document', () => {
    const next = patchMediaInPages(windowOf(6), ['a1', 'a2'], (item) => ({
      tags: [...item.tags, 'new'],
    }))
    const tagged = next.flat().filter((item) => item.tags.includes('new'))
    expect(tagged.map((item) => item.$id)).toEqual(['a1', 'a2'])
  })

  it('returns the same array when nothing matched', () => {
    const pages = windowOf(6)
    expect(patchMediaInPages(pages, ['nope'], { x: 1 })).toBe(pages)
  })
})

describe('mediaSelectionRange (AGL-1462)', () => {
  const order = ['a', 'b', 'c', 'd', 'e']

  it('is inclusive of both ends', () => {
    expect(mediaSelectionRange(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  it('reads the same in either direction', () => {
    expect(mediaSelectionRange(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('degrades to the clicked card when the anchor is gone', () => {
    expect(mediaSelectionRange(order, 'zz', 'c')).toEqual(['c'])
    expect(mediaSelectionRange(order, null, 'c')).toEqual(['c'])
  })
})

describe('nextMediaSelection (AGL-1462)', () => {
  const order = ['a', 'b', 'c', 'd', 'e']

  it('a plain click selects one card and anchors there', () => {
    const state = nextMediaSelection(EMPTY_MEDIA_SELECTION, {
      orderedIds: order,
      id: 'b',
      checked: true,
    })
    expect([...state.ids]).toEqual(['b'])
    expect(state.anchorId).toBe('b')
  })

  it('a ⇧-click selects the inclusive range and holds the anchor', () => {
    const first = nextMediaSelection(EMPTY_MEDIA_SELECTION, {
      orderedIds: order,
      id: 'b',
      checked: true,
    })
    const ranged = nextMediaSelection(first, {
      orderedIds: order,
      id: 'd',
      checked: true,
      range: true,
    })
    expect([...ranged.ids].sort()).toEqual(['b', 'c', 'd'])
    // Still measured from `b`, so extending to `e` grows the same range
    // rather than starting a new one at `d`.
    expect(ranged.anchorId).toBe('b')
    const extended = nextMediaSelection(ranged, {
      orderedIds: order,
      id: 'e',
      checked: true,
      range: true,
    })
    expect([...extended.ids].sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('a ⇧-click with no anchor behaves as a plain click', () => {
    const state = nextMediaSelection(EMPTY_MEDIA_SELECTION, {
      orderedIds: order,
      id: 'c',
      checked: true,
      range: true,
    })
    expect([...state.ids]).toEqual(['c'])
    expect(state.anchorId).toBe('c')
  })

  it('a ⇧-click that unchecks clears the whole range', () => {
    const all: MediaSelectionState = { ids: new Set(order), anchorId: 'b' }
    const cleared = nextMediaSelection(all, {
      orderedIds: order,
      id: 'd',
      checked: false,
      range: true,
    })
    expect([...cleared.ids].sort()).toEqual(['a', 'e'])
  })
})

describe('a range that outlives a delete from its middle (AGL-1462)', () => {
  /**
   * The whole reason the anchor is an id. Select a…e, delete `c` from the
   * middle, then ⇧-click one further: the new range is measured against the
   * four remaining cards. Anchored by INDEX, the anchor would still say "2",
   * which is now `d` — and the range would silently start one card late.
   */
  it('measures the next ⇧-click against the list as it is now', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f']
    let state = nextMediaSelection(EMPTY_MEDIA_SELECTION, {
      orderedIds: before,
      id: 'a',
      checked: true,
    })
    state = nextMediaSelection(state, {
      orderedIds: before,
      id: 'e',
      checked: true,
      range: true,
    })
    expect([...state.ids].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])

    // `c` is deleted out of the middle of that range.
    const after = ['a', 'b', 'd', 'e', 'f']
    state = forgetMediaSelection(state, ['c'])
    expect([...state.ids].sort()).toEqual(['a', 'b', 'd', 'e'])
    expect(state.anchorId).toBe('a')

    state = nextMediaSelection(state, {
      orderedIds: after,
      id: 'f',
      checked: true,
      range: true,
    })
    expect([...state.ids].sort()).toEqual(['a', 'b', 'd', 'e', 'f'])
    // And the deleted file is not resurrected by the range.
    expect(state.ids.has('c')).toBe(false)
  })

  it('drops the anchor when the anchor itself was deleted', () => {
    const before = ['a', 'b', 'c', 'd']
    let state = nextMediaSelection(EMPTY_MEDIA_SELECTION, {
      orderedIds: before,
      id: 'b',
      checked: true,
    })
    state = forgetMediaSelection(state, ['b'])
    expect(state.anchorId).toBeNull()
    expect([...state.ids]).toEqual([])

    // The next ⇧-click starts a fresh anchor instead of ranging from
    // whichever file slid into `b`'s position.
    state = nextMediaSelection(state, {
      orderedIds: ['a', 'c', 'd'],
      id: 'd',
      checked: true,
      range: true,
    })
    expect([...state.ids]).toEqual(['d'])
    expect(state.anchorId).toBe('d')
  })

  it('leaves the state alone when nothing was deleted', () => {
    const state: MediaSelectionState = { ids: new Set(['a']), anchorId: 'a' }
    expect(forgetMediaSelection(state, [])).toBe(state)
    expect(forgetMediaSelection(state, ['zz'])).toBe(state)
  })
})
