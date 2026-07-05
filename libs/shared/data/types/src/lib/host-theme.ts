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
  divider?: string
}

export interface HostThemeFont {
  /** Font family name, e.g. "Inter". */
  family: string
  weights?: Array<number>
  /** Where the tenant loads the font from; system fonts need no loading. */
  source?: 'google' | 'system'
}

export type HostThemeTypographyVariantKey =
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
 * Plain-JSON component override: serialized `defaultProps` and
 * `styleOverrides` (slot name -> CSS object). Functions are not
 * representable by design.
 */
export interface HostThemeComponentOverride {
  defaultProps?: Record<string, unknown>
  styleOverrides?: Record<string, unknown>
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
  /** Keyed by MUI component slot name (e.g. `MuiButton`). Consumers validate against a whitelist. */
  components?: Record<string, HostThemeComponentOverride>
}
