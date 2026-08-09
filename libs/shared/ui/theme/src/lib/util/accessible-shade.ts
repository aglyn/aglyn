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

import { decomposeColor, hslToRgb, rgbToHex } from '../../vendor/mui'

/** Ramp direction for a shade walk. */
export type ShadeDirection = 'darken' | 'lighten'

/** WCAG 2.x AA contrast bar for normal-size text. */
export const AA_TEXT_CONTRAST = 4.5

export type AccessibleShadeOptions = {
  /** Contrast every background must clear. Default {@link AA_TEXT_CONTRAST}. */
  minContrast?: number
  /** HSL lightness moved per iteration (0–1 scale). Default 0.01. */
  step?: number
  /**
   * Iteration cap. The default covers the full lightness range at the
   * default step with headroom, so the walk always terminates at a pole
   * before hitting it in practice.
   */
  maxSteps?: number
}

function srgbChannelToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * Exact WCAG relative luminance. MUI's `getLuminance` truncates to three
 * digits, which is enough slop to misclassify a borderline shade either side
 * of the 4.5:1 bar — the whole reason this module exists — so the math here
 * keeps full precision. Alpha is ignored (this pipeline derives opaque
 * tokens), matching MUI's behaviour for rgba inputs.
 */
export function relativeLuminance(color: string): number {
  const decomposed = decomposeColor(color)
  if (decomposed.type === 'color') {
    // `color(display-p3 …)` values are not 0–255 channels; a caller that
    // feeds these must handle its own contrast.
    throw new Error(`accessible-shade: unsupported color format "${color}"`)
  }
  const values = decomposed.type.startsWith('hsl')
    ? decomposeColor(hslToRgb(color)).values
    : decomposed.values
  return (
    0.2126 * srgbChannelToLinear(values[0]) +
    0.7152 * srgbChannelToLinear(values[1]) +
    0.0722 * srgbChannelToLinear(values[2])
  )
}

/** Exact WCAG contrast ratio between two colors, 1–21. */
export function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA)
  const luminanceB = relativeLuminance(colorB)
  return (
    (Math.max(luminanceA, luminanceB) + 0.05) /
    (Math.min(luminanceA, luminanceB) + 0.05)
  )
}

/** True when `foreground` clears `minContrast` against EVERY background. */
export function meetsContrast(
  foreground: string,
  backgrounds: ReadonlyArray<string>,
  minContrast: number = AA_TEXT_CONTRAST,
): boolean {
  return backgrounds.every(
    (background) => contrastRatio(foreground, background) >= minContrast,
  )
}

/** [hue 0–360, saturation 0–1, lightness 0–1] */
function toHslValues(color: string): [number, number, number] {
  const decomposed = decomposeColor(color)
  if (decomposed.type.startsWith('hsl')) {
    const [h, s, l] = decomposed.values
    return [h, s / 100, l / 100]
  }
  const r = decomposed.values[0] / 255
  const g = decomposed.values[1] / 255
  const b = decomposed.values[2] / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue: number
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return [hue * 60, saturation, lightness]
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  return rgbToHex(
    hslToRgb(`hsl(${hue}, ${saturation * 100}%, ${lightness * 100}%)`),
  )
}

/**
 * Nearest shade of `color`, walking HSL lightness in `direction` only, that
 * clears `minContrast` against every background (AGL-1297). Hue and
 * saturation are held fixed so the result stays the same colour, just
 * deeper or lighter.
 *
 * - If `color` already clears the bar, it is returned UNCHANGED —
 *   byte-identical, so a value that was fine yesterday stays byte-stable.
 * - The walk is one-directional: pass `'darken'` for a foreground on light
 *   backgrounds, `'lighten'` for a foreground on dark backgrounds.
 * - If the bar is unreachable in that direction (e.g. lightening against a
 *   mid-grey), the walk stops at the pole (black/white) or the iteration
 *   cap and returns that best-effort value rather than looping or
 *   reversing direction.
 */
export function accessibleShade(
  color: string,
  backgrounds: ReadonlyArray<string>,
  direction: ShadeDirection,
  options: AccessibleShadeOptions = {},
): string {
  const {
    minContrast = AA_TEXT_CONTRAST,
    step = 0.01,
    maxSteps = 120,
  } = options
  if (!backgrounds.length || meetsContrast(color, backgrounds, minContrast)) {
    return color
  }
  const [hue, saturation, initialLightness] = toHslValues(color)
  const delta = direction === 'lighten' ? step : -step
  let lightness = initialLightness
  let candidate = color
  for (let i = 0; i < maxSteps; i += 1) {
    lightness = Math.min(1, Math.max(0, lightness + delta))
    candidate = hslToHex(hue, saturation, lightness)
    if (meetsContrast(candidate, backgrounds, minContrast)) return candidate
    // Pole reached without clearing: nothing further exists in this
    // direction, so return the extreme as the best effort.
    if (lightness === 0 || lightness === 1) return candidate
  }
  return candidate
}

export default accessibleShade
