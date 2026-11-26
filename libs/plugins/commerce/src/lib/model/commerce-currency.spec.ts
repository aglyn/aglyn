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
  amountMinorIn,
  convertMinor,
  crossRate,
  decodeChargeUnitsMetadata,
  encodeChargeUnitsMetadata,
  orderCurrencyFields,
  saleMoneyText,
  currenciesShareSign,
  formatShopperMoney,
  parseEcbDailyXml,
  publicCurrencyAnswer,
  ratesAreFresh,
  resolveShopperCurrency,
  roundMajor,
  storeCurrencies,
  variantPriceMinor,
  type FxRates,
  type StoreCurrencySettings,
} from './commerce-currency'

/** ECB-shaped: per 1 EUR. 1 USD = 1.7 NZD here (1.785 / 1.05). */
const rates: FxRates = {
  base: 'EUR',
  rates: { USD: 1.05, NZD: 1.785, AUD: 1.62, GBP: 0.84, JPY: 162 },
  asOfMs: Date.parse('2026-11-25T16:00:00Z'),
}

const settings: StoreCurrencySettings = {
  enabled: true,
  currencies: [
    { code: 'GBP', rounding: '99' },
    { code: 'EUR', rounding: '95' },
    { code: 'aud' },
    { code: 'NZD', rounding: 'whole', bufferPct: 2 },
    { code: 'NZD' },
    { code: 'XXX' },
  ],
}

describe('storeCurrencies', () => {
  it('lists the store currency first, then each known currency once', () => {
    expect(storeCurrencies(settings, 'USD').map((c) => c.code)).toEqual([
      'USD',
      'GBP',
      'EUR',
      'AUD',
      'NZD',
    ])
    // Rounding is off until the merchant turns it on, as on Shopify.
    expect(storeCurrencies(settings, 'USD')[3].rounding).toBe('none')
  })

  it('is the store currency alone while switched off', () => {
    expect(storeCurrencies({ ...settings, enabled: false }, 'USD')).toEqual([
      { code: 'USD', rounding: 'none' },
    ])
    expect(storeCurrencies(undefined, 'USD')).toHaveLength(1)
  })
})

describe('resolveShopperCurrency', () => {
  it('picks the currency of the country a shopper browses from', () => {
    expect(resolveShopperCurrency({ settings, base: 'USD', country: 'NZ' })).toBe('NZD')
    expect(resolveShopperCurrency({ settings, base: 'USD', country: 'ie' })).toBe('EUR')
    expect(resolveShopperCurrency({ settings, base: 'USD', country: 'GB' })).toBe('GBP')
  })

  it('falls back to the store currency where the store does not sell in theirs', () => {
    expect(resolveShopperCurrency({ settings, base: 'USD', country: 'JP' })).toBe('USD')
    expect(resolveShopperCurrency({ settings, base: 'USD', country: null })).toBe('USD')
  })

  it('lets the shopper choice win, and ignores one the store does not sell in', () => {
    expect(resolveShopperCurrency({ settings, base: 'USD', country: 'NZ', chosen: 'GBP' })).toBe('GBP')
    expect(resolveShopperCurrency({ settings, base: 'USD', country: 'NZ', chosen: 'JPY' })).toBe('NZD')
  })

  it('does not guess from the country with auto-detect off', () => {
    expect(
      resolveShopperCurrency({ settings: { ...settings, autoDetect: false }, base: 'USD', country: 'NZ' }),
    ).toBe('USD')
  })
})

