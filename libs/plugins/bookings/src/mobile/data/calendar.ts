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
import { isValidTimeZone, zonedDateTime, zonedWallTimeToInstant } from '@aglyn/shared-util-timestamp/zoned-time'

/*
 * The bookings calendar's arithmetic (AGL-3621): which instants a day, a
 * week or the agenda covers, in the SITE's time zone. A calendar day is
 * walked on the calendar and never by adding 24 hours, so the day a clock
 * changes is 23 or 25 hours long and still one day. Pure; the screens and
 * the specs share it.
 */

export type CalendarView = 'day' | 'week' | 'agenda'

export const CALENDAR_VIEWS: ReadonlyArray<{ id: CalendarView; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'agenda', label: 'Agenda' },
]

/** How many days the agenda lists from its first day. */
export const AGENDA_DAYS = 14

export interface CalendarDay {
  /** `YYYY-MM-DD` in the zone. */
  key: string
  startMs: number
  endMs: number
}

export interface CalendarRange {
  view: CalendarView
  fromMs: number
  toMs: number
  days: CalendarDay[]
}

const pad = (value: number) => String(value).padStart(2, '0')

const zoneOf = (timeZone: string) => (isValidTimeZone(timeZone) ? timeZone : 'UTC')

/** Midnight starting the calendar day `offset` days after the one `atMs` falls in. */
function dayStart(atMs: number, offset: number, timeZone: string): number {
  const { year, month, day } = zonedDateTime(atMs, timeZone)
  return zonedWallTimeToInstant({ year, month, day: day + offset }, timeZone)
}

function dayOf(startMs: number, timeZone: string): CalendarDay {
  const { year, month, day } = zonedDateTime(startMs, timeZone)
  return { key: `${year}-${pad(month)}-${pad(day)}`, startMs, endMs: dayStart(startMs, 1, timeZone) }
}

/** The instants a view covers around `anchorMs`. A week starts on Sunday, as the console's calendars do. */
export function calendarRange(view: CalendarView, anchorMs: number, timeZone: string): CalendarRange {
  const zone = zoneOf(timeZone)
  const first =
    view === 'week' ? dayStart(anchorMs, -zonedDateTime(anchorMs, zone).weekday, zone) : dayStart(anchorMs, 0, zone)
  const count = view === 'day' ? 1 : view === 'week' ? 7 : AGENDA_DAYS
  const days: CalendarDay[] = []
  let start = first
  for (let index = 0; index < count; index += 1) {
    const day = dayOf(start, zone)
    days.push(day)
    start = day.endMs
  }
  return { view, fromMs: first, toMs: start, days }
}

/** The anchor one view-length earlier (`-1`) or later (`1`). */
export function shiftAnchor(view: CalendarView, anchorMs: number, direction: -1 | 1, timeZone: string): number {
  const step = view === 'day' ? 1 : view === 'week' ? 7 : AGENDA_DAYS
  return dayStart(anchorMs, step * direction, zoneOf(timeZone))
}

/** The rows that fall on each day, in start order; an empty day is kept so the week shows it. */
export function groupByDay<T extends { startsAtMs: number }>(
  rows: readonly T[],
  range: CalendarRange,
): Array<{ day: CalendarDay; rows: T[] }> {
  const sorted = [...rows].sort((a, b) => a.startsAtMs - b.startsAtMs)
  return range.days.map((day) => ({
    day,
    rows: sorted.filter((row) => row.startsAtMs >= day.startMs && row.startsAtMs < day.endMs),
  }))
}

/** "Mon, Jun 1" in the zone. */
export function formatDay(atMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOf(timeZone),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(atMs))
}

/** "9:30 AM" in the zone. */
export function formatTime(atMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(timeZone), hour: 'numeric', minute: '2-digit' }).format(
    new Date(atMs),
  )
}

/** The header over a view: one day, or the first and last of the range. */
export function rangeTitle(range: CalendarRange, timeZone: string): string {
  const first = range.days[0]
  const last = range.days[range.days.length - 1]
  if (!first || !last) return ''
  return first === last ? formatDay(first.startMs, timeZone) : `${formatDay(first.startMs, timeZone)} – ${formatDay(last.startMs, timeZone)}`
}

/** True when `atMs` is inside the range. */
export function rangeHolds(range: CalendarRange, atMs: number): boolean {
  return atMs >= range.fromMs && atMs < range.toMs
}
