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
 * Taxes v1 (AGL-285): manual rates per region resolved most-specific
 * first (country+state beats country), or Stripe Tax automatic
 * calculation when the host opts in. Settings live on the
 * `hosts/{hostId}/settings/store` doc under `tax`. Pure — checkout and
 * POS call these; Stripe Tax mode bypasses them entirely.
 */

export interface TaxRate {
  /** ISO-3166 alpha-2, e.g. 'US'. */
  country: string
  /** Region/state code, e.g. 'TX'; absent = whole country. */
  state?: string
  /** Percent, e.g. 8.25. */
  pct: number
  /** Receipt label, e.g. 'TX sales tax'. */
  label?: string
}

export interface TaxSettings {
  /** 'manual' rates below, or 'stripe' for Stripe Tax automatic. */
  mode?: 'manual' | 'stripe'
  /** Displayed prices already include tax (VAT-style). */
  pricesIncludeTax?: boolean
  /**
   * Store origin (AGL-285): the legacy single-product checkout taxes by
   * origin because the buyer address arrives inside Stripe Checkout;
   * Checkout v2 (AGL-296) collects the address first and taxes by
   * destination.
   */
  origin?: TaxAddress
  rates?: TaxRate[]
}

export interface TaxAddress {
  country?: string
  state?: string
}

/** Most-specific matching rate, or null (no tax). */
export function resolveTaxRate(
  settings: TaxSettings | undefined,
  address: TaxAddress,
): TaxRate | null {
  if (!settings || settings.mode === 'stripe') return null
  const country = (address.country ?? '').toUpperCase()
  const state = (address.state ?? '').toUpperCase()
  if (!country) return null
  let match: TaxRate | null = null
  for (const rate of settings.rates ?? []) {
    if (rate.country.toUpperCase() !== country) continue
    if (rate.state) {
      if (rate.state.toUpperCase() === state) return rate
      continue
    }
    match = match ?? rate
  }
  return match
}

/**
 * Tax cents for a taxable amount. Exclusive pricing adds on top;
 * inclusive pricing back-calculates the contained tax (for receipts —
 * the charge total does not change).
 */
export function computeTaxCents(
  taxableCents: number,
  pct: number,
  pricesIncludeTax = false,
): number {
  if (!(pct > 0) || !(taxableCents > 0)) return 0
  if (pricesIncludeTax) {
    return Math.round(taxableCents - taxableCents / (1 + pct / 100))
  }
  return Math.round((taxableCents * pct) / 100)
}
