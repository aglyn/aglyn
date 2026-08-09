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
  ESTIMATED_PAGE_TRANSFER_BYTES,
  estimateMonthlyUsageCost,
  meteredIncludedAllowance,
} from './usage-metering'

const GB = 1024 * 1024 * 1024

/**
 * Starter: 1 site × 2048 MB storage, 50 GB bandwidth, 200 form submissions.
 * Pro is the multi-site case (3 × 10240 MB, 3 × 1000 submissions), which is
 * what proves the org-wide expansion rather than assuming it.
 */
const starter = { plan: 'starter' } as any
const pro = { plan: 'pro' } as any
const free = { plan: 'free' } as any

describe('meteredIncludedAllowance', () => {
  it('expands per-site bands org-wide and converts bandwidth to page views', () => {
    const included = meteredIncludedAllowance(starter)
    expect(included.metered).toBe(true)
    expect(included.storageGb).toBeCloseTo(2048 / 1024)
    expect(included.pageViews).toBeCloseTo(
      (50 * GB) / ESTIMATED_PAGE_TRANSFER_BYTES,
    )
    expect(included.formSubmissions).toBe(200)
    // Pro allows 3 sites, so its org-wide bands are three times the per-site
    // figures — bandwidth excepted, which is already an org-level number.
    const multi = meteredIncludedAllowance(pro)
    expect(multi.storageGb).toBeCloseTo((3 * 10240) / 1024)
    expect(multi.formSubmissions).toBe(3 * 1000)
    expect(multi.pageViews).toBeCloseTo(
      (250 * GB) / ESTIMATED_PAGE_TRANSFER_BYTES,
    )
  })

  it('meters nothing on free or on an unknown org', () => {
    expect(meteredIncludedAllowance(free).metered).toBe(false)
    expect(meteredIncludedAllowance(null).metered).toBe(false)
    expect(meteredIncludedAllowance(undefined).metered).toBe(false)
  })

  it('leaves enterprise bands unlimited', () => {
    const included = meteredIncludedAllowance({ plan: 'enterprise' } as any)
    expect(included.storageGb).toBe(Number.POSITIVE_INFINITY)
    expect(included.pageViews).toBe(Number.POSITIVE_INFINITY)
    expect(included.formSubmissions).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('estimateMonthlyUsageCost', () => {
  it('prices only usage BEYOND the included band, per meter (AGL-1280)', () => {
    const included = meteredIncludedAllowance(starter)
    const estimate = estimateMonthlyUsageCost(
      [
        {
          // 10 GB past the 2 GB band → 10 × $0.026 = $0.26
          storageBytes: (included.storageGb + 10) * GB,
          // exactly the band → free, and it must not drag storage down
          pageViews: included.pageViews,
          // 200 past the 200 band → 200 × $0.00005 = $0.01
          formSubmissions: included.formSubmissions + 200,
        },
      ],
      starter,
    )
    expect(estimate.billableStorageGb).toBeCloseTo(10)
    expect(estimate.billablePageViews).toBe(0)
    expect(estimate.billableFormSubmissions).toBe(200)
    // Pinned as LITERALS, deliberately: recomputing from
    // `METERED_UNIT_RATES_USD` would assert only that multiplication works,
    // and these rates are the numbers a customer is billed against. Corrected
    // 2026-08-09 (AGL-1280) from $0.03/GB and $0.0005/submission, which made
    // the published "cost + 30%" false. A diff here means a rate moved.
    expect(estimate.billableCostUsd).toBeCloseTo(0.27)
    expect(estimate.billedCents).toBe(35) // 0.27 × 1.3 = 0.351
    // Gross cost is untouched — it is our COGS, which no band reduces.
    expect(estimate.costUsd).toBeGreaterThan(estimate.billableCostUsd)
  })

  it('charges nothing at exactly the included amount', () => {
    const included = meteredIncludedAllowance(starter)
    const estimate = estimateMonthlyUsageCost(
      [
        {
          storageBytes: included.storageGb * GB,
          pageViews: included.pageViews,
          formSubmissions: included.formSubmissions,
        },
      ],
      starter,
    )
    expect(estimate.billableStorageGb).toBe(0)
    expect(estimate.billablePageViews).toBe(0)
    expect(estimate.billableFormSubmissions).toBe(0)
    expect(estimate.billedCents).toBe(0)
  })

  it('sums the counters across sites before subtracting the band', () => {
    const included = meteredIncludedAllowance(starter)
    const half = included.formSubmissions / 2
    const estimate = estimateMonthlyUsageCost(
      [
        { storageBytes: 0, pageViews: 0, formSubmissions: half + 100 },
        { storageBytes: 0, pageViews: 0, formSubmissions: half + 100 },
      ],
      starter,
    )
    // Two sites each over their own share, but the BAND is org-wide.
    expect(estimate.formSubmissions).toBe(included.formSubmissions + 200)
    expect(estimate.billableFormSubmissions).toBe(200)
  })

  it('bills a free or unknown org nothing, however much it uses', () => {
    const heavy = [
      { storageBytes: 500 * GB, pageViews: 5_000_000, formSubmissions: 90_000 },
    ]
    expect(estimateMonthlyUsageCost(heavy, free).billedCents).toBe(0)
    expect(estimateMonthlyUsageCost(heavy).billedCents).toBe(0)
    // …but the gross cost is still reported, because we really did pay it.
    expect(estimateMonthlyUsageCost(heavy, free).costUsd).toBeGreaterThan(0)
  })

  it('handles empty and negative-garbage input', () => {
    expect(estimateMonthlyUsageCost([], starter).billedCents).toBe(0)
    expect(
      estimateMonthlyUsageCost(
        [{ storageBytes: -5, pageViews: NaN as any, formSubmissions: 0 }],
        starter,
      ).billedCents,
    ).toBe(0)
  })
})
