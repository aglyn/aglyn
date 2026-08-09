/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { _isEqualitySameType, _isNum, _isStrT } from '@aglyn/shared-util-tools'

export enum FontWeight {
  THIN = 100,
  EXTRA_LIGHT = 200,
  LIGHT = 300,
  NORMAL = 400,
  MEDIUM = 500,
  SEMI_BOLD = 600,
  BOLD = 700,
  EXTRA_BOLD = 800,
  BLACK = 900,
  LIGHTER = 'lighter',
  BOLDER = 'bolder',
}

export enum CssUnit {
  INITIAL = 'initial',
  UNSET = 'unset',
  INHERIT = 'inherit',
  AUTO = 'auto',
  PIXELS = 'px',
  EM = 'em',
  PERCENT = '%',
  REM = 'rem',
  POINTS = 'pt',
  PICAS = 'pc',
  CH = 'ch',
  VIEWPORT_WIDTH = 'vw',
  VIEWPORT_HEIGHT = 'vh',
  VIEWPORT_MAX = 'vmax',
  VIEWPORT_MIN = 'vmin',
  DPI = 'dpi',
  MILLIMETERS = 'mm',
  CENTIMETERS = 'cm',
  INCHES = 'in',
}

export function isGlobalUnit(unit: CssUnit) {
  return _isEqualitySameType(
    unit,
    null,
    CssUnit.INITIAL,
    CssUnit.UNSET,
    CssUnit.INHERIT,
    CssUnit.AUTO,
  )
}

/**
 * A CSS dimension split into the parts an editor can put on screen
 * (AGL-1219): a numeric quantity plus its unit, a bare keyword unit
 * (`auto`, `inherit`, …), or — when the string is richer than
 * `<number><unit>` — the original text under `raw`.
 *
 * `raw` is the escape hatch that keeps an editor from destroying what it
 * cannot model: `calc(100% - 2rem)`, `clamp(…)`, `min-content` and a
 * `{{token}}` binding all round-trip untouched instead of collapsing to
 * whatever a lenient parse happened to salvage.
 */
export interface CssDimension {
  /** Quantity, absent for keyword units and for unparsed (`raw`) values. */
  value?: number
  unit?: CssUnit
  /** Set ONLY when the value is not a plain `<number><unit>`. */
  raw?: string
}

const UNIT_BY_TOKEN: Record<string, CssUnit> = Object.fromEntries(
  Object.values(CssUnit).map((unit) => [`${unit}`.toLowerCase(), unit]),
)

/** Every unit the pickers offer, in enum order — ONE list, no second one. */
export const CSS_UNITS: CssUnit[] = Object.values(CssUnit)

/** `12`, `-4.5`, `.75` — the quantity, then its (possibly empty) unit. */
const CSS_DIMENSION_PATTERN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)$/i

/**
 * Splits a CSS dimension string into {@link CssDimension}. Anything that is
 * not empty, a keyword unit, or `<number><known unit>` comes back as `raw`
 * so callers can hand it straight back (AGL-1219).
 */
export function parseCssDimension(
  value: string | number | undefined | null,
): CssDimension {
  if (value === undefined || value === null) return {}
  const text = `${value}`.trim()
  if (!text) return {}

  const known = UNIT_BY_TOKEN[text.toLowerCase()]
  // A bare keyword (`auto`) is the whole value; `px` alone is not a value.
  if (known && isGlobalUnit(known)) return { unit: known }

  const match = CSS_DIMENSION_PATTERN.exec(text)
  if (!match) return { raw: text }

  const [, quantity, suffix] = match
  const unit = suffix ? UNIT_BY_TOKEN[suffix.toLowerCase()] : undefined
  // A recognized shape carrying an unrecognized unit (`10q`) is still
  // meaningful CSS — pass it through rather than dropping the unit.
  if (suffix && !unit) return { raw: text }

  const parsed = Number(quantity)
  if (!Number.isFinite(parsed)) return { raw: text }
  return { value: parsed, unit }
}

/**
 * Serializes a {@link CssDimension} back to the single CSS string that gets
 * persisted. The inverse of {@link parseCssDimension}: an empty dimension
 * serializes to an empty string, never to a partial value like `px`.
 */
