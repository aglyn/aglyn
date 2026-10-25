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

import { METERED_MARKUP, STRIPE_PROCESSOR_FEE_PCT } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  STRIPE_FIXED_FEE_USD,
  domainRetailCents,
  domainTransferCents,
  formatUsdCents,
} from './pricing'

describe('domain pricing (AGL-3962)', () => {
  it('prices a .com at $15.99 from the registrar\'s $11.25', () => {
    expect(domainRetailCents(11.25)).toBe(1599)
    expect(formatUsdCents(1599)).toBe('$15.99')
  })

  it.each([1.99, 9.99, 11.25, 13.5, 14.99, 24.8, 29.99, 46, 79.99])(
    'keeps cost + 30%% after Stripe on a $%s cost, rounded up to .99',
    (cost) => {
      const cents = domainRetailCents(cost)
      expect(cents % 100).toBe(99)
      const kept = (cents / 100) * (1 - STRIPE_PROCESSOR_FEE_PCT) - STRIPE_FIXED_FEE_USD
      expect(kept).toBeGreaterThanOrEqual(cost * METERED_MARKUP - 1e-9)
      // And never a whole dollar more than the rule needs.
      expect(((cents - 100) / 100) * (1 - STRIPE_PROCESSOR_FEE_PCT) - STRIPE_FIXED_FEE_USD).toBeLessThan(
        cost * METERED_MARKUP,
      )
    },
  )

  it('prices a transfer in as a renewal: the added year at cost, plus the markup (AGL-4040)', () => {
    expect(domainTransferCents(11.25)).toBe(domainRetailCents(11.25))
    expect(domainTransferCents(11.25)).toBe(1599)
    expect(domainTransferCents(0)).toBe(0)
  })
})
