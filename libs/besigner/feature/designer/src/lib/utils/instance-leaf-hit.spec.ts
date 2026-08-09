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

import { findInstanceLeafAtPoint } from './instance-leaf-hit'

/** jsdom has no layout — stamp each element with the rect it "occupies". */
function mockRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  ;(el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }) as DOMRect
}

describe('findInstanceLeafAtPoint (AGL-1304)', () => {
  /**
   * The DOM shape NodeLeaf renders for an instance: the instance element
   * containing a pointer-events-none preview whose leaves carry the plain
   * renderer's `leaf:<graftedId>` stamps.
   */
  function buildPreview() {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-aglyn="leaf:decoy-outside-preview"></div>
      <div data-aglyn-component-preview="">
        <div data-aglyn="leaf:cmp__inst__root">
          <h1 data-aglyn="leaf:cmp__inst__h"></h1>
          <img data-aglyn="leaf:cmp__inst__img" />
          <span data-aglyn="leaf:cmp__inst__hidden"></span>
        </div>
      </div>`
    const [decoy] = Array.from(
      container.querySelectorAll('[data-aglyn="leaf:decoy-outside-preview"]'),
    )
    const root = container.querySelector('[data-aglyn="leaf:cmp__inst__root"]')!
    const h = container.querySelector('[data-aglyn="leaf:cmp__inst__h"]')!
    const img = container.querySelector('[data-aglyn="leaf:cmp__inst__img"]')!
    const hidden = container.querySelector(
      '[data-aglyn="leaf:cmp__inst__hidden"]',
    )!
    mockRect(decoy, { left: 0, top: 0, width: 500, height: 500 })
    mockRect(root, { left: 0, top: 0, width: 400, height: 300 })
    mockRect(h, { left: 20, top: 20, width: 360, height: 40 })
    mockRect(img, { left: 20, top: 80, width: 120, height: 90 })
    // Collapsed (display:none) elements report a zero rect.
    mockRect(hidden, { left: 0, top: 0, width: 0, height: 0 })
    return { container, root, h, img }
  }

  it('resolves the deepest leaf under the point, with its element', () => {
    const { container, h } = buildPreview()
    expect(findInstanceLeafAtPoint(container, 40, 30)).toEqual({
      graftedId: 'cmp__inst__h',
      element: h,
    })
    expect(findInstanceLeafAtPoint(container, 40, 100)?.graftedId).toBe(
      'cmp__inst__img',
    )
  })

  it('falls back to the containing ancestor between children', () => {
    const { container } = buildPreview()
    // Inside the root, below both children.
    expect(findInstanceLeafAtPoint(container, 40, 250)?.graftedId).toBe(
      'cmp__inst__root',
    )
  })

  it('misses cleanly outside the preview', () => {
    const { container } = buildPreview()
    expect(findInstanceLeafAtPoint(container, 450, 30)).toBeNull()
  })

  it('ignores stamped elements outside the preview subtree', () => {
    const { container } = buildPreview()
    // The decoy covers (450, 400) but is not preview content — editor
    // chrome and the instance's own leaf must never resolve as a graft.
    expect(findInstanceLeafAtPoint(container, 450, 400)).toBeNull()
  })

  it('skips zero-sized (collapsed) leaves', () => {
    const { container } = buildPreview()
    // (0, 0) sits on the hidden span's zero rect AND the root — root wins.
    expect(findInstanceLeafAtPoint(container, 0, 0)?.graftedId).toBe(
      'cmp__inst__root',
    )
  })

  it('later unrelated leaves win where siblings overlap', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div data-aglyn-component-preview="">
        <div data-aglyn="leaf:cmp__inst__under"></div>
        <div data-aglyn="leaf:cmp__inst__over"></div>
      </div>`
    const [under, over] = Array.from(
      container.querySelectorAll('[data-aglyn^="leaf:"]'),
    )
    mockRect(under, { left: 0, top: 0, width: 100, height: 100 })
    mockRect(over, { left: 50, top: 0, width: 100, height: 100 })
    // Overlap region: painted later, `over` sits on top.
    expect(findInstanceLeafAtPoint(container, 75, 50)?.graftedId).toBe(
      'cmp__inst__over',
    )
    // Non-overlap region still hits the earlier sibling.
    expect(findInstanceLeafAtPoint(container, 25, 50)?.graftedId).toBe(
      'cmp__inst__under',
    )
  })
})
