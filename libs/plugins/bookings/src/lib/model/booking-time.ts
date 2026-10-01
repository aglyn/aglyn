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

// The leaf, not the barrel: this model is read by the client bundle too, and
// the zone rules are a dependency-free module.
import {
  isSupportedTimeZone,
  resolveSiteTimeZone,
} from '@aglyn/aglyn/app-utils/collection-entry-date'

/**
 * The zone a booking's time is told in, to the guest and to the site's
 * managers alike (AGL-3432).
 *
 * THE SERVICE WINS: its weekly windows are defined in its own zone, so that is
 * the zone the slot was offered in. A service that names none (or names one
 * this runtime no longer accepts) reads in the site's zone, then the
 * workspace's, then UTC — `resolveSiteTimeZone`'s chain, so a booking and the
 * site's own dates agree.
 *
 * Every candidate is validated, never trusted: a zone that cannot format would
 * throw a `RangeError` in the middle of a send.
 */
export function bookingTimeZone(input: {
  service?: { timezone?: unknown } | null
  host?: { timeZone?: string } | null
  org?: { timeZone?: string } | null
}): string {
  const serviceZone = String(input.service?.timezone ?? '').trim()
  if (isSupportedTimeZone(serviceZone)) return serviceZone
  return resolveSiteTimeZone(input.org ?? null, input.host ?? null)
}

/**
 * The zone a booking document carries, when it carries a usable one.
 *
 * Bookings written before the zone was stored have none, and a reader then
 * resolves it from the service and site with {@link bookingTimeZone}.
 */
export function storedBookingTimeZone(booking: {
  timezone?: unknown
} | null | undefined): string | undefined {
  const zone = String(booking?.timezone ?? '').trim()
  return isSupportedTimeZone(zone) ? zone : undefined
}

/**
 * A booking's start as a guest reads it — "Friday, April 24, 2026 at 3:00 PM"
 * — in `timeZone`. The caller names the zone beside it; the string alone does
 * not say which zone it is in.
 *
 * Never the server's own zone: a formatter with no `timeZone` reads in UTC on
 * the platform's servers and prints a wall-clock time hours away from the
 * appointment. An unusable zone formats in UTC, which is what the caller then
 * names.
 */
export function formatBookingWhen(startsAtMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: isSupportedTimeZone(timeZone) ? timeZone : 'UTC',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(startsAtMs))
}
