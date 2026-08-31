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
 * REALISED UTILIZATION, AND THE TWO WAYS OF FAKING IT.
 *
 * `tier-margin-floor.spec.ts` answers "what does this tier cost if a customer
 * spends exactly what they bought". This answers "how much of it do they
 * actually spend", and the two have to agree about the first question or the
 * second is being asked against a different cost model than the one the
 * discount guardrail underwrites on.
 *
 * The agreement is asserted directly: a synthetic org placed at a known
 * fraction of every band on its plan must price, through `orgMonthlyCogsUsd`
 * and this module's band table, to the SAME dollar figure the margin floor
 * computes from `PLAN_ENTITLEMENTS` × `ORG_COGS_UNIT_RATES_USD`. If the band
 * table here drifts — a per-host band left unexpanded, a megabyte read as a
 * gigabyte, `contactsPerHost` multiplied by the host limit because of its
 * name — the two figures separate and this file says by how much.
 *
 * ## The two ways a utilization model reads green while measuring nothing
 *
 * Both have precedent in this repo and both are exercised below.
 *
 *  1. EVERY BAND ZERO. A stubbed or renamed entitlements table makes every
 *     denominator 0. `used / 0` is `Infinity` and `0 / 0` is `NaN`, and a model
 *     that coerces either to a number reports every org as fully — or infinitely
 *     — utilized, on no data at all. The CONTROL block asserts the bands are
 *     real, distinct per plan, and that a zero band produces `noAllowance`
 *     rather than a percentage.
 *  2. EVERY BAND UNBOUNDED. `UNLIMITED` is `Number.POSITIVE_INFINITY`, so
 *     `used / included` is 0 for any usage whatever, and the platform's
 *     heaviest customers report as its lightest. This is the same defect that
 *     made Agency's uncapped form band cost nothing, which is the reason the
 *     margin floor fails on an unbounded term instead of skipping it.
 */

import {
  ORG_COGS_UNIT_RATES_USD,
  PLAN_ENTITLEMENTS,
  UNLIMITED,
  orgMonthlyCogsUsd,
} from '@aglyn/aglyn'
import type { OrgPlan } from '@aglyn/aglyn'
import { ESTIMATED_PAGE_TRANSFER_BYTES } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  BANDS_WITHOUT_A_UNIT_COST,
  UTILIZATION_BANDS,
  bandUtilization,
  byWorstMargin,
  fleetUtilization,
  orgIncludedBands,
  orgMarginRow,
  percentile,
  type OrgMarginRow,
} from '../utils/margin-utilization'

/** The paid tiers — the only ones with both a band set and a price. */
const PAID: OrgPlan[] = ['starter', 'pro', 'business', 'scale', 'advanced', 'agency']

/** Page views one GB of bandwidth buys, from the constant the meter is priced on. */
const VIEWS_PER_GB = (1024 * 1024 * 1024) / ESTIMATED_PAGE_TRANSFER_BYTES

/**
 * The margin floor's cost model, restated here from the SAME two tables.
 *
 * A deliberate second derivation rather than an import: `tier-margin-floor.spec.ts`
 * keeps its `bandCostTerms` private, and copying the arithmetic is what makes
 * the comparison below a real one. If this drifts from that file the two specs
 * disagree and both are read.
 */
function tierBandCostUsd(plan: OrgPlan): number {
  const entitlements = PLAN_ENTITLEMENTS[plan]
  const hosts = entitlements.hostLimit
  const rates = ORG_COGS_UNIT_RATES_USD
  return (
    ((hosts * entitlements.storagePerHostMb) / 1024) * rates.storagePerGbMonth +
    hosts * entitlements.formSubmissionsPerMonth * rates.perFormSubmission +
    entitlements.bandwidthGb * VIEWS_PER_GB * rates.perPageView +
    (entitlements.dataStorageMbPerOrg / 1024) * rates.dataStoragePerGbMonth +
    entitlements.apiRequestsPerMonth * rates.perApiRequest +
    entitlements.contactsPerHost * rates.perContactMonth +
    entitlements.emailSendsPerMonth * rates.perEmailSend
  )
}

