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
 * Availability: a candidate range conflicts when it overlaps a live
 * reservation ([checkIn, checkOut) semantics — back-to-back stays touch
 * without conflict) or a manual block.
 */
export function isRangeAvailable(
  resource: Pick<HostResource, 'blocks'>,
  reservations: Array<
    Pick<HostReservation, 'checkInDayMs' | 'checkOutDayMs' | 'status'>
  >,
  checkInDayMs: number,
  checkOutDayMs: number,
): boolean {
  if (!(checkOutDayMs > checkInDayMs)) return false
  const dead = new Set<ReservationStatus>(['cancelled', 'no_show'])
  for (const reservation of reservations) {
    if (dead.has(reservation.status)) continue
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
