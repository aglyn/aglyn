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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'

/**
 * Multi-currency on the server (AGL-4248): the daily reference rates, one
 * platform document every store reads, and the shopper-currency context a
 * checkout prices in.
 */

/** The ECB's daily reference rates (free, no key): per 1 EUR, about 16:00 CET. */
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

const RATES_DOC = ['platform', 'fxRates'] as const

let cached: { rates: CommerceModel.FxRates | undefined; atMs: number } | undefined
const CACHE_MS = 10 * 60 * 1000

function ratesRef() {
  return firebaseAdmin.app().firestore().collection(RATES_DOC[0]).doc(RATES_DOC[1])
}

/** The stored rates, cached in memory for ten minutes. */
export async function loadFxRates(nowMs = Date.now()): Promise<CommerceModel.FxRates | undefined> {
  if (cached && nowMs - cached.atMs < CACHE_MS) return cached.rates
  try {
    const snap = await ratesRef().get()
    const data = snap.data() as CommerceModel.FxRates | undefined
    const rates = data?.rates && data.base ? data : undefined
    cached = { rates, atMs: nowMs }
    return rates
  } catch (error) {
    console.error('commerce: fx rates read failed', error)
    return cached?.rates
  }
}

/** Test seam. */
export function resetFxRatesCache(): void {
  cached = undefined
}

/**
 * Fetch the ECB file and store it when it is newer than what is stored.
 * Returns what is stored afterwards.
 */
export async function refreshFxRates(
  fetchImpl: typeof fetch = fetch,
): Promise<CommerceModel.FxRates | undefined> {
  const response = await fetchImpl(ECB_DAILY_URL, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`ECB rates answered ${response.status}`)
  const parsed = CommerceModel.parseEcbDailyXml(await response.text())
  if (!parsed) throw new Error('ECB rates file had no rates')
  const current = await loadFxRates(0)
  if (current && current.asOfMs >= parsed.asOfMs) return current
  await ratesRef().set({ ...parsed, fetchedAtMs: Date.now() })
  cached = { rates: parsed, atMs: Date.now() }
  return parsed
}

/** What a store sells in, read once per request from `settings/store`. */
export interface StoreCurrencyContext {
  base: string
  settings: CommerceModel.StoreCurrencySettings | undefined
  rates: CommerceModel.FxRates | undefined
}

export function storeCurrencyContextFrom(
  store: Record<string, unknown> | undefined,
  rates: CommerceModel.FxRates | undefined,
): StoreCurrencyContext {
  return {
    base: CommerceModel.storeBaseCurrency(store as { currency?: unknown }),
    settings: store?.['currencies'] as CommerceModel.StoreCurrencySettings | undefined,
    rates,
  }
}

/**
 * The currency a checkout charges in, from what the storefront asked for:
 * the store currency unless the store sells in the requested one AND fresh
 * rates cover it. Never throws; a stale rate charges the store currency.
 */
export interface CheckoutCurrency {
  /** Upper case, as stored on the order. */
  code: string
  base: string
  /** The currency's settings (rounding, buffer, tax-inclusive). */
  entry: CommerceModel.StoreCurrency
  /** Units of `code` per unit of `base`, before any buffer. 1 for the store currency. */
  rate: number
  rates: CommerceModel.FxRates | undefined
  /** Whether this checkout charges in another currency than the store's. */
  foreign: boolean
}

export function resolveCheckoutCurrency(
  context: StoreCurrencyContext,
  requested: unknown,
  nowMs = Date.now(),
): CheckoutCurrency {
  const base = context.base
  const baseEntry: CommerceModel.StoreCurrency = { code: base, rounding: 'none' }
  const entry = CommerceModel.storeSellsIn(context.settings, base, requested)
  const rate = entry ? CommerceModel.currencyRate(context.rates, base, entry) : undefined
  if (
    !entry ||
    entry.code === base ||
    rate == null ||
    // A manual rate never goes stale; a daily one does.
    (!entry.manualRate && !CommerceModel.ratesAreFresh(context.rates, nowMs))
  ) {
    return { code: base, base, entry: baseEntry, rate: 1, rates: context.rates, foreign: false }
  }
  return { code: entry.code, base, entry, rate, rates: context.rates, foreign: true }
}

/** A store-currency price (major, `priceUsd`) for a variant in the checkout currency, minor units. */
export function checkoutVariantMinor(
  currency: CheckoutCurrency,
  variant: { priceUsd?: number; fixedPrices?: Record<string, number> },
): number {
  if (!currency.foreign) return Math.round(Number(variant.priceUsd ?? 0) * 100)
  return (
    CommerceModel.variantPriceMinor(variant, currency.base, currency.entry, currency.rates) ??
    Math.round(Number(variant.priceUsd ?? 0) * 100)
  )
}

/** A store-currency amount (minor) for an add-on, fee or shipping in the checkout currency. */
export function checkoutAmountMinor(
  currency: CheckoutCurrency,
  baseMinor: number,
  fixedMinor?: Record<string, number>,
): number {
  if (!currency.foreign) return Math.round(baseMinor)
  return (
    CommerceModel.amountMinorIn(baseMinor, currency.base, currency.entry, currency.rates, fixedMinor) ??
    Math.round(baseMinor)
  )
}

/** A checkout-currency amount back in the store currency (minor), for the merchant's figures. */
export function toBaseMinor(currency: CheckoutCurrency, minor: number): number {
  if (!currency.foreign) return Math.round(minor)
  const factorFrom = CommerceModel.currencyMinorFactor(currency.code)
  const factorTo = CommerceModel.currencyMinorFactor(currency.base)
  return Math.round(((minor / factorFrom) / currency.rate) * factorTo)
}

/** The Stripe-side code (lower case). */
export function stripeCurrency(currency: CheckoutCurrency): string {
  return currency.code.toLowerCase()
}

/**
 * `GET commerce/currency?hostId=` — the public answer a storefront prices
 * from: which currencies the store sells in, its rounding rules, and the
 * day's rates for exactly those. CDN-cached ten minutes: it changes daily.
 * With `setup=1`, the console's setup answer instead: the stored settings
 * and every rate (all public: the ECB publishes them), never cached.
 */
export const currencyHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  try {
    const [storeSnap, rates] = await Promise.all([
      firebaseAdmin.app().firestore().collection('hosts').doc(hostId).collection('settings').doc('store').get(),
      loadFxRates(),
    ])
    const context = storeCurrencyContextFrom(storeSnap.data(), rates)
    if (String(req.query.setup ?? '') === '1') {
      // The console's Currencies card previews a currency before it is
      // saved, so it reads every rate and the settings as stored, uncached:
      // a change made a moment ago shows at once.
      const setup: CommerceModel.CurrencySetupAnswer = {
        base: context.base,
        settings: context.settings ?? null,
        allRates: rates ?? null,
      }
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json(setup)
    }
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
    return res.status(200).json(CommerceModel.publicCurrencyAnswer(context, Date.now()))
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Currencies unavailable' })
  }
}
