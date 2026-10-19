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
 * SITE CARE ARITHMETIC (AGL-3959). Every figure asserted here is a published
 * one: 60 included minutes a month, counted per request in 15-minute blocks
 * rounded up, and $79 per STARTED hour past them, never below the approved
 * hours. A change to any of these numbers must fail a case below before it
 * reaches an invoice.
 */

import {
  SITE_CARE_EXTRA_HOUR_USD,
  SITE_CARE_INCLUDED_BLOCK_MINUTES,
  SITE_CARE_INCLUDED_MINUTES,
} from './plan-entitlements'
import {
  SITE_CARE_EXTRA_TIME_TAX_CODE,
  SITE_CARE_LINE_DESCRIPTION_MAX,
  SITE_CARE_MAX_REQUEST_MINUTES,
  allocateSiteCareMinutes,
  closeMinutesFromTimer,
  countedSiteCareMinutes,
  formatSiteCareMinutes,
  formatSiteCareUsd,
  isSiteCareMonthKey,
  isSiteCarePublishAction,
  previousSiteCareMonthKey,
  readSiteCareMinutes,
  siteCareChargeWords,
  siteCareCloseVerdict,
  siteCareExtraTimeCents,
  siteCareExtraTimeDescription,
  siteCareIncludedPool,
  siteCareMonthKey,
  siteCareMonthLabel,
  siteCareMonthSentence,
  siteCareMonthStatement,
  siteCareOrgMonth,
  siteCarePublishSentence,
  siteCareStatementRequest,
  type SiteCareStatementRequest,
} from './site-care'

const MINUTE = 60_000

describe('the published figures', () => {
  it('are the decided ones', () => {
    expect(SITE_CARE_INCLUDED_MINUTES).toBe(60)
    expect(SITE_CARE_INCLUDED_BLOCK_MINUTES).toBe(15)
    expect(SITE_CARE_EXTRA_HOUR_USD).toBe(79)
    expect(SITE_CARE_EXTRA_TIME_TAX_CODE).toBe('txcd_10103001')
  })
})

describe('months', () => {
  it('draws the month in Chicago, not UTC', () => {
    // 03:00Z on Nov 1 is still Oct 31 in Chicago.
    expect(siteCareMonthKey(Date.UTC(2026, 10, 1, 3, 0))).toBe('2026-10')
    expect(siteCareMonthKey(Date.UTC(2026, 10, 1, 7, 0))).toBe('2026-11')
  })

  it('reads and steps month keys', () => {
    expect(isSiteCareMonthKey('2026-10')).toBe(true)
    expect(isSiteCareMonthKey('2026-13')).toBe(false)
    expect(isSiteCareMonthKey('2026-1')).toBe(false)
    expect(isSiteCareMonthKey(202610)).toBe(false)
    expect(previousSiteCareMonthKey('2026-10')).toBe('2026-09')
    expect(previousSiteCareMonthKey('2026-01')).toBe('2025-12')
    expect(siteCareMonthLabel('2026-10')).toBe('October 2026')
    expect(siteCareMonthLabel('nope')).toBe('nope')
    expect(siteCareOrgMonth('org-1', '2026-10')).toBe('org-1_2026-10')
  })
})

describe('formatting', () => {
  it('writes minutes and dollars the way the owner reads them', () => {
    expect(formatSiteCareMinutes(45)).toBe('45 min')
    expect(formatSiteCareMinutes(60)).toBe('1 h')
    expect(formatSiteCareMinutes(75)).toBe('1 h 15 min')
    expect(formatSiteCareMinutes(-5)).toBe('0 min')
    expect(formatSiteCareUsd(7_900)).toBe('$79')
    expect(formatSiteCareUsd(7_950)).toBe('$79.50')
  })
})

describe('the close number', () => {
  it('rounds the timer up to the next five minutes, never below five', () => {
    const start = Date.UTC(2026, 9, 19, 15, 0)
    expect(closeMinutesFromTimer(null, start)).toBe(5)
    expect(closeMinutesFromTimer(start, start)).toBe(5)
    expect(closeMinutesFromTimer(start, start + 1 * MINUTE)).toBe(5)
    expect(closeMinutesFromTimer(start, start + 7 * MINUTE)).toBe(10)
    expect(closeMinutesFromTimer(start, start + 10 * MINUTE)).toBe(10)
    expect(closeMinutesFromTimer(start, start + 1_000 * 60 * MINUTE)).toBe(SITE_CARE_MAX_REQUEST_MINUTES)
  })

  it('accepts only whole minutes in range', () => {
    expect(readSiteCareMinutes(30)).toBe(30)
    expect(readSiteCareMinutes('30')).toBe(30)
    expect(readSiteCareMinutes(0)).toBeNull()
    expect(readSiteCareMinutes(1.5)).toBeNull()
    expect(readSiteCareMinutes(SITE_CARE_MAX_REQUEST_MINUTES + 1)).toBeNull()
    expect(readSiteCareMinutes('')).toBeNull()
    expect(readSiteCareMinutes(null)).toBeNull()
  })
})

