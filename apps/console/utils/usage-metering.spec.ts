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
  ORG_COGS_UNIT_RATES_USD,
  METERED_MARKUP as MARKUP_FROM_LIB,
  PAGE_VIEW_CDN_REQUEST_COST_USD,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  billsEmailSendOverage,
  billsOrgLibraryStorage,
  ESTIMATED_PAGE_TRANSFER_BYTES,
  estimateMonthlyUsageCost,
  hostMeterReadings,
  METERED_BILLED_RATES_USD,
  METERED_MARKUP,
  METERED_OVERAGE_COST_USD,
  METERED_UNIT_RATES_USD,
  meteredBands,
  meteredBilledRateUsd,
  meteredIncludedAllowance,
  meteredOverageCostUsd,
  meteredUnitRateUsd,
  pageViewsFromBandwidthGb,
} from './usage-metering'

const GB = 1024 * 1024 * 1024

/**
 * Starter: 1 site × 2048 MB storage, 20 GB bandwidth, 200 form submissions.
 * Pro is the multi-site case (3 × 10240 MB, 3 × 1000 submissions), which is
 * what proves the org-wide expansion rather than assuming it.
 */
const starter = { plan: 'starter' } as any
const pro = { plan: 'pro' } as any
const free = { plan: 'free' } as any

describe('meteredIncludedAllowance', () => {
  it('expands per-site bands org-wide and converts bandwidth to page views', () => {
    /*
     * The bands come from the entitlement rather than being retyped here.
     * What this case is about is the EXPANSION and the CONVERSION — per-site
     * figures multiplied by the site limit, bandwidth left org-wide and
     * turned into page views. A band retyped as a literal pins the wrong
     * thing: it strands the moment a band is resized, and it says nothing
     * about the arithmetic. The band values themselves are pinned in
     * `plan-entitlements.spec.ts`, which is where a resize should be noticed.
     */
    const starterBands = resolveOrgEntitlements(starter)
    const proBands = resolveOrgEntitlements(pro)
    const included = meteredIncludedAllowance(starter)
    expect(included.metered).toBe(true)
    expect(included.storageGb).toBeCloseTo(starterBands.storagePerHostMb / 1024)
    expect(included.pageViews).toBeCloseTo(
      (starterBands.bandwidthGb * GB) / ESTIMATED_PAGE_TRANSFER_BYTES,
    )
    expect(included.meters.formSubmissions!).toBe(
      starterBands.formSubmissionsPerMonth,
    )
    // Pro allows 3 sites, so its org-wide bands are three times the per-site
    // figures — bandwidth excepted, which is already an org-level number.
    const multi = meteredIncludedAllowance(pro)
    expect(proBands.hostLimit).toBe(3)
    expect(multi.storageGb).toBeCloseTo(
      (proBands.hostLimit * proBands.storagePerHostMb) / 1024,
    )
    expect(multi.meters.formSubmissions).toBe(
      proBands.hostLimit * proBands.formSubmissionsPerMonth,
    )
    expect(multi.pageViews).toBeCloseTo(
      (proBands.bandwidthGb * GB) / ESTIMATED_PAGE_TRANSFER_BYTES,
    )
  })

  it('meters nothing on free or on an unknown org', () => {
    expect(meteredIncludedAllowance(free).metered).toBe(false)
    expect(meteredIncludedAllowance(null).metered).toBe(false)
    expect(meteredIncludedAllowance(undefined).metered).toBe(false)
  })

  it('sizes enterprise bands at the finite fallback, unmetered', () => {
    // Twice Agency's bands since 2026-09-07 — 200 sites × 120 GB, 790 GB of
    // views, 200 × 50,000 submissions — and `metered` false, so nothing past
    // them bills: an agreement sets the terms, and a per-org override the
    // figures.
    const included = meteredIncludedAllowance({ plan: 'enterprise' } as any)
    expect(included.storageGb).toBe(24_000)
    expect(included.pageViews).toBe(pageViewsFromBandwidthGb(790))
    expect(included.meters.formSubmissions!).toBe(10_000_000)
    expect(included.metered).toBe(false)
    // A contracted UNLIMITED still subtracts to zero billable usage.
    const contracted = meteredIncludedAllowance({
      plan: 'enterprise',
      entitlements: { storagePerHostMb: Number.POSITIVE_INFINITY },
    } as any)
    expect(contracted.storageGb).toBe(Number.POSITIVE_INFINITY)
  })
})

