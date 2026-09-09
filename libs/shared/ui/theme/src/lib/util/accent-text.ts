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
import {
  AA_TEXT_CONTRAST,
  accessibleShade,
  contrastRatio,
} from './accessible-shade'

/**
 * The palette slot that carries "this accent, rendered AS TEXT on the
 * scheme's own surfaces" (AGL-1293 / AGL-1297).
 *
 * `dark` is deliberately overloaded rather than a new slot being invented:
 * `ensureAccessibleShades` already guarantees the value of this slot clears
 * {@link AA_TEXT_CONTRAST} against `background.default` and
 * `background.paper` in whichever direction the scheme needs (darker in
 * light, LIGHTER in dark), so every tenant palette carries an accessible
 * value here whether or not its author thought about one. A second slot
 * would have to be whitelisted in `host-theme.ts`, authored per host, and
 * kept in sync — three new ways for a palette to be missing it.
 *
 * `console.theme.ts` authors the shade explicitly for both schemes rather
 * than relying on that repair, so the value a link resolves to is readable
 * in the palette instead of recomputed at boot.
 */
export const ACCENT_TEXT_SHADE = 'dark' as const

/** WCAG AA contrast bar for non-text UI (borders, icon fills, indicators). */
export const AA_NON_TEXT_CONTRAST = 3

/**
 * The accent-as-text color for `color`, as a value safe to hand to a
 * `styleOverrides` root.
 *
 * Wired into `MuiButton`'s `--variant-textColor` / `--variant-outlinedColor`
 * and `MuiLink`'s `color` in `console.theme.ts`. Those three are the places
 * MUI paints an accent at normal text size, where `main` owes 4.5:1 and the
 * brand blue delivers 2.43:1 on white. Everything that paints the accent as
 * a FILL, a BORDER or an INDICATOR — `--variant-containedBg`,
 * `--variant-outlinedBorder`, the Tabs indicator — keeps `main`: those owe
 * 3:1, and the brand color is meant to be seen there.
 *
 * Returns a CSS variable reference (`var(--mui-palette-primary-dark)`) on a
 * CSS-vars theme and a literal on a single-mode theme. That distinction is
 * load-bearing: `components` are evaluated ONCE against the root theme, so
 * baking a light-scheme literal would freeze it into dark mode.
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
    Record<string, string> | undefined
  if (!paletteColor || typeof paletteColor !== 'object') return undefined
  const accent = paletteColor[ACCENT_TEXT_SHADE]
  return typeof accent === 'string' ? accent : undefined
}

/**
 * The accent shade a FILLED surface can paint under the accent's own ink —
 * the counterpart to {@link accentTextColor}, and a different value for a
 * different question (AGL-2704).
 *
 * {@link ACCENT_TEXT_SHADE} answers "this accent, READ ON the page", so it
 * inverts direction per scheme: darker than `main` in light, LIGHTER in
 * dark. That makes it wrong as a fill in exactly one scheme. The console's
 * `primary.dark` is `#0077ad` in light, where white on it measures 4.95:1,
 * and `#4dc8ff` in dark, where the same white measures 1.91:1 — below the
 * 2.43:1 the brand fill it replaced already scored.
 *
 * This shade answers "this accent, PAINTED UNDER its own `contrastText`"
 * instead. The constraint is the ink, not the page, so the walk starts at
 * `main` and darkens until the ink clears the bar — and the answer is the
 * SAME in both schemes, which is the property a token reference needs. An
 * `sx` value resolves against whichever scheme is active, so a fill token
 * that only holds in one of them cannot be authored safely.
 *
 * Takes a resolved `Palette`, never `theme.vars`: the walk decomposes real
 * colors, and a CSS-variable mirror hands it `var(--mui-palette-…)`.
 *
 * @param palette a resolved (non-`vars`) palette
 * @param color a palette key — `'primary'`, `'error'`, …
 * @param minContrast the bar the ink must clear. Default
 *   {@link AA_TEXT_CONTRAST}.
 */
