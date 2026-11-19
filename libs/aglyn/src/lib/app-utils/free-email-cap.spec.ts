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
 * Free's hard monthly email cap (AGL-4227): the one plan that cannot be billed
 * for usage gets a bound on its mail that is not an invoice. One reader,
 * beside `INCLUDED_EMAIL_SENDS_BY_PLAN`.
 */

import {
  EMAIL_SENDS_MONTHLY_CAP_BY_PLAN,
  EMAIL_SENDS_MONTHLY_CAP_KEY,
  INCLUDED_EMAIL_SENDS_BY_PLAN,
  ORG_COGS_UNIT_RATES_USD,
  UNLIMITED,
  resolveMonthlyEmailCap,
} from './plan-entitlements'

describe('Free\'s monthly email cap (AGL-4227)', () => {
  it('is 300 on Free and none on any paid plan', () => {
    expect(EMAIL_SENDS_MONTHLY_CAP_BY_PLAN.free).toBe(300)
    expect(resolveMonthlyEmailCap({ plan: 'free' } as never)).toBe(300)
    for (const plan of ['starter', 'pro', 'enterprise']) {
      expect(resolveMonthlyEmailCap({ plan, billingStatus: 'active' } as never)).toBe(UNLIMITED)
    }
    // Starter is BILLED past its band, not capped: the two maps never overlap.
    for (const plan of Object.keys(EMAIL_SENDS_MONTHLY_CAP_BY_PLAN)) {
      expect(INCLUDED_EMAIL_SENDS_BY_PLAN[plan as never]).toBeUndefined()
    }
  })

  it('costs at most $0.27 a month at the provider rate', () => {
    expect(300 * ORG_COGS_UNIT_RATES_USD.perEmailSend).toBeCloseTo(0.27, 4)
  })

  it('reads a lapsed paid plan as Free, so it gets Free\'s cap', () => {
    expect(resolveMonthlyEmailCap({ plan: 'pro', billingStatus: 'canceled' } as never)).toBe(300)
  })

  it('honours a staff figure on the workspace, 0 included, and ignores junk', () => {
    const withOverride = (value: unknown) =>
      ({ plan: 'free', entitlements: { [EMAIL_SENDS_MONTHLY_CAP_KEY]: value } }) as never
    expect(resolveMonthlyEmailCap(withOverride(1_000))).toBe(1_000)
    expect(resolveMonthlyEmailCap(withOverride(0))).toBe(0)
    for (const bad of [-1, Number.NaN, '500', null]) {
      expect(resolveMonthlyEmailCap(withOverride(bad))).toBe(300)
    }
  })
})
