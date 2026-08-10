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
 */
export const HOST_THEME_COMPONENT_WHITELIST = [
  'MuiAppBar',
  'MuiAvatar',
  'MuiBadge',
  'MuiButton',
  'MuiButtonBase',
  'MuiCard',
  'MuiCardContent',
  'MuiCheckbox',
  'MuiChip',
  'MuiCircularProgress',
  'MuiDivider',
  'MuiIconButton',
  'MuiLinearProgress',
  'MuiLink',
  'MuiList',
  'MuiListItem',
  'MuiMenu',
  'MuiPaper',
  'MuiRadio',
  'MuiSlider',
  'MuiSwitch',
  'MuiTab',
  'MuiTabs',
  'MuiTextField',
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
    if (Object.keys(entry).length) sanitized[key] = entry
  }
  return Object.keys(sanitized).length ? sanitized : undefined
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
  return sanitized
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
    options.components = sanitized.components as ThemeOptions['components']
  }
  // Toolbar height is only reachable here (AGL-1242). MUI derives the
  // Toolbar's `regular` variant style from `mixins.toolbar` and applies it
  // AFTER `components.MuiToolbar.styleOverrides`, so the slot override loses
  // every time — its nested media queries do not even emit.
  if (sanitized.mixins?.toolbar) {
    options.mixins = { toolbar: sanitized.mixins.toolbar }
  }

  return options
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

  return merged
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
 * True when the host has actually AUTHORED dark colours (AGL-1292).
 *
 * Distinct from `hasHostTheme`, and the distinction is the whole point: a host
 * that sets only fonts and a border radius "has a theme", but it has no dark
 * DESIGN. Rendering it dark leaves the base theme's palette showing through
 * the merge — white text over the light backgrounds the site's content
 * hard-codes.
 *
 * An empty `colorSchemes.dark` object does not count. It is what a partially
 * filled editor form produces, and it carries no colours to render with.
 */
export function hasDarkScheme(theme: HostTheme | undefined): boolean {
  const dark = theme?.colorSchemes?.dark
  return !!dark && Object.keys(dark).length > 0
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
