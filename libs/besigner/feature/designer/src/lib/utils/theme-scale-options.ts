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

import type { ThemeScaleOption } from '@aglyn/shared-ui-jsx-forms'

/**
 * The theme scales the styles panel offers for Font Size, Font Weight and
 * Z-Index (AGL-2486, item 12).
 *
 * Every option's `value` is a token path MUI's sx system resolves ITSELF —
 * `fontSize` and `fontWeight` are declared with `themeKey: 'typography'` and
 * `zIndex` with `themeKey: 'zIndex'`, so `h4.fontSize`, `fontWeightBold` and
 * `appBar` behave exactly like `color: 'primary.main'` does. Nothing new has
 * to resolve them and nothing downstream has to know these lists exist: the
 * panel stores a string, the theme turns it into a number.
 *
 * They are built from the SITE theme rather than hardcoded, so a host that
 * has retuned its type scale or added a z-index layer offers its own values,
 * and the `hint` on each option is read out of that theme too — which is the
 * only thing that makes `h4.fontSize` legible to an author.
 */

/** The subset of a theme these builders read. */
export interface ThemeScaleSource {
  typography?: Record<string, unknown>
  zIndex?: Record<string, unknown>
}

/** `mobileStepper` → `Mobile stepper`. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** What a theme value reads as in the hint, or '' when it is not a scalar. */
function hintOf(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : ''
  return typeof value === 'string' ? value : ''
}

/**
 * The typography variants offered as font sizes, in the order a type scale
 * is read rather than alphabetically. A variant the theme does not define —
 * or defines without a `fontSize` — is dropped, so a slimmed-down host theme
 * offers only what it really has.
 */
const FONT_SIZE_VARIANTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'h1', label: 'Heading 1' },
  { key: 'h2', label: 'Heading 2' },
  { key: 'h3', label: 'Heading 3' },
  { key: 'h4', label: 'Heading 4' },
  { key: 'h5', label: 'Heading 5' },
  { key: 'h6', label: 'Heading 6' },
  { key: 'subtitle1', label: 'Subtitle 1' },
  { key: 'subtitle2', label: 'Subtitle 2' },
  { key: 'body1', label: 'Body' },
  { key: 'body2', label: 'Body small' },
  { key: 'button', label: 'Button' },
  { key: 'caption', label: 'Caption' },
  { key: 'overline', label: 'Overline' },
]

/** Font sizes from `theme.typography`, e.g. `h4.fontSize` → `2.125rem`. */
export function buildFontSizeScaleOptions(
  theme: ThemeScaleSource | undefined,
): ThemeScaleOption[] {
  const typography = theme?.typography
  if (!typography) return []
  const options: ThemeScaleOption[] = []
  for (const { key, label } of FONT_SIZE_VARIANTS) {
    const variant = typography[key]
    if (!variant || typeof variant !== 'object') continue
    const fontSize = (variant as Record<string, unknown>)['fontSize']
    const hint = hintOf(fontSize)
    if (!hint) continue
    options.push({ value: `${key}.fontSize`, label, hint })
  }
  return options
}

/**
 * The four weights MUI's typography names, then the plain CSS ladder.
 *
 * Both halves are offered because both are real answers: `fontWeightBold`
 * follows a host that decides its bold is 600, while `700` is what an author
 * who wants exactly 700 means. The token entries come first so the
 * theme-following answer is the one in reach.
 */
const FONT_WEIGHT_TOKENS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'fontWeightLight', label: 'Light (theme)' },
  { key: 'fontWeightRegular', label: 'Regular (theme)' },
  { key: 'fontWeightMedium', label: 'Medium (theme)' },
  { key: 'fontWeightBold', label: 'Bold (theme)' },
]

const FONT_WEIGHT_LADDER: ReadonlyArray<{ value: string; label: string }> = [
  { value: '100', label: 'Thin' },
  { value: '200', label: 'Extra light' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra bold' },
  { value: '900', label: 'Black' },
]

export function buildFontWeightScaleOptions(
  theme: ThemeScaleSource | undefined,
): ThemeScaleOption[] {
  const typography = theme?.typography
  const options: ThemeScaleOption[] = []
  for (const { key, label } of FONT_WEIGHT_TOKENS) {
    const hint = hintOf(typography ? typography[key] : undefined)
    if (!hint) continue
    options.push({ value: key, label, hint })
  }
  for (const entry of FONT_WEIGHT_LADDER) {
    options.push({ value: entry.value, label: entry.label, hint: entry.value })
  }
  return options
}

/**
 * Stacking layers from `theme.zIndex`, ordered by the layer they sit on
 * rather than alphabetically — an author picking "above the app bar" is
 * reading the stack, not the key names.
 *
 * This is the one of the three where a raw number is usually the WRONG
 * answer: typing `1300` next to a modal the theme also puts at 1300 is a
 * coin toss, and a host that re-tunes its layers leaves that number behind.
 */
export function buildZIndexScaleOptions(
  theme: ThemeScaleSource | undefined,
): ThemeScaleOption[] {
  const zIndex = theme?.zIndex
  if (!zIndex) return []
  return Object.keys(zIndex)
    .filter((key) => typeof zIndex[key] === 'number')
    .sort((a, b) => (zIndex[a] as number) - (zIndex[b] as number))
    .map((key) => ({
      value: key,
      label: humanizeKey(key),
      hint: `${zIndex[key]}`,
    }))
}

/** Every theme scale the style field groups need, built once per theme. */
export interface StyleThemeScales {
  fontSize: ThemeScaleOption[]
  fontWeight: ThemeScaleOption[]
  zIndex: ThemeScaleOption[]
}

export function buildStyleThemeScales(
  theme: ThemeScaleSource | undefined,
): StyleThemeScales {
  return {
    fontSize: buildFontSizeScaleOptions(theme),
    fontWeight: buildFontWeightScaleOptions(theme),
    zIndex: buildZIndexScaleOptions(theme),
  }
}
