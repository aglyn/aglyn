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

import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import type { Theme } from '@mui/material/styles'
import { siteBaseOptions } from '../tenant.theme'
import { createResponsiveTheme } from './create-responsive-theme'
import { hostThemeToThemeOptions, mergeThemeOptions } from './host-theme'

/** One accent as the preview draws it: its fill, the ink on it, and its darker shade. */
export interface ThemePreviewAccent {
  main: string
  contrastText: string
  dark: string
}

/** One rung of the type ramp: the variant, the size it reaches at its widest breakpoint, and its weight. */
export interface ThemePreviewTypeRung {
  key: string
  /** Pixels at the widest breakpoint (`responsiveFontSizes` scales the big variants down from it). */
  sizePx: number
  /** As the theme writes it (`2.5rem`), for the legend beside the rung. */
  raw: string
  weight: number | null
}

/**
 * What the theme library's preview shows of a theme in one scheme, read off
 * the very theme the console's `ThemePreview` renders under: the site's base
 * with the theme's values over it, built by `createResponsiveTheme`. Plain
 * values only, so a native app draws the same kit from it (AGL-3668).
 */
export interface ThemePreviewKit {
  scheme: HostThemeScheme
  fontFamily: string
  background: { default: string; paper: string }
  text: { primary: string; secondary: string; disabled: string }
  divider: string
  primary: ThemePreviewAccent
  secondary: ThemePreviewAccent
  tertiary: ThemePreviewAccent
  error: ThemePreviewAccent
  warning: ThemePreviewAccent
  info: ThemePreviewAccent
  success: ThemePreviewAccent
  surface: { main: string; contrastText: string }
  tint: { primary: string; secondary: string; tertiary: string }
  /** The selected row's wash (`action.selected`). */
  selected: string
  /** Corner radius in pixels (`shape.borderRadius`). */
  radius: number
  typography: ThemePreviewTypeRung[]
}

const ROOT_PX = 16

/** A CSS size as pixels: rem against the 16 px root, px as written; NaN for anything else. */
function px(value: unknown, htmlFontSize: number): number {
  const text = String(value ?? '').trim()
  const number = Number.parseFloat(text)
  if (!Number.isFinite(number)) return Number.NaN
  if (text.endsWith('rem')) return number * htmlFontSize
  return number
}

function accent(color: unknown): ThemePreviewAccent {
  const c = (color ?? {}) as Record<string, unknown>
  const main = String(c['main'] ?? '')
  return { main, contrastText: String(c['contrastText'] ?? ''), dark: String(c['dark'] ?? main) }
}

/**
 * Every typography variant the theme defines, largest first, ranked by the
 * size it reaches at its widest breakpoint, as the console's `TypeRamp` reads
 * them (`inherit` and the scalars left out).
 */
function typeRamp(theme: Theme): ThemePreviewTypeRung[] {
  const typography = theme.typography as unknown as Record<string, unknown>
  const html = Number(typography['htmlFontSize']) || ROOT_PX
  return Object.keys(typography)
    .filter((key) => {
      const variant = typography[key] as Record<string, unknown> | undefined
      return Boolean(
        variant &&
          typeof variant === 'object' &&
          variant['fontSize'] &&
          Number.isFinite(Number.parseFloat(String(variant['fontSize']))),
      )
    })
    .map((key) => {
      const variant = typography[key] as Record<string, unknown>
      const sizes = [
        variant['fontSize'],
        ...Object.keys(variant)
          .filter((k) => k.startsWith('@media'))
          .map((k) => (variant[k] as Record<string, unknown> | undefined)?.['fontSize']),
      ]
        .map((size) => px(size, html))
        .filter((size) => Number.isFinite(size))
      const weight = Number(variant['fontWeight'])
      return {
        key,
        sizePx: Math.round(Math.max(...sizes) * 100) / 100,
        raw: String(variant['fontSize']),
        weight: Number.isFinite(weight) ? weight : null,
      }
    })
    .sort((a, b) => b.sizePx - a.sizePx)
}

/** The preview kit of `theme` in `scheme`, on the base the site at `siteKey` publishes on. */
export function themePreviewKit(
  theme: HostTheme | undefined,
  scheme: HostThemeScheme,
  siteKey: string | undefined,
): ThemePreviewKit {
  const built = createResponsiveTheme({
    themeOptions: mergeThemeOptions(siteBaseOptions(siteKey, scheme), hostThemeToThemeOptions(theme, scheme)),
  })
  const palette = built.palette as unknown as Record<string, Record<string, unknown> & { [key: string]: unknown }>
  const tint = (palette['tint'] ?? {}) as Record<string, unknown>
  const surface = (palette['surface'] ?? {}) as Record<string, unknown>
  const radius = Number(built.shape?.borderRadius)
  return {
    scheme,
    fontFamily: String((built.typography as unknown as Record<string, unknown>)['fontFamily'] ?? ''),
    background: {
      default: String(palette['background']?.['default'] ?? ''),
      paper: String(palette['background']?.['paper'] ?? ''),
    },
    text: {
      primary: String(palette['text']?.['primary'] ?? ''),
      secondary: String(palette['text']?.['secondary'] ?? ''),
      disabled: String(palette['text']?.['disabled'] ?? ''),
    },
    divider: String(palette['divider'] ?? ''),
    primary: accent(palette['primary']),
    secondary: accent(palette['secondary']),
    tertiary: accent(palette['tertiary']),
    error: accent(palette['error']),
    warning: accent(palette['warning']),
    info: accent(palette['info']),
    success: accent(palette['success']),
    surface: { main: String(surface['main'] ?? ''), contrastText: String(surface['contrastText'] ?? '') },
    tint: {
      primary: String(tint['primary'] ?? ''),
      secondary: String(tint['secondary'] ?? ''),
      tertiary: String(tint['tertiary'] ?? ''),
    },
    selected: String(palette['action']?.['selected'] ?? ''),
    radius: Number.isFinite(radius) ? radius : 0,
    typography: typeRamp(built),
  }
}
