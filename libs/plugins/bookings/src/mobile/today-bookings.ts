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

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'
import {
  bookingDayRange,
  bookingInPersonState,
  bookingSuggestedCents,
  type BookingInPersonState,
  type BookingPaymentFields,
} from '../lib/model/booking-in-person'

/*==========================================
 * TODAY'S BOOKINGS AT THE COUNTER (AGL-3618).
 *
 * Read with the Firebase JS SDK under the console's own rules (a site member
 * reads `hosts/{hostId}/bookings`), one range on `startsAtMs`, which needs
 * only Firestore's automatic single-field index. Money moves only through
 * `bookings/in-person-payment`.
 *=========================================*/

export interface CounterBooking {
  id: string
  serviceId: string
  serviceName: string
  name: string
  startsAtMs: number
  endsAtMs: number
  state: BookingInPersonState
  /** What a paid booking took, whole charge. */
  paidAmountCents: number
  /** The service's fixed price, as the amount to suggest. */
  suggestedCents: number | null
}

/** A day holds at most this many bookings on the counter list. */
export const COUNTER_BOOKINGS_LIMIT = 100

export function counterBookingFrom(
  id: string,
  data: Record<string, unknown>,
  suggestedCents: number | null,
  nowMs = Date.now(),
): CounterBooking {
  return {
    id,
    serviceId: String(data['serviceId'] ?? ''),
    serviceName: String(data['serviceName'] ?? '') || 'Appointment',
    name: String(data['name'] ?? '') || String(data['email'] ?? '') || 'Guest',
    startsAtMs: Number(data['startsAtMs'] ?? 0),
    endsAtMs: Number(data['endsAtMs'] ?? 0),
    state: bookingInPersonState(data as BookingPaymentFields, nowMs),
    paidAmountCents: Math.max(0, Math.round(Number(data['paidAmountCents'] ?? 0))),
    suggestedCents,
  }
}

/**
 * Today's bookings for one site, earliest first, without canceled ones. Each
 * service's fixed price is read once, so a booking can suggest its amount.
 */
export async function loadCounterBookings(
  firestore: Firestore,
  hostId: string,
  nowMs = Date.now(),
): Promise<CounterBooking[]> {
  const { startMs, endMs } = bookingDayRange(nowMs)
  const snapshot = await getDocs(
    query(
      collection(firestore, 'hosts', hostId, 'bookings'),
      where('startsAtMs', '>=', startMs),
      where('startsAtMs', '<', endMs),
      orderBy('startsAtMs', 'asc'),
      limit(COUNTER_BOOKINGS_LIMIT),
    ),
  )
  const serviceIds = [
    ...new Set(snapshot.docs.map((entry) => String(entry.get('serviceId') ?? '')).filter(Boolean)),
  ]
  const prices = new Map<string, number | null>()
  await Promise.all(
    serviceIds.map(async (serviceId) => {
      const service = await getDoc(doc(firestore, 'hosts', hostId, 'services', serviceId)).catch(() => null)
      prices.set(
        serviceId,
        bookingSuggestedCents(service?.exists() ? (service.data() as { priceUsd?: number; priceDisplay?: string }) : null),
      )
    }),
  )
  return snapshot.docs
    .map((entry) =>
      counterBookingFrom(
        entry.id,
        entry.data(),
        prices.get(String(entry.get('serviceId') ?? '')) ?? null,
        nowMs,
      ),
    )
    .filter((booking) => booking.state !== 'canceled')
}

/** Whole cents as "$12.50". */
export function formatUsd(cents: number): string {
  return `$${(Math.max(0, Math.round(cents)) / 100).toFixed(2)}`
}

/** "$12.50" or "12.5" as whole cents; null when it is not an amount. */
export function centsFromText(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const cents = Math.round(Number(cleaned) * 100)
  return Number.isFinite(cents) ? cents : null
}
