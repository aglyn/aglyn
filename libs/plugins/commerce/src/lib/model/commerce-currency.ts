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
 * Multi-currency selling (AGL-4248), the way Shopify Markets does it: a
 * shopper sees, and is CHARGED in, their own currency (Stripe presentment
 * currency on the merchant's account, settled in the store currency), picked
 * from where they browse out of the currencies the merchant turned on, and can
 * switch it themselves.
 *
 * Prices convert from the store currency at a daily reference rate, plus an
 * optional buffer, then round the way the merchant chose (Shopify's
 * "rounding" rule rounds UP to the chosen ending). A product or add-on may
 * carry a fixed price in a currency instead, which wins over conversion.
 *
 * Pure. Settings live on `hosts/{hostId}/settings/store` under `currencies`;
 * rates live on `platform/fxRates`, written by the commerce rates beat.
 */

/** How a converted price is rounded, always UP to the next allowed value. */
export type CurrencyRounding = 'none' | 'whole' | '99' | '95'

export const CURRENCY_ROUNDING_LABELS: Readonly<Record<CurrencyRounding, string>> = {
  none: 'To the cent (no rounding)',
  whole: 'Whole number (29.00)',
  '99': 'Ends in .99 (28.99)',
  '95': 'Ends in .95 (28.95)',
}

/** One currency a store sells in besides its own. */
export interface StoreCurrency {
  /** ISO 4217, upper case: 'NZD'. */
  code: string
  rounding?: CurrencyRounding
  /** Added to the rate, in percent (0–10): covers conversion fees. */
  bufferPct?: number
  /**
   * Prices shown and charged in this currency INCLUDE tax (VAT/GST), the way
   * shoppers in the UK, EU, Australia and New Zealand expect. Only meaningful
   * with Stripe Tax registrations in those places.
   */
  pricesIncludeTax?: boolean
}

export interface StoreCurrencySettings {
  /** Selling in more than the store currency at all. */
  enabled?: boolean
  currencies?: StoreCurrency[]
  /** Pick the shopper's currency from their country (default on). */
  autoDetect?: boolean
}

/** The daily reference rates, per 1 unit of `base`. */
export interface FxRates {
  base: string
  rates: Record<string, number>
  asOfMs: number
  source?: string
}

/** Fixed prices a product variant carries per currency, in major units (29.95). */
export type FixedPrices = Record<string, number>

/**
 * The currencies a store may sell in: the ones the European Central Bank
 * publishes a daily reference rate for, that Stripe charges cards in, and
 * that settle without Stripe's special-case rounding rules.
 */
export const SELLABLE_CURRENCIES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'CAD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'MXN',
  'SGD',
  'HKD',
  'ZAR',
  'ILS',
  'BRL',
  'INR',
  'PHP',
  'THB',
  'MYR',
  'IDR',
  'KRW',
  'RON',
  'TRY',
  'CNY',
]

export const CURRENCY_NAMES: Readonly<Record<string, string>> = {
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  AUD: 'Australian dollar',
  NZD: 'New Zealand dollar',
  CAD: 'Canadian dollar',
  JPY: 'Japanese yen',
  CHF: 'Swiss franc',
  SEK: 'Swedish krona',
  NOK: 'Norwegian krone',
  DKK: 'Danish krone',
  PLN: 'Polish złoty',
  CZK: 'Czech koruna',
  MXN: 'Mexican peso',
  SGD: 'Singapore dollar',
  HKD: 'Hong Kong dollar',
  ZAR: 'South African rand',
  ILS: 'Israeli new shekel',
  BRL: 'Brazilian real',
  INR: 'Indian rupee',
  PHP: 'Philippine peso',
  THB: 'Thai baht',
  MYR: 'Malaysian ringgit',
  IDR: 'Indonesian rupiah',
  KRW: 'South Korean won',
  RON: 'Romanian leu',
  TRY: 'Turkish lira',
  CNY: 'Chinese yuan',
}

