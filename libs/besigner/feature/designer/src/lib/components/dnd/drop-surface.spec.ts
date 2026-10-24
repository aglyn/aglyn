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

import {
  closestDropSurface,
  DROP_SURFACE_ATTRIBUTE,
  DropSurface,
  dropSurfaceAtPoint,
  flowAxisOf,
  visibleRectOf,
} from './drop-surface'

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

function surface(name: DropSurface) {
  const el = document.createElement('div')
  el.setAttribute(DROP_SURFACE_ATTRIBUTE, name)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('closestDropSurface', () => {
  it('finds the surface of an element inside a closed shadow root', () => {
    // Every canvas element lives in the canvas's closed shadow root, and
    // `closest` alone stops at the boundary.
    const canvas = surface(DropSurface.CANVAS)
    const host = document.createElement('div')
    canvas.appendChild(host)
    const root = host.attachShadow({ mode: 'closed' })
    const leaf = document.createElement('section')
    root.appendChild(leaf)
    expect(closestDropSurface(leaf)).toBe(canvas)
  })

  it('is null for an element on no surface', () => {
    const loose = document.createElement('div')
    document.body.appendChild(loose)
    expect(closestDropSurface(loose)).toBeNull()
  })
})

describe('dropSurfaceAtPoint', () => {
  it('names the surface painted under the point', () => {
    const tree = surface(DropSurface.TREE)
    const row = document.createElement('li')
    tree.appendChild(row)
    const doc = { elementFromPoint: () => row } as unknown as Document
    expect(dropSurfaceAtPoint(10, 10, doc)).toBe(tree)
  })

  it('is undefined where nothing can be hit-tested, so nothing is ruled out', () => {
    expect(dropSurfaceAtPoint(10, 10, {} as Document)).toBeUndefined()
  })
})

describe('flowAxisOf', () => {
  function family(
    rects: Array<{ left: number; top: number; width: number; height: number }>,
    parentStyle = '',
  ) {
    const parent = document.createElement('div')
    parent.setAttribute('style', parentStyle)
    document.body.appendChild(parent)
    return rects.map((rect) => {
      const child = document.createElement('div')
      mockRect(child, rect)
      parent.appendChild(child)
      return child
    })
  }

  it('reads a row from a neighbour beside it', () => {
    const [, middle] = family([
      { left: 0, top: 0, width: 100, height: 50 },
      { left: 110, top: 0, width: 100, height: 50 },
    ])
    expect(flowAxisOf(middle)).toBe('horizontal')
  })

  it('reads a column from a neighbour above it, however wide the element is', () => {
    // The old leaf split assumed a wide element's siblings ran left/right.
    const [, below] = family([
      { left: 0, top: 0, width: 800, height: 40 },
      { left: 0, top: 40, width: 800, height: 40 },
    ])
    expect(flowAxisOf(below)).toBe('vertical')
  })

  it('treats the first item of a wrapped line as part of a row', () => {
    const [, , wrapped] = family([
      { left: 0, top: 0, width: 100, height: 50 },
      { left: 110, top: 0, width: 100, height: 50 },
      { left: 0, top: 60, width: 100, height: 50 },
      { left: 110, top: 60, width: 100, height: 50 },
    ])
    expect(flowAxisOf(wrapped)).toBe('horizontal')
  })

  it("asks an only child's parent how it lays out", () => {
    const [onlyInRow] = family(
      [{ left: 0, top: 0, width: 100, height: 50 }],
      'display: flex; flex-direction: row',
    )
    expect(flowAxisOf(onlyInRow)).toBe('horizontal')
    const [onlyInBlock] = family([{ left: 0, top: 0, width: 100, height: 50 }])
    expect(flowAxisOf(onlyInBlock)).toBe('vertical')
  })
})

describe('visibleRectOf', () => {
  it('cuts an element down to what its clipping ancestors show', () => {
    const panel = document.createElement('div')
    panel.style.overflow = 'hidden'
    mockRect(panel, { left: 0, top: 0, width: 300, height: 200 })
    const inner = document.createElement('div')
    mockRect(inner, { left: -50, top: 100, width: 500, height: 300 })
    panel.appendChild(inner)
    document.body.appendChild(panel)
    expect(visibleRectOf(inner)).toEqual({
      left: 0,
      top: 100,
      right: 300,
      bottom: 200,
      width: 300,
      height: 100,
    })
  })
})
