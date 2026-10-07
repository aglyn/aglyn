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

import type {
  HostTheme,
  HostThemeComponentOverride,
  HostThemeFont,
  HostThemeFontCategory,
  HostThemeTypographyVariantKey,
  HostThemeScheme,
  HostThemeSchemeColors,
} from '@aglyn/shared-data-types'
import {
  HOST_THEME_COMPONENT_WHITELIST,
  type HostThemeComponentKey,
} from './host-theme'

/**
 * The host theme editor's field catalog (AGL-2938): every control the editor
 * renders, the range each one accepts, the token it writes, and the write
 * itself.
 *
 * It lives here rather than beside the editor because the editor is not the
 * only thing that changes a site's theme. Anything that proposes a theme
 * change has to offer exactly the controls the editor offers, with the same
 * bounds, and has to write each one the way the editor writes it. A copy of
 * this list anywhere else is a second answer to "what can a theme hold" that
 * drifts from the first the day a control is added, so the editor renders
 * from this module and every other writer reads it.
 *
 * Pure data and pure functions over `HostTheme`: no MUI, no React and no
 * brand theme. What a control resolves to when the site sets nothing is the
 * brand theme's business, in `theme-editor-defaults.ts`.
 *
 * Deliberately NOT re-exported from this library's index: the index reaches
 * every published page, and nothing a visitor renders needs the catalog.
 * Reach it as `@aglyn/shared-ui-theme/util/theme-editor-fields`.
 */

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
 * Carrying it forward keeps that behavior instead of dropping it silently.
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
 * demonstrated here.
 *
 * Firestore does NOT hand a map back in the order it was written, and it
 * hands different readers different orders (AGL-3146) — which is why what
 * renders is canonicalized in `hostThemeToThemeOptions` rather than trusted
 * from storage. A freshly-loaded document is still not dirty here, because
 * the draft is seeded from the loaded document itself: both sides of this
 * comparison carry whatever order THIS reader was given.
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

/** The one color leaf that is neither a palette color nor a member of a group. */
export const DIVIDER_COLOR_FIELD = { key: 'divider', label: 'Divider' } as const

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
  category: HostThemeFontCategory,
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

/* ------------------------------------------------------------------------ *
 * The controls, as one catalog
 * ------------------------------------------------------------------------ */

/** The two color schemes the editor edits, in tab order. */
export const THEME_EDITOR_SCHEMES: readonly HostThemeScheme[] = ['light', 'dark']

/**
 * Every color the editor edits per scheme, named the way a diff names it: a
 * palette key (`primary`), a group path joined with a dot
 * (`background.default`, `tint.primary`), or `divider`.
 */
export type ThemeColorToken =
  | PaletteColorKey
  | 'background.default'
  | 'background.paper'
  | 'text.primary'
  | 'text.secondary'
  | 'text.disabled'
  | 'tint.primary'
  | 'tint.secondary'
  | 'tint.tertiary'
  | 'divider'

/** Where a color control sits in the editor's Color scheme card. */
export type ThemeColorGroup = 'palette' | 'surface' | 'tint' | 'divider'

/** Every color field the editor renders, in the order it renders them. */
export const THEME_COLOR_FIELDS: ReadonlyArray<{
  token: ThemeColorToken
  label: string
  group: ThemeColorGroup
}> = [
  ...PALETTE_COLOR_FIELDS.map(({ key, label }) => ({
    token: key,
    label,
    group: 'palette' as const,
  })),
  ...SURFACE_COLOR_FIELDS.map(({ path, label }) => ({
    token: path.join('.') as ThemeColorToken,
    label,
    group: 'surface' as const,
  })),
  ...TINT_COLOR_FIELDS.map(({ path, label }) => ({
    token: path.join('.') as ThemeColorToken,
    label,
    group: 'tint' as const,
  })),
  {
    token: DIVIDER_COLOR_FIELD.key,
    label: DIVIDER_COLOR_FIELD.label,
    group: 'divider' as const,
  },
]

/** Whether visitors get a dark scheme; absent from the document means `auto`. */
export type ThemeDarkSchemeValue = 'auto' | 'off'

export const DARK_SCHEME_FIELD = {
  label: 'Dark scheme',
  options: [
    { value: 'auto', label: 'Follows the visitor' },
    { value: 'off', label: 'Off — always light' },
  ],
} as const

