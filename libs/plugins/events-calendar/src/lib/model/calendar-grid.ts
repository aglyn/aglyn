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
 * CALENDAR DAYS AS THE CALENDAR ELEMENT LAYS THEM OUT (AGL-4252).
 *
 * Days are `YYYY-MM-DD` keys on the SITE's clock, never instants, so a month
 * grid has the same days for a visitor in Tokyo as for one at the track; the
 * door turns a key into an instant in the site's zone. Weeks start on
 * Sunday. Pure.
 */

export type CalendarView = 'month' | 'week' | 'list'
export const CALENDAR_VIEWS: readonly CalendarView[] = ['month', 'week', 'list']

const parse = (dayKey: string): [number, number, number] => {
  const [year, month, day] = dayKey.split('-').map(Number)
  return [year, month, day]
}

const keyOfDate = (date: Date): string =>
  `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

/** The day `count` days after `dayKey` (negative for before). */
export function addDays(dayKey: string, count: number): string {
  const [year, month, day] = parse(dayKey)
  return keyOfDate(new Date(Date.UTC(year, month - 1, day + count)))
}

/** 0 Sunday through 6 Saturday. */
export function weekdayOf(dayKey: string): number {
  const [year, month, day] = parse(dayKey)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** The first of `dayKey`'s month, `months` months on. */
export function startOfMonth(dayKey: string, months = 0): string {
  const [year, month] = parse(dayKey)
  return keyOfDate(new Date(Date.UTC(year, month - 1 + months, 1)))
}

/** The Sunday that starts `dayKey`'s week. */
export function startOfWeek(dayKey: string): string {
  return addDays(dayKey, -weekdayOf(dayKey))
}

/** The seven days of `dayKey`'s week. */
export function weekDays(dayKey: string): string[] {
  const first = startOfWeek(dayKey)
  return Array.from({ length: 7 }, (_, index) => addDays(first, index))
}

/**
 * The days a month grid shows: whole weeks from the Sunday on or before the
 * first through the Saturday on or after the last, five or six rows.
 */
export function monthGridDays(dayKey: string): string[] {
  const first = startOfMonth(dayKey)
  const last = addDays(startOfMonth(dayKey, 1), -1)
  const start = startOfWeek(first)
  const end = addDays(last, 6 - weekdayOf(last))
  const days: string[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day)
  return days
}

/** The days a view reads, as `[from, toExclusive)` keys. */
export function viewRange(
  view: CalendarView,
  anchor: string,
  listDays = 60,
): { from: string; to: string } {
  if (view === 'month') {
    const days = monthGridDays(anchor)
    return { from: days[0], to: addDays(days[days.length - 1], 1) }
  }
  if (view === 'week') {
    const first = startOfWeek(anchor)
    return { from: first, to: addDays(first, 7) }
  }
  return {
    from: anchor,
    to: addDays(anchor, Math.max(1, Math.min(listDays, 366))),
  }
}

/** Where the previous / next button moves the anchor in a view. */
export function stepAnchor(
  view: CalendarView,
  anchor: string,
  direction: 1 | -1,
  listDays = 60,
): string {
  if (view === 'month') return startOfMonth(anchor, direction)
  if (view === 'week') return addDays(startOfWeek(anchor), 7 * direction)
  return addDays(anchor, Math.max(1, Math.min(listDays, 366)) * direction)
}

/** A day key as a UTC-noon `Date`, for formatting its calendar fields in UTC. */
export function dayKeyDate(dayKey: string): Date {
  const [year, month, day] = parse(dayKey)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

/** "November 2026", "Nov 1 – 7, 2026", "Nov 26 – Jan 24". */
export function viewTitle(
  view: CalendarView,
  anchor: string,
  listDays = 60,
): string {
  const format = (dayKey: string, options: Intl.DateTimeFormatOptions) =>
    dayKeyDate(dayKey).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      ...options,
    })
  if (view === 'month')
    return format(anchor, { month: 'long', year: 'numeric' })
  const { from, to } = viewRange(view, anchor, listDays)
  const last = addDays(to, -1)
  return `${format(from, { month: 'short', day: 'numeric' })} – ${format(last, { month: 'short', day: 'numeric', year: 'numeric' })}`
}
