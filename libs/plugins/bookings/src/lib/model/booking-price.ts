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
 * HOW A SERVICE STATES ITS PRICE (AGL-3475).
 *
 * A contractor who quotes at the job has no price to type, and "free" says
 * the wrong thing about work that is not free. So a service states its price
 * one of four ways: the price it charges (the default), or "Price varies",
 * "Free estimate" or "Contact for price". Any of the three labels books with
 * no charge, like an estimate appointment: the stored price is neither shown
 * nor charged, and the business quotes afterwards.
 *
 * The widget, the booking route and the console all read the answer here, so
 * the page never shows a price the route would not charge, and the route
 * never charges one the page did not show.
 *
 * Client-safe: no I/O.
 */

/** How a service states its price. Absent, or anything else, is `fixed`. */
export type BookingPriceDisplay = 'fixed' | 'varies' | 'estimate' | 'contact'

export const BOOKING_PRICE_DISPLAYS: readonly BookingPriceDisplay[] = [
  'fixed',
  'varies',
  'estimate',
  'contact',
]

/** What a visitor reads in place of a price, for each label. */
export const BOOKING_PRICE_LABELS: Readonly<Record<Exclude<BookingPriceDisplay, 'fixed'>, string>> = {
  varies: 'Price varies',
  estimate: 'Free estimate',
  contact: 'Contact for price',
}

/** A stored value as one of the four; anything unrecognized is `fixed`. */
export function bookingPriceDisplay(value: unknown): BookingPriceDisplay {
  return value === 'varies' || value === 'estimate' || value === 'contact' ? value : 'fixed'
}

type PricedService = { priceUsd?: unknown; priceDisplay?: unknown } | null | undefined

/** What booking the service charges, in dollars: its price when it states one, else 0. */
export function bookingChargeUsd(service: PricedService): number {
  if (bookingPriceDisplay(service?.priceDisplay) !== 'fixed') return 0
  const price = Number(service?.priceUsd ?? 0)
  return Number.isFinite(price) && price > 0 ? price : 0
}

/**
 * The price as a visitor reads it: `$120`, `Free`, or the service's label.
 * A label wins over a stored price, which it is never shown beside.
 */
export function bookingPriceText(service: PricedService): string {
  const display = bookingPriceDisplay(service?.priceDisplay)
  if (display !== 'fixed') return BOOKING_PRICE_LABELS[display]
  const charge = bookingChargeUsd(service)
  return charge > 0 ? `$${charge}` : 'Free'
}
