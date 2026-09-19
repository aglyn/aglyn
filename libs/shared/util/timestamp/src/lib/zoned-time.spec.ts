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
  addZonedBusinessDays,
  isValidTimeZone,
  isWithinWeeklySchedule,
  MINUTES_PER_DAY,
  nextWeeklyOpening,
  startOfNextZonedDay,
  startOfZonedDay,
  zonedCalendarDaysBetween,
  zonedDateTime,
  zonedDayKey,
  zonedMinuteOfDay,
  zoneOffsetMs,
  zonedWallTimeToInstant,
} from './zoned-time'

const HOUR = 60 * 60 * 1000
const at = (iso: string) => Date.parse(iso)
const iso = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? ms : new Date(ms).toISOString()

const CHICAGO = 'America/Chicago'
const BERLIN = 'Europe/Berlin'

/*
 * The 2026 clock changes these tests stand on:
 *  - Chicago springs forward 2026-03-08 at 02:00 CST (08:00Z) and falls back
 *    2026-11-01 at 02:00 CDT (07:00Z).
 *  - Berlin springs forward 2026-03-29 at 01:00Z and falls back 2026-10-25
 *    at 01:00Z.
 *  - Lord Howe Island moves by thirty minutes, springing forward 2026-10-04
 *    at 02:00 local.
 *  - Santiago springs forward at midnight: 2026-09-06 has no 00:00.
 */

describe('zonedDateTime', () => {
  it('reads the wall clock in the zone, not in UTC or the machine zone', () => {
    // 03:00Z on a Monday is still Sunday evening in Chicago.
    expect(zonedDateTime(at('2026-09-14T03:00:00.000Z'), CHICAGO)).toEqual({
      year: 2026,
      month: 9,
      day: 13,
      hour: 22,
      minute: 0,
      second: 0,
      weekday: 0,
    })
    expect(zonedDateTime(at('2026-09-14T03:00:00.000Z'), 'Asia/Tokyo')).toMatchObject({
      day: 14,
      hour: 12,
      weekday: 1,
    })
  })

  it('reads midnight as hour 0', () => {
    expect(zonedDateTime(at('2026-09-14T05:00:00.000Z'), CHICAGO)).toMatchObject({
      day: 14,
      hour: 0,
      minute: 0,
    })
  })

  it('throws for a zone Intl does not know', () => {
    expect(() => zonedDateTime(0, 'Mars/Olympus_Mons')).toThrow(RangeError)
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA names Intl knows and refuses everything else', () => {
    expect(isValidTimeZone(CHICAGO)).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(null)).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
  })
})

describe('zonedDayKey and zonedMinuteOfDay', () => {
  it('keys the local calendar day', () => {
    expect(zonedDayKey(at('2026-09-14T04:59:59.000Z'), CHICAGO)).toBe('2026-09-13')
    expect(zonedDayKey(at('2026-09-14T05:00:00.000Z'), CHICAGO)).toBe('2026-09-14')
  })

  it('counts wall-clock minutes, so a window keeps its clock time across a change', () => {
    expect(zonedMinuteOfDay(at('2026-09-14T14:30:00.000Z'), CHICAGO)).toBe(9 * 60 + 30)
    // 09:30 after the spring change is still minute 570, not 510 elapsed.
    expect(zonedMinuteOfDay(at('2026-03-08T14:30:00.000Z'), CHICAGO)).toBe(9 * 60 + 30)
  })
})

describe('zoneOffsetMs', () => {
  it('follows daylight saving time in both hemispheres of the calendar', () => {
    expect(zoneOffsetMs(at('2026-07-01T12:00:00.000Z'), CHICAGO)).toBe(-5 * HOUR)
    expect(zoneOffsetMs(at('2026-12-01T12:00:00.000Z'), CHICAGO)).toBe(-6 * HOUR)
    expect(zoneOffsetMs(at('2026-07-01T12:00:00.000Z'), BERLIN)).toBe(2 * HOUR)
  })

  it('handles offsets that are not whole hours', () => {
    expect(zoneOffsetMs(at('2026-07-01T12:00:00.000Z'), 'Asia/Kolkata')).toBe(5.5 * HOUR)
    expect(zoneOffsetMs(at('2026-07-01T12:00:00.000Z'), 'Asia/Kathmandu')).toBe(5.75 * HOUR)
  })
})