/** Currencies Stripe charges with no minor unit. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW'])

/** Minor units per major unit: 100 for most, 1 for yen and won. */
export function currencyMinorFactor(code: string): number {
  return ZERO_DECIMAL.has(code.toUpperCase()) ? 1 : 100
}

const EURO_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'AD', 'MC', 'SM',
  'VA', 'ME', 'XK', 'AX', 'GF', 'GP', 'MQ', 'YT', 'RE', 'BL', 'MF', 'PM',
]

/**
 * The currency a country's shoppers expect (ISO 4217), for the currencies a
 * store can sell in. A country not listed shops in the store currency.
 */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(EURO_COUNTRIES.map((code) => [code, 'EUR'])),
  US: 'USD', PR: 'USD', GU: 'USD', AS: 'USD', VI: 'USD', MP: 'USD', EC: 'USD',
  SV: 'USD', PA: 'USD', TL: 'USD', FM: 'USD', MH: 'USD', PW: 'USD', TC: 'USD',
  VG: 'USD', BQ: 'USD',
  GB: 'GBP', IM: 'GBP', JE: 'GBP', GG: 'GBP',
  AU: 'AUD', CX: 'AUD', CC: 'AUD', NF: 'AUD', KI: 'AUD', NR: 'AUD', TV: 'AUD',
  NZ: 'NZD', CK: 'NZD', NU: 'NZD', PN: 'NZD', TK: 'NZD',
  CA: 'CAD',
  JP: 'JPY',
  CH: 'CHF', LI: 'CHF',
  SE: 'SEK',
  NO: 'NOK', SJ: 'NOK', BV: 'NOK',
  DK: 'DKK', FO: 'DKK', GL: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  MX: 'MXN',
  SG: 'SGD',
  HK: 'HKD',
  ZA: 'ZAR',
  IL: 'ILS', PS: 'ILS',
  BR: 'BRL',
  IN: 'INR',
  PH: 'PHP',
  TH: 'THB',
  MY: 'MYR',
  ID: 'IDR',
  KR: 'KRW',
  RO: 'RON',
  TR: 'TRY',
  CN: 'CNY',
}

const upper = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

/** The store's own currency, upper case (`settings/store.currency`, default USD). */
export function storeBaseCurrency(store: { currency?: unknown } | undefined): string {
  const code = upper(store?.currency)
  return /^[A-Z]{3}$/.test(code) ? code : 'USD'
}

/**
 * The currencies this store sells in, the store currency first, each known
 * and listed once. Off (or nothing added) is the store currency alone.
 */
export function storeCurrencies(
  settings: StoreCurrencySettings | undefined,
  base: string,
): StoreCurrency[] {
  const list: StoreCurrency[] = [{ code: base, rounding: 'none' }]
  if (!settings?.enabled) return list
  for (const entry of settings.currencies ?? []) {
    const code = upper(entry?.code)
    if (!SELLABLE_CURRENCIES.includes(code) || list.some((c) => c.code === code)) continue
    list.push({
      code,
      rounding: (['none', 'whole', '99', '95'] as const).includes(
        entry.rounding as CurrencyRounding,
      )
        ? entry.rounding
        : 'whole',
      bufferPct: clampBuffer(entry.bufferPct),
      ...(entry.pricesIncludeTax ? { pricesIncludeTax: true } : {}),
    })
  }
  return list
}

function clampBuffer(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(10, Math.round(n * 100) / 100)
}

/** Whether `code` is a currency this store sells in. */
export function storeSellsIn(
  settings: StoreCurrencySettings | undefined,
  base: string,
  code: unknown,
): StoreCurrency | undefined {
  const want = upper(code)
  return storeCurrencies(settings, base).find((entry) => entry.code === want)
}

/**
 * The currency a shopper sees: their own choice when the store sells in it,
 * else the one their country uses when the store sells in that (and
 * auto-detect is on), else the store currency.
 */
