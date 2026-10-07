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
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
// The leaf entry: the package root extends the Firestore SDK's `Timestamp`,
// and this model is read on published pages.
import { zonedDateTime } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  BOOKING_RECORD_PARAM,
  BOOKING_SERVICE_PARAM,
  type BookingRecordRef,
  formatBookingRecordRef,
} from './booking-record'

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
   * How the price is stated (AGL-3475): `fixed` (absent) charges `priceUsd`;
   * `varies`, `estimate` and `contact` show their label and book with no
   * charge. Read through `bookingPriceDisplay` / `bookingChargeUsd`.
   */
  priceDisplay?: 'fixed' | 'varies' | 'estimate' | 'contact'
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
  /**
   * Ask the booker for a phone number (AGL-3493): `optional` or `required`;
   * absent is off. Read through `bookingFieldAsk`.
   */
  askPhone?: 'off' | 'optional' | 'required'
  /** Ask the booker for the address the service is at (AGL-3493); as above. */
  askAddress?: 'off' | 'optional' | 'required'
  /**
   * Whether the service takes bookings (AGL-3616). A `draft` is set up and
   * offered nowhere: the public listing leaves it out, its slots are not
   * served and the booking route refuses it, until someone activates it in
   * the console. Absent is `active`, so every service made before the field
   * existed keeps taking bookings. Read through `bookingServiceStatus`.
   */
  status?: BookingServiceStatus
}

/** Whether a service takes bookings (AGL-3616). */
export type BookingServiceStatus = 'draft' | 'active'

/** The status as stored, read so only an explicit `draft` holds a service back. */
export function bookingServiceStatus(value: unknown): BookingServiceStatus {
  return value === 'draft' ? 'draft' : 'active'
}

/**
 * Whether a stored service is offered to visitors (AGL-3616): not deleted,
 * and not a draft. The one predicate every public read asks — the service
 * directory, a service's slots, the booking route — and the console's
 * booking-link picker, which hands visitors a link to the same door.
 */
