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

import { estimateMonthlyUsageCost } from './usage-metering'

describe('estimateMonthlyUsageCost', () => {
  it('prices summed usage at cost times the markup', () => {
    const estimate = estimateMonthlyUsageCost([
      {
        storageBytes: 10 * 1024 * 1024 * 1024, // 10 GB → $0.30
        pageViews: 10000, // → $1.00
        formSubmissions: 200, // → $0.10
      },
      { storageBytes: 0, pageViews: 5000, formSubmissions: 0 }, // → $0.50
    ])
    expect(estimate.storageGb).toBeCloseTo(10)
    expect(estimate.pageViews).toBe(15000)
    expect(estimate.costUsd).toBeCloseTo(1.9)
    expect(estimate.billedCents).toBe(247) // 1.9 × 1.3 = 2.47
  })

  it('handles empty and negative-garbage input', () => {
    expect(estimateMonthlyUsageCost([]).billedCents).toBe(0)
    expect(
      estimateMonthlyUsageCost([
        { storageBytes: -5, pageViews: NaN as any, formSubmissions: 0 },
      ]).billedCents,
    ).toBe(0)
  })
})
