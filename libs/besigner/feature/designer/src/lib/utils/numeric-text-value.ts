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

/**
 * Text that is ENTIRELY a number — the only shape a text control stores as
 * a number.
 *
 * Deliberately narrower than `Number()` would accept: no exponent form, no
 * `Infinity`, no hex. Those parse to a number and are not values any of the
 * designer's controls offer, so converting them would only make the stored
 * value harder to read back than the text the author actually typed.
 */
export const NUMERIC_TEXT_VALUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

/**
 * The NUMBER a control's text stands for, or the value unchanged.
 *
 * Every free-text control in the designer can only hand back a string, and
 * for the values whose type carries meaning that changes what the value
 * DOES: MUI multiplies a number by a theme unit and passes a string through
 * verbatim, so `fontSize: 24` renders 24px while `fontSize: '24'` is not
 * CSS at all and the declaration is dropped. Both panels that write those
 * values normalize through here so the rule reads the same in each.
 *
 * Whitespace around an otherwise numeric value is incidental to typing and
 * is dropped with it; text carrying any non-numeric character (`8px`,
 * `50%`, `span 2`, a `{{var:id}}` binding) is what the author wrote and
 * comes back untouched, whitespace and all.
 */
export function numericTextValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!NUMERIC_TEXT_VALUE.test(text)) return value
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric : value
}
