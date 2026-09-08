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
// The leaf, not the barrel: this library's specs substitute the barrel
// wholesale, and the writer must reach the real filing logic under them.
import {
  type CrmBookingRecordOutcome,
  recordCrmBooking,
} from '@aglyn/tenant-data-admin/server/crm-booking-activity'
import type { HostBookingService } from '../model'

/**
 * THE BOOKING'S WAY BACK TO THE CRM (AGL-2660) — the plugin's half.
 *
 * Two doors write a confirmed booking: the create route, for a free
 * service, and the payment webhook, for a paid one once the charge clears.
 * Both call this with what they hold — the row as written and, when they
 * already read it, the service — and it gathers the rest (the owning org,
 * the service's two switches) and hands the filing to the shared writer.
 *
 * **Never throws**: the guest has their slot whatever the CRM did, so a
 * failure here is an outcome the caller may log, never an error into the
 * request or the webhook.
 */
export async function fileBookingOnCrm(
  firestore: FirebaseFirestore.Firestore,
  input: {
    hostId: string
    bookingId: string
    /** The booking row as written — or as read back by the webhook. */
    booking: Record<string, unknown>
    /** The service, when the caller already read it. Read here otherwise. */
    service?: HostBookingService | null
  },
): Promise<CrmBookingRecordOutcome> {
  const { hostId, bookingId, booking } = input
  try {
    const owner = await getOrgForHost(hostId)
    if (!owner?.orgId) return { filed: false, reason: 'failed' }
    const serviceId = String(booking['serviceId'] ?? '')
    const service =
      input.service !== undefined
        ? input.service
        : serviceId
          ? ((
              await firestore
                .collection('hosts')
                .doc(hostId)
                .collection('services')
                .doc(serviceId)
                .get()
            ).data() as HostBookingService | undefined) ?? null
          : null
    return await recordCrmBooking(firestore, {
      hostId,
      org: owner.org as Record<string, unknown>,
      orgId: owner.orgId,
      booking: {
        id: bookingId,
        serviceId,
        serviceName: String(booking['serviceName'] ?? ''),
        email: String(booking['email'] ?? ''),
        startsAtMs: Number(booking['startsAtMs'] ?? 0),
        endsAtMs: Number(booking['endsAtMs'] ?? 0),
        crmRef: typeof booking['crmRef'] === 'string' ? booking['crmRef'] : null,
      },
      service,
    })
  } catch (error) {
    console.error('[bookings] the CRM filing failed', hostId, bookingId, error)
    return { filed: false, reason: 'failed' }
  }
}
