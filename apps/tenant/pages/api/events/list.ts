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

import { checkEntitlement } from '@aglyn/aglyn'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Public event listing (AGL-145): published events for the Event List
 * canvas element. Drafts never leave the server; the paid `eventCalendar`
 * add-on gates plan-holding tenants (dark-launch tenants pass, as
 * everywhere). Sorted by start; `mode=past` flips the window.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  const mode = req.query['mode'] === 'past' ? 'past' : 'upcoming'
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    {
      // Plan/quota gates ride the owning org's doc (AGL-238).
      const tenant = (await getOrgForHost(hostId))?.org
      if (
        tenant?.['plan'] &&
        !checkEntitlement(tenant as any, 'eventCalendar')
      ) {
        return res.status(200).json({ events: [] })
      }
    }

    const nowMs = Date.now()
    const eventsQuery =
      mode === 'past'
        ? hostRef
            .collection('events')
            .where('startsAtMs', '<', nowMs)
            .orderBy('startsAtMs', 'desc')
            .limit(50)
        : hostRef
            .collection('events')
            .where('startsAtMs', '>=', nowMs)
            .orderBy('startsAtMs', 'asc')
            .limit(50)
    const snapshot = await eventsQuery.get()
    const events = snapshot.docs
      .filter(
        (doc) => doc.get('status') === 'published' && !doc.get('deletedAt'),
      )
      .map((doc) => ({
        $id: doc.id,
        title: doc.get('title') ?? '',
        startsAtMs: Number(doc.get('startsAtMs') ?? 0),
        endsAtMs: Number(doc.get('endsAtMs') ?? 0),
        location: doc.get('location') ?? null,
        organizer: doc.get('organizer') ?? null,
        description: doc.get('description') ?? null,
        coverImage: doc.get('coverImage') ?? null,
      }))
    // Cacheable: published events change rarely; CDN may hold for a minute.
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    return res.status(200).json({ events })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Event listing failed' })
  }
}
