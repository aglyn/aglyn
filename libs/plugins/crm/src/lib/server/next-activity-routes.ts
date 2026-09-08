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

import type { CrmNextActivityLink, PluginApiHandler } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  recomputeCrmNextTaskAt,
  sweepCrmNextTaskAt,
} from '@aglyn/tenant-data-admin'
import {
  CRM_NEXT_ACTIVITY_LINKS_MAX,
  type CrmNextActivityResponse,
} from '../model/next-activity'
import { readCrmRouteScope } from './org-caller'
import { authorizeCrmWriter } from './task-routes'

/**
 * `POST crm/next-activity` — recompute `nextTaskAtMs` (AGL-2661).
 *
 * Body: `{ hostId | orgId, links: [{ contactId?, companyId?, dealId? }] }`
 * after a client-direct task write, or `{ hostId | orgId, all: true }` for
 * the Fields section's whole-organization recompute. Authorized the way the
 * task routes are — a member who may write this CRM — and never more
 * revealing than a task write: the route stores a figure derived from
 * tasks the caller could already read, and answers with counts.
 *
 * The links are not checked against the caller's scope. A scoped member
 * naming a record they cannot see gets that record's figure recomputed
 * from its own tasks, which is the figure it should carry anyway; nothing
 * about the record comes back.
 */
export const crmNextActivityHandler: PluginApiHandler = async (req, res) => {
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
  try {
    const writer = await authorizeCrmWriter(req, scope)
    if (writer.ok === false) {
      res.status(writer.status).json(writer.body)
      return
    }
    const firestore = firebaseAdmin.app().firestore()
    if (body['all'] === true) {
      const sweep = await sweepCrmNextTaskAt(firestore, writer.orgId)
      const answer: CrmNextActivityResponse = {
        ok: true,
        records: sweep.scheduled + sweep.cleared,
        missing: 0,
        tasks: sweep.tasks,
        cleared: sweep.cleared,
        truncated: sweep.truncated,
      }
      res.status(200).json(answer)
      return
    }
    const links = readLinks(body['links'])
    if (!links) {
      res.status(400).json({ error: 'Name the records to recompute, or ask for all of them.' })
      return
    }
    const result = await recomputeCrmNextTaskAt(firestore, writer.orgId, links)
    const answer: CrmNextActivityResponse = { ok: true, ...result }
    res.status(200).json(answer)
  } catch (error) {
    console.error('[crm] next-activity failed', error)
    res.status(500).json({ error: 'The next activity could not be recomputed.' })
  }
}

/** The links off the body, held to ids: a string each, trimmed, capped. */
function readLinks(raw: unknown): CrmNextActivityLink[] | null {
  if (!Array.isArray(raw)) return null
  const links: CrmNextActivityLink[] = []
  for (const entry of raw.slice(0, CRM_NEXT_ACTIVITY_LINKS_MAX)) {
    const record = (entry ?? {}) as Record<string, unknown>
    const link: CrmNextActivityLink = {}
    for (const field of ['contactId', 'companyId', 'dealId'] as const) {
      const id = String(record[field] ?? '').trim().slice(0, 128)
      if (id) link[field] = id
    }
    if (Object.keys(link).length) links.push(link)
  }
  return links
}
