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

/*==========================================
 * CALENDAR MATH IN A NAMED ZONE.
 *
 * `Intl` is the only zone database a browser or a serverless function is
 * guaranteed to have, and it only FORMATS: it turns an instant into the
 * calendar fields a wall clock in a zone shows, and nothing turns fields back
 * into an instant. Everything here is built on that one direction.
 *
 * ## Wall time to instant
 *
 * A wall time is read as if it were UTC, then shifted by the zone's offset.
 * Which offset is the whole difficulty: on the day a clock changes, the
 * offset a day before and the offset a day after differ, and a wall time can
 * fall in the hour that never happens (the spring gap) or the hour that
 * happens twice (the autumn overlap). So both offsets are tried and the
 * result is whichever candidate formats back to the wall time asked for —
 * the EARLIER one when both do, and, when neither does, the one that moves
 * the time forward by the length of the gap, which is where a clock that
 * skipped an hour puts it.
 *
 * ## Day-of-week and minute-of-day are wall-clock readings
 *
 * A window that opens at 09:00 opens at 09:00 on the clock on the day the
 * clocks change too, so the minute of the day is `hour * 60 + minute` as the
 * wall shows it, never the minutes elapsed since midnight.
 *
 * Imports nothing, on purpose: the package root extends the Firestore SDK's
 * `Timestamp`, and a published page that only needed a weekday must not ship
 * the Firestore client to get one. `zoned-time.isolation.spec.ts` holds it.
 *==========================================*/

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Minutes in a day: the exclusive end of a window that runs to midnight. */
export const MINUTES_PER_DAY = 24 * 60

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Monday through Friday, in `Date#getUTCDay` numbering. */
export const MONDAY_TO_FRIDAY: readonly number[] = [1, 2, 3, 4, 5]

/** The calendar fields a wall clock in a zone shows for one instant. */
export interface ZonedDateTime {
  year: number
  /** 1 January through 12 December. */
  month: number
  /** 1 through 31. */
  day: number
  /** 0 through 23. */
  hour: number
  minute: number
  second: number
  /** 0 Sunday through 6 Saturday. */
  weekday: number
}

/**
 * A wall time to find the instant of. Fields overflow the way `Date.UTC`
 * lets them — day 32 of a month is the first of the next — so a caller can
 * step a calendar by adding to `day`.
 */
export interface ZonedWallTime {
  year: number
  /** 1 January through 12 December; overflow rolls into the next year. */
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
}

/**
 * Formatters by zone. Building one is far slower than using one, and a
 * caller that walks a calendar asks the same zone thousands of times; a zone
 * name that `Intl` refuses throws and is never stored.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** Whether `Intl` knows the zone, so a stored name can be checked before use. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    formatterFor(value)
    return true
  } catch {
    return false
  }
}

/**
 * The wall clock in `timeZone` at `atMs`.
 *
 * @throws RangeError for a zone `Intl` does not know, or an instant that is
 *         not a finite number.
 */
export function zonedDateTime(atMs: number, timeZone: string): ZonedDateTime {
  const fields: ZonedDateTime = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    weekday: 0,
  }
  for (const part of formatterFor(timeZone).formatToParts(new Date(atMs))) {
    switch (part.type) {
      case 'year':
        fields.year = Number(part.value)
        break
      case 'month':
        fields.month = Number(part.value)
        break
      case 'day':
        fields.day = Number(part.value)
        break
      case 'hour':
        // `h23` reads midnight as 00; the modulo keeps an engine that still
        // prints 24 from starting a day at minute 1440.
        fields.hour = Number(part.value) % 24
        break
      case 'minute':
        fields.minute = Number(part.value)
        break
      case 'second':
        fields.second = Number(part.value)
        break
      case 'weekday':
        fields.weekday = Math.max(0, WEEKDAY_LABELS.indexOf(part.value))
        break
    }
  }
  return fields
}

const pad = (value: number, width: number) => String(value).padStart(width, '0')

