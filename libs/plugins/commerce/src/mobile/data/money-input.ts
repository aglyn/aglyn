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

/*
 * Money typed on a phone keypad, as the integer minor units every route
 * takes (AGL-3621). The store's currency decides the decimals: a yen amount
 * has none, a dinar's has three.
 */

export function currencyDigits(currency: string | undefined): number {
  try {
    return (
      new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD').toUpperCase() }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** `"12.50"`, `"$1,200"`, `"12,5"` as minor units; null when it is not an amount. */
export function minorUnitsFromText(text: string, currency?: string): number | null {
  const digits = currencyDigits(currency)
  let cleaned = String(text ?? '').replace(/[^\d.,]/g, '')
  // A lone comma followed by one or two digits is a decimal comma.
  if (!cleaned.includes('.') && /,\d{1,3}$/.test(cleaned) && (cleaned.match(/,/g) ?? []).length === 1) {
    const [whole, fraction] = cleaned.split(',')
    if (fraction.length !== 3 || digits === 3) cleaned = `${whole}.${fraction}`
  }
  cleaned = cleaned.replace(/,/g, '')
  if (!cleaned || !/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '.') return null
  const [whole = '0', fraction = ''] = cleaned.split('.')
  if (fraction.length > digits) return null
  const value = Number(whole || '0') * 10 ** digits + Number((fraction + '0'.repeat(digits)).slice(0, digits) || '0')
  return Number.isSafeInteger(value) ? value : null
}

/** Minor units as the text a keypad field starts with: `12.50`, `1200`. */
export function textFromMinorUnits(units: number, currency?: string): string {
  const digits = currencyDigits(currency)
  const safe = Math.max(0, Math.round(Number(units) || 0))
  return digits ? (safe / 10 ** digits).toFixed(digits) : String(safe)
}
