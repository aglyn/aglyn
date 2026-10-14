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

import {
  formatFunctionParameterOptions,
  type HostFunctionParameterOption,
  parseFunctionParameterOptions,
} from '@aglyn/aglyn'

/**
 * A parameter's choice list as one line of text (AGL-3202). The grammar lives
 * in core — `parseFunctionParameterOptions` — because the canvas's Function
 * Input element reads the same line and a plugin may not import another. These
 * are the names the function builder has always called it by.
 */
export function parseParameterOptions(
  text: string,
): HostFunctionParameterOption[] {
  return parseFunctionParameterOptions(text)
}

/** The inverse, for showing a stored list in that one line. */
export function formatParameterOptions(
  options: HostFunctionParameterOption[] | undefined,
): string {
  return formatFunctionParameterOptions(options)
}

/** One row of the choices editor, blanks and all, as the author sees it. */
export interface ParameterChoiceRow {
  /** What the function receives. */
  value: string
  /** What the visitor reads; the value when blank. */
  label: string
}

/** The rows a stored choice list opens as. */
export function choiceRowsFromOptions(
  options: HostFunctionParameterOption[] | undefined,
): ParameterChoiceRow[] {
  return (options ?? []).map((option) => ({
    value: option.value,
    label: option.label ?? '',
  }))
}

/**
 * The choice list rows store as (AGL-3768) — the same shape the one-line
 * grammar produced. A row with no value is not a choice yet; the second row
 * of a value is dropped, since a list cannot tell the function which of two
 * identical values was picked; a label equal to its value is not stored.
 */
export function optionsFromChoiceRows(
  rows: readonly ParameterChoiceRow[],
): HostFunctionParameterOption[] {
  const options: HostFunctionParameterOption[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const value = row.value.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    const label = row.label.trim()
    options.push(label && label !== value ? { value, label } : { value })
  }
  return options
}
