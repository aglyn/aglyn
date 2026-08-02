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
  addBusinessDays,
  describeResponseWindow,
  ladderIsMonotonic,
  responseDueAt,
  SUPPORT_BY_PLAN,
  supportForPlan,
  supportTierRank,
} from './support-tiers'

/** 2026-08-03T09:00:00Z. Asserted to be a Monday below, not assumed. */
const MONDAY = Date.UTC(2026, 7, 3, 9, 0, 0)
const FRIDAY = Date.UTC(2026, 7, 7, 9, 0, 0)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('the fixtures are the days this file claims', () => {
  // Every weekend assertion below is meaningless if these drift.
  it('MONDAY is a Monday and FRIDAY is a Friday', () => {
    expect(new Date(MONDAY).getUTCDay()).toBe(1)
    expect(new Date(FRIDAY).getUTCDay()).toBe(5)
  })
})

describe('supportForPlan', () => {
  it('gives every plan a commitment', () => {
    for (const plan of Object.keys(SUPPORT_BY_PLAN)) {
      expect(supportForPlan(plan as never).tier).toBeTruthy()
    }
  })

  it('fails CLOSED for an unknown or missing plan', () => {
    // The dangerous direction is handing an unpaid or unrecognised org a
    // response target we never agreed to.
    for (const plan of [undefined, null, '', 'legacy-gold' as never]) {
      const commitment = supportForPlan(plan as never)
      expect(commitment.tier).toBe('community')
      expect(commitment.firstResponse).toBeNull()
    }
  })

  it('commits to nothing on free, and to a named human only on enterprise', () => {
    expect(supportForPlan('free').firstResponse).toBeNull()
    const named = Object.entries(SUPPORT_BY_PLAN)
      .filter(([, commitment]) => commitment.namedManager)
      .map(([plan]) => plan)
    expect(named).toEqual(['enterprise'])
  })
})

describe('describeResponseWindow', () => {
  it('renders a range, a single value and the empty case', () => {
    expect(describeResponseWindow(null)).toBeNull()
    expect(
      describeResponseWindow({ min: 7, max: 14, unit: 'business-days' }),
    ).toBe('7–14 business days')
    expect(
      describeResponseWindow({ min: 24, max: 48, unit: 'hours' }),
    ).toBe('24–48 hours')
    expect(
      describeResponseWindow({ min: 1, max: 1, unit: 'business-days' }),
    ).toBe('1 business day')
  })
})

describe('addBusinessDays', () => {
  it('walks forward one weekday at a time', () => {
    expect(addBusinessDays(MONDAY, 1)).toBe(MONDAY + DAY)
    expect(addBusinessDays(MONDAY, 4)).toBe(MONDAY + 4 * DAY)
  })

  it('steps over the weekend rather than through it', () => {
    // Friday + 1 business day is Monday — 3 calendar days later. Getting this
    // wrong makes every deadline land on a day nobody is working.
    const due = addBusinessDays(FRIDAY, 1)
    expect(new Date(due).getUTCDay()).toBe(1)
    expect(due).toBe(FRIDAY + 3 * DAY)
  })

  it('never lands on a Saturday or Sunday, over a full quarter', () => {
    for (let days = 1; days <= 65; days++) {
      const day = new Date(addBusinessDays(MONDAY, days)).getUTCDay()
      expect(`${days}: ${day}`).not.toBe(`${days}: 0`)
      expect(`${days}: ${day}`).not.toBe(`${days}: 6`)
    }
  })
})

describe('responseDueAt', () => {
  it('is null when nothing is owed', () => {
    expect(responseDueAt(supportForPlan('free'), MONDAY)).toBeNull()
  })

  it('commits to the WORST case, not the best', () => {
    // The range is what we advertise; the upper bound is what a breach is
    // measured against. Using `min` here would make us late by design.
    expect(responseDueAt(supportForPlan('starter'), MONDAY)).toBe(
      addBusinessDays(MONDAY, 14),
    )
    expect(responseDueAt(supportForPlan('agency'), MONDAY)).toBe(
      addBusinessDays(MONDAY, 3),
    )
  })

  it('measures enterprise in CLOCK hours, so a weekend does not pause it', () => {
    // The distinction that makes the tier worth paying for: opened Friday
    // morning, an answer is still owed by Sunday.
    const due = responseDueAt(supportForPlan('enterprise'), FRIDAY)
    expect(due).toBe(FRIDAY + 48 * HOUR)
    expect(new Date(due as number).getUTCDay()).toBe(0)
  })
})

describe('the ladder gets better as plans get stronger (AGL-1103)', () => {
  it('is monotonic', () => {
    expect(ladderIsMonotonic(MONDAY)).toBe(true)
  })

  it('would INVERT if enterprise were quoted in business hours', () => {
    // The trap this guards. "24–48 business hours" reads as a stronger promise
    // than "1–3 business days" and is a weaker one: at 8h per business day it
    // is 3–6 business days, so Enterprise would wait longer than Agency while
    // every number still looked reasonable on its own. Kept as an executable
    // note so nobody re-reads the unit and "fixes" it.
    const enterpriseAsClockHours = responseDueAt(
      supportForPlan('enterprise'),
      MONDAY,
    ) as number
    const enterpriseAsBusinessHours = addBusinessDays(MONDAY, 48 / 8)
    const agency = responseDueAt(supportForPlan('agency'), MONDAY) as number

    expect(enterpriseAsClockHours).toBeLessThan(agency)
    expect(enterpriseAsBusinessHours).toBeGreaterThan(agency)
  })

  it('ranks tiers weakest to strongest', () => {
    expect(supportTierRank('community')).toBeLessThan(supportTierRank('standard'))
    expect(supportTierRank('standard')).toBeLessThan(supportTierRank('business'))
    expect(supportTierRank('business')).toBeLessThan(supportTierRank('priority'))
    expect(supportTierRank('priority')).toBeLessThan(supportTierRank('dedicated'))
  })

  it('quotes the same window for every plan sharing a tier', () => {
    // starter/pro, and business/scale/advanced, are each one tier. A drift
    // between them is a promise that depends on which plan page you read.
    const byTier = new Map<string, string>()
    for (const commitment of Object.values(SUPPORT_BY_PLAN)) {
      const described = describeResponseWindow(commitment.firstResponse) ?? 'none'
      const seen = byTier.get(commitment.tier)
      if (seen === undefined) byTier.set(commitment.tier, described)
      else expect(`${commitment.tier}: ${described}`).toBe(`${commitment.tier}: ${seen}`)
    }
  })
})