describe('counting against the included hour', () => {
  it('counts each request in 15-minute blocks, rounded up', () => {
    expect(countedSiteCareMinutes(0)).toBe(0)
    expect(countedSiteCareMinutes(1)).toBe(15)
    expect(countedSiteCareMinutes(10)).toBe(15)
    expect(countedSiteCareMinutes(15)).toBe(15)
    expect(countedSiteCareMinutes(16)).toBe(30)
  })

  it('adds goodwill to the pool and never rolls over', () => {
    expect(siteCareIncludedPool(0)).toBe(60)
    expect(siteCareIncludedPool(30)).toBe(90)
    expect(siteCareIncludedPool(-10)).toBe(60)
  })

  it('allocates against what the month OTHER requests left', () => {
    expect(allocateSiteCareMinutes({ minutes: 10, otherIncludedUsed: 0, goodwillMinutes: 0 })).toEqual({
      countedMinutes: 15,
      includedMinutesUsed: 15,
      overMinutes: 0,
      requiredHours: 0,
      remainingBefore: 60,
    })
    expect(allocateSiteCareMinutes({ minutes: 50, otherIncludedUsed: 30, goodwillMinutes: 0 })).toEqual({
      countedMinutes: 60,
      includedMinutesUsed: 30,
      overMinutes: 30,
      requiredHours: 1,
      remainingBefore: 30,
    })
    // 61 minutes past a used-up pool is two STARTED hours.
    expect(
      allocateSiteCareMinutes({ minutes: 61, otherIncludedUsed: 60, goodwillMinutes: 0 }).requiredHours,
    ).toBe(2)
    // Goodwill makes room.
    expect(
      allocateSiteCareMinutes({ minutes: 30, otherIncludedUsed: 60, goodwillMinutes: 30 }).overMinutes,
    ).toBe(0)
  })
})

describe('the close verdict', () => {
  it('bills nothing inside the hour', () => {
    expect(siteCareCloseVerdict({ requiredHours: 0, approval: null, absorb: false })).toEqual({
      ok: true,
      billedHours: 0,
      absorbed: false,
    })
  })

  it('blocks extra time with no approval on file', () => {
    expect(siteCareCloseVerdict({ requiredHours: 1, approval: null, absorb: false })).toEqual({
      ok: false,
      reason: 'no-approval',
      requiredHours: 1,
      approvedHours: null,
    })
  })

  it('blocks when the work outran the approval', () => {
    expect(siteCareCloseVerdict({ requiredHours: 3, approval: { hours: 2 }, absorb: false })).toEqual({
      ok: false,
      reason: 'approval-exceeded',
      requiredHours: 3,
      approvedHours: 2,
    })
  })

  it('absorbs with no charge when asked', () => {
    expect(siteCareCloseVerdict({ requiredHours: 2, approval: null, absorb: true })).toEqual({
      ok: true,
      billedHours: 0,
      absorbed: true,
    })
  })

  it('bills the approved hours as the floor', () => {
    expect(siteCareCloseVerdict({ requiredHours: 1, approval: { hours: 2 }, absorb: false })).toEqual({
      ok: true,
      billedHours: 2,
      absorbed: false,
    })
    expect(siteCareCloseVerdict({ requiredHours: 2, approval: { hours: 2 }, absorb: false })).toEqual({
      ok: true,
      billedHours: 2,
      absorbed: false,
    })
  })

  it('prices whole hours only', () => {
    expect(siteCareExtraTimeCents(1)).toBe(7_900)
    expect(siteCareExtraTimeCents(2)).toBe(15_800)
    expect(siteCareExtraTimeCents(1.9)).toBe(7_900)
    expect(siteCareExtraTimeCents(-1)).toBe(0)
  })
})

function closed(over: Partial<SiteCareStatementRequest>): SiteCareStatementRequest {
  return {
    requestId: 'r',
    title: 'A change',
    state: 'closed',
    closedAtMs: 1,
    minutesLogged: 10,
    countedMinutes: 15,
    includedMinutesUsed: 15,
    overMinutes: 0,
    billedHours: 0,
    absorbed: false,
    chargeStatus: null,
    chargeCents: 0,
    ...over,
  }
}

