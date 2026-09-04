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
import * as CommerceModel from '../model'
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
    /*
     * ONLY STAYS THAT HAVE NOT ENDED, NEAREST FIRST (AGL-2159).
     *
     * `.where('resourceId','==',resourceId).limit(500)` with no ordering
     * returns 500 documents in `__name__` order — an arbitrary slice of the
     * resource's ENTIRE booking history. Every stay it has ever had competes
     * for those 500 places with the ones that are still ahead, so past a few
     * hundred lifetime bookings the calendar starts leaving LIVE stays out of
     * the greyed-out days and offering an occupied room to the next visitor.
     *
     * This is the same defect, on the same collection, that `reserve.ts`
     * carries the fix for. That one guards the authoritative overlap check;
     * this one draws the calendar the visitor picks from, and the two must
     * agree — a calendar offering a day the booking path then refuses is the
     * same bug wearing a friendlier face.
     *
     * `checkOutDayMs >= todayMs` removes the whole of the past: a stay that
     * ended before today cannot block a day anyone can still book. Ordering
     * on the same field puts the nearest stays inside the limit rather than
     * whichever sort early by id. Uses the existing composite index
     * `reservations (resourceId ASC, checkOutDayMs ASC)`.
     *
     * Every writer sets `checkOutDayMs` — it is required on the reservation
     * model — which matters because an `orderBy` silently drops documents
     * missing the field it sorts on.
     */
    const todayMs = Date.parse(
      `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
    )
    const [resourceSnapshot, reservationsSnapshot] = await Promise.all([
      hostRef.collection('resources').doc(resourceId).get(),
      hostRef
        .collection('reservations')
        .where('resourceId', '==', resourceId)
        .where('checkOutDayMs', '>=', todayMs)
        .orderBy('checkOutDayMs')
        .limit(500)
        .get(),
    ])
    const resource = resourceSnapshot.data() as CommerceModel.HostResource | undefined
    if (!resource) return res.status(404).json({ error: 'Unknown resource' })

    // The SAME hold rule the booking door applies (`reserve.ts`), through the
    // one predicate in the model. An inline dead-status set here knew nothing
    // about the 30-minute lapse on an unpaid `pending`, and nothing ever
    // clears such a row — so one guest abandoning the payment screen greyed
    // those dates out on the date-picker forever, while `reserve.ts` would
    // have sold them to the next guest who asked for them directly.
    const nowMs = Date.now()
    const unavailable = reservationsSnapshot.docs
      .filter((docSnapshot) =>
        CommerceModel.reservationHoldsDates(
          {
            status: String(
              docSnapshot.get('status'),
            ) as CommerceModel.ReservationStatus,
            createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
          },
          nowMs,
        ),
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
