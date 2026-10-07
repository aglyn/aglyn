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
 * A GTIN's check digit (AGL-3637). Google, Microsoft and Meta refuse a GTIN
 * whose last digit is not the GS1 check digit of the rest, and a refused
 * identifier can take the whole offer down with it, so a feed sends only a
 * GTIN that passes and diagnostics names the one that does not.
 */

const LENGTHS = new Set([8, 12, 13, 14])

/** Whether `value` is a GTIN-8, -12, -13 or -14 with a correct check digit. */
export function isValidGtin(value: string | undefined | null): boolean {
  const digits = String(value ?? '')
  if (!/^\d+$/.test(digits) || !LENGTHS.has(digits.length)) return false
  // All zeros passes the arithmetic and is no product's number.
  if (/^0+$/.test(digits)) return false
  const body = digits.slice(0, -1)
  let sum = 0
  // Weights 3,1,3,1… from the digit next to the check digit, leftwards.
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index])
    sum += digit * (index % 2 === 0 ? 3 : 1)
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(digits[digits.length - 1])
}