/** A billing org on `plan` with `hosts` sites — the shape every revenue helper reads. */
function orgOn(plan: OrgPlan, hosts = 1): Record<string, unknown> {
  return {
    plan,
    subscription: { status: 'active', interval: 'month' },
    hosts: Object.fromEntries(
      Array.from({ length: hosts }, (_, index) => [`site-${index}`, true]),
    ),
  }
}

/**
 * A rollup placing an org at exactly `utilization` of every FINITE band on its
 * plan. An uncapped band gets a fixed, large-but-real reading: there is no
 * fraction of infinity to take, and a measurement is what an org actually has.
 */
function rollupAt(
  plan: OrgPlan,
  utilization: number,
  uncappedReading = 1_000_000,
): Record<string, number> {
  const bands = orgIncludedBands(orgOn(plan) as never)
  const at = (band: keyof typeof bands) =>
    Number.isFinite(bands[band]) ? bands[band] * utilization : uncappedReading
  return {
    storageGb: at('storageGb'),
    pageViews: at('pageViews'),
    formSubmissions: at('formSubmissions'),
    dataStorageMb: at('dataStorageMb'),
    apiRequests: at('apiRequests'),
    contactsCount: at('contactsCount'),
    emailSends: at('emailSends'),
  }
}

// ---------------------------------------------------------------------------
// THE CONTROL. Every assertion below divides by a band read out of a table by
// string key. A stub, a rename or a collapsed table makes every denominator 0,
// and every org then reads as infinitely utilized on no evidence. Prove the
// denominators are real BEFORE anything is measured against them.
// ---------------------------------------------------------------------------
describe('the bands are real, and the plan is what selects them', () => {
  /**
   * WHICH BANDS EACH PLAN SELLS NONE OF, pinned exactly.
   *
   * A stub, a rename or a collapsed entitlements table makes EVERY band zero,
   * and a utilization model reading a zero denominator is the first of the two
   * failure modes in this file's header. Pinning the set means that failure
   * shows up here as seven extra names per plan rather than as a page full of
   * plausible percentages.
   *
   * It is also the fact the surface most needs to be right about: a band of
   * zero is not a band of 100% used, and the plans differ sharply in which
   * ones they sell at all.
   */
  it('sells none of exactly these bands, per plan', () => {
    const noAllowance = Object.fromEntries(
      (['free', ...PAID, 'enterprise'] as OrgPlan[]).map((plan) => {
        const bands = orgIncludedBands(
          plan === 'free' ? ({ plan: 'free' } as never) : (orgOn(plan) as never),
        )
        return [plan, UTILIZATION_BANDS.filter((band) => bands[band] === 0)]
      }),
    )
    expect(noAllowance).toEqual({
      free: [
        'dataStorageMb',
        'apiRequests',
        'emailSends',
        'assistCredits',
        'workflowRuns',
        'actionRuns',
      ],
      // API access is Business-and-above; Assist credits and action runs are
      // Pro-and-above. Starter sells workflow runs but no actions.
      starter: ['apiRequests', 'assistCredits', 'actionRuns'],
      pro: ['apiRequests'],
      business: [],
      scale: [],
      advanced: [],
      agency: [],
      enterprise: [],
    })
  })

  /**
   * TWO BANDS ARE MEASURED AND BANDED BUT CARRY NO UNIT COST.
   *
   * `report-usage` writes `workflowRuns` and `actionRuns` on every rollup, and
   * every plan sells an allowance of them — so their utilization is a real
   * number with a real denominator. `ORG_COGS_UNIT_RATES_USD` has no entry for
   * either, and the metering route declines to invent one rather than put a
   * made-up rate on an invoice.
   *
   * That argument bounds the cost, not the measurement. Reporting the
   * utilization and NOT a dollar figure is the only answer that neither drops
   * a meter the platform pays to collect nor implies a rate nothing derives.
   */
  it('names the bands with no unit cost, and prices none of them', () => {
    expect([...BANDS_WITHOUT_A_UNIT_COST]).toEqual(['workflowRuns', 'actionRuns'])
    // Neither reaches the cost model: a rollup carrying both prices identically
    // to one carrying neither.
    const withRuns = orgMonthlyCogsUsd(
      { workflowRuns: 500_000, actionRuns: 250_000 } as never,
      0,
    )
    expect(withRuns.measuredUsd).toBe(0)
    // CONTROL: a meter that IS priced moves the same figure, so the assertion
    // above is about these two fields and not about the model ignoring
    // everything.
    expect(orgMonthlyCogsUsd({ pageViews: 500_000 } as never, 0).measuredUsd).toBeGreaterThan(0)
  })

  it('still measures those two bands against the plan’s allowance', () => {
    const row = orgMarginRow({
      orgId: 'business-1',
      org: orgOn('business') as never,
      month: '2026-07',
      rollup: { workflowRuns: 25_000, actionRuns: 5_000 },
    })
    // Business sells 50,000 workflow runs and 50,000 action runs.
    expect(row.bands.workflowRuns.fraction).toBeCloseTo(0.5, 9)
    expect(row.bands.actionRuns.fraction).toBeCloseTo(0.1, 9)
    // …and contributed nothing to what the org cost.
    expect(row.cogs.basis).toBe('floor')
  })

  it('reads a finite, POSITIVE band for every meter a plan DOES sell', () => {
    // The other half: outside the pinned set above, every band is a usable
    // denominator. A table that answered 0 everywhere would fail both.
    for (const plan of PAID) {
      const bands = orgIncludedBands(orgOn(plan) as never)
      const dead = UTILIZATION_BANDS.filter(
        (band) => bands[band] !== 0 && !(bands[band] > 0),
      )
      expect(`${plan}: ${dead.join(',')}`).toBe(`${plan}: `)
    }
  })

  it('CONTROL: a stubbed table would fail the lines above', () => {
    // The failure mode named in the module header, exercised on the detector
    // itself. Zeroing the table must be visible, not absorbed.
    const zeroed = Object.fromEntries(UTILIZATION_BANDS.map((band) => [band, 0]))
    expect(UTILIZATION_BANDS.filter((band) => zeroed[band] === 0)).toEqual([
      ...UTILIZATION_BANDS,
    ])
  })

  it('reads the Assist credit band, ascending, and never unbounded', () => {
    // The one band that is a third-party liability rather than capacity the
    // platform already owns. Enterprise carries a FINITE default on purpose —
    // `UNLIMITED` serialises to `null` and reads back as 0, which would hand
    // the only customers with a signed contract a band that refuses
    // everything.
    const credits = PAID.map((plan) => orgIncludedBands(orgOn(plan) as never).assistCredits)
    expect(credits.every((band) => Number.isFinite(band))).toBe(true)
    expect(Number.isFinite(orgIncludedBands(orgOn('enterprise') as never).assistCredits)).toBe(
      true,
    )
    // Starter sells none, and every tier above it sells more than the last.
    expect(credits[0]).toBe(0)
    expect(credits.slice(1)).toEqual([...credits.slice(1)].sort((a, b) => a - b))
    expect(new Set(credits.slice(1)).size).toBe(credits.length - 1)
  })

  it('measures Assist in CREDITS against the credit band, not in dollars', () => {
    // The rollup stores `assistCostUsd` — our provider bill. The band is
    // credits. Comparing the two directly would be a unit error two orders of
    // magnitude wide, and `assistCreditsFromUsd` is the one conversion.
    const row = orgMarginRow({
      orgId: 'pro-1',
      org: orgOn('pro') as never,
      month: '2026-07',
      // $3.75 of provider spend at $0.001 a credit is 3,750 credits, against
      // Pro's band of 7,500 — exactly half.
      rollup: { assistCostUsd: 3.75 },
    })
    expect(row.bands.assistCredits.used).toBe(3750)
    expect(row.bands.assistCredits.included).toBe(7500)
    expect(row.bands.assistCredits.fraction).toBeCloseTo(0.5, 9)
    // The dollars still reach the COST, which is where they belong.
    expect(row.cogs.breakdown.assist).toBeCloseTo(3.75, 9)
  })

  it('reads a STARTER org’s Assist band as no allowance, not as 0% used', () => {
    const row = orgMarginRow({
      orgId: 'starter-1',
      org: orgOn('starter') as never,
      month: '2026-07',
      rollup: { assistCostUsd: 1.2 },
    })
    expect(row.bands.assistCredits.state).toBe('noAllowance')
    expect(row.bands.assistCredits.fraction).toBeNull()
    expect(row.bands.assistCredits.used).toBe(1200)
  })

  it('gives a BIGGER tier a bigger band — the ladder is visible, not assumed', () => {
    // A resolver stuck on one row would return the same band for every plan
    // and every utilization assertion below would still pass.
    const bandwidth = PAID.map((plan) => orgIncludedBands(orgOn(plan) as never).pageViews)
    expect(bandwidth).toEqual([...bandwidth].sort((a, b) => a - b))
    expect(new Set(bandwidth).size).toBe(bandwidth.length)
  })

  it('reads a FREE org against free bands, which are sharply different', () => {
    const free = orgIncludedBands({ plan: 'free' } as never)
    const pro = orgIncludedBands(orgOn('pro') as never)
    // Free's contact band is 100 against Pro's 10,000 — two orders of
    // magnitude. Scoring a Free org against a paid band understates its
    // utilization by that factor and hides the tier most likely to be
    // over-consuming what it pays nothing for.
    expect(free.contactsCount).toBe(100)
    expect(pro.contactsCount).toBe(10000)
    expect(free.pageViews).toBeLessThan(pro.pageViews)
  })

  it('resolves a DEAD subscription down to free bands', () => {
    // `resolveEffectivePlan` downgrades a canceled paid plan, and a
    // utilization surface that kept measuring against the plan field would
    // report a churned org as comfortably inside bands it no longer has.
    const canceled = {
      plan: 'business',
      subscription: { status: 'canceled', interval: 'month' },
      hosts: { one: true },
    }
    expect(orgIncludedBands(canceled as never).contactsCount).toBe(100)
    expect(orgIncludedBands(orgOn('business') as never).contactsCount).toBe(50000)
  })

  it('applies a purchased host add-on to the per-host bands', () => {
    // The bands are resolved, not looked up: a bought site enlarges the two
    // per-host allowances, and measuring against the catalogue row would
    // report the org as over a band it paid to widen.
    const base = orgIncludedBands(orgOn('pro') as never)
    const withAddon = orgIncludedBands({
      ...orgOn('pro'),
      seatAddons: { hosts: 2 },
    } as never)
    expect(withAddon.storageGb).toBeGreaterThan(base.storageGb)
    expect(withAddon.formSubmissions).toBeGreaterThan(base.formSubmissions)
    // Org-wide bands are not multiplied by a host add-on.
    expect(withAddon.apiRequests).toBe(base.apiRequests)
  })
})

