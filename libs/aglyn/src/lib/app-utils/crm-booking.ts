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
 * THE BOOKING DOOR BETWEEN THE CRM AND BOOKINGS (AGL-2660) — the pure half.
 *
 * A rep drops a booking link into an email from a record; the visitor books
 * through it; the booking comes back to the record as a meeting on its
 * timeline and, when the service asks for one, a follow-up task. The two
 * plugins never import each other's server code, so everything both sides
 * must agree on — the query key the link carries, the shape of the record
 * reference inside it, the wording of the meeting and the task, the day the
 * task falls due — lives here, in the library both already read.
 */

/**
 * The query key a booking link carries the record on: `?crm=contact:abc`.
 *
 * The reference rides the LINK rather than relying on the booker's address
 * because the two routinely differ — a rep emails somebody's work address
 * and they book with a personal one — and a booking that could only be
 * matched by address would then land on nobody. The widget copies the value
 * onto the booking request, the booking row keeps it as `crmRef`, and the
 * server files the meeting under the record it names.
 */
export const CRM_BOOKING_REF_PARAM = 'crm'

/**
 * The query key that preselects a service in the booking widget:
 * `?service={serviceId}`. The widget lists every active service and this
 * opens it on the one the link was about.
 */
export const BOOKING_SERVICE_PARAM = 'service'

/** The three records a booking link can be dropped from. */
export const CRM_BOOKING_REF_KINDS = ['contact', 'lead', 'deal'] as const

export type CrmBookingRefKind = (typeof CRM_BOOKING_REF_KINDS)[number]

export interface CrmBookingRef {
  kind: CrmBookingRefKind
  id: string
}

/**
 * What a record id may look like inside the reference. A contact's and a
 * deal's ids are Firestore-minted; a lead's is a person key (hex). Nothing
 * legitimate carries a slash or a space, and a value that does is not a
 * reference the server should go looking for.
 */
const REF_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** `contact:abc` — the wire form of a reference. */
export function formatCrmBookingRef(ref: CrmBookingRef): string {
  return `${ref.kind}:${ref.id}`
}

/**
 * The reference a query value names, or `null` for anything that is not one.
 *
 * Strict on purpose: the value arrives on a public, unauthenticated booking
 * request, so an unknown kind or a malformed id is dropped rather than
 * stored — a booking still lands, it simply matches by address instead.
 */
export function parseCrmBookingRef(raw: unknown): CrmBookingRef | null {
  if (typeof raw !== 'string') return null
  const separator = raw.indexOf(':')
  if (separator <= 0) return null
  const kind = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (!(CRM_BOOKING_REF_KINDS as readonly string[]).includes(kind)) return null
  if (!REF_ID_PATTERN.test(id)) return null
  return { kind: kind as CrmBookingRefKind, id }
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
 */
export function crmBookingMeetingBody(input: {
  serviceName: string
  startsAtMs: number
  timezone?: string | null
}): string {
  const timezone = input.timezone || 'UTC'
  const service = String(input.serviceName ?? '').trim() || 'Booking'
  return `${service} — ${formatSlot(input.startsAtMs, timezone)} (${timezone})`
}

/** The title of the task a service files when it asks for a follow-up. */
export function crmBookingFollowUpTitle(serviceName: string): string {
  const service = String(serviceName ?? '').trim() || 'the booking'
  return `Follow up after ${service}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Weekday (0 = Sunday … 6 = Saturday) of an instant in a timezone. */
function weekdayIn(atMs: number, timezone: string): number {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let label: string
  try {
    label = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(new Date(atMs))
  } catch {
    label = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
    }).format(new Date(atMs))
  }
  const index = weekdays.indexOf(label)
  return index < 0 ? 0 : index
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
export function crmBookingFollowUpDueMs(
  endsAtMs: number,
  timezone?: string | null,
): number {
  const weekday = weekdayIn(endsAtMs, timezone || 'UTC')
  // Friday (5) skips the weekend; Saturday (6) reaches Monday in two days.
  const daysAhead = weekday === 5 ? 3 : weekday === 6 ? 2 : 1
  return endsAtMs + daysAhead * DAY_MS
}
