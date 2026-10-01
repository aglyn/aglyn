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
  resolveTransactionFeeCents,
  storefrontProcessingCostCents,
} from '@aglyn/aglyn/server'
import type { RevenueSection } from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import {
  classifyOrgRevenueState,
  contractedSummary,
  orgAttribution,
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

/**
 * A source's earned line as the report adds it: the plugin's own fold is
 * proved in that plugin (commission and take, net of what is not the
 * operator's); what the TOTAL owes it is exactly its earned cents, and a
 * refused source nothing.
 */
const earning = (id: string, cents: number): RevenueSection => ({
  outcome: 'answered',
  pluginId: id,
  id,
  name: id,
  earned: { label: id, cents, note: '' },
  grossToNet: [],
  notes: [],
  attribution: [],
  truncated: false,
  failure: null,
  summary: {},
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
    // The marketplace's commission on an 11000 sale with 1000 tax and an 8000
    // transfer, and the storefront's take on a 20000 order once Stripe's cost
    // is out — each its plugin's own figure.
    const sources = [
      earning('marketplace', 2000),
      earning('commerce', fee - storefrontProcessingCostCents(chargeCents)),
    ]
    const earned = totalEarnedCents({ subscriptions, sources })
    expect(earned).toBe(
      10000 + 2000 + (fee - storefrontProcessingCostCents(chargeCents)),
    )
    // Each exclusion asserted as a strict inequality, so a regression that
    // folded any of them in fails here rather than merely shifting a total.
    const naive = subscriptions.grossCents + 11000 + fee
    expect(earned).toBeLessThan(naive)
    expect(earned).toBeLessThan(naive - 8000)
  })

  it('adds nothing for a source that could not be read — unread is not zero', () => {
    const subscriptions = subscriptionSettledSummary([
      { id: 'i1', grossCents: 10825, taxCents: 825 },
    ])
    const earned = totalEarnedCents({
      subscriptions,
      sources: [
        earning('marketplace', 2000),
        { outcome: 'refused', pluginId: 'commerce', id: 'commerce', reason: 'It threw.' },
      ],
    })
    expect(earned).toBe(10000 + 2000)
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

describe('a signup that never paid is neither revenue nor a comp', () => {
  // `incomplete_expired` is what Stripe leaves behind when a first payment is
  // never authenticated. It has collected nothing, so it cannot appear in the
  // contracted book; and nobody chose to give it away, so it cannot appear in
  // the comped count either — a comp is the ABSENCE of a subscription.
  const expired = {
    name: 'Abandoned Signup',
    plan: 'business',
    billingStatus: 'incomplete_expired',
    subscription: { status: 'incomplete_expired', interval: 'month' },
  }

  it('is classified as contributing nothing', () => {
    expect(classifyOrgRevenueState(expired)).toBe('inactive')
  })

  it('adds nothing to the contracted book and nothing to the comped count', () => {
    const summary = contractedSummary([
      { orgId: 'paying', billing: payingOrg() },
      { orgId: 'expired', billing: expired },
    ])
    expect(summary.total.orgs).toBe(1)
    expect(summary.compedOrgs).toBe(0)
    expect(summary.pastDue.orgs).toBe(0)
    // Derived from the table, so this cannot pass against a hardcoded figure:
    // the business plan price would be visible in the total if it had leaked.
    expect(summary.total.mrrUsd).toBe(PLAN_PRICING.starter.basePriceMonthlyUsd)
  })

  it('is not named as a comp in the attribution table', () => {
    const orgs = [{ orgId: 'expired', billing: expired }]
    const attribution = orgAttribution(orgs, [])
    expect(attribution.rows.some((row) => row.state === 'comped')).toBe(false)
  })

  it('a cancelled paid plan is churn, not a comp, for the same reason', () => {
    // The same conflation reached through the commonest status of all: a `plan`
    // field left standing after the subscription ended.
    const churned = {
      name: 'Churned Co',
      plan: 'business',
      billingStatus: 'canceled',
      subscription: { status: 'canceled', interval: 'month' },
    }
    expect(classifyOrgRevenueState(churned)).toBe('inactive')
    expect(contractedSummary([{ orgId: 'churned', billing: churned }]).compedOrgs).toBe(0)
  })

  it('an explicit staff comp is a comp, on a canceled subscription or none (AGL-3034)', () => {
    // The churned shape above, plus the comp staff granted it: now it is a
    // plan we chose to give away, and counts as one — never as revenue.
    const comped = {
      name: 'Comped Co',
      plan: 'business',
      billingStatus: 'canceled',
      subscription: { status: 'canceled', interval: 'month' },
      entitlements: { planComp: { plan: 'pro', reason: 'beta' } },
    }
    expect(classifyOrgRevenueState(comped)).toBe('comped')
    expect(classifyOrgRevenueState({ entitlements: { planComp: { plan: 'scale' } } })).toBe(
      'comped',
    )
    const summary = contractedSummary([{ orgId: 'comped', billing: comped }])
    expect(summary.compedOrgs).toBe(1)
    expect(summary.total.orgs).toBe(0)
    expect(summary.total.mrrUsd).toBe(0)
    // A live subscription outranks the comp: that org is billing, not comped.
    const paying = { ...payingOrg(), entitlements: { planComp: { plan: 'agency' } } }
    expect(classifyOrgRevenueState(paying)).toBe('collecting')
  })

  it('leaves a real comp and a real dunning org alone — the controls', () => {
    // A staff override writes `plan` and NO subscription: still a comp.
    expect(classifyOrgRevenueState({ plan: 'agency' })).toBe('comped')
    // Dunning is contracted money Stripe is still retrying: still counted.
    const dunning = {
      plan: 'starter',
      billingStatus: 'past_due',
      subscription: { status: 'past_due', interval: 'month' },
    }
    expect(classifyOrgRevenueState(dunning)).toBe('pastDue')
    const summary = contractedSummary([{ orgId: 'dunning', billing: dunning }])
    expect(summary.total.orgs).toBe(1)
    expect(summary.pastDue.orgs).toBe(1)
    expect(summary.pastDue.mrrUsd).toBe(PLAN_PRICING.starter.basePriceMonthlyUsd)
    // And a healthy one, so the controls cannot pass on a stub that answers
    // the same bucket for everything.
    expect(classifyOrgRevenueState(payingOrg())).toBe('collecting')
  })
})