// ---------------------------------------------------------------------------
// The `UNLIMITED` rule and the zero-band rule.
// ---------------------------------------------------------------------------
describe('a band with no denominator yields no percentage', () => {
  it('UNLIMITED reads as uncapped — not 0%, not 100%', () => {
    const reading = bandUtilization('contactsCount', 5_000_000, UNLIMITED)
    expect(reading.state).toBe('uncapped')
    expect(reading.fraction).toBeNull()
    // Both inventions, named so a regression cannot pass by writing one.
    expect(reading.fraction).not.toBe(0)
    expect(reading.fraction).not.toBe(1)
    // The USAGE is still reported. Uncapped is a missing denominator, not a
    // missing measurement.
    expect(reading.used).toBe(5_000_000)
  })

  it('CONTROL: the naive arithmetic really does produce those two answers', () => {
    // The defect this rule exists for, stated as arithmetic so nobody has to
    // take the rule on trust.
    expect(5_000_000 / UNLIMITED).toBe(0)
    expect(Math.min(1, 5_000_000 / UNLIMITED)).toBe(0)
    expect(0 / 0).toBeNaN()
    expect(5 / 0).toBe(UNLIMITED)
  })

  it('reads Enterprise’s three uncapped bands as uncapped, on the real table', () => {
    // Not a synthetic band: Enterprise genuinely carries `UNLIMITED` on
    // contacts, API requests and dataset storage.
    const row = orgMarginRow({
      orgId: 'ent',
      org: orgOn('enterprise') as never,
      month: '2026-07',
      rollup: { contactsCount: 900_000, apiRequests: 40_000_000, dataStorageMb: 900_000 },
    })
    for (const band of ['contactsCount', 'apiRequests', 'dataStorageMb'] as const) {
      expect(`${band}: ${row.bands[band].state}`).toBe(`${band}: uncapped`)
      expect(row.bands[band].fraction).toBeNull()
    }
    // …and its two FINITE bands still produce real percentages, so the
    // uncapped verdict is a property of the BAND and not of the plan. Email
    // sends and Assist credits are the two Enterprise bounds, and Assist is
    // finite deliberately: `UNLIMITED` serialises to null and reads back as 0,
    // which would hand a signed contract the one budget that refuses
    // everything.
    expect(row.bands.assistCredits.state).toBe('measured')
    expect(row.bands.emailSends.state).toBe('measured')
  })

  it('a ZERO band is `noAllowance`, and distinct from an uncapped one', () => {
    // Free sells no email sends, no API requests and no dataset storage.
    const row = orgMarginRow({
      orgId: 'free-1',
      org: { plan: 'free', hosts: { one: true } } as never,
      month: '2026-07',
      rollup: { emailSends: 40, apiRequests: 0, contactsCount: 50 },
    })
    expect(row.bands.emailSends.state).toBe('noAllowance')
    expect(row.bands.emailSends.fraction).toBeNull()
    expect(row.bands.emailSends.used).toBe(40)
    expect(row.bands.apiRequests.state).toBe('noAllowance')
    // Contacts ARE included on Free — 50 of 100.
    expect(row.bands.contactsCount.state).toBe('measured')
    expect(row.bands.contactsCount.fraction).toBe(0.5)
  })

  it('does NOT clamp a band an org has run past', () => {
    // An org at 340% of its form band is the row this whole surface exists to
    // surface. Clamping it to 100% would hide the outlier inside the crowd.
    const reading = bandUtilization('formSubmissions', 340, 100)
    expect(reading.fraction).toBeCloseTo(3.4, 10)
  })
})

