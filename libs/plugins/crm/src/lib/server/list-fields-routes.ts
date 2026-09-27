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

import type { CrmListCollection, PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, restampCrmListFields } from '@aglyn/tenant-data-admin'
import {
  CRM_LIST_FIELDS_COLLECTIONS,
  CRM_LIST_FIELDS_IDS_MAX,
  type CrmListFieldsResponse,
} from '../model/list-fields'
import { readCrmRouteScope } from './org-caller'
import { authorizeCrmWriter } from './task-routes'

/**
 * `POST crm/list-fields` — restamp the fields a CRM list queries (AGL-3321).
 *
 * Body: `{ hostId | orgId, collection, ids }` after a client-direct write
 * the browser cannot follow up — see `model/list-fields.ts`. Authorized the
 * way the next-activity route is — a member who may write this CRM — and
 * never more revealing than it: the route stores what the records already
 * say, derived, and answers with counts. A scoped member naming a record
 * they cannot see restamps it from its own fields, which is what it should
 * carry anyway; nothing about the record comes back.
 */
export const crmListFieldsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const collection = body['collection']
  if (!CRM_LIST_FIELDS_COLLECTIONS.includes(collection as CrmListCollection)) {
    res.status(400).json({ error: 'Name a CRM collection.' })
    return
  }
  const ids = readIds(body['ids'])
  if (!ids) {
    res.status(400).json({ error: 'Name the records to restamp.' })
    return
  }
  try {
    const writer = await authorizeCrmWriter(req, scope)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const result = await restampCrmListFields(
      firebaseAdmin.app().firestore(),
      writer.orgId,
      collection as CrmListCollection,
      ids,
    )
    const answer: CrmListFieldsResponse = { ok: true, ...result }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] list-fields failed', error)
    res.status(500).json({ error: 'The records could not be restamped.' })
  }
}

/** The ids off the body: strings, trimmed, no path separators, capped. */
function readIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const ids = raw
    .map((entry) => String(entry ?? '').trim().slice(0, 256))
    .filter((id) => id && !id.includes('/'))
    .slice(0, CRM_LIST_FIELDS_IDS_MAX)
  return ids.length ? ids : null
}