/**
 * The switch that decides whether org-library bytes reach an INVOICE
 * (AGL-1473).
 *
 * Org DAM uploads have been gated against quota and dropped before pricing for
 * months. Metering them is a correctness fix; CHARGING for them is a decision
 * with an invoice attached, so it is a start MONTH rather than a boolean.
 *
 * A boolean would have been the obvious shape and it is the wrong one. The
 * rollup can be re-run for any closed month — `report-usage` takes `month` in
 * its body and the daily cron re-sweeps whatever has no `reportedAt` — so a
 * boolean flipped on the 15th would bill a re-run of January at January's
 * accumulated bytes. A start month is the only form of this switch that cannot
 * reach backwards.
 */
describe('billsOrgLibraryStorage', () => {
  it('bills nothing until a start month is configured', () => {
    // The default has to be OFF. Metering ships; charging waits for a person.
    expect(billsOrgLibraryStorage('2026-08', undefined)).toBe(false)
    expect(billsOrgLibraryStorage('2026-08', '')).toBe(false)
    expect(billsOrgLibraryStorage('2026-08', null)).toBe(false)
  })

  it('bills the start month itself and every month after it', () => {
    expect(billsOrgLibraryStorage('2026-09', '2026-09')).toBe(true)
    expect(billsOrgLibraryStorage('2026-10', '2026-09')).toBe(true)
    expect(billsOrgLibraryStorage('2027-01', '2026-09')).toBe(true)
  })

  it('NEVER bills a month that closed before the start month', () => {
    // The no-backdating guarantee, stated as a test. Re-running an invoiced
    // month must produce the same bill it produced the first time.
    expect(billsOrgLibraryStorage('2026-08', '2026-09')).toBe(false)
    expect(billsOrgLibraryStorage('2026-01', '2026-09')).toBe(false)
    expect(billsOrgLibraryStorage('2025-12', '2026-09')).toBe(false)
  })

  it('compares by month, not by string luck across a year boundary', () => {
    // `'2026-09' <= '2027-01'` is true lexicographically only because the
    // format is zero-padded and fixed-width. Pinned so a future format change
    // (a `YYYY-M`, a date) fails here rather than at an invoice.
    expect(billsOrgLibraryStorage('2027-01', '2026-12')).toBe(true)
    expect(billsOrgLibraryStorage('2026-12', '2027-01')).toBe(false)
  })

  it('bills nothing when the configured value is not a month', () => {
    // A typo'd env var must fail CLOSED. Charging because someone wrote
    // `true` in a field expecting `2026-09` is the one direction with an
    // invoice behind it.
    for (const bad of ['true', 'yes', '2026', '2026-9', 'now', '0']) {
      expect(billsOrgLibraryStorage('2026-12', bad)).toBe(false)
    }
  })

  it('tolerates surrounding whitespace, which env vars collect', () => {
    expect(billsOrgLibraryStorage('2026-09', ' 2026-09 ')).toBe(true)
  })
})

/**
 * The same instrument, one meter over.
 *
 * Email sending has been counted for a long time and charged for none of it,
 * and the included bands came DOWN in the same change that gave it a rate —
 * so a boolean would price a month whose mail was sent under a larger
 * allowance. Most of the excess is transactional, which no cap was allowed to
 * refuse, so the customer could not have avoided it either.
 *
 * The two gates are ONE implementation, so this block is checking that the
 * email switch really is wired to it rather than to a second, drifting copy —
 * which is why it exercises the same edges rather than trusting the shared
 * body. `email-overage-reaches-the-invoice.spec.ts` is the other half: the
 * switch reaching `billedCents` through the real route.
 */
