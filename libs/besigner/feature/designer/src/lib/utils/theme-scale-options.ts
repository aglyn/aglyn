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
  /** A created theme exposes `spacing` as a FUNCTION (`spacing(2)` →
   * `'16px'`); raw theme options carry the bare unit number. Both are
   * accepted because both reach these builders. */
  spacing?: ((factor: number) => string | number) | number
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

/* ── Spacing ──────────────────────────────────────────────────────────── */

/**
 * One rung of the theme's spacing ladder, as the box styler offers it
 * (AGL-2486, item 5).
 *
 * **`value` is a NUMBER and that is the whole point.** MUI's sx system
 * resolves a bare number on a spacing property through `theme.spacing`, so
 * `marginTop: 2` renders 16px under `spacing: 8` and 8px under `spacing: 4`
 * — it keeps following the theme exactly the way `h4.fontSize` and
 * `primary.main` do. Storing the resolved `'16px'` instead would be wrong
 * for the same reason a flattened colour is wrong: it stops tracking the
 * theme the moment anyone retunes it.
 *
 * The numeric form is also the ONLY one that works. MUI multiplies numbers
 * and passes strings through untouched, so the string `'2'` would reach the
 * browser as `margin-top: 2` and be dropped by the CSS parser.
 */
export interface SpacingScaleOption {
  /** The theme spacing STEP, stored as a number so MUI resolves it. */
  value: number
  /** The author's name for it (`Medium`) — no CSS vocabulary required. */
  label: string
  /** What it resolves to in this theme today (`16px`). */
  hint: string
}

/**
 * The ladder offered, in the order a scale is read.
 *
 * Named rather than numbered because this is the one control in the panel
 * a non-developer is guaranteed to meet: "Medium" is a choice anyone can
 * make, "2" is a question about what the unit is. The resolved value rides
 * along in the hint so the answer is still there for whoever wants it.
 *
 * `0` is on the ladder as **None**, and it is a real value meaning "no
 * space", not the absence of one — the styler keeps "not set" as a separate
 * answer that removes the property entirely.
 */
const SPACING_STEPS: ReadonlyArray<{ step: number; label: string }> = [
  { step: 0, label: 'None' },
  { step: 0.5, label: 'Hairline' },
  { step: 1, label: 'Extra small' },
  { step: 2, label: 'Small' },
  { step: 3, label: 'Medium' },
  { step: 4, label: 'Large' },
  { step: 6, label: 'Extra large' },
  { step: 8, label: 'Huge' },
  { step: 12, label: 'Giant' },
]

/** What one step resolves to, or `''` when the theme cannot answer. */
function resolveSpacing(
  spacing: ThemeScaleSource['spacing'],
  step: number,
): string {
  if (typeof spacing === 'function') {
    const resolved = spacing(step)
    if (typeof resolved === 'number') {
      return Number.isFinite(resolved) ? `${resolved}px` : ''
    }
    return typeof resolved === 'string' ? resolved : ''
  }
  // Raw theme options carry the bare unit; mirror MUI's own arithmetic.
  if (typeof spacing === 'number' && Number.isFinite(spacing)) {
    return `${spacing * step}px`
  }
  return ''
}

/**
 * The spacing ladder read off the SITE theme, so a host that set
 * `spacing: 4` offers its own eight-step ladder rather than Aglyn's.
 *
 * A theme with no usable `spacing` yields an empty list, which leaves the
 * styler on custom amounts only — never a ladder of numbers that resolve to
 * nothing.
 */
export function buildSpacingScaleOptions(
  theme: ThemeScaleSource | undefined,
): SpacingScaleOption[] {
  const spacing = theme?.spacing
  const options: SpacingScaleOption[] = []
  for (const { step, label } of SPACING_STEPS) {
    const hint = resolveSpacing(spacing, step)
    // `'0px'` is truthy, so None survives this guard — the check is for a
    // theme that cannot resolve the step at all, not for a zero value.
    if (hint === '') continue
    options.push({ value: step, label, hint })
  }
  return options
}

/** Every theme scale the style field groups need, built once per theme. */
export interface StyleThemeScales {
  fontSize: ThemeScaleOption[]
  fontWeight: ThemeScaleOption[]
  zIndex: ThemeScaleOption[]
  /** The box styler's spacing ladder (AGL-2486, item 5). */
  spacing: SpacingScaleOption[]
}

export function buildStyleThemeScales(
  theme: ThemeScaleSource | undefined,
): StyleThemeScales {
  return {
    fontSize: buildFontSizeScaleOptions(theme),
    fontWeight: buildFontWeightScaleOptions(theme),
    zIndex: buildZIndexScaleOptions(theme),
    spacing: buildSpacingScaleOptions(theme),
  }
}