describe('zonedWallTimeToInstant', () => {
  it('finds an ordinary wall time', () => {
    expect(
      iso(zonedWallTimeToInstant({ year: 2026, month: 9, day: 14, hour: 9 }, CHICAGO)),
    ).toBe('2026-09-14T14:00:00.000Z')
  })

  it('normalizes overflowed fields the way Date.UTC does', () => {
    expect(
      iso(zonedWallTimeToInstant({ year: 2026, month: 12, day: 32, hour: 9 }, CHICAGO)),
    ).toBe('2027-01-01T15:00:00.000Z')
    expect(
      iso(zonedWallTimeToInstant({ year: 2026, month: 13, day: 1 }, 'UTC')),
    ).toBe('2027-01-01T00:00:00.000Z')
  })

  it('moves a time the spring gap skips forward by the gap', () => {
    // 02:30 does not happen in Chicago on 2026-03-08; the clock reads 03:30.
    const chicago = zonedWallTimeToInstant(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
      CHICAGO,
    )
    expect(iso(chicago)).toBe('2026-03-08T08:30:00.000Z')
    expect(zonedDateTime(chicago, CHICAGO)).toMatchObject({ hour: 3, minute: 30 })
    // East of Greenwich too.
    expect(
      iso(zonedWallTimeToInstant({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, BERLIN)),
    ).toBe('2026-03-29T01:30:00.000Z')
  })

  it('takes the EARLIER of the two instants a fall-back hour happens at', () => {
    expect(
      iso(zonedWallTimeToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, CHICAGO)),
    ).toBe('2026-11-01T06:30:00.000Z')
    expect(
      iso(zonedWallTimeToInstant({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, BERLIN)),
    ).toBe('2026-10-25T00:30:00.000Z')
  })

  it('handles a thirty-minute change', () => {
    // Lord Howe skips 02:00–02:30 on 2026-10-04: 02:15 reads 02:45.
    const landed = zonedWallTimeToInstant(
      { year: 2026, month: 10, day: 4, hour: 2, minute: 15 },
      'Australia/Lord_Howe',
    )
    expect(zonedDateTime(landed, 'Australia/Lord_Howe')).toMatchObject({ hour: 2, minute: 45 })
  })

  it('round-trips every hour of both change days', () => {
    for (const day of [
      { year: 2026, month: 3, day: 8 },
      { year: 2026, month: 11, day: 1 },
    ]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const landed = zonedWallTimeToInstant({ ...day, hour, minute: 15 }, CHICAGO)
        const read = zonedDateTime(landed, CHICAGO)
        if (day.month === 3 && hour === 2) {
          expect(read.hour).toBe(3)
        } else {
          expect(read).toMatchObject({ ...day, hour, minute: 15 })
        }
      }
    }
  })
})

describe('startOfZonedDay and startOfNextZonedDay', () => {
  it('draws the day an instant falls in', () => {
    const now = at('2026-09-05T13:00:00.000Z')
    expect(iso(startOfZonedDay(now, CHICAGO))).toBe('2026-09-05T05:00:00.000Z')
    expect(iso(startOfNextZonedDay(now, CHICAGO))).toBe('2026-09-06T05:00:00.000Z')
  })

  it('measures a 25-hour and a 23-hour day as they are lived', () => {
    const autumn = at('2026-11-01T13:00:00.000Z')
    expect(startOfNextZonedDay(autumn, CHICAGO) - startOfZonedDay(autumn, CHICAGO)).toBe(25 * HOUR)
    const spring = at('2026-03-08T13:00:00.000Z')
    expect(startOfNextZonedDay(spring, CHICAGO) - startOfZonedDay(spring, CHICAGO)).toBe(23 * HOUR)
  })

  it('starts a day that has no midnight at its first instant', () => {
    const start = startOfZonedDay(at('2026-09-06T12:00:00.000Z'), 'America/Santiago')
    expect(zonedDateTime(start, 'America/Santiago')).toMatchObject({ day: 6, hour: 1, minute: 0 })
  })
})

describe('zonedCalendarDaysBetween', () => {
  it('counts calendar days, not 24-hour spans', () => {
    // Late Saturday evening to early Sunday morning is one calendar day.
    expect(
      zonedCalendarDaysBetween(at('2026-09-13T04:00:00.000Z'), at('2026-09-13T06:00:00.000Z'), CHICAGO),
    ).toBe(1)
    // Across the 23-hour day.
    expect(
      zonedCalendarDaysBetween(at('2026-03-07T18:00:00.000Z'), at('2026-03-09T17:00:00.000Z'), CHICAGO),
    ).toBe(2)
    expect(
      zonedCalendarDaysBetween(at('2026-12-31T18:00:00.000Z'), at('2027-01-01T18:00:00.000Z'), CHICAGO),
    ).toBe(1)
  })

  it('is negative when the second instant is on an earlier day', () => {
    expect(
      zonedCalendarDaysBetween(at('2026-09-14T18:00:00.000Z'), at('2026-09-12T18:00:00.000Z'), CHICAGO),
    ).toBe(-2)
  })
})

