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
  type BookedInterval,
  BOOKING_MAX_DAYS_AHEAD,
  computeOpenSlots,
  type HostBookingService,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Public open-slot listing (AGL-159): visitors browse a service's next
 * open times. Server-side because bookings (names/emails) must never be
 * client-readable — only the derived busy intervals are used here.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  const serviceId = String(req.query['serviceId'] ?? '')
  if (!hostId) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)

    // No serviceId → public service directory for the booking widget
    // (AGL-160): names/durations/prices only, never availability internals.
    if (!serviceId) {
      const services = await hostRef.collection('services').limit(50).get()
      return res.status(200).json({
        services: services.docs
          .filter((doc) => !doc.get('deletedAt'))
          .map((doc) => ({
            $id: doc.id,
            name: doc.get('name') ?? '',
            durationMinutes: Number(doc.get('durationMinutes') ?? 30),
            priceUsd: Number(doc.get('priceUsd') ?? 0),
            description: doc.get('description') ?? '',
          })),
      })
    }
    const serviceSnapshot = await hostRef
      .collection('services')
      .doc(serviceId)
      .get()
    const service = serviceSnapshot.data() as HostBookingService | undefined
    if (!service || (serviceSnapshot.get('deletedAt') as unknown)) {
      return res.status(404).json({ error: 'Unknown service' })
    }
    const fromMs = Date.now()
    const toMs = fromMs + BOOKING_MAX_DAYS_AHEAD * 24 * 60 * 60_000
    const bookedSnapshot = await hostRef
      .collection('bookings')
      .where('serviceId', '==', serviceId)
      .where('startsAtMs', '>=', fromMs - 24 * 60 * 60_000)
      .limit(500)
      .get()
    const booked: BookedInterval[] = bookedSnapshot.docs
      .filter((doc) => doc.get('status') !== 'canceled')
      .map((doc) => ({
        startsAtMs: Number(doc.get('startsAtMs') ?? 0),
        endsAtMs: Number(doc.get('endsAtMs') ?? 0),
      }))
    const slots = computeOpenSlots(service, fromMs, toMs, booked, 120)
    return res.status(200).json({
      service: {
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceUsd: service.priceUsd ?? 0,
        timezone: service.timezone ?? 'UTC',
      },
      slots,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Slot lookup failed' })
  }
}
