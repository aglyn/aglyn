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
  isValidTimeZone,
  zonedDateTime,
  zonedDayKey,
  zonedWallTimeToInstant,
} from '@aglyn/shared-util-timestamp/zoned-time'

/**
 * HOW AN EVENT REPEATS, AND THE DATES IT FALLS ON (AGL-4252).
 *
 * An event stores its FIRST occurrence (`startsAtMs`/`endsAtMs`) and, when it
 * repeats, a rule beside it. The rule is read on the event's own wall clock
 * (`timeZone`), so a Thursday 6 PM practice stays at 6 PM on the day the
 * clocks change rather than drifting an hour, and an exception names a
 * calendar day (`YYYY-MM-DD`) on that clock.
 *
 * Pure: no Firestore and no clock. The server expands the rule for the dates
 * a calendar asks for (`expandEventOccurrences`), and the writers store
 * {@link eventSeriesEndsAtMs} so a range read finds a series that started
 * long before the range.
 */

export const EVENT_REPEAT_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const
export type EventRepeatFrequency = (typeof EVENT_REPEAT_FREQUENCIES)[number]

/** The most a rule's "every N" may be. */
export const EVENT_REPEAT_MAX_INTERVAL = 52
/** The most occurrences a counted rule may have. */
export const EVENT_REPEAT_MAX_COUNT = 500
/** The most skipped dates one series may carry. */
export const EVENT_REPEAT_MAX_EXCEPTIONS = 200
/**
 * How many candidate days one expansion walks before it stops: ten years of
 * a daily rule. A rule with no end is still bounded by the range asked for;
 * this only stops a range that starts decades after the series did.
 */
export const EVENT_REPEAT_MAX_STEPS = 3_700
/** The end stored for a series that never ends: the last instant a `Date` holds. */
export const EVENT_SERIES_OPEN_END_MS = 8_640_000_000_000_000

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** The stored rule. */
export interface EventRecurrence {
  freq: EventRepeatFrequency
  /** Every N days, weeks or months; absent is 1. */
  interval?: number
  /**
   * The weekdays a weekly rule falls on, 0 Sunday through 6 Saturday, in the
   * event's zone. Absent or empty: the first occurrence's own weekday.
   */
  weekdays?: number[]
  /** The last day the series may fall on, `YYYY-MM-DD` on the event's clock. */
  untilDayKey?: string
  /** How many occurrences the series has, the skipped ones included. */
  count?: number
  /** Days the series skips, `YYYY-MM-DD` on the event's clock. */
  exceptDayKeys?: string[]
}

/** One date an event happens on. */
export interface EventOccurrence {
  startsAtMs: number
  endsAtMs: number
  /** `YYYY-MM-DD` the occurrence starts on, on the event's clock. */
  dayKey: string
}

/** Whether `value` is a real calendar day written `YYYY-MM-DD`. */
export function isEventDayKey(value: unknown): value is string {
  const match = typeof value === 'string' ? value.match(DAY_KEY) : null
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function wholeIn(value: unknown, min: number, max: number): number | null {
  const number =
    typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return null
  const whole = Math.round(number)
  return whole >= min && whole <= max ? whole : null
}

/**
 * A rule as given (an editor, a file, a build), folded to the stored form,
 * or `null` for "does not repeat". Unknown keys are dropped; a value out of
 * range is dropped rather than refused, so a stored rule is always one the
 * expansion can walk.
 */
export function eventRecurrenceOf(value: unknown): EventRecurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const freq = String(raw['freq'] ?? '')
    .trim()
    .toLowerCase()
  if (!(EVENT_REPEAT_FREQUENCIES as readonly string[]).includes(freq))
    return null
  const rule: EventRecurrence = { freq: freq as EventRepeatFrequency }
  const interval = wholeIn(raw['interval'], 1, EVENT_REPEAT_MAX_INTERVAL)
  if (interval && interval > 1) rule.interval = interval
  if (rule.freq === 'weekly' && Array.isArray(raw['weekdays'])) {
    const days = [
      ...new Set(
        raw['weekdays']
          .map((day) => wholeIn(day, 0, 6))
          .filter((day): day is number => day !== null),
      ),
    ].sort((a, b) => a - b)
    if (days.length) rule.weekdays = days
  }
  if (isEventDayKey(raw['untilDayKey']))
    rule.untilDayKey = raw['untilDayKey'] as string
  else {
    const count = wholeIn(raw['count'], 1, EVENT_REPEAT_MAX_COUNT)
    if (count) rule.count = count
  }
  if (Array.isArray(raw['exceptDayKeys'])) {
    const days = [...new Set(raw['exceptDayKeys'].filter(isEventDayKey))]
      .sort()
      .slice(0, EVENT_REPEAT_MAX_EXCEPTIONS)
    if (days.length) rule.exceptDayKeys = days
  }
  return rule
}