describe('addZonedBusinessDays', () => {
  // Tuesday 2026-09-15 10:07:30.250 CDT.
  const tuesday = at('2026-09-15T15:07:30.250Z')

  it('keeps the wall-clock time and the millisecond', () => {
    expect(iso(addZonedBusinessDays(tuesday, 1, CHICAGO))).toBe('2026-09-16T15:07:30.250Z')
    expect(iso(addZonedBusinessDays(tuesday, 3, CHICAGO))).toBe('2026-09-18T15:07:30.250Z')
  })

  it('skips the weekend', () => {
    // Tuesday + 4 business days is Monday.
    expect(iso(addZonedBusinessDays(tuesday, 4, CHICAGO))).toBe('2026-09-21T15:07:30.250Z')
    // Saturday + 1 is Monday; Sunday + 1 is Monday.
    expect(iso(addZonedBusinessDays(at('2026-09-19T15:00:00.000Z'), 1, CHICAGO))).toBe(
      '2026-09-21T15:00:00.000Z',
    )
    expect(iso(addZonedBusinessDays(at('2026-09-20T15:00:00.000Z'), 1, CHICAGO))).toBe(
      '2026-09-21T15:00:00.000Z',
    )
  })

  it('reads the weekday in the zone, not in UTC', () => {
    // 02:00Z Saturday is Friday 21:00 in Chicago, so +1 is Monday 21:00.
    expect(iso(addZonedBusinessDays(at('2026-09-19T02:00:00.000Z'), 1, CHICAGO))).toBe(
      '2026-09-22T02:00:00.000Z',
    )
  })

  it('returns the instant itself for zero', () => {
    expect(addZonedBusinessDays(at('2026-09-19T15:00:00.000Z'), 0, CHICAGO)).toBe(
      at('2026-09-19T15:00:00.000Z'),
    )
  })

  it('keeps 10:00 at 10:00 across the spring change', () => {
    // Friday 10:00 CST → Monday 10:00 CDT, an hour less of UTC offset.
    expect(iso(addZonedBusinessDays(at('2026-03-06T16:00:00.000Z'), 1, CHICAGO))).toBe(
      '2026-03-09T15:00:00.000Z',
    )
    // And back across the autumn change.
    expect(iso(addZonedBusinessDays(at('2026-10-30T15:00:00.000Z'), 1, CHICAGO))).toBe(
      '2026-11-02T16:00:00.000Z',
    )
  })

  it('counts only the business days it is given', () => {
    // A Sunday-to-Thursday week: Thursday + 1 is Sunday.
    expect(
      iso(addZonedBusinessDays(at('2026-09-17T09:00:00.000Z'), 1, 'Asia/Jerusalem', [0, 1, 2, 3, 4])),
    ).toBe('2026-09-20T09:00:00.000Z')
  })

  it('refuses a count that is not a whole, non-negative number', () => {
    expect(() => addZonedBusinessDays(tuesday, -1, CHICAGO)).toThrow(RangeError)
    expect(() => addZonedBusinessDays(tuesday, 1.5, CHICAGO)).toThrow(RangeError)
    expect(() => addZonedBusinessDays(tuesday, 1, CHICAGO, [])).toThrow(RangeError)
  })
})