describe('conversion', () => {
  it('crosses through the rates base', () => {
    expect(crossRate(rates, 'USD', 'NZD')).toBeCloseTo(1.7, 10)
    expect(crossRate(rates, 'USD', 'EUR')).toBeCloseTo(1 / 1.05, 10)
    expect(crossRate(rates, 'USD', 'USD')).toBe(1)
    expect(crossRate(rates, 'USD', 'CHF')).toBeUndefined()
  })

  it('rounds UP to the ending the merchant chose', () => {
    expect(roundMajor(28.01, 'whole', 'NZD')).toBe(29)
    expect(roundMajor(28, 'whole', 'NZD')).toBe(28)
    expect(roundMajor(28.5, '99', 'GBP')).toBe(28.99)
    expect(roundMajor(28.995, '99', 'GBP')).toBe(29.99)
    expect(roundMajor(28.95, '95', 'EUR')).toBe(28.95)
    expect(roundMajor(28.96, '95', 'EUR')).toBe(29.95)
    expect(roundMajor(28.001, 'none', 'AUD')).toBe(28.01)
    // Yen has no minor unit, so every ending is a whole yen.
    expect(roundMajor(4860.2, '99', 'JPY')).toBe(4861)
  })

  it('converts a store price with the buffer, then the rounding', () => {
    const [, gbp, , aud, nzd] = storeCurrencies(settings, 'USD')
    // $100 → NZ$170, +2% = NZ$173.40 → whole = NZ$174.
    expect(convertMinor(10_000, 'USD', nzd, rates)).toBe(17_400)
    // $100 → £80 exactly → .99 = £80.99.
    expect(convertMinor(10_000, 'USD', gbp, rates)).toBe(8_099)
    // $250 → A$385.714… → no rounding = A$385.72 (up to the cent).
    expect(convertMinor(25_000, 'USD', aud, rates)).toBe(38_572)
    expect(convertMinor(0, 'USD', nzd, rates)).toBe(0)
  })

  it('sells nothing at a guessed rate', () => {
    expect(convertMinor(1000, 'USD', { code: 'CHF' }, rates)).toBeUndefined()
    expect(convertMinor(1000, 'USD', { code: 'NZD' }, undefined)).toBeUndefined()
  })

  it('uses a variant fixed price where it has one', () => {
    const nzd = storeCurrencies(settings, 'USD')[4]
    expect(variantPriceMinor({ priceUsd: 250, fixedPrices: { NZD: 449 } }, 'USD', nzd, rates)).toBe(44_900)
    expect(variantPriceMinor({ priceUsd: 250 }, 'USD', nzd, rates)).toBe(43_400)
    // The store currency is always its own price, whatever is stored.
    expect(
      variantPriceMinor({ priceUsd: 250, fixedPrices: { USD: 1 } }, 'USD', { code: 'USD' }, rates),
    ).toBe(25_000)
  })

  it('converts add-ons to the cent, without the price ending', () => {
    const gbp = storeCurrencies(settings, 'USD')[1]
    expect(amountMinorIn(500, 'USD', gbp, rates)).toBe(400)
    expect(amountMinorIn(500, 'USD', gbp, rates, { GBP: 350 })).toBe(350)
  })
})

describe('formatShopperMoney', () => {
  it('says which dollar it is where the store sells in several', () => {
    expect(formatShopperMoney(4900, 'NZD')).toBe('NZ$49.00')
    expect(formatShopperMoney(4500, 'AUD')).toBe('A$45.00')
    expect(formatShopperMoney(2900, 'USD')).toBe('$29.00')
    expect(formatShopperMoney(2900, 'USD', { disambiguate: true })).toBe('US$29.00')
    expect(formatShopperMoney(4860, 'JPY')).toBe('¥4,860')
    expect(formatShopperMoney(2899, 'GBP')).toBe('£28.99')
    expect(currenciesShareSign(['USD', 'NZD'])).toBe(true)
    expect(currenciesShareSign(['USD', 'GBP', 'EUR'])).toBe(false)
  })
})

