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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Public reservation availability (AGL-310): resource display info plus
 * the booked/blocked day ranges the calendar greys out. Guest details
 * never leave the server.
 */
export const reservationAvailabilityHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const resourceId = String(req.query.resourceId ?? '')
  if (!hostId || !resourceId) {
    return res.status(400).json({ error: 'Missing hostId or resourceId' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [resourceSnapshot, reservationsSnapshot] = await Promise.all([
      hostRef.collection('resources').doc(resourceId).get(),
      hostRef
        .collection('reservations')
        .where('resourceId', '==', resourceId)
        .limit(500)
        .get(),
    ])
    const resource = resourceSnapshot.data() as Aglyn.HostResource | undefined
    if (!resource) return res.status(404).json({ error: 'Unknown resource' })

    const dead = new Set(['cancelled', 'no_show'])
    const unavailable = reservationsSnapshot.docs
      .filter(
        (docSnapshot) => !dead.has(String(docSnapshot.get('status'))),
      )
      .map((docSnapshot) => ({
        fromDayMs: Number(docSnapshot.get('checkInDayMs')),
        toDayMs: Number(docSnapshot.get('checkOutDayMs')),
      }))
      .concat(resource.blocks ?? [])

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=120',
    )
    return res.status(200).json({
      resource: {
        name: resource.name,
        description: resource.description ?? null,
        capacity: resource.capacity ?? null,
        photoUrls: resource.photoUrls ?? [],
        amenities: resource.amenities ?? [],
        nightlyRateUsd: resource.nightlyRateUsd,
        weekendMultiplier: resource.weekendMultiplier ?? null,
        seasons: resource.seasons ?? [],
        minNights: resource.minNights ?? null,
        depositPct: resource.depositPct ?? null,
        cancellationHours: resource.cancellationHours ?? null,
      },
      unavailable,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Availability unavailable' })
  }
}
