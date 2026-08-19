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
 * A free org's invoice is ZERO, by every path, even with every band blown.
 *
 * ZACH, 2026-08-18, verbatim: **"We also need to make sure the free/hobby tier
 * does hard cap so it always actually stays free"**.
 *
 * ## Why this suite exists separately from the upload gate
 *
 * "The upload was refused" and "the invoice was zero" are different claims,
 * and only the second one is what Zach said. `storage-overage-protection.spec`
 * proves the first: `mediaStorageGate` hard-bands free past
 * `storagePerHostMb`. That is a **runtime check on one ingress path**, and it
 * is the fragile half — it protects the bytes, not the bill, and it says
 * nothing at all about the other three billable dimensions.
 *
 * The claim under test here is the strong one: **a free org cannot reach a
 * billable state on any metered dimension, because free has no price to bill
 * it with.** Not a gate — arithmetic. `estimateMonthlyUsageCost` multiplies by
 * `included.metered`, and `check*Quota` each return `overageMonthlyUsd: 0`
 * when the plan's rate is `null`. Free carries `meteredInfraPassThrough:
 * false` and a `null` rate on every one of them, so the excess is computed,
 * recorded truthfully for COGS, and priced at nothing.
 *
 * ## Belt and braces, and which is which
 *
 * | dimension | braces (runtime) | belt (structural) |
 * | -- | -- | -- |
 * | media storage | `mediaStorageGate` refuses past the band | `meteredInfraPassThrough: false` ⇒ `billableCostUsd: 0` |
 * | bandwidth / page views | `bandwidthCapEngaged` refuses a free org past its band; `checkBandwidthAbuseCeiling` contains any plan past 10x | same flag, same zero |
 * | form submissions | `checkFormSubmissionQuota` walls at the band | same flag, same zero |
 * | dataset storage | `checkDataStorageQuota().allowed`, enforced at the record write (AGL-2163) | `extraDataGbMonthlyUsd: null` ⇒ `overageMonthlyUsd: 0` |
 * | API requests | `apiAccess` gate + `checkApiRequestQuota().allowed` at the /v1 chokepoint (AGL-2163) | `extraApiRequestsUsdPer1k: null` ⇒ 0 |
 * | contacts | `checkContactQuota().allowed` false at the band | `extraContactsUsdPer1k: null` ⇒ 0 |
 *
 * **Bandwidth had no braces at all until AGL-2155**, and this comment said so
 * for months: nothing refused a page view, so a free site that went viral
 * exceeded its 5 GB band with no gate anywhere in the path and was protected
 * *only* by the structural zero. That is no longer true, and it now has TWO
 * braces, which are different instruments rather than two goes at one:
 *
 *  - `bandwidthCapEngaged` — the PLAN rule. Zach chose enforcement on
 *    2026-08-19 — "before public signups arrive, so the cap is proven under
 *    real traffic while the cohort is small and a mistake is cheap" — and it
 *    refuses the pages of a free org past its band, in the middleware ahead of
 *    the ISR cache and again in the loader. Proven end to end, with its paid
 *    positive control, in `apps/tenant/specs/bandwidth-cap-refusal.spec.ts`.
 *  - `checkBandwidthAbuseCeiling` — the ABUSE backstop at 10x the band. It has
 *    to exist separately because the cap deliberately never touches a metered
 *    plan, and because it is evaluated where the counter is WRITTEN
 *    (`/api/analytics/collect`, after the render) and so reacts in minutes
 *    where the cap's daily sweep can take a day. It stamps
 *    `hosts/{id}.bandwidthCeiling`, which the loader reads off a host document
 *    it already loads, so the render path pays ZERO extra reads. Forced-branch
 *    proof in `apps/tenant/specs/loader-bandwidth-ceiling.spec.ts`; the write
 *    side in `apps/tenant/specs/analytics-collect.spec.ts`.
 *
 * ⚠️ Two of the "braces" above were, until AGL-2163, DOCUMENTATION.
 * `checkDataStorageQuota().allowed` and `checkApiRequestQuota().allowed` had
 * no reader anywhere in the platform — their only call site was
 * `report-usage`, which takes `overageMonthlyUsd` and ignores `allowed`. This
 * table asserted them by naming them, which is the failure mode it should
 * least have had. They are enforced at real call sites now
 * (`apps/console/specs/dataset-storage-quota-enforced.spec.ts`,
 * `apps/console/specs/api-v1-request-quota.spec.ts`), and both suites force
 * the branch through the route rather than checking a return value.
 *
 * **What this suite still claims is the BELT**, and the belt is unchanged: a
 * free org cannot reach a billable state even with the gate removed. The two
 * are deliberately separate — the braces protect Aglyn's egress bill, the
 * belt protects the customer's invoice, and only the second is what Zach's
 * "always actually stays free" is about. So the bandwidth case below still
 * drives 100x the band and still asserts a literal zero: if the cap were
 * reverted tomorrow the customer would still owe nothing.
 *
 * ## Why the numbers below are what they are
 *
 * ⚠️ Free has `hostLimit: 1`, which makes the org-wide band
 * `hostLimit × storagePerHostMb` numerically IDENTICAL to the per-scope band.
 * A sibling guard was defeated by exactly that collapse. So nothing here is
 * asserted by comparing one derived band to another — every case drives usage
 * to a gross multiple of the band (10×–1000×) and asserts a LITERAL zero, a
 * shape no band arithmetic can make vacuous.
 */

import {
  estimateMonthlyUsageCost,
  METERED_UNIT_RATES_USD,
} from '../utils/usage-metering'
import { mediaStorageGate } from '../utils/storage-overage'
import {
  BANDWIDTH_ABUSE_CEILING_FLOOR,
  bandwidthCapEngaged,
  bandwidthCapMonthKey,
  bandwidthCapShouldEngage,
  bandwidthCeilingDegradesRender,
  checkApiRequestQuota,
  checkBandwidthAbuseCeiling,
  checkContactQuota,
  checkDataStorageQuota,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  planMetersInfraOverage,
} from '@aglyn/aglyn/server'

const GB = 1024 * 1024 * 1024
const freeOrg = () => ({ plan: 'free' }) as any
/** Starter is the cheapest plan that DOES bill — the positive control. */
const paidOrg = () => ({ plan: 'starter', subscription: { status: 'active' } }) as any

/** Free's published bands, LITERAL. A change here must be looked at. */
const FREE = {
  hostLimit: 1,
  storagePerHostMb: 250,
  bandwidthGb: 5,
  formSubmissionsPerMonth: 20,
  contactsPerHost: 100,
  apiRequestsPerMonth: 0,
  dataStorageMbPerOrg: 0,
}

describe('the free plan carries no price on any billable dimension', () => {
  it('has a null rate wherever a rate is what turns usage into money', () => {
    // THE BELT, asserted directly. Every `overageMonthlyUsd` in the platform
    // is `rate === null ? 0 : usage * rate`, so a null rate is a structural
    // zero rather than a checked one. Forced red by setting any of these to a
    // number: the corresponding dimension below starts billing immediately.
    expect(PLAN_PRICING.free.meteredInfraPassThrough).toBe(false)
    expect(PLAN_PRICING.free.extraDataGbMonthlyUsd).toBeNull()
    expect(PLAN_PRICING.free.extraApiRequestsUsdPer1k).toBeNull()
    expect(PLAN_PRICING.free.extraContactsUsdPer1k).toBeNull()
    expect(PLAN_PRICING.free.basePriceMonthlyUsd).toBe(0)
    expect(planMetersInfraOverage(freeOrg())).toBe(false)
  })

  it('POSITIVE CONTROL: the cheapest PAID plan carries all four', () => {
    // Without this the suite above is satisfied by a platform that prices
    // nothing at all, which would pass every assertion here and bill nobody
    // anywhere. Starter is where "free stays free" stops being the rule.
    expect(PLAN_PRICING.starter.meteredInfraPassThrough).toBe(true)
    expect(PLAN_PRICING.starter.extraDataGbMonthlyUsd).toBe(0.25)
    expect(PLAN_PRICING.starter.extraContactsUsdPer1k).toBe(1)
    expect(planMetersInfraOverage(paidOrg())).toBe(true)
  })

  it('BANDWIDTH NOW HAS BRACES TOO (AGL-2155), and they are free-only', () => {
    // The table in this file's header names a gate for every dimension. That
    // is a comment asserting behaviour, which is worth nothing unless
    // something checks it — the exact shape that let "bandwidth has no gate"
    // stay accurate for months and then quietly stop being. So the claim is
    // asserted here, at the source, and it is asserted in BOTH directions.
    const capped = { month: bandwidthCapMonthKey(), engagedAt: 1 }
    expect(bandwidthCapEngaged({ ...freeOrg(), bandwidthCap: capped })).toBe(
      true,
    )
    expect(bandwidthCapEngaged({ ...paidOrg(), bandwidthCap: capped })).toBe(
      false,
    )
    expect(
      bandwidthCapShouldEngage({
        org: freeOrg(),
        usedBandwidthGb: FREE.bandwidthGb * 100,
        includedBandwidthGb: FREE.bandwidthGb,
      }),
    ).toBe(true)
    expect(
      bandwidthCapShouldEngage({
        org: paidOrg(),
        usedBandwidthGb: FREE.bandwidthGb * 100,
        includedBandwidthGb: FREE.bandwidthGb,
      }),
    ).toBe(false)
  })

  it('the free bands are the published ones', () => {
    for (const [key, value] of Object.entries(FREE)) {
      expect((PLAN_ENTITLEMENTS.free as never as Record<string, number>)[key]).toBe(
        value,
      )
    }
  })
})

describe('DIMENSION BY DIMENSION: every band blown, every charge zero', () => {
  /**
   * Decomposed on purpose. A single "the invoice is zero" assertion over all
   * dimensions at once passes while any one of them is silently wrong, because
   * the others hold the total at zero — the rollup-that-omits-an-input hazard,
   * which is how org-library bytes went unbilled for months without anyone
   * noticing a number look wrong.
   */

  it('media storage: 1000× the band, still $0', () => {
    // 250 MB included; 250 GB stored. Forced red by removing the
    // `included.metered ?` ternary in `estimateMonthlyUsageCost` — the free
    // org was billed $8.45, which is the whole failure in one number.
    const estimate = estimateMonthlyUsageCost(
      [{ storageBytes: 250 * GB, pageViews: 0, formSubmissions: 0 }],
      freeOrg(),
    )
    expect(estimate.billableStorageGb).toBeCloseTo(249.756, 2) // measured…
    expect(estimate.costUsd).toBeGreaterThan(0) // …and our COGS is truthful…
    expect(estimate.billableCostUsd).toBe(0) // …but nothing is billable…
    expect(estimate.billedCents).toBe(0) // …and nothing is billed.
  })

  it('bandwidth / page views: 100x the band, still $0 — belt only, no gate assumed', () => {
    // 5 GB ~ 8948 page views included. A free site that goes viral serves a
    // million. Since AGL-2155 the pages ARE refused — by the cap, and by the
    // abuse ceiling above it — but this assertion deliberately does not depend
    // on either: it measures the invoice with the gates out of the picture, so
    // it stays the answer to "would a free org be billed" even if they were
    // reverted or failed open — which they do on purpose, on every unreadable
    // org doc.
    const estimate = estimateMonthlyUsageCost(
      [{ storageBytes: 0, pageViews: 1_000_000, formSubmissions: 0 }],
      freeOrg(),
    )
    expect(estimate.billablePageViews).toBeGreaterThan(900_000)
    expect(estimate.costUsd).toBeCloseTo(100, 0) // $0.0001 × 1M — real COGS
    expect(estimate.billedCents).toBe(0)
  })

  it('bandwidth: the BRACES, containing a free site an order past the band', () => {
    // The dimension's runtime check, asserted here so the table above stops
    // being the only place it is claimed. 1,000,000 views is 10× the free
    // ceiling and ~114× the included band.
    const contained = checkBandwidthAbuseCeiling(freeOrg(), 1_000_000)
    expect(contained.ceiling).toBe(BANDWIDTH_ABUSE_CEILING_FLOOR)
    expect(contained.exceeded).toBe(true)
    expect(bandwidthCeilingDegradesRender(freeOrg())).toBe(true)
    // POSITIVE CONTROL: the paid plan is not contained at the same count —
    // its overage bills, which is the whole difference.
    expect(checkBandwidthAbuseCeiling(paidOrg(), 150_000).exceeded).toBe(false)
    expect(bandwidthCeilingDegradesRender(paidOrg())).toBe(false)
    // …and free UNDER the ceiling is untouched: a hobby site with real
    // traffic must not meet a wall dressed up as an abuse control.
    expect(checkBandwidthAbuseCeiling(freeOrg(), 99_999).exceeded).toBe(false)
  })

  it('form submissions: 500× the band, still $0', () => {
    const estimate = estimateMonthlyUsageCost(
      [{ storageBytes: 0, pageViews: 0, formSubmissions: 10_000 }],
      freeOrg(),
    )
    expect(estimate.billableFormSubmissions).toBe(10_000 - 20)
    expect(estimate.billedCents).toBe(0)
  })

  it('dataset storage: a band of ZERO, blown by 10 GB, still $0', () => {
    // `dataStorageMbPerOrg: 0` on free, so ANY dataset byte is past the band —
    // there is no comfortable margin hiding a bug here. Forced red by giving
    // free an `extraDataGbMonthlyUsd`: $2.50 appeared.
    const quota = checkDataStorageQuota(freeOrg(), 10 * 1024)
    expect(quota.includedMb).toBe(0)
    expect(quota.overageGb).toBe(10)
    expect(quota.overageRateUsd).toBeNull()
    expect(quota.overageMonthlyUsd).toBe(0)
    expect(quota.allowed).toBe(false) // and the braces hold too
  })

  it('API requests: a band of ZERO, 50000 requests, still $0', () => {
    const quota = checkApiRequestQuota(freeOrg(), 50_000)
    expect(quota.included).toBe(0)
    expect(quota.overageRequests).toBe(50_000)
    expect(quota.overageRateUsd).toBeNull()
    expect(quota.overageMonthlyUsd).toBe(0)
    expect(quota.allowed).toBe(false)
  })

  it('contacts: 250× the band, still $0', () => {
    const quota = checkContactQuota(freeOrg(), 25_000)
    expect(quota.included).toBe(100)
    expect(quota.overageContacts).toBe(24_900)
    expect(quota.overageRateUsd).toBeNull()
    expect(quota.overageMonthlyUsd).toBe(0)
    expect(quota.allowed).toBe(false)
  })

  it('media ingress: the braces, refusing past the band', () => {
    const gate = mediaStorageGate({ org: freeOrg(), usedMb: 250_000 })
    expect(gate.allowed).toBe(false)
    expect(gate.billed).toBe(false)
    expect(gate.code).toBe('plan_limit_reached')
  })
})

describe("THE INVOICE: every band blown at once, and it is exactly zero", () => {
  /**
   * The assembly `report-usage` performs, reproduced here as the sum that
   * actually reaches Stripe:
   *
   *   billedCents = estimate.billedCents
   *               + round(dataQuota.overageMonthlyUsd  × 100)
   *               + round(apiQuota.overageMonthlyUsd   × 100)
   *               + round(contactsOverageUsd           × 100)
   *
   * `report-usage` then pushes a Stripe meter event only `if (stripeKey &&
   * billedCents > 0)`, so a total of exactly 0 is not merely a zero invoice —
   * it is **no meter event at all**, and therefore no invoice line to explain.
   */

  const totalBilledCents = (org: unknown) => {
    const estimate = estimateMonthlyUsageCost(
      [
        {
          // 250 GB stored, a million views, 10k submissions — every infra
          // meter far past every band.
          storageBytes: 250 * GB,
          pageViews: 1_000_000,
          formSubmissions: 10_000,
        },
      ],
      org as never,
    )
    return (
      estimate.billedCents +
      Math.round(checkDataStorageQuota(org as never, 10 * 1024).overageMonthlyUsd * 100) +
      Math.round(checkApiRequestQuota(org as never, 50_000).overageMonthlyUsd * 100) +
      Math.round(checkContactQuota(org as never, 25_000).overageMonthlyUsd * 100)
    )
  }

  it('a free org exceeding EVERY band bills exactly 0 cents', () => {
    // Not "about zero", not "less than a cent" — the literal integer the
    // `> 0` guard in `report-usage` tests. Forced red four separate ways, one
    // per protection: removing the `included.metered` ternary (→ 10845¢), and
    // giving free each of the three null rates a number (→ 250¢, 2500¢, 2490¢).
    expect(totalBilledCents(freeOrg())).toBe(0)
  })

  it('an org with NO plan — the unknown-org case — also bills 0', () => {
    // `resolvePlan` defaults to free, so an org whose plan field is missing or
    // garbage lands on the free side. Billing someone with no subscription is
    // the error direction with no recovery.
    expect(totalBilledCents({})).toBe(0)
    expect(totalBilledCents({ plan: 'not-a-plan' })).toBe(0)
    expect(totalBilledCents(null)).toBe(0)
  })

  it('POSITIVE CONTROL: the same usage on a PAID plan bills a real amount', () => {
    // This is what stops the suite from being satisfied by a platform that
    // bills nobody — which would pass every assertion above. Starter's bands
    // are larger than free's but the usage dwarfs both, so the charge is
    // substantial and the two plans are separated by thousands of cents.
    const paid = totalBilledCents(paidOrg())
    expect(paid).toBeGreaterThan(10_000)
    expect(totalBilledCents(freeOrg())).toBe(0)
  })

  it('and free is zero because of the RATES, not because usage read as zero', () => {
    // The failure mode that would make every assertion above pass while the
    // protection was gone: usage silently reading as 0 (a dropped counter, a
    // projection that starves the input). Then "billed 0" would be true for
    // the wrong reason and the guard would survive removing every protection.
    //
    // So: assert the usage IS measured and IS past the band on the free org,
    // and that only the pricing step zeroes it.
    const estimate = estimateMonthlyUsageCost(
      [{ storageBytes: 250 * GB, pageViews: 1_000_000, formSubmissions: 10_000 }],
      freeOrg(),
    )
    expect(estimate.storageGb).toBeCloseTo(250, 6)
    expect(estimate.pageViews).toBe(1_000_000)
    expect(estimate.formSubmissions).toBe(10_000)
    expect(estimate.billableStorageGb).toBeGreaterThan(249)
    expect(estimate.billablePageViews).toBeGreaterThan(900_000)
    expect(estimate.billableFormSubmissions).toBe(9_980)
    // COGS is real and truthful — under-reporting our own cost is what makes
    // the discount guardrail too generous, so free's zero must NOT reach here.
    expect(estimate.costUsd).toBeGreaterThan(100)
    expect(estimate.costUsd).toBeCloseTo(
      250 * METERED_UNIT_RATES_USD.storagePerGbMonth +
        1_000_000 * METERED_UNIT_RATES_USD.perPageView +
        10_000 * METERED_UNIT_RATES_USD.perFormSubmission,
      6,
    )
    // And only then, zero.
    expect(estimate.billedCents).toBe(0)
  })
})
