/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import {
  CssVarsThemeOptions,
  extendTheme as muiExtendTheme,
} from '@mui/material/styles'
import {
  createTheme,
  darken,
  getContrastRatio,
  lighten,
  type PaletteColor,
  type PaletteOptions,
  responsiveFontSizes,
  type Theme,
  type ThemeOptions,
} from '../../vendor/mui'
import {
  accessibleShade,
  contrastRatio,
  meetsContrast,
  type ShadeDirection,
} from './accessible-shade'

enum ContrastText {
  LIGHT = 'rgba(0, 0, 0, 0.87)',
  DARK = '#FFFFFF',
}

type TonalOffset = number | { light?: number; dark?: number }

function resolveTonalOffsets(tonalOffset: TonalOffset | undefined) {
  const offsetObj = typeof tonalOffset === 'number' ? undefined : tonalOffset
  const offsetNum = typeof tonalOffset === 'number' ? tonalOffset : undefined
  return {
    light: offsetObj?.light ?? offsetNum ?? 0.2,
    dark: offsetObj?.dark ?? (offsetNum ?? 0.2) * 1.5,
  }
}

function getContrastTextColor(background: string, contrastThreshold: number) {
  return getContrastRatio(background, ContrastText.DARK) >= (contrastThreshold ?? 3)
    ? ContrastText.DARK
    : ContrastText.LIGHT
}
function addShade(paletteColor: PaletteColor, shade: string, variant: string | undefined, tonalOffset: TonalOffset) {
  // Custom palette colors (tertiary, surface) are optional in host themes.
  if (!paletteColor?.main) return
  const { light: tonalOffsetLight, dark: tonalOffsetDark } =
    resolveTonalOffsets(tonalOffset)
  const indexed = paletteColor as unknown as Record<string, string>

  if (!indexed[shade]) {
    // eslint-disable-next-line no-prototype-builtins
    if (paletteColor.hasOwnProperty(variant)) {
      indexed[shade] = indexed[variant]
    } else if (shade === 'light') {
      paletteColor.light = lighten(paletteColor.main, tonalOffsetLight)
    } else if (shade === 'dark') {
      paletteColor.dark = darken(paletteColor.main, tonalOffsetDark)
    } else if (shade === 'contrastText') {
      paletteColor.contrastText = getContrastTextColor(
        paletteColor.main,
        tonalOffsetDark,
      )
    }
  }
}
function addShadeVariants(paletteColor: PaletteColor, tonalOffset?: TonalOffset) {
  addShade(paletteColor, 'dark', undefined, tonalOffset)
  addShade(paletteColor, 'light', undefined, tonalOffset)
  addShade(paletteColor, 'contrastText', undefined, tonalOffset)
}

/**
 * Colour families whose shades act as FOREGROUNDS — the `dark` slot carries
 * "accessible accent text" (AGL-1293 put the marketing brand blue there), so
 * its derivation must clear AA against the scheme's real backgrounds.
 *
 * `surface` is deliberately absent: its `light`/`dark` are surface STEPS
 * (panel fills, borders — see the designer's box styler), and walking them to
 * text contrast would repaint layout chrome, not fix any text.
 */
const FOREGROUND_COLOR_KEYS = [
  'primary',
  'secondary',
  'tertiary',
  'error',
  'warning',
  'info',
  'success',
] as const

/** `contrastText` IS a text pairing wherever it lives, so `surface` joins here. */
const CONTRAST_TEXT_COLOR_KEYS = [...FOREGROUND_COLOR_KEYS, 'surface'] as const

/**
 * Post-`createTheme` pass making DERIVED shades scheme- and AA-aware
 * (AGL-1297). Fixed tonal offsets derive `dark = darken(main, 0.3)` no
 * matter the scheme, which (a) misses 4.5:1 on real off-white surfaces and
 * (b) points the wrong way entirely in dark mode, where the accessible
 * direction for a foreground shade is LIGHTER.
 *
 * Invariants:
 * - Only slots ABSENT from the caller's `palette` input are ever touched;
 *   an explicitly authored shade passes through byte-identical (the
 *   marketing host's hand-set `primary.dark` values depend on this).
 * - A derived value that already clears 4.5:1 against both
 *   `background.default` and `background.paper` is kept byte-identical, so
 *   themes that were fine yesterday do not shift.
 * - A failing derived `dark` is re-seeded at the tonal offset from `main`
 *   in the scheme's foreground direction (darken in light, lighten in
 *   dark), then walked in HSL lightness until it clears the bar.
 * - A light-scheme `light` is a background TINT — its ramp direction points
 *   away from the text bar by design — so it keeps the tonal derivation.
 *   In dark schemes `light` is foreground-capable and gets the same walk.
 * - Derived `contrastText` keeps the threshold choice unless that pairing
 *   is below 4.5:1 against `main`; then it walks toward the pole with more
 *   contrast headroom.
 */
