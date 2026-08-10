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

import type { HostTheme, HostThemeSchemeColors } from '@aglyn/shared-data-types'

/**
 * MUI's own toolbar breakpoint. `mixins.toolbar` has to carry this exact
 * query, because the rule it competes with is MUI's `@media (min-width:600px)
 * { min-height: 64px }` (AGL-1242).
 */
export const TOOLBAR_SM_MIN_WIDTH = 600
export const TOOLBAR_SM_QUERY = `@media (min-width:${TOOLBAR_SM_MIN_WIDTH}px)`
/** MUI's stock Toolbar heights, shown when the host has set none. */
export const DEFAULT_TOOLBAR_XS = 56
export const DEFAULT_TOOLBAR_SM = 64
/**
 * `createMixins` spreads `...mixins` AFTER its default, so anything we write
 * REPLACES the stock toolbar wholesale — including its short-landscape rule.
 * Carrying it forward keeps that behaviour instead of dropping it silently.
 */
export const TOOLBAR_LANDSCAPE_QUERY = '@media (min-width:0px)'
export const TOOLBAR_LANDSCAPE_RULE = {
  '@media (orientation: landscape)': { minHeight: 48 },
}

/** Reads a px `minHeight` out of `mixins.toolbar` for one breakpoint. */
export function readToolbarHeight(theme: HostTheme, breakpoint: 'xs' | 'sm') {
  const toolbar = theme.mixins?.toolbar
  if (!toolbar) return undefined
  const raw =
    breakpoint === 'xs'
      ? toolbar.minHeight
      : (toolbar[TOOLBAR_SM_QUERY] as { minHeight?: unknown } | undefined)
          ?.minHeight
  const value = parseFloat(String(raw ?? ''))
  return Number.isFinite(value) ? value : undefined
}

/**
 * Builds a COMPLETE `mixins.toolbar`, in the order MUI emits it.
 *
 * Two things this exists to get right, both because `mixins.toolbar` replaces
 * MUI's default wholesale rather than merging into it (AGL-1242):
 *
 * - **Completeness.** Anything omitted is simply gone. Writing only a desktop
 *   height left portrait phones with no `min-height` at all, so unset
 *   breakpoints fall back to MUI's own 56 / 64.
 * - **Key order.** These land in one CSS rule, so the last matching
 *   declaration wins. MUI emits the landscape clause BEFORE the sm height;
 *   emitting it after makes a wide landscape window — i.e. every desktop —
 *   48px tall.
 */
export function buildToolbarMixin(xs: number | undefined, sm: number | undefined) {
  return {
    minHeight: `${xs ?? DEFAULT_TOOLBAR_XS}px`,
    [TOOLBAR_LANDSCAPE_QUERY]: TOOLBAR_LANDSCAPE_RULE,
    [TOOLBAR_SM_QUERY]: { minHeight: `${sm ?? DEFAULT_TOOLBAR_SM}px` },
  }
}

/**
 * Serializes the branches whose KEY ORDER changes what renders.
 *
 * `deepEqual` is order-INsensitive on purpose (AGL-56: Firestore hands the
 * palette back in a different key order than the editor builds it, and a
 * string compare left Save enabled forever), so on its own it cannot see a
 * reorder of `mixins.toolbar` — a change that really does alter the CSS.
 *
 * Deliberately narrow: only `mixins`. `components.*.styleOverrides` are CSS
 * objects too, but widening this would re-expose the AGL-56 failure for every
 * host with component overrides, and order-sensitivity has only actually been
 * demonstrated here. (Verified that Firestore returns `mixins` in the written
 * order, so this does not mark a freshly-loaded document dirty.)
 */
export function orderSensitiveKey(theme: HostTheme): string {
  return JSON.stringify(theme.mixins ?? {})
}

export type PaletteColorKey =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'surface'
  | 'error'
  | 'warning'
  | 'info'
  | 'success'

export const PALETTE_COLOR_FIELDS: Array<{
  key: PaletteColorKey
  label: string
}> = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'tertiary', label: 'Tertiary' },
  { key: 'surface', label: 'Surface' },
  { key: 'error', label: 'Error' },
  { key: 'warning', label: 'Warning' },
  { key: 'info', label: 'Info' },
  { key: 'success', label: 'Success' },
]

export type SurfaceColorPath =
  | ['background', 'default']
  | ['background', 'paper']
  | ['text', 'primary']
  | ['text', 'secondary']
  | ['text', 'disabled']
  | ['tint', 'primary']
  | ['tint', 'secondary']
  | ['tint', 'tertiary']

export const SURFACE_COLOR_FIELDS: Array<{
  path: SurfaceColorPath
  label: string
}> = [
  { path: ['background', 'default'], label: 'Background' },
  { path: ['background', 'paper'], label: 'Paper' },
  { path: ['text', 'primary'], label: 'Text' },
  { path: ['text', 'secondary'], label: 'Secondary text' },
  { path: ['text', 'disabled'], label: 'Disabled text' },
]

/**
 * Pale accent washes (AGL-1244).
 *
 * Separate from {@link PALETTE_COLOR_FIELDS} because a tint is a STRING LEAF,
 * not a `{ main }` record — the palette fields all write `main`, and a tint has
 * none. It rides the same `SurfaceColorPath` machinery as `background`/`text`
 * for exactly that reason, and is listed apart only so the editor can head it
 * "Tints" instead of filing it under "Background & text".
 */
export const TINT_COLOR_FIELDS: Array<{
  path: SurfaceColorPath
  label: string
}> = [
  { path: ['tint', 'primary'], label: 'Primary tint' },
  { path: ['tint', 'secondary'], label: 'Secondary tint' },
  { path: ['tint', 'tertiary'], label: 'Tertiary tint' },
]

/** Curated Google Fonts choices for the font family selector. */
export const GOOGLE_FONT_OPTIONS: Array<{
  family: string
  category: 'sans-serif' | 'serif' | 'monospace' | 'display'
  weights: Array<number>
}> = [
  { family: 'Inter', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Open Sans', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Lato', category: 'sans-serif', weights: [400, 700] },
  { family: 'Montserrat', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Poppins', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Nunito', category: 'sans-serif', weights: [400, 600, 700] },
  { family: 'Work Sans', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Raleway', category: 'sans-serif', weights: [400, 500, 700] },
  { family: 'Merriweather', category: 'serif', weights: [400, 700] },
  { family: 'Playfair Display', category: 'serif', weights: [400, 700] },
  { family: 'Lora', category: 'serif', weights: [400, 700] },
  { family: 'Source Serif 4', category: 'serif', weights: [400, 700] },
  { family: 'JetBrains Mono', category: 'monospace', weights: [400, 700] },
  { family: 'Bebas Neue', category: 'display', weights: [400] },
]

export function fontFamilyStack(
  family: string,
  category: (typeof GOOGLE_FONT_OPTIONS)[number]['category'],
) {
  const fallback = category === 'monospace' ? 'monospace' : category === 'serif' ? 'serif' : 'sans-serif'
  return `"${family}", ${fallback}`
}

export function getSchemeColor(
  colors: HostThemeSchemeColors | undefined,
  path: SurfaceColorPath,
): string | undefined {
  const [group, key] = path
  return (colors?.[group] as Record<string, string> | undefined)?.[key]
}
