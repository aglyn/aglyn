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
 * AGL-2662: the month grid the Tasks calendar draws.
 *
 * The assertions are about the two things a calendar can get wrong without
 * looking wrong: which square a due moment lands on, and what happens to
 * the tasks that have no square at all. The suite runs under
 * `America/Chicago` — the repo's jest TZ — which is what makes the
 * daylight-saving case reachable.
 */

import {
  bucketTasksByCalendarDay,
  CALENDAR_WEEK_DAYS,
  CALENDAR_WEEKS,
  shiftCalendarMonth,
  taskCalendarMonth,
} from './task-calendar'

/** Local midnight, spelled the way the grid spells it. */
const localDay = (year: number, month: number, date: number) =>
  new Date(year, month - 1, date).getTime()

describe('the month grid', () => {
  it('always draws six weeks of seven days, starting on a Sunday', () => {
    for (const anchor of [
      localDay(2026, 2, 14),
      localDay(2026, 9, 8),
      localDay(2027, 2, 1),
    ]) {
      const month = taskCalendarMonth(anchor, anchor)
      expect(month.weeks).toHaveLength(CALENDAR_WEEKS)
      for (const week of month.weeks) expect(week).toHaveLength(CALENDAR_WEEK_DAYS)
      expect(new Date(month.weeks[0][0].startMs).getDay()).toBe(0)
    }
  })

  it('marks the month it was asked for, and the margins as outside it', () => {
    const month = taskCalendarMonth(localDay(2026, 9, 8), localDay(2026, 9, 8))
    expect(month.monthStartMs).toBe(localDay(2026, 9, 1))
    expect(month.monthEndMs).toBe(localDay(2026, 10, 1))
    const days = month.weeks.flat()
    const inMonth = days.filter((day) => day.inMonth)
    // September has thirty days, and every one of them is drawn once.
    expect(inMonth).toHaveLength(30)
    expect(inMonth[0].startMs).toBe(localDay(2026, 9, 1))
    expect(days.some((day) => !day.inMonth)).toBe(true)
  })

  /**
   * "Today" is a parameter rather than a reading of the clock, so the
   * square cannot move under the reader between two renders — and so this
   * can be pinned at all.
   */
  it('marks exactly one square as today, and only when it is on the grid', () => {
    const month = taskCalendarMonth(localDay(2026, 9, 8), localDay(2026, 9, 8) + 3_600_000 * 13)
    const today = month.weeks.flat().filter((day) => day.isToday)
    expect(today).toHaveLength(1)
    expect(today[0].date).toBe(8)
    const other = taskCalendarMonth(localDay(2026, 1, 8), localDay(2026, 9, 8))
    expect(other.weeks.flat().some((day) => day.isToday)).toBe(false)
  })

  /**
   * A day a clock change makes 23 hours long is still one day. Built from
   * local components, the square after the spring change starts at local
   * midnight; built by adding 86,400,000 it would start an hour late and
   * every task after it would sit one square early.
   */
  it('keeps local midnight across a daylight-saving change', () => {
    const march = taskCalendarMonth(localDay(2026, 3, 15), localDay(2026, 3, 15))
    const days = march.weeks.flat().filter((day) => day.inMonth)
    for (const day of days) {
      expect(new Date(day.startMs).getHours()).toBe(0)
      expect(new Date(day.endMs).getHours()).toBe(0)
    }
    expect(days.map((day) => day.date)).toEqual(
      Array.from({ length: 31 }, (_, index) => index + 1),
    )
  })

  it('walks months without landing on the 31st of a short one', () => {
    const january = localDay(2026, 1, 31)
    expect(shiftCalendarMonth(january, 1)).toBe(localDay(2026, 2, 1))
    expect(shiftCalendarMonth(localDay(2026, 1, 15), -1)).toBe(localDay(2025, 12, 1))
    expect(shiftCalendarMonth(localDay(2026, 12, 3), 1)).toBe(localDay(2027, 1, 1))
  })
})

describe('placing tasks on the grid', () => {
  const month = taskCalendarMonth(localDay(2026, 9, 8), localDay(2026, 9, 8))
  const task = (id: string, dueAtMs: number | null) => ({ id, dueAtMs })
  const place = (tasks: Array<{ id: string; dueAtMs: number | null }>) =>
    bucketTasksByCalendarDay(tasks, (entry) => entry.dueAtMs, month)

  it('puts a task on the local day it is due, whatever hour that is', () => {
    const buckets = place([
      task('early', localDay(2026, 9, 8) + 60_000),
      task('late', localDay(2026, 9, 8) + 3_600_000 * 23 + 3_540_000),
    ])
    expect(
      buckets.byDay.get(localDay(2026, 9, 8))?.map((entry) => entry.id),
    ).toEqual(['early', 'late'])
    expect(buckets.byDay.get(localDay(2026, 9, 9))).toEqual([])
  })

  /**
   * A calendar cannot place a task with no due date, and dropping it would
   * make the grid disagree with the list beside it about how many tasks
   * there are.
   */
  it('sets aside the tasks it cannot place rather than dropping them', () => {
    const buckets = place([
      task('undated', null),
      task('zero', 0),
      task('far', localDay(2027, 5, 1)),
      task('placed', localDay(2026, 9, 20)),
    ])
    expect(buckets.undated.map((entry) => entry.id)).toEqual(['undated', 'zero'])
    expect(buckets.elsewhere.map((entry) => entry.id)).toEqual(['far'])
    expect(buckets.byDay.get(localDay(2026, 9, 20))?.map((e) => e.id)).toEqual([
      'placed',
    ])
  })

  /**
   * The margin days are drawn, so they hold tasks: a task due on the last
   * day of August is on the grid a reader looking at September sees.
   */
  it('places a task on a margin day the grid draws', () => {
    const buckets = place([task('margin', localDay(2026, 8, 31) + 3_600_000)])
    expect(buckets.elsewhere).toEqual([])
    expect(
      buckets.byDay.get(localDay(2026, 8, 31))?.map((entry) => entry.id),
    ).toEqual(['margin'])
  })

  it('gives every square a bucket, so an empty day is empty rather than absent', () => {
    const buckets = place([])
    expect(buckets.byDay.size).toBe(CALENDAR_WEEKS * CALENDAR_WEEK_DAYS)
    for (const bucket of buckets.byDay.values()) expect(bucket).toEqual([])
  })
})
