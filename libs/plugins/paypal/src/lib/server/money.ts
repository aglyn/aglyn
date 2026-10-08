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
 * Integer minor units ↔ PayPal's decimal strings (AGL-3630). Never a float:
 * `19.99 * 100` is `1998.9999999999998`, and a cent lost or invented on the
 * way to a payment processor is the one rounding error nobody can take back.
 */

/**
 * The currencies PayPal accepts for a checkout, lower case. A store in any
 * other currency is not offered PayPal at all.
 */
export const PAYPAL_CURRENCIES = new Set([
  'aud', 'brl', 'cad', 'cny', 'czk', 'dkk', 'eur', 'hkd', 'huf', 'ils', 'jpy', 'myr', 'mxn',
  'twd', 'nzd', 'nok', 'php', 'pln', 'gbp', 'sgd', 'sek', 'chf', 'thb', 'usd',
])

/** PayPal's currencies with no minor unit: an amount is sent whole. */
const ZERO_DECIMAL = new Set(['huf', 'jpy', 'twd'])

/** Venmo takes US dollars only. */
export const VENMO_CURRENCY = 'usd'

/** Digits after the point PayPal expects for a currency. */
export function payPalDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2
}

/**
 * A PayPal money object from whole minor units. For a zero-decimal currency
 * the minor unit IS the whole unit, as commerce stores it.
 */
export function payPalMoney(minor: number, currency: string): { currency_code: string; value: string } {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`PayPal amounts are whole non-negative minor units, got ${minor}`)
  }
  const decimals = payPalDecimals(currency)
  const digits = String(minor)
  const value =
    decimals === 0
      ? digits
      : `${digits.length > decimals ? digits.slice(0, -decimals) : '0'}.${digits.padStart(decimals, '0').slice(-decimals)}`
  return { currency_code: currency.toUpperCase(), value }
}

/**
 * Whole minor units from a PayPal money object, or `null` when it is not
 * one in `currency`. Parsed as text, so `"0.30"` is 30 and never 29.
 */
export function minorFromPayPal(money: unknown, currency: string): number | null {
  const object = money as { currency_code?: unknown; value?: unknown } | null
  if (!object || String(object.currency_code ?? '').toLowerCase() !== currency.toLowerCase()) return null
  const text = String(object.value ?? '').trim()
  const decimals = payPalDecimals(currency)
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null
  const fraction = match[2] ?? ''
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) return null
  const minor = Number(match[1] + fraction.slice(0, decimals).padEnd(decimals, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}
