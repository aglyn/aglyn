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
import { getElementFragmentRects } from './get-element-fragment-rects'

/**
 * AGL-2486 — an inline run is a SET of boxes, and one rectangle cannot
 * describe it.
 *
 * This lib's jest environment is `node`, and a `@jest-environment` pragma in
 * this repo is shadowed by the license header anyway, so the elements here
 * are plain objects that report the boxes they are given. That is the right
 * level for this file: what is under test is the shape of the answer — how
 * many boxes, in what order, and whether a block is left exactly as it was —
 * not whether a layout engine wraps text correctly. The engine's own numbers
 * were taken separately, in the running besigner, and the rects below are
 * those measurements.
 */
describe('getElementFragmentRects (AGL-2486)', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => undefined,
    }) as DOMRect

  /** An element that reports exactly the boxes it is given. */
  const elementWith = (rects: DOMRect[]): Element => {
    const union = rects.length
      ? rect(
          Math.min(...rects.map((r) => r.left)),
          Math.min(...rects.map((r) => r.top)),
          Math.max(...rects.map((r) => r.right)) -
            Math.min(...rects.map((r) => r.left)),
          Math.max(...rects.map((r) => r.bottom)) -
            Math.min(...rects.map((r) => r.top)),
        )
      : rect(0, 0, 0, 0)
    return {
      getBoundingClientRect: () => union,
      getClientRects: () =>
        Object.assign([...rects], {
          item: (index: number) => rects[index] ?? null,
        }) as unknown as DOMRectList,
    } as unknown as Element
  }

  /**
   * The regression that matters most. Blocks are the overwhelming majority of
   * canvas nodes and they are correct today; a fragment path that produced
   * *nearly* the same numbers for them would be a new bug on every element on
   * the canvas.
   */
  it('leaves a block exactly as the single-rect code had it', () => {
    // 110,291 656x56 — `leaf:a_title` as measured in the running besigner.
    const block = elementWith([rect(110, 291, 656, 56)])

    const geometry = getElementFragmentRects(block)

    expect(geometry.fragments).toHaveLength(1)
    expect(geometry.fragments[0]).toEqual(geometry.union)
    expect(geometry.first).toEqual(geometry.union)
    expect(geometry.union).toEqual(
      expect.objectContaining({ left: 110, top: 291, width: 656, height: 56 }),
    )
    // Not merely equal — the SAME object, so a block cannot drift from the
    // bounding rect by rounding or by a later edit to the fragment branch.
    expect(geometry.fragments[0]).toBe(geometry.union)
    expect(geometry.first).toBe(geometry.union)
  })

  it('gives a wrapped inline run one box per line, in content order', () => {
    // Three lines of a footer tagline, as measured in the running besigner:
    // the union is 269 wide, but no line is.
    const wrapped = elementWith([
      rect(110, 619, 269, 20),
      rect(110, 639, 246, 20),
      rect(110, 659, 130, 20),
    ])

    const geometry = getElementFragmentRects(wrapped)

    expect(geometry.fragments.map((r) => [r.top, r.width])).toEqual([
      [619, 269],
      [639, 246],
      [659, 130],
    ])
    // The union covers 139px of empty space to the right of the last line.
    // An outline drawn on the union is exactly that much too wide.
    expect(geometry.union.width).toBe(269)
    expect(geometry.union.height).toBe(60)
  })

  /**
   * The case a union box gets WORST, and the reason the label chip anchors on
   * `first` rather than on the union: a run that begins mid-line and wraps to
   * the start of the next. The union's top-left is at x=110 on the first
   * line — a point occupied by the SIBLING text the run follows.
   */
  it('anchors on the fragment the run starts on, not the union corner', () => {
    const midLine = elementWith([
      rect(420, 619, 180, 20),
      rect(110, 639, 240, 20),
    ])

    const geometry = getElementFragmentRects(midLine)

    expect(geometry.first.left).toBe(420)
    expect(geometry.first.top).toBe(619)
    expect(geometry.union.left).toBe(110)
    expect(geometry.first).not.toEqual(geometry.union)
  })

  it('drops degenerate boxes a soft break leaves behind', () => {
    const withSoftBreak = elementWith([
      rect(110, 619, 269, 20),
      rect(379, 619, 0, 20),
      rect(110, 639, 130, 20),
    ])

    expect(
      getElementFragmentRects(withSoftBreak).fragments.map((r) => r.width),
    ).toEqual([269, 130])
  })

  it('falls back to the union when every box is degenerate', () => {
    const empty = elementWith([rect(110, 619, 0, 20), rect(110, 639, 0, 20)])

    const geometry = getElementFragmentRects(empty)

    expect(geometry.fragments).toHaveLength(1)
    expect(geometry.fragments[0]).toBe(geometry.union)
  })

  it('answers for an element with no layout at all', () => {
    const hidden = elementWith([])

    const geometry = getElementFragmentRects(hidden)

    expect(geometry.fragments).toHaveLength(1)
    expect(geometry.union).toEqual(
      expect.objectContaining({ width: 0, height: 0 }),
    )
  })

  it('answers for a nullish element rather than throwing', () => {
    expect(getElementFragmentRects(null).fragments).toHaveLength(1)
    expect(getElementFragmentRects(undefined).union.width).toBe(0)
  })

  /**
   * A virtual element — the shape `getElementClientRectBounding` already
   * accepts — has no `getClientRects`. It must still get an answer, because
   * the overlay anchors on virtual elements.
   */
  it('answers for an element that cannot report client rects', () => {
    const virtual = {
      getBoundingClientRect: () => rect(10, 20, 30, 40),
    } as unknown as Element

    const geometry = getElementFragmentRects(virtual)

    expect(geometry.fragments).toHaveLength(1)
    expect(geometry.first.width).toBe(30)
  })
})
