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
 * Server half of the events-calendar plugin (AGL-396): the reference API
 * migration. Registers the public `events/list` handler with the plugin API
 * registry; the app dispatcher serves it at the unchanged `/api/events/list`
 * URL. This module imports firebase-admin, so it is NOT re-exported from the
 * plugin's client barrel — apps import `@aglyn/plugins-events-calendar/server`
 * only from their (server-only) API dispatcher.
 */

import {
  checkEntitlement,
  isSiteEventType,
  registerPluginApiRoute,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { runSingleAction } from '@aglyn/tenant-runtime'

/**
 * Public event listing (AGL-145): published events for the Event List canvas
 * element. Drafts never leave the server; the paid `eventCalendar` add-on
 * gates plan-holding tenants (dark-launch tenants pass). Sorted by start;
 * `mode=past` flips the window.
 */
const eventsListHandler: PluginApiHandler = async (req, res) => {
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
      if (!checkEntitlement(tenant as never, 'eventCalendar')) {
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

/** Registers the events-calendar plugin's API routes with the dispatcher. */
/**
 * Site-event dispatch (AGL-256): the page runtime evaluates client-side
 * trigger conditions (scroll thresholds, selectors, dwell time) and posts
 * the fired action here so its SERVER steps run. Only site-event actions
 * dispatch this way — server events keep their own emitters. Payload
 * fields are bounded strings; the run cap and `actions` entitlement gate
 * inside the runner.
 */
const eventsDispatchHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const actionId = String(req.body?.actionId ?? '')
  const event = String(req.body?.event ?? '')
  if (!hostId || !actionId || !isSiteEventType(event)) {
    return res.status(400).json({ error: 'Bad dispatch' })
  }
  const raw = req.body?.payload
  const payload: Record<string, string> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw).slice(0, 20)) {
      if (/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) {
        payload[key] = String(value).slice(0, 500)
      }
    }
  }
  const alerts = await runSingleAction(hostId, actionId, event, payload)
  return res.status(200).json({ ok: true, alerts })
}

export function registerEventsCalendarApi(): void {
  registerPluginApiRoute('events/list', eventsListHandler)
  registerPluginApiRoute('events/dispatch', eventsDispatchHandler)
}