export function resolveShopperCurrency(input: {
  settings: StoreCurrencySettings | undefined
  base: string
  country?: string | null
  chosen?: string | null
}): string {
  const { settings, base } = input
  const chosen = storeSellsIn(settings, base, input.chosen)
  if (chosen) return chosen.code
  if (settings?.autoDetect !== false) {
    const local = COUNTRY_CURRENCY[upper(input.country)]
    if (local && storeSellsIn(settings, base, local)) return local
  }
  return base
}

/** `rates[to] / rates[from]` through the rates' own base; undefined when unknown. */
export function crossRate(rates: FxRates | undefined, from: string, to: string): number | undefined {
  const f = upper(from)
  const t = upper(to)
  if (f === t) return 1
  if (!rates?.rates) return undefined
  const rate = (code: string) => (code === upper(rates.base) ? 1 : rates.rates[code])
  const a = rate(f)
  const b = rate(t)
  if (!(a > 0) || !(b > 0)) return undefined
  return b / a
}

/** Round a major amount UP to the ending the merchant chose. */
export function roundMajor(major: number, rounding: CurrencyRounding, code: string): number {
  const factor = currencyMinorFactor(code)
  // Shave float noise (28.950000000001) before rounding up.
  const clean = Math.round(major * factor * 1e6) / 1e6 / factor
  switch (rounding) {
    case 'whole':
      return Math.ceil(clean - 1e-9)
    case '99':
    case '95': {
      if (factor === 1) return Math.ceil(clean - 1e-9)
      const ending = rounding === '99' ? 0.99 : 0.95
      const floor = Math.floor(clean)
      const candidate = floor + ending
      return clean <= candidate + 1e-9 ? candidate : floor + 1 + ending
    }
    case 'none':
    default:
      return Math.ceil(clean * factor - 1e-9) / factor
  }
}

/**
 * A store-currency amount (minor units) in a shopper currency (minor units):
 * converted at the reference rate, plus the buffer, rounded as set.
 * `undefined` when the rates do not cover the pair, and callers then sell in
 * the store currency rather than guessing.
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  target: StoreCurrency,
  rates: FxRates | undefined,
  options: { round?: boolean } = {},
): number | undefined {
  const rate = crossRate(rates, from, target.code)
  if (rate == null) return undefined
  if (upper(from) === target.code) return Math.round(amountMinor)
  if (!amountMinor) return 0
  const major =
    (amountMinor / currencyMinorFactor(from)) * rate * (1 + (target.bufferPct ?? 0) / 100)
  const rounded =
    options.round === false
      ? roundMajor(major, 'none', target.code)
      : roundMajor(major, target.rounding ?? 'whole', target.code)
  return Math.round(rounded * currencyMinorFactor(target.code))
}

/**
 * The price a shopper pays for a variant, in minor units of their currency:
 * the variant's fixed price there when it has one, else its store price
 * converted. `priceMajor` is the store price in major units (`priceUsd`).
 */
export function variantPriceMinor(
  variant: { priceUsd?: number; fixedPrices?: FixedPrices },
  base: string,
  target: StoreCurrency,
  rates: FxRates | undefined,
): number | undefined {
  const fixed = variant.fixedPrices?.[target.code]
  if (target.code !== base && typeof fixed === 'number' && fixed >= 0) {
    return Math.round(fixed * currencyMinorFactor(target.code))
  }
  const baseMinor = Math.round(Number(variant.priceUsd ?? 0) * currencyMinorFactor(base))
  return convertMinor(baseMinor, base, target, rates)
}

/**
 * An add-on or fee amount in the shopper's currency: a fixed amount there
 * when the merchant set one, else converted at the rate WITHOUT the ending
 * rounding (a $5 add-on is NZ$8.61, not NZ$8.99: rounding is for prices a
 * shopper reads on their own).
 */
export function amountMinorIn(
  baseMinor: number,
  base: string,
  target: StoreCurrency,
  rates: FxRates | undefined,
  fixedMinor?: Record<string, number>,
): number | undefined {
  const fixed = fixedMinor?.[target.code]
  if (target.code !== base && typeof fixed === 'number' && fixed >= 0) return Math.round(fixed)
  return convertMinor(baseMinor, base, target, rates, { round: false })
}

