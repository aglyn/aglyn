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

import { type DroppableClientRect, DropRegion } from '@aglyn/besigner'

/** Thickness of the marker's line, in px. */
export const DROP_LINE_WIDTH = 6

/** Diameter of the round handle at each end of the line, in px. */
export const DROP_HANDLE_WIDTH = DROP_LINE_WIDTH + DROP_LINE_WIDTH * 1.27

const HALF = DROP_HANDLE_WIDTH / 2

/**
 * Where a hierarchy row's label starts, in px from the row's left edge, for a
 * drop beside the row (`sibling`) and a drop into it (`child`). The line
 * starts there, so its indent says which level the element lands on.
 */
export interface DropIndicatorInset {
  sibling?: number
  child?: number
}

/** The marker's box in viewport px, and whether it is drawn upright. */
export interface DropIndicatorBox {
  left: number
  top: number
  width: number
  height: number
  vertical: boolean
}

type Edges = { left: number; top: number; right: number; bottom: number }

export interface DropIndicatorBoxOptions {
  region: DropRegion
  rect: DroppableClientRect
  inset?: DropIndicatorInset
  /** The visible part of the target's surface; the line never leaves it. */
  clip?: Edges | null
}

/**
 * The box the marker occupies for a drop into `region` of `rect`.
 *
 * Every dimension is stated for every region. The previous marker animated
 * only the dimension a region named and left the other at whatever the last
 * region had set, so a line along a top edge drawn just after one down a left
 * edge kept that edge's full height, and the flex layout centred it — the
 * "before" marker turned up across the middle of the element.
 *
 * Returns null when the line would fall entirely outside `clip`.
 */
export function dropIndicatorBox(
  options: DropIndicatorBoxOptions,
): DropIndicatorBox | null {
  const { region, rect, inset, clip } = options
  const right = rect.left + rect.width
  const bottom = rect.top + rect.height

  if (region === DropRegion.LEFT || region === DropRegion.RIGHT) {
    const x = region === DropRegion.LEFT ? rect.left : right
    let y0 = rect.top
    let y1 = bottom
    if (clip) {
      if (x < clip.left || x > clip.right) return null
      y0 = Math.max(y0, clip.top)
      y1 = Math.min(y1, clip.bottom)
      if (y1 < y0) return null
    }
    return {
      vertical: true,
      left: x - HALF,
      top: y0 - HALF,
      width: DROP_HANDLE_WIDTH,
      height: y1 - y0 + DROP_HANDLE_WIDTH,
    }
  }

  const inside = region === DropRegion.CHILDREN
  const y =
    region === DropRegion.TOP
      ? rect.top
      : region === DropRegion.BOTTOM
        ? bottom
        : rect.top + rect.height / 2
  // Inside is drawn a handle's width in from both ends, so it reads as
  // within the target rather than along its edge.
  let x0 =
    rect.left +
    (inside ? (inset?.child ?? 0) + DROP_HANDLE_WIDTH : (inset?.sibling ?? 0))
  let x1 = inside ? right - DROP_HANDLE_WIDTH : right
  // A deep row in a narrow panel can indent past its own end; keep a stub
  // at the end rather than nothing.
  x0 = Math.min(x0, x1 - DROP_HANDLE_WIDTH)
  if (clip) {
    if (y < clip.top || y > clip.bottom) return null
    x0 = Math.max(x0, clip.left)
    x1 = Math.min(x1, clip.right)
    if (x1 < x0) return null
  }
  return {
    vertical: false,
    left: x0 - HALF,
    top: y - HALF,
    width: x1 - x0 + DROP_HANDLE_WIDTH,
    height: DROP_HANDLE_WIDTH,
  }
}
