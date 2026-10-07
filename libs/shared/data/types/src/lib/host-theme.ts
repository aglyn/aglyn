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
 * Persisted host theme document types.
 *
 * These are plain-JSON (Firestore round-trippable) descriptions of a MUI
 * theme. They intentionally carry no MUI imports so data-scope libs can
 * depend on them; `@aglyn/shared-ui-theme` owns the conversion into runtime
 * `ThemeOptions`.
 */

export type HostThemeScheme = 'light' | 'dark'

export interface HostThemePaletteColor {
  main: string
  light?: string
  dark?: string
  contrastText?: string
}

/**
 * Pale washes of the three accents, used as SURFACES (AGL-1244).
 *
 * Deliberately NOT a {@link HostThemePaletteColor}: a tint has no ramp and no
 * `contrastText`, because it is never a component `color`. It is the fill
 * behind an icon that is already `primary.dark` / `secondary.main` /
 * `tertiary.main`, so its members are named after the accent they belong to
 * rather than after a shade. Same shape as `background` and `text` — a group
 * of string leaves — which is why the theme editor reads and writes it
 * through the same path-based fields.
 */
export interface HostThemeTintColors {
  primary?: string
  secondary?: string
  tertiary?: string
}

/** Palette color keys supported per scheme, including repo-custom ones. */
export interface HostThemeSchemeColors {
  primary?: HostThemePaletteColor
  secondary?: HostThemePaletteColor
  tertiary?: HostThemePaletteColor
  surface?: HostThemePaletteColor
  error?: HostThemePaletteColor
  warning?: HostThemePaletteColor
  info?: HostThemePaletteColor
  success?: HostThemePaletteColor
  background?: {
    default?: string
    paper?: string
  }
  text?: {
    primary?: string
    secondary?: string
    disabled?: string
  }
  tint?: HostThemeTintColors
  divider?: string
}

/**
 * The generic family a font belongs to, which picks the local face its
 * metric-matched fallback is drawn from (Arial, Times New Roman or Courier
 * New) and the generic keyword its stack ends on.
 */
export type HostThemeFontCategory =
  | 'sans-serif'
  | 'serif'
  | 'monospace'
  | 'display'
  | 'handwriting'

/**
 * A font's vertical metrics and average character width, in font units, read
 * from the font file itself. A published page sizes a local fallback face to
 * these (`size-adjust` and the ascent, descent and line-gap overrides), so the
 * text the visitor reads before the web font arrives occupies the same box and
 * nothing moves when it swaps in.
 */
export interface HostThemeFontMetrics {
  unitsPerEm: number
  /** Positive, above the baseline. */
  ascent: number
  /** Negative, below the baseline. */
  descent: number
  lineGap: number
  /** Advance width averaged over English text, weighted by letter frequency. */
  xWidthAvg: number
}

/**
 * One face of a font a site uploaded to its media library (`source:
 * 'custom'`): a WOFF2 file the installer converted and subset, addressed as a
 * media reference so the page serves it from the site's own origin.
 */
export interface HostThemeFontFace {
  weight: number
  style: 'normal' | 'italic'
  /** A `media:` reference to the WOFF2 file. */
  src: string
  /** The file's content hash, which versions its URL so caches keep it a year. */
  version?: string
  /** The code points the file covers, as a CSS `unicode-range`. */
  unicodeRange?: string
}

export interface HostThemeFont {
  /** Font family name, e.g. "Inter". */
  family: string
  weights?: Array<number>
  /** Italic weights to load as true italics rather than a slanted upright. */
  italics?: Array<number>
  /**
   * Where the tenant loads the font from; system fonts need no loading, and
   * `custom` faces are files in the site's own media library.
   */
  source?: 'google' | 'system' | 'custom'
  category?: HostThemeFontCategory
  /** Read from the file; absent for a Google family, whose metrics are catalogued. */
  metrics?: HostThemeFontMetrics
  /** The uploaded faces of a `custom` font. */
  faces?: Array<HostThemeFontFace>
}

/**
 * The text styles a theme can set: MUI's own, plus the four the platform adds
 * (AGL-3411) — `displayXl`, the rung above `h1`, and the `lede`, `bodyCompact`
 * and `micro` body rungs (17/13/11px in the platform theme). Leaving one out
 * of a theme keeps the platform's own definition, so a theme that restyles
 * every heading but not these renders them in the platform's font and weights.
 */
