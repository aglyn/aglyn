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

import type { FxRates } from './commerce-currency'
import {
  addableCurrencies,
  clampAdjustmentInput,
  currencyRateLabel,
  newStoreCurrency,
  parseManualRateInput,
  currencyPreviewText,
  minorToInput,
  otherStoreCurrencies,
  parseMajorInput,
  withCurrencyAmount,
} from './commerce-currency-setup'

const rates: FxRates = {
  base: 'EUR',
  rates: { USD: 1.05, NZD: 1.05 * 1.7041, JPY: 162 },
  asOfMs: Date.parse('2026-11-25T16:00:00Z'),
}

describe('currency setup helpers (AGL-4248)', () => {
  it('lists the other currencies only while selling in them is on', () => {
    const settings = { enabled: true, currencies: [{ code: 'NZD' }, { code: 'USD' }] }
    expect(otherStoreCurrencies(settings, 'USD').map((entry) => entry.code)).toEqual(['NZD'])
    expect(otherStoreCurrencies({ ...settings, enabled: false }, 'USD')).toEqual([])
    expect(otherStoreCurrencies(null, 'USD')).toEqual([])
  })

  it('offers every sellable currency but the store’s and the added ones', () => {
    const offered = addableCurrencies('USD', ['NZD'])
    expect(offered).not.toContain('USD')
    expect(offered).not.toContain('NZD')
    expect(offered).toContain('GBP')
  })

  it('reads a typed price: blank converts, junk is refused', () => {
    expect(parseMajorInput('')).toBeUndefined()
    expect(parseMajorInput(' 44,90 ')).toBe(44.9)
    expect(parseMajorInput('abc')).toBeNull()
    expect(parseMajorInput('-1')).toBeNull()
    expect(clampAdjustmentInput('150')).toBe(100)
    expect(clampAdjustmentInput('-95')).toBe(-90)
    expect(clampAdjustmentInput('-5')).toBe(-5)
    expect(clampAdjustmentInput('')).toBe(0)
    expect(parseManualRateInput('1,75')).toBe(1.75)
    expect(parseManualRateInput('')).toBeUndefined()
    expect(parseManualRateInput('0')).toBeUndefined()
  })

  it('sets and clears one currency, dropping an emptied map', () => {
    expect(withCurrencyAmount(undefined, 'NZD', 449)).toEqual({ NZD: 449 })
    expect(withCurrencyAmount({ NZD: 449, GBP: 199 }, 'NZD', undefined)).toEqual({ GBP: 199 })
    expect(withCurrencyAmount({ NZD: 449 }, 'NZD', undefined)).toBeUndefined()
  })

  it('adds a currency unrounded, as Shopify does, and says which rate it uses', () => {
    expect(newStoreCurrency('NZD')).toEqual({ code: 'NZD', rounding: 'none', bufferPct: 0 })
    expect(currencyRateLabel(rates, 'USD', { code: 'NZD' })).toBe('Daily rate 1.7041, updated Nov 25')
    expect(currencyRateLabel(rates, 'USD', { code: 'NZD', manualRate: 1.75 })).toBe('Manual rate 1.7500')
    expect(currencyRateLabel(rates, 'USD', { code: 'GBP' })).toBe('No daily rate for GBP yet')
  })

  it('shows minor amounts as typed, yen without decimals', () => {
    expect(minorToInput(44_900, 'NZD')).toBe('449.00')
    expect(minorToInput(5400, 'JPY')).toBe('5400')
    expect(minorToInput(undefined, 'NZD')).toBe('')
  })

  it('previews a price at the day’s rate, or says there is no rate', () => {
    expect(currencyPreviewText(25_000, 'USD', { code: 'NZD', rounding: 'whole' }, rates)).toBe(
      '$250.00 → NZ$427.00 (rate 1.7041, as of Nov 25)',
    )
    expect(currencyPreviewText(25_000, 'USD', { code: 'NZD', manualRate: 2 }, rates)).toBe(
      '$250.00 → NZ$500.00 (manual rate 2.0000)',
    )
    expect(currencyPreviewText(25_000, 'USD', { code: 'GBP', rounding: 'whole' }, rates)).toMatch(
      /no rate for GBP yet/,
    )
  })
})