describe('the month statement', () => {
  const statement = siteCareMonthStatement({
    month: '2026-10',
    goodwillMinutes: 15,
    requests: [
      closed({ requestId: 'a', minutesLogged: 40, countedMinutes: 45, includedMinutesUsed: 45 }),
      closed({
        requestId: 'b',
        minutesLogged: 70,
        countedMinutes: 75,
        includedMinutesUsed: 30,
        overMinutes: 45,
        billedHours: 1,
        chargeStatus: 'pending',
        chargeCents: 7_900,
      }),
      closed({
        requestId: 'c',
        minutesLogged: 65,
        countedMinutes: 75,
        includedMinutesUsed: 0,
        overMinutes: 75,
        billedHours: 2,
        chargeStatus: 'credited',
        chargeCents: 15_800,
      }),
      closed({ requestId: 'd', state: 'open', minutesLogged: null, includedMinutesUsed: 0, countedMinutes: 0 }),
    ],
  })

  it('sums closed requests and keeps open ones out of the minutes', () => {
    expect(statement).toEqual({
      month: '2026-10',
      monthLabel: 'October 2026',
      includedMinutes: 60,
      goodwillMinutes: 15,
      poolMinutes: 75,
      requests: 4,
      openRequests: 1,
      minutesLogged: 175,
      countedMinutes: 195,
      includedMinutesUsed: 75,
      minutesLeft: 0,
      extraHoursBilled: 1,
      extraBilledCents: 7_900,
      extraReversedCents: 15_800,
    })
  })

  it('says the month in one line', () => {
    expect(siteCareMonthSentence(statement)).toBe(
      'October 2026: 4 requests, 2 h 55 min of work, 75 of 75 included minutes used, 1 hour of extra time billed.',
    )
  })

  it('reads a stored request defensively', () => {
    expect(siteCareStatementRequest('x', 'T', null)).toEqual(
      expect.objectContaining({ requestId: 'x', state: 'open', chargeStatus: null, chargeCents: 0 }),
    )
    expect(
      siteCareStatementRequest('x', 'T', {
        state: 'closed',
        charge: {
          status: 'pending',
          hours: 1,
          amountCents: 7_900,
          description: '',
          idempotencyKey: 'k',
          invoiceItemId: 'ii_1',
          invoiceId: null,
          creditNoteId: null,
          refundId: null,
          error: null,
          updatedAtMs: 0,
        },
      }),
    ).toEqual(expect.objectContaining({ state: 'closed', chargeStatus: 'pending', chargeCents: 7_900 }))
  })
})

describe('the invoice line', () => {
  const statement = siteCareMonthStatement({ month: '2026-10', goodwillMinutes: 0, requests: [] })

  it('names the request, the minutes, the hours and the rate', () => {
    const line = siteCareExtraTimeDescription({
      title: 'New hours on the contact page',
      minutesLogged: 95,
      overMinutes: 35,
      billedHours: 2,
      approvedHours: 2,
      statement,
    })
    expect(line).toContain('“New hours on the contact page”')
    expect(line).toContain('1 h 35 min of work')
    expect(line).toContain('35 min past the included hour')
    expect(line).toContain('billed as 2 hours (the 2 hours you approved) at $79/hour')
  })

  it('omits the approval note when the work needed the hours anyway', () => {
    const line = siteCareExtraTimeDescription({
      title: 'T',
      minutesLogged: 120,
      overMinutes: 60,
      billedHours: 1,
      approvedHours: 1,
      statement,
    })
    expect(line).not.toContain('you approved')
  })

  it('stays inside its length', () => {
    const line = siteCareExtraTimeDescription({
      title: 'x'.repeat(400),
      minutesLogged: 120,
      overMinutes: 60,
      billedHours: 1,
      approvedHours: 1,
      statement: { ...statement, monthLabel: 'y'.repeat(500) },
    })
    expect(line.length).toBeLessThanOrEqual(SITE_CARE_LINE_DESCRIPTION_MAX)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('charge words and publish links', () => {
  it('tells the owner where each charge stands', () => {
    expect(siteCareChargeWords('pending')).toBe('On your next invoice')
    expect(siteCareChargeWords('creating')).toBe('On your next invoice')
    expect(siteCareChargeWords('failed')).toBe('Not billed')
    expect(siteCareChargeWords('voided')).toBe('Removed, not billed')
    expect(siteCareChargeWords('credited')).toBe('Credited back')
    expect(siteCareChargeWords('refunded')).toBe('Refunded')
    expect(siteCareChargeWords(null)).toBe('Included')
  })

  it('links only publishes, including the Besigner screen publish', () => {
    expect(isSiteCarePublishAction('Published the screen')).toBe(true)
    expect(isSiteCarePublishAction('Published version')).toBe(true)
    expect(isSiteCarePublishAction('Saved the screen')).toBe(false)
    expect(isSiteCarePublishAction('Unpublished the screen')).toBe(false)
    expect(isSiteCarePublishAction(undefined)).toBe(false)
  })

  it('says the publish as a sentence', () => {
    const publish = {
      hostId: 'h',
      activityId: 'a',
      action: 'Published the screen',
      targetName: 'Home',
      targetId: 's',
      atMs: 0,
    }
    expect(siteCarePublishSentence(publish, () => 'Oct 19')).toBe('Published the screen “Home” on Oct 19')
    expect(siteCarePublishSentence(null, () => 'Oct 19')).toBeNull()
  })
})
