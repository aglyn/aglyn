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

import type * as Aglyn from '@aglyn/aglyn'
import { canvas } from '@aglyn/aglyn'
import {
  type DropAxis,
  type DroppableClientRect,
  DragType,
  DropRegion,
  refs,
  resolveDropRegion,
} from '@aglyn/besigner'
import {
  type Active,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
  type Over,
  pointerWithin,
} from '@dnd-kit/core'
import type { DropIndicatorInset } from './drop-indicator-geometry'
import {
  closestDropSurface,
  DROP_SURFACE_ATTRIBUTE,
  DropSurface,
  dropSurfaceAtPoint,
  flowAxisOf,
} from './drop-surface'

/** What a besigner droppable carries in its dnd-kit `data`. */
export interface DropTargetData {
  node?: Aglyn.NodeSchema<any>
  type?: DragType
  accept?: DragType[]
  surface?: DropSurface
  /** The element as it is drawn now; read live rather than from a cache. */
  getElement?: () => Element | null
  /** How far in from the target's left edge a hierarchy row's label sits. */
  inset?: DropIndicatorInset
  /** A hierarchy row whose children are showing beneath it. */
  expanded?: boolean
}

type Point = { x: number; y: number }

function targetData(target: { data: { current?: unknown } } | null | undefined) {
  return target?.data.current as DropTargetData | undefined
}

/** The node being dragged, or null for a palette preset (it is not on the page yet). */
function draggedNode(active: Active | null | undefined) {
  const data = active?.data.current as DropTargetData | undefined
  if (!data?.node || data.type === DragType.PRESET) return null
  return data.node
}

function depthOf(collision: Collision) {
  const container = collision.data?.droppableContainer as
    | DroppableContainer
    | undefined
  return targetData(container)?.node?.breadcrumbPath?.length ?? 0
}

/**
 * Where an element would be without the `translate` the drag puts on it. A
 * canvas element follows the pointer by `translate`, which
 * `getBoundingClientRect` includes, so its rectangle while dragged is
 * wherever the pointer was a frame ago.
 */
function untranslatedRect(element: Element) {
  const box = element.getBoundingClientRect()
  const [dx = 0, dy = 0] = (getComputedStyle(element).translate || '')
    .split(' ')
    .map((part) => parseFloat(part) || 0)
  return {
    left: box.left - dx,
    top: box.top - dy,
    right: box.right - dx,
    bottom: box.bottom - dy,
  }
}

function contains(
  rect: { left: number; top: number; right: number; bottom: number },
  { x, y }: Point,
) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * dnd-kit's `pointerWithin`, minus the three ways it picked a target the
 * author could not see.
 *
 * 1. Only targets on the surface under the pointer count (see
 *    `DropSurface`). A canvas element scrolled under the hierarchy no longer
 *    wins a drag through the hierarchy.
 *
 * 2. Nothing inside the dragged node counts. Those elements move with the
 *    drag, and dnd-kit re-measures them whenever any droppable registers or
 *    toggles — which a drag does at once, by disabling the dragged row's
 *    target. They were caught mid-flight just beside the pointer, and stayed
 *    there: invisible targets that the marker jumped onto, every one of which
 *    the drop then refused as "inside itself".
 *
 * 3. Over the dragged node's own place on the canvas, nothing counts. That
 *    space is where the node already is; dropping there leaves it alone,
 *    rather than resolving to whatever holds it and moving it to the end.
 *
 * Two targets with the same rectangle (a Stack that exactly fills its Box)
 * tie on distance, and dnd-kit broke the tie by registration order, which
 * changes whenever either one re-mounts. The deeper node wins now, always.
 */
