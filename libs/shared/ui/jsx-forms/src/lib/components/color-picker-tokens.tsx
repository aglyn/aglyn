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

import { styled, useTheme } from '@aglyn/shared-ui-theme'
import { createContext, useContext, useMemo } from 'react'

/**
 * Theme color references for the two-stage color picker (AGL-588).
 *
 * The picker's default stage offers PALETTE TOKEN PATHS (`primary.main`,
 * `background.paper`, …) instead of resolved hex values: MUI's sx system
 * resolves palette paths against the ACTIVE theme, so a token-referenced
 * color adapts automatically when the site swaps between its light and
 * dark schemes — the fix for hardcoded light-scheme hex colors going
 * unreadable in dark mode.
 */
export interface ColorPickerTokenOption {
  /** Palette token path stored as the field value, e.g. 'primary.main'. */
  value: string
  label: string
  /** Swatch color resolved from the light-scheme palette. */
  light?: string
  /** Swatch color resolved from the dark-scheme palette. */
  dark?: string
}

/**
 * The palette token paths the picker offers, with display labels.
 *
 * `console.theme.ts` is the source of truth for brand colour — these are
 * references INTO it, never copies of it, so a palette change lands here for
 * free. Anything the active palette does not define is dropped by
 * {@link buildColorTokenOptions}, so listing a brand-only slot (`tertiary`,
 * `surface`) costs nothing on a theme that lacks it.
 *
 * Every `path` must be UNIQUE — the picker keys its grid by it (AGL-1192).
 */
export const COLOR_PICKER_TOKEN_PATHS: ReadonlyArray<{
  path: string
  label: string
}> = [
  { path: 'primary.main', label: 'Primary' },
  { path: 'primary.light', label: 'Primary light' },
  { path: 'primary.dark', label: 'Primary dark' },
  // These three read `primary.*` until AGL-1206: picking "Secondary" handed
  // back the PRIMARY colour, and the duplicate `primary.main` path also gave
  // the grid two children with the same React key (AGL-1192).
  { path: 'secondary.main', label: 'Secondary' },
  { path: 'secondary.light', label: 'Secondary light' },
  { path: 'secondary.dark', label: 'Secondary dark' },
  // Brand slots beyond MUI's stock set. `tertiary` is the Aglyn slate after
  // the AGL-1186 rotation; `surface` is a real palette entry, so "Surface"
  // names it rather than `background.paper` (which is Paper).
  { path: 'tertiary.main', label: 'Tertiary' },
  { path: 'surface.main', label: 'Surface' },
  { path: 'error.main', label: 'Error' },
  { path: 'warning.main', label: 'Warning' },
  { path: 'info.main', label: 'Info' },
  { path: 'success.main', label: 'Success' },
  { path: 'background.default', label: 'Background' },
  { path: 'background.paper', label: 'Paper' },
  { path: 'text.primary', label: 'Text' },
  { path: 'text.secondary', label: 'Text secondary' },
  { path: 'text.disabled', label: 'Text disabled' },
  { path: 'divider', label: 'Divider' },
  // The neutral ramp the designs lean on for borders and muted copy, and the
  // absolutes for on-inverse text. Without these an author had no token for
  // "muted grey" and reached for a hardcoded hex, which then failed in dark.
  { path: 'grey.300', label: 'Grey 300' },
  { path: 'grey.600', label: 'Grey 600' },
  { path: 'grey.900', label: 'Grey 900' },
  { path: 'common.white', label: 'White' },
  { path: 'common.black', label: 'Black' },
]

/** Resolves a dot-separated palette token path to its color string. */
export function resolvePaletteToken(
  palette: Record<string, unknown> | undefined,
  path: string,
): string | undefined {
  const resolved = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      palette,
    )
  return typeof resolved === 'string' ? resolved : undefined
}

/**
 * Builds the picker's token options from a light and a dark palette so
 * every swatch can show BOTH scheme resolutions. Tokens that resolve in
 * neither palette are dropped.
 */
export function buildColorTokenOptions(
  lightPalette: Record<string, unknown> | undefined,
  darkPalette: Record<string, unknown> | undefined,
): ColorPickerTokenOption[] {
  const options: ColorPickerTokenOption[] = []
  // The picker keys its grid by `value`, so a repeated path would render two
  // children with the same React key (AGL-1192). The list above is curated to
  // be unique; this makes that a property of the builder rather than a rule
  // someone has to remember when adding a token.
  const seen = new Set<string>()
  for (const { path, label } of COLOR_PICKER_TOKEN_PATHS) {
    if (seen.has(path)) continue
    const light = resolvePaletteToken(lightPalette, path)
    const dark = resolvePaletteToken(darkPalette, path)
    if (!light && !dark) continue
    seen.add(path)
    options.push({ value: path, label, light, dark })
  }
  return options
}

/**
 * Carries site-theme-resolved token options down to every COLOR_PICKER
 * field beneath it (styles panel, attribute forms, email blocks) with no
 * per-form wiring. Without a provider the field falls back to resolving
 * the token paths against the ambient MUI theme — one scheme only.
 */
export const ColorPickerTokensContext = createContext<
  ColorPickerTokenOption[] | undefined
>(undefined)
ColorPickerTokensContext.displayName = 'ColorPickerTokensContext'

/**
 * The token options a color-picker field should offer: the
 * {@link ColorPickerTokensContext} value when provided, otherwise the
 * default token paths resolved against the ambient theme's palette
 * (filed under that theme's own scheme; the other scheme is unknown).
 */
export function useColorPickerTokenOptions(): ColorPickerTokenOption[] {
  const contextOptions = useContext(ColorPickerTokensContext)
  const theme = useTheme() as {
    palette?: Record<string, unknown> & { mode?: string }
  } | null
  return useMemo(() => {
    if (contextOptions?.length) return contextOptions
    const palette = theme?.palette
    const scheme = palette?.mode === 'dark' ? 'dark' : 'light'
    const options: ColorPickerTokenOption[] = []
    const seen = new Set<string>()
    for (const { path, label } of COLOR_PICKER_TOKEN_PATHS) {
      if (seen.has(path)) continue
      const resolved = resolvePaletteToken(palette, path)
      if (!resolved) continue
      seen.add(path)
      options.push({ value: path, label, [scheme]: resolved })
    }
    return options
  }, [contextOptions, theme])
}

/**
 * Split swatch showing a token's light + dark resolutions side by side
 * (left/light, right/dark) so authors see how the reference adapts per
 * scheme. Falls back to a solid fill when only one scheme is known.
 */
export const TokenSwatch = styled('span', {
  shouldForwardProp: (propName) =>
    propName !== 'light' && propName !== 'dark' && propName !== 'size',
})<{ light?: string; dark?: string; size?: number }>(
  ({ theme, light, dark, size = 22 }) => {
    const lightColor = light ?? dark ?? 'transparent'
    const darkColor = dark ?? light ?? 'transparent'
    return {
      width: size,
      height: size,
      flexShrink: 0,
      display: 'inline-flex',
      borderRadius: '50%',
      border: `1px solid ${theme.palette.divider}`,
      background:
        lightColor === darkColor
          ? lightColor
          : `linear-gradient(105deg, ${lightColor} 0%, ${lightColor} 49.9%, ${darkColor} 50.1%, ${darkColor} 100%)`,
    }
  },
)
TokenSwatch.displayName = 'AglynColorTokenSwatch'
