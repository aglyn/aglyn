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
 *
 * @jest-environment node
 */

import { zonedDateTime } from '@aglyn/shared-util-timestamp/zoned-time'
import type { OutreachSendWindow } from '../model/outreach.types'
import {
  effectiveOutreachWindow,
  isOutreachWindowOpen,
  OUTREACH_AUTO_REPLY_POSTPONE_BUSINESS_DAYS,
  outreachWindowSchedule,
  postponeOutreachForAutoReply,
  scheduleOutreachDue,
} from './schedule'

const CHICAGO = 'America/Chicago'
const MINUTE = 60_000
const at = (iso: string) => Date.parse(iso)
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

/** Weekdays 09:00–17:00. */
const OFFICE: OutreachSendWindow = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 }

const exact = (fromIso: string, delayBusinessDays: number, window = OFFICE, timeZone = CHICAGO) =>
  iso(
    scheduleOutreachDue({
      fromMs: at(fromIso),
      delayBusinessDays,
      timeZone,
      window,
      random: () => 0.5,
      jitterMinutes: 0,
    }),
  )

/** A seeded generator, so the property checks below are the same run every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('the send window', () => {
  it('becomes a weekly schedule of one stretch per sending day', () => {
    expect(outreachWindowSchedule(OFFICE)).toEqual({
      1: [{ start: 540, end: 1020 }],
      2: [{ start: 540, end: 1020 }],
      3: [{ start: 540, end: 1020 }],
      4: [{ start: 540, end: 1020 }],
      5: [{ start: 540, end: 1020 }],
    })
    expect(outreachWindowSchedule(null)).toEqual({})
    expect(outreachWindowSchedule({ days: [9, -1, 2.5], startMinute: 0, endMinute: 60 })).toEqual({})
  })

  it("is the sequence's own when it has one, else the mailbox's", () => {
    const sequenceWindow = { days: [2, 4], startMinute: 600, endMinute: 720 }
    expect(effectiveOutreachWindow(sequenceWindow, OFFICE)).toBe(sequenceWindow)
    expect(effectiveOutreachWindow(null, OFFICE)).toBe(OFFICE)
    expect(effectiveOutreachWindow(undefined, undefined)).toBeNull()
  })

  it("is read in the mailbox's zone", () => {
    // Monday 2026-09-14 10:00 CDT.
    expect(isOutreachWindowOpen(at('2026-09-14T15:00:00Z'), OFFICE, CHICAGO)).toBe(true)
    // The same instant is 16:00 in New York and still open; 08:00 in Los Angeles and not.
    expect(isOutreachWindowOpen(at('2026-09-14T15:00:00Z'), OFFICE, 'America/New_York')).toBe(true)
    expect(isOutreachWindowOpen(at('2026-09-14T15:00:00Z'), OFFICE, 'America/Los_Angeles')).toBe(false)
    // Saturday.
    expect(isOutreachWindowOpen(at('2026-09-19T15:00:00Z'), OFFICE, CHICAGO)).toBe(false)
    expect(isOutreachWindowOpen(at('2026-09-14T15:00:00Z'), OFFICE, 'Nowhere/Special')).toBe(false)
  })
})

describe('scheduleOutreachDue: business days in the mailbox zone', () => {
  it('waits whole business days at the same clock time', () => {
    // Tuesday 10:00 CDT + 2 → Thursday 10:00.
    expect(exact('2026-09-15T15:00:00Z', 2)).toBe('2026-09-17T15:00:00.000Z')
  })

  it('skips the weekend', () => {
    // Friday 16:30 + 1 → Monday 16:30.
    expect(exact('2026-09-18T21:30:00Z', 1)).toBe('2026-09-21T21:30:00.000Z')
    // Friday + 3 → Wednesday.
    expect(exact('2026-09-18T15:00:00Z', 3)).toBe('2026-09-23T15:00:00.000Z')
  })

  it('counts the calendar the mailbox lives on, not UTC', () => {
    // 01:00Z Saturday is Friday 20:00 in Chicago: +1 business day is Monday,
    // after hours, so it waits for Tuesday's opening.
    expect(exact('2026-09-19T01:00:00Z', 1)).toBe('2026-09-22T14:00:00.000Z')
  })

  it('waits for the opening when the day lands outside the window', () => {
    // Wednesday 18:00 + 1 → Thursday 18:00, closed → Friday 09:00.
    expect(exact('2026-09-16T23:00:00Z', 1)).toBe('2026-09-18T14:00:00.000Z')
    // Thursday 07:30 + 0 → the same day's 09:00.
    expect(exact('2026-09-17T12:30:00Z', 0)).toBe('2026-09-17T14:00:00.000Z')
    // Enrolled on a Saturday with no wait → Monday 09:00.
    expect(exact('2026-09-19T16:00:00Z', 0)).toBe('2026-09-21T14:00:00.000Z')
  })

  it('keeps 10:00 at 10:00 across the spring change', () => {
    // Friday 2026-03-06 10:00 CST (16:00Z) + 1 → Monday 03-09 10:00 CDT (15:00Z).
    expect(exact('2026-03-06T16:00:00Z', 1)).toBe('2026-03-09T15:00:00.000Z')
  })

  it('keeps 10:00 at 10:00 across the autumn change', () => {
    // Friday 2026-10-30 10:00 CDT (15:00Z) + 1 → Monday 11-02 10:00 CST (16:00Z).
    expect(exact('2026-10-30T15:00:00Z', 1)).toBe('2026-11-02T16:00:00.000Z')
  })

  it('opens at the wall-clock hour on the day the clocks change', () => {
    const sundays = { days: [0], startMinute: 9 * 60, endMinute: 17 * 60 }
    // Saturday 2026-03-07 12:00 CST, no wait → Sunday 03-08 09:00 CDT.
    expect(exact('2026-03-07T18:00:00Z', 0, sundays)).toBe('2026-03-08T14:00:00.000Z')
    // And on the autumn Sunday, 09:00 CST.
    expect(exact('2026-10-31T17:00:00Z', 0, sundays)).toBe('2026-11-01T15:00:00.000Z')
  })

  it('works in zones with no daylight saving and with half-hour offsets', () => {
    // Monday 2026-09-14 18:00 in Kolkata (12:30Z) + 1 → Tuesday 18:00, closed → Wednesday 09:00 IST.
    expect(exact('2026-09-14T12:30:00Z', 1, OFFICE, 'Asia/Kolkata')).toBe('2026-09-16T03:30:00.000Z')
    expect(exact('2026-09-14T01:00:00Z', 1, OFFICE, 'Asia/Tokyo')).toBe('2026-09-15T01:00:00.000Z')
  })

  it('answers null for what can never be placed', () => {
    const base = { fromMs: at('2026-09-15T15:00:00Z'), delayBusinessDays: 1, timeZone: CHICAGO, window: OFFICE, random: () => 0.5 }
    expect(scheduleOutreachDue({ ...base, timeZone: 'Nowhere/Special' })).toBeNull()
    expect(scheduleOutreachDue({ ...base, window: { days: [], startMinute: 540, endMinute: 1020 } })).toBeNull()
    expect(scheduleOutreachDue({ ...base, window: null })).toBeNull()
    expect(scheduleOutreachDue({ ...base, delayBusinessDays: -1 })).toBeNull()
    expect(scheduleOutreachDue({ ...base, delayBusinessDays: 1.5 })).toBeNull()
    expect(scheduleOutreachDue({ ...base, fromMs: Number.NaN })).toBeNull()
  })
})

describe('scheduleOutreachDue: jitter', () => {
  const tuesdayTen = at('2026-09-15T15:00:00Z')
  const due = (fromMs: number, random: () => number, window = OFFICE, delayBusinessDays = 0) =>
    scheduleOutreachDue({ fromMs, delayBusinessDays, timeZone: CHICAGO, window, random })

  it('moves a time inside the window by up to half an hour either way', () => {
    expect(iso(due(tuesdayTen, () => 0))).toBe('2026-09-15T14:30:00.000Z')
    expect(iso(due(tuesdayTen, () => 0.5))).toBe('2026-09-15T15:00:00.000Z')
    expect(due(tuesdayTen, () => 0.999999)).toBeLessThanOrEqual(tuesdayTen + 30 * MINUTE)
    expect(due(tuesdayTen, () => 0.999999)).toBeGreaterThan(tuesdayTen + 29 * MINUTE)
  })

  it('never moves a time out of its window', () => {
    // 09:10 cannot move to 08:40; 16:50 cannot move to 17:20.
    expect(iso(due(at('2026-09-15T14:10:00Z'), () => 0))).toBe('2026-09-15T14:00:00.000Z')
    expect(iso(due(at('2026-09-15T21:50:00Z'), () => 0.999999))).toBe('2026-09-15T21:59:59.999Z')
  })

  it('spreads a time moved to an opening over the hour after it, never before', () => {
    const evening = at('2026-09-15T23:00:00Z') // Tuesday 18:00
    expect(iso(due(evening, () => 0))).toBe('2026-09-16T14:00:00.000Z')
    expect(iso(due(evening, () => 0.5))).toBe('2026-09-16T14:30:00.000Z')
    expect(due(evening, () => 0.999999)).toBeLessThan(at('2026-09-16T15:00:00Z'))
  })

  it('fits a window shorter than the jitter', () => {
    const short = { days: [3], startMinute: 9 * 60, endMinute: 9 * 60 + 20 }
    const landed = due(at('2026-09-15T23:00:00Z'), () => 0.999999, short)
    expect(landed).toBeGreaterThanOrEqual(at('2026-09-16T14:00:00Z'))
    expect(landed).toBeLessThan(at('2026-09-16T14:20:00Z'))
  })

  it('treats a random source that misbehaves as the middle of its range', () => {
    expect(due(tuesdayTen, () => Number.NaN)).toBe(tuesdayTen)
    expect(due(tuesdayTen, () => 7)).toBeLessThanOrEqual(tuesdayTen + 30 * MINUTE)
    expect(due(tuesdayTen, () => -3)).toBe(tuesdayTen - 30 * MINUTE)
  })

  it('lands every draw inside the window, across weeks and both clock changes', () => {
    const random = seeded(2979)
    const starts = [
      at('2026-03-05T12:00:00Z'),
      at('2026-09-14T03:17:00Z'),
      at('2026-10-29T21:59:00Z'),
      at('2026-12-31T23:30:00Z'),
    ]
    for (const start of starts) {
      for (let step = 0; step < 60; step += 1) {
        const fromMs = start + step * 97 * MINUTE
        const delay = step % 6
        const landed = scheduleOutreachDue({
          fromMs,
          delayBusinessDays: delay,
          timeZone: CHICAGO,
          window: OFFICE,
          random,
        })
        expect(landed).not.toBeNull()
        expect(isOutreachWindowOpen(landed as number, OFFICE, CHICAGO)).toBe(true)
        const { weekday } = zonedDateTime(landed as number, CHICAGO)
        expect(weekday).toBeGreaterThanOrEqual(1)
        expect(weekday).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('postponeOutreachForAutoReply', () => {
  const window = OFFICE
  const base = { timeZone: CHICAGO, window, random: () => 0.5 }
  // An out-of-office arrives Monday 2026-09-14 10:00 CDT.
  const receivedAtMs = at('2026-09-14T15:00:00Z')

  it(`holds the next step back ${OUTREACH_AUTO_REPLY_POSTPONE_BUSINESS_DAYS} business days from the reply`, () => {
    const nextDueAtMs = at('2026-09-15T15:00:00Z')
    expect(iso(postponeOutreachForAutoReply({ ...base, nextDueAtMs, receivedAtMs }))).toBe(
      '2026-09-21T15:00:00.000Z',
    )
  })

  it('never brings a step forward', () => {
    const later = at('2026-10-01T15:00:00Z')
    expect(postponeOutreachForAutoReply({ ...base, nextDueAtMs: later, receivedAtMs })).toBe(later)
  })

  it('leaves an enrollment with nothing waiting as it is', () => {
    expect(postponeOutreachForAutoReply({ ...base, nextDueAtMs: null, receivedAtMs })).toBeNull()
  })

  it('keeps the current due time when a postponement cannot be placed', () => {
    const nextDueAtMs = at('2026-09-15T15:00:00Z')
    expect(
      postponeOutreachForAutoReply({ ...base, timeZone: 'Nowhere/Special', nextDueAtMs, receivedAtMs }),
    ).toBe(nextDueAtMs)
  })

  it('takes a different length when asked', () => {
    const nextDueAtMs = at('2026-09-15T15:00:00Z')
    expect(
      iso(postponeOutreachForAutoReply({ ...base, nextDueAtMs, receivedAtMs, businessDays: 2 })),
    ).toBe('2026-09-16T15:00:00.000Z')
  })
})
