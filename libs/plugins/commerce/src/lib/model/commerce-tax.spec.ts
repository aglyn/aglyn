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
  FLAT_TAX_MAX_PCT,
  computeTaxCents,
  isUsableFlatTaxPct,
  resolveFlatTaxCents,
  resolveTaxRate,
  type TaxSettings,
} from './commerce-tax'

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


/**
 * THE FLAT PER-REGIME RATE (AGL-1969 lodging, AGL-2028 services).
 *
 * Two properties carry the whole design and both are asserted here rather
 * than only through the handlers:
 *
 *  - **Off is the default**, so nothing an existing merchant charges moves
 *    because this shipped. Absent, blank, zero, negative, non-numeric and
 *    out-of-range all resolve to zero.
 *  - **Exclusive**, always. The rate is added on top of the charge, never
 *    back-calculated out of it — `pricesIncludeTax` is a goods-pricing
 *    setting and honouring it here would mean a merchant sets a rate, saves,
 *    and the guest's total does not move.
 */
describe('resolveFlatTaxCents (AGL-1969/AGL-2028)', () => {
  it('is OFF when the merchant has set nothing', () => {
    expect(resolveFlatTaxCents(undefined, 30000, 'Lodging tax')).toEqual({
      taxCents: 0,
      label: '',
      pct: 0,
    })
    expect(resolveFlatTaxCents(null, 30000, 'Lodging tax').taxCents).toBe(0)
    expect(resolveFlatTaxCents({}, 30000, 'Lodging tax').taxCents).toBe(0)
    expect(
      resolveFlatTaxCents({ label: 'Occupancy tax' }, 30000, 'Lodging tax')
        .taxCents,
    ).toBe(0)
  })

  it('charges the merchant’s rate on top of the amount charged', () => {
    expect(resolveFlatTaxCents({ pct: 6 }, 30000, 'Lodging tax')).toEqual({
      taxCents: 1800,
      label: 'Lodging tax',
      pct: 6,
    })
    // A fractional rate rounds to the cent rather than truncating.
    expect(resolveFlatTaxCents({ pct: 8.25 }, 10000, 'Tax').taxCents).toBe(825)
    expect(resolveFlatTaxCents({ pct: 6 }, 7501, 'Tax').taxCents).toBe(450)
  })

  it('uses the merchant’s label when they gave one', () => {
    expect(
      resolveFlatTaxCents({ pct: 6, label: 'City occupancy' }, 30000, 'Lodging tax')
        .label,
    ).toBe('City occupancy')
    // …and the caller's fallback when they did not, never a blank line.
    expect(resolveFlatTaxCents({ pct: 6, label: '' }, 30000, 'Lodging tax').label)
      .toBe('Lodging tax')
  })

  it('refuses a rate that is not a rate, rather than clamping it', () => {
    // A decimal-point typo (825 for 8.25) is the case that matters: clamping
    // to 100% would charge a number the merchant never chose, and applying it
    // would multiply the guest's deposit by nine.
    for (const pct of [0, -6, Number.NaN, Number.POSITIVE_INFINITY, 101, 825]) {
      expect(resolveFlatTaxCents({ pct }, 30000, 'Tax').taxCents).toBe(0)
    }
    // The boundary itself is usable — the refusal is above it, not at it.
    expect(resolveFlatTaxCents({ pct: FLAT_TAX_MAX_PCT }, 100, 'Tax').taxCents)
      .toBe(100)
  })

  it('answers zero for a charge there is nothing to tax', () => {
    expect(resolveFlatTaxCents({ pct: 6 }, 0, 'Tax').taxCents).toBe(0)
    expect(resolveFlatTaxCents({ pct: 6 }, -30000, 'Tax').taxCents).toBe(0)
    // A rate so small it rounds to nothing reports no tax AND no label, so no
    // zero-amount line item is ever emitted.
    expect(resolveFlatTaxCents({ pct: 0.0001 }, 100, 'Tax')).toEqual({
      taxCents: 0,
      label: '',
      pct: 0,
    })
  })
})

describe('isUsableFlatTaxPct', () => {
  it('is the predicate the editor warns from and the resolver gates on', () => {
    // One rule, so the on-screen warning and the applied rate cannot disagree
    // about which numbers count.
    expect(isUsableFlatTaxPct(6)).toBe(true)
    expect(isUsableFlatTaxPct('6')).toBe(true)
    expect(isUsableFlatTaxPct(0)).toBe(false)
    expect(isUsableFlatTaxPct(-1)).toBe(false)
    expect(isUsableFlatTaxPct(101)).toBe(false)
    expect(isUsableFlatTaxPct('abc')).toBe(false)
    expect(isUsableFlatTaxPct(undefined)).toBe(false)
  })
})
