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
  HostThemeScheme,
  HostThemeSchemeColors,
} from '@aglyn/shared-data-types'
import { readThemeFonts, writeThemeFonts } from '@aglyn/shared-util-tools/theme-fonts'
import {
  HOST_THEME_COMPONENT_WHITELIST,
  type HostThemeComponentKey,
} from './host-theme'

// The font read and write live in `@aglyn/shared-util-tools/theme-fonts`
// (AGL-4049), where the platform core can reach them too; every name stays
// importable from here.
export {
  firstStackFamily,
  fontFamilyStack,
  readThemeFonts,
  THEME_HEADING_VARIANTS,
  writeThemeFonts,
  type ThemeFontChoice,
  type ThemeFontSelection,
} from '@aglyn/shared-util-tools/theme-fonts'

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

/**
 * The site-wide look of components: the click-only fields in
 * {@link THEME_COMPONENT_LOOK_FIELDS}, with the full override set behind
 * them limited to the sanitizer's whitelist.
 */
export const COMPONENT_OVERRIDES_FIELD = {
  label: 'Style components',
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
  kind: 'color' | 'select' | 'number' | 'components'
  /** Edited once per scheme, under the Light and Dark tabs. */
  perScheme: boolean
  /** A color control's token. */
  token?: ThemeColorToken
  /** A select's values, or the components a components control may style. */
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
    kind: 'components',
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
 * inherits again. A palette color writes a record of `main` alone: its
 * `light`, `dark` and `contrastText` were derived from (or authored for) the
 * old `main`, and the editor offers no control for them, so a kept shade
 * would go on painting the old color (an outlined button reads `dark`) with
 * no way for the owner to see or change it. Dropped, the theme derives them
 * from the new `main`. Clearing it drops the record; a group member that
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
      if (hex) next[paletteKey] = { main: hex }
      else delete next[paletteKey]
      // An accent's tint is a wash of its old `main` for the same reason, so
      // it goes too and the theme washes one from the new color.
      const tint = next.tint as Record<string, string> | undefined
      if (tint && paletteKey in tint) {
        const rest = { ...tint }
        delete rest[paletteKey]
        if (Object.keys(rest).length) next.tint = rest as HostThemeSchemeColors['tint']
        else delete next.tint
      }
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
  return readThemeFonts(theme).body?.family ?? SYSTEM_FONT_VALUE
}

/**
 * Picks a font from {@link GOOGLE_FONT_OPTIONS}, loading it and naming it as
 * the typography's stack, or {@link SYSTEM_FONT_VALUE} to go back to the
 * theme default. A family outside the curated list changes nothing.
 */
