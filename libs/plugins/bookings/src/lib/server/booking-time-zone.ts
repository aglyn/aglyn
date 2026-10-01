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

import { getOrgForHost } from '@aglyn/tenant-data-admin'
import { bookingTimeZone, storedBookingTimeZone } from '../model/booking-time'

/**
 * The zone a stored booking's time is told in (AGL-3432).
 *
 * A booking records the zone it was made in, and that answer costs nothing.
 * One written before the zone was stored carries none, so it is resolved the
 * way the booking route resolves a new one — the service's zone, then the
 * site's, then the workspace's — at the cost of one read each, once per
 * service when the caller passes a `cache` for a batch.
 *
 * Never throws: a read that fails tells the time in UTC, which the caller
 * names, rather than holding back a confirmation or a reminder.
 */
export function bookingTimeZoneFor(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  booking: { timezone?: unknown; serviceId?: unknown },
  cache?: Map<string, Promise<string>>,
): Promise<string> {
  const stored = storedBookingTimeZone(booking)
  if (stored) return Promise.resolve(stored)
  const serviceId = String(booking.serviceId ?? '')
  const key = `${hostId}/${serviceId}`
  const cached = cache?.get(key)
  if (cached) return cached
  const resolved = (async () => {
    try {
      const hostRef = firestore.collection('hosts').doc(hostId)
      const [host, service, owner] = await Promise.all([
        hostRef.get(),
        serviceId
          ? hostRef.collection('services').doc(serviceId).get()
          : Promise.resolve(null),
        getOrgForHost(hostId).catch(() => null),
      ])
      return bookingTimeZone({
        service: service?.data() as { timezone?: unknown } | undefined,
        host: host.data() as { timeZone?: string } | undefined,
        org: (owner?.org ?? null) as { timeZone?: string } | null,
      })
    } catch {
      return 'UTC'
    }
  })()
  cache?.set(key, resolved)
  return resolved
}
