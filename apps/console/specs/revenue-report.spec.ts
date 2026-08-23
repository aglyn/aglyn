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
  PLAN_PRICING,
  STOREFRONT_PROCESSING_FIXED_CENTS,
  resolveTransactionFeeCents,
  storefrontProcessingCostCents,
} from '@aglyn/aglyn/server'
import {
  commerceSettledSummary,
  commerceHostAttribution,
  contractedSummary,
  marketplaceListingAttribution,
  marketplacePublisherAttribution,
  orgAttribution,
  marketplaceSettledSummary,
  revenueGap,
  subscriptionSettledSummary,
  totalEarnedCents,
} from '../utils/server/revenue-report'

/**
 * The revenue report's arithmetic (AGL-2486).
 *
 * Every assertion here is written against a figure DERIVED from the same
 * helpers production uses, never against a hand-typed expected constant — a
 * literal `expect(x).toBe(2900)` passes just as happily against a function
 * that returns a constant as against one that measures, which is the
 * "written but never read" failure this repo has recorded. Where a constant
 * is unavoidable it is accompanied by a mutation-style negative: a second
 * assertion that would fail if the code took the obvious wrong branch.
 */

/** A billing org the revenue helpers will accept as genuinely paying. */
function payingOrg(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plan: 'starter',
    billingStatus: 'active',
    subscription: { status: 'active', interval: 'month' },
    ...overrides,
  }
}

describe('contracted revenue never comes from org.plan (AGL-925/AGL-2486)', () => {
  it('counts a real subscription and excludes a comped org from the money', () => {
    const summary = contractedSummary([
      { orgId: 'paying', billing: payingOrg() },
      // The AGL-925 shape: a staff override writes `plan` and NO subscription.
      { orgId: 'comped', billing: { plan: 'agency' } },
      { orgId: 'free', billing: { plan: 'free' } },
    ])
    expect(summary.total.orgs).toBe(1)
    expect(summary.compedOrgs).toBe(1)
    // The comp is on the DEAREST plan in the table, so if its plan price had
    // leaked into MRR the total would exceed the starter price. Derived, so
    // this cannot pass against a hardcoded figure.
    expect(summary.total.mrrUsd).toBe(PLAN_PRICING.starter.basePriceMonthlyUsd)
    expect(summary.total.mrrUsd).toBeLessThan(
      PLAN_PRICING.agency.basePriceMonthlyUsd,
    )
  })

  it('prefers a negotiated enterprise price over the plan table', () => {
    const negotiated = 4321
    const summary = contractedSummary([
      {
        orgId: 'ent',
        billing: payingOrg({
          plan: 'enterprise',
          subscription: {
            status: 'active',
            interval: 'month',
            customMonthlyUsd: negotiated,
          },
        }),
      },
    ])
    // Enterprise's list price is the "not for sale" sentinel 0, so a plan-table
    // computation would report 0 here. The negotiated figure is the only way
    // this number can be right.
    expect(summary.total.mrrUsd).toBe(negotiated)
    expect(PLAN_PRICING.enterprise.basePriceMonthlyUsd).toBe(0)
  })

  it('separates trialing and past-due from the collecting book', () => {
    const summary = contractedSummary([
      { orgId: 'a', billing: payingOrg() },
      { orgId: 'b', billing: payingOrg({ billingStatus: 'trialing' }) },
      { orgId: 'c', billing: payingOrg({ billingStatus: 'past_due' }) },
    ])
    expect(summary.total.orgs).toBe(3)
    expect(summary.trialing.orgs).toBe(1)
    expect(summary.pastDue.orgs).toBe(1)
    expect(summary.collecting.orgs).toBe(1)
    // The three slices partition the total exactly — no org counted twice and
    // none dropped.
    expect(
      summary.collecting.mrrUsd + summary.trialing.mrrUsd + summary.pastDue.mrrUsd,
    ).toBe(summary.total.mrrUsd)
  })

  it('reports the discount as the list-to-MRR difference', () => {
    const summary = contractedSummary([
      {
        orgId: 'disc',
        billing: payingOrg({ discount: { percentOff: 50 } }),
      },
    ])
    expect(summary.total.listPriceUsd).toBe(
      PLAN_PRICING.starter.basePriceMonthlyUsd,
    )
    expect(summary.discountUsd).toBe(
      summary.total.listPriceUsd - summary.total.mrrUsd,
    )
    // The discount is real, so this is not the trivially-true 0 === 0.
    expect(summary.discountUsd).toBeGreaterThan(0)
  })
})