export function writeFontFamily(theme: HostTheme, value: string): HostTheme {
  // Through writeThemeFonts (AGL-3656), so a heading font and the site's own
  // uploaded fonts survive a body font picked from the short list or by the
  // AI theme step; replacing `fonts` wholesale dropped both.
  const current = readThemeFonts(theme)
  if (value === SYSTEM_FONT_VALUE) {
    return writeThemeFonts(theme, { body: null, heading: current.heading })
  }
  const option = GOOGLE_FONT_OPTIONS.find((entry) => entry.family === value)
  if (!option) return theme
  return writeThemeFonts(theme, {
    body: {
      family: option.family,
      category: option.category,
      weights: option.weights,
      source: 'google',
    },
    heading: current.heading,
  })
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

/** Where one leaf lives, without the value it holds. */
export type ThemeComponentOverrideTarget = Omit<ThemeComponentOverrideLeaf, 'value'>

/**
 * Removes one leaf from the site's component overrides, and every slot,
 * branch and component it leaves empty, so a field set back to "Theme
 * default" stores nothing and the site inherits that property again.
 */
export function clearComponentOverride(
  theme: HostTheme,
  target: ThemeComponentOverrideTarget,
): HostTheme {
  const existing = theme.components?.[target.component]
  if (!existing) return theme
  const entry: HostThemeComponentOverride = { ...existing }
  if (target.target === 'defaultProps') {
    const props = { ...entry.defaultProps }
    delete props[target.property]
    if (Object.keys(props).length) entry.defaultProps = props
    else delete entry.defaultProps
  } else {
    const branch = target.target === 'sx' ? 'sx' : 'styleOverrides'
    const styles: Record<string, unknown> = { ...entry[branch] }
    const slot = target.slot ?? 'root'
    const slotStyles = { ...(styles[slot] as Record<string, unknown> | undefined) }
    if (target.media) {
      const query = THEME_EDITOR_MEDIA_QUERIES[target.media]
      const scoped = { ...(slotStyles[query] as Record<string, unknown> | undefined) }
      delete scoped[target.property]
      if (Object.keys(scoped).length) slotStyles[query] = scoped
      else delete slotStyles[query]
    } else {
      delete slotStyles[target.property]
    }
    if (Object.keys(slotStyles).length) styles[slot] = slotStyles
    else delete styles[slot]
    if (Object.keys(styles).length) {
      if (branch === 'sx') entry.sx = styles as HostThemeComponentOverride['sx']
      else entry.styleOverrides = styles
    } else {
      delete entry[branch]
    }
  }
  const components = { ...theme.components }
  if (Object.keys(entry).length) components[target.component] = entry
  else delete components[target.component]
  const next: HostTheme = { ...theme }
  if (Object.keys(components).length) next.components = components
  else delete next.components
  return next
}

/** The value one override leaf holds; `undefined` when the site does not set it. */
export function readComponentOverride(
  theme: HostTheme | undefined,
  target: ThemeComponentOverrideTarget,
): unknown {
  const entry = theme?.components?.[target.component]
  if (!entry) return undefined
  if (target.target === 'defaultProps') return entry.defaultProps?.[target.property]
  const styles = (target.target === 'sx' ? entry.sx : entry.styleOverrides) as
    | Record<string, unknown>
    | undefined
  const slotStyles = styles?.[target.slot ?? 'root'] as Record<string, unknown> | undefined
  if (!target.media) return slotStyles?.[target.property]
  const query = THEME_EDITOR_MEDIA_QUERIES[target.media]
  return (slotStyles?.[query] as Record<string, unknown> | undefined)?.[target.property]
}

/* ------------------------------------------------------------------------ *
 * The look of components, as click-only fields
 * ------------------------------------------------------------------------ */

/** The components the Style components card sets a site-wide look for. */
export type ThemeComponentLookGroup = 'button' | 'input' | 'card'

export const THEME_COMPONENT_LOOK_GROUPS: ReadonlyArray<{
  group: ThemeComponentLookGroup
  label: string
}> = [
  { group: 'button', label: 'Buttons' },
  { group: 'input', label: 'Form inputs' },
  { group: 'card', label: 'Cards' },
]

export type ThemeComponentLookId =
  | 'button.variant'
  | 'button.corners'
  | 'button.textCase'
  | 'button.weight'
  | 'button.padding'
  | 'input.variant'
  | 'input.corners'
  | 'input.background'
  | 'input.border'
  | 'card.variant'
  | 'card.elevation'
  | 'card.corners'

/** One choice a look field offers. */
export interface ThemeComponentLookOption {
  /** What the select holds. */
  value: string
  label: string
  /**
   * What each of the field's targets stores, in target order; one value
   * stands for every target.
   */
  stored: string | number | ReadonlyArray<string | number>
  /** A theme color this choice draws in, for its swatch. */
  token?: ThemeColorToken
}

/**
 * A click-only field over the site's component overrides. Each choice writes
 * the same leaves the Advanced overrides hold, so the two are one setting
 * seen two ways, and anything that writes override leaves can set it.
 */
export interface ThemeComponentLookField {
  id: ThemeComponentLookId
  group: ThemeComponentLookGroup
  label: string
  /** `color` choices are theme colors, shown as swatches of the scheme in view. */
  kind: 'select' | 'color'
  /** The leaves a choice sets, read back from the first. */
  targets: readonly ThemeComponentOverrideTarget[]
  /** Leaves set alongside any choice and cleared with it: what makes the choice draw right. */
  companions?: readonly ThemeComponentOverrideLeaf[]
  options: readonly ThemeComponentLookOption[]
}

/** The select's value for a field the site does not set: the theme's own look. */
export const THEME_LOOK_DEFAULT = ''
/** The select's value for a leaf set to something no choice names, by hand or by AI. */
export const THEME_LOOK_CUSTOM = '__custom__'

function lookTarget(
  component: HostThemeComponentKey,
  target: ThemeComponentOverrideLeaf['target'],
  property: string,
  slot: string | null = target === 'defaultProps' ? null : 'root',
): ThemeComponentOverrideTarget {
  return { component, target, slot, property, media: null }
}

/**
 * Corner choices, as multiples of the site's Border radius (an `sx`
 * `borderRadius` number is one), so a component follows the Shape & spacing
 * slider instead of freezing a pixel value.
 */
const CORNER_OPTIONS: readonly ThemeComponentLookOption[] = [
  { value: 'square', label: 'Square', stored: 0 },
  { value: 'subtle', label: 'Half the site radius', stored: 0.5 },
  { value: 'site', label: 'The site radius', stored: 1 },
  { value: 'rounded', label: 'Twice the site radius', stored: 2 },
  { value: 'extra', label: 'Three times the site radius', stored: 3 },
]
const PILL_OPTION: ThemeComponentLookOption = { value: 'pill', label: 'Pill', stored: '999px' }

/**
 * Every component look field, in the order the card shows them.
 *
 * Inputs style both of MUI's boxes: `MuiOutlinedInput` and `MuiFilledInput`,
 * because the Input style choice picks between them and the other choices
 * have to hold whichever is in use. A border color sets the outlined box's
 * own border, which the Besigner's Input element draws, and the notched
 * outline a stock text field draws.
 */
export const THEME_COMPONENT_LOOK_FIELDS: readonly ThemeComponentLookField[] = [
  {
    id: 'button.variant',
    group: 'button',
    label: 'Button style',
    kind: 'select',
    targets: [lookTarget('MuiButton', 'defaultProps', 'variant')],
    options: [
      { value: 'contained', label: 'Filled', stored: 'contained' },
      { value: 'outlined', label: 'Outlined', stored: 'outlined' },
      { value: 'text', label: 'Text only', stored: 'text' },
    ],
  },
  {
    id: 'button.corners',
    group: 'button',
    label: 'Button corners',
    kind: 'select',
    targets: [lookTarget('MuiButton', 'sx', 'borderRadius')],
    options: [...CORNER_OPTIONS, PILL_OPTION],
  },
  {
    id: 'button.textCase',
    group: 'button',
    label: 'Button text case',
    kind: 'select',
    targets: [lookTarget('MuiButton', 'styleOverrides', 'textTransform')],
    options: [
      { value: 'none', label: 'As typed', stored: 'none' },
      { value: 'uppercase', label: 'UPPERCASE', stored: 'uppercase' },
      { value: 'capitalize', label: 'Capitalize Each Word', stored: 'capitalize' },
    ],
  },
  {
    id: 'button.weight',
    group: 'button',
    label: 'Button text weight',
    kind: 'select',
    targets: [lookTarget('MuiButton', 'styleOverrides', 'fontWeight')],
    options: [
      { value: '400', label: 'Regular', stored: 400 },
      { value: '500', label: 'Medium', stored: 500 },
      { value: '600', label: 'Semibold', stored: 600 },
      { value: '700', label: 'Bold', stored: 700 },
    ],
  },
  {
    id: 'button.padding',
    group: 'button',
    label: 'Button padding',
    kind: 'select',
    // Spacing units, so padding follows the site's Spacing unit.
    targets: [lookTarget('MuiButton', 'sx', 'px'), lookTarget('MuiButton', 'sx', 'py')],
    options: [
      { value: 'compact', label: 'Compact', stored: [1.5, 0.5] },
      { value: 'comfortable', label: 'Comfortable', stored: [2, 0.75] },
      { value: 'roomy', label: 'Roomy', stored: [3, 1] },
      { value: 'wide', label: 'Wide', stored: [4, 1.25] },
    ],
  },
  {
    id: 'input.variant',
    group: 'input',
    label: 'Input style',
    kind: 'select',
    targets: [lookTarget('MuiTextField', 'defaultProps', 'variant')],
    options: [
      { value: 'outlined', label: 'Outlined', stored: 'outlined' },
      { value: 'filled', label: 'Filled', stored: 'filled' },
    ],
  },
  {
    id: 'input.corners',
    group: 'input',
    label: 'Input corners',
    kind: 'select',
    targets: [
      lookTarget('MuiOutlinedInput', 'sx', 'borderRadius'),
      lookTarget('MuiFilledInput', 'sx', 'borderRadius'),
    ],
    // A filled box's underline runs edge to edge; clipping it to the corners
    // keeps it inside a rounded box.
    companions: [{ ...lookTarget('MuiFilledInput', 'styleOverrides', 'overflow'), value: 'hidden' }],
    options: [...CORNER_OPTIONS, PILL_OPTION],
  },
  {
    id: 'input.background',
    group: 'input',
    label: 'Input background',
    kind: 'color',
    targets: [
      lookTarget('MuiOutlinedInput', 'sx', 'bgcolor'),
      lookTarget('MuiFilledInput', 'sx', 'bgcolor'),
    ],
    options: [
      { value: 'transparent', label: 'None', stored: 'transparent' },
      { value: 'paper', label: 'Paper', stored: 'background.paper', token: 'background.paper' },
      {
        value: 'background',
        label: 'Background',
        stored: 'background.default',
        token: 'background.default',
      },
      { value: 'tintPrimary', label: 'Primary tint', stored: 'tint.primary', token: 'tint.primary' },
      {
        value: 'tintSecondary',
        label: 'Secondary tint',
        stored: 'tint.secondary',
        token: 'tint.secondary',
      },
      {
        value: 'tintTertiary',
        label: 'Tertiary tint',
        stored: 'tint.tertiary',
        token: 'tint.tertiary',
      },
    ],
  },
  {
    id: 'input.border',
    group: 'input',
    label: 'Input border color',
    kind: 'color',
    targets: [
      lookTarget('MuiOutlinedInput', 'sx', 'borderColor'),
      lookTarget('MuiOutlinedInput', 'sx', 'borderColor', 'notchedOutline'),
    ],
    options: [
      { value: 'divider', label: 'Divider', stored: 'divider', token: 'divider' },
      {
        value: 'textSecondary',
        label: 'Secondary text',
        stored: 'text.secondary',
        token: 'text.secondary',
      },
      { value: 'text', label: 'Text', stored: 'text.primary', token: 'text.primary' },
      { value: 'primary', label: 'Primary', stored: 'primary.main', token: 'primary' },
      { value: 'secondary', label: 'Secondary', stored: 'secondary.main', token: 'secondary' },
      { value: 'tertiary', label: 'Tertiary', stored: 'tertiary.main', token: 'tertiary' },
    ],
  },
  {
    id: 'card.variant',
    group: 'card',
    label: 'Card style',
    kind: 'select',
    targets: [lookTarget('MuiCard', 'defaultProps', 'variant')],
    options: [
      { value: 'elevation', label: 'Shadow', stored: 'elevation' },
      { value: 'outlined', label: 'Outline', stored: 'outlined' },
    ],
  },
  {
    id: 'card.elevation',
    group: 'card',
    label: 'Card shadow depth',
    kind: 'select',
    targets: [lookTarget('MuiCard', 'defaultProps', 'elevation')],
    options: [
      { value: '0', label: 'Flat', stored: 0 },
      { value: '1', label: 'Soft', stored: 1 },
      { value: '3', label: 'Medium', stored: 3 },
      { value: '8', label: 'Strong', stored: 8 },
    ],
  },
  {
    id: 'card.corners',
    group: 'card',
    label: 'Card corners',
    kind: 'select',
    targets: [lookTarget('MuiCard', 'sx', 'borderRadius')],
    options: CORNER_OPTIONS,
  },
]

/** The catalog entry for a look field id. */
export function themeComponentLookField(id: ThemeComponentLookId): ThemeComponentLookField {
  const field = THEME_COMPONENT_LOOK_FIELDS.find((entry) => entry.id === id)
  if (!field) throw new Error(`unknown component look field ${id}`)
  return field
}

function storedFor(option: ThemeComponentLookOption, index: number) {
  return Array.isArray(option.stored)
    ? (option.stored as ReadonlyArray<string | number>)[index]
    : (option.stored as string | number)
}

/**
 * A look field as its select shows it: the choice the site's overrides hold,
 * {@link THEME_LOOK_DEFAULT} when they set nothing, or
 * {@link THEME_LOOK_CUSTOM} when they set a value no choice names.
 */
export function readComponentLook(
  theme: HostTheme | undefined,
  field: ThemeComponentLookField,
): string {
  const values = field.targets.map((target) => readComponentOverride(theme, target))
  if (values.every((value) => value === undefined)) return THEME_LOOK_DEFAULT
  const match = field.options.find((option) =>
    values.every((value, index) => value === storedFor(option, index)),
  )
  return match ? match.value : THEME_LOOK_CUSTOM
}

/**
 * Sets a look field to one of its choices, or back to the theme's own look
 * with {@link THEME_LOOK_DEFAULT}, which clears every leaf it sets. Any other
 * value changes nothing.
 */
export function writeComponentLook(
  theme: HostTheme,
  field: ThemeComponentLookField,
  value: string,
): HostTheme {
  if (value === THEME_LOOK_DEFAULT) {
    let next = theme
    for (const target of [...field.targets, ...(field.companions ?? [])]) {
      next = clearComponentOverride(next, target)
    }
    return next
  }
  const option = field.options.find((entry) => entry.value === value)
  if (!option) return theme
  let next = theme
  field.targets.forEach((target, index) => {
    next = writeComponentOverride(next, { ...target, value: storedFor(option, index) })
  })
  for (const companion of field.companions ?? []) next = writeComponentOverride(next, companion)
  return next
}
