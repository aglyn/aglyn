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

/**
 * A FLAT, merchant-entered rate for a regime the goods sales-tax machinery
 * above does not describe (AGL-1969 lodging, AGL-2028 services).
 *
 * ## Why this is not another `TaxRate`
 *
 * `rates[]` is a SALES tax table resolved against an address, most-specific
 * first. Lodging (occupancy/hotel tax) and service tax are separate regimes
 * with their own rates, their own registration and their own return, and the
 * number a merchant typed into the goods table is not the right number for a
 * night or an appointment. Reading `rates[]` for either would be confidently
 * wrong rather than merely absent — which is exactly why `reserve.ts` and
 * `bookings/server.ts` charged nothing at all until the merchant was given a
 * field of their own to answer in.
 *
 * ## Off is the default and the default is load-bearing
 *
 * An absent, zero, negative, non-finite or out-of-range `pct` resolves to
 * ZERO. Nothing an existing merchant is charging today moves because this
 * shipped; a rate applies only once a merchant has typed one and saved.
 *
 * ## It is always MANUAL, in every store mode
 *
 * Deliberately independent of `TaxSettings.mode`. Stripe Tax cannot compute
 * either regime from these sessions — it needs a lodging or service tax code
 * no handler here sends — so a `mode: 'stripe'` store would otherwise have no
 * way to collect them at all. Riding as an ordinary line item makes the
 * derived `taxMode` read `manual`: the merchant's own rate, never computed
 * against Aglyn's registrations (AGL-1904).
 *
 * ## Aglyn takes NO position on what is owed
 *
 * This is a calculator the merchant configures, records and can read back. It
 * states no view on whether a jurisdiction imposes the tax, on who must
 * register, or on who must remit — those attach by operation of law and
 * belong to counsel (AGL-1904/AGL-1956), and Terms §10.3 already puts the
 * question on the merchant. The merchant-facing copy says only that.
 */
export interface FlatTaxRate {
  /** Percent, e.g. 6. Absent or non-positive = off, which is the default. */
  pct?: number
  /** Receipt label, e.g. 'Occupancy tax'. */
  label?: string
}

/** What a flat rate resolved to for one charge. */
export interface ResolvedFlatTax {
  taxCents: number
  /** The label to put on the receipt line; empty when there is no tax. */
  label: string
  /** The percentage actually applied — 0 when the rate is off or invalid. */
  pct: number
}

/**
 * The highest percentage this accepts. A rate above 100% is a decimal-point
 * typo (`825` for `8.25`), not a jurisdiction, and multiplying a guest's
 * deposit by nine because of one is a far worse failure than collecting
 * nothing. Out of range resolves to OFF rather than being clamped to a number
 * the merchant did not choose — and the editor says so on screen, so the
 * refusal is never silent.
 */
export const FLAT_TAX_MAX_PCT = 100

/** True when a typed percentage is one this will actually apply. */
export function isUsableFlatTaxPct(pct: unknown): boolean {
  const value = Number(pct)
  return Number.isFinite(value) && value > 0 && value <= FLAT_TAX_MAX_PCT
}

/**
 * Tax cents for a flat merchant rate on one charged amount, EXCLUSIVE — added
 * on top of the price, never back-calculated out of it.
 *
 * `pricesIncludeTax` is deliberately not consulted: it is a goods-pricing
 * setting, and honouring it here would mean a merchant types a lodging rate,
 * saves, and the guest's total does not move — a setting that reads as
 * configured while collecting nothing is the AGL-1999 failure restated.
 *
 * Pure and total. Unusable input answers zero and never throws.
 */
export function resolveFlatTaxCents(
  rate: FlatTaxRate | undefined | null,
  chargeCents: number,
  fallbackLabel: string,
): ResolvedFlatTax {
  const pct = Number(rate?.pct)
  if (!isUsableFlatTaxPct(pct)) return { taxCents: 0, label: '', pct: 0 }
  const taxCents = computeTaxCents(chargeCents, pct, false)
  if (!(taxCents > 0)) return { taxCents: 0, label: '', pct: 0 }
  return {
    taxCents,
    label: (rate?.label || fallbackLabel).slice(0, 120),
    pct,
  }
}

export interface TaxSettings {
  /**
   * 'manual' rates below, 'stripe' for Stripe Tax automatic, or 'none' —
   * an EXPLICIT decision not to collect (AGL-1999). `undefined` is not a
   * fourth mode: it means nobody has decided, and `storefrontTaxDecision`
   * refuses the sale rather than zero-rating it silently.
   */
  mode?: 'manual' | 'stripe' | 'none'
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
  /**
   * OCCUPANCY / LODGING tax on a reservation deposit (AGL-1969). Off unless
   * the merchant sets it — see `FlatTaxRate`. Read by `reserve.ts` only.
   */
  lodging?: FlatTaxRate
  /**
   * SERVICE tax on a paid booking (AGL-2028). Off unless the merchant sets
   * it — see `FlatTaxRate`. Read by the bookings plugin only.
   *
   * ITS EXISTENCE IS THE OPT-IN. AGL-2000 declined to apply the goods
   * `rates[]` to an appointment partly because nothing said the merchant
   * meant those settings to cover bookings — they are another plugin's
   * surface. A field of its own, labelled for services and blank until
   * somebody fills it in, is the merchant saying so explicitly. Reading
   * `rates[]` for a booking is still wrong and still nothing does it.
   */
  service?: FlatTaxRate
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