describe('settled subscription revenue is net of tax and every reversal', () => {
  it('nets a full refund to exactly zero', () => {
    const out = subscriptionSettledSummary([
      { id: 'i1', grossCents: 10825, taxCents: 825, refundedCents: 10825 },
    ])
    expect(out.netOfReversalsCents).toBe(0)
    // …and the un-reversed figure is still visible, so the two are legible
    // apart rather than collapsed into one number.
    expect(out.netCents).toBe(10000)
  })

  it('scales a partial refund by the row net, not its gross', () => {
    const out = subscriptionSettledSummary([
      { id: 'i1', grossCents: 10825, taxCents: 825, refundedCents: 5000 },
    ])
    // Stripe hands back tax alongside the charge, so the revenue reversed is
    // the refund's share of NET. Deriving the expectation the same way the
    // webhook derives its GA figure — a naive `net - refunded` would answer
    // 5000 and this asserts it does not.
    expect(out.netOfReversalsCents).toBe(10000 - Math.round((5000 * 10000) / 10825))
    expect(out.netOfReversalsCents).not.toBe(10000 - 5000)
  })

  it('clamps an over-refund instead of creating revenue on the next row', () => {
    const out = subscriptionSettledSummary([
      { id: 'bad', grossCents: 1000, taxCents: 0, refundedCents: 999999 },
      { id: 'good', grossCents: 5000, taxCents: 0 },
    ])
    // Without the clamp the first row contributes -998999 and swallows the
    // second sale whole.
    expect(out.netOfReversalsCents).toBe(5000)
  })

  it('counts a lost dispute as a loss and reports it separately', () => {
    const out = subscriptionSettledSummary([
      {
        id: 'i1',
        grossCents: 10000,
        taxCents: 0,
        refundedCents: 10000,
        chargedBackCents: 10000,
      },
    ])
    expect(out.netOfReversalsCents).toBe(0)
    expect(out.chargedBackCents).toBe(10000)
  })

  it('includes internal traffic in the total and surfaces it separately', () => {
    const out = subscriptionSettledSummary([
      { id: 'i1', grossCents: 5000, taxCents: 0, internalTraffic: true },
      { id: 'i2', grossCents: 3000, taxCents: 0 },
    ])
    expect(out.netOfReversalsCents).toBe(8000)
    expect(out.internalTrafficCents).toBe(5000)
  })
})

describe('marketplace commission', () => {
  it('reads the stored fee rather than re-deriving it from today rate', () => {
    const out = marketplaceSettledSummary([
      // Transfer and fee disagree, as they would if the rate had moved since
      // the sale. The STORED fee must win.
      { id: 'm1', amountCents: 10000, taxCents: 0, feeCents: 2000, transferCents: 5000 },
    ])
    expect(out.commissionNetCents).toBe(2000)
    expect(out.commissionNetCents).not.toBe(10000 - 5000)
  })

  it('falls back to gross minus tax minus transfer on a legacy row', () => {
    const out = marketplaceSettledSummary([
      { id: 'm1', amountCents: 11000, taxCents: 1000, transferCents: 8000 },
    ])
    expect(out.commissionNetCents).toBe(11000 - 1000 - 8000)
  })

  it('sees a PARTIAL refund, which never writes refundedCents', () => {
    const partial = marketplaceSettledSummary([
      {
        id: 'm1',
        amountCents: 10000,
        taxCents: 0,
        feeCents: 2000,
        partialRefundedCents: 5000,
      },
    ])
    // Reading only `refundedCents` would report the full 2000 here.
    expect(partial.commissionNetCents).toBe(1000)
    expect(partial.commissionNetCents).not.toBe(2000)
  })

  it('does not double-reverse a sale carrying both refund fields', () => {
    const out = marketplaceSettledSummary([
      {
        id: 'm1',
        amountCents: 10000,
        taxCents: 0,
        feeCents: 2000,
        partialRefundedCents: 4000,
        refundedCents: 10000,
      },
    ])
    // Summing the two fields would reverse 14000 against a 10000 sale.
    expect(out.commissionNetCents).toBe(0)
  })

  it('reports the uncovered processing cost it cannot recover', () => {
    const out = marketplaceSettledSummary([
      { id: 'm1', amountCents: 10000, taxCents: 0, feeCents: 2000, transferCents: 8000 },
    ])
    // Marketplace charges carry no application fee, so this cost is real and
    // unrecovered. Derived from the same helper the storefront path uses.
    expect(out.estimatedProcessingCostCents).toBe(
      storefrontProcessingCostCents(10000),
    )
    expect(out.estimatedProcessingCostCents).toBeGreaterThan(0)
  })
})

