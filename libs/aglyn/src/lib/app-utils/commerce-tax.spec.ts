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

import { computeTaxCents, resolveTaxRate, type TaxSettings } from './commerce-tax'

const settings: TaxSettings = {
  mode: 'manual',
  rates: [
    { country: 'US', pct: 5, label: 'US default' },
    { country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' },
    { country: 'DE', pct: 19, label: 'VAT' },
  ],
}

describe('resolveTaxRate', () => {
  it('prefers country+state over country-wide', () => {
    expect(resolveTaxRate(settings, { country: 'US', state: 'TX' })?.pct)
      .toBe(8.25)
    expect(resolveTaxRate(settings, { country: 'US', state: 'CA' })?.pct)
      .toBe(5)
    expect(resolveTaxRate(settings, { country: 'de' })?.pct).toBe(19)
  })
  it('returns null without a match, address, or in stripe mode', () => {
    expect(resolveTaxRate(settings, { country: 'FR' })).toBeNull()
    expect(resolveTaxRate(settings, {})).toBeNull()
    expect(
      resolveTaxRate({ ...settings, mode: 'stripe' }, { country: 'US' }),
    ).toBeNull()
    expect(resolveTaxRate(undefined, { country: 'US' })).toBeNull()
  })
})

describe('computeTaxCents', () => {
  it('adds on top for exclusive pricing', () => {
    expect(computeTaxCents(10000, 8.25)).toBe(825)
    expect(computeTaxCents(0, 8.25)).toBe(0)
    expect(computeTaxCents(10000, 0)).toBe(0)
  })
  it('back-calculates for inclusive pricing', () => {
    // €119 gross at 19% VAT contains €19 tax.
    expect(computeTaxCents(11900, 19, true)).toBe(1900)
  })
})
