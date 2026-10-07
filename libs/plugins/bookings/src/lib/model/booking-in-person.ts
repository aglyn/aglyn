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

/*==========================================
 * TAKING PAYMENT FOR A BOOKING IN PERSON (AGL-3618).
 *
 * A booking whose price was not charged online (a free booking, or one whose
 * price `varies`, is an `estimate` or is `contact`) is paid at the counter
 * once the work is done: staff type the amount and the customer taps or
 * inserts a card on the register's reader. Pure: the server route, the
 * console and the Aglyn POS app all read a booking through these.
 *
 * Imports nothing, so a native app may import it.
 *=========================================*/

/** The in-person payment a booking carries while it is being taken. */
export interface BookingInPersonPayment {
  paymentIntentId: string
  /** The whole charge: service plus tax. */
  amountCents: number
  /** The service amount staff typed, before tax. */
  serviceCents: number
  taxCents: number
  feeCents: number
  status: 'pending' | 'paid' | 'canceled'
  startedAtMs: number
  startedBy: string
  paidAtMs?: number
  /** Which start request made it, so a retried start returns it again. */
  attempt?: string
}

/** The fields of a booking this reads; any booking document has them. */
export interface BookingPaymentFields {
  status?: string
  expiresAtMs?: number
  paidAmountCents?: number
  refundedCents?: number
  paymentIntentId?: string
  inPersonPayment?: Partial<BookingInPersonPayment> | null
}

export type BookingInPersonState =
  /** Paid already, online or in person. */
  | 'paid'
  /** Canceled: nothing to pay. */
  | 'canceled'
  /** Still holding for its online Checkout: the customer is paying there. */
  | 'awaiting-online'
  /** A card is being taken for it now. */
  | 'collecting'
  /** Can be paid at the counter. */
  | 'payable'

export function bookingInPersonState(
  booking: BookingPaymentFields,
  nowMs = Date.now(),
): BookingInPersonState {
  if (
    Math.round(Number(booking.paidAmountCents ?? 0)) > 0 ||
    Boolean(booking.paymentIntentId) ||
    booking.inPersonPayment?.status === 'paid'
  ) {
    return 'paid'
  }
  if (booking.status === 'canceled') return 'canceled'
  if (booking.status === 'pendingPayment') {
    // A lapsed online hold released its slot; it is not an appointment.
    return Number(booking.expiresAtMs ?? 0) < nowMs ? 'canceled' : 'awaiting-online'
  }
  if (booking.inPersonPayment?.status === 'pending') return 'collecting'
  return 'payable'
}

/** The most one in-person booking charge may be: $10,000. */
export const BOOKING_IN_PERSON_MAX_CENTS = 1_000_000
/** Stripe's card minimum in USD. */
export const BOOKING_IN_PERSON_MIN_CENTS = 50

/** Null when `serviceCents` is an amount staff may charge; otherwise why not. */
export function bookingInPersonAmountProblem(serviceCents: unknown): string | null {
  if (typeof serviceCents !== 'number' || !Number.isInteger(serviceCents)) {
    return 'Enter the amount to charge.'
  }
  if (serviceCents < BOOKING_IN_PERSON_MIN_CENTS) return 'Card payments start at $0.50.'
  if (serviceCents > BOOKING_IN_PERSON_MAX_CENTS) return 'Charge at most $10,000 at a time.'
  return null
}

/**
 * The amount to suggest: the service's fixed price, when it has one. A
 * `varies`, `estimate` or `contact` price suggests nothing; staff type it.
 */
export function bookingSuggestedCents(service: {
  priceUsd?: number
  priceDisplay?: string
} | null | undefined): number | null {
  if (!service) return null
  if (service.priceDisplay && service.priceDisplay !== 'fixed') return null
  const cents = Math.round(Number(service.priceUsd ?? 0) * 100)
  return Number.isFinite(cents) && cents >= BOOKING_IN_PERSON_MIN_CENTS ? cents : null
}

/** The start and end of the local day that holds `atMs`, in milliseconds. */
export function bookingDayRange(atMs: number, offsetMinutes = new Date(atMs).getTimezoneOffset()): {
  startMs: number
  endMs: number
} {
  const local = atMs - offsetMinutes * 60_000
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000
  const startMs = dayStart + offsetMinutes * 60_000
  return { startMs, endMs: startMs + 86_400_000 }
}