/**
 * The font select's value for "no font of the site's own": the theme's
 * default stack, with nothing to load.
 */
export const SYSTEM_FONT_VALUE = '__system__'

export const FONT_FAMILY_FIELD = { label: 'Font family' } as const

/** The corner radius slider, in px. */
export const BORDER_RADIUS_FIELD = {
  label: 'Border radius',
  min: 0,
  max: 24,
  step: 1,
} as const

/** The spacing unit MUI multiplies every `spacing(n)` by, in px. */
export const SPACING_FIELD = {
  label: 'Spacing unit (px)',
  min: 2,
  max: 16,
  step: 1,
} as const

/** The two nav heights, either side of MUI's toolbar breakpoint, in px. */
export const TOOLBAR_HEIGHT_FIELDS = {
  xs: { label: 'Nav height, mobile (px)', min: 40, max: 160, step: 1 },
  sm: { label: 'Nav height, desktop (px)', min: 40, max: 160, step: 1 },
} as const

/** The raw-JSON component overrides, limited to the sanitizer's whitelist. */
export const COMPONENT_OVERRIDES_FIELD = {
  label: 'Component overrides',
  components: HOST_THEME_COMPONENT_WHITELIST,
} as const

/**
 * The media queries a component override may scope a style to: either side
 * of MUI's own toolbar breakpoint, the one breakpoint the editor already
 * names. MUI's `down('sm')` stops a twentieth of a pixel short of it.
 */
export const THEME_EDITOR_MEDIA_QUERIES = {
  mobile: `@media (max-width:${TOOLBAR_SM_MIN_WIDTH - 0.05}px)`,
  desktop: TOOLBAR_SM_QUERY,
} as const

export type ThemeEditorMedia = keyof typeof THEME_EDITOR_MEDIA_QUERIES

export type ThemeEditorControlId =
  | `color.${ThemeColorToken}`
  | 'darkScheme'
  | 'fontFamily'
  | 'borderRadius'
  | 'spacing'
  | 'navHeight.xs'
  | 'navHeight.sm'
  | 'components'

/** One control the editor renders, described well enough to be offered elsewhere. */
export interface ThemeEditorControl {
  /** Stable id: what a diff row, a proposal and a spec name the control by. */
  id: ThemeEditorControlId
  /** The label the editor shows. */
  label: string
  kind: 'color' | 'select' | 'number' | 'json'
  /** Edited once per scheme, under the Light and Dark tabs. */
  perScheme: boolean
  /** A color control's token. */
  token?: ThemeColorToken
  /** A select's values, or the components a JSON control accepts. */
  options?: readonly string[]
  /** A number control's inclusive bounds and its step. */
  min?: number
  max?: number
  step?: number
}

/**
 * Every value-bearing control the editor renders, in the order it renders
 * them. The buttons that act on these values rather than hold one — Copy
 * from light, Reset to default, Discard, Save — are not controls: a reset is
 * a control set back to nothing, and a copy is every color control of one
 * scheme written from the other.
 */
export const THEME_EDITOR_CONTROLS: readonly ThemeEditorControl[] = [
  {
    id: 'darkScheme',
    label: DARK_SCHEME_FIELD.label,
    kind: 'select',
    perScheme: false,
    options: DARK_SCHEME_FIELD.options.map((option) => option.value),
  },
  ...THEME_COLOR_FIELDS.map(({ token, label }) => ({
    id: `color.${token}` as const,
    label,
    kind: 'color' as const,
    perScheme: true,
    token,
  })),
  {
    id: 'fontFamily',
    label: FONT_FAMILY_FIELD.label,
    kind: 'select',
    perScheme: false,
    options: [SYSTEM_FONT_VALUE, ...GOOGLE_FONT_OPTIONS.map((option) => option.family)],
  },
  {
    id: 'borderRadius',
    label: BORDER_RADIUS_FIELD.label,
    kind: 'number',
    perScheme: false,
    min: BORDER_RADIUS_FIELD.min,
    max: BORDER_RADIUS_FIELD.max,
    step: BORDER_RADIUS_FIELD.step,
  },
  {
    id: 'spacing',
    label: SPACING_FIELD.label,
    kind: 'number',
    perScheme: false,
    min: SPACING_FIELD.min,
    max: SPACING_FIELD.max,
    step: SPACING_FIELD.step,
  },
  {
    id: 'navHeight.xs',
    label: TOOLBAR_HEIGHT_FIELDS.xs.label,
    kind: 'number',
    perScheme: false,
    min: TOOLBAR_HEIGHT_FIELDS.xs.min,
    max: TOOLBAR_HEIGHT_FIELDS.xs.max,
    step: TOOLBAR_HEIGHT_FIELDS.xs.step,
  },
  {
    id: 'navHeight.sm',
    label: TOOLBAR_HEIGHT_FIELDS.sm.label,
    kind: 'number',
    perScheme: false,
    min: TOOLBAR_HEIGHT_FIELDS.sm.min,
    max: TOOLBAR_HEIGHT_FIELDS.sm.max,
    step: TOOLBAR_HEIGHT_FIELDS.sm.step,
  },
  {
    id: 'components',
    label: COMPONENT_OVERRIDES_FIELD.label,
    kind: 'json',
    perScheme: false,
    options: COMPONENT_OVERRIDES_FIELD.components,
  },
]

