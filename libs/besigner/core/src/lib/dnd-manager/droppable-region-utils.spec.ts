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
