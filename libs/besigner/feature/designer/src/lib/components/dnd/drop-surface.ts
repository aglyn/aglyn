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

import type { DropAxis, DroppableClientRect } from '@aglyn/besigner'

/**
 * The places a drop target can live. Each is one element in the designer,
 * marked with {@link DROP_SURFACE_ATTRIBUTE}, and a drop only ever resolves
 * against targets on the surface the pointer is actually over.
 *
 * That last part is the reason this exists. dnd-kit hit-tests rectangles, and
 * a rectangle knows nothing about what is painted on top of it: a canvas
 * element scrolled under the hierarchy panel, or under the app bar, still
 * "contains" the pointer. So a row being dragged through the hierarchy could
 * resolve against a canvas element nobody could see, and the marker jumped to
 * wherever that element's edge was.
 */
export enum DropSurface {
  CANVAS = 'canvas',
  TREE = 'tree',
  BREADCRUMBS = 'breadcrumbs',
}

export const DROP_SURFACE_ATTRIBUTE = 'data-aglyn-drop-surface'

const SURFACE_SELECTOR = `[${DROP_SURFACE_ATTRIBUTE}]`

/** Props that mark an element as a drop surface. */
export function dropSurfaceProps(surface: DropSurface) {
  return { [DROP_SURFACE_ATTRIBUTE]: surface }
}

/**
 * The surface an element sits on, climbing out of shadow roots: every canvas
 * element lives inside the canvas's closed shadow root, and `closest` stops at
 * a shadow boundary.
 */
export function closestDropSurface(
  node: Node | null | undefined,
): Element | null {
  let current: Node | null = node ?? null
  while (current) {
    if (current instanceof Element) {
      const surface = current.closest(SURFACE_SELECTOR)
      if (surface) return surface
    }
    const root = current.getRootNode?.()
    current =
      typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot
        ? root.host
        : null
  }
  return null
}

/**
 * The surface painted at a viewport point: `null` when the pointer is over
 * something that is not one (the app bar, the attributes panel), `undefined`
 * when this document cannot hit-test at all, in which case nothing is ruled
 * out on these grounds.
 */
export function dropSurfaceAtPoint(
  x: number,
  y: number,
  doc: Document | undefined = typeof document === 'undefined'
    ? undefined
    : document,
): Element | null | undefined {
  if (typeof doc?.elementFromPoint !== 'function') return undefined
  return closestDropSurface(doc.elementFromPoint(x, y))
}

const CLIPPING_OVERFLOW = /hidden|clip|auto|scroll/

/**
 * The part of an element that is actually on screen: its rectangle cut down
 * by every ancestor that clips its overflow. The marker is drawn in a portal
 * above everything, so without this a line along a canvas element that runs
 * under a side panel is drawn across the panel.
 */
export function visibleRectOf(element: Element | null | undefined) {
  if (!element) return null
  const own = element.getBoundingClientRect()
  let left = own.left
  let top = own.top
  let right = own.right
  let bottom = own.bottom
  let current: Node | null = element.parentNode
  while (current) {
    if (current instanceof Element) {
      const style = getComputedStyle(current)
      if (
        [style.overflow, style.overflowX, style.overflowY].some((value) =>
          CLIPPING_OVERFLOW.test(value),
        )
      ) {
        const clip = current.getBoundingClientRect()
        left = Math.max(left, clip.left)
        top = Math.max(top, clip.top)
        right = Math.min(right, clip.right)
        bottom = Math.min(bottom, clip.bottom)
      }
      current = current.parentNode
    } else if (
      typeof ShadowRoot !== 'undefined' &&
      current instanceof ShadowRoot
    ) {
      current = current.host
    } else {
      current = null
    }
  }
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/**
 * The visible rectangle of the named surface that holds `rect`. There is one
 * of each per designer today, but a second hierarchy would be picked by where
 * the target is rather than by document order.
 */
export function visibleSurfaceRect(
  surface: DropSurface | undefined,
  rect: DroppableClientRect,
) {
  if (!surface || typeof document === 'undefined') return null
  const candidates = Array.from(
    document.querySelectorAll(`[${DROP_SURFACE_ATTRIBUTE}="${surface}"]`),
  )
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const holding =
    candidates.find((element) => {
      const box = element.getBoundingClientRect()
      return (
        cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom
      )
    }) ?? candidates[0]
  return visibleRectOf(holding)
}

/** Box of an element worth comparing against, or null when it takes no space. */
function boxOf(element: Element | null) {
  if (!element) return null
  const box = element.getBoundingClientRect()
  return box.width > 0 || box.height > 0 ? box : null
}

/**
 * Which way the siblings of a canvas element run, read off the page rather
 * than the schema: a Stack can be a row or a column, a Grid wraps, and a
 * component can lay its children out any way it likes.
 *
 * The neighbours answer first. A sibling BESIDE this element (sharing some of
 * its height, none of its width) means a row; one above or below means a
 * column. Wrapped rows put the previous item on the line above, which is why
 * beside wins whenever either neighbour says so. With no neighbour to ask —
 * an only child — the parent's declared layout decides.
 */
export function flowAxisOf(element: Element | null | undefined): DropAxis {
  if (!element) return 'vertical'
  const own = boxOf(element)
  let stacked = false
  if (own) {
    for (const sibling of [
      element.previousElementSibling,
      element.nextElementSibling,
    ]) {
      const other = boxOf(sibling)
      if (!other) continue
      const sharedHeight =
        Math.min(own.bottom, other.bottom) - Math.max(own.top, other.top)
      const sharedWidth =
        Math.min(own.right, other.right) - Math.max(own.left, other.left)
      if (sharedHeight > 0 && sharedWidth <= 0) return 'horizontal'
      if (sharedWidth > 0 && sharedHeight <= 0) stacked = true
    }
  }
  if (stacked) return 'vertical'

  const parent = element.parentElement
  if (parent) {
    const layout = getComputedStyle(parent)
    if (layout.display.includes('flex')) {
      return layout.flexDirection.startsWith('row') ? 'horizontal' : 'vertical'
    }
    if (layout.display.includes('grid')) {
      const columns = layout.gridTemplateColumns
        .split(' ')
        .filter((track) => track && track !== 'none')
      return columns.length > 1 ? 'horizontal' : 'vertical'
    }
  }
  return getComputedStyle(element).display.startsWith('inline')
    ? 'horizontal'
    : 'vertical'
}
