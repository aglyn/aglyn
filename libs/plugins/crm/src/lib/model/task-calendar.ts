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
 * The month grid the Tasks calendar draws, and the arithmetic behind it
 * (AGL-2662).
 *
 * ## Local days, because that is the day a person is asked about
 *
 * Every boundary here is built with the `Date` constructor's LOCAL
 * components rather than by adding 86,400,000 to a timestamp. The two
 * disagree twice a year: a day that a clock change makes 23 or 25 hours long
 * is still one day to the person reading it, and a grid built from fixed-
 * width offsets puts one task on the wrong square every spring. It is the
 * same reasoning `localDayBounds` records for the Tasks tiles, which decide
 * "overdue" and "due today" the same way — so a task the tile calls overdue
 * cannot sit on today's square.
 *
 * ## Six weeks, always
 *
 * The grid is a fixed 6×7 whatever the month, so the surface does not
 * change height as the reader pages through it. A February that starts on a
 * Sunday fills five rows and the sixth is entirely next month's; drawing it
 * anyway is what keeps the columns from jumping.
 */

/** How many day columns a week has. Named so the grid and the math agree. */
export const CALENDAR_WEEK_DAYS = 7

/** How many week rows the grid always draws — see the note above. */
export const CALENDAR_WEEKS = 6

/** Column headings, starting on Sunday. */
export const CALENDAR_DAY_LABELS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const

/** One square of the grid. */
export interface TaskCalendarDay {
  /** Local midnight at the start of this day — the bucket key. */
  startMs: number
  /** Local midnight of the NEXT day, so a range test is `[startMs, endMs)`. */
  endMs: number
  /** The number drawn in the corner. */
  date: number
  /** This day belongs to the month being shown, rather than its margins. */
  inMonth: boolean
  /** This is the reader's own today. */
  isToday: boolean
}

/** One month, as the grid needs it. */
export interface TaskCalendarMonth {
  /** Local midnight on the first of the month. */
  monthStartMs: number
  /** Local midnight on the first of the NEXT month. */
  monthEndMs: number
  /** `Date` for the month being shown, so a caller can label it its own way. */
  monthDate: Date
  /** Six rows of seven days, the first row starting on a Sunday. */
  weeks: TaskCalendarDay[][]
}

/** Local midnight on the day `value` falls in. */
function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

/**
 * The month `anchorMs` falls in, as six weeks of local days.
 *
 * `nowMs` is passed rather than read from the clock so the grid is a pure
 * function of its inputs: a component that re-rendered at midnight would
 * otherwise move "today" under the reader without a state change, and a
 * test could not pin the square.
 */
export function taskCalendarMonth(
  anchorMs: number,
  nowMs: number,
): TaskCalendarMonth {
  const anchor = new Date(anchorMs)
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
  const todayMs = startOfDay(new Date(nowMs)).getTime()
  // Back up to the Sunday on or before the first: `getDay()` is 0 on Sunday,
  // so the offset is the day index itself.
  const gridStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth(),
    monthStart.getDate() - monthStart.getDay(),
  )
  const weeks: TaskCalendarDay[][] = []
  for (let week = 0; week < CALENDAR_WEEKS; week += 1) {
    const row: TaskCalendarDay[] = []
    for (let day = 0; day < CALENDAR_WEEK_DAYS; day += 1) {
      const at = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + week * CALENDAR_WEEK_DAYS + day,
      )
      const next = new Date(
        at.getFullYear(),
        at.getMonth(),
        at.getDate() + 1,
      )
      const startMs = at.getTime()
      row.push({
        startMs,
        endMs: next.getTime(),
        date: at.getDate(),
        inMonth: at.getMonth() === monthStart.getMonth(),
        isToday: startMs === todayMs,
      })
    }
    weeks.push(row)
  }
  return {
    monthStartMs: monthStart.getTime(),
    monthEndMs: monthEnd.getTime(),
    monthDate: monthStart,
    weeks,
  }
}

/** The same month, `delta` months later — negative for earlier. */
export function shiftCalendarMonth(anchorMs: number, delta: number): number {
  const anchor = new Date(anchorMs)
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1).getTime()
}

/** What a month's grid holds, and what it could not place. */
export interface TaskCalendarBuckets<T> {
  /** Tasks per day, keyed by the day's `startMs`; ordered as handed in. */
  byDay: Map<number, T[]>
  /** Tasks with no due date — a calendar cannot place them, and says so. */
  undated: T[]
  /**
   * Tasks due outside the drawn grid.
   *
   * Counted rather than dropped silently: the calendar is drawn over the
   * SAME window the list holds, so a reader paging to a quiet month must
   * not read an empty grid as "nothing is due" when the window's tasks are
   * simply somewhere else.
   */
  elsewhere: T[]
}

/**
 * Place a window of tasks on a month's grid by their due dates.
 *
 * Keyed on the grid's own day bounds rather than by formatting a date into
 * a string: a bucket key that is a rendered date is a bucket key that
 * depends on the locale, and two tasks an hour apart could land in two
 * buckets under one reader and one under another.
 *
 * The margin days a six-week grid always carries — the tail of the previous
 * month and the head of the next — hold tasks like any other square, which
 * is why they are drawn at all.
 */
export function bucketTasksByCalendarDay<T>(
  tasks: readonly T[],
  dueAtMs: (task: T) => number | null | undefined,
  month: TaskCalendarMonth,
): TaskCalendarBuckets<T> {
  const byDay = new Map<number, T[]>()
  const days = month.weeks.flat()
  for (const day of days) byDay.set(day.startMs, [])
  const gridStart = days[0]?.startMs ?? month.monthStartMs
  const gridEnd = days[days.length - 1]?.endMs ?? month.monthEndMs
  const undated: T[] = []
  const elsewhere: T[] = []
  for (const task of tasks) {
    const due = Number(dueAtMs(task))
    if (!Number.isFinite(due) || !due) {
      undated.push(task)
      continue
    }
    if (due < gridStart || due >= gridEnd) {
      elsewhere.push(task)
      continue
    }
    // Local midnight of the due moment IS the bucket key, because every
    // square was built from local midnight too.
    const key = startOfDay(new Date(due)).getTime()
    const bucket = byDay.get(key)
    if (bucket) bucket.push(task)
    else elsewhere.push(task)
  }
  return { byDay, undated, elsewhere }
}
