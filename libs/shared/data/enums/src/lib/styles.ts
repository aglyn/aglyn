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
