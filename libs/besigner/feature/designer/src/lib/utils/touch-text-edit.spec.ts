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
  isNearSelectionHandle,
  isTouchPointer,
  placeDockedToolbar,
  readVisibleArea,
  TOUCH_TAP_MAX_MS,
  TOUCH_TAP_SLOP_PX,
  TouchPressTracker,
} from './touch-text-edit'

const pointer = (
  x: number,
  y: number,
  at: number,
  pointerId = 1,
): PointerEvent =>
  ({ pointerId, clientX: x, clientY: y, timeStamp: at }) as PointerEvent

describe('isTouchPointer (AGL-4069)', () => {
  it('reads a finger or a pen as touch, and a mouse as not', () => {
    expect(isTouchPointer({ pointerType: 'touch' } as unknown as Event)).toBe(true)
    expect(isTouchPointer({ pointerType: 'pen' } as unknown as Event)).toBe(true)
    expect(isTouchPointer({ pointerType: 'mouse' } as unknown as Event)).toBe(false)
    expect(isTouchPointer({} as Event)).toBe(false)
  })
})

describe('TouchPressTracker (AGL-4069)', () => {
  it('calls a still, quick press a tap', () => {
    const press = new TouchPressTracker()
    press.down(pointer(100, 100, 0), false)
    expect(press.up(pointer(102, 101, 120))).toBe('tap')
  })

  it('does not call a drag a tap, even one that comes back to where it began', () => {
    const press = new TouchPressTracker()
    press.down(pointer(100, 100, 0), false)
    press.move(pointer(100 + TOUCH_TAP_SLOP_PX * 4, 100, 60))
    expect(press.up(pointer(100, 100, 120))).toBe('not-a-tap')
  })

  it('does not call a long press a tap', () => {
    const press = new TouchPressTracker()
    press.down(pointer(100, 100, 0), false)
    expect(press.up(pointer(100, 100, TOUCH_TAP_MAX_MS + 1))).toBe('not-a-tap')
  })

  it('follows nothing once the browser takes the touch over', () => {
    const press = new TouchPressTracker()
    press.down(pointer(100, 100, 0), false)
    press.cancel(pointer(100, 100, 30))
    expect(press.up(pointer(100, 100, 60))).toBeUndefined()
  })

  it('never calls a press on a selection handle a tap', () => {
    const press = new TouchPressTracker()
    press.down(pointer(100, 100, 0), true)
    expect(press.following).toBe(false)
    expect(press.up(pointer(100, 100, 60))).toBeUndefined()
  })

  it('ignores a second finger', () => {
    const press = new TouchPressTracker()
    press.down(pointer(100, 100, 0, 1), false)
    press.move(pointer(300, 300, 20, 2))
    expect(press.up(pointer(300, 300, 40, 2))).toBeUndefined()
    expect(press.up(pointer(100, 100, 60, 1))).toBe('tap')
  })
})

describe('isNearSelectionHandle (AGL-4069)', () => {
  const ends = [
    { left: 120, top: 200, width: 0, height: 30 },
    { left: 280, top: 200, width: 0, height: 30 },
  ]

  it('reaches a handle that hangs below the end of the selection', () => {
    expect(isNearSelectionHandle({ x: 284, y: 248 }, ends)).toBe(true)
  })

  it('does not reach from across the screen', () => {
    expect(isNearSelectionHandle({ x: 200, y: 600 }, ends)).toBe(false)
  })

  it('has nothing to reach when nothing is selected', () => {
    expect(isNearSelectionHandle({ x: 120, y: 200 }, [])).toBe(false)
  })
})

describe('placeDockedToolbar (AGL-4069)', () => {
  // A phone with the keyboard up: 390 wide, 400 tall above the keyboard,
  // panned 120 down the page.
  const area = { left: 0, top: 120, width: 390, height: 400 }

  it('docks just above the keyboard', () => {
    const placed = placeDockedToolbar(
      { left: 20, top: 260, width: 300, height: 40 },
      area,
      48,
      8,
    )
    expect(placed.edge).toBe('bottom')
    expect(placed.top).toBe(120 + 400 - 48 - 8)
    // Wholly inside the visible area, so never behind the keyboard.
    expect(placed.top + 48).toBeLessThanOrEqual(area.top + area.height)
  })

  it('moves to the top when the text is down by the keyboard', () => {
    const placed = placeDockedToolbar(
      { left: 20, top: 440, width: 300, height: 40 },
      area,
      48,
      8,
    )
    expect(placed.edge).toBe('top')
    expect(placed.top).toBe(128)
  })

  it('never covers the text it formats', () => {
    for (const top of [130, 250, 330, 470]) {
      const text = { left: 20, top, width: 300, height: 40 }
      const placed = placeDockedToolbar(text, area, 48, 8)
      const overlaps =
        placed.top < text.top + text.height && placed.top + 48 > text.top
      expect(overlaps).toBe(false)
    }
  })

  it('stays inside the width of the visible area', () => {
    const placed = placeDockedToolbar(
      { left: 0, top: 160, width: 10, height: 10 },
      area,
      48,
      8,
    )
    expect(placed.left).toBe(8)
    expect(placed.maxWidth).toBe(390 - 16)
  })
})

describe('readVisibleArea (AGL-4069)', () => {
  it('is the visual viewport, in fixed-position coordinates', () => {
    const win = {
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: { offsetLeft: 0, offsetTop: 210, width: 390, height: 420 },
    } as unknown as Window
    expect(readVisibleArea(win)).toEqual({
      left: 0,
      top: 210,
      width: 390,
      height: 420,
    })
  })

  it('falls back to the window without one', () => {
    const win = { innerWidth: 1280, innerHeight: 800 } as unknown as Window
    expect(readVisibleArea(win)).toEqual({
      left: 0,
      top: 0,
      width: 1280,
      height: 800,
    })
  })
})
