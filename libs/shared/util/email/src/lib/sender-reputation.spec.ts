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
 * THE PER-TENANT CONTROLS, GRADED IN BOTH DIRECTIONS.
 *
 * A ceiling asserted from one side is not asserted at all. A breaker that
 * refused everything would pass every "it refuses a bad sender" test ever
 * written, and a ramp that returned zero would pass every "a new tenant is
 * paced" test — while having stopped the entire platform. So every threshold
 * here is checked at both edges: the value that trips it, and the value one
 * step under that must not.
 */

import {
  EMAIL_BOUNCE_RATE_TRIP,
  EMAIL_BOUNCE_RATE_WATCH,
  EMAIL_COMPLAINT_RATE_TRIP,
  EMAIL_COMPLAINT_RATE_WATCH,
  EMAIL_RAMP_GRADUATION_DAYS,
  EMAIL_RAMP_STEPS,
  EMAIL_REPUTATION_MIN_EVENTS,
  EMAIL_REPUTATION_MIN_VOLUME,
  daysBetween,
  emailRampVerdict,
  emailReputationRate,
  emailReputationVerdict,
  formatReputationRate,
  effectiveReputationPolicy,
  normalizeEmailReputationPolicy,
  reputationDayKey,
  reputationWindowDayKeys,
} from './sender-reputation'
import { orgDailyCampaignCeiling } from './send-ceilings'

const NOW = Date.UTC(2026, 7, 30, 12)

/** A window with the given complaint count over a volume that clears both guards. */
const complaints = (complained: number, accepted = 10_000) => ({
  accepted,
  bounced: 0,
  complained,
})

const bounces = (bounced: number, accepted = 10_000) => ({
  accepted,
  bounced,
  complained: 0,
})

describe('the complaint-rate ceiling', () => {
  it('trips at Google’s published spam rate', () => {
    // 0.30% exactly — the number Google says never to reach.
    const verdict = emailReputationVerdict({
      counts: complaints(EMAIL_COMPLAINT_RATE_TRIP * 10_000),
      now: NOW,
    })
    expect(verdict.state).toBe('tripped')
    expect(verdict.blocked).toBe(true)
    expect(verdict.complaintRate).toBeCloseTo(EMAIL_COMPLAINT_RATE_TRIP)
  })

  it('does NOT trip one complaint under it', () => {
    const verdict = emailReputationVerdict({
      counts: complaints(EMAIL_COMPLAINT_RATE_TRIP * 10_000 - 1),
      now: NOW,
    })
    expect(verdict.blocked).toBe(false)
    // Reported, though — the surface has to show a rate climbing before it
    // bites, or a refused campaign is the first anybody hears of the control.
    expect(verdict.state).toBe('watch')
    expect(verdict.findings[0]).toMatchObject({
      code: 'complaint-rate',
      severity: 'low',
    })
  })

  it('reports nothing at all below the watch level', () => {
    const verdict = emailReputationVerdict({
      counts: complaints(EMAIL_COMPLAINT_RATE_WATCH * 10_000 - 1),
      now: NOW,
    })
    expect(verdict.state).toBe('ok')
    expect(verdict.findings).toEqual([])
  })
})

describe('the bounce-rate ceiling', () => {
  it('trips at the hard threshold', () => {
    const verdict = emailReputationVerdict({
      counts: bounces(EMAIL_BOUNCE_RATE_TRIP * 10_000),
      now: NOW,
    })
    expect(verdict.blocked).toBe(true)
  })

  it('does not trip just under it', () => {
    const verdict = emailReputationVerdict({
      counts: bounces(EMAIL_BOUNCE_RATE_TRIP * 10_000 - 1),
      now: NOW,
    })
    expect(verdict.blocked).toBe(false)
    expect(verdict.bounceRate).toBeGreaterThanOrEqual(EMAIL_BOUNCE_RATE_WATCH)
  })
})