describe('billsEmailSendOverage', () => {
  it('bills nothing until a start month is configured', () => {
    expect(billsEmailSendOverage('2026-08', undefined)).toBe(false)
    expect(billsEmailSendOverage('2026-08', '')).toBe(false)
    expect(billsEmailSendOverage('2026-08', null)).toBe(false)
  })

  it('bills the start month itself and every month after it', () => {
    expect(billsEmailSendOverage('2026-09', '2026-09')).toBe(true)
    expect(billsEmailSendOverage('2026-10', '2026-09')).toBe(true)
    expect(billsEmailSendOverage('2027-01', '2026-09')).toBe(true)
  })

  it('NEVER bills a month that closed before the start month', () => {
    expect(billsEmailSendOverage('2026-08', '2026-09')).toBe(false)
    expect(billsEmailSendOverage('2025-12', '2026-09')).toBe(false)
  })

  it('bills nothing when the configured value is not a month', () => {
    for (const bad of ['true', 'yes', '2026', '2026-9', 'now', '0']) {
      expect(`${bad}: ${billsEmailSendOverage('2026-12', bad)}`).toBe(
        `${bad}: false`,
      )
    }
  })

  it('is a SEPARATE switch from the org-library one', () => {
    // Shared body, independent decisions. Setting one must not turn on the
    // other — they are two different charges starting on two different
    // months, and conflating them is a charge nobody agreed to.
    expect(billsOrgLibraryStorage('2026-09', '2026-09')).toBe(true)
    expect(billsEmailSendOverage('2026-09', undefined)).toBe(false)
    expect(billsEmailSendOverage('2026-09', '2026-09')).toBe(true)
    expect(billsOrgLibraryStorage('2026-09', undefined)).toBe(false)
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
          // Exactly the band → free, and it must not drag storage down
          pageViews: included.pageViews,
          // 200 past the 200 band → 200 × $0.00005 = $0.01
          meters: { formSubmissions: included.meters.formSubmissions! + 200 },
        },
      ],
      starter,
    )
    expect(estimate.billableStorageGb).toBeCloseTo(10)
    expect(estimate.billablePageViews).toBe(0)
    expect(estimate.billableMeters.formSubmissions).toBe(200)
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

  /**
   * A page view past the band bills its weight AND its CDN requests, both at
   * the CDN's dearest region (AGL-1879, AGL-3444) — $0.80 per 1,000 — while
   * `costUsd`, the COGS figure the cost model shares, prices every view on
   * weight alone.
   */
  it('bills page views past the band at $0.80 per 1,000', () => {
    const included = meteredIncludedAllowance(starter)
    const estimate = estimateMonthlyUsageCost(
      [
        {
          storageBytes: 0,
          // Rounded up so the band subtracts to a whole 100,000 past it.
          pageViews: Math.ceil(included.pageViews) + 100_000,
        },
      ],
      starter,
    )
    expect(estimate.billablePageViews).toBeCloseTo(
      Math.ceil(included.pageViews) - included.pageViews + 100_000,
      6,
    )
    // Pinned as LITERALS: 100,000 views × $0.80 / 1,000 = $80.00, from a
    // cost of 100,000 × $0.000615385 = $61.54.
    const views = estimate.billablePageViews
    expect(estimate.billableCostUsd).toBeCloseTo(views * 0.00061538462, 8)
    expect(estimate.billedCents).toBe(Math.round(views * 0.0008 * 100))
    expect(estimate.billedCents).toBe(8000)
    expect(estimate.billableUsdByMeter.pageViews).toBeCloseTo(views * 0.0008, 5)
    // COGS stays on weight: every view, at the shared unit rate.
    expect(estimate.costUsd).toBeCloseTo(
      estimate.pageViews * ORG_COGS_UNIT_RATES_USD.perPageView,
      8,
    )
  })

  it('charges nothing at exactly the included amount', () => {
    const included = meteredIncludedAllowance(starter)
    const estimate = estimateMonthlyUsageCost(
      [
        {
          storageBytes: included.storageGb * GB,
          pageViews: included.pageViews,
          meters: { formSubmissions: included.meters.formSubmissions! },
        },
      ],
      starter,
    )
    expect(estimate.billableStorageGb).toBe(0)
    expect(estimate.billablePageViews).toBe(0)
    expect(estimate.billableMeters.formSubmissions).toBe(0)
    expect(estimate.billedCents).toBe(0)
  })

  it('sums the counters across sites before subtracting the band', () => {
    const included = meteredIncludedAllowance(starter)
    const half = included.meters.formSubmissions! / 2
    const estimate = estimateMonthlyUsageCost(
      [
        {
          storageBytes: 0,
          pageViews: 0,
          meters: { formSubmissions: half + 100 },
        },
        {
          storageBytes: 0,
          pageViews: 0,
          meters: { formSubmissions: half + 100 },
        },
      ],
      starter,
    )
    // Two sites each over their own share, but the BAND is org-wide.
    expect(estimate.meters.formSubmissions).toBe(
      included.meters.formSubmissions! + 200,
    )
    expect(estimate.billableMeters.formSubmissions).toBe(200)
  })

  it('bills a free or unknown org nothing, however much it uses', () => {
    const heavy = [
      {
        storageBytes: 500 * GB,
        pageViews: 5_000_000,
        meters: { formSubmissions: 90_000 },
      },
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
        [
          {
            storageBytes: -5,
            pageViews: NaN as any,
            meters: { formSubmissions: -3 },
          },
        ],
        starter,
      ).billedCents,
    ).toBe(0)
  })
})

