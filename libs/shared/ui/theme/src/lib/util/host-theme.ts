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
  HostThemeComponentVariant,
  HostThemeFont,
  HostThemePaletteColor,
  HostThemeScheme,
  HostThemeSchemeColors,
} from '@aglyn/shared-data-types'
import { objectDeepMergeReplaceArrays } from '@aglyn/shared-util-vendor'
import type { PaletteOptions, ThemeOptions } from '../../vendor/mui'

/**
 * Components a host theme may override. Persisted overrides are plain JSON;
 * anything outside this list is dropped by {@link sanitizeHostTheme} so a
 * tampered document can't restyle console-internal or portal-critical
 * components.
 *
 * The list is what a site actually renders — its elements, the forms, booking
 * and commerce surfaces, and the dialogs and menus they open — so a theme can
 * restyle a whole site rather than its buttons alone (AGL-3403). Layout
 * primitives (`MuiContainer`, `MuiGrid`, `MuiStack`, `MuiBox`) are absent on
 * purpose: they carry the page structure, and a theme that reflowed them
 * would break layouts the Besigner drew.
 */
export const HOST_THEME_COMPONENT_WHITELIST = [
  'MuiAccordion',
  'MuiAccordionDetails',
  'MuiAccordionSummary',
  'MuiAlert',
  'MuiAlertTitle',
  'MuiAppBar',
  'MuiAvatar',
  'MuiBadge',
  'MuiBreadcrumbs',
  'MuiButton',
  'MuiButtonBase',
  'MuiButtonGroup',
  'MuiCard',
  'MuiCardActions',
  'MuiCardContent',
  'MuiCardHeader',
  'MuiCheckbox',
  'MuiChip',
  'MuiCircularProgress',
  'MuiDialog',
  'MuiDialogActions',
  'MuiDialogContent',
  'MuiDialogTitle',
  'MuiDivider',
  'MuiDrawer',
  'MuiFab',
  'MuiFilledInput',
  'MuiFormControlLabel',
  'MuiFormHelperText',
  'MuiFormLabel',
  'MuiIconButton',
  'MuiInput',
  'MuiInputBase',
  'MuiInputLabel',
  'MuiLinearProgress',
  'MuiLink',
  'MuiList',
  'MuiListItem',
  'MuiListItemButton',
  'MuiMenu',
  'MuiMenuItem',
  'MuiOutlinedInput',
  'MuiPagination',
  'MuiPaginationItem',
  'MuiPaper',
  'MuiRadio',
  'MuiRating',
  'MuiSelect',
  'MuiSlider',
  'MuiSnackbarContent',
  'MuiSwitch',
  'MuiTab',
  'MuiTable',
  'MuiTableCell',
  'MuiTableHead',
  'MuiTableRow',
  'MuiTabs',
  'MuiTextField',
  'MuiToggleButton',
  'MuiToggleButtonGroup',
  'MuiToolbar',
  'MuiTooltip',
  'MuiTypography',
] as const

export type HostThemeComponentKey =
  (typeof HOST_THEME_COMPONENT_WHITELIST)[number]

const componentWhitelist: ReadonlySet<string> = new Set(
  HOST_THEME_COMPONENT_WHITELIST,
)

function pickPaletteColor(color: HostThemePaletteColor | undefined) {
  if (!color?.main) return undefined
  const picked: HostThemePaletteColor = { main: color.main }
  if (color.light) picked.light = color.light
  if (color.dark) picked.dark = color.dark
  if (color.contrastText) picked.contrastText = color.contrastText
  return picked
}

