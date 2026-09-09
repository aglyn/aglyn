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
  orgCogsInputFrom,
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

  it('the floor wins on every real org — but the gap is now ONE order of magnitude, not five', () => {
    // The point of the previous test, stated as the claim it supports: the
    // measured arm AGL-1120 wired in is inert on every real org today, so a
    // richer cost model changes no verdict until there is real traffic.
    const result = orgMonthlyCogsUsd({ storageGb: 0.00034, contactsCount: 5 }, 1)
    expect(result.measuredUsd).toBeLessThan(0.01)
    expect(result.cogsUsd).toBe(INFRA_COGS_PER_SITE_USD)

    /*
     * AGL-1930 re-measured this against production 2026-08-24 — 6 orgs, 14
     * usage rollups, every one of them `basis: 'floor'`. The DISTRIBUTION is
     * unchanged (100% floor, as when this test was written), but the MARGIN
     * has closed by four orders of magnitude:
     *
     *   org           month    sites  measured   floor   floor/measured
     *   jWmGooWE3L    2026-08    1    $0.21932   $2.00        9.1x
     *   hz_KgetqSq    2026-08    1    $0.00761   $2.00      262.8x
     *   alx59wnpi…    2026-08    2    $0.00211   $4.00     1900.2x
     *   1aLoHY_10k    2026-08    1    $0        $2.00          inf
     *   wgxBb4L4pC    2026-08    1    $0        $2.00          inf
     *   DaJ5zn69Wx      —        1    (no rollup)
     *
     * The old headline ($0.0000054 vs $4.00) was read off the June rollups,
     * before page views were metered at all. The test title said five orders
     * of magnitude and the assertion below only ever checked one, so the claim
     * could rot without anything going red. This is that claim, asserted:
     * the busiest real org sits inside a single order of magnitude of its
     * floor, and the floor still wins.
     *
     * The table above is the measurement AS TAKEN, priced at the $0.0001 per
     * view the meter carried on 2026-08-24. The 2026-09-09 re-peg (AGL-2711)
     * moved that rate, not the usage: the busiest org's 2,169 views cost
     * $0.1335 more, so its measured total is $0.35280 and its floor is 5.7x
     * rather than 9.1x. The other rows move the same way and their view
     * counts were not recorded, so they are left at the figures the
     * measurement produced rather than restated at a rate they were not read
     * under.
     */
    const busiestRealOrg = orgMonthlyCogsUsd(
      // orgs/jWmGooWE3L/usage/2026-08, read from production 2026-08-24.
      {
        storageGb: 0.041155,
        pageViews: 2169,
        formSubmissions: 7,
        contactsCount: 5,
      },
      1,
    )
    expect(busiestRealOrg.basis).toBe('floor')
    expect(busiestRealOrg.measuredUsd).toBeCloseTo(0.3528, 4)
    const gap = INFRA_COGS_PER_SITE_USD / busiestRealOrg.measuredUsd
    expect(gap).toBeGreaterThan(1)
    expect(gap).toBeLessThan(100)
  })

  it('names the traffic at which the floor stops deciding (AGL-1930)', () => {
    // The re-tune trigger, as arithmetic rather than a note in a ticket.
    // `NET_MARGIN_FLOOR_PCT` is a multiple applied to whatever COGS figure
    // comes out of here, and that figure is the flat floor for 14 of 14 real
    // rollups — so the thresholds cannot be calibrated against measurement
    // until at least one org crosses this line.
    //
    // One site, page views alone: $2.00 / $0.00016153846 = 12,381 views/month.
    // The busiest real org is at 2,169 — 18% of the way. It was 20,000 views
    // until the 2026-09-09 re-peg raised what a view costs; the line moved
    // toward the traffic rather than the traffic toward the line, which is
    // the one direction that makes this threshold reachable sooner.
    //
    // Derived from the rate rather than restated, so the boundary probes
    // below cannot drift from the constant that sets them.
    const breakEvenViews =
      INFRA_COGS_PER_SITE_USD / ORG_COGS_UNIT_RATES_USD.perPageView
    expect(Math.round(breakEvenViews)).toBe(12_381)
    expect(orgMonthlyCogsUsd({ pageViews: Math.floor(breakEvenViews) }, 1).basis).toBe('floor')
    expect(orgMonthlyCogsUsd({ pageViews: Math.ceil(breakEvenViews) }, 1).basis).toBe('measured')
    // Assist is the one input that can clear the floor without any traffic at
    // all — it enters in dollars, so $2.01 of tokens on a single-site org
    // flips the basis by itself (AGL-2280).
    expect(orgMonthlyCogsUsd({ assistCostUsd: 2.01 }, 1).basis).toBe('measured')
    expect(orgMonthlyCogsUsd({ assistCostUsd: 1.99 }, 1).basis).toBe('floor')
  })

  it('keeps absent, zero and garbage meters distinct from a real measurement', () => {
    // `strictNullChecks` is OFF, so an absent meter folds to falsy and prices
    // as zero — which is the direction that INFLATES margin. Three inputs that
    // all read as "no cost": the guarantee is that none of them can ever
    // produce a SMALLER charge than the floor, so a missing meter cannot buy
    // a discount.
    const absent = orgMonthlyCogsUsd({ pageViews: undefined }, 1)
    const zero = orgMonthlyCogsUsd({ pageViews: 0 }, 1)
    const garbage = orgMonthlyCogsUsd({ pageViews: Number.NaN }, 1)
    for (const result of [absent, zero, garbage]) {
      expect(result.measuredUsd).toBe(0)
      expect(result.basis).toBe('floor')
      expect(result.cogsUsd).toBe(INFRA_COGS_PER_SITE_USD)
    }
    // And `basis` alone must not be read as "this org has no usage": a
    // measured-but-under-floor org reports the same `floor` basis with a
    // non-zero `measuredUsd`. That distinction is what the staff card's copy
    // now leans on.
    const measuredButUnderFloor = orgMonthlyCogsUsd({ pageViews: 2169 }, 1)
    expect(measuredButUnderFloor.basis).toBe('floor')
    expect(measuredButUnderFloor.measuredUsd).toBeGreaterThan(0)
  })

  it('measured wins once usage is genuinely large', () => {
    // The negative control for the floor: if this did not flip to 'measured'
    // the function would be an expensive way to return siteCount × $2.
    const result = orgMonthlyCogsUsd(
      { pageViews: 5_000_000, storageGb: 50, apiRequests: 2_000_000 },
      1,
    )
    // 5M views × $0.00016153846 = $807.69 (AGL-2711 re-pegged the rate from
    // $0.0001), plus 50 GB × $0.026 = $1.30 storage (AGL-1280 corrected that
    // one from $0.03), plus $4 API.
    expect(result.measuredUsd).toBeCloseTo(807.6923 + 1.3 + 4, 4)
    expect(result.basis).toBe('measured')
    expect(result.cogsUsd).toBeCloseTo(812.9923, 4)
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

  /**
   * Email SENDS are priced. The two figures beside them are not.
   *
   * The rollup document carries three email-ish fields and only one of them
   * is a cost: `emailSends` is every message a provider charged for, so it
   * enters the model at `perEmailSend`. `emailSendsOverage` is a SUBSET of
   * that same volume — pricing it too would bill the excess twice — and
   * `campaignEmailSends` is a subset again.
   *
   * The distinction is the whole test. A model that priced "anything that
   * looks like email" would double-count by however much an org exceeded its
   * band, and a model that priced none of it reports a busy sender as free.
   */
  it('prices emailSends, and nothing else on the email axis', () => {
    const priced = {
      storageGb: 3,
      pageViews: 12_000,
      formSubmissions: 40,
      dataStorageMb: 512,
      apiRequests: 90_000,
      contactsCount: 1_200,
    }
    const withoutEmail = orgMonthlyCogsUsd(priced, 2)
    const withEmail = orgMonthlyCogsUsd(
      {
        ...priced,
        emailSends: 100_000,
        emailSendsOverage: 95_000,
        campaignEmailSends: 5_000,
      } as never,
      2,
    )
    // 100,000 x $0.0009 = $90.00, and not a cent more from the two fields
    // beside it.
    expect(withEmail.measuredUsd - withoutEmail.measuredUsd).toBeCloseTo(90, 6)
    expect(withEmail.breakdown.emailSends).toBeCloseTo(90, 6)
    expect(ORG_COGS_UNIT_RATES_USD.perEmailSend).toBe(0.0009)
    // Every OTHER breakdown line is untouched — the new term did not land in
    // one of the six that were already there.
    for (const key of Object.keys(withoutEmail.breakdown)) {
      if (key === 'emailSends') continue
      expect(`${key}=${withEmail.breakdown[key]}`).toBe(
        `${key}=${withoutEmail.breakdown[key]}`,
      )
    }
    // The rate table prices email ONCE. A `perEmailSendOverage` or a
    // per-campaign rate appearing here is the double-count.
    expect(
      Object.keys(ORG_COGS_UNIT_RATES_USD).filter((rate) =>
        /email|campaign/i.test(rate),
      ),
    ).toEqual(['perEmailSend'])
  })

  /**
   * Workflow and action RUNS are priced, together, at one rate (2026-09-07).
   *
   * Both counters were recorded on every rollup and read as nothing: there
   * was no `perRun`, so Agency's 3,000,000 runs a month were $36 the model
   * could not see. One rate for the two because a run is the same handful
   * of reads, two writes and a moment of compute whichever builder produced
   * it; the bands differ only in which tier sells them.
   */
  it('prices workflow and action runs together, at perRun', () => {
    const priced = { storageGb: 3, pageViews: 12_000 }
    const without = orgMonthlyCogsUsd(priced, 2)
    const withRuns = orgMonthlyCogsUsd(
      { ...priced, workflowRuns: 900_000, actionRuns: 600_000 },
      2,
    )
    // 1,500,000 × $0.000012 = $18.00, on one line.
    expect(ORG_COGS_UNIT_RATES_USD.perRun).toBe(0.000012)
    expect(withRuns.breakdown.runs).toBeCloseTo(18, 6)
    expect(withRuns.measuredUsd - without.measuredUsd).toBeCloseTo(18, 6)
    // Every OTHER breakdown line is untouched.
    for (const key of Object.keys(without.breakdown)) {
      if (key === 'runs') continue
      expect(`${key}=${withRuns.breakdown[key]}`).toBe(`${key}=${without.breakdown[key]}`)
    }
    // Either counter alone reaches the line — a model that read only one of
    // the two would price half the automations an org runs.
    expect(orgMonthlyCogsUsd({ workflowRuns: 1_000_000 }, 0).breakdown.runs).toBeCloseTo(12, 6)
    expect(orgMonthlyCogsUsd({ actionRuns: 1_000_000 }, 0).breakdown.runs).toBeCloseTo(12, 6)
    // …and the rate is really read: the same rollup moves with it.
    const rates = ORG_COGS_UNIT_RATES_USD as unknown as Record<string, number>
    const original = rates.perRun
    try {
      rates.perRun = original * 2
      expect(orgMonthlyCogsUsd({ workflowRuns: 1_000_000 }, 0).breakdown.runs).toBeCloseTo(24, 6)
    } finally {
      rates.perRun = original
    }
  })

  /**
   * NOT vacuous: with the rate at zero the assertion above would read the
   * same as "email is not priced", which is the state this replaced.
   */
  it('the email term really moves the total', () => {
    const base = orgMonthlyCogsUsd({ emailSends: 0 } as never, 0)
    const busy = orgMonthlyCogsUsd({ emailSends: 1_000_000 } as never, 0)
    expect(base.measuredUsd).toBe(0)
    expect(busy.measuredUsd).toBeCloseTo(900, 6)
    // …and it clears the per-site floor on its own, which no other meter has
    // ever done. That is why it is worth pricing at all.
    expect(busy.basis).toBe('measured')
  })

  /**
   * The projection is the other half: `orgCogsInputFrom` decides which fields
   * ever reach the model. It must forward `emailSends` — a projection that
   * drops a priced field returns a SMALLER cost, and a smaller cost is the
   * direction that approves a discount — and it must not start forwarding the
   * overage or the campaign subset because they have plausible-looking names.
   */
  it('projects emailSends alone off the rollup document', () => {
    const input = orgCogsInputFrom({
      storageGb: 3,
      emailSends: 100_000,
      emailSendsOverage: 95_000,
      campaignEmailSends: 5_000,
    })
    expect(input.emailSends).toBe(100_000)
    expect(Object.keys(input).filter((key) => /email/i.test(key))).toEqual([
      'emailSends',
    ])
    expect(input.storageGb).toBe(3)
  })
})
