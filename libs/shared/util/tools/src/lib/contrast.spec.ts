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
  INK_SWITCH_LUMINANCE,
  prefersDarkInk,
  relativeLuminanceOfRgb,
  rgbChannelsOfHex,
} from './contrast'

/** WCAG 2.x contrast between a luminance and black, and the same for white. */
const againstBlack = (luminance: number) => (luminance + 0.05) / 0.05
const againstWhite = (luminance: number) => 1.05 / (luminance + 0.05)

describe('relativeLuminanceOfRgb', () => {
  it('puts black at 0 and white at 1', () => {
    expect(relativeLuminanceOfRgb(0, 0, 0)).toBe(0)
    expect(relativeLuminanceOfRgb(255, 255, 255)).toBeCloseTo(1, 10)
  })

  it('weights green far above blue, as luminance does', () => {
    expect(relativeLuminanceOfRgb(0, 255, 0)).toBeGreaterThan(
      relativeLuminanceOfRgb(0, 0, 255),
    )
  })
})

describe('rgbChannelsOfHex', () => {
  it('expands the three- and four-digit forms', () => {
    expect(rgbChannelsOfHex('#abc')).toEqual([0xaa, 0xbb, 0xcc])
    expect(rgbChannelsOfHex('#abcd')).toEqual([0xaa, 0xbb, 0xcc])
  })

  it('drops the alpha of an eight-digit color rather than reading it as blue', () => {
    expect(rgbChannelsOfHex('#11223344')).toEqual([0x11, 0x22, 0x33])
  })

  it('accepts a color with no leading hash, and any case', () => {
    expect(rgbChannelsOfHex('FF8800')).toEqual([255, 136, 0])
  })

  it('returns null for anything it cannot measure', () => {
    expect(rgbChannelsOfHex('rgb(1,2,3)')).toBeNull()
    expect(rgbChannelsOfHex('#12345')).toBeNull()
    expect(rgbChannelsOfHex('')).toBeNull()
  })
})

/**
 * The threshold is the whole point of this module, so it is asserted from the
 * WCAG definition rather than restated as a literal — a test that repeats the
 * constant would have passed just as happily at the wrong 0.5 the console
 * shipped before AGL-2706.
 */
describe('INK_SWITCH_LUMINANCE', () => {
  it('is the luminance at which black and white text tie', () => {
    expect(againstBlack(INK_SWITCH_LUMINANCE)).toBeCloseTo(
      againstWhite(INK_SWITCH_LUMINANCE),
      4,
    )
  })
})

describe('prefersDarkInk', () => {
  it('picks the ink with the higher contrast, not the nearer pole', () => {
    for (const color of ['#000000', '#404c5c', '#808080', '#00b0ff', '#ffff00', '#ffffff']) {
      const luminance = relativeLuminanceOfRgb(...rgbChannelsOfHex(color)!)
      const dark = againstBlack(luminance)
      const light = againstWhite(luminance)
      expect(prefersDarkInk(color)).toBe(dark > light)
    }
  })

  it('chooses dark ink on the mid-tones a 0.5 split got wrong', () => {
    // Luminance ≈ 0.28: white scores 3.1:1 — under AA — and black 6.6:1.
    expect(prefersDarkInk('#8f8f8f')).toBe(true)
  })

  it('answers null rather than guessing at an unmeasurable color', () => {
    expect(prefersDarkInk('var(--brand)')).toBeNull()
  })
})
