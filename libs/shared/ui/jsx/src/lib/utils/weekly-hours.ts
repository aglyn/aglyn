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
 * The model behind the weekly hours picker: seven days, each a list of open
 * intervals in minutes since midnight. Index 0 is Sunday, as `Date#getDay`
 * counts, so a booking service's `windows[weekday]` maps onto it as is.
 *
 * Opening hours, pickup hours and delivery windows are STORED as text lines
 * in `schema.org`'s `openingHours` syntax (`Mo-Fr 09:00-17:00`), which the
 * structured-data serializer and checkout read. The picker writes those same
 * lines, so nothing downstream changes; nobody types them.
 */

export interface WeeklyHoursInterval {
  /** Minutes since midnight. */
  start: number
  /** Minutes since midnight. Earlier than `start` means the next morning. */
  end: number
}

/** Seven entries, Sunday first; an empty list is a closed day. */
export type WeeklyHours = WeeklyHoursInterval[][]

/** Display order and names, Monday first, with each day's index. */
export const WEEKLY_HOURS_DAYS: ReadonlyArray<{ index: number; name: string; short: string }> = [
  { index: 1, name: 'Monday', short: 'Mo' },
  { index: 2, name: 'Tuesday', short: 'Tu' },
  { index: 3, name: 'Wednesday', short: 'We' },
  { index: 4, name: 'Thursday', short: 'Th' },
  { index: 5, name: 'Friday', short: 'Fr' },
  { index: 6, name: 'Saturday', short: 'Sa' },
  { index: 0, name: 'Sunday', short: 'Su' },
]

const FULL_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** An all-closed week. */
export const emptyWeeklyHours = (): WeeklyHours => Array.from({ length: 7 }, () => [])

/** `540` → `09:00`. */
export const formatClockMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** `540` → `9:00 AM`, for a menu. */
export const clockLabel = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const suffix = hours < 12 ? 'AM' : 'PM'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${String(minutes % 60).padStart(2, '0')} ${suffix}`
}

/** A day token by its shortest unambiguous prefix (`Mo`, `Mon`, `Monday`). */
const dayIndex = (token: string): number => {
  const wanted = token.trim().toLowerCase()
  if (wanted.length < 2) return -1
  return FULL_NAMES.findIndex((day) => day.startsWith(wanted))
}

const clock = (hours: string, minutes: string): number => {
  const h = Number(hours)
  const m = Number(minutes)
  return h > 23 || m > 59 ? -1 : h * 60 + m
}

const DASH = /\s*[-–—]\s*/
const LINE = /^(.+?)\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/

/** Monday-first position, so a range reads the way a week is written. */
const mondayFirst = (index: number): number => (index + 6) % 7

function parseLine(line: string): { days: number[]; interval: WeeklyHoursInterval } | null {
  const match = LINE.exec(line.trim())
  if (!match) return null
  const start = clock(match[2], match[3])
  const end = clock(match[4], match[5])
  if (start < 0 || end < 0) return null
  const days: number[] = []
  for (const part of match[1].split(',')) {
    const ends = part.trim().split(DASH)
    if (ends.length > 2) return null
    const from = dayIndex(ends[0])
    const to = dayIndex(ends[ends.length - 1])
    if (from < 0 || to < 0) return null
    // A range may wrap the weekend: `Fr-Mo` is Friday through Monday.
    const span = (mondayFirst(to) - mondayFirst(from) + 7) % 7
    for (let step = 0; step <= span; step++) {
      const day = (from + step) % 7
      if (!days.includes(day)) days.push(day)
    }
  }
  return days.length ? { days, interval: { start, end } } : null
}

const sortIntervals = (intervals: WeeklyHoursInterval[]): WeeklyHoursInterval[] =>
  [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)

/**
 * Hours text → the picker's week. Lines that do not read are returned by
 * their 1-based number, so the picker can say what it could not show rather
 * than silently dropping a saved opening time.
 */
export function weeklyHoursFromText(value: unknown): { hours: WeeklyHours; unreadLines: number[] } {
  const hours = emptyWeeklyHours()
  const unreadLines: number[] = []
  const lines = typeof value === 'string' ? value.split(/\r?\n/) : []
  lines.forEach((line, index) => {
    if (!line.trim()) return
    const row = parseLine(line)
    if (!row) {
      unreadLines.push(index + 1)
      return
    }
    for (const day of row.days) {
      const exists = hours[day].some(
        (interval) => interval.start === row.interval.start && interval.end === row.interval.end,
      )
      if (!exists) hours[day].push({ ...row.interval })
    }
  })
  return { hours: hours.map(sortIntervals), unreadLines }
}

/** Monday-first day indexes → `Mo-Fr`, `Mo,We,Fr`, `Mo-We,Sa`. */
function dayList(days: number[]): string {
  const positions = days.map(mondayFirst).sort((a, b) => a - b)
  const runs: number[][] = []
  for (const position of positions) {
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === position - 1) last.push(position)
    else runs.push([position])
  }
  const short = (position: number) => WEEKLY_HOURS_DAYS[position].short
  return runs
    .flatMap((run) =>
      run.length >= 3 ? [`${short(run[0])}-${short(run[run.length - 1])}`] : run.map(short),
    )
    .join(',')
}

/**
 * The picker's week → hours text, one line per interval per set of days that
 * share it: days with the same hours are written together (`Mo-Fr`), which is
 * how a business reads its own hours back.
 */
export function weeklyHoursToText(hours: WeeklyHours): string {
  const groups = new Map<string, { days: number[]; interval: WeeklyHoursInterval }>()
  WEEKLY_HOURS_DAYS.forEach(({ index }) => {
    for (const interval of sortIntervals(hours[index] ?? [])) {
      const key = `${interval.start}-${interval.end}`
      const group = groups.get(key)
      if (group) group.days.push(index)
      else groups.set(key, { days: [index], interval })
    }
  })
  return [...groups.values()]
    .sort(
      (a, b) =>
        mondayFirst(a.days[0]) - mondayFirst(b.days[0]) || a.interval.start - b.interval.start,
    )
    .map(
      ({ days, interval }) =>
        `${dayList(days)} ${formatClockMinutes(interval.start)}-${formatClockMinutes(interval.end)}`,
    )
    .join('\n')
}