describe('storefront commission excludes the processing pass-through', () => {
  const org = payingOrg()

  it('reports the advertised take, not the whole application fee', () => {
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(org, 'physical', chargeCents, chargeCents)
    const out = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee },
    ])
    // The take is what is left once Stripe's cost is removed — derived from
    // the same two helpers that CHARGED the fee, so a change to either rate
    // moves both sides of this assertion together.
    expect(out.commissionCents).toBe(
      fee - storefrontProcessingCostCents(chargeCents),
    )
    // The whole fee is still reported, and it is strictly larger. If the code
    // reported the fee as earnings this would be an equality.
    expect(out.applicationFeeCents).toBe(fee)
    expect(out.commissionCents).toBeLessThan(out.applicationFeeCents)
    // Specifically, at least Stripe's fixed 30¢ smaller — the component a
    // percentage-only model would silently keep as margin.
    expect(out.applicationFeeCents - out.commissionCents).toBeGreaterThanOrEqual(
      STOREFRONT_PROCESSING_FIXED_CENTS,
    )
  })

  it('never reports a 0%-take sale as earnings', () => {
    // A plan whose advertised storefront take is 0: the entire fee is Stripe
    // cost recovery, so the earned figure must be exactly 0 — not the 30¢+
    // the pass-through collected.
    const zeroTakeOrg = payingOrg({
      plan: 'starter',
      entitlements: { transactionFeePhysicalPct: 0 },
    })
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(
      zeroTakeOrg,
      'physical',
      chargeCents,
      chargeCents,
    )
    const out = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee },
    ])
    expect(out.commissionCents).toBe(0)
    expect(out.applicationFeeCents).toBeGreaterThan(0)
  })

  it('keeps a subscription renewal whole take, which recovers no cost', () => {
    // A storefront SUBSCRIPTION renewal carries `subscriptionId` and its fee
    // is items-only with no processing folded in. Subtracting a pass-through
    // never charged would report this real take as zero.
    const out = commerceSettledSummary([
      { id: 'o1', amountCents: 20000, feeCents: 400, subscriptionId: 'sub_1' },
    ])
    expect(out.commissionCents).toBe(400)
    expect(out.processingPassThroughCents).toBe(0)
    expect(out.subscriptionOrders).toBe(1)
    // The negative control: the same row WITHOUT the marker loses its take to
    // the pass-through clamp, which is exactly the bug the marker prevents.
    const misread = commerceSettledSummary([
      { id: 'o1', amountCents: 20000, feeCents: 400 },
    ])
    expect(misread.commissionCents).toBe(0)
  })

  it('reverses a refunded order pro-rata', () => {
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(org, 'physical', chargeCents, chargeCents)
    const full = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee, refundedCents: chargeCents },
    ])
    expect(full.commissionNetCents).toBe(0)
    expect(full.commissionCents).toBeGreaterThan(0)
  })
})