export function buildCssDimension(dimension?: CssDimension): string {
  if (!dimension) return ''
  if (dimension.raw !== undefined) return dimension.raw
  if (dimension.unit && isGlobalUnit(dimension.unit)) return `${dimension.unit}`
  if (typeof dimension.value !== 'number' || !Number.isFinite(dimension.value)) {
    return ''
  }
  return `${dimension.value}${dimension.unit ?? ''}`
}

/**
 * CSS custom-property prefix MUI uses for palette entries — the same one
 * `theme.vars.palette.*` emits under the default `mui` cssVarPrefix.
 *
 * A gradient stop bound to a THEME TOKEN is persisted as
 * `var(--mui-palette-primary-main, #00B0FF)` (AGL-1331): `backgroundImage`
 * is not one of MUI's palette-keyed sx properties (only `color`, `bgcolor`
 * and `backgroundColor` are), so a bare `primary.main` inside a gradient
 * would reach CSS verbatim and the whole declaration would be dropped —
 * the exact silent failure this issue is about. A `var()` reference with a
 * literal fallback is valid CSS everywhere, so the worst case is the
 * fallback colour, never a vanished background.
 */
const PALETTE_CSS_VAR_PREFIX = '--mui-palette-'

/** A palette token reference parsed out of a `var()` expression. */
export interface PaletteTokenRef {
  /** Dot path into the palette, e.g. `primary.main`. */
  path: string
  /** Literal colour rendered when the custom property is undefined. */
  fallback?: string
}

/**
 * The CSS custom-property name a palette token path maps to:
 * `primary.main` becomes `--mui-palette-primary-main`, matching MUI's own
 * naming. Path segments are lowercase words in every token the picker
 * offers, so the `.`/`-` swap is exactly reversible by
 * {@link cssVarNameToPaletteToken}.
 */
export function paletteTokenToCssVarName(path: string): string {
  return `${PALETTE_CSS_VAR_PREFIX}${path.trim().split('.').join('-')}`
}

/** Inverse of {@link paletteTokenToCssVarName}; undefined for other vars. */
export function cssVarNameToPaletteToken(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed.startsWith(PALETTE_CSS_VAR_PREFIX)) return undefined
  const rest = trimmed.slice(PALETTE_CSS_VAR_PREFIX.length)
  return rest ? rest.split('-').join('.') : undefined
}

/** Builds the persisted form of a token-bound colour. */
export function paletteTokenToCssVar(path: string, fallback?: string): string {
  const name = paletteTokenToCssVarName(path)
  return fallback ? `var(${name}, ${fallback})` : `var(${name})`
}

/**
 * Reads a `var(--mui-palette-…[, fallback])` expression back into its token
 * path plus fallback. Anything else (a literal, a non-palette custom
 * property) returns undefined so callers treat it as a plain colour.
 */
export function parsePaletteTokenCssVar(
  value: string | undefined | null,
): PaletteTokenRef | undefined {
  if (!value) return undefined
  const text = `${value}`.trim()
  if (!text.toLowerCase().startsWith('var(') || !text.endsWith(')')) {
    return undefined
  }
  const [name, ...fallbackParts] = splitTopLevelArgs(text.slice(4, -1))
  if (name === undefined) return undefined
  const path = cssVarNameToPaletteToken(name)
  if (!path) return undefined
  const fallback = fallbackParts.join(', ').trim()
  return fallback ? { path, fallback } : { path }
}

export type CssGradientType = 'linear' | 'radial'

/** One colour stop of a gradient the Background field can edit. */
export interface CssGradientStop {
  /**
   * Stop colour: a literal (`#7A5CF0`, `rgb(…)`) or a palette token
   * reference from {@link paletteTokenToCssVar}. Both forms are allowed on
   * the same gradient — the marketing CTA's endpoints are tokens while its
   * mid stop has no token and stays a hex (AGL-1331).
   */
  color: string
  /** Position along the ramp in percent; omitted lets CSS distribute it. */
  position?: number
}