/**
 * The drift both files forbid in prose and nothing checked (AGL-2194).
 *
 * `METERED_UNIT_RATES_USD` here is the table a customer is BILLED against;
 * `ORG_COGS_UNIT_RATES_USD` in `plan-entitlements.ts` is the same three
 * figures used for COGS and the discount guardrail. Both docstrings say they
 * "MUST be changed together" / "must never drift" — and until this suite there
 * was no assertion anywhere in the repo that they had not. AGL-1280 moved both
 * on the same day by hand; the next correction had nothing to catch a
 * half-applied one, and a COGS table quietly holding the OLD rate would make
 * the discount guardrail underwrite against a price nobody is charged.
 *
 * Keyed off `METERED_UNIT_RATES_USD` rather than a literal list, so a fourth
 * billed meter added here without a COGS entry fails instead of being skipped.
 */
describe('the billed rate table and the COGS rate table (AGL-2194)', () => {
  it('carries identical figures for every meter that is billed', () => {
    const billed = Object.keys(METERED_UNIT_RATES_USD) as Array<
      keyof typeof METERED_UNIT_RATES_USD
    >
    // The guard is worthless if the key set it iterates is empty or has
    // silently shrunk — assert the shape before asserting the values.
    expect(billed.sort()).toEqual([
      'perFormSubmission',
      'perPageView',
      'storagePerGbMonth',
    ])
    for (const key of billed) {
      expect(ORG_COGS_UNIT_RATES_USD).toHaveProperty(key)
      expect(METERED_UNIT_RATES_USD[key]).toBe(
        ORG_COGS_UNIT_RATES_USD[key as keyof typeof ORG_COGS_UNIT_RATES_USD],
      )
    }
  })

  /**
   * The published rate set: $0.0338/GB-mo, $0.80/1k page views, $0.08/1k form
   * submissions. Those are the CUSTOMER-facing figures, so they are asserted
   * post-markup — the form the published page states and the form a customer
   * can check. `published-pricing-table-parity.spec.ts` pins the same three
   * figures from the other direction, as transcribed off the live page; this
   * one pins them against the COGS table, so neither a code-side drift nor a
   * half-applied rate correction can move what a customer is billed without a
   * red.
   *
   * Storage is where the Sept-1 lock put it. The page-view rate was
   * re-pegged on 2026-09-09 (AGL-2711) when the weight reduction the standing
   * decision preferred landed and the page still measured far above the
   * 627 KB the rate was calibrated for; a billed view took on its CDN requests
   * on 2026-10-01 (AGL-1879), $0.21 → $0.36; and the same day every
   * Vercel-billed input was priced at the dearest region (AGL-3444): page
   * views $0.70, form submissions $0.065 → $0.07 — and then, the same day,
   * with Vercel's GB read as decimal, Firestore priced at nam5 and the
   * analytics beacon counted: $0.80 and $0.08.
   */
  it('prices the published rate set after markup', () => {
    const per1k = (rate: number) =>
      Math.round(rate * METERED_MARKUP * 1000 * 10_000) / 10_000
    expect(
      Math.round(
        METERED_UNIT_RATES_USD.storagePerGbMonth * METERED_MARKUP * 10_000,
      ) / 10_000,
    ).toBe(0.0338)
    expect(per1k(METERED_OVERAGE_COST_USD.perPageView)).toBe(0.8)
    expect(per1k(METERED_UNIT_RATES_USD.perFormSubmission)).toBe(0.08)
    // The page-view price is the weight term plus the request term; the
    // weight term alone, marked up, is a figure no surface publishes.
    expect(METERED_OVERAGE_COST_USD.perPageView).toBe(
      METERED_UNIT_RATES_USD.perPageView + PAGE_VIEW_CDN_REQUEST_COST_USD,
    )
    expect(per1k(METERED_UNIT_RATES_USD.perPageView)).toBe(0.5187)
    // And the billed table is that sum marked up, the figure the Billing
    // card prints.
    expect(Math.round(METERED_BILLED_RATES_USD.perPageView * 1000 * 100) / 100).toBe(0.8)
    // Storage and form submissions carry no second term.
    expect(METERED_OVERAGE_COST_USD.storagePerGbMonth).toBe(
      METERED_UNIT_RATES_USD.storagePerGbMonth,
    )
    expect(METERED_OVERAGE_COST_USD.perFormSubmission).toBe(
      METERED_UNIT_RATES_USD.perFormSubmission,
    )
  })

  /** The re-export is the same binding, not a second 1.3 that can drift. */
  it('re-exports the one markup constant', () => {
    expect(METERED_MARKUP).toBe(MARKUP_FROM_LIB)
    expect(METERED_MARKUP).toBe(1.3)
  })
})

