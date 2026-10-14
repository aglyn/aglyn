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

import type { PluginDraftCheck } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  isValidTimeZone,
  zonedDayKey,
  zonedMinuteOfDay,
  zonedWallTimeToInstant,
} from '@aglyn/shared-util-timestamp/zoned-time'
import {
  EVENT_COVER_ALT_MAX_LENGTH,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_ORGANIZER_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  type EventWriteInput,
} from './event-write'

/**
 * AN EVENT ANOTHER PLUGIN ASKS FOR, AS CONTENT (AGL-3743).
 *
 * What a caller of the `event` draft writer sends, and how it is read into
 * the input `eventWrite` stores — the same rule the Events page's editor and
 * the events import write through. Pure: no Firestore, no clock, so the
 * writer's `check` answers before anything is spent.
 *
 * Times are WALL TIMES in a named zone, the way a person types them into the
 * editor's date and time boxes: `startsAt` `"2026-11-14T19:00"` in
 * `"America/Chicago"` is the instant the event starts there. The event
 * stores only that instant (`startsAtMs`), exactly as an event the editor
 * saved; the zone is how the caller's words are read, not a stored field.
 *
 * An event has no recurrence, tickets, RSVP or online-meeting field, so a
 * caller cannot ask for one: the content's keys are the event's own.
 */

/** The resource name the writer is registered under. */
export const EVENT_DRAFT_RESOURCE = 'event'

/** A wall time as the content states it: `YYYY-MM-DDTHH:MM`. */
export const EVENT_DRAFT_WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** A cover address the content may carry: https, or a path on the site. */
export const EVENT_DRAFT_COVER_ADDRESS = /^(https:\/\/|\/)\S+$/

/** The longest cover image address the content may carry. */
export const EVENT_DRAFT_COVER_MAX_LENGTH = 2048

/** What a caller sends as `content`. */
export interface EventDraftContent {
  title: string
  /** `YYYY-MM-DDTHH:MM`, read in `timezone`. */
  startsAt: string
  /** `YYYY-MM-DDTHH:MM`, read in `timezone`, after the start; absent gives the editor's default length. */
  endsAt?: string
  /** The IANA zone the times are in, e.g. `America/Chicago`. */
  timezone: string
  location?: string
  organizer?: string
  description?: string
  /** An image address, as the editor's "Cover image URL" takes one. */
  coverImage?: string
  coverImageAlt?: string
}

export type EventDraftContentRead =
  | { ok: true; value: EventWriteInput & { endsAtMs: number | null }; timezone: string }
  | { ok: false; problems: string[] }

/** Text on one line: controls and runs of space folded to one space. */
function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\s]+/gu, ' ').trim() : ''
}

/**
 * The instant a wall time names in `timezone`, or `null` for one that does
 * not name a real calendar minute (month 13, February 30th, 24:30).
 */
export function eventDraftInstant(value: unknown, timezone: string): number | null {
  const match = typeof value === 'string' ? value.trim().match(EVENT_DRAFT_WALL_TIME) : null
  if (!match || !isValidTimeZone(timezone)) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null
  // A day past the month's end would roll into the next: refused instead.
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return zonedWallTimeToInstant({ year, month, day, hour, minute }, timezone)
}

function optional(
  content: Readonly<Record<string, unknown>>,
  key: keyof EventDraftContent,
  label: string,
  max: number,
  problems: string[],
  multiline = false,
): string {
  const raw = content[key]
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') {
    problems.push(`The ${label} is text`)
    return ''
  }
  const text = multiline ? raw.trim() : line(raw)
  if (text.length > max) problems.push(`The ${label} is longer than ${max} characters`)
  return text
}

/** The content as the writer stores it — always a draft — or every problem that stops it. */
export function readEventDraftContent(content: Readonly<Record<string, unknown>>): EventDraftContentRead {
  const problems: string[] = []
  const title = line(content['title'])
  if (!title) problems.push('The event needs a title')
  else if (title.length > EVENT_TITLE_MAX_LENGTH) {
    problems.push(`The title is longer than ${EVENT_TITLE_MAX_LENGTH} characters`)
  }
  const timezone = line(content['timezone'])
  const zoneOk = isValidTimeZone(timezone)
  if (!zoneOk) problems.push('The time zone is an IANA zone, such as America/Chicago')
  const startsAtMs = zoneOk ? eventDraftInstant(content['startsAt'], timezone) : null
  if (zoneOk && startsAtMs === null) {
    problems.push('The start is a date and time, written YYYY-MM-DDTHH:MM')
  }
  let endsAtMs: number | null = null
  const rawEnd = content['endsAt']
  if (rawEnd !== undefined && rawEnd !== null && rawEnd !== '' && zoneOk) {
    endsAtMs = eventDraftInstant(rawEnd, timezone)
    if (endsAtMs === null) problems.push('The end is a date and time, written YYYY-MM-DDTHH:MM')
    else if (startsAtMs !== null && endsAtMs <= startsAtMs) problems.push('The end is after the start')
  }
  const location = optional(content, 'location', 'location', EVENT_LOCATION_MAX_LENGTH, problems)
  const organizer = optional(content, 'organizer', 'organizer', EVENT_ORGANIZER_MAX_LENGTH, problems)
  const description = optional(content, 'description', 'description', EVENT_DESCRIPTION_MAX_LENGTH, problems, true)
  const coverImage = optional(content, 'coverImage', 'cover image address', EVENT_DRAFT_COVER_MAX_LENGTH, problems)
  if (coverImage && !EVENT_DRAFT_COVER_ADDRESS.test(coverImage)) {
    problems.push('The cover image is an https address or a path on the site')
  }
  const coverImageAlt = optional(content, 'coverImageAlt', 'cover description', EVENT_COVER_ALT_MAX_LENGTH, problems)
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  return {
    ok: true,
    timezone,
    value: {
      title,
      startsAtMs: startsAtMs as number,
      endsAtMs,
      location: location || null,
      organizer: organizer || null,
      description: description || null,
      coverImage: coverImage || null,
      coverImageAlt: coverImageAlt || null,
      status: 'draft',
    },
  }
}

/** `2026-11-14 19:00`: an instant as a wall clock in `timezone` reads it. */
export function eventDraftWallText(atMs: number, timezone: string): string {
  const minute = zonedMinuteOfDay(atMs, timezone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${zonedDayKey(atMs, timezone)} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
}

/** Whether content is an event this plugin would store, with what it says about it. Pure. */
export function checkEventDraftContent(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readEventDraftContent(content)
  if (read.ok === false) return read
  return {
    ok: true,
    facts: {
      status: 'draft',
      startsAtMs: read.value.startsAtMs,
      timezone: read.timezone,
      startsAt: eventDraftWallText(read.value.startsAtMs, read.timezone),
    },
  }
}
