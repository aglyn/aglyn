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

import { DragType, refs } from '@aglyn/besigner'
import { DROP_SURFACE_ATTRIBUTE, DropSurface } from './drop-surface'
import {
  besignerCollisionDetection,
  dropAxisOf,
  dropTargetRect,
} from './drop-targeting'

type Box = { left: number; top: number; width: number; height: number }

const edges = (box: Box) => ({
  ...box,
  right: box.left + box.width,
  bottom: box.top + box.height,
})

function mockRect(el: Element, box: Box) {
  ;(el as HTMLElement).getBoundingClientRect = () =>
    ({ ...edges(box), x: box.left, y: box.top, toJSON: () => box }) as DOMRect
}

function surface(name: DropSurface) {
  const el = document.createElement('div')
  el.setAttribute(DROP_SURFACE_ATTRIBUTE, name)
  document.body.appendChild(el)
  return el
}

/** A node as far as targeting cares: an id and the ids above it. */
const nodeAt = (...path: string[]) =>
  ({ $id: path[path.length - 1], breadcrumbPath: path }) as any

function target(id: string, on: Element, node: any, box: Box) {
  const element = document.createElement('div')
  on.appendChild(element)
  mockRect(element, box)
  return {
    container: {
      id,
      key: id,
      disabled: false,
      node: { current: element },
      rect: { current: edges(box) },
      data: { current: { node } },
    },
    rect: edges(box),
  }
}

function detect(
  targets: ReturnType<typeof target>[],
  pointer: { x: number; y: number },
  active: any = null,
) {
  return besignerCollisionDetection({
    active,
    collisionRect: { ...edges({ left: 0, top: 0, width: 0, height: 0 }) },
    droppableRects: new Map(targets.map((t) => [t.container.id, t.rect])),
    droppableContainers: targets.map((t) => t.container) as any,
    pointerCoordinates: pointer,
  }).map((collision) => collision.id)
}

const originalElementFromPoint = document.elementFromPoint

afterEach(() => {
  document.body.innerHTML = ''
  document.elementFromPoint = originalElementFromPoint
  refs.clear()
})

describe('besignerCollisionDetection', () => {
  it('only resolves against targets on the surface under the pointer', () => {
    // A canvas element scrolled under the hierarchy panel still "contains"
    // the pointer as far as rectangles go.
    const tree = surface(DropSurface.TREE)
    const canvas = surface(DropSurface.CANVAS)
    const box = { left: 0, top: 0, width: 300, height: 30 }
    const row = target('row', tree, nodeAt('root', 'a'), box)
    const hidden = target('hidden', canvas, nodeAt('root', 'b'), box)
    document.elementFromPoint = () => row.container.node.current
    expect(detect([row, hidden], { x: 10, y: 10 })).toEqual(['row'])
  })

  it('resolves against nothing over something that is not a surface', () => {
    const canvas = surface(DropSurface.CANVAS)
    const under = target('under', canvas, nodeAt('root', 'a'), {
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    })
    const appBar = document.createElement('header')
    document.body.appendChild(appBar)
    document.elementFromPoint = () => appBar
    expect(detect([under], { x: 10, y: 10 })).toEqual([])
  })

  it('never offers the dragged node, or anything inside it, as a target', () => {
    const tree = surface(DropSurface.TREE)
    document.elementFromPoint = () => tree
    const at = { left: 0, top: 0, width: 300, height: 30 }
    const self = target('self', tree, nodeAt('root', 'a'), at)
    const child = target('child', tree, nodeAt('root', 'a', 'a1'), at)
    const other = target('other', tree, nodeAt('root', 'b'), at)
    const active = { id: 'drag', data: { current: { type: DragType.TREE, node: nodeAt('root', 'a') } } }
    expect(detect([self, child, other], { x: 10, y: 10 }, active)).toEqual(['other'])
  })

  it("resolves against nothing over the dragged node's own place on the canvas", () => {
    const canvas = surface(DropSurface.CANVAS)
    document.elementFromPoint = () => canvas
    const parent = target('parent', canvas, nodeAt('root', 'p'), {
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    })
    const element = document.createElement('div')
    mockRect(element, { left: 50, top: 50, width: 100, height: 100 })
    refs.set('a', { current: element })
    const active = {
      id: 'drag',
      data: { current: { type: DragType.CANVAS, node: nodeAt('root', 'p', 'a') } },
    }
    expect(detect([parent], { x: 60, y: 60 }, active)).toEqual([])
    expect(detect([parent], { x: 300, y: 300 }, active)).toEqual(['parent'])
  })

  it('prefers the deeper of two targets that share a rectangle', () => {
    const canvas = surface(DropSurface.CANVAS)
    document.elementFromPoint = () => canvas
    const box = { left: 0, top: 0, width: 200, height: 200 }
    // Registered outer-first, which used to decide the tie.
    const outer = target('outer', canvas, nodeAt('root', 'box'), box)
    const inner = target('inner', canvas, nodeAt('root', 'box', 'stack'), box)
    expect(detect([outer, inner], { x: 50, y: 50 })).toEqual(['inner', 'outer'])
  })
})

describe('dropTargetRect', () => {
  it('measures a target that hands over its element, live', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    mockRect(element, { left: 10, top: 500, width: 100, height: 50 })
    const stale = edges({ left: 10, top: 900, width: 100, height: 50 })
    const over = { rect: stale, data: { current: { getElement: () => element } } }
    expect(dropTargetRect(over as any)?.top).toBe(500)
  })

  it("falls back to dnd-kit's rect for a target without one", () => {
    const rect = edges({ left: 10, top: 900, width: 100, height: 50 })
    expect(dropTargetRect({ rect, data: { current: {} } } as any)?.top).toBe(900)
  })
})

describe('dropAxisOf', () => {
  it('runs hierarchy rows in a column and breadcrumbs in a row', () => {
    expect(dropAxisOf({ surface: DropSurface.TREE })).toBe('vertical')
    expect(dropAxisOf({ surface: DropSurface.BREADCRUMBS })).toBe('horizontal')
  })
})
