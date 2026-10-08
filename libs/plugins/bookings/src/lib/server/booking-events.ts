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
  raisePluginEvent,
  stagePluginEvent,
  type PluginEventWriter,
} from '@aglyn/tenant-data-admin/server/plugin-event-outbox'
import { BUNDLE_ID } from '../constants/bundle-common'
import { bookingEventKey, type BookingEventName, type BookingEventPayload } from '../model/booking-events'
import { bookingViewFromData } from '../model/booking-view'

/**
 * Raising the booking events (AGL-3643). See `model/booking-events.ts` for
 * what each means. A raiser with a transaction stages its event in it, so
 * the event exists exactly when the fact does; one without raises it after
 * the write, keyed, so a retried request raises it once.
 */

export interface BookingEventInput {
  event: BookingEventName
  hostId: string
  bookingId: string
  /** The booking AS WRITTEN: the stored fields with this change applied. */
  booking: Record<string, unknown>
  nowMs?: number
}

function requestFor(input: BookingEventInput) {
  const nowMs = input.nowMs ?? Date.now()
  const payload: BookingEventPayload = { booking: bookingViewFromData(input.bookingId, input.booking, nowMs) }
  return {
    event: input.event,
    pluginId: BUNDLE_ID,
    hostId: input.hostId,
    payload,
    key: bookingEventKey(input.event, input.bookingId, Number(input.booking['startsAtMs'] ?? 0)),
    occurredAtMs: nowMs,
  }
}

/** Stages the event inside the caller's transaction or batch. */
export function stageBookingEvent(
  writer: PluginEventWriter,
  firestore: FirebaseFirestore.Firestore,
  input: BookingEventInput,
): string {
  return stagePluginEvent(writer, firestore, requestFor(input), input.nowMs)
}

/**
 * Raises the event after the fact is written. Never throws: the booking has
 * already changed, and a lost event is logged by the outbox rather than
 * failing the guest's or the team's request.
 */
export async function raiseBookingEvent(
  firestore: FirebaseFirestore.Firestore,
  input: BookingEventInput,
): Promise<void> {
  try {
    await raisePluginEvent(firestore, requestFor(input), input.nowMs)
  } catch (error) {
    console.error('[bookings] event not raised', input.event, input.hostId, input.bookingId, error)
  }
}