function ensureAccessibleShades(
  theme: Theme,
  inputPalette: PaletteOptions | undefined,
) {
  const { palette } = theme
  const backgrounds = [
    palette.background?.default,
    palette.background?.paper,
  ].filter((background): background is string => typeof background === 'string')
  if (!backgrounds.length) return
  const mode: 'light' | 'dark' = palette.mode === 'dark' ? 'dark' : 'light'
  const foregroundDirection: ShadeDirection =
    mode === 'dark' ? 'lighten' : 'darken'
  const tonalOffsetDark = resolveTonalOffsets(palette.tonalOffset).dark
  const providedColors = inputPalette as
    | Record<string, unknown>
    | undefined

  for (const key of CONTRAST_TEXT_COLOR_KEYS) {
    const color = (palette as unknown as Record<string, PaletteColor>)[key]
    if (!color || typeof color.main !== 'string') continue
    const provided = providedColors?.[key]
    // A ColorPartial ramp (`{ 50…900 }`) is an author-owned scale — MUI maps
    // its shades straight across, so nothing in it counts as derived.
    if (provided && typeof provided === 'object' && !('main' in provided)) {
      continue
    }
    const explicit = (provided ?? {}) as Record<string, unknown>
    const isForeground = (FOREGROUND_COLOR_KEYS as readonly string[]).includes(
      key,
    )

    try {
      if (
        isForeground &&
        !explicit.dark &&
        typeof color.dark === 'string' &&
        !meetsContrast(color.dark, backgrounds)
      ) {
        const seed =
          mode === 'dark' ? lighten(color.main, tonalOffsetDark) : color.dark
        color.dark = accessibleShade(seed, backgrounds, foregroundDirection)
      }
      if (
        isForeground &&
        mode === 'dark' &&
        !explicit.light &&
        typeof color.light === 'string' &&
        !meetsContrast(color.light, backgrounds)
      ) {
        color.light = accessibleShade(color.light, backgrounds, 'lighten')
      }
      if (
        !explicit.contrastText &&
        typeof color.contrastText === 'string' &&
        !meetsContrast(color.contrastText, [color.main])
      ) {
        const textDirection: ShadeDirection =
          contrastRatio('#fff', color.main) >= contrastRatio('#000', color.main)
            ? 'lighten'
            : 'darken'
        color.contrastText = accessibleShade(
          color.contrastText,
          [color.main],
          textDirection,
        )
      }
    } catch {
      // Unparseable colour (CSS variable, color-mix()): leave the derived
      // value alone rather than failing theme creation.
    }
  }
}

export type CreateResponsiveThemeOptions = {
  themeOptions?: ThemeOptions
  responsiveFontSizesOptions?: Parameters<typeof responsiveFontSizes>[1]
}

/**
 * START EXAMPLE – OVERRIDE DEFAULT PROPS ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * const theme = createMuiTheme({
 *   props: {
 *     // Name of the component ⚛️
 *     MuiButtonBase: {
 *       // The default props to change
 *       disableRipple: true, // No more ripple, on the whole application 💣!
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – OVERRIDE DEFAULT PROPS ↑
 *
 * START EXAMPLE – OVERRIDE DEFAULT STYLES ↓
 * ⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄⌄
 * ```typescript
 * const theme = createMuiTheme({
 *   overrides: {
 *     // Style sheet name ⚛️
 *     MuiButton: {
 *       // Name of the rule
 *       text: {
 *         // Some CSS
 *         color: 'white',
 *       },
 *     },
 *     MuiCssBaseline: {
 *       '@global': {
 *         html: {
 *           WebkitFontSmoothing: 'auto',
 *         },
 *       },
 *     },
 *   },
 * })
 * ```
 * ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 * END EXAMPLE – OVERRIDE DEFAULT STYLES ↑
 *
 * @param {ThemeOptions} options
 * @returns {Theme}
 */
export function createResponsiveTheme(
  options: CreateResponsiveThemeOptions,
): Theme {
  const { themeOptions, responsiveFontSizesOptions } = options
  let theme = createTheme(themeOptions)
  addShadeVariants(theme.palette.tertiary, theme.palette.tonalOffset)
  addShadeVariants(theme.palette.surface, theme.palette.tonalOffset)
  // Scheme- and AA-aware repair of DERIVED shades only (AGL-1297); explicit
  // palette values pass through byte-identical.
  ensureAccessibleShades(theme, themeOptions?.palette)

  theme = responsiveFontSizes(theme, {
    // Override to include `xs` and `xl` - default: ['sm', 'md', 'lg']
    breakpoints: ['xs', 'sm', 'md', 'lg', 'xl'],
    ...responsiveFontSizesOptions,
  })

  return theme
}

export function createResponsiveCssVarTheme(
  light: Theme,
  dark: Theme,
  options?: CssVarsThemeOptions,
) {
  const { palette: lightPalette, ...lightTheme } = light
  const { palette: darkPalette } = dark

  return muiExtendTheme({
    ...lightTheme,
    // Allow setMode() to work by driving the color scheme via a CSS class on
    // <html> instead of the OS-level @media query (the default 'media' selector
    // makes setMode() a no-op because media queries can't be overridden in JS).
    colorSchemeSelector: 'class',
    ...options,
    colorSchemes: {
      ...options?.colorSchemes,
      light: { palette: lightPalette, ...((options?.colorSchemes?.light ?? {}) as object) },
      dark: { palette: darkPalette, ...((options?.colorSchemes?.dark ?? {}) as object) },
    },
  })
}

export default createResponsiveTheme