export type HostThemeTypographyVariantKey =
  | 'displayXl'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'subtitle1'
  | 'subtitle2'
  | 'body1'
  | 'body2'
  | 'button'
  | 'caption'
  | 'overline'
  | 'lede'
  | 'bodyCompact'
  | 'micro'

export interface HostThemeTypographyVariant {
  fontFamily?: string
  fontSize?: string | number
  fontWeight?: number
  lineHeight?: string | number
  letterSpacing?: string | number
  textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase'
}

export interface HostThemeTypography {
  /** CSS font-family stack applied theme-wide. */
  fontFamily?: string
  variants?: {
    [P in HostThemeTypographyVariantKey]?: HostThemeTypographyVariant
  }
}

/**
 * A style a component takes only when its props match (MUI's theme
 * `variants`), e.g. `{ props: { variant: 'outlined' }, sx: { borderWidth: 2 } }`.
 *
 * `style` is literal CSS and `sx` is resolved against the theme, the same
 * split {@link HostThemeComponentOverride} makes between `styleOverrides` and
 * `sx`. Either or both.
 */
export interface HostThemeComponentVariant {
  /** Every prop named must equal the value given for the style to apply. */
  props: Record<string, string | number | boolean | null>
  style?: Record<string, unknown>
  sx?: Record<string, unknown>
}

/**
 * Plain-JSON component override. Functions are not representable by design,
 * so the theme-dependent half of MUI's component API is expressed as data:
 *
 * - `defaultProps` — MUI's own.
 * - `styleOverrides` — slot name → literal CSS object, MUI's own. `padding:
 *   8` is 8px.
 * - `sx` — slot name → an `sx` object, resolved against the site's theme per
 *   scheme: palette paths (`borderColor: 'divider'`, `bgcolor:
 *   'primary.main'`), spacing units (`px: 2`), radius multiples
 *   (`borderRadius: 2`), shadow indices (`boxShadow: 3`) and whole type
 *   variants (`typography: 'button'`). A separate field, not a flag on
 *   `styleOverrides`, because the same number means a different length in
 *   each (`padding: 8` is 8px there and `spacing(8)` here).
 * - `variants` — props-matched styles, MUI's own.
 */
export interface HostThemeComponentOverride {
  defaultProps?: Record<string, unknown>
  styleOverrides?: Record<string, unknown>
  sx?: Record<string, Record<string, unknown>>
  variants?: Array<HostThemeComponentVariant>
}

/**
 * Plain-JSON theme mixins.
 *
 * `toolbar` is the only one a host can set, and it exists because it is the
 * ONLY way to change toolbar height from data (AGL-1242). MUI builds the
 * Toolbar's `regular` variant style FROM `theme.mixins.toolbar`, and applies
 * that variant AFTER `components.MuiToolbar.styleOverrides` — so a slot
 * override can never win, no matter how it is written. The value is a CSS
 * object and may nest media queries, e.g.
 * `{ minHeight: '56px', '@media (min-width:600px)': { minHeight: '72px' } }`.
 */
export interface HostThemeMixins {
  toolbar?: Record<string, unknown>
}

export interface HostTheme {
  colorSchemes?: {
    [P in HostThemeScheme]?: HostThemeSchemeColors
  }
  typography?: HostThemeTypography
  fonts?: Array<HostThemeFont>
  shape?: {
    borderRadius?: number
  }
  spacing?: number
  mixins?: HostThemeMixins
  /** Keyed by MUI component slot name (e.g. `MuiButton`). Consumers validate against a whitelist. */
  components?: Record<string, HostThemeComponentOverride>
  /**
   * Whether visitors get a dark scheme. Absent (`'auto'`) follows the
   * visitor's system setting or their choice in the theme mode switcher,
   * rendering the platform's default dark palette under whatever dark colors
   * the site authored. `'off'` keeps every visitor on light — for a site whose
   * content carries light-only backgrounds — and hides the switcher on
   * published pages.
   */
  darkScheme?: 'auto' | 'off'
}
