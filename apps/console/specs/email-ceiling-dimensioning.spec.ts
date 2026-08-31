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
 * EVERY PLAN'S EMAIL ALLOWANCE, AGAINST WHAT THE PLATFORM CAN DELIVER.
 *
 * The three email ceilings were each chosen on their own and never compared:
 * a per-send cap of 500, a platform ceiling of 2,000/hour, and plan
 * allowances that once reached 1,000,000/month. They could not all be true.
 * At the shipped constants the platform can deliver 360,000 campaign emails a
 * month to one workspace, and every plan allowance now sits under that.
 *
 * ## Why this guard is a PIN and not a repair
 *
 * The repair — lowering `emailSendsPerMonth` — is not one this test, or the
 * code under it, may make. An entitlement is what a price bought, and
 * lowering one is a six-place pricing move with a Decision Log entry behind
 * it. So the relation is PINNED here instead: the set of overselling plans is
 * asserted exactly, which makes this file RED the moment the set changes in
 * either direction.
 *
 * That means it fails when:
 *
 *  - a new plan is added that oversells (the set grew);
 *  - an existing plan's allowance is raised past the deliverable ceiling;
 *  - the platform hourly ceiling's DEFAULT is lowered, shrinking what is
 *    deliverable and pulling plans over the line;
 *  - a plan comes back under the line (the set shrank) — at which point this
 *    file is edited deliberately, with the change that caused it.
 *
 * ## The decision this pin was holding open, and how it went
 *
 * Two things could have closed the gap, and only one of them was an
 * engineering choice:
 *
 *  1. **Raise the platform ceiling.** For a 1,000,000 allowance to be
 *     deliverable at a 25% per-org share the platform needed
 *     `1,000,000 / (0.25 x 720)` = **5,556 messages/hour**, 2.78x the
 *     default. That is a deliverability and warm-up decision about a shared
 *     domain under `p=reject`, not a config edit, and it was not taken.
 *  2. **Lower the top allowances.** That is what happened, twice — once for
 *     deliverability and once because email sending acquired a price and the
 *     included bands were running 28-36% of the subscription.
 *
 * `enterprise` left the set separately, when `UNLIMITED` became a finite
 * contracted default. It was never oversold by arithmetic; it was unbounded
 * by construction, and no finite platform can deliver an unbounded allowance.
 *
 * The per-org hourly ceiling is still what actually paces the mail, and it
 * DEFERS rather than refuses — the campaign stays a draft, the audience is
 * untouched, and the number is stated.
 *
 * ## Derived, never hand-listed
 *
 * The plan keys come from `PLAN_ENTITLEMENTS` on every run, the ceiling
 * constants from the policy module. A guard carrying its own copy of the
 * numbers it guards decays in the same commit as the thing it guards.
 */

import { PLAN_ENTITLEMENTS, UNLIMITED } from '@aglyn/aglyn'
import {
  EMAIL_CEILING_MONTH_HOURS,
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  EMAIL_ORG_HOURLY_SHARE,
  EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
  deliverableMonthlyCeiling,
  describeEmailCeilings,
  orgHourlyCampaignCeiling,
} from '@aglyn/shared-util-email'

/** The platform default, which is what an unramped deployment actually runs. */
const PLATFORM_PER_HOUR = EMAIL_SEND_RATE_DEFAULT_PER_HOUR

const DELIVERABLE = deliverableMonthlyCeiling(PLATFORM_PER_HOUR)

const PLAN_KEYS = Object.keys(PLAN_ENTITLEMENTS) as Array<
  keyof typeof PLAN_ENTITLEMENTS
>

/** The model for one plan, at the shipped platform constants. */
function modelFor(plan: keyof typeof PLAN_ENTITLEMENTS) {
  return describeEmailCeilings({
    platformPerHour: PLATFORM_PER_HOUR,
    planMonthlyLimit: PLAN_ENTITLEMENTS[plan].emailSendsPerMonth,
  })
}

