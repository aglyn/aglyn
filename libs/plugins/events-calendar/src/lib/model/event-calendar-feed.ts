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

import { zonedDateTime } from '@aglyn/shared-util-timestamp/zoned-time'
import type { EventCategory } from './event-categories'
import {
  eventRecurrenceOf,
  eventSeriesEndsAtMs,
  eventTimeZoneOf,
  type EventRecurrence,
} from './event-recurrence'

/**
 * WHAT THE CALENDAR SHOWS, AND HOW AN OCCURRENCE LEAVES THE SITE (AGL-4252).
 *
 * The wire shape of `events/occurrences` (one dated occurrence of a
 * published event, with its categories and ticket already resolved), and the
 * three ways a visitor takes one away: a Google Calendar link, an `.ics`
 * file, and `schema.org/Event` markup for search engines. Pure, shared by
 * the server door and the site elements.
 */

/** What pressing an occurrence's ticket button does; see `core.site-offers`. */
export type CalendarTicketAction =
  | { kind: 'link'; href: string }
  | {
      kind: 'post'
      endpoint: string
      body: Record<string, unknown>
      notify?: string
      done?: string
      then?: string
    }

export interface CalendarTicket {
  label: string
  /** A price or "Free", worded by the plugin that sells it. */
  caption?: string
  action: CalendarTicketAction
}

/** One dated occurrence of a published event. */
export interface CalendarOccurrence {
  /** `{eventId}:{dayKey}`: stable across reads, unique on a calendar. */
  id: string
  eventId: string
  title: string
  startsAtMs: number
  endsAtMs: number
  /** `YYYY-MM-DD` on the event's clock. */
  dayKey: string
  timeZone: string
  location?: string | null
  organizer?: string | null
  description?: string | null
  coverImage?: string | null
  coverImageAlt?: string | null
  categoryIds: string[]
  /** "Every week on Thursday"; empty for a one-off. */
  repeatText: string
  ticket?: CalendarTicket | null
}

/** The `events/occurrences` answer. */
export interface CalendarRangeResponse {
  /** False where the workspace does not have the calendar: the element draws nothing. */
  enabled: boolean
  timeZone: string
  categories: EventCategory[]
  occurrences: CalendarOccurrence[]
}

/** Whether an occurrence holds a visitor's search, in its words or its categories'. */
export function occurrenceMatches(
  occurrence: Pick<
    CalendarOccurrence,
    'title' | 'description' | 'location' | 'organizer' | 'categoryIds'
  >,
  query: string,
  categories: readonly Pick<EventCategory, '$id' | 'name'>[] = [],
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const names = categories
    .filter((category) => occurrence.categoryIds.includes(category.$id))
    .map((category) => category.name)
  const haystack = [
    occurrence.title,
    occurrence.description ?? '',
    occurrence.location ?? '',
    occurrence.organizer ?? '',
    ...names,
  ]
    .join(' ')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** `20261126T180000Z`: an instant as iCalendar and Google both read it. */
export function calendarStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** `20261126T180000`: an instant as the wall clock in `timeZone` reads it. */
export function calendarLocalStamp(ms: number, timeZone: string): string {
  const wall = zonedDateTime(ms, timeZone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${String(wall.year).padStart(4, '0')}${pad(wall.month)}${pad(wall.day)}` +
    `T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`
  )
}

/** A Google Calendar "add event" link for one occurrence. */
export function googleCalendarLink(
  occurrence: Pick<
    CalendarOccurrence,
    'title' | 'startsAtMs' | 'endsAtMs' | 'description' | 'location'
  >,
  pageUrl?: string,
): string {
  const details = [occurrence.description ?? '', pageUrl ?? '']
    .filter(Boolean)
    .join('\n\n')
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: occurrence.title,
    dates: `${calendarStamp(occurrence.startsAtMs)}/${calendarStamp(occurrence.endsAtMs)}`,
    ...(details ? { details: details.slice(0, 1500) } : {}),
    ...(occurrence.location ? { location: occurrence.location } : {}),
  })
  return `https://calendar.google.com/calendar/render?${query.toString()}`
}

/** Text escaped for an iCalendar value (RFC 5545 §3.3.11). */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/[,;]/g, (match) => `\\${match}`)
}

/** A content line folded at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const width = new TextEncoder().encode(char).length
    if (size + width > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      size = 0
    }
    current += char
    size += width
  }
  out.push(current)
  return out.join('\r\n ')
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * The `RRULE` value a stored rule reads as, or '' for none. `lastStartMs` is
 * the series' last start, which an `UNTIL` must name in UTC: a day key alone
 * would cut the last evening occurrence west of Greenwich.
 */
