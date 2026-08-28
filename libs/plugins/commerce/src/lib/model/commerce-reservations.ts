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
 * Reservations v1 (AGL-304): bookable units (cabins) with date-range
 * stays, seasonal pricing, deposits, and cancellation windows —
 * extending the appointment-slot bookings (AGL-159) rather than
 * replacing them. Dates are day-precision epoch-ms at UTC midnight
 * (`dayMs`); nights = checkout day − checkin day. Pure — the
 * reservation APIs and console own I/O.
 */

import type { StorefrontTaxMode } from './commerce-tax-decision'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Seasonal pricing window by month-day (year-agnostic, inclusive). */
export interface ResourceSeason {
  /** 'MM-DD' inclusive start, e.g. '06-01'. */
  from: string
  /** 'MM-DD' inclusive end; may wrap the year (e.g. '12-15'..'01-05'). */
  to: string
  /** Multiplier on the nightly rate, e.g. 1.5 for peak. */
  multiplier: number
  label?: string
}

/** `hosts/{hostId}/resources/{id}` doc. */
export interface HostResource {
  name: string
  description?: string
  /** Sleeps N; display only. */
  capacity?: number
  photoUrls?: string[]
  amenities?: string[]
  nightlyRateUsd: number
  /** Friday/Saturday nights multiply by this (default 1). */
  weekendMultiplier?: number
  seasons?: ResourceSeason[]
  minNights?: number
  /** Deposit due at reservation: percent of total (1-100). */
  depositPct?: number
  /** Free cancellation until this many hours before check-in. */
  cancellationHours?: number
  /** Manually blocked day ranges (maintenance etc.), dayMs pairs. */
  blocks?: Array<{ fromDayMs: number; toDayMs: number }>
}

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show'

/** `hosts/{hostId}/reservations/{id}` doc. */
export interface HostReservation {
  resourceId: string
  status: ReservationStatus
  /** UTC-midnight day of arrival. */
  checkInDayMs: number
  /** UTC-midnight day of departure (exclusive). */
  checkOutDayMs: number
  guestName?: string | null
  guestEmail?: string | null
  nights?: number
  totalCents?: number
  depositCents?: number
  /** Payments applied so far (deposit, folio settlements). */
  paidCents?: number
  /** POS folio lines charged to the stay (AGL-317). */
  folio?: Array<{
    orderId: string
    amountCents: number
    note?: string
    atMs: number
  }>
  checkoutSessionId?: string
  createdAtMs?: number
  /**
   * WHICH tax regime the paid deposit carried (AGL-1969), stamped at
   * confirmation from the same `storefrontTaxModeOf` derivation every order
   * door uses (AGL-2451).
   *
   * `manual` on a stay whose merchant had set a lodging rate
   * (`TaxSettings.lodging`), `none` where they had not — which is the default
   * and every store that has not opted in. Never `stripe-automatic` from this
   * path: Stripe Tax cannot compute occupancy tax without a lodging tax code
   * `reserve.ts` does not send, so the rate is always the merchant's own and
   * is never computed against Aglyn's registrations (AGL-1904).
   *
   * ABSENT is a fourth state and is not `none` — it means the reservation was
   * confirmed before this field existed. See `StorefrontTaxMode`.
   */
  taxMode?: StorefrontTaxMode
  /**
   * The lodging tax charged on top of `paidCents` (AGL-1969), from the
   * merchant's own rate. Absent, never zero, where none was charged.
   *
   * SEPARATE FROM `paidCents` on purpose: that field is the money applied to
   * the STAY and the console divides it by `totalCents` to show what is still
   * owed. Tax is not part of the stay's price and is not the merchant's
   * revenue.
   *
   * LIMITATION, stated rather than decided: this is the rate applied to what
   * was CHARGED, which on a deposit-taking resource is the deposit rather than
   * the stay. Whether a jurisdiction wants occupancy tax on the full stay at
   * booking, on the deposit, or on redemption is not a question this codebase
   * answers — see `reserve.ts` and the merchant copy on the Taxes card.
   */
  taxCents?: number
}

/** UTC midnight for an instant. */
export function toDayMs(atMs: number): number {
  return Math.floor(atMs / DAY_MS) * DAY_MS
}

