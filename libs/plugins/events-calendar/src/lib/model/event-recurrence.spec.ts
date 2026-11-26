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

import { zonedWallTimeToInstant } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  EVENT_SERIES_OPEN_END_MS,
  eventRecurrenceOf,
  eventRecurrenceText,
  eventSeriesEndsAtMs,
  expandEventOccurrences,
  isEventDayKey,
} from './event-recurrence'

const ZONE = 'America/Chicago'
const HOUR = 60 * 60 * 1000
/** Thursday 2026-11-05, 6 PM in Chicago (before the clocks change? no: after, CST). */
const at = (day: string, hour = 18, minute = 0) => {
  const [year, month, d] = day.split('-').map(Number)
  return zonedWallTimeToInstant({ year, month, day: d, hour, minute }, ZONE)
}

describe('eventRecurrenceOf', () => {
  it('reads nothing that is not a rule', () => {
    expect(eventRecurrenceOf(null)).toBeNull()
    expect(eventRecurrenceOf({ freq: 'yearly' })).toBeNull()
    expect(eventRecurrenceOf('weekly')).toBeNull()
  })

  it('folds a typed rule to the stored form', () => {
    expect(
      eventRecurrenceOf({
        freq: 'Weekly',
        interval: '2',
        weekdays: [4, 4, 6, 9],
        count: 10,
        exceptDayKeys: ['2026-12-24', 'bad', '2026-02-30'],
      }),
    ).toEqual({
      freq: 'weekly',
      interval: 2,
      weekdays: [4, 6],
      count: 10,
      exceptDayKeys: ['2026-12-24'],
    })
  })

  it('keeps an until over a count, and drops weekdays on a daily rule', () => {
    expect(
      eventRecurrenceOf({
        freq: 'daily',
        weekdays: [1],
        untilDayKey: '2027-01-31',
        count: 3,
      }),
    ).toEqual({
      freq: 'daily',
      untilDayKey: '2027-01-31',
    })
  })

  it('checks day keys are real days', () => {
    expect(isEventDayKey('2028-02-29')).toBe(true)
    expect(isEventDayKey('2027-02-29')).toBe(false)
    expect(isEventDayKey('2027-13-01')).toBe(false)
  })
})