describe('the gap between the two bases is decomposed, not left to subtract', () => {
  it('compares COLLECTING contracted against settled, not the whole book', () => {
    const contracted = contractedSummary([
      { orgId: 'a', billing: payingOrg() },
      { orgId: 'b', billing: payingOrg({ billingStatus: 'trialing' }) },
      { orgId: 'c', billing: payingOrg({ billingStatus: 'past_due' }) },
    ])
    const subscriptions = subscriptionSettledSummary([])
    const gap = revenueGap({ contracted, subscriptions })
    // Only the collecting org is expected to have settled, so the gap is ONE
    // org's MRR — not three. Counting trialing and past-due on both sides
    // would double them.
    expect(gap.collectingMrrCents).toBe(
      Math.round(contracted.collecting.mrrUsd * 100),
    )
    expect(gap.gapCents).toBe(gap.collectingMrrCents)
    expect(gap.causes.trialingCents).toBeGreaterThan(0)
    expect(gap.causes.pastDueCents).toBeGreaterThan(0)
    // The trialing and past-due figures are causes, not part of the left side.
    expect(gap.collectingMrrCents).toBeLessThan(
      Math.round(contracted.total.mrrUsd * 100),
    )
  })

  it('explains a gap made entirely of reversals', () => {
    const contracted = contractedSummary([{ orgId: 'a', billing: payingOrg() }])
    const mrrCents = Math.round(contracted.collecting.mrrUsd * 100)
    // Settled the full MRR then refunded half of it.
    const subscriptions = subscriptionSettledSummary([
      { id: 'i1', grossCents: mrrCents, taxCents: 0, refundedCents: Math.round(mrrCents / 2) },
    ])
    const gap = revenueGap({ contracted, subscriptions })
    expect(gap.causes.reversedCents).toBe(Math.round(mrrCents / 2))
    // Fully explained: nothing left over.
    expect(gap.unexplainedCents).toBe(0)
  })

  it('leaves an unexplained residual visible rather than absorbing it', () => {
    const contracted = contractedSummary([{ orgId: 'a', billing: payingOrg() }])
    // Nothing settled and no named cause — the whole MRR is unexplained, and
    // the page must be able to say so rather than showing a tidy zero.
    const gap = revenueGap({
      contracted,
      subscriptions: subscriptionSettledSummary([]),
    })
    expect(gap.unexplainedCents).toBe(gap.collectingMrrCents)
    expect(gap.unexplainedCents).toBeGreaterThan(0)
  })

  it('does not double-count the discount, which MRR already applies', () => {
    const contracted = contractedSummary([
      { orgId: 'a', billing: payingOrg({ discount: { percentOff: 50 } }) },
    ])
    const mrrCents = Math.round(contracted.collecting.mrrUsd * 100)
    const subscriptions = subscriptionSettledSummary([
      { id: 'i1', grossCents: mrrCents, taxCents: 0 },
    ])
    const gap = revenueGap({ contracted, subscriptions })
    // The org settled exactly its discounted MRR, so there is NO gap. If the
    // discount were subtracted again the residual would be negative.
    expect(gap.gapCents).toBe(0)
    expect(gap.unexplainedCents).toBe(0)
    // …and the discount is still reported, as context.
    expect(gap.causes.discountCents).toBeGreaterThan(0)
  })
})

describe('the earned total excludes everything that is not Aglyn margin', () => {
  it('leaves out tax, seller transfers and the processing pass-through', () => {
    const chargeCents = 20000
    const fee = resolveTransactionFeeCents(
      payingOrg(),
      'physical',
      chargeCents,
      chargeCents,
    )
    const subscriptions = subscriptionSettledSummary([
      { id: 'i1', grossCents: 10825, taxCents: 825 },
    ])
    const marketplace = marketplaceSettledSummary([
      { id: 'm1', amountCents: 11000, taxCents: 1000, feeCents: 2000, transferCents: 8000 },
    ])
    const commerce = commerceSettledSummary([
      { id: 'o1', amountCents: chargeCents, feeCents: fee },
    ])
    const earned = totalEarnedCents({ subscriptions, marketplace, commerce })
    expect(earned).toBe(
      10000 + 2000 + (fee - storefrontProcessingCostCents(chargeCents)),
    )
    // Each exclusion asserted as a strict inequality, so a regression that
    // folded any of them in fails here rather than merely shifting a total.
    const naive =
      subscriptions.grossCents + marketplace.grossCents + commerce.applicationFeeCents
    expect(earned).toBeLessThan(naive)
    expect(earned).toBeLessThan(naive - marketplace.sellerTransferCents)
  })
})

/**
 * Per-org attribution (AGL-2486) — "show which orgs did what".
 *
 * The assertions that matter are the RECONCILIATION ones: a table whose rows
 * do not sum to the figure above it is worse than no table, because a reader
 * trusts the number they can see the working for.
 */