/** Whether a monthly allowance exceeds what the platform can deliver. */
function limitOversells(monthlyLimit: number): boolean {
  return describeEmailCeilings({
    platformPerHour: PLATFORM_PER_HOUR,
    planMonthlyLimit: monthlyLimit,
  }).violations.some(
    (violation) => violation.relation === 'plan-exceeds-deliverable-month',
  )
}

/** The overselling plans of any entitlements-shaped table. */
function oversellingPlans(table: Record<string, { emailSendsPerMonth: number }>) {
  return Object.keys(table)
    .filter((plan) => limitOversells(table[plan].emailSendsPerMonth))
    .sort()
}

function oversells(plan: keyof typeof PLAN_ENTITLEMENTS): boolean {
  return limitOversells(PLAN_ENTITLEMENTS[plan].emailSendsPerMonth)
}

describe('the guard can tell the two answers apart', () => {
  /**
   * The control. A check whose "fits" and "oversells" verdicts are driven by
   * a stubbed or broken resolver reads the same for every plan — and a
   * clamp built on it goes green having refused everything, or having
   * refused nothing. Both directions are exercised against the real
   * arithmetic before any plan is judged by it.
   */
  it('says a limit under the deliverable ceiling fits', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM_PER_HOUR,
      planMonthlyLimit: DELIVERABLE - 1,
    })
    expect(model.coherent).toBe(true)
    expect(model.violations).toEqual([])
  })

  it('says a limit over the deliverable ceiling oversells', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM_PER_HOUR,
      planMonthlyLimit: DELIVERABLE + 1,
    })
    expect(model.coherent).toBe(false)
    expect(
      model.violations.map((violation) => violation.relation),
    ).toContain('plan-exceeds-deliverable-month')
  })

  /**
   * The pin below reads a table this file does not own, so the detector is
   * driven against synthetic tables in BOTH directions first. A detector that
   * answered the same for every input would make the pin's green meaningless
   * — it would agree that nothing oversells, or that everything does, and
   * either reads as a passing test.
   */
  it('detects a plan that is moved OVER the deliverable ceiling', () => {
    expect(
      oversellingPlans({
        small: { emailSendsPerMonth: 5_000 },
        large: { emailSendsPerMonth: DELIVERABLE * 3 },
      }),
    ).toEqual(['large'])
  })

  it('detects a plan that is moved UNDER the deliverable ceiling', () => {
    // The same table with the offending allowance brought back in range must
    // report an EMPTY set, not a stale one.
    expect(
      oversellingPlans({
        small: { emailSendsPerMonth: 5_000 },
        large: { emailSendsPerMonth: DELIVERABLE - 1 },
      }),
    ).toEqual([])
  })

  it('detects an unlimited allowance as overselling', () => {
    expect(
      oversellingPlans({ boundless: { emailSendsPerMonth: UNLIMITED } }),
    ).toEqual(['boundless'])
  })

  it('reads the real entitlements table rather than a default', () => {
    // `resolveOrgEntitlements(undefined)` resolves the FREE tier, and free is
    // 0 — so a wiring bug that lost the plan would read every ceiling as
    // zero and this whole file would agree that nothing oversells.
    expect(PLAN_KEYS.length).toBeGreaterThan(5)
    expect(PLAN_ENTITLEMENTS.free.emailSendsPerMonth).toBe(0)
    expect(PLAN_ENTITLEMENTS.agency.emailSendsPerMonth).toBeGreaterThan(0)
    // …and the values are genuinely different between tiers, so a table that
    // collapsed to one number cannot pass.
    expect(new Set(PLAN_KEYS.map((plan) => PLAN_ENTITLEMENTS[plan].emailSendsPerMonth)).size)
      .toBeGreaterThan(5)
  })
})