/**
 * Money for a shopper. Where two currencies a store sells in share a sign
 * ($ for US, Australian and New Zealand dollars), each says which it is:
 * US$29.00, A$45.00, NZ$49.00.
 */
export function formatShopperMoney(
  amountMinor: number,
  code: string,
  options: { disambiguate?: boolean; locale?: string } = {},
): string {
  const currency = upper(code) || 'USD'
  const factor = currencyMinorFactor(currency)
  const value = (Number(amountMinor) || 0) / factor
  let text: string
  try {
    text = new Intl.NumberFormat(options.locale ?? 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: factor === 1 ? 0 : 2,
      maximumFractionDigits: factor === 1 ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(factor === 1 ? 0 : 2)}`
  }
  if (options.disambiguate && currency === 'USD') text = text.replace(/^(-?)\$/, '$1US$')
  return text
}

/** Whether a store's currencies include two that share a sign. */
export function currenciesShareSign(codes: readonly string[]): boolean {
  const dollars = codes.filter((code) => ['USD', 'AUD', 'NZD', 'CAD', 'SGD', 'HKD', 'MXN'].includes(code))
  return dollars.length > 1
}

/** Rates older than this are not used to charge anyone: the store currency is. */
export const FX_RATES_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000

export function ratesAreFresh(rates: FxRates | undefined, nowMs: number): boolean {
  return Boolean(rates?.asOfMs && nowMs - rates.asOfMs <= FX_RATES_MAX_AGE_MS)
}

/**
 * Parse the European Central Bank's daily reference XML
 * (`eurofxref-daily.xml`): `<Cube time="2026-11-25">` holding
 * `<Cube currency="USD" rate="1.0521"/>` rows, per 1 EUR.
 */
export function parseEcbDailyXml(xml: string): FxRates | undefined {
  const time = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1]
  const rates: Record<string, number> = {}
  for (const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const value = Number(match[2])
    if (value > 0) rates[match[1]] = value
  }
  if (!time || !Object.keys(rates).length) return undefined
  return { base: 'EUR', rates, asOfMs: Date.parse(`${time}T16:00:00Z`), source: 'ecb' }
}

/** What a storefront prices from (`GET commerce/currency`). */
export interface PublicCurrencyAnswer {
  base: string
  /** The store currency first; only currencies the day's rates cover. */
  currencies: StoreCurrency[]
  autoDetect: boolean
  /** The rates for exactly those currencies, or null when selling in the store currency only. */
  rates: FxRates | null
}

/**
 * The public answer, from a store's settings and the stored rates. A
 * currency the rates do not cover, or rates older than
 * {@link FX_RATES_MAX_AGE_MS}, drop out: checkout would refuse to charge in
 * them, so the storefront must not show them.
 */
export function publicCurrencyAnswer(
  context: { base: string; settings: StoreCurrencySettings | undefined; rates: FxRates | undefined },
  nowMs: number,
): PublicCurrencyAnswer {
  const fresh = ratesAreFresh(context.rates, nowMs)
  const currencies = storeCurrencies(context.settings, context.base).filter(
    (entry) =>
      entry.code === context.base ||
      (fresh && crossRate(context.rates, context.base, entry.code) != null),
  )
  const rates =
    fresh && context.rates && currencies.length > 1
      ? {
          base: context.rates.base,
          asOfMs: context.rates.asOfMs,
          rates: Object.fromEntries(
            currencies
              .map((entry) => entry.code)
              .concat(context.base)
              .filter((code) => code !== context.rates?.base && context.rates?.rates[code])
              .map((code) => [code, context.rates?.rates[code] as number]),
          ),
        }
      : null
  return {
    base: context.base,
    currencies,
    autoDetect: context.settings?.autoDetect !== false,
    rates,
  }
}
