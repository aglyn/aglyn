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