function monthDay(dayMs: number): string {
  const date = new Date(dayMs)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}-${day}`
}

function inSeason(dayKey: string, season: ResourceSeason): boolean {
  if (season.from <= season.to) {
    return dayKey >= season.from && dayKey <= season.to
  }
  // Wrapping season (e.g. 12-15 .. 01-05).
  return dayKey >= season.from || dayKey <= season.to
}

/** Per-night rate in cents for one specific night. */
export function nightlyRateCents(
  resource: Pick<
    HostResource,
    'nightlyRateUsd' | 'weekendMultiplier' | 'seasons'
  >,
  dayMs: number,
): number {
  let rate = resource.nightlyRateUsd * 100
  const weekday = new Date(dayMs).getUTCDay()
  if ((weekday === 5 || weekday === 6) && resource.weekendMultiplier) {
    rate *= resource.weekendMultiplier
  }
  const dayKey = monthDay(dayMs)
  for (const season of resource.seasons ?? []) {
    if (inSeason(dayKey, season)) {
      rate *= season.multiplier
      break
    }
  }
  return Math.round(rate)
}

export interface ReservationQuote {
  nights: number
  subtotalCents: number
  depositCents: number
  totalCents: number
  /** Per-night breakdown for the quote UI. */
  nightlyCents: number[]
  problem?: string
}

/** Prices a stay; `problem` set (and zeros) when the range is invalid. */
export function computeReservationQuote(
  resource: HostResource,
  checkInDayMs: number,
  checkOutDayMs: number,
): ReservationQuote {
  const empty: ReservationQuote = {
    nights: 0,
    subtotalCents: 0,
    depositCents: 0,
    totalCents: 0,
    nightlyCents: [],
  }
  const nights = Math.round((checkOutDayMs - checkInDayMs) / DAY_MS)
  if (!(nights > 0)) return { ...empty, problem: 'Choose at least one night' }
  if (resource.minNights && nights < resource.minNights) {
    return { ...empty, problem: `Minimum stay is ${resource.minNights} nights` }
  }
  const nightlyCents: number[] = []
  for (let day = checkInDayMs; day < checkOutDayMs; day += DAY_MS) {
    nightlyCents.push(nightlyRateCents(resource, day))
  }
  const subtotalCents = nightlyCents.reduce((sum, cents) => sum + cents, 0)
  const depositPct = Math.min(100, Math.max(0, resource.depositPct ?? 100))
  const depositCents = Math.round((subtotalCents * depositPct) / 100)
  return {
    nights,
    subtotalCents,
    depositCents,
    totalCents: subtotalCents,
    nightlyCents,
  }
}

/**
 * How long an unpaid `pending` reservation stands between the next guest and
 * the dates it named.
 *
 * A `pending` row is written before the Stripe session opens, and nothing ever
 * clears one: `process-abandoned.ts` sweeps `checkouts`, not `reservations`.
 * So the hold has to lapse by the clock rather than by a job, or one guest who
 * closed the tab at the payment screen takes those dates off the market
 * permanently.
 */
export const PENDING_RESERVATION_HOLD_MS = 30 * 60 * 1000

/**
 * Does this reservation still stand between a guest and its dates?
 *
 * THE one answer, because four surfaces ask it — the booking door, the booking
 * transaction's re-read, the storefront availability endpoint behind the
 * date-picker, and the console's walk-in check — and they were not asking it
 * the same way. Only the booking door aged out a stale `pending`, so the
 * storefront painted dates unavailable that the booking door would have sold,
 * and the front desk was told a room was taken while it stood empty.
 *
 * A `pending` row carrying no `createdAtMs` releases rather than holds: an
 * unbounded hold on a row that cannot prove its own age is the failure this
 * lapse exists to prevent, and the booking door re-checks inside its
 * transaction before any money moves.
 */
export function reservationHoldsDates(
  reservation: Pick<HostReservation, 'status'> & { createdAtMs?: number },
  nowMs: number = Date.now(),
): boolean {
  if (reservation.status === 'cancelled' || reservation.status === 'no_show') {
    return false
  }
  if (reservation.status !== 'pending') return true
  const createdAtMs = Number(reservation.createdAtMs ?? 0)
  return createdAtMs > 0 && nowMs - createdAtMs < PENDING_RESERVATION_HOLD_MS
}

/**
 * Availability: a candidate range conflicts when it overlaps a live
 * reservation ([checkIn, checkOut) semantics — back-to-back stays touch
 * without conflict) or a manual block.
 *
 * `nowMs` is a parameter so the pending lapse is testable without freezing the
 * clock. A caller passing reservations without `createdAtMs` gets the same
 * answer as before for every status but `pending`.
 */
export function isRangeAvailable(
  resource: Pick<HostResource, 'blocks'>,
  reservations: Array<
    Pick<HostReservation, 'checkInDayMs' | 'checkOutDayMs' | 'status'> & {
      createdAtMs?: number
    }
  >,
  checkInDayMs: number,
  checkOutDayMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!(checkOutDayMs > checkInDayMs)) return false
  for (const reservation of reservations) {
    if (!reservationHoldsDates(reservation, nowMs)) continue
    if (
      checkInDayMs < reservation.checkOutDayMs &&
      checkOutDayMs > reservation.checkInDayMs
    ) {
      return false
    }
  }
  for (const block of resource.blocks ?? []) {
    if (checkInDayMs < block.toDayMs && checkOutDayMs > block.fromDayMs) {
      return false
    }
  }
  return true
}

/** Free-cancellation check against the policy window. */
export function canCancelReservation(
  resource: Pick<HostResource, 'cancellationHours'>,
  reservation: Pick<HostReservation, 'checkInDayMs' | 'status'>,
  nowMs = Date.now(),
): boolean {
  if (!['pending', 'confirmed'].includes(reservation.status)) return false
  const windowMs = (resource.cancellationHours ?? 0) * 60 * 60 * 1000
  return nowMs <= reservation.checkInDayMs - windowMs
}
