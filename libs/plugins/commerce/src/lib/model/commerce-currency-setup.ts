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
  convertMinor,
  crossRate,
  currencyRate,
  CURRENCY_NAMES,
  currencyMinorFactor,
  formatShopperMoney,
  SELLABLE_CURRENCIES,
  storeCurrencies,
  type CurrencyRounding,
  type FxRates,
  type StoreCurrency,
  type StoreCurrencySettings,
} from './commerce-currency'

/**
 * The merchant's side of multi-currency selling (AGL-4248): what the console's
 * Currencies card, product editor, add-on editor and shipping rates need to
 * set a store up, the way Shopify Markets lets a merchant do it from screens.
 * Pure.
 */

/** What `GET commerce/currency?setup=1` answers the console with. */
export interface CurrencySetupAnswer {
  base: string
  /** The store's saved settings, as stored. */
  settings: StoreCurrencySettings | null
  /** Every rate the platform holds, so a currency not yet saved can be previewed. */
  allRates: FxRates | null
}

/** The currencies a store sells in besides its own (empty when off). */
export function otherStoreCurrencies(
  settings: StoreCurrencySettings | undefined | null,
  base: string,
): StoreCurrency[] {
  return storeCurrencies(settings ?? undefined, base).slice(1)
}

/** The currencies a merchant may still add: sellable, not the store's, not added. */
export function addableCurrencies(base: string, added: readonly string[]): string[] {
  return SELLABLE_CURRENCIES.filter((code) => code !== base && !added.includes(code))
}

/** "NZD · New Zealand dollar". */
export function currencyOptionLabel(code: string): string {
  const name = CURRENCY_NAMES[code]
  return name ? `${code} · ${name}` : code
}

/**
 * A currency as the console adds it, the way Shopify Markets does: the daily
 * rate, no rounding until the merchant turns it on, no price adjustment.
 */
export function newStoreCurrency(code: string): StoreCurrency {
  return { code, rounding: 'none', bufferPct: 0 }
}

/** The endings a merchant may round converted prices to, once rounding is on. */
export const CURRENCY_ROUNDING_ENDINGS: readonly Exclude<CurrencyRounding, 'none'>[] = ['99', '95', 'whole']

/** A price adjustment as typed, kept within -90 to +100 percent; blank is none. */
export function clampAdjustmentInput(raw: string): number {
  const value = Number(String(raw).trim().replace(',', '.'))
  if (!Number.isFinite(value) || value === 0) return 0
  return Math.max(-90, Math.min(100, Math.round(value * 100) / 100))
}

/** A manual exchange rate as typed: blank (or not a positive number) is the daily rate. */
export function parseManualRateInput(raw: string): number | undefined {
  const value = Number(String(raw ?? '').trim().replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * What rate a currency converts at, said on its card: "Daily rate 1.7041,
 * updated Nov 25", "Manual rate 1.7500", or that no daily rate is in yet.
 */
export function currencyRateLabel(
  rates: FxRates | undefined | null,
  base: string,
  entry: StoreCurrency,
): string {
  if (entry.manualRate && entry.manualRate > 0) return `Manual rate ${entry.manualRate.toFixed(4)}`
  const daily = crossRate(rates ?? undefined, base, entry.code)
  if (daily == null) return `No daily rate for ${entry.code} yet`
  const asOf = ratesAsOfLabel(rates)
  return `Daily rate ${daily.toFixed(4)}${asOf ? `, updated ${asOf}` : ''}`
}

/** The daily rate alone, for a manual-rate field's helper text. */
export function dailyRateLabel(rates: FxRates | undefined | null, base: string, code: string): string {
  return currencyRateLabel(rates, base, { code })
}

/**
 * A price as typed in a currency's field: `undefined` for blank (converted
 * automatically), `null` for something that is not a price.
 */
export function parseMajorInput(raw: string): number | undefined | null {
  const text = String(raw ?? '').trim().replace(',', '.')
  if (text === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * A per-currency map with one currency set or cleared. A cleared one is
 * dropped, and an empty map is `undefined`, so the caller removes the field
 * instead of storing `undefined` (client-direct writes refuse one).
 */
export function withCurrencyAmount(
  map: Readonly<Record<string, number>> | undefined,
  code: string,
  value: number | undefined,
): Record<string, number> | undefined {
  const next = { ...(map ?? {}) }
  if (value == null) delete next[code]
  else next[code] = value
  return Object.keys(next).length ? next : undefined
}

/** A minor amount as a field shows it in that currency: "449.00", "5400". */
export function minorToInput(minor: number | undefined, code: string): string {
  if (minor == null || !Number.isFinite(minor)) return ''
  const factor = currencyMinorFactor(code)
  return factor === 1 ? String(Math.round(minor)) : (minor / factor).toFixed(2)
}

/** A major amount as typed, in minor units of that currency. */
export function majorToMinor(major: number, code: string): number {
  return Math.round(major * currencyMinorFactor(code))
}

/** "Nov 25", in UTC, the day the reference rate was published. */
export function ratesAsOfLabel(rates: FxRates | undefined | null): string {
  if (!rates?.asOfMs) return ''
  return new Date(rates.asOfMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The line under each currency on the Currencies card:
 * "$250.00 → NZ$426.03 (rate 1.7041, as of Nov 25)", or "(manual rate
 * 1.7500)". The rate shown is the one in use; the price adjustment and
 * rounding are what move the price from it.
 */
export function currencyPreviewText(
  sampleMinor: number,
  base: string,
  entry: StoreCurrency,
  rates: FxRates | undefined | null,
): string {
  const from = formatShopperMoney(sampleMinor, base)
  const rate = currencyRate(rates ?? undefined, base, entry)
  const converted = rate == null ? undefined : convertMinor(sampleMinor, base, entry, rates ?? undefined)
  if (rate == null || converted == null) {
    return `${from} → no rate for ${entry.code} yet; shoppers pay in ${base} until there is one`
  }
  const to = formatShopperMoney(converted, entry.code, { disambiguate: true })
  if (entry.manualRate && entry.manualRate > 0) {
    return `${from} → ${to} (manual rate ${rate.toFixed(4)})`
  }
  const asOf = ratesAsOfLabel(rates)
  return `${from} → ${to} (rate ${rate.toFixed(4)}${asOf ? `, as of ${asOf}` : ''})`
}