export function accentFillColor(
  palette: Palette | undefined,
  color: string | undefined,
  minContrast: number = AA_TEXT_CONTRAST,
): string | undefined {
  if (!palette || !color) return undefined
  const paletteColor = (palette as unknown as Record<string, unknown>)[
    color
  ] as Record<string, string> | undefined
  if (!paletteColor || typeof paletteColor !== 'object') return undefined
  const { main, contrastText } = paletteColor
  if (typeof main !== 'string' || typeof contrastText !== 'string') {
    return undefined
  }
  try {
    return accessibleShade(main, [contrastText], 'darken', { minContrast })
  } catch {
    // Unparseable color (a `color()` literal, an unresolved variable). A
    // caller gets nothing rather than a guess, the same as `accentTextColor`.
    return undefined
  }
}

/** One measured way a palette fails its accessibility contract. */
export type PaletteContrastViolation = {
  /** Palette key — `'primary'`, `'error'`, … */
  color: string
  /**
   * `accentText` — the accent painted as text on the scheme's surfaces.
   * `contrastText` — the foreground painted ON that accent.
   * `accentFill` — that same foreground painted on the accent's TEXT shade,
   *   i.e. a surface filled with {@link ACCENT_TEXT_SHADE}. Off by default;
   *   see {@link AuditPaletteContrastOptions.roles}.
   */
  role: 'accentText' | 'contrastText' | 'accentFill'
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
 * measurement offered for a decision the account owner owns, not a defect queued for
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
    // AGL-1293. Computing this slot for contrast resolves it to dark ink
    // (8.65:1), which turns every filled primary button dark-on-blue. The
    // tradeoff is to darken the brand or to keep it and accept sub-AA white,
    // and the brand blue is fixed: white on `#00b0ff` is 2.43:1, below the
    // 4.5:1 AA text bar and below the 3:1 non-text bar. Accepted knowingly.
    //
    // This is the ONE decided pairing. Everything else the audit reports —
    // the five other authored sub-AA `contrastText` literals, and `#00b0ff`
    // as text — is a finding, not a waiver, and stays undecided here.
    color: 'primary',
    role: 'contrastText',
    value: '#FFFFFF',
    against: '#00b0ff',
    reason:
      'AGL-1293 — the brand blue stays as authored, with white text (white on #00b0ff = 2.43:1, knowingly below AA)',
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
  /**
   * Which roles to measure. Default {@link DEFAULT_AUDITED_ROLES} — the two
   * pairings every palette owes unconditionally.
   *
   * `accentFill` is opt-in because it is a question about a SURFACE, not
   * about the palette: it asks what a fill painted with
   * {@link ACCENT_TEXT_SHADE} does to the accent's own ink. In a dark scheme
   * that shade is lighter than `main` by design, so every accent fails it —
   * correctly, and uselessly for a palette that fills with nothing. Pass it
   * where something actually does (AGL-2704: the marketing pricing page
   * filled a nav CTA and a badge with `primary.dark`, which held in light at
   * 4.95:1 and collapsed to 1.91:1 in dark).
   */
  roles?: ReadonlyArray<PaletteContrastViolation['role']>
}

/** The roles {@link auditPaletteContrast} measures unless told otherwise. */
export const DEFAULT_AUDITED_ROLES: ReadonlyArray<
  PaletteContrastViolation['role']
> = ['accentText', 'contrastText']

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
    roles = DEFAULT_AUDITED_ROLES,
  } = options
  const measures = (role: PaletteContrastViolation['role']) =>
    roles.includes(role)
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
      if (!measures('accentText') || typeof accent !== 'string') continue
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
    if (measures('contrastText')) {
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
    // The same ink, on a surface filled with the accent's TEXT shade. That
    // shade is chosen to be READ ON the page, so in a dark scheme it sits
    // lighter than `main` and cannot carry a light ink — which is invisible
    // to the `contrastText` measure above, because that one only ever looks
    // at `main`.
    if (measures('accentFill') && typeof accent === 'string') {
      try {
        const ratio = contrastRatio(color.contrastText, accent)
        if (ratio < minContrast) {
          record({
            color: key,
            role: 'accentFill',
            value: color.contrastText,
            against: accent,
            ratio,
            required: minContrast,
          })
        }
      } catch {
        // As above.
      }
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