/** `YYYY-MM-DD` of the calendar day `atMs` falls in, in `timeZone`. */
export function zonedDayKey(atMs: number, timeZone: string): string {
  const { year, month, day } = zonedDateTime(atMs, timeZone)
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/** The wall clock's minute of the day, `hour * 60 + minute`, 0 through 1439. */
export function zonedMinuteOfDay(atMs: number, timeZone: string): number {
  const { hour, minute } = zonedDateTime(atMs, timeZone)
  return hour * 60 + minute
}

/** The zone's offset from UTC at `atMs`, in milliseconds, positive east. */
export function zoneOffsetMs(atMs: number, timeZone: string): number {
  const fields = zonedDateTime(atMs, timeZone)
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  )
  return asUtc - Math.floor(atMs / 1000) * 1000
}

/**
 * The instant a wall time happens in `timeZone` — see the module note for
 * the two days a year it is ambiguous. Seconds are whole: a millisecond part
 * of `second` is dropped.
 */
export function zonedWallTimeToInstant(
  wall: ZonedWallTime,
  timeZone: string,
): number {
  // Normalized first, so an overflowed field and the canonical one compare
  // equal when a candidate is checked against it.
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour ?? 0,
    wall.minute ?? 0,
    Math.floor(wall.second ?? 0),
  )
  const target = new Date(asUtc)
  const matches = (candidate: number): boolean => {
    const fields = zonedDateTime(candidate, timeZone)
    return (
      fields.year === target.getUTCFullYear() &&
      fields.month === target.getUTCMonth() + 1 &&
      fields.day === target.getUTCDate() &&
      fields.hour === target.getUTCHours() &&
      fields.minute === target.getUTCMinutes() &&
      fields.second === target.getUTCSeconds()
    )
  }
  const before = asUtc - zoneOffsetMs(asUtc - DAY_MS, timeZone)
  const after = asUtc - zoneOffsetMs(asUtc + DAY_MS, timeZone)
  const beforeMatches = matches(before)
  const afterMatches = matches(after)
  if (beforeMatches && afterMatches) return Math.min(before, after)
  if (beforeMatches) return before
  if (afterMatches) return after
  // Neither reads back: the wall time is inside a gap. The offset in force
  // before the change carries it forward by the gap, which is the later of
  // the two candidates wherever a clock jumps ahead.
  return Math.max(before, after)
}

/** Midnight at the start of the calendar day `atMs` falls in, in `timeZone`. */
export function startOfZonedDay(atMs: number, timeZone: string): number {
  const { year, month, day } = zonedDateTime(atMs, timeZone)
  return zonedWallTimeToInstant({ year, month, day }, timeZone)
}

/**
 * Midnight at the start of the NEXT calendar day in `timeZone` — built from
 * the calendar rather than by adding 24 hours, because a day a clock change
 * falls in is 23 or 25 hours long.
 */
export function startOfNextZonedDay(atMs: number, timeZone: string): number {
  const { year, month, day } = zonedDateTime(atMs, timeZone)
  return zonedWallTimeToInstant({ year, month, day: day + 1 }, timeZone)
}

/**
 * How many calendar days separate the day `fromMs` falls in from the day
 * `toMs` falls in, in `timeZone`: `0` for the same day, negative when `toMs`
 * is on an earlier one. Counted on the calendar, so a 23-hour day is a day.
 */
export function zonedCalendarDaysBetween(
  fromMs: number,
  toMs: number,
  timeZone: string,
): number {
  const from = zonedDateTime(fromMs, timeZone)
  const to = zonedDateTime(toMs, timeZone)
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      DAY_MS,
  )
}

/**
 * `count` business days after `atMs`, at the same wall-clock time, in
 * `timeZone`.
 *
 * The calendar is walked a day at a time from the day after `atMs`, and each
 * day whose weekday is in `businessDays` counts one. The time of day is the
 * wall time `atMs` showed, so a 10:00 send is followed at 10:00 after a clock
 * change as well; a wall time the destination day skips moves forward with
 * the clock. `0` is `atMs` itself, whatever day that is.
 *
 * No holidays: a calendar that knew some countries' holidays would quietly
 * shorten the wait in every country it did not know.
 *
 * @throws RangeError for a count that is not a whole number of days, or a
 *         `businessDays` list with no weekday in it.
 */