/** The zone an event's dates are read in: its own, else UTC. */
export function eventTimeZoneOf(value: unknown): string {
  return isValidTimeZone(value) ? (value as string) : 'UTC'
}

interface CalendarDay {
  year: number
  month: number
  day: number
}

/** The calendar day `offset` days after `from`, and its weekday. */
function dayAfter(
  from: CalendarDay,
  offset: number,
): CalendarDay & { weekday: number } {
  const date = new Date(Date.UTC(from.year, from.month - 1, from.day + offset))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  }
}

const pad = (value: number, width: number) => String(value).padStart(width, '0')
const keyOf = (day: CalendarDay) =>
  `${pad(day.year, 4)}-${pad(day.month, 2)}-${pad(day.day, 2)}`

export interface ExpandOptions {
  /** Occurrences ending before this are left out. */
  fromMs: number
  /** Occurrences starting at or after this are left out. */
  toMs: number
  /** The most occurrences returned. */
  limit?: number
}

/** What an event needs for its dates to be worked out. */
export interface EventSchedule {
  startsAtMs: number
  endsAtMs: number
  timeZone?: string | null
  recurrence?: unknown
}

/**
 * Every date the event happens on that overlaps `[fromMs, toMs)`, earliest
 * first. A one-off event answers itself when it overlaps. Each occurrence
 * lasts as long as the first, on the wall clock's start time.
 */
export function expandEventOccurrences(
  event: EventSchedule,
  options: ExpandOptions,
): EventOccurrence[] {
  const limit = Math.max(1, options.limit ?? EVENT_REPEAT_MAX_COUNT)
  const zone = eventTimeZoneOf(event.timeZone)
  const startsAtMs = Number(event.startsAtMs)
  if (!Number.isFinite(startsAtMs) || startsAtMs <= 0) return []
  const durationMs = Math.max(0, Number(event.endsAtMs) - startsAtMs) || 0
  const rule = eventRecurrenceOf(event.recurrence)
  if (!rule) {
    const endsAtMs = startsAtMs + durationMs
    const overlaps =
      startsAtMs < options.toMs &&
      Math.max(endsAtMs, startsAtMs + 1) > options.fromMs
    return overlaps
      ? [{ startsAtMs, endsAtMs, dayKey: zonedDayKey(startsAtMs, zone) }]
      : []
  }
  const out: EventOccurrence[] = []
  for (const occurrence of walkSeries(
    startsAtMs,
    durationMs,
    zone,
    rule,
    options.toMs,
  )) {
    if (occurrence.startsAtMs >= options.toMs) break
    if (
      Math.max(occurrence.endsAtMs, occurrence.startsAtMs + 1) <= options.fromMs
    )
      continue
    out.push(occurrence)
    if (out.length >= limit) break
  }
  return out
}

/**
 * The series' dates in order, the skipped days left out, up to the rule's
 * own end or the first one starting at or after `stopMs`.
 */
