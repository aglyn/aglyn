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

import { minorFromPayPal, payPalDecimals, payPalMoney } from './money'

/** Whole minor units to PayPal's decimal strings and back, as text, never as floats (AGL-3630). */
describe('PayPal money', () => {
  it.each([
    [0, 'usd', '0.00'],
    [5, 'usd', '0.05'],
    [30, 'usd', '0.30'],
    [1_999, 'usd', '19.99'],
    [123_456_789, 'eur', '1234567.89'],
    [4_500, 'jpy', '4500'],
    [990, 'huf', '990'],
  ])('%i %s is %s', (minor, currency, value) => {
    expect(payPalMoney(minor, currency)).toEqual({ currency_code: currency.toUpperCase(), value })
    expect(minorFromPayPal({ currency_code: currency.toUpperCase(), value }, currency)).toBe(minor)
  })

  it('reads a value PayPal sends with fewer or trailing-zero decimals', () => {
    expect(minorFromPayPal({ currency_code: 'USD', value: '12' }, 'usd')).toBe(1_200)
    expect(minorFromPayPal({ currency_code: 'USD', value: '12.5' }, 'usd')).toBe(1_250)
    expect(minorFromPayPal({ currency_code: 'USD', value: '12.500' }, 'usd')).toBe(1_250)
  })

  it('refuses a fraction of a cent, another currency and anything not a number', () => {
    expect(minorFromPayPal({ currency_code: 'USD', value: '12.505' }, 'usd')).toBeNull()
    expect(minorFromPayPal({ currency_code: 'EUR', value: '12.50' }, 'usd')).toBeNull()
    expect(minorFromPayPal({ currency_code: 'USD', value: '-1.00' }, 'usd')).toBeNull()
    expect(minorFromPayPal(null, 'usd')).toBeNull()
  })

  it('refuses to send fractional or negative minor units', () => {
    expect(() => payPalMoney(10.5, 'usd')).toThrow()
    expect(() => payPalMoney(-1, 'usd')).toThrow()
  })

  it('knows the zero-decimal currencies', () => {
    expect([payPalDecimals('JPY'), payPalDecimals('twd'), payPalDecimals('usd')]).toEqual([0, 0, 2])
  })
})