describe('the two guards in front of every threshold', () => {
  it('will not act on a rate over too small a denominator', () => {
    // 100% complaints, on one message under the volume floor.
    const verdict = emailReputationVerdict({
      counts: complaints(
        EMAIL_REPUTATION_MIN_VOLUME - 1,
        EMAIL_REPUTATION_MIN_VOLUME - 1,
      ),
      now: NOW,
    })
    expect(verdict.blocked).toBe(false)
    expect(verdict.findings[0]?.actionable).toBe(false)
    expect(verdict.findings[0]?.detail).toMatch(/too little volume/)
  })

  it('DOES act one message over the floor', () => {
    const verdict = emailReputationVerdict({
      counts: complaints(
        EMAIL_REPUTATION_MIN_VOLUME,
        EMAIL_REPUTATION_MIN_VOLUME,
      ),
      now: NOW,
    })
    expect(verdict.blocked).toBe(true)
  })

  it('will not act on fewer events than the floor', () => {
    const verdict = emailReputationVerdict({
      counts: complaints(EMAIL_REPUTATION_MIN_EVENTS - 1, 200),
      now: NOW,
    })
    expect(verdict.blocked).toBe(false)
    expect(verdict.findings[0]?.actionable).toBe(false)
  })

  it('DOES act at the event floor', () => {
    const verdict = emailReputationVerdict({
      counts: complaints(EMAIL_REPUTATION_MIN_EVENTS, 200),
      now: NOW,
    })
    expect(verdict.blocked).toBe(true)
  })
})

describe('the three policies', () => {
  const lowSeverity = complaints(EMAIL_COMPLAINT_RATE_TRIP * 10_000 - 1)
  const highSeverity = complaints(EMAIL_COMPLAINT_RATE_TRIP * 10_000)

  it('`standard` stops on a high-severity finding and not on a low one', () => {
    expect(
      emailReputationVerdict({ counts: highSeverity, policy: 'standard', now: NOW })
        .blocked,
    ).toBe(true)
    expect(
      emailReputationVerdict({ counts: lowSeverity, policy: 'standard', now: NOW })
        .blocked,
    ).toBe(false)
  })

  it('`strict` stops on the low one too', () => {
    expect(
      emailReputationVerdict({ counts: lowSeverity, policy: 'strict', now: NOW })
        .blocked,
    ).toBe(true)
  })

  it('`none` records and stops nothing', () => {
    const verdict = emailReputationVerdict({
      counts: highSeverity,
      policy: 'none',
      now: NOW,
    })
    expect(verdict.blocked).toBe(false)
    // Still reported. A policy that stopped recording would leave an operator
    // with no way to see the tenant they parked.
    expect(verdict.findings[0]?.severity).toBe('high')
  })

  it('an unreadable policy falls back to `standard`, never to `none`', () => {
    expect(normalizeEmailReputationPolicy(undefined)).toBe('standard')
    expect(normalizeEmailReputationPolicy('')).toBe('standard')
    expect(normalizeEmailReputationPolicy('off')).toBe('standard')
    expect(normalizeEmailReputationPolicy(null)).toBe('standard')
    // A control switched off by a typo is the shape a ceiling disappears in.
    expect(
      emailReputationVerdict({
        counts: complaints(30),
        policy: 'nonsense' as never,
        now: NOW,
      }).blocked,
    ).toBe(true)
  })
})

/*==========================================
 * WHOSE REPUTATION A CAMPAIGN SPENDS.
 *
 * The pool carries marketing for every site with no domain of its own, so what
 * bounds one site's spending of a shared reputation is this grade rather than a
 * refusal at the door.
 *=========================================*/
