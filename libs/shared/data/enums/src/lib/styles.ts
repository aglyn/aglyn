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

import { _isEqualitySameType, _isNum, _isStrT } from '@aglyn/shared-util-guards'

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

export function parseCssMeasurement(value: string | undefined): Measurement {
  const result: Measurement = { quantity: undefined, unit: undefined }
  if (!value || !_isStrT(value)) return result
  if (isGlobalUnit(value as any)) {
    result.unit = `${value}` as any
  } else {
    result.quantity = `${value}`.replace(/\D+$/, '') as any
    result.unit = `${value}`.replace(/^-?\d+/, '') as any
  }
  return result
}

export function buildCssMeasurement(
  measurement: Measurement,
): string | undefined {
  if (measurement?.unit && isGlobalUnit(measurement?.unit as any)) {
    return `${measurement.unit}`
  }
  if (_isNum(measurement?.quantity) && measurement?.unit) {
    return `${measurement.quantity}${measurement?.unit}`
  }

  return undefined
}

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

export type Measurement = {
  quantity?: number
  unit: CssUnit
}
