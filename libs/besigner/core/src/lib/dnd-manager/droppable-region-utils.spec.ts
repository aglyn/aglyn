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

import { DropRegion } from './dnd-manager'
import {
  determineDropRegion,
  determineSiblingRegion,
  DROP_EDGE_BAND_MAX,
  resolveDropRegion,
} from './droppable-region-utils'

// Wide element (width >= height): siblings flow left/right.
const wide = { width: 200, height: 40, top: 0, right: 200, bottom: 40, left: 0 }
// Tall element (height > width): siblings flow top/bottom.
const tall = { width: 40, height: 200, top: 0, right: 40, bottom: 200, left: 0 }

describe('determineDropRegion', () => {
  it('returns CHILDREN for the center of a target that accepts children', () => {
    expect(determineDropRegion(wide, 100, 20, true)).toBe(DropRegion.CHILDREN)
  })

  it('never returns CHILDREN for a leaf — center resolves to a sibling side', () => {
    // Whole center splits on the dominant axis instead of nesting.
    expect(determineDropRegion(wide, 60, 20, false)).toBe(DropRegion.LEFT)
    expect(determineDropRegion(wide, 140, 20, false)).toBe(DropRegion.RIGHT)
    expect(determineDropRegion(tall, 20, 60, false)).toBe(DropRegion.TOP)
    expect(determineDropRegion(tall, 20, 140, false)).toBe(DropRegion.BOTTOM)
  })

  it('still reports the thin edge bands for a leaf', () => {
    // Top edge band -> before; bottom edge band -> after. Both are already
    // sibling placements, so leaf-awareness leaves them untouched.
    expect(determineDropRegion(wide, 100, 1, false)).toBe(DropRegion.TOP)
    expect(determineDropRegion(wide, 100, 39, false)).toBe(DropRegion.BOTTOM)
  })
})

describe('determineSiblingRegion', () => {
  it('splits a wide element left/right on the horizontal midpoint', () => {
    expect(determineSiblingRegion(wide, 99, 20)).toBe(DropRegion.LEFT)
    expect(determineSiblingRegion(wide, 101, 20)).toBe(DropRegion.RIGHT)
  })

  it('splits a tall element top/bottom on the vertical midpoint', () => {
    expect(determineSiblingRegion(tall, 20, 99)).toBe(DropRegion.TOP)
    expect(determineSiblingRegion(tall, 20, 101)).toBe(DropRegion.BOTTOM)
  })
})

describe('resolveDropRegion', () => {
  // A full-width row of a column: wide, and its siblings sit above and below.
  const row = { width: 400, height: 100, top: 0, right: 400, bottom: 100, left: 0 }
  // A card in a row: its siblings sit beside it.
  const card = { width: 100, height: 400, top: 0, right: 100, bottom: 400, left: 0 }

  it('only uses the edges along the axis the siblings run on', () => {
    // The left edge of a wide row in a column is not "before" — before is above.
    expect(resolveDropRegion({ rect: row, x: 2, y: 50 })).toBe(DropRegion.CHILDREN)
    expect(resolveDropRegion({ rect: row, x: 200, y: 2 })).toBe(DropRegion.TOP)
    expect(resolveDropRegion({ rect: row, x: 200, y: 98 })).toBe(DropRegion.BOTTOM)
    expect(
      resolveDropRegion({ rect: card, x: 2, y: 200, axis: 'horizontal' }),
    ).toBe(DropRegion.LEFT)
    expect(
      resolveDropRegion({ rect: card, x: 98, y: 200, axis: 'horizontal' }),
    ).toBe(DropRegion.RIGHT)
    expect(
      resolveDropRegion({ rect: card, x: 50, y: 2, axis: 'horizontal' }),
    ).toBe(DropRegion.CHILDREN)
  })

  it('caps the edge band, so most of a large container is inside', () => {
    const y = DROP_EDGE_BAND_MAX + 1
    expect(resolveDropRegion({ rect: row, x: 200, y })).toBe(DropRegion.CHILDREN)
    // A short hierarchy row gets a quarter of its height at each edge.
    const treeRow = { width: 300, height: 28, top: 0, right: 300, bottom: 28, left: 0 }
    expect(resolveDropRegion({ rect: treeRow, x: 100, y: 6 })).toBe(DropRegion.TOP)
    expect(resolveDropRegion({ rect: treeRow, x: 100, y: 14 })).toBe(DropRegion.CHILDREN)
    expect(resolveDropRegion({ rect: treeRow, x: 100, y: 22 })).toBe(DropRegion.BOTTOM)
  })

  it('splits a leaf into halves along the axis and never offers inside', () => {
    const leaf = { rect: row, acceptsChildren: false }
    expect(resolveDropRegion({ ...leaf, x: 390, y: 40 })).toBe(DropRegion.TOP)
    expect(resolveDropRegion({ ...leaf, x: 10, y: 60 })).toBe(DropRegion.BOTTOM)
    expect(
      resolveDropRegion({ ...leaf, axis: 'horizontal', x: 150, y: 90 }),
    ).toBe(DropRegion.LEFT)
  })

  it('keeps the whole root inside — it has no siblings to land beside', () => {
    expect(
      resolveDropRegion({ rect: row, x: 200, y: 1, acceptsSiblings: false }),
    ).toBe(DropRegion.CHILDREN)
  })

  it('gives the after band to inside when after is not offered', () => {
    expect(
      resolveDropRegion({ rect: row, x: 200, y: 98, allowAfter: false }),
    ).toBe(DropRegion.CHILDREN)
    expect(
      resolveDropRegion({ rect: row, x: 200, y: 2, allowAfter: false }),
    ).toBe(DropRegion.TOP)
  })

  it('holds the region it was in until the pointer is clearly past the line', () => {
    const edge = DROP_EDGE_BAND_MAX
    // Just inside the boundary, from either side, stays where it was.
    expect(
      resolveDropRegion({ rect: row, x: 200, y: edge + 2, previous: DropRegion.TOP }),
    ).toBe(DropRegion.TOP)
    // Coming from inside, the edge band is its full size: thin edges stay
    // easy to reach (a hierarchy row's is 7px).
    expect(
      resolveDropRegion({ rect: row, x: 200, y: edge - 1, previous: DropRegion.CHILDREN }),
    ).toBe(DropRegion.TOP)
    // Past the hysteresis, it lets go.
    expect(
      resolveDropRegion({ rect: row, x: 200, y: edge + 6, previous: DropRegion.TOP }),
    ).toBe(DropRegion.CHILDREN)
    // A leaf's midpoint holds the same way.
    const leaf = { rect: row, acceptsChildren: false }
    expect(
      resolveDropRegion({ ...leaf, x: 0, y: 52, previous: DropRegion.TOP }),
    ).toBe(DropRegion.TOP)
    expect(resolveDropRegion({ ...leaf, x: 0, y: 52 })).toBe(DropRegion.BOTTOM)
  })
})
