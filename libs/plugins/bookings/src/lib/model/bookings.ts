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

// Leaf paths, not the barrel: this model is read by the client bundle and
// the `/server` entry alike, and either barrel would drag the other's
// surface into a bundle that has no use for it.
import {
  BOOKING_SERVICE_PARAM,
  CRM_BOOKING_REF_PARAM,
  type CrmBookingRef,
  formatCrmBookingRef,
} from '@aglyn/aglyn/app-utils/crm-booking'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'

/**
 * Bookings v1 (AGL-159): services with weekly availability windows and
 * pure, timezone-explicit slot computation. All times are minutes since
 * midnight in the HOST's timezone; instants are epoch milliseconds. No
 * I/O here — collision checks against stored bookings happen in the
 * booking API over the values these helpers produce.
 */

/** `hosts/{hostId}/services/{id}` doc. */
export interface HostBookingService {
  name: string
  durationMinutes: number
  description?: string
  /** Optional price; 0/absent means free. */
  priceUsd?: number
  /**
   * Weekly availability: `windows[weekday]` (0 = Sunday … 6 = Saturday)
   * lists open intervals in minutes since midnight, host-local.
   */
  windows?: Partial<Record<number, Array<{ start: number; end: number }>>>
  /** IANA timezone the windows are defined in, e.g. "America/Chicago". */
  timezone?: string
  /**
   * Create a follow-up task on the CRM record when this service is booked
   * (AGL-2660) — due one business day after the slot, on whoever holds the
   * relationship. Off unless the service says so.
   */
  crmFollowUpTask?: boolean
  /**
   * File the booking as a `meeting` on the CRM record's timeline (AGL-2660).
   * Absent means ON: a booking is a meeting the record has, and the service
   * has to opt out of saying so.
   */
  crmMeetingActivity?: boolean
}

/** Booked interval as epoch-ms instants. */
export interface BookedInterval {
  startsAtMs: number
  endsAtMs: number
}

export const BOOKING_MIN_DURATION_MINUTES = 5
export const BOOKING_MAX_DURATION_MINUTES = 8 * 60
/** Slot enumeration horizon; the console/API never look further out. */
export const BOOKING_MAX_DAYS_AHEAD = 60

/**
 * The band a booking has to fall in to earn its 24-hour reminder, in hours
 * from now (AGL-160, scheduled in AGL-2431).
 *
 * IN THE MODEL, not beside the scan that uses them, so the console card can
 * apply the identical window without importing server code into a client
 * bundle. That sharing is the point rather than a convenience: a card that
 * drew its own boundary would report a queue depth the job does not act on,
 * and a merchant checking whether reminders are working would be reading a
 * number produced by different arithmetic than the sender's.
 */
export const REMINDER_WINDOW_START_HOURS = 23
export const REMINDER_WINDOW_END_HOURS = 25

/**
 * Whether `booking` is one this pass would mail — the three tests the scan
 * applies, in one place both halves call.
 *
 * `nowMs` is a parameter and not `Date.now()` so the card and the job can be
 * asked the same question about the same instant, and so a test can pin a
 * booking exactly on either edge of the band.
 */
export function isBookingReminderDue(
  booking: {
    status?: string
    email?: string
    reminderSentAt?: unknown
    startsAtMs?: number
  },
  nowMs: number,
): boolean {
  const startsAtMs = Number(booking.startsAtMs ?? 0)
  return (
    booking.status !== 'canceled' &&
    !booking.reminderSentAt &&
    Boolean(booking.email) &&
    startsAtMs >= nowMs + REMINDER_WINDOW_START_HOURS * 60 * 60 * 1000 &&
    startsAtMs <= nowMs + REMINDER_WINDOW_END_HOURS * 60 * 60 * 1000
  )
}

/** Weekday (0-6) and minutes-since-midnight of an instant in a timezone. */
function localParts(
  atMs: number,
  timezone: string,
): { weekday: number; minutes: number; dayKey: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(atMs))) {
    parts[part.type] = part.value
  }
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    weekday: weekdays.indexOf(parts['weekday'] ?? 'Sun'),
    // "24" appears for midnight under hour12:false in some engines.
    minutes: (Number(parts['hour'] === '24' ? 0 : parts['hour']) % 24) * 60 +
      Number(parts['minute']),
    dayKey: `${parts['year']}-${parts['month']}-${parts['day']}`,
  }
}

export interface BookingSlot {
  startsAtMs: number
  endsAtMs: number
}