describe('rates', () => {
  it('parses the ECB daily file', () => {
    const xml = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-11-25'>
      <Cube currency='USD' rate='1.0521'/><Cube currency='NZD' rate='1.8312'/><Cube currency='GBP' rate='0.83'/>
      </Cube></Cube></gesmes:Envelope>`
    expect(parseEcbDailyXml(xml)).toEqual({
      base: 'EUR',
      rates: { USD: 1.0521, NZD: 1.8312, GBP: 0.83 },
      asOfMs: Date.parse('2026-11-25T16:00:00Z'),
      source: 'ecb',
    })
    expect(parseEcbDailyXml('<html>maintenance</html>')).toBeUndefined()
  })

  it('stops charging at rates older than four days', () => {
    expect(ratesAreFresh(rates, rates.asOfMs + 3 * 86_400_000)).toBe(true)
    expect(ratesAreFresh(rates, rates.asOfMs + 5 * 86_400_000)).toBe(false)
    expect(ratesAreFresh(undefined, Date.now())).toBe(false)
  })
})

describe('publicCurrencyAnswer', () => {
  const now = rates.asOfMs + 3_600_000
  it('lists the currencies the rates cover, with only their rates', () => {
    const answer = publicCurrencyAnswer(
      { base: 'USD', settings: { ...settings, currencies: [...(settings.currencies ?? []), { code: 'CHF' }] }, rates },
      now,
    )
    expect(answer.currencies.map((c) => c.code)).toEqual(['USD', 'GBP', 'EUR', 'AUD', 'NZD'])
    expect(answer.rates?.rates).toEqual({ GBP: 0.84, AUD: 1.62, NZD: 1.785, USD: 1.05 })
    expect(answer.autoDetect).toBe(true)
  })

  it('is the store currency alone on stale rates or with selling off', () => {
    expect(publicCurrencyAnswer({ base: 'USD', settings, rates }, now + 5 * 86_400_000)).toEqual({
      base: 'USD',
      currencies: [{ code: 'USD', rounding: 'none' }],
      autoDetect: true,
      rates: null,
    })
    expect(publicCurrencyAnswer({ base: 'USD', settings: undefined, rates }, now).rates).toBeNull()
  })
})

describe('orders in another currency', () => {
  it('round-trips the charged units through metadata, in chunks under the cap', () => {
    const units = Array.from({ length: 150 }, (_, index) => 10_000 + index)
    const metadata = encodeChargeUnitsMetadata(units)
    expect(Object.values(metadata).every((value) => value.length <= 480)).toBe(true)
    expect(Object.keys(metadata).length).toBeGreaterThan(1)
    expect(decodeChargeUnitsMetadata(metadata)).toEqual(units)
    expect(decodeChargeUnitsMetadata({})).toBeUndefined()
  })

  it('records the currency, and the store-currency totals at the rate', () => {
    const fields = orderCurrencyFields(
      { currency: 'nzd', metadata: { baseCurrency: 'usd', fxRate: '1.7' } },
      { itemsCents: 10_200, totalCents: 14_100 },
    )
    expect(fields).toEqual({
      currency: 'nzd',
      baseCurrency: 'usd',
      fxRate: 1.7,
      baseTotals: { itemsCents: 6000, totalCents: 8294 },
    })
    expect(orderCurrencyFields({ currency: 'usd', metadata: {} }, { totalCents: 1 })).toEqual({ currency: 'usd' })
  })

  it('keeps a USD sale reading as it always has', () => {
    expect(saleMoneyText(123_450, 'usd')).toBe('$1234.50')
    expect(saleMoneyText(44_900, 'nzd')).toBe('NZ$449.00')
    expect(saleMoneyText(2499, 'GBP')).toBe('£24.99')
  })
})

describe('Shopify-style rate controls', () => {
  it('uses a manual rate where the merchant set one, whatever the daily rate', () => {
    const [, nzd] = storeCurrencies({ enabled: true, currencies: [{ code: 'NZD', manualRate: 1.8, rounding: 'whole' }] }, 'USD')
    expect(convertMinor(10_000, 'USD', nzd, rates)).toBe(18_000)
    // A manual rate does not need the daily file at all.
    expect(convertMinor(10_000, 'USD', nzd, undefined)).toBe(18_000)
    expect(
      publicCurrencyAnswer({ base: 'USD', settings: { enabled: true, currencies: [{ code: 'CHF', manualRate: 0.9 }] }, rates: undefined }, Date.now())
        .currencies.map((c) => c.code),
    ).toEqual(['USD', 'CHF'])
  })

  it('takes a negative price adjustment, and clamps it to -90…+100', () => {
    const [, nzd, gbp] = storeCurrencies(
      { enabled: true, currencies: [{ code: 'NZD', bufferPct: -10 }, { code: 'GBP', bufferPct: 500 }] },
      'USD',
    )
    expect(nzd.bufferPct).toBe(-10)
    expect(gbp.bufferPct).toBe(100)
    // $100 → NZ$170 − 10% = NZ$153.
    expect(convertMinor(10_000, 'USD', nzd, rates)).toBe(15_300)
  })
})
