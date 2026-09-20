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

import { resetPluginServicesForTests } from './plugin-services'
import {
  pluginTaxProfile,
  pluginTaxProfileOwner,
  registerPluginTaxProfile,
  type PluginTaxProfile,
} from './plugin-tax-profile'

/**
 * The seam with no storefront or calendar in it: a `ledger` plugin owns the
 * tax rule, and a `tickets` plugin prices a charge knowing only that some
 * plugin does.
 */
const LEDGER: PluginTaxProfile = {
  flatTax: (rate, chargeCents, fallbackLabel) => {
    const pct = Number((rate as { pct?: unknown } | null)?.pct)
    if (!(pct > 0)) return { taxCents: 0, label: '', pct: 0 }
    return {
      taxCents: Math.round((chargeCents * pct) / 100),
      label: String((rate as { label?: unknown }).label ?? fallbackLabel),
      pct,
    }
  },
  taxModeOf: (_payment, manualTaxCents = 0) => (manualTaxCents > 0 ? 'manual' : 'none'),
}

beforeEach(() => {
  resetPluginServicesForTests()
})

describe('the tenant’s tax rule, asked of its owner', () => {
  it('prices a charge for a caller that knows only that an owner exists', () => {
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    expect(pluginTaxProfile().flatTax({ pct: 8.5 }, 10_000, 'Service tax')).toEqual({
      taxCents: 850,
      label: 'Service tax',
      pct: 8.5,
    })
    expect(pluginTaxProfile().taxModeOf({}, 850)).toBe('manual')
    expect(pluginTaxProfileOwner()).toBe('ledger')
  })

  it('REFUSES, rather than answering zero, when no plugin owns the rule', () => {
    // The one seam that must not say "nobody home" quietly: a caller that read
    // that as "no tax" would charge and record an untaxed total.
    expect(() => pluginTaxProfile()).toThrow(/refusing rather than charging it untaxed/)
    expect(pluginTaxProfileOwner()).toBeNull()
  })

  it('THE CONTROL: the same call answers once an owner registers', () => {
    // Otherwise the refusal above passes on a function that always throws.
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    expect(() => pluginTaxProfile()).not.toThrow()
  })

  it('keeps one owner: a second plugin is refused, and the incumbent keeps serving', () => {
    registerPluginTaxProfile(LEDGER, { pluginId: 'ledger' })
    expect(() =>
      registerPluginTaxProfile(
        { flatTax: () => ({ taxCents: 1, label: 'x', pct: 1 }), taxModeOf: () => 'x' },
        { pluginId: 'tickets' },
      ),
    ).toThrow()
    expect(pluginTaxProfileOwner()).toBe('ledger')
    expect(pluginTaxProfile().flatTax({ pct: 10 }, 1_000, 'Tax').taxCents).toBe(100)
  })
})