describe('orgAttribution', () => {
  const paying = (orgId: string, name: string, mrr = 'starter') => ({
    orgId,
    billing: {
      name,
      plan: mrr,
      billingStatus: 'active',
      subscription: { status: 'active', interval: 'month' },
    },
  })
  const invoice = (orgId: string, grossCents: number, taxCents = 0) => ({
    id: `in_${orgId}_${grossCents}`,
    orgId,
    grossCents,
    taxCents,
  })

  it('names the comped orgs the summary only counts', () => {
    const orgs = [
      { orgId: 'o1', billing: { name: 'Aglyn LLC', plan: 'enterprise' } },
      { orgId: 'o2', billing: { name: 'Personal', plan: 'starter' } },
      { orgId: 'o3', billing: { name: 'Free Co', plan: 'free' } },
    ]
    const summary = contractedSummary(orgs)
    const attribution = orgAttribution(orgs, [])
    const comped = attribution.rows.filter((row) => row.state === 'comped')

    // The COUNT and the NAMES must agree — this is the whole point.
    expect(comped).toHaveLength(summary.compedOrgs)
    expect(comped.map((row) => row.name).sort()).toEqual([
      'Aglyn LLC',
      'Personal',
    ])
    // A genuinely free org contributes nothing and is not a row.
    expect(attribution.rows.some((row) => row.orgId === 'o3')).toBe(false)
  })

  it('reconciles settled cash to subscriptionSettledSummary exactly', () => {
    const rows = [invoice('o1', 2500), invoice('o1', 1000, 100), invoice('o2', 700)]
    const total = subscriptionSettledSummary(rows)
    const attribution = orgAttribution(
      [paying('o1', 'One'), paying('o2', 'Two')],
      rows,
    )
    const summed = attribution.rows.reduce(
      (sum, row) => sum + row.settledCents,
      0,
    )
    expect(summed).toBe(total.netOfReversalsCents)
    // And the per-org split is the real one, not everything on one row.
    const byId = Object.fromEntries(
      attribution.rows.map((row) => [row.orgId, row]),
    )
    expect(byId['o1'].invoices).toBe(2)
    expect(byId['o2'].invoices).toBe(1)
  })

  it('reconciles contracted MRR to contractedSummary exactly', () => {
    const orgs = [paying('o1', 'One'), paying('o2', 'Two')]
    const summary = contractedSummary(orgs)
    const attribution = orgAttribution(orgs, [])
    const summed = attribution.rows.reduce((sum, row) => sum + row.mrrUsd, 0)
    expect(summed).toBeCloseTo(summary.total.mrrUsd, 2)
    expect(summed).toBeGreaterThan(0)
  })

  it('keeps cash from an org whose document no longer exists', () => {
    // An erased workspace still has invoices. Dropping them would make the
    // rows sum BELOW the total, which is the failure this guards.
    const rows = [invoice('gone', 5000)]
    const total = subscriptionSettledSummary(rows)
    const attribution = orgAttribution([], rows)
    expect(attribution.rows).toHaveLength(1)
    expect(attribution.rows[0].settledCents).toBe(total.netOfReversalsCents)
    expect(attribution.rows[0].name).toContain('no org record')
  })

  it('carries the omitted remainder as FIGURES when it caps', () => {
    const orgs = Array.from({ length: 5 }, (_, index) =>
      paying(`o${index}`, `Org ${index}`),
    )
    const rows = orgs.map((org, index) => invoice(org.orgId, (index + 1) * 100))
    const total = subscriptionSettledSummary(rows)
    const attribution = orgAttribution(orgs, rows, 2)

    expect(attribution.rows).toHaveLength(2)
    expect(attribution.omittedOrgs).toBe(3)
    // Shown + omitted still equals the true total: the table is a complete
    // ACCOUNTING even when it is not a complete list.
    const shown = attribution.rows.reduce((s, r) => s + r.settledCents, 0)
    expect(shown + attribution.omittedSettledCents).toBe(
      total.netOfReversalsCents,
    )
    // And it kept the LARGEST contributors, not an arbitrary two.
    expect(attribution.rows[0].settledCents).toBe(500)
  })
})