function schemeColorsToPaletteOptions(
  scheme: HostThemeScheme,
  colors: HostThemeSchemeColors | undefined,
): PaletteOptions {
  const palette: PaletteOptions = { mode: scheme }
  if (!colors) return palette

  const colorKeys = [
    'primary',
    'secondary',
    'tertiary',
    'surface',
    'error',
    'warning',
    'info',
    'success',
  ] as const
  for (const key of colorKeys) {
    const color = pickPaletteColor(colors[key])
    if (color) (palette as Record<string, unknown>)[key] = color
  }

  if (colors.background?.default || colors.background?.paper) {
    palette.background = {
      ...(colors.background.default && { default: colors.background.default }),
      ...(colors.background.paper && { paper: colors.background.paper }),
    }
  }
  if (
    colors.text?.primary ||
    colors.text?.secondary ||
    colors.text?.disabled
  ) {
    palette.text = {
      ...(colors.text.primary && { primary: colors.text.primary }),
      ...(colors.text.secondary && { secondary: colors.text.secondary }),
      ...(colors.text.disabled && { disabled: colors.text.disabled }),
    }
  }
  // Tints are string leaves, not a PaletteColor, so they pass through the
  // same "copy what was set" path as `background`/`text` rather than
  // `pickPaletteColor` — which requires a `main` a tint does not have
  // (AGL-1244).
  if (colors.tint?.primary || colors.tint?.secondary || colors.tint?.tertiary) {
    palette.tint = {
      ...(colors.tint.primary && { primary: colors.tint.primary }),
      ...(colors.tint.secondary && { secondary: colors.tint.secondary }),
      ...(colors.tint.tertiary && { tertiary: colors.tint.tertiary }),
    }
  }
  if (colors.divider) palette.divider = colors.divider

  return palette
}

function sanitizeComponents(
  components: Record<string, HostThemeComponentOverride> | undefined,
) {
  if (!components) return undefined
  const sanitized: Record<string, HostThemeComponentOverride> = {}
  for (const [key, override] of Object.entries(components)) {
    if (!componentWhitelist.has(key) || !override) continue
    const entry: HostThemeComponentOverride = {}
    if (override.defaultProps) entry.defaultProps = override.defaultProps
    if (override.styleOverrides) entry.styleOverrides = override.styleOverrides
    const sx = sanitizeSlotStyles(override.sx)
    if (sx) entry.sx = sx
    const variants = sanitizeVariants(override.variants)
    if (variants) entry.variants = variants
    if (Object.keys(entry).length) sanitized[key] = entry
  }
  return Object.keys(sanitized).length ? sanitized : undefined
}

/** `sx` slots: each a style object, anything else dropped. */
function sanitizeSlotStyles(
  slots: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (!isPlainObject(slots)) return undefined
  const kept: Record<string, Record<string, unknown>> = {}
  for (const [slot, style] of Object.entries(slots)) {
    if (isPlainObject(style)) kept[slot] = style
  }
  return Object.keys(kept).length ? kept : undefined
}

/**
 * Variants that can match and style something: a props object of scalars
 * and a style or an `sx`. A malformed entry is dropped rather than handed to
 * MUI, whose variant loop reads `props` and would throw on a missing one.
 */
function sanitizeVariants(
  variants: unknown,
): HostThemeComponentVariant[] | undefined {
  if (!Array.isArray(variants)) return undefined
  const kept: HostThemeComponentVariant[] = []
  for (const variant of variants) {
    if (!isPlainObject(variant) || !isPlainObject(variant['props'])) continue
    const props = variant['props'] as Record<string, unknown>
    if (
      Object.values(props).some(
        (value) =>
          value !== null &&
          !['string', 'number', 'boolean'].includes(typeof value),
      )
    ) {
      continue
    }
    const entry: HostThemeComponentVariant = {
      props: props as HostThemeComponentVariant['props'],
    }
    if (isPlainObject(variant['style'])) entry.style = variant['style']
    if (isPlainObject(variant['sx'])) entry.sx = variant['sx']
    if (entry.style || entry.sx) kept.push(entry)
  }
  return kept.length ? kept : undefined
}

/** The theme a style function is handed, as far as `sx` needs it. */
type SxTheme = { unstable_sx?: (style: unknown) => unknown }

/**
 * An `sx` object as a style function of the theme it renders under.
 *
 * `components` are read against the BUILT theme of each scheme, so a palette
 * path resolves to that scheme's color: `borderColor: 'divider'` is the light
 * divider on light and the dark one on dark, which is the thing a literal
 * override cannot say.
 */
function sxStyle(sx: Record<string, unknown>) {
  return ({ theme }: { theme: SxTheme }) =>
    theme?.unstable_sx ? theme.unstable_sx(sx) : sx
}

/**
 * The stored (JSON) components as MUI reads them: each `sx` slot joins its
 * literal `styleOverrides` slot, literal first, and each variant's `sx`
 * becomes a style function.
 */
