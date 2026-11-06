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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { PluginConnectionRecordDoc } from '../../model/plugin-connections'
import { isListingId } from './config'
import { connectionRecordRef } from './connection-store'
import { installedConnection } from './installed-connection'
import { routeError, routeJson, siteConnectionsGate } from './routes'
import { toSiteRecord } from './site-records'

/*
 * THE RECORD, FOR THE EDITOR (AGL-4195).
 *
 * A published page hands a signed element its connection's record with the
 * page (the enricher in `site-records.ts`). The Besigner renders the same
 * element in the console's browser, where there is no page render to ride:
 * this route answers the same record, so the canvas can show what the
 * published page will.
 *
 *   GET /api/plugin-connections/record?hostId=&listingId=&connectionId=
 *
 *   200 { record }  the record, held to the pinned version's declaration
 *                   exactly as the page holds it, or `null` before the
 *                   first sync and on a plan without connections
 *   400             a parameter missing or malformed
 *   401/403/404     the site gate (`siteConnectionsGate`): signed in,
 *                   verified, "Manage a site's plugin connections" on the site
 *   404             the site runs no plugin that declares the connection
 *
 * The record collection is server-only; this reads it with the Admin SDK
 * for a member holding the site key, which is the same key that connects it.
 */

const methodNotAllowed = () =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'GET', 'Cache-Control': 'no-store' },
  })

const firestore = (): FirebaseFirestore.Firestore => firebaseAdmin.app().firestore()

export async function recordRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const params: Record<string, unknown> = Object.fromEntries(new URL(request.url).searchParams.entries())
  const actor = await siteConnectionsGate(request, params, { requirePlan: false })
  if (actor instanceof Response) return actor
  const listingId = params['listingId']
  const connectionId = params['connectionId']
  if (!isListingId(listingId) || typeof connectionId !== 'string' || !connectionId) {
    return routeError(400, 'Missing listingId or connectionId')
  }
  const found = await installedConnection(firestore(), { hostId: actor.hostId, orgId: actor.orgId, listingId, connectionId })
  if (!found) return routeError(404, 'This site runs no plugin that declares that connection.')
  if (!actor.planAllows) return routeJson({ record: null, planAllows: false })
  const snapshot = await connectionRecordRef(firestore(), actor.hostId, listingId, connectionId).get()
  const data = snapshot.data() as Record<string, unknown> | undefined
  const held = data && data['listingId'] === listingId && data['connectionId'] === connectionId ? toSiteRecord(data, found.connection) : null
  const record: PluginConnectionRecordDoc | null = held
    ? {
        kind: 'record',
        listingId,
        connectionId,
        version: String(data?.['version'] ?? ''),
        syncedAtMs: held.syncedAtMs,
        fields: held.fields,
        items: held.items,
      }
    : null
  return routeJson({ record, planAllows: true })
}
