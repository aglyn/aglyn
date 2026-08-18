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
 * ⚠️ NOT WIRED TO ANYTHING, DELIBERATELY. This is a MEASUREMENT helper, not a
 * rendering path.
 *
 * `c03a2d754` routed `MuiButton`'s `--variant-textColor` /
 * `--variant-outlinedColor`, `MuiLink`'s `color` and `MuiTab`'s selected
 * label through this function. That shipped, and it repainted Zach's brand
 * blue: links and text/outlined button labels went `#00b0ff` → `#0077ad` in
 * light and → `rgb(76, 199, 255)` in dark. Zach, 2026-08-18: **"You changed
 * my theme colors, I told you deliberately not to do that."** Every one of
 * those call sites is reverted; `#00b0ff` renders everywhere it rendered
 * before.
 *
 * What survives here is the ability to ANSWER the question — "what would
 * accent-coloured text resolve to if we ever decided to change it" — for a
 * decision that is Zach's to make. Wiring it into a component override again
 * is a visual change to the brand and needs him to ask for it.
 *
 * Returns a CSS variable reference (`var(--mui-palette-primary-dark)`) on a
 * CSS-vars theme and a literal on a single-mode theme. If this is ever wired
 * up, that matters: baking a literal is the AGL-1292 bug shape, because
 * `components` are evaluated ONCE against the root theme, so a light-scheme
 * hex would freeze into dark mode.
 *
 * @param theme the active MUI theme (CSS-vars or single-mode)
 * @param color a palette key — `'primary'`, `'error'`, … Anything without a
 *   PaletteColor shape (`'inherit'`, `'textPrimary'`, `undefined`) returns
 *   `undefined`.
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
  /**
   * Set only when this exact pairing matches a
   * {@link DOCUMENTED_CONTRAST_EXCEPTIONS} entry: the human decision that
   * knowingly accepts the measured ratio. Excluded from the default result;
   * surfaced by `includeExempt`.
   */
  exemption?: string
}

/**
 * Pairings a human has knowingly SIGNED OFF below the bar — decided, not
 * outstanding.
 *
 * The rest of what {@link auditPaletteContrast} reports is a FINDING: a
 * measurement offered for a decision Zach owns, not a defect queued for
 * repair. Nothing in this module changes a rendered colour.
 *
 * This is not a suppression list and it must not become one. Each entry pins
 * all four coordinates of one pairing — palette key, role, the exact
 * foreground and the exact background — so it waives a decision, not a slot.
 * Change the brand blue, change the white, or move the same white onto
 * `secondary`, and none of them match: the audit reports it again, which is
 * the point. A new entry needs a named person, a date, their words, and the
 * measured ratio, the same as this one.
 */
export const DOCUMENTED_CONTRAST_EXCEPTIONS: ReadonlyArray<{
  color: string
  role: PaletteContrastViolation['role']
  value: string
  against: string
  reason: string
}> = [
  {
    // AGL-1293. `c03a2d754` computed this slot to dark ink (8.65:1) and that
    // shipped, turning every filled primary button dark-on-blue. Shown the
    // tradeoff — darken the brand, or keep it and accept sub-AA white — Zach
    // chose, verbatim, 2026-08-18: "don't change the current blue and leave
    // it as white text". White on `#00b0ff` is 2.43:1, below the 4.5:1 AA
    // text bar and below the 3:1 non-text bar. Accepted knowingly.
    //
    // This is the ONE decided pairing. Everything else the audit reports —
    // the five other authored sub-AA `contrastText` literals, and `#00b0ff`
    // as text — is a finding awaiting Zach, not a waiver.
    color: 'primary',
    role: 'contrastText',
    value: '#FFFFFF',
    against: '#00b0ff',
    reason:
      'AGL-1293 — Zach, 2026-08-18: "don\'t change the current blue and leave it as white text" (white on #00b0ff = 2.43:1, knowingly below AA)',
  },
]

/** Case-insensitive exact colour match; nothing fuzzy, nothing normalised away. */
function sameColor(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The signed-off reason for this exact pairing, or `undefined`. Exact on all
 * four coordinates — a near miss is not a match.
 */
function documentedExemption(
  color: string,
  role: PaletteContrastViolation['role'],
  value: string,
  against: string,
): string | undefined {
  return DOCUMENTED_CONTRAST_EXCEPTIONS.find(
    (exception) =>
      exception.color === color &&
      exception.role === role &&
      sameColor(exception.value, value) &&
      sameColor(exception.against, against),
  )?.reason
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
  /**
   * Include pairings matched by {@link DOCUMENTED_CONTRAST_EXCEPTIONS},
   * carrying their `exemption`. Default `false`, so a signed-off decision does
   * not read as an open defect. Pass `true` to see everything measured — the
   * spec that proves the exception is still exactly 2.43:1 uses this, so the
   * waiver documents a number rather than hiding one.
   */
  includeExempt?: boolean
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
  const {
    minContrast = AA_TEXT_CONTRAST,
    colors = AUDITED_COLOR_KEYS,
    includeExempt = false,
  } = options
  const violations: PaletteContrastViolation[] = []
  /** Records a measured failure unless a documented decision waives it. */
  const record = (violation: PaletteContrastViolation) => {
    const exemption = documentedExemption(
      violation.color,
      violation.role,
      violation.value,
      violation.against,
    )
    if (exemption && !includeExempt) return
    violations.push(exemption ? { ...violation, exemption } : violation)
  }
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
          record({
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
        record({
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
  const measured = `${violation.color}.${violation.role} ${violation.value} on ${
    violation.against
  } is ${violation.ratio.toFixed(2)}:1, below ${violation.required}:1`
  // The waived line still carries its number, so a reader sees what was
  // accepted rather than a bare "exempt".
  return violation.exemption
    ? `${measured} — KNOWN EXCEPTION: ${violation.exemption}`
    : measured
}

export default accentTextColor