/** The catalog entry for a control id. */
export function themeEditorControl(id: ThemeEditorControlId): ThemeEditorControl {
  const control = THEME_EDITOR_CONTROLS.find((entry) => entry.id === id)
  if (!control) throw new Error(`unknown theme editor control ${id}`)
  return control
}

/* ------------------------------------------------------------------------ *
 * Reads and writes, exactly as the editor performs them
 * ------------------------------------------------------------------------ */

function setSchemeValue(
  theme: HostTheme,
  scheme: HostThemeScheme,
  update: (colors: HostThemeSchemeColors) => HostThemeSchemeColors,
): HostTheme {
  const colors = theme.colorSchemes?.[scheme] ?? {}
  return {
    ...theme,
    colorSchemes: { ...theme.colorSchemes, [scheme]: update(colors) },
  }
}

/** A color the site set for one scheme; `undefined` when the slot inherits. */
export function readThemeColor(
  theme: HostTheme | undefined,
  scheme: HostThemeScheme,
  token: ThemeColorToken,
): string | undefined {
  const colors = theme?.colorSchemes?.[scheme]
  if (token === 'divider') return colors?.divider
  const [group, key] = token.split('.')
  if (!key) return colors?.[group as PaletteColorKey]?.main
  return getSchemeColor(colors, [group, key] as SurfaceColorPath)
}

/**
 * Sets one color for one scheme, or clears it with `undefined` so the slot
 * inherits again. A palette color writes `main` and keeps whatever else its
 * record carries, and clearing it drops the record; a group member that
 * leaves its group empty drops the group.
 */
export function writeThemeColor(
  theme: HostTheme,
  scheme: HostThemeScheme,
  token: ThemeColorToken,
  hex: string | undefined,
): HostTheme {
  return setSchemeValue(theme, scheme, (colors) => {
    const next: HostThemeSchemeColors = { ...colors }
    if (token === 'divider') {
      if (hex) next.divider = hex
      else delete next.divider
      return next
    }
    const [group, key] = token.split('.')
    if (!key) {
      const paletteKey = group as PaletteColorKey
      if (hex) next[paletteKey] = { ...next[paletteKey], main: hex }
      else delete next[paletteKey]
      return next
    }
    const groupKey = group as 'background' | 'text' | 'tint'
    const groupValue = {
      ...(colors[groupKey] as Record<string, string> | undefined),
    }
    if (hex) groupValue[key] = hex
    else delete groupValue[key]
    const grouped = { ...next, [groupKey]: groupValue } as HostThemeSchemeColors
    if (!Object.keys(groupValue).length) delete grouped[groupKey]
    return grouped
  })
}

/** Replaces one scheme's colors with a copy of the other's. */
export function copyThemeSchemeColors(
  theme: HostTheme,
  from: HostThemeScheme,
  to: HostThemeScheme,
): HostTheme {
  const source = theme.colorSchemes?.[from]
  if (!source) return theme
  return {
    ...theme,
    colorSchemes: {
      ...theme.colorSchemes,
      [to]: JSON.parse(JSON.stringify(source)),
    },
  }
}

