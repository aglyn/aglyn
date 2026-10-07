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
 * What a site's team may do to a booking once it exists (AGL-3621): check
 * the guest in, move it, cancel it. One pure rule set, read by the routes
 * that do it (`bookings/check-in`, `bookings/reschedule`) under their own
 * transaction, and the rules a client mirrors to decide what to OFFER (the
 * native Aglyn app's bookings screens port them, cased by this file's spec),
 * so a screen can only offer what the route would then do.
 *
 * No I/O and no React, so client and server code alike may import it.
 */

/** `hosts/{hostId}/bookings/{id}`, the fields these rules read. */
export interface ManagedBooking {
  status?: string
  startsAtMs?: number
  endsAtMs?: number
  expiresAtMs?: number
  paidAmountCents?: number
  refundedCents?: number
  checkedInAtMs?: number
}

export type BookingState = 'confirmed' | 'pendingPayment' | 'expired' | 'canceled'

/**
 * The booking's state as a reader should treat it. A payment hold whose
 * fifteen minutes ran out released its slot (AGL-170) even while the
 * document still says `pendingPayment`.
 */
export function bookingState(booking: ManagedBooking, nowMs: number): BookingState {
  if (booking.status === 'canceled') return 'canceled'
  if (booking.status === 'pendingPayment') {
    return Number(booking.expiresAtMs ?? 0) < nowMs ? 'expired' : 'pendingPayment'
  }
  return 'confirmed'
}

export const BOOKING_STATE_LABELS: Readonly<Record<BookingState, string>> = {
  confirmed: 'Confirmed',
  pendingPayment: 'Awaiting payment',
  expired: 'Payment not finished',
  canceled: 'Canceled',
}

/** The paid amount not yet refunded, in cents. */
export function bookingOutstandingCents(booking: ManagedBooking): number {
  const paid = Math.max(0, Math.round(Number(booking.paidAmountCents ?? 0)))
  const refunded = Math.max(0, Math.round(Number(booking.refundedCents ?? 0)))
  return Math.max(0, paid - refunded)
}

export interface BookingActions {
  checkIn: boolean
  undoCheckIn: boolean
  reschedule: boolean
  /** Cancel; with `refundCents` above zero the cancel goes through the refund route. */
  cancel: boolean
  refundCents: number
}

/**
 * What may be done to a booking now. A guest is checked in only on a
 * confirmed booking; a booking moves only while it is confirmed and has not
 * ended; and nothing is done to a canceled one.
 */
export function bookingActions(booking: ManagedBooking, nowMs: number): BookingActions {
  const state = bookingState(booking, nowMs)
  const confirmed = state === 'confirmed'
  const checkedIn = Number(booking.checkedInAtMs ?? 0) > 0
  const ended = Number(booking.endsAtMs ?? 0) <= nowMs
  return {
    checkIn: confirmed && !checkedIn,
    undoCheckIn: confirmed && checkedIn,
    reschedule: confirmed && !checkedIn && !ended,
    cancel: state !== 'canceled' && !checkedIn,
    refundCents: bookingOutstandingCents(booking),
  }
}

/** Why a check-in (or its undo) cannot be written, or null. The route's own refusal. */
export function checkInRefusal(booking: ManagedBooking, checkedIn: boolean, nowMs: number): string | null {
  const state = bookingState(booking, nowMs)
  if (state === 'canceled') return 'This booking was canceled'
  if (state !== 'confirmed') return 'This booking is not paid yet'
  return checkedIn || Number(booking.checkedInAtMs ?? 0) > 0 ? null : 'This guest is not checked in'
}

/** Why a booking cannot move to `startsAtMs`, or null. The slot itself is checked apart. */
export function rescheduleRefusal(booking: ManagedBooking, startsAtMs: number, nowMs: number): string | null {
  const state = bookingState(booking, nowMs)
  if (state === 'canceled') return 'This booking was canceled'
  if (state !== 'confirmed') return 'This booking is not paid yet'
  if (Number(booking.checkedInAtMs ?? 0) > 0) return 'This guest is already checked in'
  if (Number(booking.endsAtMs ?? 0) <= nowMs) return 'This booking has already ended'
  if (!Number.isFinite(startsAtMs) || startsAtMs <= nowMs) return 'Pick a time that has not passed'
  return null
}

/** The booking's length, kept when it moves: what the guest booked, not what the service says today. */
export function bookingDurationMs(booking: ManagedBooking, fallbackMinutes: number): number {
  const stored = Number(booking.endsAtMs ?? 0) - Number(booking.startsAtMs ?? 0)
  return stored > 0 ? stored : Math.max(5, Math.round(fallbackMinutes || 30)) * 60_000
}