// ---------------------------------------------------------------------------
// Agreement with the margin floor about what a tier costs.
// ---------------------------------------------------------------------------
describe('the cost model here is the cost model the margin floor uses', () => {
  it('prices a synthetic org at 100% of every band to the tier’s own cost', () => {
    for (const plan of PAID) {
      const measured = orgMonthlyCogsUsd(rollupAt(plan, 1) as never, 0).measuredUsd
      // Same two tables, same seven terms, arrived at from opposite ends: the
      // floor multiplies bands by rates, this multiplies MEASURED USAGE by the
      // same rates having derived that usage from the same bands.
      expect(`${plan}: ${measured.toFixed(4)}`).toBe(
        `${plan}: ${tierBandCostUsd(plan).toFixed(4)}`,
      )
    }
  })

  it('reproduces Agency’s pinned $1,122.29 at full utilization', () => {
    // The one figure `tier-margin-floor.spec.ts` pins to the cent. Reaching it
    // through this module's band table and `orgMonthlyCogsUsd` is what says
    // the two files agree about the most expensive self-serve tier — the one
    // whose uncapped band made it read as the cheapest.
    const cogs = orgMonthlyCogsUsd(rollupAt('agency', 1) as never, PLAN_ENTITLEMENTS.agency.hostLimit)
    expect(cogs.cogsUsd).toBeCloseTo(1122.29, 2)
    expect(cogs.basis).toBe('measured')
  })

  it('scales linearly, so 25% of every band is 25% of the tier cost', () => {
    for (const plan of PAID) {
      const full = orgMonthlyCogsUsd(rollupAt(plan, 1) as never, 0).measuredUsd
      const quarter = orgMonthlyCogsUsd(rollupAt(plan, 0.25) as never, 0).measuredUsd
      expect(`${plan}: ${(quarter / full).toFixed(6)}`).toBe(`${plan}: 0.250000`)
    }
  })

  it('MUTATION: pricing the band table against ONE wrong rate separates them', () => {
    // The comparison above is only meaningful if the two derivations CAN
    // disagree. Restore Advanced's pre-resize contact band — 1,000,000 at
    // $0.0002 is $200 against a $399 subscription — and they must not match.
    const wrong =
      tierBandCostUsd('advanced') -
      PLAN_ENTITLEMENTS.advanced.contactsPerHost * ORG_COGS_UNIT_RATES_USD.perContactMonth +
      1_000_000 * ORG_COGS_UNIT_RATES_USD.perContactMonth
    const measured = orgMonthlyCogsUsd(rollupAt('advanced', 1) as never, 0).measuredUsd
    expect(measured).not.toBeCloseTo(wrong, 2)
    expect(measured).toBeCloseTo(tierBandCostUsd('advanced'), 4)
  })

  it('MUTATION: reading dataset storage as GIGABYTES doubles nothing quietly', () => {
    // `dataStorageMbPerOrg` is megabytes and `dataStoragePerGbMonth` is a
    // gigabyte rate. The conversion lives inside `orgMonthlyCogsUsd`, and a
    // band table that pre-divided would understate by 1024×.
    const bands = orgIncludedBands(orgOn('advanced') as never)
    expect(bands.dataStorageMb).toBe(PLAN_ENTITLEMENTS.advanced.dataStorageMbPerOrg)
    const asGb = orgMonthlyCogsUsd({ dataStorageMb: bands.dataStorageMb / 1024 } as never, 0)
    const asMb = orgMonthlyCogsUsd({ dataStorageMb: bands.dataStorageMb } as never, 0)
    expect(asMb.measuredUsd / asGb.measuredUsd).toBeCloseTo(1024, 6)
  })
})