function componentsToThemeOptions(
  components: Record<string, HostThemeComponentOverride>,
): NonNullable<ThemeOptions['components']> {
  const converted: Record<string, Record<string, unknown>> = {}
  for (const [key, override] of Object.entries(components)) {
    const entry: Record<string, unknown> = {}
    if (override.defaultProps) entry['defaultProps'] = override.defaultProps
    const slots = new Set([
      ...Object.keys(override.styleOverrides ?? {}),
      ...Object.keys(override.sx ?? {}),
    ])
    if (slots.size) {
      const styleOverrides: Record<string, unknown> = {}
      for (const slot of slots) {
        const literal = override.styleOverrides?.[slot]
        const sx = override.sx?.[slot]
        styleOverrides[slot] =
          sx && literal !== undefined
            ? [literal, sxStyle(sx)]
            : sx
              ? sxStyle(sx)
              : literal
      }
      entry['styleOverrides'] = styleOverrides
    }
    if (override.variants?.length) {
      entry['variants'] = override.variants.map(({ props, style, sx }) => ({
        props,
        style: sx
          ? (context: { theme: SxTheme }) => [
              style ?? {},
              sxStyle(sx)(context),
            ]
          : style,
      }))
    }
    converted[key] = entry
  }
  return converted as NonNullable<ThemeOptions['components']>
}

/**
 * Strips unknown component overrides and empty branches from a persisted
 * host theme. Returns a new object; the input is never mutated.
 */
export function sanitizeHostTheme(theme: HostTheme | undefined): HostTheme {
  if (!theme) return {}
  const sanitized: HostTheme = { ...theme }
  const components = sanitizeComponents(theme.components)
  if (components) sanitized.components = components
  else delete sanitized.components
  // `mixins.toolbar` must be a CSS object; a scalar would reach
  // `createTheme` and throw while building the Toolbar variant.
  if (isPlainObject(theme.mixins?.toolbar)) {
    sanitized.mixins = { toolbar: theme.mixins.toolbar }
  } else {
    delete sanitized.mixins
  }
  // Absent already means "follows the visitor", so only the opt-out is worth
  // persisting; anything else (a stale `'auto'`, junk) is dropped.
  if (theme.darkScheme !== 'off') delete sanitized.darkScheme
  return sanitized
}

