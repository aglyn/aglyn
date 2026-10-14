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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHECKOUT_SHIPPING_COUNTRIES,
  CHECKOUT_SHIPPING_COUNTRY_NAMES,
  describeShippingCoverage,
  resolveCheckoutShippingOptions,
  summarizeShippingCoverage,
} from './model/commerce-shipping'

/**
 * The native apps say what a store's shipping zones and rates cover with ports of the console's resolver. Both ports replay
 * `shipping-coverage-cases.json`; this holds that file to the TypeScript it was made from, so a change to the console's
 * shipping rules fails here until the file, and with it both ports, is brought along.
 */
const FILE = join(
  __dirname,
  '../../../../native/screens/shipping-coverage-cases.json',
)
const file = JSON.parse(readFileSync(FILE, 'utf8')) as {
  countries: string[]
  cases: Array<{
    name: string
    settings: any
    coverage: Record<string, unknown>
    options: Array<{
      cart: { subtotalCents: number; totalGrams: number }
      byCountry: Record<string, unknown>
      union: unknown
    }>
  }>
}
const names = (codes: readonly string[]) =>
  codes.map((code) => CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code).join(', ')

describe('native shipping coverage', () => {
  it('covers the destinations checkout collects an address for', () => {
    expect(file.countries).toEqual([...CHECKOUT_SHIPPING_COUNTRIES])
  })

  it('says what a store covers the way the console does', () => {
    expect(file.cases.length).toBeGreaterThan(20)
    for (const item of file.cases) {
      const coverage = summarizeShippingCoverage(item.settings ?? undefined)
      expect([item.name, item.coverage]).toEqual([
        item.name,
        {
          ...coverage,
          ...describeShippingCoverage(coverage),
          servedNames: names(coverage.served),
          unservedNames: names(coverage.unserved),
          unservedCount: coverage.unserved.length,
          countryCount: CHECKOUT_SHIPPING_COUNTRIES.length,
        },
      ])
    }
  })

  it('offers each destination the options the console offers', () => {
    for (const item of file.cases) {
      for (const scenario of item.options) {
        const settings = item.settings ?? undefined
        expect([item.name, scenario.cart, scenario.union]).toEqual([
          item.name,
          scenario.cart,
          resolveCheckoutShippingOptions(
            settings,
            CHECKOUT_SHIPPING_COUNTRIES,
            scenario.cart,
          ),
        ])
        for (const country of CHECKOUT_SHIPPING_COUNTRIES) {
          expect([item.name, country, scenario.byCountry[country]]).toEqual([
            item.name,
            country,
            resolveCheckoutShippingOptions(settings, [country], scenario.cart),
          ])
        }
      }
    }
  })
})
