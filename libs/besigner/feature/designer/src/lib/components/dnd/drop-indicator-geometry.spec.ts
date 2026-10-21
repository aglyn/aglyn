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

import { DropRegion } from '@aglyn/besigner'
import {
  DROP_HANDLE_WIDTH,
  dropIndicatorBox,
} from './drop-indicator-geometry'

const H = DROP_HANDLE_WIDTH
const rect = { left: 100, top: 50, width: 200, height: 80, right: 300, bottom: 130 }

describe('dropIndicatorBox', () => {
  it('centres a before line on the top edge, handle to handle across the width', () => {
    expect(dropIndicatorBox({ region: DropRegion.TOP, rect })).toEqual({
      vertical: false,
      left: 100 - H / 2,
      top: 50 - H / 2,
      width: 200 + H,
      height: H,
    })
  })

  it('states every dimension for an upright line, whatever was drawn before it', () => {
    // The old marker left `height` at the previous region's value, so a top
    // line drawn after a left one came out as tall as the element and was
    // centred down its middle.
    const left = dropIndicatorBox({ region: DropRegion.LEFT, rect })
    const top = dropIndicatorBox({ region: DropRegion.TOP, rect })
    expect(left).toEqual({
      vertical: true,
      left: 100 - H / 2,
      top: 50 - H / 2,
      width: H,
      height: 80 + H,
    })
    expect(top?.height).toBe(H)
  })

  it('draws inside across the middle, a handle in from each end', () => {
    expect(dropIndicatorBox({ region: DropRegion.CHILDREN, rect })).toEqual({
      vertical: false,
      left: 100 + H / 2,
      top: 90 - H / 2,
      width: 200 - H,
      height: H,
    })
  })

  it('starts a hierarchy line where the label it lands beside starts', () => {
    const inset = { sibling: 46, child: 69 }
    const before = dropIndicatorBox({ region: DropRegion.BOTTOM, rect, inset })
    const inside = dropIndicatorBox({ region: DropRegion.CHILDREN, rect, inset })
    if (!before) throw new Error('expected a box')
    expect(before.left).toBe(100 + 46 - H / 2)
    expect(before.left + before.width).toBe(300 + H / 2)
    // Inside is one level deeper than beside.
    expect(inside?.left).toBe(100 + 69 + H - H / 2)
  })

  it('keeps a stub at the end of a row indented past its own width', () => {
    const narrow = { ...rect, width: 40, right: 140 }
    const box = dropIndicatorBox({
      region: DropRegion.TOP,
      rect: narrow,
      inset: { sibling: 120 },
    })
    if (!box) throw new Error('expected a box')
    expect(box.width).toBeCloseTo(2 * H)
    expect(box.left + box.width).toBeCloseTo(140 + H / 2)
  })

  it('cuts the line to the visible surface and drops one that falls outside it', () => {
    const clip = { left: 150, top: 0, right: 250, bottom: 100 }
    const top = dropIndicatorBox({ region: DropRegion.TOP, rect, clip })
    expect(top?.left).toBe(150 - H / 2)
    expect(top?.width).toBe(100 + H)
    // The bottom edge is below the visible part, so nothing is drawn.
    expect(dropIndicatorBox({ region: DropRegion.BOTTOM, rect, clip })).toBeNull()
    const left = dropIndicatorBox({ region: DropRegion.LEFT, rect, clip })
    expect(left).toBeNull()
    const right = dropIndicatorBox({ region: DropRegion.RIGHT, rect, clip: { ...clip, right: 400 } })
    expect(right?.height).toBe(100 - 50 + H)
  })
})