/** An `@media` key that names a `min-width`, and the width it names. */
const MIN_WIDTH_AT_RULE = /^@media\b[^{]*\bmin-width\s*:\s*(\d+(?:\.\d+)?)\s*px/

/**
 * Re-orders breakpoint at-rules ascending, so STORED key order cannot decide
 * which rule wins (AGL-3146).
 *
 * Two `min-width` rules of equal specificity both match a wide window, so the
 * later one wins — which makes key order a rendering decision. Firestore does
 * not preserve it: one stored toolbar mixin came back sm, landscape, base to
 * the server reader and landscape, base, sm to the browser, so aglyn.com's
 * nav drew 48px live and 72px on the besigner canvas from a single saved
 * document. The editor and the page disagreed about a value neither of them
 * had changed.
 *
 * Ascending is the order MUI writes its own breakpoint styles in and the
 * order the theme editor writes a toolbar mixin in: the wider query is the
 * more specific answer, so it belongs last.
 *
 * Only two things move. Plain declarations are hoisted ahead of the blocks,
 * keeping their order among themselves — which is where the style engine
 * emits them anyway, since a nested block becomes a rule of its own after the
 * base one, and where the shorthand/longhand hazard lives. Breakpoint rules
 * are sorted into the slots the blocks already occupy, so a nested selector
 * or a condition naming no width never changes position against one another.
 *
 * Returns its input by identity when no order changes, which is every theme
 * with at most one breakpoint rule per object.
 */
export function orderMediaWidths<T>(value: T): T {
  if (Array.isArray(value)) {
    let moved = false
    const next = value.map((entry) => {
      const ordered = orderMediaWidths(entry)
      if (ordered !== entry) moved = true
      return ordered
    })
    return (moved ? next : value) as T
  }
  if (!isPlainObject(value)) return value

  const source = value as Record<string, unknown>
  const keys = Object.keys(source)
  const declarations = keys.filter((key) => !isPlainObject(source[key]))
  const blocks = keys.filter((key) => isPlainObject(source[key]))
  const widthSlots: number[] = []
  const widths: Array<{ key: string; width: number }> = []
  blocks.forEach((key, index) => {
    const match = MIN_WIDTH_AT_RULE.exec(key)
    if (!match) return
    widthSlots.push(index)
    widths.push({ key, width: Number.parseFloat(match[1]) })
  })
  // A stable sort, so two rules at the same width keep the order they were
  // stored in — there is nothing to prefer between them.
  const sorted = [...widths].sort((a, b) => a.width - b.width)
  widthSlots.forEach((slot, position) => {
    blocks[slot] = sorted[position].key
  })

  const order = [...declarations, ...blocks]
  let moved = order.some((key, index) => key !== keys[index])
  const next: Record<string, unknown> = {}
  for (const key of order) {
    const child = orderMediaWidths(source[key])
    if (child !== source[key]) moved = true
    next[key] = child
  }
  return (moved ? next : value) as T
}

/**
 * Converts a persisted {@link HostTheme} document into MUI `ThemeOptions`
 * for one color scheme. The result is meant to be passed through
 * `createResponsiveTheme` (or `createTheme`) by the consumer; shade and
 * contrast-text derivation for partial palettes is MUI's job, so only
 * explicitly set values are forwarded.
 */
export function hostThemeToThemeOptions(
  theme: HostTheme | undefined,
  scheme: HostThemeScheme,
): ThemeOptions {
  const sanitized = sanitizeHostTheme(theme)
  const options: ThemeOptions = {
    palette: schemeColorsToPaletteOptions(
      scheme,
      sanitized.colorSchemes?.[scheme],
    ),
  }

  const { typography } = sanitized
  if (typography?.fontFamily || typography?.variants) {
    // HostThemeTypographyVariant is a sanitized subset of MUI's
    // TypographyStyleOptions; the missing index signature is by design.
    options.typography = {
      ...(typography.fontFamily && { fontFamily: typography.fontFamily }),
      ...typography.variants,
    } as ThemeOptions['typography']
  }

  if (typeof sanitized.shape?.borderRadius === 'number') {
    options.shape = { borderRadius: sanitized.shape.borderRadius }
  }
  if (typeof sanitized.spacing === 'number') {
    options.spacing = sanitized.spacing
  }
  if (sanitized.components) {
    // Ordered BEFORE conversion: an `sx` object ends up inside a closure,
    // where the pass over the finished options below cannot reach it.
    options.components = componentsToThemeOptions(
      orderMediaWidths(sanitized.components),
    )
  }
  // Toolbar height is only reachable here (AGL-1242). MUI derives the
  // Toolbar's `regular` variant style from `mixins.toolbar` and applies it
  // AFTER `components.MuiToolbar.styleOverrides`, so the slot override loses
  // every time — its nested media queries do not even emit.
  if (sanitized.mixins?.toolbar) {
    options.mixins = { toolbar: sanitized.mixins.toolbar }
  }

  // Every surface that renders a site's theme arrives here — the tenant's
  // provider, the besigner canvas, Preview, the theme editor — so this is
  // where a stored document stops being able to resolve differently for
  // different readers (AGL-3146).
  return orderMediaWidths(options)
}

/**
 * Layers a host's overrides ONTO a base set of theme options (AGL-1180).
 *
 * `hostThemeToThemeOptions` deliberately emits only what the host explicitly
 * set, so building a theme from it alone leaves every other slot to MUI's
 * stock palette. Consumers used to switch — console theme when the document
 * was empty, host document when it was not — which meant setting a single
 * value (the spec's own example is `{ spacing: 8 }`) silently repainted
 * secondary, tertiary, surface, info, success, warning, error, background
 * and paper in MUI blue/purple. Merging instead of switching keeps the brand
 * as the floor no matter how much the host customizes.
 *
 * `palette` merges one level deep so overriding `primary` cannot drop
 * `secondary`. Within a single colour the override replaces the whole record
 * — MUI derives shades and contrast text from `main`, which is exactly the
 * partial-palette behaviour the converter is written for.
 */
export function mergeThemeOptions(
  base: ThemeOptions,
  overrides: ThemeOptions,
): ThemeOptions {
  const merged: ThemeOptions = { ...base, ...overrides }

  // Palette merges ONE level: overriding a colour replaces its whole record
  // so MUI re-derives light/dark/contrastText from the new `main`, which is
  // the partial-palette behaviour the converter is written for. Overriding
  // `primary` still must not disturb `secondary`, hence the level.
  merged.palette = { ...base.palette, ...overrides.palette }
  merged.shape = { ...base.shape, ...overrides.shape }
  // Same reasoning as `palette`: setting `toolbar` must not drop any other
  // mixin the base defines.
  merged.mixins = { ...base.mixins, ...overrides.mixins }

  // `typography` is an object in every base we ship, but MUI's type also
  // allows a function of the palette — merging into that would silently drop
  // the base, so prefer the override wholesale in that case.
  if (
    isPlainObject(base.typography) &&
    isPlainObject(overrides.typography)
  ) {
    merged.typography = objectDeepMergeReplaceArrays(
      base.typography,
      overrides.typography,
    ) as ThemeOptions['typography']
  }

  // Components merge DEEPLY. A host override names one component, and often
  // one property inside it — `MuiButton.defaultProps.color`. A shallow merge
  // would swap out the entire `MuiButton` entry and take the brand's
  // `styleOverrides` with it, and those styles are frequently FUNCTIONS of
  // the theme that JSON cannot express, so the editor could not put them
  // back even in principle. Deep-merging means you override the leaf you
  // named and inherit everything else, functions included.
  merged.components = objectDeepMergeReplaceArrays(
    base.components ?? {},
    overrides.components ?? {},
  ) as ThemeOptions['components']
  composeComponentStyles(merged.components, base.components, overrides.components)

  return merged
}

type ComponentOptions = {
  styleOverrides?: Record<string, unknown>
  variants?: unknown[]
}

/** A slot's styles as a list MUI resolves in order (its `processStyle` flattens arrays). */
function styleList(style: unknown): unknown[] {
  return Array.isArray(style) ? style : [style]
}

/**
 * Where a deep merge would REPLACE styling rather than add to it, composes
 * the two instead (AGL-3403).
 *
 * A deep merge merges two style OBJECTS key by key, which is right. But the
 * base styles several slots with a FUNCTION of the theme — `MuiButton.root`
 * carries the accent-text contrast fix — and merging an object onto a
 * function keeps only the object. So a theme that set one property on the
 * button root silently removed the fix, and nothing JSON can say could put it
 * back. MUI accepts a list per slot and applies it in order, so a function on
 * either side makes the slot `[base, override]`: the override still wins
 * every property it names, and everything else the base did still happens.
 *
 * `variants` concatenate for the same reason: the base's outlined
 * `IconButton` must not disappear because a theme styled its `small` size.
 */
function composeComponentStyles(
  merged: ThemeOptions['components'],
  base: ThemeOptions['components'],
  overrides: ThemeOptions['components'],
): void {
  if (!merged || !base || !overrides) return
  const target = merged as Record<string, ComponentOptions>
  for (const [name, override] of Object.entries(
    overrides as Record<string, ComponentOptions>,
  )) {
    const from = (base as Record<string, ComponentOptions>)[name]
    if (!from || !override) continue
    for (const [slot, style] of Object.entries(override.styleOverrides ?? {})) {
      const baseStyle = from.styleOverrides?.[slot]
      if (baseStyle === undefined) continue
      if (isPlainObject(baseStyle) && isPlainObject(style)) continue
      target[name].styleOverrides = {
        ...target[name].styleOverrides,
        [slot]: [...styleList(baseStyle), ...styleList(style)],
      }
    }
    if (Array.isArray(from.variants) && Array.isArray(override.variants)) {
      target[name].variants = [...from.variants, ...override.variants]
    }
  }
}

/** Plain data object — not an array, function, or class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  )
}

/** True when the document customizes anything, i.e. consumers should build a theme from it rather than using their default. */
export function hasHostTheme(theme: HostTheme | undefined): theme is HostTheme {
  return !!theme && Object.keys(theme).length > 0
}

/**
 * Builds a Google Fonts CSS2 stylesheet URL for the theme's loadable fonts.
 * Returns undefined when nothing needs loading (system/absent fonts).
 */
export function getGoogleFontsUrl(fonts: Array<HostThemeFont> | undefined) {
  const families = (fonts ?? [])
    .filter((font) => font.family && (font.source ?? 'google') === 'google')
    .map((font) => {
      const family = font.family.trim().replace(/\s+/g, '+')
      const weights = font.weights?.length
        ? `:wght@${[...font.weights].sort((a, b) => a - b).join(';')}`
        : ''
      return `family=${family}${weights}`
    })
  if (!families.length) return undefined
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}

export default hostThemeToThemeOptions