describe('the derived ceilings, at the shipped constants', () => {
  it('derives 500/hour per workspace and 360,000/month deliverable', () => {
    expect(PLATFORM_PER_HOUR).toBe(2_000)
    expect(EMAIL_ORG_HOURLY_SHARE).toBe(0.25)
    expect(orgHourlyCampaignCeiling(PLATFORM_PER_HOUR)).toBe(500)
    expect(EMAIL_CEILING_MONTH_HOURS).toBe(720)
    expect(DELIVERABLE).toBe(360_000)
  })

  it('R1 — one maximal send fits in one hour of a workspace share', () => {
    expect(EMAIL_MAX_RECIPIENTS_PER_SEND).toBeLessThanOrEqual(
      orgHourlyCampaignCeiling(PLATFORM_PER_HOUR),
    )
  })

  it('R2 — a workspace hour fits inside the platform hour', () => {
    expect(orgHourlyCampaignCeiling(PLATFORM_PER_HOUR)).toBeLessThanOrEqual(
      PLATFORM_PER_HOUR,
    )
  })
})

describe('R3 — which plans the platform can actually deliver', () => {
  /**
   * The pin. Exactly these plans oversell, and no others.
   *
   * Both halves matter. Asserting only the overselling set would let a plan
   * silently drop out of it; asserting only the fitting set would let a new
   * plan quietly join the overselling one.
   *
   * ⚑ THE SET IS NOW EMPTY, which is the outcome the header held the decision
   * open for. Two changes emptied it. `agency` left on 2026-08-30, when the
   * allowance came down rather than the platform ceiling going up (Advanced
   * 250,000 → 125,000, Agency 1,000,000 → 250,000). `enterprise` left when
   * `UNLIMITED` became a finite contracted default: it was never oversold by
   * arithmetic, it was unbounded by construction, and no finite platform can
   * deliver an unbounded allowance.
   *
   * An empty pin is not a weakened one. The detector is driven in BOTH
   * directions against synthetic tables above — including the unlimited case
   * — so a check that had stopped answering could not produce this green.
   */
  const EXPECTED_OVERSELLING: string[] = []

  it('pins the overselling set exactly', () => {
    expect(PLAN_KEYS.filter(oversells).sort()).toEqual(EXPECTED_OVERSELLING)
  })

  it('pins the deliverable set exactly', () => {
    expect(PLAN_KEYS.filter((plan) => !oversells(plan)).sort()).toEqual([
      'advanced',
      'agency',
      'business',
      'enterprise',
      'free',
      'pro',
      'scale',
      'starter',
    ])
  })

  it('states the size of the agency headroom in numbers, not a boolean', () => {
    const model = modelFor('agency')
    expect(model.planMonthly).toBe(130_000)
    expect(model.deliverableMonthly).toBe(360_000)
    // 130,000 at 500/hour needs 260 hours of a 720-hour month. The number is
    // asserted rather than a boolean because "fits" and "fits by 30 minutes"
    // are different products, and only one of them survives a bad week.
    expect(model.hoursToSpendPlan).toBe(260)
    expect(
      model.violations.some(
        (candidate) => candidate.relation === 'plan-exceeds-deliverable-month',
      ),
    ).toBe(false)
  })

  it('leaves the top of the ladder the widest, and still inside the pace', () => {
    // Enterprise is now the largest allowance on the table and the one that
    // has to clear the ceiling by the least. 250,000 at 500/hour spends 500 of
    // a 720-hour month, which is where the header's "room for bursts, retries
    // and domain warm-up" argument was made and is why this is the number.
    const model = modelFor('enterprise')
    expect(model.planMonthly).toBe(250_000)
    expect(model.hoursToSpendPlan).toBe(500)
    expect(model.planMonthly).toBeGreaterThan(modelFor('agency').planMonthly)
    expect(model.planMonthly).toBeLessThanOrEqual(DELIVERABLE)
  })

  /**
   * The repair is a LOWERED ALLOWANCE, not a raised ceiling. If someone later
   * closes a gap by moving the platform rate instead, that is a deliverability
   * and spend decision and it must not arrive as a silent side effect of a
   * test going green.
   */
  it('the platform hour is unchanged by the repair', () => {
    expect(PLATFORM_PER_HOUR).toBe(2_000)
    expect(DELIVERABLE).toBe(360_000)
  })

  it('sells no unbounded email allowance on any plan', () => {
    // The sentinel used to live here, and the model had to launder it: an
    // unlimited plan reported `deliverableMonthly` as its allowance so that
    // `JSON.stringify` could not turn the figure into `null` — which reads
    // back as a cap of ZERO on the most expensive plan on the price list.
    // Now the table itself is finite, so nothing has to be laundered.
    for (const plan of PLAN_KEYS) {
      const entitled = PLAN_ENTITLEMENTS[plan].emailSendsPerMonth
      expect(`${plan}: ${Number.isFinite(entitled)}`).toBe(`${plan}: true`)
      expect(`${plan}: ${entitled === UNLIMITED}`).toBe(`${plan}: false`)
      expect(modelFor(plan).planUnlimited).toBe(false)
    }
  })

  it('the finite table survives the wire that flattened the sentinel', () => {
    // The defect this closes, exercised rather than described. `UNLIMITED` is
    // `Number.POSITIVE_INFINITY`; `JSON.stringify` writes it as `null`; and
    // `Number(null)` is `0`, which `Number.isFinite` accepts — so it passed
    // every guard written to reject a payload that cannot state its terms.
    expect(JSON.parse(JSON.stringify(UNLIMITED))).toBeNull()
    expect(Number(JSON.parse(JSON.stringify(UNLIMITED)))).toBe(0)
    const round = JSON.parse(JSON.stringify(PLAN_ENTITLEMENTS))
    for (const plan of PLAN_KEYS) {
      const sent = round[plan].emailSendsPerMonth
      expect(`${plan}: ${typeof sent}`).toBe(`${plan}: number`)
      expect(`${plan}: ${sent}`).toBe(
        `${plan}: ${PLAN_ENTITLEMENTS[plan].emailSendsPerMonth}`,
      )
    }
    // …and the one that used to be the sentinel is the one to name.
    expect(round.enterprise.emailSendsPerMonth).toBe(250_000)
  })

  it('does not lower any plan allowance to make the arithmetic work', () => {
    // The model reports; it never repairs. Every plan's reported allowance is
    // still exactly what the entitlements table sells.
    for (const plan of PLAN_KEYS) {
      const entitled = PLAN_ENTITLEMENTS[plan].emailSendsPerMonth
      if (!Number.isFinite(entitled)) continue
      expect(modelFor(plan).planMonthly).toBe(entitled)
    }
  })

  it('names the platform ceiling that would make every plan deliverable', () => {
    // The decision in the header, as arithmetic rather than prose. Raising
    // the platform default to this figure clears the finite plans; the
    // unlimited one is unbounded and no finite ceiling clears it.
    const largestFinite = Math.max(
      ...PLAN_KEYS.map((plan) => PLAN_ENTITLEMENTS[plan].emailSendsPerMonth).filter(
        (limit) => Number.isFinite(limit),
      ),
    )
    /*
     * ⚠️ THE ORG SHARE IS FLOORED, so the naive
     * `largestFinite / (share × hours)` understates the answer — it assumes a
     * fractional org-hour that `orgHourlyCampaignCeiling` throws away. It
     * happened to pass at the old numbers because 5,556 × 0.25 is exactly
     * 1,389, and would have failed silently at almost any other allowance.
     *
     * Solve it the way the code computes it: the org hour needed first, then
     * the platform hour that yields it after the floor.
     */
    const orgHourNeeded = Math.ceil(largestFinite / EMAIL_CEILING_MONTH_HOURS)
    const required = Math.ceil(orgHourNeeded / EMAIL_ORG_HOURLY_SHARE)
    // Now that the top allowance is 250,000 the required rate is BELOW the
    // shipped 2,000/hour, so the arithmetic reads as headroom rather than as
    // a shortfall. Kept as a live calculation rather than deleted: it is the
    // thing that goes red first if an allowance is ever raised past what the
    // platform can carry, and it names the rate that would be needed.
    expect(largestFinite).toBe(250_000)
    expect(required).toBe(1_392)
    expect(required).toBeLessThanOrEqual(PLATFORM_PER_HOUR)
    expect(
      deliverableMonthlyCeiling(required),
    ).toBeGreaterThanOrEqual(largestFinite)
  })
})