describe('the pooled grade', () => {
  /**
   * ⛔ THE CONTROL. On a shared member a campaign is held to the WATCH
   * thresholds, because the complaints it earns are charged to sites that did
   * nothing.
   */
  it('grades a pooled sender `strict` whatever the org configured', () => {
    expect(effectiveReputationPolicy('shared', 'standard')).toBe('strict')
    expect(effectiveReputationPolicy('shared', undefined)).toBe('strict')
    // ⛔ INCLUDING `none`. A workspace that switched its own breaker off must
    // not thereby switch off the one protecting its pool neighbours.
    expect(effectiveReputationPolicy('shared', 'none')).toBe('strict')
  })

  /**
   * …and NOT on a domain the merchant owns. There the only reputation being
   * spent is theirs, so the setting they chose is the one that binds — this
   * must not become a platform-wide tightening nobody asked for.
   */
  it('leaves every other identity on the org’s own setting', () => {
    expect(effectiveReputationPolicy('custom', 'none')).toBe('none')
    expect(effectiveReputationPolicy('custom', 'standard')).toBe('standard')
    expect(effectiveReputationPolicy('platform', 'none')).toBe('none')
    // An unresolved send is not pooled either, and an unreadable setting still
    // falls back to `standard` rather than to `none`.
    expect(effectiveReputationPolicy(null, 'nonsense')).toBe('standard')
    expect(effectiveReputationPolicy(undefined, undefined)).toBe('standard')
  })

  /**
   * The grade is the whole mechanism, so the thresholds it moves are asserted
   * rather than assumed: a rate between the watch and trip levels stops a
   * pooled sender and does not stop one on its own domain.
   */
  it('stops a pooled sender at a rate a custom-domain sender survives', () => {
    // Above the watch level, below the trip level.
    const counts = complaints(EMAIL_COMPLAINT_RATE_WATCH * 10_000 + 5)

    expect(
      emailReputationVerdict({
        counts,
        policy: effectiveReputationPolicy('shared', 'standard'),
        now: NOW,
      }).blocked,
    ).toBe(true)

    expect(
      emailReputationVerdict({
        counts,
        policy: effectiveReputationPolicy('custom', 'standard'),
        now: NOW,
      }).blocked,
    ).toBe(false)
  })
})

describe('reinstatement', () => {
  const bad = complaints(EMAIL_COMPLAINT_RATE_TRIP * 10_000)

  it('lets a recovering tenant send while the grace period is open', () => {
    const verdict = emailReputationVerdict({
      counts: bad,
      reinstatedUntilMs: NOW + 86_400_000,
      now: NOW,
    })
    expect(verdict.state).toBe('reinstated')
    expect(verdict.blocked).toBe(false)
    expect(verdict.reason).toBe('')
  })

  it('stops again once it has expired', () => {
    const verdict = emailReputationVerdict({
      counts: bad,
      reinstatedUntilMs: NOW - 1,
      now: NOW,
    })
    expect(verdict.state).toBe('tripped')
    expect(verdict.blocked).toBe(true)
  })
})

describe('a tenant with no history', () => {
  it('grades ok rather than being refused', () => {
    // The direction that matters: reading "no record" as a problem would
    // refuse every first campaign on the platform.
    const verdict = emailReputationVerdict({
      counts: { accepted: 0, bounced: 0, complained: 0 },
      now: NOW,
    })
    expect(verdict.state).toBe('ok')
    expect(verdict.blocked).toBe(false)
    expect(verdict.complaintRate).toBe(0)
  })

  it('is total — no input throws', () => {
    expect(() =>
      emailReputationVerdict({ counts: undefined as never, now: NOW }),
    ).not.toThrow()
    expect(
      emailReputationVerdict({
        counts: { accepted: -5, bounced: NaN, complained: '3' } as never,
        now: NOW,
      }).blocked,
    ).toBe(false)
  })
})

describe('the rate arithmetic', () => {
  it('never divides by nothing', () => {
    expect(emailReputationRate(3, 0)).toBe(0)
    expect(emailReputationRate(3, -1)).toBe(0)
  })

  it('reads as a percentage a person can check against a dashboard', () => {
    expect(formatReputationRate(0.003)).toBe('0.30%')
    expect(formatReputationRate(0)).toBe('0%')
  })
})