export function bookingServiceIsOffered(
  service: { deletedAt?: unknown; status?: unknown } | null | undefined,
): boolean {
  return Boolean(service) && !service?.deletedAt && bookingServiceStatus(service?.status) === 'active'
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

export interface BookingSlot {
  startsAtMs: number
  endsAtMs: number
}

/** The walk's resolution: a slot may start on any quarter hour. */
export const BOOKING_SLOT_STEP_MINUTES = 15

/**
 * The most starts one calendar day can hold at that resolution — 96. The
 * per-day unit every bound on a slot listing is counted in.
 */
export const BOOKING_MAX_SLOTS_PER_DAY =
  (24 * 60) / BOOKING_SLOT_STEP_MINUTES

/**
 * Days of open times one slot listing answers with, and the length of the
 * Booking widget's day strip (AGL-3492). One constant, read by both halves:
 * the listing is bounded in DAYS so every day the strip shows carries every
 * open time it has. A flat slot count was the bound before, and at 15-minute
 * steps 120 of them ran out three and a half days in — the widget then drew
 * those days as the whole calendar and cut the fourth at lunch.
 */
export const BOOKING_SLOT_PAGE_DAYS = 14

/**
 * The hard ceiling on one listing: a page of days, every one of them open
 * around the clock. Only a service that really is open that much reaches it,
 * and the page then ends early with its next page named, never truncated
 * silently.
 */
export const BOOKING_SLOT_PAGE_MAX_SLOTS =
  BOOKING_SLOT_PAGE_DAYS * BOOKING_MAX_SLOTS_PER_DAY

/**
 * Walks the open slots of a service from `fromMs`, handing each to `take`
 * with the service-local day it falls on, until `take` answers `false` or
 * the walk reaches `toMs` (never more than BOOKING_MAX_DAYS_AHEAD past
 * `fromMs`). Answers where it stopped: the first start it did not hand over
 * — the slot `take` refused, or the first one past the walked range — and
 * whether that was `toMs` itself, so nothing is left to walk.
 *
 * Windows are read in the service timezone, 15 minutes at a time —
 * O(minutes/15) and immune to DST arithmetic because weekday and minutes
 * come from Intl per instant. Intervals overlapping `booked` drop out.
 */
function walkOpenSlots(
  service: HostBookingService,
  fromMs: number,
  toMs: number,
  booked: BookedInterval[],
  take: (slot: BookingSlot, dayKey: string) => boolean,
): { stoppedAtMs: number; reachedEnd: boolean } {
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
  const stepMs = BOOKING_SLOT_STEP_MINUTES * 60_000
  let atMs = Math.ceil(fromMs / stepMs) * stepMs
  for (; atMs + durationMs <= horizonMs; atMs += stepMs) {
    const { year, month, day, weekday, hour, minute } = zonedDateTime(
      atMs,
      timezone,
    )
    const minutes = hour * 60 + minute
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
    if (!take({ startsAtMs: atMs, endsAtMs: endMs }, `${year}-${month}-${day}`)) {
      return { stoppedAtMs: atMs, reachedEnd: false }
    }
  }
  // The first start the walk did not try, not the horizon itself: a slot
  // that starts before the cap and ends after it belongs to the next walk.
  return { stoppedAtMs: atMs, reachedEnd: horizonMs >= toMs }
}

/**
 * Enumerates open slots for a service between two instants. Bounded: at
 * most `limit` slots, never beyond BOOKING_MAX_DAYS_AHEAD.
 */
export function computeOpenSlots(
  service: HostBookingService,
  fromMs: number,
  toMs: number,
  booked: BookedInterval[] = [],
  limit = 200,
): BookingSlot[] {
  const slots: BookingSlot[] = []
  if (limit <= 0) return slots
  walkOpenSlots(service, fromMs, toMs, booked, (slot) => {
    slots.push(slot)
    return slots.length < limit
  })
  return slots
}

/** One page of a slot listing (AGL-3492). */
export interface BookingSlotPage {
  /** Every open slot of the page's days, in order. */
  slots: BookingSlot[]
  /**
   * Where the next page starts, or `null` once the page reached `toMs`.
   * Every open slot before it is in `slots` — the guarantee a reader needs
   * to tell a day it holds whole from one the page ended inside.
   */
  nextFromMs: number | null
}

/**
 * The open slots of the next `days` service-local days that have any, from
 * `fromMs` up to `toMs` — whole days, never a day cut part way through
 * (AGL-3492). `maxSlots` is the ceiling for a service open around the clock;
 * reaching it ends the page early with `nextFromMs` naming the first slot
 * left out. A walk is also never longer than BOOKING_MAX_DAYS_AHEAD, so a
 * horizon further out than that is answered a page at a time.
 */
export function computeOpenSlotPage(
  service: HostBookingService,
  fromMs: number,
  toMs: number,
  booked: BookedInterval[] = [],
  {
    days = BOOKING_SLOT_PAGE_DAYS,
    maxSlots = BOOKING_SLOT_PAGE_MAX_SLOTS,
  }: { days?: number; maxSlots?: number } = {},
): BookingSlotPage {
  const slots: BookingSlot[] = []
  const dayKeys = new Set<string>()
  const { stoppedAtMs, reachedEnd } = walkOpenSlots(
    service,
    fromMs,
    toMs,
    booked,
    (slot, dayKey) => {
      if (
        slots.length >= maxSlots ||
        (!dayKeys.has(dayKey) && dayKeys.size >= days)
      ) {
        return false
      }
      dayKeys.add(dayKey)
      slots.push(slot)
      return true
    },
  )
  return {
    slots,
    nextFromMs: reachedEnd ? null : stoppedAtMs,
  }
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
  /** The record the link is dropped from, when there is one. */
  recordRef?: BookingRecordRef | null
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
 * preselected and, when dropped from a record, the record carried
 * along so the booking can be attributed even when the booker uses a
 * different address.
 */
export function bookingLinkFor(input: BookingLinkInput): string | null {
  const origin = hostPublicOrigin(input.site)
  if (!origin) return null
  const query = new URLSearchParams({ [BOOKING_SERVICE_PARAM]: input.service.id })
  if (input.recordRef) query.set(BOOKING_RECORD_PARAM, formatBookingRecordRef(input.recordRef))
  return `${origin}${normalizeBookingPath(input.path)}?${query.toString()}`
}