/**
 * A plugin's metered band (AGL-3080). The estimate names no plugin meter: it
 * prices every band a plugin declares `metered`, at the rate its declaration
 * names in the table above. These hold the declarations to that table and the
 * estimate to the declarations.
 */
describe('the metered bands plugins declare', () => {
  it('names a rate this table carries for every band, and prices at it', () => {
    expect(meteredBands().length).toBeGreaterThan(0)
    for (const band of meteredBands()) {
      expect([band.id, Object.keys(METERED_UNIT_RATES_USD)]).toEqual([
        band.id,
        expect.arrayContaining([band.metered.rate]),
      ])
      expect(meteredUnitRateUsd(band)).toBe(
        METERED_UNIT_RATES_USD[
          band.metered.rate as keyof typeof METERED_UNIT_RATES_USD
        ],
      )
      expect(meteredOverageCostUsd(band)).toBe(
        METERED_OVERAGE_COST_USD[
          band.metered.rate as keyof typeof METERED_OVERAGE_COST_USD
        ],
      )
      expect(meteredBilledRateUsd(band)).toBe(
        METERED_BILLED_RATES_USD[
          band.metered.rate as keyof typeof METERED_BILLED_RATES_USD
        ],
      )
    }
  })

  it('refuses a band whose rate the table does not carry, rather than pricing it at zero', () => {
    const [band] = meteredBands()
    expect(() =>
      meteredUnitRateUsd({
        ...band!,
        metered: { ...band!.metered, rate: 'perNothing' },
      }),
    ).toThrow(/perNothing/)
  })

  it("is the forms plugin's submissions today, billed per 1,000 once the Inbox is released", () => {
    expect(
      meteredBands().map((band) => ({
        pluginId: band.pluginId,
        id: band.id,
        hostCounter: band.hostCounter,
        metered: band.metered,
      })),
    ).toEqual([
      {
        pluginId: 'forms',
        id: 'formSubmissions',
        hostCounter: 'formSubmissions',
        metered: {
          rate: 'perFormSubmission',
          quotedPer: 1000,
          noun: 'form submissions',
          withheldUntil: 'release_inbox',
        },
      },
    ])
  })

  it("reads each band's month off the host counter it names", () => {
    const read = jest.fn((counter: string) =>
      counter === 'formSubmissions' ? 42 : undefined,
    )
    expect(hostMeterReadings(read)).toEqual({ formSubmissions: 42 })
    expect(read.mock.calls.map(([counter]) => counter)).toEqual(
      meteredBands().map((band) => band.hostCounter),
    )
  })

  it("splits the charge into storage, page views and each band's share, which add up to it", () => {
    const included = meteredIncludedAllowance(starter)
    const estimate = estimateMonthlyUsageCost(
      [
        {
          storageBytes: (included.storageGb + 3) * GB,
          pageViews: included.pageViews + 4_000,
          meters: { formSubmissions: included.meters.formSubmissions! + 900 },
        },
      ],
      starter,
    )
    expect(Object.keys(estimate.billableUsdByMeter).sort()).toEqual(
      ['pageViews', 'storage', ...meteredBands().map((band) => band.id)].sort(),
    )
    const shares = Object.values(estimate.billableUsdByMeter).reduce(
      (sum, usd) => sum + usd,
      0,
    )
    expect(shares).toBeCloseTo(estimate.billableCostUsd * METERED_MARKUP, 10)
    expect(estimate.billableUsdByMeter['formSubmissions']).toBeCloseTo(
      900 * METERED_UNIT_RATES_USD.perFormSubmission * METERED_MARKUP,
      10,
    )
  })
})
