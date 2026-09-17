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

import type {
  ConsoleImportColumn,
  ConsoleImportColumnShape,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'

/**
 * WHAT A FILE'S COLUMN HOLDS, WITHOUT SAYING WHAT IS IN IT (AGL-2917).
 *
 * The import drawer's `importMapping` zone tells a widget each column's header
 * and one word for its values — an email address, a phone number, a date —
 * and never a cell. The word is read here, in the browser, from the rows the
 * drawer already parsed, so a widget that asks a model to match the columns
 * has nothing of the file's people to pass on.
 */

/** Non-empty cells a column's shape is read from. */
export const IMPORT_SHAPE_SAMPLE = 50

/** Rows a column's cells are looked for in; past these a file says nothing new about its shape. */
export const IMPORT_SHAPE_ROWS = 500

/** The share of those cells that must agree for a column to take a shape. */
export const IMPORT_SHAPE_AGREEMENT = 0.8

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const YES_NO = /^(?:yes|no|y|n|true|false|opted in|opted out|subscribed|unsubscribed)$/i
const NUMBER = /^[-+]?[$€£¥]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/
const DATE =
  /^(?:\d{4}-\d{1,2}-\d{1,2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})$/i
const PHONE = /^\+?[\d\s().-]{7,}$/
const URL = /^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i

const SHAPES: ReadonlyArray<[ConsoleImportColumnShape, (value: string) => boolean]> = [
  ['email', (value) => EMAIL.test(value)],
  ['yes-no', (value) => YES_NO.test(value)],
  ['date', (value) => DATE.test(value)],
  ['number', (value) => NUMBER.test(value)],
  ['phone', (value) => PHONE.test(value) && value.replace(/\D/g, '').length >= 7],
  ['url', (value) => URL.test(value)],
]

/** One column's shape, from its cells: the first shape most of them agree on, else `text`. */
export function importColumnShape(cells: readonly unknown[]): ConsoleImportColumnShape {
  const values = cells
    .map((cell) => String(cell ?? '').trim())
    .filter(Boolean)
    .slice(0, IMPORT_SHAPE_SAMPLE)
  if (!values.length) return 'empty'
  for (const [shape, test] of SHAPES) {
    const agreeing = values.filter(test).length
    if (agreeing / values.length >= IMPORT_SHAPE_AGREEMENT) return shape
  }
  return 'text'
}

/** Every column of a parsed file: its header, and the shape of what the rows under it hold. */
export function importColumns(
  headers: readonly string[],
  rows: ReadonlyArray<readonly unknown[]>,
): ConsoleImportColumn[] {
  const sample = rows.slice(0, IMPORT_SHAPE_ROWS)
  return headers.map((header, index) => ({
    header: String(header ?? '').trim(),
    shape: importColumnShape(sample.map((row) => row[index])),
  }))
}
