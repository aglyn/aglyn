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
 * WHAT A BOOKING CARRIES BACK TO THE RECORD IT CAME FROM (AGL-2660).
 *
 * A rep drops a booking link into an email from a record; the visitor books
 * through it; the booking comes back to the record as a meeting on its
 * timeline and, when the service asks for one, a follow-up task. The record
 * system draws the "Book a meeting" zone and hands it the record by its kind
 * and id; this plugin builds the link, carries the record on it, and files
 * the meeting back through the core's record-timeline seam, where the owner
 * finds the record. Neither plugin imports the other: what this module holds
 * — the link's query keys, the wire form of the record it carries, and the
 * words and the day of what is filed — is this plugin's own.
 */

import { bookingContactLines } from './booking-contact-fields'
import {
  isValidTimeZone,
  zonedDateTime,
} from '@aglyn/shared-util-timestamp/zoned-time'

/**
 * The query key a booking link carries the record on: `?crm=contact:abc`.
 *
 * The reference rides the LINK rather than relying on the booker's address
 * because the two routinely differ — a rep emails somebody's work address
 * and they book with a personal one — and a booking that could only be
 * matched by address would then land on nobody. The widget copies the value
 * onto the booking request, the booking row keeps it as `crmRef`, and the
 * server hands it to the record system to file the meeting under. The key
 * is the one links already sent carry, so it is never renamed.
 */
export const BOOKING_RECORD_PARAM = 'crm'

/**
 * The query key that preselects a service in the booking widget:
 * `?service={serviceId}`. The widget lists every active service and this
 * opens it on the one the link was about.
 */
export const BOOKING_SERVICE_PARAM = 'service'

/** A record of the record system's, by its kind and id in its own words. */
export interface BookingRecordRef {
  kind: string
  id: string
}

/**
 * What a kind and an id may look like inside the reference: a lowercase
 * word, and an id with nothing a path or a query could be built from. The
 * value arrives on a public, unauthenticated request; which kinds a record
 * system keeps is its own to say when the booking is filed.
 */
const REF_KIND_PATTERN = /^[a-z][a-z-]{0,31}$/
const REF_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** `contact:abc` — the wire form of a reference. */
export function formatBookingRecordRef(ref: BookingRecordRef): string {
  return `${ref.kind}:${ref.id}`
}

/**
 * The reference a query value names, or `null` for anything that is not one.
 *
 * Strict on purpose: the value arrives on a public, unauthenticated booking
 * request, so a malformed one is dropped rather than stored — a booking
 * still lands, and is matched by the booker's address instead.
 */
export function parseBookingRecordRef(raw: unknown): BookingRecordRef | null {
  if (typeof raw !== 'string') return null
  const separator = raw.indexOf(':')
  if (separator <= 0) return null
  const kind = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (!REF_KIND_PATTERN.test(kind) || !REF_ID_PATTERN.test(id)) return null
  return { kind, id }
}

/** The slot, as the meeting entry and the task print it. */
function formatSlot(startsAtMs: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(startsAtMs))
  } catch {
    // An unknown zone name on the service falls back to UTC rather than
    // failing the write: a meeting filed with a slightly wrong clock is
    // better than no meeting at all.
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(startsAtMs))
  }
}

/**
 * What the meeting entry on the timeline says — the service and the slot,
 * in the service's own timezone, with the zone named so a rep in another
 * one is not misled. The body, not the subject: `subject` is the field a
 * sent email carries, and the timeline draws it as one.
 *
 * Then the phone and the address the booker gave, a line each, when the
 * service asked for them (AGL-3493). The address lives HERE rather than on
 * the person: it is where this job is, which is often not where the person
 * lives, and the next booking may be somewhere else.
 */
export function bookingMeetingBody(input: {
  serviceName: string
  startsAtMs: number
  timezone?: string | null
  phone?: unknown
  address?: unknown
}): string {
  const timezone = input.timezone || 'UTC'
  const service = String(input.serviceName ?? '').trim() || 'Booking'
  return [
    `${service} — ${formatSlot(input.startsAtMs, timezone)} (${timezone})`,
    ...bookingContactLines(input),
  ].join('\n')
}

/** The title of the task a service files when it asks for a follow-up. */
export function bookingFollowUpTitle(serviceName: string): string {
  const service = String(serviceName ?? '').trim() || 'the booking'
  return `Follow up after ${service}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Weekday (0 = Sunday … 6 = Saturday) of an instant in a timezone, read in
 * UTC when the zone name is one `Intl` does not know — for the reason
 * `formatSlot` gives.
 */
function weekdayIn(atMs: number, timezone: string): number {
  return zonedDateTime(atMs, isValidTimeZone(timezone) ? timezone : 'UTC').weekday
}

/**
 * When the follow-up falls due: ONE BUSINESS DAY after the slot, at the
 * slot's own clock time.
 *
 * A meeting on a Friday is followed up on Monday, one on a Saturday or a
 * Sunday on Monday too; any other day is followed up the next. Whole days
 * are added to the instant rather than a calendar walked, so the arithmetic
 * cannot land on a clock time that does not exist across a DST change —
 * the task is due "about this time tomorrow", and an hour either way is not
 * a fact the task keeps.
 */
export function bookingFollowUpDueMs(
  endsAtMs: number,
  timezone?: string | null,
): number {
  const weekday = weekdayIn(endsAtMs, timezone || 'UTC')
  // Friday (5) skips the weekend; Saturday (6) reaches Monday in two days.
  const daysAhead = weekday === 5 ? 3 : weekday === 6 ? 2 : 1
  return endsAtMs + daysAhead * DAY_MS
}