// ---------------------------------------------------------------------------
// The margin, and who it is reported for.
// ---------------------------------------------------------------------------
describe('the realised margin', () => {
  it('is the floor’s own arithmetic on the org’s own net revenue', () => {
    const row = orgMarginRow({
      orgId: 'pro-1',
      org: orgOn('pro') as never,
      month: '2026-07',
      rollup: rollupAt('pro', 0.25),
    })
    expect(row.marginPct).not.toBeNull()
    // Rounded to four places, exactly as `checkDiscountMargin` rounds its own
    // `marginPct` — the two are compared against the same floor constant, so a
    // surface carrying more precision than the guardrail would rate a deal on
    // a digit the guardrail cannot see.
    expect(row.marginPct).toBe(
      Math.round(((row.netRevenueUsd - row.cogs.cogsUsd) / row.netRevenueUsd) * 10000) /
        10000,
    )
    // At a quarter of every band the METERS are the larger figure, so the
    // margin is a measurement rather than a restatement of the flat estimate.
    expect(row.cogs.basis).toBe('measured')
  })

  it('falls back to the flat per-site FLOOR when the meters come in under it', () => {
    // Both arms of `orgMonthlyCogsUsd`, because `basis` is the field that says
    // whether a margin figure describes this organization or describes
    // `INFRA_COGS_PER_SITE_USD`. Measured against production, the floor is
    // what every real org's figure has been — so a surface that did not
    // distinguish them would be reporting the constant as a measurement.
    const idle = orgMarginRow({
      orgId: 'pro-idle',
      org: orgOn('pro') as never,
      month: '2026-07',
      rollup: { pageViews: 1 },
    })
    expect(idle.cogs.basis).toBe('floor')
    // Three sites on Pro at $2 each.
    expect(idle.cogs.cogsUsd).toBe(2)
    expect(idle.cogs.measuredUsd).toBeLessThan(idle.cogs.floorUsd)
  })

  it('falls as utilization rises — the whole point of measuring it', () => {
    const at = (utilization: number) =>
      orgMarginRow({
        orgId: 'pro-1',
        org: orgOn('pro') as never,
        month: '2026-07',
        rollup: rollupAt('pro', utilization),
      }).marginPct as number
    const ladder = [0.03, 0.25, 0.5, 1].map(at)
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a))
    // …and it really does reach a bad number, so the surface can find one.
    expect(at(1)).toBeLessThan(0.4)
    expect(at(0.03)).toBeGreaterThan(0.9)
  })

  it('reports NO margin for an org that bills nothing', () => {
    const row = orgMarginRow({
      orgId: 'free-1',
      org: { plan: 'free', hosts: { one: true } } as never,
      month: '2026-07',
      rollup: { pageViews: 100 },
    })
    // Not 0%, not −100%. A free org has no revenue to take a fraction of, and
    // either invention would fill the top of a worst-first list with customers
    // who were never billed.
    expect(row.marginPct).toBeNull()
    expect(row.rating).toBeNull()
    // Its COST is still real and still reported.
    expect(row.cogs.cogsUsd).toBe(2)
  })

  it('orders worst-margin-first, with the unbilled orgs last', () => {
    const rows = [
      { orgId: 'healthy', marginPct: 0.9, cogs: { cogsUsd: 2 } },
      { orgId: 'free', marginPct: null, cogs: { cogsUsd: 40 } },
      { orgId: 'bleeding', marginPct: -0.2, cogs: { cogsUsd: 90 } },
      { orgId: 'thin', marginPct: 0.3, cogs: { cogsUsd: 60 } },
    ] as unknown as OrgMarginRow[]
    expect([...rows].sort(byWorstMargin).map((row) => row.orgId)).toEqual([
      'bleeding',
      'thin',
      'healthy',
      'free',
    ])
  })
})

