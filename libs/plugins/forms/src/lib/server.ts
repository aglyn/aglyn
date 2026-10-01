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

import { registerPluginApiRoute, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { FORM_STATS_RECOUNT_MAX, recountFormStats } from './server/form-stats'
import { formPromoteHandler } from './server/form-promote-route'

/**
 * `POST /api/forms/stats` — recount the named forms' counters from their
 * rows (AGL-3330).
 *
 * A form's `stats` are server-written: the rules refuse a client write that
 * touches them, because a merchant who could set their own submission count
 * could make any lead rate read however they liked. So a CONSOLE act that
 * changes what they should say — deleting a submission from the Inbox,
 * switching lead routing (a lead-routing form holds `0` leads rather than
 * none) — asks for them to be recounted here, and `recountFormStats` counts
 * the rows and writes what they say.
 *
 * Nothing the caller sends is written: it names forms, and the figures come
 * from Firestore. That is why any member of the site may ask — a recount can
 * only ever put a form's counters in agreement with rows the member can
 * already list — and why it needs no role beyond membership. It is bounded at
 * {@link FORM_STATS_RECOUNT_MAX} forms a request, three aggregation reads
 * each, and a form already in agreement is not written.
 *
 * Body: `{ hostId, formIds: string[] }`. Answers each form's recount, or
 * `null` for an id that is not a form on the site.
 */
export const formStatsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = typeof req.body?.hostId === 'string' ? req.body.hostId : ''
  const formIds = Array.isArray(req.body?.formIds)
    ? [
        ...new Set(
          (req.body.formIds as unknown[]).filter(
            (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64,
          ),
        ),
      ]
    : []
  if (!hostId || !formIds.length) {
    return res.status(400).json({ error: 'Missing hostId or formIds' })
  }
  if (formIds.length > FORM_STATS_RECOUNT_MAX) {
    return res
      .status(400)
      .json({ error: `At most ${FORM_STATS_RECOUNT_MAX} forms a request` })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return res.status(403).json({ error: 'Verify your email address first' })
    }
    const firestore = firebaseAdmin.app().firestore()
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
    const staff = decoded['staff'] === true
    const memberRole = (host.get('memberRoles') ?? {})[decoded.uid]
    if (!staff && !memberRole) {
      return res.status(403).json({ error: 'Not a member of this site' })
    }
    const recounts: Record<string, unknown> = {}
    for (const formId of formIds) {
      const recount = await recountFormStats({ firestore, hostId, formId })
      recounts[formId] = recount
        ? { recounted: recount.recounted, drift: recount.drift, written: recount.written }
        : null
    }
    return res.status(200).json({ ok: true, recounts })
  } catch (error) {
    // A refused credential is a 401; anything else is a fault of ours.
    if (isRefusedIdToken(error)) {
      return res.status(401).json({ error: 'Unauthenticated' })
    }
    console.error('[forms] stats recount failed', error)
    return res.status(500).json({ error: 'Recount failed' })
  }
}

/** Console API registration. */
export function registerFormsConsoleApi(): void {
  registerPluginApiRoute('forms/stats', formStatsHandler)
  // A form's publish — the `besignerDocuments` publish route
  // `plugins.config.json` declares for it.
  registerPluginApiRoute('forms/promote', { web: formPromoteHandler })
}

// Type-only (AGL-3080): the plugin's entitlement keys, declared by module
// augmentation, for every program that loads this entry point.
export type { formsPlanEntitlements } from './plan-entitlements'