/** The dark scheme switch as the select shows it. */
export function readDarkScheme(theme: HostTheme | undefined): ThemeDarkSchemeValue {
  return theme?.darkScheme === 'off' ? 'off' : 'auto'
}

/**
 * Absent means "follows the visitor"; only the opt-out is written, so the
 * saved document stays empty for the common case.
 */
export function writeDarkScheme(
  theme: HostTheme,
  value: ThemeDarkSchemeValue,
): HostTheme {
  const next: HostTheme = { ...theme }
  if (value === 'off') next.darkScheme = 'off'
  else delete next.darkScheme
  return next
}

/** The font select's value: the site's font, or {@link SYSTEM_FONT_VALUE}. */
export function readFontFamily(theme: HostTheme | undefined): string {
  return theme?.fonts?.[0]?.family ?? SYSTEM_FONT_VALUE
}

/**
 * Picks a font from {@link GOOGLE_FONT_OPTIONS}, loading it and naming it as
 * the typography's stack, or {@link SYSTEM_FONT_VALUE} to go back to the
 * theme default. A family outside the curated list changes nothing.
 */
export function writeFontFamily(theme: HostTheme, value: string): HostTheme {
  if (value === SYSTEM_FONT_VALUE) {
    const next = { ...theme }
    delete next.fonts
    const typography = { ...next.typography }
    delete typography.fontFamily
    if (Object.keys(typography).length) next.typography = typography
    else delete next.typography
    return next
  }
  const option = GOOGLE_FONT_OPTIONS.find((entry) => entry.family === value)
  if (!option) return theme
  return {
    ...theme,
    fonts: [
      {
        family: option.family,
        weights: option.weights,
        source: 'google',
      },
    ],
    typography: {
      ...theme.typography,
      fontFamily: fontFamilyStack(option.family, option.category),
    },
  }
}

/**
 * The text styles a separate heading font is set on: `h1`…`h6`, and
 * `displayXl`, the platform's rung above `h1`, which a heading font left off
 * would draw in the body font — and load the body font's heaviest weight for.
 */
export const THEME_HEADING_VARIANTS: readonly HostThemeTypographyVariantKey[] = [
  'displayXl',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]

/**
 * One family a theme sets text in, as the font picker shows and writes it
 * (AGL-3656): a `fonts` entry and the role it plays.
 */
export interface ThemeFontChoice {
  family: string
  category: HostThemeFontCategory
  /** Upright weights to load, ascending. */
  weights: number[]
  /** Italic weights to load, ascending; absent or empty for none. */
  italics?: number[]
  source: 'google' | 'custom'
}

/**
 * The theme's body font and, when it differs, its heading font. `null` is the
 * theme default: the base stack, nothing loaded.
 */
export interface ThemeFontSelection {
  body: ThemeFontChoice | null
  heading: ThemeFontChoice | null
}

/** The first family a CSS font-family stack names, unquoted. */
export function firstStackFamily(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined
  const first = stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim()
  return first || undefined
}

/** The category a stack's generic keyword names, for a font that records none. */
function stackCategory(stack: unknown): HostThemeFontCategory {
  if (typeof stack !== 'string') return 'sans-serif'
  if (/\bmonospace\b/i.test(stack)) return 'monospace'
  if (/(^|,)\s*serif\b/i.test(stack)) return 'serif'
  return 'sans-serif'
}

function sortedWeights(values: readonly unknown[] | undefined): number[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => Math.round(Number(value)))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 1000),
    ),
  ].sort((a, b) => a - b)
}

function choiceOf(font: HostThemeFont, stack: unknown): ThemeFontChoice {
  const italics = sortedWeights(font.italics)
  return {
    family: font.family.trim(),
    category: font.category ?? stackCategory(stack),
    weights: sortedWeights(font.weights).length ? sortedWeights(font.weights) : [400],
    ...(italics.length ? { italics } : {}),
    source: font.source === 'custom' ? 'custom' : 'google',
  }
}

function findFont(theme: HostTheme | undefined, family: string | undefined) {
  if (!family) return undefined
  const wanted = family.toLowerCase()
  return theme?.fonts?.find(
    (font) =>
      font.family?.trim().toLowerCase() === wanted && (font.source ?? 'google') !== 'system',
  )
}