export const besignerCollisionDetection: CollisionDetection = (args) => {
  const { active, pointerCoordinates } = args
  if (!pointerCoordinates) return []
  const surface = dropSurfaceAtPoint(pointerCoordinates.x, pointerCoordinates.y)
  const dragged = draggedNode(active)

  if (
    dragged &&
    surface?.getAttribute(DROP_SURFACE_ATTRIBUTE) === DropSurface.CANVAS
  ) {
    const element = refs.get(dragged.$id)?.current
    if (element && contains(untranslatedRect(element), pointerCoordinates)) {
      return []
    }
  }

  return pointerWithin(args)
    .filter((collision) => {
      const container = collision.data?.droppableContainer as
        | DroppableContainer
        | undefined
      if (
        surface !== undefined &&
        closestDropSurface(container?.node.current) !== surface
      ) {
        return false
      }
      const node = targetData(container)?.node
      return !(dragged && node?.breadcrumbPath?.includes(dragged.$id))
    })
    .sort(
      (a, b) =>
        (a.data?.value ?? 0) - (b.data?.value ?? 0) || depthOf(b) - depthOf(a),
    )
}

/**
 * The target's rectangle as it is drawn right now.
 *
 * dnd-kit's cached `rect` follows scrolling only for scroll containers it can
 * find by walking up from the element, and that walk stops at a shadow root —
 * so for every canvas element, which lives in the canvas's closed shadow
 * root, it never followed the canvas scrolling at all. A canvas target hands
 * over its element instead, and is measured live.
 */
export function dropTargetRect(
  over: Pick<Over, 'rect' | 'data'> | null | undefined,
): DroppableClientRect | null {
  if (!over) return null
  const element = targetData(over)?.getElement?.()
  const box: ClientRect | DOMRect | null = element?.isConnected
    ? element.getBoundingClientRect()
    : over.rect
  if (!box) return null
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    right: box.right,
    bottom: box.bottom,
  }
}

/**
 * Where a drop inside a canvas container actually lands: after its last
 * child that is drawn, because an inside drop appends.
 *
 * The marker used to draw inside as a line across the container's middle,
 * which in any container with content runs between two of its children —
 * in the hero of a page, straight between the heading and the text under
 * it — and reads as "here", when the element was about to go to the end.
 * Null for a container with nothing drawn in it; its middle is honest.
 */
export function insideLandingTarget(
  node: Aglyn.NodeSchema<any> | undefined,
): { rect: DroppableClientRect; region: DropRegion } | null {
  const ids = node?.nodes ?? []
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const element = refs.get(ids[i])?.current
    if (!element?.isConnected) continue
    const box = element.getBoundingClientRect()
    if (!box.width && !box.height) continue
    return {
      rect: {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      },
      region:
        flowAxisOf(element) === 'horizontal'
          ? DropRegion.RIGHT
          : DropRegion.BOTTOM,
    }
  }
  return null
}

/** Which way the target's siblings run, so which edges mean before and after. */
export function dropAxisOf(data: DropTargetData | undefined): DropAxis {
  if (data?.surface === DropSurface.TREE) return 'vertical'
  if (data?.surface === DropSurface.BREADCRUMBS) return 'horizontal'
  return flowAxisOf(data?.getElement?.())
}

/**
 * The region of `over` that `point` names, or null without a target or a
 * point (a keyboard drag that has never seen the pointer).
 */
export function resolveTargetRegion(
  over: Pick<Over, 'rect' | 'data'> | null | undefined,
  point: Point | null | undefined,
  previous: DropRegion | null = null,
): DropRegion | null {
  const rect = dropTargetRect(over)
  if (!rect || !point) return null
  const data = targetData(over)
  const node = data?.node
  return resolveDropRegion({
    rect,
    x: point.x,
    y: point.y,
    axis: dropAxisOf(data),
    // Leaves (self-closing / text-editable) never offer an inside — the
    // center reads as a sibling insert, matching where the drop actually
    // lands (see dnd-manager onDragEnd).
    acceptsChildren: node ? canvas.nodeAcceptsChildren(node) : true,
    acceptsSiblings: !(node && canvas.isRootNode(node)),
    allowAfter: !(data?.surface === DropSurface.TREE && data?.expanded),
    previous,
  })
}
