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
 * Money between the store and an inventory system (AGL-3642).
 *
 * The store keeps integer minor units (cents for USD). Cin7 Core, inFlow and
 * Brightpearl all take and answer decimal amounts in major units. Every
 * conversion goes through here, so a zero-decimal currency (JPY) is never
 * sent a hundred times over.
 */

/** ISO 4217 currencies with no minor unit, as Stripe lists them. */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])

/** Digits after the point for a currency. */
export const currencyDigits = (currency: string): number => (ZERO_DECIMAL.has(String(currency).toUpperCase()) ? 0 : 2)

/** Integer minor units as a decimal string the systems read, e.g. `1999` USD → `"19.99"`. */
export function minorToDecimal(minor: number, currency: string): string {
  const digits = currencyDigits(currency)
  const value = Math.round(Number(minor) || 0)
  return digits ? (value / 10 ** digits).toFixed(digits) : String(value)
}

/** Integer minor units as a number in major units, for a system that wants a JSON number. */
export const minorToMajor = (minor: number, currency: string): number => Number(minorToDecimal(minor, currency))

/**
 * A decimal amount a system answered (`"19.99"`, `19.99`, `"1,299.00"`) as
 * integer minor units, or `null` when it is missing or not a number.
 */
export function decimalToMinor(value: unknown, currency: string): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 10 ** currencyDigits(currency))
}
