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
  definePluginDomainEvent,
  type PluginDomainEvent,
  type PluginDomainEventDeclaration,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type { BookingView } from './booking-view'

/**
 * The booking events the bookings plugin raises (AGL-3643), for other
 * plugins — the merchant's Zapier connections first — through core's
 * domain-event outbox: written when the fact is, delivered at least once,
 * retried with backoff. A subscriber names the event and never imports this
 * plugin.
 *
 * Each payload is `{ booking }` in the public API's shape
 * (`GET /v1/sites/{siteId}/bookings/{bookingId}`), as it stood once the fact
 * was written.
 *
 * - `booking.created`: a booking is confirmed — a free one when it is made,
 *   a paid one when its payment lands. A checkout the guest never finished
 *   raises nothing.
 * - `booking.rescheduled`: the site's team moved it to another time; one
 *   event per move.
 * - `booking.canceled`: it was canceled — a free one by the site's team, a
 *   paid one by the refund that gave all of the money back.
 */
export interface BookingEventPayload {
  booking: BookingView
}

export const BOOKING_CREATED_EVENT = definePluginDomainEvent<BookingEventPayload>('booking.created')
export const BOOKING_RESCHEDULED_EVENT = definePluginDomainEvent<BookingEventPayload>('booking.rescheduled')
export const BOOKING_CANCELED_EVENT = definePluginDomainEvent<BookingEventPayload>('booking.canceled')

export type BookingEventName = 'booking.created' | 'booking.rescheduled' | 'booking.canceled'

export const BOOKING_EVENT_DECLARATIONS: ReadonlyArray<PluginDomainEventDeclaration & { event: PluginDomainEvent<unknown> }> = [
  {
    event: BOOKING_CREATED_EVENT,
    label: 'Booking confirmed',
    description: 'A booking was confirmed: a free one when it was made, a paid one when its payment landed.',
    payloadKeys: ['booking'],
  },
  {
    event: BOOKING_RESCHEDULED_EVENT,
    label: 'Booking rescheduled',
    description: 'The site’s team moved a booking to another time, once per move.',
    payloadKeys: ['booking'],
  },
  {
    event: BOOKING_CANCELED_EVENT,
    label: 'Booking canceled',
    description: 'A booking was canceled: a free one by the site’s team, a paid one by a full refund.',
    payloadKeys: ['booking'],
  },
]

/**
 * The key naming one occurrence, so the same fact raised twice is one event:
 * a booking is confirmed once, canceled once, and moved once to each time.
 */
export function bookingEventKey(event: BookingEventName, bookingId: string, startsAtMs?: number): string {
  return event === 'booking.rescheduled' ? `${bookingId}@${Number(startsAtMs ?? 0)}` : bookingId
}
