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

import { bookingState, type BookingState } from './booking-manage'

/**
 * A booking as the customer REST API publishes it (AGL-3643):
 * `GET /v1/sites/{siteId}/bookings/{bookingId}`, and the `booking` every
 * booking event carries, so a subscriber reads one documented object rather
 * than the plugin's storage.
 *
 * Money is integer cents, in US dollars — a booking is charged in USD. Times
 * are ISO 8601 in UTC, with the zone the booking was made in beside them.
 * Never Stripe's handles, the CRM reference or the reminder stamps: those are
 * how the platform runs a booking, not what one is.
 *
 * Pure: no I/O, so the API handler, the event raisers and a spec share it.
 */
export interface BookingView {
  id: string
  object: 'booking'
  serviceId: string | null
  serviceName: string | null
  /**
   * `confirmed`, `pendingPayment` (a paid booking whose checkout is still
   * open), `expired` (that checkout ran out and the slot was released) or
   * `canceled`.
   */
  status: BookingState
  name: string | null
  email: string | null
  phone: string | null
  address: Record<string, unknown> | string | null
  startsAt: string | null
  endsAt: string | null
  timeZone: string | null
  currency: 'usd'
  /** What the guest paid, tax included; 0 for a free booking. */
  paidCents: number
  taxCents: number
  refundedCents: number
  checkedIn: boolean
  checkedInAt: string | null
  /** Where a moved booking started before its latest move, else `null`. */
  rescheduledFrom: string | null
  created: string | null
}

const text = (value: unknown): string | null => {
  const out = typeof value === 'string' ? value.trim() : ''
  return out ? out : null
}

const cents = (value: unknown): number => {
  const out = Math.round(Number(value ?? 0))
  return Number.isFinite(out) && out > 0 ? out : 0
}

/** Epoch milliseconds, a Firestore Timestamp or a Date, as ISO 8601. */
export function bookingInstant(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const stamp = value as { toMillis?: () => number; toDate?: () => Date }
  if (typeof stamp.toMillis === 'function') return bookingInstant(stamp.toMillis())
  if (typeof stamp.toDate === 'function') return bookingInstant(stamp.toDate())
  return null
}

function addressOf(value: unknown): BookingView['address'] {
  if (typeof value === 'string') return text(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) }
  return null
}

/** One stored booking as the API publishes it. `nowMs` decides an expired hold. */
export function bookingViewFromData(id: string, data: Record<string, unknown>, nowMs = Date.now()): BookingView {
  const checkedInAtMs = Number(data['checkedInAtMs'] ?? 0)
  return {
    id,
    object: 'booking',
    serviceId: text(data['serviceId']),
    serviceName: text(data['serviceName']),
    status: bookingState(
      {
        status: typeof data['status'] === 'string' ? data['status'] : undefined,
        expiresAtMs: Number(data['expiresAtMs'] ?? 0) || undefined,
      },
      nowMs,
    ),
    name: text(data['name']),
    email: text(data['email']),
    phone: text(data['phone']),
    address: addressOf(data['address']),
    startsAt: bookingInstant(Number(data['startsAtMs'] ?? 0)),
    endsAt: bookingInstant(Number(data['endsAtMs'] ?? 0)),
    timeZone: text(data['timezone']),
    currency: 'usd',
    paidCents: cents(data['paidAmountCents']),
    taxCents: cents(data['taxCents']),
    refundedCents: cents(data['refundedCents']),
    checkedIn: checkedInAtMs > 0,
    checkedInAt: checkedInAtMs > 0 ? bookingInstant(checkedInAtMs) : null,
    rescheduledFrom: bookingInstant(Number(data['rescheduledFromMs'] ?? 0)),
    created: bookingInstant(data['createdAt']),
  }
}