/**
 * A gradient split into the parts the Background field puts on screen
 * (AGL-1331) — the {@link CssDimension} idiom applied to `backgroundImage`.
 *
 * `raw` is the same escape hatch: a `conic-gradient`, a `to bottom right`
 * direction, a multi-position stop or a stacked image list round-trips
 * untouched instead of being flattened into whatever a lenient parse
 * salvaged.
 */
export interface CssGradient {
  type: CssGradientType
  /** Degrees, linear only. Absent means CSS's default (`to bottom`). */
  angle?: number
  stops: CssGradientStop[]
  /** Set ONLY when the value is a gradient this model cannot express. */
  raw?: string
}

/** Splits a CSS argument list on TOP-LEVEL commas, respecting nesting. */
function splitTopLevelArgs(text: string): string[] {
  const args: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    // A comma inside `var(--x, #fff)` or `rgba(0, 0, 0, .5)` belongs to
    // that function, not to the stop list.
    else if (char === ',' && depth === 0) {
      args.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  args.push(text.slice(start).trim())
  return args
}

const GRADIENT_FUNCTION_PATTERN =
  /^([a-z-]*gradient)\s*\(([\s\S]*)\)$/i
const GRADIENT_ANGLE_PATTERN = /^(-?\d+(?:\.\d+)?)deg$/i
const GRADIENT_STOP_PATTERN = /^([\s\S]+?)\s+(-?\d+(?:\.\d+)?)%$/

/** Whether a value is gradient-shaped — the check the colour fields reject on. */
export function isCssGradientValue(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /(^|\s)[a-z-]*gradient\s*\(/i.test(value.trim())
  )
}

/**
 * Splits a `backgroundImage` value into {@link CssGradient}. Returns
 * undefined when the value is empty or is not a gradient at all (a `url(…)`
 * image, say), and a `raw`-carrying gradient when it is one this model
 * cannot express — never a lossy approximation.
 */
export function parseCssGradient(
  value: string | undefined | null,
): CssGradient | undefined {
  if (value === undefined || value === null) return undefined
  const text = `${value}`.trim()
  if (!text || !isCssGradientValue(text)) return undefined

  const match = GRADIENT_FUNCTION_PATTERN.exec(text)
  const fn = match?.[1]?.toLowerCase()
  // Only the two the control can round-trip. `conic-gradient`,
  // `repeating-linear-gradient` and a comma-stacked image list all land in
  // `raw`, where the field shows the CSS verbatim rather than mangling it.
  if (!match || (fn !== 'linear-gradient' && fn !== 'radial-gradient')) {
    return { type: 'linear', stops: [], raw: text }
  }
  const type: CssGradientType = fn === 'radial-gradient' ? 'radial' : 'linear'
  const args = splitTopLevelArgs(match[2] ?? '').filter((arg) => arg !== '')
  const unparsed: CssGradient = { type, stops: [], raw: text }

  let angle: number | undefined
  let stopArgs = args
  const first = args[0] ?? ''
  const angleMatch = GRADIENT_ANGLE_PATTERN.exec(first)
  if (angleMatch) {
    if (type === 'radial') return unparsed
    angle = Number(angleMatch[1])
    stopArgs = args.slice(1)
  } else if (/^(to\s|at\s|circle|ellipse|closest|farthest|\d)/i.test(first)) {
    // A direction or shape/position prefix the control has no editor for.
    return unparsed
  }

  const stops: CssGradientStop[] = []
  for (const arg of stopArgs) {
    const stopMatch = GRADIENT_STOP_PATTERN.exec(arg)
    if (!stopMatch) {
      stops.push({ color: arg })
      continue
    }
    const color = stopMatch[1].trim()
    // A stop may carry TWO positions (`red 0% 40%`), which the two-box stop
    // editor cannot show. A colour that legitimately ends in a percentage
    // closes its own paren (`hsl(200 100% 50%)`), so a bare trailing `%`
    // here is always the first of a pair.
    if (/\d%$/.test(color)) return unparsed
    stops.push({ color, position: Number(stopMatch[2]) })
  }
  if (stops.length < 2) return unparsed
  return { type, angle, stops }
}

/**
 * Serializes a {@link CssGradient} back to the single CSS string persisted
 * under `backgroundImage`. The inverse of {@link parseCssGradient}: fewer
 * than two usable stops serializes to `''` (which clears the property)
 * rather than to a half-written `linear-gradient(` no parser accepts.
 */
export function buildCssGradient(gradient?: CssGradient): string {
  if (!gradient) return ''
  if (gradient.raw !== undefined) return gradient.raw
  const stops = (gradient.stops ?? []).filter((stop) =>
    Boolean(stop?.color?.trim()),
  )
  if (stops.length < 2) return ''
  const parts = stops.map((stop) =>
    typeof stop.position === 'number' && Number.isFinite(stop.position)
      ? `${stop.color.trim()} ${stop.position}%`
      : stop.color.trim(),
  )
  if (gradient.type === 'radial') return `radial-gradient(${parts.join(', ')})`
  const angle =
    typeof gradient.angle === 'number' && Number.isFinite(gradient.angle)
      ? `${gradient.angle}deg, `
      : ''
  return `linear-gradient(${angle}${parts.join(', ')})`
}

/** Function forms that produce an IMAGE, not a `<color>`. */
const NON_COLOR_FUNCTION_PATTERN =
  /^(url|image|image-set|cross-fade|element|paint|[a-z-]*gradient)$/i
const CSS_HEX_COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i
/** A bare keyword (`red`, `transparent`) or a palette token path. */
const CSS_COLOR_IDENT_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/i
const CSS_FUNCTION_PATTERN = /^([a-z][a-z0-9-]*)\s*\([\s\S]*\)$/i

/**
 * Why a value cannot be a colour, or undefined when it can (AGL-1331).
 *
 * The colour fields' real contract is "a palette token path (`primary.main`)
 * or a valid CSS `<color>`". Before this, `getStrValue` handed any string
 * through, the form was `noValidate`, and a gradient typed into Background
 * Color was stored as `background-color: linear-gradient(…)` — which the
 * CSS parser drops, leaving a transparent element and no error anywhere.
 *
 * Deliberately permissive about what a colour IS: any function form is
 * accepted except the image-producing ones, so `color-mix()`, `oklch()` and
 * whatever CSS adds next are never rejected by a stale allowlist. The job
 * here is to catch the value that would VANISH, not to re-implement the CSS
 * colour grammar.
 */
export function describeCssColorProblem(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = `${value}`.trim()
  if (!text) return undefined
  if (isCssGradientValue(text)) {
    return (
      'A gradient is not a color — this would be dropped by the browser. ' +
      'Use the Background Fill field to build one.'
    )
  }
  if (CSS_HEX_COLOR_PATTERN.test(text)) return undefined
  if (CSS_COLOR_IDENT_PATTERN.test(text)) return undefined
  const fn = CSS_FUNCTION_PATTERN.exec(text)
  if (fn && !NON_COLOR_FUNCTION_PATTERN.test(fn[1])) return undefined
  return (
    'Not a color — this would be dropped by the browser. Type a hex value ' +
    '(#161C21) or an rgb()/hsl() color, or pick a theme color.'
  )
}

export function parseCssMeasurement(value: string | undefined): Measurement {
  if (!value || !_isStrT(value)) return { value: undefined, unit: undefined }
  // Routed through the AGL-1219 parser so the editor and the box styler
  // never disagree about what `1.5rem` means. The hand-rolled regex pair
  // this replaced split off the leading integer only, so a decimal came
  // back as `1` + `.5rem`, and the quantity came back as a STRING — which
  // `buildCssMeasurement`'s numeric guard rejected, wiping the number
  // whenever only the unit was changed.
  const { value: quantity, unit } = parseCssDimension(value)
  return { value: quantity, unit }
}

export function buildCssMeasurement(
  measurement: Measurement,
): string | undefined {
  if (measurement?.unit && isGlobalUnit(measurement?.unit as any)) {
    return `${measurement.unit}`
  }
  if (_isNum(measurement?.value) && measurement?.unit) {
    return `${measurement.value}${measurement?.unit}`
  }

  return undefined
}

export interface Measurement {
  unit?: CssUnit
  value?: number
}
