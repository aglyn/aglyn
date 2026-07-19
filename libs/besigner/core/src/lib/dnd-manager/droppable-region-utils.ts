/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { DropRegion } from './dnd-manager'

// Structural rect type: dnd-kit passes a ClientRect that lacks DOMRect's
// x/y/toJSON, and x/y are defaulted below anyway.
export type DroppableClientRect = Pick<
  DOMRect,
  'width' | 'height' | 'top' | 'right' | 'bottom' | 'left'
> &
  Partial<Pick<DOMRect, 'x' | 'y'>>

export function buildDroppableRects(rect: DroppableClientRect) {
  const {
    width = 0,
    height = 0,
    top = 0,
    right = 0,
    bottom = 0,
    left = 0,
    x = 0,
    y = 0,
  } = rect || {}
  const isHorz = (width || 0) >= (height || 0)

  const vertWRaw = width / 6
  const vertWidth = vertWRaw > 12 ? 12 : vertWRaw
  const vertHeight = height

  const horzHRaw = height / 4
  const horzWidth = width
  const horzHeight = horzHRaw > 12 ? 12 : horzHRaw

  const _top = {
    width: horzWidth,
    height: horzHeight,
    top: top,
    left: left,
  }
  const _bottom = {
    width: horzWidth,
    height: horzHeight,
    top: top + vertHeight - horzHeight,
    left: left,
  }
  const _left = {
    width: vertWidth,
    height: vertHeight,
    top: top,
    left: left,
  }
  const _right = {
    width: vertWidth,
    height: vertHeight,
    top: top,
    left: left + horzWidth - vertWidth,
  }
  const _children = {
    width: _top.width - vertWidth * 2,
    height: height - (_top.height + _bottom.height),
    top: top + _top.height,
    left: left + _left.width,
  }
  const _full = {
    x,
    y,
    left: _left.left,
    width: _left.width + _children.width + _right.width,
    top: _top.top,
    height: _top.height + _children.height + _bottom.height,
  }

  return {
    children: _children,
    top: _top,
    right: _right,
    bottom: _bottom,
    left: _left,
    full: _full,
  }
}

export function withinRegion(rect: { left: number; top: number; width: number; height: number }, x: number, y: number) {
  const { left, top } = rect
  const { width, height } = rect
  const xis = x >= left && x <= left + width
  const yis = y >= top && y <= top + height
  return xis && yis
}

/**
 * Before/after sibling region for a point over a leaf element, split on the
 * element's dominant axis: wide elements divide left/right, tall ones divide
 * top/bottom. Used when the target can't hold node children so its center
 * never reads as a nest.
 */
export function determineSiblingRegion(rect: DroppableClientRect, x: number, y: number) {
  const { width = 0, height = 0, top = 0, left = 0 } = rect || {}
  if (width >= height) {
    return x < left + width / 2 ? DropRegion.LEFT : DropRegion.RIGHT
  }
  return y < top + height / 2 ? DropRegion.TOP : DropRegion.BOTTOM
}

export function determineDropRegion(
  clientRect: DroppableClientRect,
  x: number,
  y: number,
  acceptsChildren = true,
  regions?: ReturnType<typeof buildDroppableRects>,
) {
  const _regions = regions || buildDroppableRects(clientRect)
  switch (true) {
    case withinRegion(_regions.top, x, y):
      return DropRegion.TOP
    case withinRegion(_regions.right, x, y):
      return DropRegion.RIGHT
    case withinRegion(_regions.bottom, x, y):
      return DropRegion.BOTTOM
    case withinRegion(_regions.left, x, y):
      return DropRegion.LEFT
    case !acceptsChildren:
      // Leaf targets (self-closing / text-editable) have no children slot, so
      // the center resolves to a sibling insert rather than a nest — keeping
      // the drop indicator and the committed placement in agreement
      // (AGL-575 parallel for drag-and-drop).
      return determineSiblingRegion(clientRect, x, y)
    case withinRegion(_regions.children, x, y):
    default:
      return DropRegion.CHILDREN
  }
}
