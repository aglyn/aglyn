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
 * The reconciled ceiling model.
 *
 * The load-bearing assertions here are the ones that check the ARITHMETIC
 * between ceilings rather than any single number. A test that pinned 500, and
 * 2,000, and 1,000,000 separately would have passed happily on the day those
 * three numbers first contradicted each other — which is the state this module
 * was written to end.
 */

import {
  EMAIL_CEILING_MONTH_HOURS,
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  EMAIL_ORG_HOURLY_SHARE,
  EMAIL_ORG_HOURLY_SHARE_MAX,
  EMAIL_ORG_HOURLY_SHARE_MIN,
  deliverableMonthlyCeiling,
  describeEmailCeilings,
  emailSendHeadroom,
  normalizeOrgHourlyShare,
  orgHourlyCampaignCeiling,
} from './send-ceilings'
import { EMAIL_SEND_RATE_DEFAULT_PER_HOUR } from './send-rate'

/** The shipped platform default, so the model is checked at its real values. */
const PLATFORM = EMAIL_SEND_RATE_DEFAULT_PER_HOUR

describe('the derivation', () => {
  it('derives the org hour as a floored share of the platform hour', () => {
    // 2,000 x 0.25 = 500. Stated explicitly rather than recomputed from the
    // constants, so a change to either constant fails HERE and is read by a
    // human, instead of the test quietly following it.
    expect(orgHourlyCampaignCeiling(2_000, 0.25)).toBe(500)
    expect(orgHourlyCampaignCeiling(PLATFORM)).toBe(500)
  })

  it('projects the month from the org hour', () => {
    // 500/hour x 720 hours = 360,000.
    expect(EMAIL_CEILING_MONTH_HOURS).toBe(720)
    expect(deliverableMonthlyCeiling(2_000, 0.25)).toBe(360_000)
  })

  it('never derives an org ceiling of zero', () => {
    // The stubbed-resolver failure in miniature: a share that rounds away
    // would refuse every campaign on the platform and a clamp built on it
    // would go green having sent nothing.
    expect(orgHourlyCampaignCeiling(1, 0.01)).toBe(1)
    expect(orgHourlyCampaignCeiling(0)).toBe(1)
    expect(orgHourlyCampaignCeiling(Number.NaN)).toBe(1)
  })

  it('clamps a share into range and falls back rather than to zero', () => {
    expect(normalizeOrgHourlyShare(0.5)).toBe(0.5)
    expect(normalizeOrgHourlyShare(5)).toBe(EMAIL_ORG_HOURLY_SHARE_MAX)
    expect(normalizeOrgHourlyShare(0.0001)).toBe(EMAIL_ORG_HOURLY_SHARE_MIN)
    // Unreadable falls back to the default, NEVER to 0.
    expect(normalizeOrgHourlyShare('a quarter')).toBe(EMAIL_ORG_HOURLY_SHARE)
    expect(normalizeOrgHourlyShare(0)).toBe(EMAIL_ORG_HOURLY_SHARE)
    expect(normalizeOrgHourlyShare(-1)).toBe(EMAIL_ORG_HOURLY_SHARE)
  })
})

describe('R1 — a send fits inside the org hour', () => {
  it('holds at the shipped defaults, with no slack', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 5_000,
    })
    // One maximal send is exactly one hour of the org's share. The two caps
    // explain each other; neither is a number somebody picked alone.
    expect(model.perSend).toBe(EMAIL_MAX_RECIPIENTS_PER_SEND)
    expect(model.orgPerHour).toBe(EMAIL_MAX_RECIPIENTS_PER_SEND)
    expect(
      model.violations.map((violation) => violation.relation),
    ).not.toContain('send-exceeds-org-hour')
  })

  it('reports a per-send cap that cannot fit in the hour', () => {
    const model = describeEmailCeilings({
      platformPerHour: 1_000,
      planMonthlyLimit: 1_000,
      perSend: 500,
      // 1,000 x 0.1 = 100/hour, but a send may address 500.
      orgShare: 0.1,
    })
    const violation = model.violations.find(
      (candidate) => candidate.relation === 'send-exceeds-org-hour',
    )
    expect(violation).toBeDefined()
    expect(violation!.claimed).toBe(500)
    expect(violation!.available).toBe(100)
    expect(model.coherent).toBe(false)
  })
})

describe('R2 — an org is not the whole platform', () => {
  it('holds at a 25% share', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 5_000,
    })
    expect(model.orgPerHour).toBeLessThan(model.platformPerHour)
    expect(
      model.violations.map((violation) => violation.relation),
    ).not.toContain('org-hour-exceeds-platform-hour')
  })

  it('leaves room for four concurrent senders at the shipped share', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 5_000,
    })
    expect(model.orgPerHour * 4).toBeLessThanOrEqual(model.platformPerHour)
  })

  /**
   * The share must be clamped where the MODEL reads it, not only inside
   * `normalizeOrgHourlyShare`. Testing the normalizer alone passes happily
   * while `describeEmailCeilings` calls `Number(share)` directly — which is
   * the over direction of the same defect that reads every ceiling as zero.
   */
  it('clamps an out-of-range share rather than handing one org the platform', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 5_000,
      orgShare: 4,
    })
    expect(model.orgShare).toBe(EMAIL_ORG_HOURLY_SHARE_MAX)
    expect(model.orgPerHour).toBe(PLATFORM)
    expect(model.orgPerHour).toBeLessThanOrEqual(model.platformPerHour)
  })

  it('falls back to the shipped share rather than deriving zero from a corrupt one', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 5_000,
      orgShare: Number.NaN,
    })
    expect(model.orgShare).toBe(EMAIL_ORG_HOURLY_SHARE)
    expect(model.orgPerHour).toBe(500)
  })
})