describe('the new-sender ramp', () => {
  const graduatedPerDay = 12_000

  it('puts a workspace created today on the first step', () => {
    const verdict = emailRampVerdict({
      ageDays: 0,
      deliveredLifetime: 0,
      graduatedPerDay,
    })
    expect(verdict.graduated).toBe(false)
    expect(verdict.perDay).toBe(EMAIL_RAMP_STEPS[0].perDay)
  })

  it('will not let a step be skipped by waiting', () => {
    // Old enough for the second step, but it has delivered nothing, so it has
    // not earned it. A ramp gated on age alone is a ramp you skip by doing
    // nothing for a week.
    const verdict = emailRampVerdict({
      ageDays: EMAIL_RAMP_STEPS[1].minAgeDays,
      deliveredLifetime: 0,
      graduatedPerDay,
    })
    expect(verdict.perDay).toBe(EMAIL_RAMP_STEPS[0].perDay)
  })

  it('moves up when both the days and the volume are there', () => {
    const verdict = emailRampVerdict({
      ageDays: EMAIL_RAMP_STEPS[1].minAgeDays,
      deliveredLifetime: EMAIL_RAMP_STEPS[1].minDelivered,
      graduatedPerDay,
    })
    expect(verdict.perDay).toBe(EMAIL_RAMP_STEPS[1].perDay)
    expect(verdict.step).toBe(1)
  })

  it('graduates at the graduation age', () => {
    expect(
      emailRampVerdict({
        ageDays: EMAIL_RAMP_GRADUATION_DAYS,
        deliveredLifetime: 0,
        graduatedPerDay,
      }),
    ).toMatchObject({ graduated: true, perDay: graduatedPerDay })
    // And not one day early — the ceiling has to hold at its own edge.
    expect(
      emailRampVerdict({
        ageDays: EMAIL_RAMP_GRADUATION_DAYS - 1,
        deliveredLifetime: 0,
        graduatedPerDay,
      }).graduated,
    ).toBe(false)
  })

  it('GRADUATES an unreadable age rather than throttling it', () => {
    // `Number(null)` is 0, which is a finite non-negative number — so the
    // absent case has to be caught as itself. Getting this wrong would ramp
    // every existing paying customer down to the first step on the deploy.
    for (const ageDays of [null, undefined, NaN, -1, 'x' as never]) {
      expect(
        emailRampVerdict({ ageDays, deliveredLifetime: 0, graduatedPerDay })
          .graduated,
      ).toBe(true)
    }
  })

  it('never promises a new workspace more than an established one may send', () => {
    // A platform ramped down during an incident: the graduated day drops
    // below the first ramp step, and the step must drop with it.
    const verdict = emailRampVerdict({
      ageDays: 0,
      deliveredLifetime: 0,
      graduatedPerDay: 50,
    })
    expect(verdict.perDay).toBe(50)
  })

  it('keeps every step inside a graduated day at the shipped ceilings', () => {
    // The relation that ties this control to the other three. A step above
    // the ceiling underneath it would be a number that can never be reached,
    // which is how an operator learns to ignore the numbers.
    const shipped = orgDailyCampaignCeiling(2_000)
    for (const step of EMAIL_RAMP_STEPS) {
      expect(step.perDay).toBeLessThanOrEqual(shipped)
    }
  })

  it('is total — no input throws', () => {
    expect(() =>
      emailRampVerdict({
        ageDays: 2,
        deliveredLifetime: -1,
        graduatedPerDay: 0,
      }),
    ).not.toThrow()
    expect(
      emailRampVerdict({ ageDays: 2, deliveredLifetime: -1, graduatedPerDay: 0 })
        .perDay,
    ).toBeGreaterThan(0)
  })
})

describe('the window keys', () => {
  it('names one key per day, oldest first, ending today', () => {
    const keys = reputationWindowDayKeys(NOW, 3)
    expect(keys).toEqual(['2026-08-28', '2026-08-29', '2026-08-30'])
    expect(keys[keys.length - 1]).toBe(reputationDayKey(NOW))
  })

  it('never returns an empty window', () => {
    expect(reputationWindowDayKeys(NOW, 0)).toHaveLength(7)
    expect(reputationWindowDayKeys(NOW, -3)).toHaveLength(7)
  })

  it('counts whole days between two instants', () => {
    expect(daysBetween(NOW - 86_400_000, NOW)).toBe(1)
    expect(daysBetween(NOW - 86_399_999, NOW)).toBe(0)
    // A future creation date is 0 days old, never negative.
    expect(daysBetween(NOW + 86_400_000, NOW)).toBe(0)
    expect(daysBetween(0, NOW)).toBe(0)
  })
})