/**
 * Enumerates open slots for a service between two instants: windows are
 * walked in the service timezone, quantized to the service duration, and
 * intervals overlapping `booked` (or starting before `fromMs`) drop out.
 * Bounded: at most `limit` slots, never beyond BOOKING_MAX_DAYS_AHEAD.
 */
export function computeOpenSlots(
  service: HostBookingService,
  fromMs: number,
  toMs: number,
  booked: BookedInterval[] = [],
  limit = 200,
): BookingSlot[] {
  const timezone = service.timezone || 'UTC'
  const duration = Math.min(
    Math.max(
      Math.round(service.durationMinutes || 0),
      BOOKING_MIN_DURATION_MINUTES,
    ),
    BOOKING_MAX_DURATION_MINUTES,
  )
  const durationMs = duration * 60_000
  const horizonMs = Math.min(
    toMs,
    fromMs + BOOKING_MAX_DAYS_AHEAD * 24 * 60 * 60_000,
  )
  const slots: BookingSlot[] = []
  // Walk in 15-minute steps and keep instants that start a window-aligned
  // slot — O(minutes/15) and immune to DST arithmetic because weekday and
  // minutes come from Intl per instant.
  const stepMs = 15 * 60_000
  const alignedFrom = Math.ceil(fromMs / stepMs) * stepMs
  for (
    let atMs = alignedFrom;
    atMs + durationMs <= horizonMs && slots.length < limit;
    atMs += stepMs
  ) {
    const { weekday, minutes } = localParts(atMs, timezone)
    const windows = service.windows?.[weekday] ?? []
    const fitsWindow = windows.some(
      (window) =>
        minutes >= window.start && minutes + duration <= window.end,
    )
    if (!fitsWindow) continue
    const endMs = atMs + durationMs
    const collides = booked.some(
      (interval) =>
        atMs < interval.endsAtMs && endMs > interval.startsAtMs,
    )
    if (collides) continue
    slots.push({ startsAtMs: atMs, endsAtMs: endMs })
  }
  return slots
}

/** True when the exact slot is open for the service (booking API check). */
export function isSlotOpen(
  service: HostBookingService,
  startsAtMs: number,
  booked: BookedInterval[] = [],
): boolean {
  const slots = computeOpenSlots(
    service,
    startsAtMs,
    startsAtMs + BOOKING_MAX_DURATION_MINUTES * 60_000,
    booked,
    1,
  )
  return slots.length > 0 && slots[0].startsAtMs === startsAtMs
}

/**
 * The page on the site that holds the Booking block, as the plugin's
 * `bookingPath` setting stores it (AGL-2660). The site root by default: a
 * site that put the block on its home page needs no setting, and a site
 * that put it elsewhere says where once, per site.
 */
export const BOOKING_PATH_DEFAULT = '/'

/** `/book`, `book/`, ` /book?x ` → `/book`; anything empty → the root. */
export function normalizeBookingPath(raw: unknown): string {
  const text = String(raw ?? '')
    .trim()
    .split(/[?#]/)[0]
  if (!text) return BOOKING_PATH_DEFAULT
  const leading = text.startsWith('/') ? text : `/${text}`
  const trimmed = leading.replace(/\/+$/, '')
  return trimmed || BOOKING_PATH_DEFAULT
}

export interface BookingLinkInput {
  /** The host's public naming — its custom domain or its subdomain. */
  site: { cname?: string | null; subdomain?: string | null } | null | undefined
  /** The service the link opens the widget on. */
  service: { id: string }
  /** The site's `bookingPath` setting; the root when unset. */
  path?: string | null
  /** The CRM record the link is dropped from, when there is one. */
  crmRef?: CrmBookingRef | null
}

/**
 * The public URL a visitor books a service at (AGL-2660), or `null` for a
 * site with no public origin yet.
 *
 * PER SERVICE, not per member: the model carries no staff or per-member
 * notion — a service has one calendar — so there is one link per service
 * and nothing narrower. The Bookings plugin renders no route of its own
 * either; the widget is a block the site owner placed on a page, so the
 * link is that page (the `bookingPath` setting) with the service
 * preselected and, when dropped from a CRM record, the record carried
 * along so the booking can be attributed even when the booker uses a
 * different address.
 */
export function bookingLinkFor(input: BookingLinkInput): string | null {
  const origin = hostPublicOrigin(input.site)
  if (!origin) return null
  const query = new URLSearchParams({ [BOOKING_SERVICE_PARAM]: input.service.id })
  if (input.crmRef) query.set(CRM_BOOKING_REF_PARAM, formatCrmBookingRef(input.crmRef))
  return `${origin}${normalizeBookingPath(input.path)}?${query.toString()}`
}