export function addZonedBusinessDays(
  atMs: number,
  count: number,
  timeZone: string,
  businessDays: readonly number[] = MONDAY_TO_FRIDAY,
): number {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`business days must be a whole number, got ${count}`)
  }
  if (count === 0) return atMs
  const open = new Set(
    businessDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  )
  if (!open.size) throw new RangeError('no business day to count')
  const start = zonedDateTime(atMs, timeZone)
  let offset = 0
  let counted = 0
  while (counted < count) {
    offset += 1
    const calendar = new Date(Date.UTC(start.year, start.month - 1, start.day + offset))
    if (open.has(calendar.getUTCDay())) counted += 1
  }
  const landed = zonedWallTimeToInstant(
    {
      year: start.year,
      month: start.month,
      day: start.day + offset,
      hour: start.hour,
      minute: start.minute,
      second: start.second,
    },
    timeZone,
  )
  // The wall time is whole seconds; the instant keeps the millisecond it had.
  return landed + (atMs - Math.floor(atMs / 1000) * 1000)
}

/*==========================================
 * WEEKLY SCHEDULES.
 *==========================================*/

/**
 * One open stretch of a day, in minutes after local midnight: `start`
 * inclusive, `end` exclusive, `0 <= start < end <= 1440`.
 */
export interface WeeklyInterval {
  start: number
  end: number
}

/**
 * Open stretches by weekday (`0` Sunday through `6` Saturday), read in one
 * zone. A weekday with no entry is closed.
 */
export type WeeklySchedule = Readonly<
  Partial<Record<number, readonly WeeklyInterval[]>>
>

/** A stretch of a schedule as instants: `startMs` inclusive, `endMs` exclusive. */
export interface ZonedInterval {
  startMs: number
  endMs: number
}

/** How far ahead an opening is looked for: two weeks covers any weekly shape. */
const OPENING_HORIZON_DAYS = 14

function wallTimeAtMinute(
  date: { year: number; month: number; day: number },
  minuteOfDay: number,
): ZonedWallTime {
  return {
    year: date.year,
    month: date.month,
    day: date.day,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
  }
}

function usableIntervals(
  schedule: WeeklySchedule,
  weekday: number,
): WeeklyInterval[] {
  const intervals = schedule?.[weekday]
  if (!Array.isArray(intervals)) return []
  return intervals
    .filter(
      (interval) =>
        Number.isFinite(interval?.start) &&
        Number.isFinite(interval?.end) &&
        interval.start >= 0 &&
        interval.end <= MINUTES_PER_DAY &&
        interval.start < interval.end,
    )
    .sort((a, b) => a.start - b.start)
}

/**
 * The stretch of `schedule` that contains `atMs`, or else the next one to
 * open after it — `startMs <= atMs` tells the two apart — or `null` when the
 * schedule never opens.
 *
 * Each end of a stretch is placed on the calendar by
 * {@link zonedWallTimeToInstant}, so the day a clock changes is measured as
 * it is lived: 09:00–17:00 is eight hours of wall clock either way, a time
 * the spring gap skips is read the way that function reads it, and a stretch
 * that comes out empty — it starts inside the gap and ends as the gap ends —
 * does not open that day.
 */
export function nextWeeklyOpening(
  atMs: number,
  schedule: WeeklySchedule,
  timeZone: string,
): ZonedInterval | null {
  const today = zonedDateTime(atMs, timeZone)
  for (let offset = 0; offset <= OPENING_HORIZON_DAYS; offset += 1) {
    const calendar = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    const date = {
      year: calendar.getUTCFullYear(),
      month: calendar.getUTCMonth() + 1,
      day: calendar.getUTCDate(),
    }
    for (const interval of usableIntervals(schedule, calendar.getUTCDay())) {
      const startMs = zonedWallTimeToInstant(wallTimeAtMinute(date, interval.start), timeZone)
      const endMs = zonedWallTimeToInstant(wallTimeAtMinute(date, interval.end), timeZone)
      if (endMs <= startMs) continue
      if (atMs < endMs) return { startMs, endMs }
    }
  }
  return null
}

/** Whether `atMs` falls inside an open stretch of `schedule`. */
export function isWithinWeeklySchedule(
  atMs: number,
  schedule: WeeklySchedule,
  timeZone: string,
): boolean {
  const opening = nextWeeklyOpening(atMs, schedule, timeZone)
  return opening !== null && opening.startMs <= atMs
}
