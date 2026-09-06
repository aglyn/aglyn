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
 * `POST /api/crm/org-activity` — one line in the organization's activity
 * feed (AGL-2634).
 *
 * Body: `{ orgId, action, target: { type, id?, name? } }`. Answers
 * `{ ok: true }` once the line is appended.
 *
 * ## Why a route, when the site feed takes the browser's word for it
 *
 * A site's feed at `hosts/{hostId}/activity` is written client-direct: the
 * bulk bars log "Deleted deal" per row through `useHostActivityLogger`,
 * under a rule that lets a member holding a content role append. The
 * organization's feed at `orgs/{orgId}/activity` is not — `allow write: if
 * false` for every client, because the feed names who did what across every
 * site and its only reader is `/api/orgs/activity`, gated on `org.auditLog`
 * with the Admin SDK. So an act performed at the ORGANIZATION level with a
 * client-direct write — a bulk bar over the org's deals, which writes the
 * documents from the browser — has no feed it can reach, and the org hub
 * wrote no line at all for its bulk actions. This is the door: the same
 * trust the site feed extends to the browser (a verified member, holding
 * the permission the CRM is gated on), narrowed to the org hub's reach
 * (org-wide, never a site collaborator) and to the CRM's own record kinds.
 *
 * What it does NOT vouch for is that the act happened: like every
 * client-written feed line, the sentence is the caller's. The routes that
 * perform an org-level act themselves — the stage move, the merge, the
 * erasure, the email — write their own line with the Admin SDK and never
 * call here.
 */

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { logOrgActivity } from '@aglyn/tenant-data-admin'
import {
  CRM_API_ROUTES,
  CRM_ORG_ACTIVITY_ACTION_MAX,
  CRM_ORG_ACTIVITY_KINDS,
  type CrmOrgActivityKind,
} from '../constants/api-routes'
import { authorizeOrgCaller } from './org-caller'

export const CRM_ORG_ACTIVITY_ROUTE = CRM_API_ROUTES.orgActivity

/** The body the org-level bulk bars post. */
export interface OrgActivityRequest {
  orgId: string
  /** The sentence — "Owner set on 3 deals" — as the bar's snackbar said it. */
  action: string
  target: {
    type: CrmOrgActivityKind
    id?: string
    name?: string
  }
}

function typed(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

const isKind = (value: unknown): value is CrmOrgActivityKind =>
  typeof value === 'string' &&
  (CRM_ORG_ACTIVITY_KINDS as readonly string[]).includes(value)

export const crmOrgActivityHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body: Partial<OrgActivityRequest> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const orgId = typed(body.orgId, 128)
  const action = typed(body.action, CRM_ORG_ACTIVITY_ACTION_MAX)
  const target = body.target && typeof body.target === 'object' ? body.target : null
  if (!orgId || !action || !target) {
    res.status(400).json({ error: 'Missing orgId, action or target' })
    return
  }
  if (!isKind(target.type)) {
    res.status(400).json({ error: 'The target names no CRM record kind' })
    return
  }
  const id = typed(target.id, 200)
  const name = typed(target.name, 200)

  try {
    const caller = await authorizeOrgCaller(req, orgId, {
      needs: 'data.manage',
      refusal:
        'Logging organization activity requires the data permission across the whole workspace',
    })
    if (caller.ok === false) {
      res.status(caller.status).json({ error: caller.error })
      return
    }
    await logOrgActivity(orgId, { uid: caller.uid, email: caller.email }, action, {
      type: target.type,
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
    })
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[crm] org-activity failed', orgId, error)
    res.status(500).json({ error: 'The activity could not be logged' })
  }
}

export default crmOrgActivityHandler