// ---------------------------------------------------------------------------
// The fleet aggregate — the number every pricing decision has been guessing.
// ---------------------------------------------------------------------------
describe('the fleet distribution', () => {
  const rowFor = (plan: OrgPlan, utilization: number, orgId: string) =>
    orgMarginRow({
      orgId,
      org: orgOn(plan) as never,
      month: '2026-07',
      rollup: rollupAt(plan, utilization),
    })

  it('takes the median over the SAMPLE, across mixed plans', () => {
    // Five orgs on three different plans, each at a known fraction of its OWN
    // bands. The median is 0.4 whatever the plans are — which is the property
    // that makes a cross-plan aggregate meaningful at all.
    const rows = [
      rowFor('starter', 0.1, 'a'),
      rowFor('pro', 0.2, 'b'),
      rowFor('business', 0.4, 'c'),
      rowFor('scale', 0.8, 'd'),
      rowFor('agency', 0.9, 'e'),
    ]
    const fleet = fleetUtilization(rows)
    const pageViews = fleet.distributions.find((d) => d.band === 'pageViews')
    expect(pageViews?.counted).toBe(5)
    expect(pageViews?.p50).toBeCloseTo(0.4, 9)
    expect(pageViews?.max).toBeCloseTo(0.9, 9)
    expect(pageViews?.overBand).toBe(0)
  })

  it('EXCLUDES an uncapped band from the sample rather than scoring it 0', () => {
    // One Enterprise org among four paid ones. Its contacts band is
    // `UNLIMITED`, so it cannot be a data point — and if it were folded in as
    // 0 it would drag the median down by a quarter of the sample.
    const rows = [
      rowFor('business', 0.5, 'a'),
      rowFor('scale', 0.5, 'b'),
      rowFor('advanced', 0.5, 'c'),
      orgMarginRow({
        orgId: 'ent',
        org: orgOn('enterprise') as never,
        month: '2026-07',
        rollup: { contactsCount: 2_000_000 },
      }),
    ]
    const contacts = fleetUtilization(rows).distributions.find(
      (d) => d.band === 'contactsCount',
    )
    expect(contacts?.counted).toBe(3)
    expect(contacts?.excludedUncapped).toBe(1)
    expect(contacts?.p50).toBeCloseTo(0.5, 9)
    // The lie this guards against, stated: folding the uncapped org in at 0
    // would move the median off 0.5.
    expect(percentile([0, 0.5, 0.5, 0.5].sort((a, b) => a - b), 0.5)).toBe(0.5)
    expect(percentile([0, 0, 0.5, 0.5].sort((a, b) => a - b), 0.5)).toBe(0)
  })

  it('EXCLUDES a zero band, and counts the orgs spending it anyway', () => {
    const rows = [
      rowFor('pro', 0.5, 'a'),
      orgMarginRow({
        orgId: 'free-spender',
        org: { plan: 'free', hosts: { one: true } } as never,
        month: '2026-07',
        rollup: { emailSends: 900 },
      }),
      orgMarginRow({
        orgId: 'free-idle',
        org: { plan: 'free', hosts: { one: true } } as never,
        month: '2026-07',
        rollup: {},
      }),
    ]
    const emails = fleetUtilization(rows).distributions.find(
      (d) => d.band === 'emailSends',
    )
    expect(emails?.counted).toBe(1)
    expect(emails?.excludedNoAllowance).toBe(2)
    // Cost with no band behind it — a signal a percentile cannot carry.
    expect(emails?.usageWithNoAllowance).toBe(1)
  })

  it('does not score an org WITHOUT a rollup as zero-utilized', () => {
    const measured = rowFor('pro', 0.6, 'measured')
    const unmeasured = orgMarginRow({
      orgId: 'never-rolled-up',
      org: orgOn('pro') as never,
      month: null,
      rollup: null,
    })
    const fleet = fleetUtilization([measured, unmeasured])
    const pageViews = fleet.distributions.find((d) => d.band === 'pageViews')
    expect(fleet.orgs).toBe(2)
    expect(fleet.withRollup).toBe(1)
    // One data point, not two — and the median is the measured org's own
    // figure rather than half of it.
    expect(pageViews?.counted).toBe(1)
    expect(pageViews?.p50).toBeCloseTo(0.6, 9)
    // Sites are known without a rollup, so that band still counts both.
    expect(fleet.distributions.find((d) => d.band === 'hosts')?.counted).toBe(2)
  })

  it('counts the orgs past 100% of a band', () => {
    const fleet = fleetUtilization([
      rowFor('pro', 0.5, 'a'),
      rowFor('pro', 1.4, 'b'),
      rowFor('pro', 2.2, 'c'),
    ])
    const pageViews = fleet.distributions.find((d) => d.band === 'pageViews')
    expect(pageViews?.overBand).toBe(2)
    expect(pageViews?.p90).toBeCloseTo(2.2, 9)
  })

  it('answers an EMPTY fleet with null, never with zero', () => {
    // Nothing measured is not "utilization is 0%", and a page that rendered it
    // as one would read as "margin is fine" on a platform with no data at all.
    const fleet = fleetUtilization([])
    expect(fleet.orgs).toBe(0)
    expect(fleet.medianMarginPct).toBeNull()
    for (const distribution of fleet.distributions) {
      expect(`${distribution.band}: ${distribution.p50}`).toBe(
        `${distribution.band}: null`,
      )
      expect(distribution.counted).toBe(0)
    }
  })

  it('answers a ONE-ORG fleet with that org’s own figure', () => {
    const fleet = fleetUtilization([rowFor('business', 0.37, 'only')])
    expect(fleet.distributions.find((d) => d.band === 'pageViews')?.p50).toBeCloseTo(
      0.37,
      9,
    )
    expect(fleet.orgs).toBe(1)
  })

  it('names the orgs under the margin floor and the ones underwater', () => {
    const fleet = fleetUtilization([
      rowFor('pro', 0.03, 'healthy'),
      rowFor('pro', 1, 'thin'),
      rowFor('pro', 4, 'bleeding'),
    ])
    expect(fleet.orgsUnderFloor).toBe(2)
    expect(fleet.orgsUnderwater).toBe(1)
    expect(fleet.medianMarginPct).not.toBeNull()
  })

  it('CONTROL: the under-floor detector answers both ways', () => {
    // Three healthy orgs must produce zero offenders, or the count above could
    // be stuck on a verdict.
    const fleet = fleetUtilization([
      rowFor('pro', 0.03, 'a'),
      rowFor('business', 0.03, 'b'),
      rowFor('scale', 0.03, 'c'),
    ])
    expect(fleet.orgsUnderFloor).toBe(0)
    expect(fleet.orgsUnderwater).toBe(0)
  })
})

describe('percentile', () => {
  it('is nearest-rank, and null on an empty sample', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(percentile([0.1, 0.2, 0.3, 0.4], 0.5)).toBe(0.2)
    expect(percentile([0.1, 0.2, 0.3, 0.4], 0.9)).toBe(0.4)
    expect(percentile([0.5], 0.5)).toBe(0.5)
  })
})