function* walkSeries(
  startsAtMs: number,
  durationMs: number,
  zone: string,
  rule: EventRecurrence,
  stopMs: number,
): Generator<EventOccurrence> {
  const wall = zonedDateTime(startsAtMs, zone)
  const first: CalendarDay = {
    year: wall.year,
    month: wall.month,
    day: wall.day,
  }
  const interval = rule.interval ?? 1
  const skipped = new Set(rule.exceptDayKeys ?? [])
  const until = rule.untilDayKey ?? null
  const count = rule.count ?? Number.POSITIVE_INFINITY
  let produced = 0
  const at = (day: CalendarDay): EventOccurrence => {
    const start = zonedWallTimeToInstant(
      { ...day, hour: wall.hour, minute: wall.minute, second: wall.second },
      zone,
    )
    return {
      startsAtMs: start,
      endsAtMs: start + durationMs,
      dayKey: keyOf(day),
    }
  }
  for (let step = 0; step < EVENT_REPEAT_MAX_STEPS; step += 1) {
    let days: CalendarDay[]
    if (rule.freq === 'daily') {
      days = [dayAfter(first, step * interval)]
    } else if (rule.freq === 'weekly') {
      const weekdays = rule.weekdays?.length ? rule.weekdays : [wall.weekday]
      days = weekdays
        .map((weekday) => step * 7 * interval + (weekday - wall.weekday))
        .filter((offset) => offset >= 0)
        .map((offset) => dayAfter(first, offset))
    } else {
      // Monthly on the first occurrence's day of the month; a month without
      // that day (the 31st in April) has no occurrence.
      const monthIndex = first.month - 1 + step * interval
      const year = first.year + Math.floor(monthIndex / 12)
      const month = (monthIndex % 12) + 1
      const length = new Date(Date.UTC(year, month, 0)).getUTCDate()
      days = first.day <= length ? [{ year, month, day: first.day }] : []
    }
    for (const day of days) {
      const key = keyOf(day)
      if (until && key > until) return
      if (produced >= count) return
      produced += 1
      if (skipped.has(key)) continue
      const occurrence = at(day)
      yield occurrence
      if (occurrence.startsAtMs >= stopMs) return
    }
  }
}

/**
 * When the series' last occurrence ends, for a range read to find a series
 * that began before the range: the event's own end when it does not repeat,
 * {@link EVENT_SERIES_OPEN_END_MS} when it repeats with no end.
 */
export function eventSeriesEndsAtMs(event: EventSchedule): number {
  const startsAtMs = Number(event.startsAtMs)
  const endsAtMs = Math.max(Number(event.endsAtMs) || startsAtMs, startsAtMs)
  const rule = eventRecurrenceOf(event.recurrence)
  if (!rule) return endsAtMs
  if (!rule.untilDayKey && !rule.count) return EVENT_SERIES_OPEN_END_MS
  const durationMs = endsAtMs - startsAtMs
  let last = endsAtMs
  for (const occurrence of walkSeries(
    startsAtMs,
    durationMs,
    eventTimeZoneOf(event.timeZone),
    rule,
    EVENT_SERIES_OPEN_END_MS,
  )) {
    last = occurrence.endsAtMs
  }
  return last
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** How a rule reads to a visitor: "Every week on Thursday", "Every 2 days". */
export function eventRecurrenceText(
  value: unknown,
  firstWeekday?: number,
): string {
  const rule = eventRecurrenceOf(value)
  if (!rule) return ''
  const interval = rule.interval ?? 1
  const unit =
    rule.freq === 'daily' ? 'day' : rule.freq === 'weekly' ? 'week' : 'month'
  let text = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
  if (rule.freq === 'weekly') {
    const days = rule.weekdays?.length
      ? rule.weekdays
      : typeof firstWeekday === 'number'
        ? [firstWeekday]
        : []
    if (days.length) {
      const names = days.map((day) => WEEKDAY_NAMES[day])
      text += ` on ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}`
    }
  }
  if (rule.untilDayKey) {
    const [year, month, day] = rule.untilDayKey.split('-').map(Number)
    text += `, until ${new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}`
  } else if (rule.count) {
    text += `, ${rule.count} times`
  }
  return text
}
