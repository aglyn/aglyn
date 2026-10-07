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

import { CODE128_PATTERNS, code128Svg, code128Values, code128Widths } from './code128'

/**
 * The receipt barcode (AGL-3609). A wrong width in the table prints a
 * barcode no scanner reads, so the table is held to the properties every
 * Code 128 symbol has rather than trusted.
 */
describe('the Code 128 table', () => {
  it('has 107 distinct symbols of eleven modules, three bars and three spaces', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    for (const pattern of CODE128_PATTERNS.slice(0, 106)) {
      const widths = [...pattern].map(Number)
      expect(widths).toHaveLength(6)
      expect(widths.reduce((sum, width) => sum + width, 0)).toBe(11)
      // Every symbol's bars cover an even number of modules (the parity check).
      expect((widths[0]! + widths[2]! + widths[4]!) % 2).toBe(0)
    }
    expect([...CODE128_PATTERNS[106]!].map(Number).reduce((sum, width) => sum + width, 0)).toBe(13)
  })
})

describe('encoding', () => {
  it('packs an even run of digits two to a symbol in code set C', () => {
    // Start C (105), 10, 42, check = (105 + 10·1 + 42·2) % 103 = 96, stop.
    expect(code128Values('1042')).toEqual([105, 10, 42, 96, 106])
  })

  it('uses code set B for anything else, with the weighted check', () => {
    // Start B (104), "1" 17, "0" 16, "4" 20; (104 + 17 + 32 + 60) % 103 = 7.
    expect(code128Values('104')).toEqual([104, 17, 16, 20, 7, 106])
    expect(code128Values('A-1')[0]).toBe(104)
  })

  it('refuses what code set B cannot carry, and nothing at all', () => {
    expect(() => code128Values('café')).toThrow()
    expect(() => code128Values('')).toThrow()
  })

  it('lays out bar and space widths ending on the stop bar', () => {
    const widths = code128Widths('1042')
    expect(widths.length).toBe(4 * 6 + 7)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(4 * 11 + 13)
  })

  it('draws an SVG with a bar for every bar width and quiet zones', () => {
    const svg = code128Svg('1042', { moduleWidth: 1, height: 40 })
    expect(svg).toMatch(/^<svg /)
    expect(svg.match(/<rect x=/g)).toHaveLength(Math.ceil((4 * 6 + 7) / 2))
    expect(svg).toContain('viewBox="0 0 77 40"')
    expect(svg).toContain('aria-label="1042"')
  })
})