/**
 * The body and heading fonts a theme sets text in (AGL-3656).
 *
 * The body font is the family the theme-wide stack names first, when the
 * theme loads it: a font the theme lists that no stack names draws nothing,
 * which is what the theme default is. The heading font is the family `h1`
 * names, when that is a loaded font other than the body's.
 */
export function readThemeFonts(theme: HostTheme | undefined): ThemeFontSelection {
  const stack = theme?.typography?.fontFamily
  const bodyFont = findFont(theme, firstStackFamily(stack))
  const headingStack = theme?.typography?.variants?.h1?.fontFamily
  const headingFont = findFont(theme, firstStackFamily(headingStack))
  return {
    body: bodyFont ? choiceOf(bodyFont, stack) : null,
    heading:
      headingFont && headingFont !== bodyFont ? choiceOf(headingFont, headingStack) : null,
  }
}

function fontEntry(choice: ThemeFontChoice): HostThemeFont {
  const italics = sortedWeights(choice.italics)
  return {
    family: choice.family.trim(),
    weights: sortedWeights(choice.weights).length ? sortedWeights(choice.weights) : [400],
    ...(italics.length ? { italics } : {}),
    source: choice.source,
    category: choice.category,
  }
}

/**
 * Sets the theme's body and heading fonts (AGL-3656): the `fonts` entries the
 * page loads, the theme-wide stack, and the stack of each style in
 * {@link THEME_HEADING_VARIANTS} for a heading font of its own. `null` goes
 * back to the theme default for that role.
 *
 * An uploaded (`custom`) font the theme lists but no longer sets text in is
 * kept, because it is the site's own and is picked again from the list; a
 * Google font nothing sets text in any more is dropped, so the page stops
 * loading it. Everything else in the typography — sizes, weights, a variant's own
 * family that is not a heading — is left as it was.
 */
export function writeThemeFonts(theme: HostTheme, selection: ThemeFontSelection): HostTheme {
  const body = selection.body
  const heading =
    selection.heading &&
    (!body || selection.heading.family.toLowerCase() !== body.family.toLowerCase())
      ? selection.heading
      : null
  const previous = readThemeFonts(theme)
  const previousHeadingStack = previous.heading
    ? theme.typography?.variants?.h1?.fontFamily
    : undefined

  const chosen = [body, heading].filter((entry): entry is ThemeFontChoice => !!entry)
  const chosenKeys = new Set(chosen.map((entry) => entry.family.trim().toLowerCase()))
  // Families a text style other than a heading still names, by hand or by
  // an earlier editor: they keep loading, as their style keeps drawing them.
  const otherStyles = new Set(
    Object.entries(theme.typography?.variants ?? {})
      .filter(([key]) => !(THEME_HEADING_VARIANTS as readonly string[]).includes(key))
      .map(([, variant]) => firstStackFamily(variant?.fontFamily)?.toLowerCase())
      .filter((family): family is string => !!family),
  )
  const kept = (theme.fonts ?? []).filter((font) => {
    const key = font.family?.trim().toLowerCase() ?? ''
    if (!key || chosenKeys.has(key)) return false
    return font.source === 'custom' || otherStyles.has(key)
  })
  const fonts = [...chosen.map(fontEntry), ...kept]

  const typography = { ...theme.typography }
  if (body) typography.fontFamily = fontFamilyStack(body.family.trim(), body.category)
  else delete typography.fontFamily

  const variants = { ...typography.variants }
  for (const key of THEME_HEADING_VARIANTS) {
    const variant = { ...variants[key] }
    if (heading) {
      variant.fontFamily = fontFamilyStack(heading.family.trim(), heading.category)
    } else if (
      variant.fontFamily !== undefined &&
      (variant.fontFamily === previousHeadingStack ||
        !findFont({ fonts }, firstStackFamily(variant.fontFamily)))
    ) {
      // The heading font this theme had, or a family it no longer loads.
      delete variant.fontFamily
    }
    if (Object.keys(variant).length) variants[key] = variant
    else delete variants[key]
  }
  if (Object.keys(variants).length) typography.variants = variants
  else delete typography.variants

  const next: HostTheme = { ...theme }
  if (fonts.length) next.fonts = fonts
  else delete next.fonts
  if (Object.keys(typography).length) next.typography = typography
  else delete next.typography
  return next
}

