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
  AA_TEXT_CONTRAST,
  accessibleShade,
  contrastRatio,
  meetsContrast,
  relativeLuminance,
} from './accessible-shade'

/**
 * Independent WCAG 2.x implementation so the assertions do not trust the
 * code under test. Hex-only on purpose — every input below is hex.
 */
function wcagRatio(foregroundHex: string, backgroundHex: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace('#', '')
    const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
    const [r, g, b] = channels.map((c) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const a = luminance(foregroundHex)
  const b = luminance(backgroundHex)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** [h, s, l] for hue/saturation preservation checks. */
function hexToHsl(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(value.slice(i, i + 2), 16) / 255,
  )
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

describe('contrastRatio / relativeLuminance', () => {
  it('matches an independent WCAG implementation', () => {
    // The AGL-1293 table: derived #007bb2 misses AA off-white, chosen
    // #0073ae clears it.
    expect(contrastRatio('#007bb2', '#ffffff')).toBeCloseTo(
      wcagRatio('#007bb2', '#ffffff'),
      10,
    )
    expect(contrastRatio('#007bb2', '#fafafa')).toBeLessThan(4.5)
    expect(contrastRatio('#0073ae', '#fafafa')).toBeGreaterThanOrEqual(4.5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
    expect(relativeLuminance('#000000')).toBe(0)
  })

  it('accepts rgb() strings (the format MUI darken/lighten emit)', () => {
    expect(contrastRatio('rgb(0, 123, 178)', '#ffffff')).toBeCloseTo(
      wcagRatio('#007bb2', '#ffffff'),
      10,
    )
  })
})

describe('meetsContrast', () => {
  it('requires the bar against EVERY background', () => {
    // Clears white but not the tint — the exact failure shape of AGL-1293.
    expect(meetsContrast('#007bb2', ['#ffffff'])).toBe(true)
    expect(meetsContrast('#007bb2', ['#ffffff', '#eaf6fd'])).toBe(false)
  })
})

describe('accessibleShade', () => {
  const lightSurfaces = ['#ffffff', '#fafafa', '#eaf6fd', '#f1f3f5']
  const darkSurfaces = ['#161c21', '#2a3440']

  it('returns the input BYTE-IDENTICAL when it already clears the bar', () => {
    const input = '#0073ae'
    expect(accessibleShade(input, ['#ffffff', '#fafafa'], 'darken')).toBe(input)
    // rgb() inputs pass through in their own format too.
    const rgbInput = 'rgb(0, 90, 135)'
    expect(accessibleShade(rgbInput, ['#ffffff'], 'darken')).toBe(rgbInput)
  })

  it('darkens a light-scheme foreground until AA clears on all surfaces', () => {
    const shade = accessibleShade('#00b0ff', lightSurfaces, 'darken')
    for (const surface of lightSurfaces) {
      expect(wcagRatio(shade, surface)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      )
    }
    expect(relativeLuminance(shade)).toBeLessThan(relativeLuminance('#00b0ff'))
  })

  it('lightens a dark-scheme foreground until AA clears on all surfaces', () => {
    // #007bb2 is the tonally-derived dark of the brand blue: 3.66:1 on the
    // dark page — the shade AGL-1297 exists to never ship again.
    const shade = accessibleShade('#007bb2', darkSurfaces, 'lighten')
    for (const surface of darkSurfaces) {
      expect(wcagRatio(shade, surface)).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      )
    }
    expect(relativeLuminance(shade)).toBeGreaterThan(
      relativeLuminance('#007bb2'),
    )
  })

  it('keeps hue and saturation while walking', () => {
    const input = '#00b0ff'
    const shade = accessibleShade(input, lightSurfaces, 'darken')
    const [inputHue, inputSaturation] = hexToHsl(input)
    const [shadeHue, shadeSaturation] = hexToHsl(shade)
    // Small drift comes from 8-bit rounding on the way back out of HSL.
    expect(Math.abs(shadeHue - inputHue)).toBeLessThanOrEqual(2)
    expect(Math.abs(shadeSaturation - inputSaturation)).toBeLessThanOrEqual(
      0.05,
    )
  })

  it('never reverses direction: an unreachable bar stops at the pole', () => {
    // Nothing lighter than #9e9e9e clears 4.5:1 on a #808080 background —
    // even pure white is ~3.95:1. The walk must terminate at white, not
    // loop or flip to darkening.
    const shade = accessibleShade('#9e9e9e', ['#808080'], 'lighten')
    expect(shade).toBe('#ffffff')
    expect(wcagRatio('#ffffff', '#808080')).toBeLessThan(4.5)
  })

  it('honours the iteration cap', () => {
    const shade = accessibleShade('#00b0ff', ['#ffffff'], 'darken', {
      maxSteps: 1,
    })
    expect(shade).not.toBe('#00b0ff')
    // One step of lightness cannot reach the bar from the brand blue.
    expect(wcagRatio(shade, '#ffffff')).toBeLessThan(4.5)
  })

  it('supports a custom contrast bar', () => {
    const shade = accessibleShade('#00b0ff', ['#ffffff'], 'darken', {
      minContrast: 7,
    })
    expect(wcagRatio(shade, '#ffffff')).toBeGreaterThanOrEqual(7)
  })
})
