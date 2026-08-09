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
  INFRA_COGS_PER_SITE_USD,
  ORG_COGS_UNIT_RATES_USD,
  orgMonthlyCogsUsd,
} from './plan-entitlements'

describe('orgMonthlyCogsUsd', () => {
  it('reproduces a real production rollup, hand-computed', () => {
    // orgs/alx59wnpi0t3k2eksluz/usage/2026-06, read from production
    // 2026-07-30. Hand-computed rather than snapshotted, so this test states
    // what the number should be instead of whatever the code happens to say.
    const rollup = {
      hostCount: 2,
      storageGb: 0.00018016155809164047,
      pageViews: 0,
      formSubmissions: 0,
      dataStorageMb: 0,
      apiRequests: 0,
      contactsCount: 2,
    }
    const expectedMeasured =
      0.00018016155809164047 * 0.026 + // storage (AGL-1280: was 0.03)
      2 * 0.0002 // two contacts
    const result = orgMonthlyCogsUsd(rollup, 2)

    expect(result.measuredUsd).toBeCloseTo(expectedMeasured, 10)
    // $0.0004 measured against a $4.00 floor for two sites.
    expect(result.floorUsd).toBe(4)
    expect(result.cogsUsd).toBe(4)
    expect(result.basis).toBe('floor')
  })

  it('the floor wins by five orders of magnitude on real data', () => {
    // The point of the previous test, stated as the claim it supports: the
    // measured arm AGL-1120 wired in is inert on every real org today, so a
    // richer cost model changes no verdict until there is real traffic.
    const result = orgMonthlyCogsUsd({ storageGb: 0.00034, contactsCount: 5 }, 1)
    expect(result.measuredUsd).toBeLessThan(0.01)
    expect(result.cogsUsd).toBe(INFRA_COGS_PER_SITE_USD)
  })

  it('measured wins once usage is genuinely large', () => {
    // The negative control for the floor: if this did not flip to 'measured'
    // the function would be an expensive way to return siteCount × $2.
    const result = orgMonthlyCogsUsd(
      { pageViews: 5_000_000, storageGb: 50, apiRequests: 2_000_000 },
      1,
    )
    // 5M views × $0.0001 = $500, plus 50 GB × $0.026 = $1.30 storage
    // (AGL-1280 corrected the rate from $0.03), plus $4 API.
    expect(result.measuredUsd).toBeCloseTo(500 + 1.3 + 4, 6)
    expect(result.basis).toBe('measured')
    expect(result.cogsUsd).toBeCloseTo(505.3, 6)
  })

  it('prices the three meters the old costUsd ignored', () => {
    // dataStorageMb, apiRequests and contactsCount are recorded on the rollup
    // and were priced at zero by `estimateMonthlyUsageCost`. If any of these
    // drop out, the model has silently regressed to the old one.
    const only = orgMonthlyCogsUsd(
      { dataStorageMb: 1024, apiRequests: 1_000_000, contactsCount: 10_000 },
      0,
    )
    expect(only.breakdown.dataStorage).toBeCloseTo(
      ORG_COGS_UNIT_RATES_USD.dataStoragePerGbMonth,
      10,
    )
    expect(only.breakdown.apiRequests).toBeCloseTo(2, 10)
    expect(only.breakdown.contacts).toBeCloseTo(2, 10)
    expect(only.measuredUsd).toBeGreaterThan(0)
  })

  it('converts dataStorageMb to GB rather than pricing megabytes as gigabytes', () => {
    // A 1024x error here would read as plausible money, which is why it gets
    // its own assertion rather than riding on the sum above.
    const result = orgMonthlyCogsUsd({ dataStorageMb: 2048 }, 0)
    expect(result.breakdown.dataStorage).toBeCloseTo(
      2 * ORG_COGS_UNIT_RATES_USD.dataStoragePerGbMonth,
      10,
    )
  })

  it('treats an absent or empty rollup as zero measured, never as cheap', () => {
    // A rollup that has not run must not make the guardrail more generous —
    // the one direction that costs money.
    for (const rollup of [null, undefined, {}]) {
      const result = orgMonthlyCogsUsd(rollup, 3)
      expect(result.measuredUsd).toBe(0)
      expect(result.cogsUsd).toBe(3 * INFRA_COGS_PER_SITE_USD)
      expect(result.basis).toBe('floor')
    }
  })

  it('ignores negative, NaN and garbage meter values', () => {
    const result = orgMonthlyCogsUsd(
      {
        pageViews: -5_000_000,
        storageGb: Number.NaN,
        apiRequests: Number.POSITIVE_INFINITY,
        contactsCount: 'lots' as unknown as number,
      },
      1,
    )
    // A negative meter must not become a COGS credit that pays for a discount.
    expect(result.measuredUsd).toBe(0)
    expect(result.cogsUsd).toBe(INFRA_COGS_PER_SITE_USD)
  })

  it('handles an org with no sites', () => {
    expect(orgMonthlyCogsUsd({}, 0).cogsUsd).toBe(0)
    expect(orgMonthlyCogsUsd({}, -1).floorUsd).toBe(0)
  })
})