describe('expandEventOccurrences', () => {
  it('answers a one-off event when it overlaps the range', () => {
    const start = at('2026-11-12')
    const event = {
      startsAtMs: start,
      endsAtMs: start + 2 * HOUR,
      timeZone: ZONE,
    }
    expect(
      expandEventOccurrences(event, {
        fromMs: start - HOUR,
        toMs: start + HOUR,
      }),
    ).toEqual([
      { startsAtMs: start, endsAtMs: start + 2 * HOUR, dayKey: '2026-11-12' },
    ])
    expect(
      expandEventOccurrences(event, {
        fromMs: start + 3 * HOUR,
        toMs: start + 9 * HOUR,
      }),
    ).toEqual([])
  })

  it('keeps a weekly practice at 6 PM on the wall clock across the clock change', () => {
    // Thursday Oct 29 (CDT) through Thursday Nov 12 (CST); clocks fall back Nov 1.
    const start = at('2026-10-29')
    const dates = expandEventOccurrences(
      {
        startsAtMs: start,
        endsAtMs: start + 3 * HOUR,
        timeZone: ZONE,
        recurrence: { freq: 'weekly' },
      },
      { fromMs: start, toMs: at('2026-11-13') },
    )
    expect(dates.map((date) => date.dayKey)).toEqual([
      '2026-10-29',
      '2026-11-05',
      '2026-11-12',
    ])
    expect(dates[1].startsAtMs).toBe(at('2026-11-05'))
    // The UTC hour moved by one; the local hour did not.
    expect(dates[1].startsAtMs - dates[0].startsAtMs).toBe(7 * 24 * HOUR + HOUR)
    expect(
      dates.every((date) => date.endsAtMs - date.startsAtMs === 3 * HOUR),
    ).toBe(true)
  })

  it('walks several weekdays, every other week, skipping the days named', () => {
    // Saturday 2026-11-07; weekends every other week.
    const start = at('2026-11-07', 10)
    const dates = expandEventOccurrences(
      {
        startsAtMs: start,
        endsAtMs: start + HOUR,
        timeZone: ZONE,
        recurrence: {
          freq: 'weekly',
          interval: 2,
          weekdays: [0, 6],
          exceptDayKeys: ['2026-11-21'],
        },
      },
      { fromMs: start, toMs: at('2026-12-07', 0) },
    )
    // Weeks start on Sunday. Sunday 11/01 is before the start, so the first
    // week has only Saturday; the next is the week of 11/15 (its Saturday
    // skipped), then the week of 11/29.
    expect(dates.map((date) => date.dayKey)).toEqual([
      '2026-11-07',
      '2026-11-15',
      '2026-11-29',
      '2026-12-05',
    ])
  })

  it('finds a series that started long before the range', () => {
    const start = at('2025-01-02')
    const dates = expandEventOccurrences(
      {
        startsAtMs: start,
        endsAtMs: start + HOUR,
        timeZone: ZONE,
        recurrence: { freq: 'weekly' },
      },
      { fromMs: at('2026-11-01', 0), toMs: at('2026-11-15', 0) },
    )
    expect(dates.map((date) => date.dayKey)).toEqual([
      '2026-11-05',
      '2026-11-12',
    ])
  })

  it('stops at the count and at the until day', () => {
    const start = at('2026-11-02')
    const counted = expandEventOccurrences(
      {
        startsAtMs: start,
        endsAtMs: start,
        timeZone: ZONE,
        recurrence: { freq: 'daily', count: 3, exceptDayKeys: ['2026-11-03'] },
      },
      { fromMs: 0, toMs: at('2027-01-01') },
    )
    // The skipped day counts toward the three, as in iCalendar.
    expect(counted.map((date) => date.dayKey)).toEqual([
      '2026-11-02',
      '2026-11-04',
    ])
    const until = expandEventOccurrences(
      {
        startsAtMs: start,
        endsAtMs: start,
        timeZone: ZONE,
        recurrence: { freq: 'daily', interval: 3, untilDayKey: '2026-11-08' },
      },
      { fromMs: 0, toMs: at('2027-01-01') },
    )
    expect(until.map((date) => date.dayKey)).toEqual([
      '2026-11-02',
      '2026-11-05',
      '2026-11-08',
    ])
  })

  it('repeats monthly on the day of the month, skipping months without it', () => {
    const start = at('2027-01-31', 9)
    const dates = expandEventOccurrences(
      {
        startsAtMs: start,
        endsAtMs: start,
        timeZone: ZONE,
        recurrence: { freq: 'monthly' },
      },
      { fromMs: 0, toMs: at('2027-06-01', 0) },
    )
    expect(dates.map((date) => date.dayKey)).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
    ])
  })

  it('honors the limit', () => {
    const start = at('2026-11-02')
    expect(
      expandEventOccurrences(
        {
          startsAtMs: start,
          endsAtMs: start,
          timeZone: ZONE,
          recurrence: { freq: 'daily' },
        },
        { fromMs: 0, toMs: at('2027-11-02'), limit: 5 },
      ),
    ).toHaveLength(5)
  })
})

describe('eventSeriesEndsAtMs', () => {
  it('is the event end for a one-off, open for an endless series, the last end otherwise', () => {
    const start = at('2026-11-05')
    expect(
      eventSeriesEndsAtMs({ startsAtMs: start, endsAtMs: start + HOUR }),
    ).toBe(start + HOUR)
    expect(
      eventSeriesEndsAtMs({
        startsAtMs: start,
        endsAtMs: start + HOUR,
        timeZone: ZONE,
        recurrence: { freq: 'weekly' },
      }),
    ).toBe(EVENT_SERIES_OPEN_END_MS)
    expect(
      eventSeriesEndsAtMs({
        startsAtMs: start,
        endsAtMs: start + HOUR,
        timeZone: ZONE,
        recurrence: { freq: 'weekly', count: 3 },
      }),
    ).toBe(at('2026-11-19') + HOUR)
  })
})

describe('eventRecurrenceText', () => {
  it('reads as a visitor says it', () => {
    expect(eventRecurrenceText({ freq: 'weekly' }, 4)).toBe(
      'Every week on Thursday',
    )
    expect(
      eventRecurrenceText({ freq: 'weekly', weekdays: [0, 6], interval: 2 }),
    ).toBe('Every 2 weeks on Sunday and Saturday')
    expect(eventRecurrenceText({ freq: 'daily', count: 5 })).toBe(
      'Every day, 5 times',
    )
    expect(
      eventRecurrenceText({ freq: 'monthly', untilDayKey: '2027-03-01' }),
    ).toBe('Every month, until Mar 1, 2027')
    expect(eventRecurrenceText(null)).toBe('')
  })
})