export function recurrenceRrule(value: unknown, lastStartMs?: number): string {
  const rule: EventRecurrence | null = eventRecurrenceOf(value)
  if (!rule) return ''
  const parts = [`FREQ=${rule.freq.toUpperCase()}`]
  if (rule.interval && rule.interval > 1)
    parts.push(`INTERVAL=${rule.interval}`)
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    parts.push(
      `BYDAY=${rule.weekdays.map((day) => WEEKDAY_CODES[day]).join(',')}`,
    )
  }
  // The expansion's weeks start on Sunday; iCalendar's default is Monday,
  // which moves which week a Sunday belongs to when weeks are skipped.
  if (rule.freq === 'weekly' && (rule.interval ?? 1) > 1) parts.push('WKST=SU')
  if (rule.untilDayKey) {
    parts.push(
      `UNTIL=${
        typeof lastStartMs === 'number' && Number.isFinite(lastStartMs)
          ? calendarStamp(lastStartMs)
          : `${rule.untilDayKey.replace(/-/g, '')}T235959Z`
      }`,
    )
  } else if (rule.count) parts.push(`COUNT=${rule.count}`)
  return parts.join(';')
}

/** One event as a VEVENT: a series keeps its rule, so a calendar app repeats it itself. */
export interface IcsEvent {
  uid: string
  title: string
  startsAtMs: number
  endsAtMs: number
  timeZone?: string | null
  description?: string | null
  location?: string | null
  url?: string | null
  recurrence?: unknown
  /** Skipped occurrence starts, as instants. */
  exceptStartsAtMs?: readonly number[]
  updatedAtMs?: number | null
}

/**
 * A whole calendar: the subscribable feed, or one occurrence's download.
 * A one-off is written in UTC (`Z`). A series is written on its own wall
 * clock (`TZID=` with the IANA name, which Google, Apple and Outlook read),
 * so its weekdays and its 6 PM stay right across a clock change.
 */
export function buildIcsCalendar(options: {
  name: string
  timeZone?: string
  events: readonly IcsEvent[]
  nowMs: number
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aglyn//Events Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(options.name)}`,
    ...(options.timeZone ? [`X-WR-TIMEZONE:${options.timeZone}`] : []),
  ]
  for (const event of options.events) {
    const rrule = recurrenceRrule(
      event.recurrence,
      eventSeriesEndsAtMs(event) - (event.endsAtMs - event.startsAtMs),
    )
    const zone = eventTimeZoneOf(event.timeZone)
    const at = (ms: number, name: string) =>
      rrule && zone !== 'UTC'
        ? `${name};TZID=${zone}:${calendarLocalStamp(ms, zone)}`
        : `${name}:${calendarStamp(ms)}`
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${calendarStamp(event.updatedAtMs || options.nowMs)}`,
      at(event.startsAtMs, 'DTSTART'),
      at(event.endsAtMs, 'DTEND'),
      `SUMMARY:${icsText(event.title)}`,
    )
    if (rrule) lines.push(`RRULE:${rrule}`)
    for (const skipped of event.exceptStartsAtMs ?? []) {
      lines.push(at(skipped, 'EXDATE'))
    }
    if (event.description)
      lines.push(`DESCRIPTION:${icsText(event.description)}`)
    if (event.location) lines.push(`LOCATION:${icsText(event.location)}`)
    if (event.url) lines.push(`URL:${event.url}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/**
 * One occurrence's `schema.org/Event` object: the dates of THAT occurrence,
 * so a weekly practice shows in search as the dates it happens on.
 * `image` only when the cover is already absolute (the door resolves it).
 */
export function occurrenceJsonLd(
  occurrence: CalendarOccurrence,
  options: { url?: string; offerUrl?: string } = {},
): Record<string, unknown> {
  const image =
    occurrence.coverImage && /^https:\/\//.test(occurrence.coverImage)
      ? occurrence.coverImage
      : null
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: occurrence.title,
    startDate: new Date(occurrence.startsAtMs).toISOString(),
    endDate: new Date(occurrence.endsAtMs).toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(occurrence.location && {
      location: { '@type': 'Place', name: occurrence.location },
    }),
    ...(occurrence.organizer && {
      organizer: { '@type': 'Organization', name: occurrence.organizer },
    }),
    ...(occurrence.description && { description: occurrence.description }),
    ...(image && { image: [image] }),
    ...(options.url && { url: options.url }),
    ...(occurrence.ticket &&
      options.offerUrl && {
        offers: {
          '@type': 'Offer',
          url: options.offerUrl,
          availability: 'https://schema.org/InStock',
        },
      }),
  }
}
