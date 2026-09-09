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

/**
 * The WCAG luminance math, with no color library under it.
 *
 * `shared-ui-theme`'s `accessible-shade` owns the same math for the token
 * pipeline, but it decomposes colors through MUI. The two callers here are a
 * server-rendered email page and a console effect, and neither should have to
 * take a theme library to answer "black text or white text on this swatch" —
 * which is how they came to carry a copy each, and how one of the copies came
 * to be wrong.
 *
 * Deliberately NOT re-exported from this library's index — reach it as
 * `@aglyn/shared-util-tools/contrast`. The index note records why.
 */

/** One sRGB channel (0–255) as linear light. */
export function srgbChannelToLinear(channel: number): number {
  const value = Math.min(255, Math.max(0, channel)) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminanceOfRgb(
  red: number,
  green: number,
  blue: number,
): number {
  return (
    0.2126 * srgbChannelToLinear(red) +
    0.7152 * srgbChannelToLinear(green) +
    0.0722 * srgbChannelToLinear(blue)
  )
}

/**
 * `#abc` / `#abcd` / `#rrggbb` / `#rrggbbaa` → channels, or null.
 *
 * Alpha is parsed off and discarded: these callers choose ink for a filled
 * surface, and what the surface composites over is not knowable here.
 */
export function rgbChannelsOfHex(
  color: string,
): [red: number, green: number, blue: number] | null {
  const body = color.trim().replace(/^#/, '')
  const full =
    body.length === 3 || body.length === 4
      ? body
          .slice(0, 3)
          .split('')
          .map((character) => character + character)
          .join('')
      : body.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/**
 * The luminance at which black text and white text read equally well.
 *
 * Not a taste value and not 0.5. Contrast under WCAG 2.x is
 * `(lighter + 0.05) / (darker + 0.05)`, so black on a background of
 * luminance `L` scores `(L + 0.05) / 0.05` and white on it scores
 * `1.05 / (L + 0.05)`. Those are equal at `L = √(0.05 × 1.05) − 0.05`,
 * which is 0.1791.
 *
 * Splitting at 0.5 instead does not merely round differently, it picks the
 * WRONG ink across the whole middle of the range: on a mid-tone brand color
 * of luminance 0.3 it chooses white, at 3.0:1 — below the AA bar — where
 * black would have given 7.0:1.
 *
 * Written as the derivation rather than as the 0.179 everyone quotes, so the
 * value cannot drift from the rule it comes from.
 */
export const INK_SWITCH_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05

/**
 * Does dark ink read better than light ink on this background?
 *
 * `null` when the color is not a hex literal this can measure, so a caller
 * decides its own fallback rather than being handed a guess.
 */
export function prefersDarkInk(color: string): boolean | null {
  const channels = rgbChannelsOfHex(color)
  if (!channels) return null
  return relativeLuminanceOfRgb(...channels) > INK_SWITCH_LUMINANCE
}