/** Sets the corner radius, or clears it with `undefined` so it inherits. */
export function writeBorderRadius(
  theme: HostTheme,
  value: number | undefined,
): HostTheme {
  if (value !== undefined && Number.isFinite(value)) {
    return { ...theme, shape: { ...theme.shape, borderRadius: value } }
  }
  const next = { ...theme }
  const shape = { ...next.shape }
  delete shape.borderRadius
  if (Object.keys(shape).length) next.shape = shape
  else delete next.shape
  return next
}

/** Sets the spacing unit; anything but a positive number clears it. */
export function writeSpacing(theme: HostTheme, value: number | undefined): HostTheme {
  const next = { ...theme }
  if (value !== undefined && Number.isFinite(value) && value > 0) next.spacing = value
  else delete next.spacing
  return next
}

/**
 * Sets one nav height — anything but a positive number clears it — and
 * rebuilds the whole toolbar mixin around both, because `mixins.toolbar`
 * replaces MUI's default rather than merging into it (AGL-1242).
 */
export function writeToolbarHeight(
  theme: HostTheme,
  breakpoint: 'xs' | 'sm',
  value: number | undefined,
): HostTheme {
  const valid = value !== undefined && Number.isFinite(value) && value > 0
  const edited = valid ? value : undefined
  const xs = breakpoint === 'xs' ? edited : readToolbarHeight(theme, 'xs')
  const sm = breakpoint === 'sm' ? edited : readToolbarHeight(theme, 'sm')
  const next = { ...theme }
  if (xs === undefined && sm === undefined) {
    delete next.mixins
    return next
  }
  next.mixins = { toolbar: buildToolbarMixin(xs, sm) }
  return next
}

/**
 * Drops the site's component overrides. With nothing stored the site renders
 * the brand's own component styles, which is what the editor's "Reset to
 * theme defaults" means.
 */
export function resetComponentOverrides(theme: HostTheme): HostTheme {
  const next = { ...theme }
  delete next.components
  return next
}

/** One leaf of a component override, as a writer names it. */
export interface ThemeComponentOverrideLeaf {
  component: HostThemeComponentKey
  /**
   * `styleOverrides` styles a slot in literal CSS; `sx` styles it in theme
   * terms, so a value may name a palette path (`primary.main`) or a spacing
   * unit (AGL-3403); `defaultProps` sets a prop's default.
   */
  target: 'styleOverrides' | 'sx' | 'defaultProps'
  /** The style slot (`root`, `contained`, `h1`); `null` for a default prop. */
  slot: string | null
  /** A camelCase CSS property, or the prop's name. */
  property: string
  /** Scopes a style to one side of the toolbar breakpoint; `null` for every width. */
  media: ThemeEditorMedia | null
  value: string | number | boolean
}

/**
 * Sets one leaf inside the site's component overrides and keeps every other
 * override the site has. The stored overrides are deep-merged over the
 * brand's own at render time, so naming one property changes that property
 * and inherits the rest of the component.
 */
export function writeComponentOverride(
  theme: HostTheme,
  leaf: ThemeComponentOverrideLeaf,
): HostTheme {
  const components = { ...theme.components }
  const entry: HostThemeComponentOverride = { ...components[leaf.component] }
  if (leaf.target === 'defaultProps') {
    entry.defaultProps = { ...entry.defaultProps, [leaf.property]: leaf.value }
  } else {
    const slot = leaf.slot ?? 'root'
    const styles: Record<string, unknown> = {
      ...(leaf.target === 'sx' ? entry.sx : entry.styleOverrides),
    }
    const slotStyles = { ...(styles[slot] as Record<string, unknown> | undefined) }
    if (leaf.media) {
      const query = THEME_EDITOR_MEDIA_QUERIES[leaf.media]
      slotStyles[query] = {
        ...(slotStyles[query] as Record<string, unknown> | undefined),
        [leaf.property]: leaf.value,
      }
    } else {
      slotStyles[leaf.property] = leaf.value
    }
    styles[slot] = slotStyles
    if (leaf.target === 'sx') {
      entry.sx = styles as HostThemeComponentOverride['sx']
    } else {
      entry.styleOverrides = styles
    }
  }
  components[leaf.component] = entry
  return { ...theme, components }
}