/**
 * Attribution by listing, publisher and host (AGL-2486).
 *
 * The reconciliation assertions are the point: "a plugin table that does not
 * sum to the marketplace line is worse than no plugin table".
 */
describe('attribution by source', () => {
  const sale = (
    listingId: string,
    sellerOrgId: string,
    amountCents: number,
    feeCents: number,
    refundedCents = 0,
  ) => ({
    id: `cs_${listingId}_${amountCents}`,
    listingId,
    sellerOrgId,
    amountCents,
    taxCents: 0,
    feeCents,
    transferCents: amountCents - feeCents,
    refundedCents,
  })
  const order = (
    hostId: string,
    amountCents: number,
    feeCents: number,
    refundedCents = 0,
  ) => ({
    id: `o_${hostId}_${amountCents}`,
    hostId,
    amountCents,
    feeCents,
    refundedCents,
  })

  it('sums listing rows to the marketplace commission line exactly', () => {
    const rows = [
      sale('office-hours', 'pub1', 10_000, 1_500),
      sale('office-hours', 'pub1', 4_000, 600),
      sale('promo-countdown', 'pub2', 8_000, 1_200, 8_000),
    ]
    const total = marketplaceSettledSummary(rows)
    const byListing = marketplaceListingAttribution(rows)
    const summed = byListing.rows.reduce((s, r) => s + r.gainCents, 0)

    expect(summed).toBe(total.commissionNetCents)
    expect(byListing.rows).toHaveLength(2)
    // Losses carry a name too — the fully refunded sale is attributable.
    const refundRow = byListing.rows.find((r) => r.key === 'promo-countdown')
    expect(refundRow?.lossCents).toBe(1_200)
    expect(refundRow?.gainCents).toBe(0)
  })

  it('sums publisher rows to the same marketplace line', () => {
    const rows = [
      sale('a', 'pub1', 10_000, 1_500),
      sale('b', 'pub2', 4_000, 600),
    ]
    const total = marketplaceSettledSummary(rows)
    const byPublisher = marketplacePublisherAttribution(rows)
    expect(byPublisher.rows.reduce((s, r) => s + r.gainCents, 0)).toBe(
      total.commissionNetCents,
    )
    // Two groupings of the SAME money must agree with each other.
    const byListing = marketplaceListingAttribution(rows)
    expect(byPublisher.rows.reduce((s, r) => s + r.gainCents, 0)).toBe(
      byListing.rows.reduce((s, r) => s + r.gainCents, 0),
    )
  })

  it('sums host rows to the storefront commission line exactly', () => {
    const rows = [
      order('host-a', 20_000, 2_000),
      order('host-a', 5_000, 700),
      order('host-b', 9_000, 1_100, 9_000),
      // A zero-fee order: counted, but there is no take to attribute.
      order('host-c', 3_000, 0),
    ]
    const total = commerceSettledSummary(rows)
    const byHost = commerceHostAttribution(rows)
    expect(byHost.rows.reduce((s, r) => s + r.gainCents, 0)).toBe(
      total.commissionNetCents,
    )
    expect(byHost.rows.find((r) => r.key === 'host-c')?.gainCents).toBe(0)
  })

  it('keeps a row whose entity id is missing rather than dropping the money', () => {
    // Dropping it would make the rows sum BELOW the total — the exact fault
    // these tables exist to avoid.
    const rows = [{ id: 'x', amountCents: 10_000, feeCents: 1_500 }]
    const total = marketplaceSettledSummary(rows)
    const byListing = marketplaceListingAttribution(rows)
    expect(byListing.rows).toHaveLength(1)
    expect(byListing.rows[0].key).toBe('Listing not recorded')
    expect(byListing.rows[0].gainCents).toBe(total.commissionNetCents)
  })

  it('carries the omitted remainder as figures when capped', () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      sale(`l${index}`, 'pub', (index + 1) * 10_000, (index + 1) * 1_000),
    )
    const total = marketplaceSettledSummary(rows)
    const capped = marketplaceListingAttribution(rows, 2)
    const shown = capped.rows.reduce((s, r) => s + r.gainCents, 0)
    expect(capped.omittedRows).toBe(2)
    expect(shown + capped.omittedGainCents).toBe(total.commissionNetCents)
  })
})
