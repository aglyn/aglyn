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
import { calendarRange, formatTime, groupByDay, rangeHolds, rangeTitle, shiftAnchor } from './calendar'

const CHICAGO = 'America/Chicago'
// Wednesday 2026-03-04 15:00 UTC = 9:00 AM in Chicago.
const WEDNESDAY = Date.UTC(2026, 2, 4, 15)

describe('the bookings calendar arithmetic (AGL-3621)', () => {
  it('covers one day from the site’s own midnight', () => {
    const range = calendarRange('day', WEDNESDAY, CHICAGO)
    expect(range.days.map((day) => day.key)).toEqual(['2026-03-04'])
    expect(range.fromMs).toBe(Date.UTC(2026, 2, 4, 6))
    expect(range.toMs).toBe(Date.UTC(2026, 2, 5, 6))
  })

  it('starts a week on Sunday and keeps the day a clock changes as one day', () => {
    // US clocks spring forward on Sunday 2026-03-08.
    const range = calendarRange('week', Date.UTC(2026, 2, 10, 15), CHICAGO)
    expect(range.days.map((day) => day.key)).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
    ])
    const sunday = range.days[0]
    expect(sunday.endMs - sunday.startMs).toBe(23 * 60 * 60_000)
    expect(range.days[1].endMs - range.days[1].startMs).toBe(24 * 60 * 60_000)
  })

  it('lists two weeks in the agenda and steps each view by its own length', () => {
    expect(calendarRange('agenda', WEDNESDAY, CHICAGO).days).toHaveLength(14)
    expect(calendarRange('day', shiftAnchor('day', WEDNESDAY, 1, CHICAGO), CHICAGO).days[0].key).toBe('2026-03-05')
    expect(calendarRange('week', shiftAnchor('week', WEDNESDAY, -1, CHICAGO), CHICAGO).days[0].key).toBe('2026-02-22')
    expect(calendarRange('agenda', shiftAnchor('agenda', WEDNESDAY, 1, CHICAGO), CHICAGO).days[0].key).toBe('2026-03-18')
  })

  it('files each booking under the site’s day, not UTC’s', () => {
    const range = calendarRange('week', WEDNESDAY, CHICAGO)
    // 11 PM Wednesday in Chicago is already Thursday in UTC.
    const late = { id: 'late', startsAtMs: Date.UTC(2026, 2, 5, 5) }
    const early = { id: 'early', startsAtMs: Date.UTC(2026, 2, 4, 14) }
    const grouped = groupByDay([late, early], range)
    expect(grouped.find((entry) => entry.day.key === '2026-03-04')?.rows.map((row) => row.id)).toEqual(['early', 'late'])
    expect(grouped).toHaveLength(7)
  })

  it('names the range and times in the zone, and falls back to UTC for a bad zone', () => {
    const week = calendarRange('week', WEDNESDAY, CHICAGO)
    expect(rangeTitle(week, CHICAGO)).toBe('Sun, Mar 1 – Sat, Mar 7')
    expect(formatTime(WEDNESDAY, CHICAGO)).toBe('9:00 AM')
    expect(calendarRange('day', WEDNESDAY, 'Not/AZone').days[0].key).toBe('2026-03-04')
    expect(rangeHolds(week, WEDNESDAY)).toBe(true)
    expect(rangeHolds(week, week.toMs)).toBe(false)
  })
})
