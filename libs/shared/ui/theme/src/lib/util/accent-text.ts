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

import type { Palette, PaletteColor, Theme } from '../../vendor/mui'
import { AA_TEXT_CONTRAST, contrastRatio } from './accessible-shade'

/**
 * The palette slot that carries "this accent, rendered AS TEXT on the
 * scheme's own surfaces" (AGL-1293 / AGL-1297).
 *
 * `dark` is deliberately overloaded rather than a new slot being invented:
 * `ensureAccessibleShades` already guarantees the DERIVED value of this slot
 * clears {@link AA_TEXT_CONTRAST} against `background.default` and
 * `background.paper` in whichever direction the scheme needs (darker in
 * light, LIGHTER in dark), and the marketing host already pins it explicitly
 * (`#0073ae` light / `#4fc3f7` dark). A second slot would have to be
 * whitelisted in `host-theme.ts`, authored per host, and kept in sync — three
 * new ways for a tenant palette to be missing the accessible value.
 */
export const ACCENT_TEXT_SHADE = 'dark' as const

/** WCAG AA contrast bar for non-text UI (borders, icon fills, indicators). */
export const AA_NON_TEXT_CONTRAST = 3

/**
 * The colour a palette entry should use when it is painted as FOREGROUND on
 * the page — the answer to "what does `color=\"primary\"` text resolve to".
 *
 * Returns a CSS variable reference (`var(--mui-palette-primary-dark)`) on a
 * CSS-vars theme and a literal on a single-mode theme, so the value flips
 * with the active colour scheme either way. Baking a literal here is the
 * AGL-1292 bug shape: `components` are evaluated ONCE against the root
 * theme, so a light-scheme hex would freeze into dark mode.
 *
 * `main` is NOT the answer. `primary.main` is the brand colour and is sized
 * for the 3:1 non-text bar (fills, borders, indicators); as normal-size text
 * the marketing/console `#00b0ff` measures 2.43:1 on white, which fails both
 * bars. This is the whole of AGL-1293.
 *
 * @param theme the active MUI theme (CSS-vars or single-mode)
 * @param color a palette key — `'primary'`, `'error'`, … Anything without a
 *   PaletteColor shape (`'inherit'`, `'textPrimary'`, `undefined`) returns
 *   `undefined` so the caller leaves MUI's own resolution alone.
 */
export function accentTextColor(
  theme: Theme | undefined,
  color: string | undefined,
): string | undefined {
  if (!theme || !color) return undefined
  // `theme.vars` is the CSS-variable mirror of the palette; prefer it so the
  // emitted value is a `var()` that follows the scheme.
  const source = ((theme as unknown as { vars?: { palette?: unknown } }).vars ??
    theme) as { palette?: Record<string, unknown> }
  const paletteColor = source?.palette?.[color] as
    | Record<string, string>
    | undefined
  if (!paletteColor || typeof paletteColor !== 'object') return undefined
  const accent = paletteColor[ACCENT_TEXT_SHADE]
  return typeof accent === 'string' ? accent : undefined
}

/** One measured way a palette fails its accessibility contract. */
export type PaletteContrastViolation = {
  /** Palette key — `'primary'`, `'error'`, … */
  color: string
  /**
   * `accentText` — the accent painted as text on the scheme's surfaces.
   * `contrastText` — the foreground painted ON that accent.
   */
  role: 'accentText' | 'contrastText'
  /** The foreground colour that failed. */
  value: string
  /** The background it failed against. */
  against: string
  /** Measured WCAG ratio, 1–21. */
  ratio: number
  /** The bar it had to clear. */
  required: number
}

const AUDITED_COLOR_KEYS = [
  'primary',
  'secondary',
  'tertiary',
  'error',
  'warning',
  'info',
  'success',
] as const

export type AuditPaletteContrastOptions = {
  /** Bar for foreground text. Default {@link AA_TEXT_CONTRAST}. */
  minContrast?: number
  /** Restrict the audit to these palette keys. Default: all accents. */
  colors?: ReadonlyArray<string>
}

/**
 * Measures whether a palette actually keeps the AGL-1293 promise, rather
 * than trusting that the derivation ran.
 *
 * This is the part that can go RED. `ensureAccessibleShades` only repairs
 * shades it DERIVED — an explicitly authored `primary.dark`, or an accent
 * whose AA bar is simply unreachable in the scheme's foreground direction
 * (walking toward white on a mid-grey page tops out at 3.95:1), passes
 * straight through. Those palettes are exactly the ones a customer can build
 * in the theme editor, so the contract has to be checked, not assumed.
 *
 * Returns every violation with its measured ratio; an empty array means the
 * palette is AA-clean for text.
 */
export function auditPaletteContrast(
  palette: Palette | undefined,
  options: AuditPaletteContrastOptions = {},
): PaletteContrastViolation[] {
  const { minContrast = AA_TEXT_CONTRAST, colors = AUDITED_COLOR_KEYS } =
    options
  const violations: PaletteContrastViolation[] = []
  if (!palette) return violations
  const indexed = palette as unknown as Record<string, PaletteColor | undefined>
  const backgrounds = [
    palette.background?.default,
    palette.background?.paper,
  ].filter((background): background is string => typeof background === 'string')

  for (const key of colors) {
    const color = indexed[key]
    if (!color || typeof color.main !== 'string') continue
    const accent = (color as unknown as Record<string, string>)[
      ACCENT_TEXT_SHADE
    ]
    for (const background of backgrounds) {
      if (typeof accent !== 'string') continue
      try {
        const ratio = contrastRatio(accent, background)
        if (ratio < minContrast) {
          violations.push({
            color: key,
            role: 'accentText',
            value: accent,
            against: background,
            ratio,
            required: minContrast,
          })
        }
      } catch {
        // Unparseable colour (CSS variable, color-mix()): not measurable
        // here. Silence rather than a false violation — the caller audits a
        // resolved palette, not a `vars` mirror.
      }
    }
    if (typeof color.contrastText !== 'string') continue
    try {
      const ratio = contrastRatio(color.contrastText, color.main)
      if (ratio < minContrast) {
        violations.push({
          color: key,
          role: 'contrastText',
          value: color.contrastText,
          against: color.main,
          ratio,
          required: minContrast,
        })
      }
    } catch {
      // As above.
    }
  }
  return violations
}

/** Human-readable one-liner per violation, for test output and dev warnings. */
export function formatPaletteContrastViolation(
  violation: PaletteContrastViolation,
): string {
  return `${violation.color}.${violation.role} ${violation.value} on ${
    violation.against
  } is ${violation.ratio.toFixed(2)}:1, below ${violation.required}:1`
}

export default accentTextColor