describe('weekly schedules', () => {
  // Weekdays 09:00–17:00.
  const officeHours = {
    1: [{ start: 9 * 60, end: 17 * 60 }],
    2: [{ start: 9 * 60, end: 17 * 60 }],
    3: [{ start: 9 * 60, end: 17 * 60 }],
    4: [{ start: 9 * 60, end: 17 * 60 }],
    5: [{ start: 9 * 60, end: 17 * 60 }],
  }

  it('returns the stretch an instant is inside', () => {
    const inside = at('2026-09-14T15:30:00.000Z') // Monday 10:30 CDT
    expect(nextWeeklyOpening(inside, officeHours, CHICAGO)).toEqual({
      startMs: at('2026-09-14T14:00:00.000Z'),
      endMs: at('2026-09-14T22:00:00.000Z'),
    })
    expect(isWithinWeeklySchedule(inside, officeHours, CHICAGO)).toBe(true)
  })

  it('treats the start as open and the end as closed', () => {
    expect(isWithinWeeklySchedule(at('2026-09-14T14:00:00.000Z'), officeHours, CHICAGO)).toBe(true)
    expect(isWithinWeeklySchedule(at('2026-09-14T22:00:00.000Z'), officeHours, CHICAGO)).toBe(false)
  })

  it('finds the next opening before, after and across a weekend', () => {
    // Sunday night → Monday 09:00.
    expect(iso(nextWeeklyOpening(at('2026-09-14T03:00:00.000Z'), officeHours, CHICAGO)?.startMs)).toBe(
      '2026-09-14T14:00:00.000Z',
    )
    // Monday after close → Tuesday 09:00.
    expect(iso(nextWeeklyOpening(at('2026-09-14T23:00:00.000Z'), officeHours, CHICAGO)?.startMs)).toBe(
      '2026-09-15T14:00:00.000Z',
    )
    // Friday after close → Monday 09:00.
    expect(iso(nextWeeklyOpening(at('2026-09-18T23:00:00.000Z'), officeHours, CHICAGO)?.startMs)).toBe(
      '2026-09-21T14:00:00.000Z',
    )
  })

  it('walks several stretches in one day in order', () => {
    const split = { 1: [{ start: 14 * 60, end: 16 * 60 }, { start: 9 * 60, end: 12 * 60 }] }
    // Monday 12:30 CDT: the morning stretch is over, the afternoon one is next.
    expect(iso(nextWeeklyOpening(at('2026-09-14T17:30:00.000Z'), split, CHICAGO)?.startMs)).toBe(
      '2026-09-14T19:00:00.000Z',
    )
  })

  it('runs a stretch ending at 1440 to the next midnight', () => {
    const evening = { 1: [{ start: 20 * 60, end: MINUTES_PER_DAY }] }
    expect(nextWeeklyOpening(at('2026-09-15T04:30:00.000Z'), evening, CHICAGO)).toEqual({
      startMs: at('2026-09-15T01:00:00.000Z'),
      endMs: at('2026-09-15T05:00:00.000Z'),
    })
  })

  it('opens at the wall-clock hour on the day the clocks change', () => {
    const sundays = { 0: [{ start: 9 * 60, end: 17 * 60 }] }
    // Sunday 2026-03-08 09:00 is CDT: 14:00Z, not 15:00Z.
    expect(iso(nextWeeklyOpening(at('2026-03-08T06:00:00.000Z'), sundays, CHICAGO)?.startMs)).toBe(
      '2026-03-08T14:00:00.000Z',
    )
    // A stretch that starts in the spring gap moves forward with the clock…
    const inGap = { 0: [{ start: 2 * 60, end: 2 * 60 + 30 }] }
    expect(nextWeeklyOpening(at('2026-03-08T06:00:00.000Z'), inGap, CHICAGO)).toEqual({
      startMs: at('2026-03-08T08:00:00.000Z'),
      endMs: at('2026-03-08T08:30:00.000Z'),
    })
    // …and one that comes out empty does not open that day: 02:30 reads as
    // 03:30 CDT, after its own 03:00 end.
    const emptied = { 0: [{ start: 2 * 60 + 30, end: 3 * 60 }] }
    expect(iso(nextWeeklyOpening(at('2026-03-08T06:00:00.000Z'), emptied, CHICAGO)?.startMs)).toBe(
      '2026-03-15T07:30:00.000Z',
    )
  })

  it('covers both passes of a repeated hour when a stretch spans it', () => {
    const lateNight = { 0: [{ start: 60, end: 120 }] }
    // 01:00 CDT (06:00Z) until 02:00 CST (08:00Z): two hours on the clock's
    // longest night, so the second 01:30 (07:30Z) is inside too.
    expect(nextWeeklyOpening(at('2026-11-01T05:30:00.000Z'), lateNight, CHICAGO)).toEqual({
      startMs: at('2026-11-01T06:00:00.000Z'),
      endMs: at('2026-11-01T08:00:00.000Z'),
    })
    expect(isWithinWeeklySchedule(at('2026-11-01T07:30:00.000Z'), lateNight, CHICAGO)).toBe(true)
  })

  it('never opens for an empty or malformed schedule', () => {
    expect(nextWeeklyOpening(at('2026-09-14T15:30:00.000Z'), {}, CHICAGO)).toBeNull()
    expect(
      nextWeeklyOpening(
        at('2026-09-14T15:30:00.000Z'),
        { 1: [{ start: 600, end: 600 }, { start: -5, end: 60 }, { start: 60, end: 1500 }] },
        CHICAGO,
      ),
    ).toBeNull()
    expect(isWithinWeeklySchedule(at('2026-09-14T15:30:00.000Z'), {}, CHICAGO)).toBe(false)
  })
})