describe('R3 — a plan may not sell more than the platform can deliver', () => {
  it('holds for a plan inside the deliverable ceiling', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 250_000,
    })
    expect(model.deliverableMonthly).toBe(360_000)
    expect(model.coherent).toBe(true)
    expect(model.violations).toEqual([])
  })

  it('names the numbers when a plan oversells', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 1_000_000,
    })
    const violation = model.violations.find(
      (candidate) => candidate.relation === 'plan-exceeds-deliverable-month',
    )
    expect(violation).toBeDefined()
    expect(violation!.claimed).toBe(1_000_000)
    expect(violation!.available).toBe(360_000)
    // A refusal, and a report, must STATE ITS NUMBERS. A boolean that says
    // "over limit" is the silent cap one layer up.
    expect(violation!.detail).toContain('1,000,000')
    expect(violation!.detail).toContain('360,000')
  })

  it('makes an overselling allowance legible as hours of the org share', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 1_000_000,
    })
    // 1,000,000 / 500 per hour = 2,000 hours, against a 720-hour month.
    expect(model.hoursToSpendPlan).toBe(2_000)
    expect(model.hoursToSpendPlan).toBeGreaterThan(EMAIL_CEILING_MONTH_HOURS)
  })

  it('treats an unlimited plan as overselling by construction', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: Number.POSITIVE_INFINITY,
    })
    expect(model.planUnlimited).toBe(true)
    expect(
      model.violations.map((violation) => violation.relation),
    ).toContain('plan-exceeds-deliverable-month')
  })

  it('does NOT clamp the plan down to what the platform can deliver', () => {
    // The repair for R3 would be to lower an entitlement, and an entitlement
    // is what a locked price bought. The model reports; it must never quietly
    // resolve a paid allowance down to the current platform ceiling.
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: 1_000_000,
    })
    expect(model.planMonthly).toBe(1_000_000)
    expect(model.planMonthly).toBeGreaterThan(model.deliverableMonthly)
  })
})

describe('the sentinel never crosses the wire', () => {
  it('reports a finite number plus a flag for an unlimited plan', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: Number.POSITIVE_INFINITY,
    })
    expect(model.planUnlimited).toBe(true)
    expect(Number.isFinite(model.planMonthly)).toBe(true)
    expect(model.planMonthly).toBe(model.deliverableMonthly)
  })

  it('survives a JSON round trip with the cap intact', () => {
    // `JSON.stringify(Infinity)` is `null`; `Number(null)` is 0; and
    // `Number.isFinite(0)` is true, so an Infinity sentinel arrives as a cap
    // of ZERO on the most expensive plan and passes every guard on the way.
    const headroom = emailSendHeadroom({
      model: describeEmailCeilings({
        platformPerHour: PLATFORM,
        planMonthlyLimit: Number.POSITIVE_INFINITY,
      }),
      monthUsed: 10,
      hourUsed: 0,
      hourResetMs: 1_755_104_400_000,
    })
    const wire = JSON.parse(JSON.stringify(headroom))
    expect(wire.monthLimit).toBe(360_000)
    expect(wire.monthLimit).not.toBeNull()
    expect(wire.planUnlimited).toBe(true)
    expect(wire.monthRemaining).toBeGreaterThan(0)
  })

  it('reads a missing allowance as zero, never as unlimited', () => {
    const model = describeEmailCeilings({
      platformPerHour: PLATFORM,
      planMonthlyLimit: Number.NaN,
    })
    expect(model.planMonthly).toBe(0)
    expect(model.planUnlimited).toBe(false)
  })
})

describe('emailSendHeadroom — what a workspace has sent against what it may', () => {
  const model = describeEmailCeilings({
    platformPerHour: PLATFORM,
    planMonthlyLimit: 5_000,
  })

  it('reports both windows and what is left in each', () => {
    const headroom = emailSendHeadroom({
      model,
      monthUsed: 4_800,
      hourUsed: 120,
      hourResetMs: 1_755_104_400_000,
    })
    expect(headroom.monthUsed).toBe(4_800)
    expect(headroom.monthLimit).toBe(5_000)
    expect(headroom.monthRemaining).toBe(200)
    expect(headroom.hourUsed).toBe(120)
    expect(headroom.hourLimit).toBe(500)
    expect(headroom.hourRemaining).toBe(380)
  })

  it('floors a spent allowance at zero rather than reporting a negative', () => {
    const headroom = emailSendHeadroom({
      model,
      monthUsed: 6_000,
      hourUsed: 900,
      hourResetMs: 0,
    })
    expect(headroom.monthRemaining).toBe(0)
    expect(headroom.hourRemaining).toBe(0)
  })

  it('does not read a corrupt counter as headroom', () => {
    const headroom = emailSendHeadroom({
      model,
      monthUsed: -50,
      hourUsed: Number.NaN,
      hourResetMs: 0,
    })
    expect(headroom.monthUsed).toBe(0)
    expect(headroom.hourUsed).toBe(0)
    expect(headroom.monthRemaining).toBe(5_000)
  })

  it('tells a workspace when its plan promises more than it can spend', () => {
    const oversold = emailSendHeadroom({
      model: describeEmailCeilings({
        platformPerHour: PLATFORM,
        planMonthlyLimit: 1_000_000,
      }),
      monthUsed: 0,
      hourUsed: 0,
      hourResetMs: 0,
    })
    expect(oversold.planExceedsDeliverable).toBe(true)
    expect(oversold.deliverableMonthly).toBe(360_000)
    // …and a plan that fits says nothing of the kind.
    expect(
      emailSendHeadroom({ model, monthUsed: 0, hourUsed: 0, hourResetMs: 0 })
        .planExceedsDeliverable,
    ).toBe(false)
  })
})
