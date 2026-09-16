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
  pluginPermissionChanges,
  pluginRequestFromWeb,
  runPluginEventHandlers,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
  setHostPermissions,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  AI_PERMISSION_KEYS,
  aiPermissionsOf,
  isAiPermission,
  type AiPermissionVerdict,
} from '../model/ai-permissions'

/**
 * The `aiPermissions` field of a body: a map of AI keys to booleans, or
 * `false` for anything else. Keys outside the two and non-boolean values are
 * refused rather than dropped, so a client that mis-spells a key learns so
 * instead of saving nothing.
 */
export function readAiPermissionToggles(value: unknown): Partial<AiPermissionVerdict> | false {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const accepted: Partial<AiPermissionVerdict> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isAiPermission(key) || typeof entry !== 'boolean') return false
    accepted[key] = entry
  }
  return Object.keys(accepted).length ? accepted : false
}

/** `assist on, generate off` — the activity entry's words for a verdict. */
export function describeAiPermissions(verdict: AiPermissionVerdict): string {
  return `assist ${verdict['ai.use'] ? 'on' : 'off'}, generate ${
    verdict['ai.generate'] ? 'on' : 'off'
  }`
}

/**
 * `PATCH /api/ai/host-permissions` (AGL-2927, AGL-2984): a site
 * collaborator's AI toggles, set from the site's collaborators card.
 *
 * The door is the collaborators card's own — a site admin, or an org member
 * who manages people, on a site whose organization is not locked — and the
 * write is core's per-site toggle, `setHostPermissions`, which stores the
 * toggle on the member document the AI doors read and re-projects the site.
 * The display roster carries the verdict beside it so the card renders
 * without a second read.
 *
 * Recorded twice, like every other collaborator change: a sentence in the
 * site's feed naming the state the toggles became, and one
 * `org.permissions.changed` per key that moved, which this plugin's handler
 * turns into the org feed's coded row. A toggle set to the value it already
 * had moves nothing and raises nothing. A pending invite has no member
 * document to carry a toggle, and becomes settable once it is accepted.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  if (method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = app.firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const host = (await hostRef.get()).data()
    const memberRole = (host?.['memberRoles'] ?? {})[decoded.uid]
    const orgPermissions = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!host || (memberRole !== 'admin' && !orgPermissions.permissions.manageMembers)) {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      return Response.json({ error: 'This site has no organization yet' }, { status: 409 })
    }
    const { orgId, org } = resolved
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
      host,
    })
    if (locked) return locked

    const toggles = readAiPermissionToggles(body?.aiPermissions)
    if (toggles === false) {
      return Response.json(
        { error: `aiPermissions must map ${AI_PERMISSION_KEYS.join(' and ')} to booleans` },
        { status: 400 },
      )
    }
    const memberId = String(body?.memberId ?? '')
    if (!memberId) return Response.json({ error: 'Missing member' }, { status: 400 })
    const membersRef = hostRef.collection('members')
    const member = (await membersRef.doc(memberId).get()).data()
    if (!member) return Response.json({ error: 'Member not found' }, { status: 404 })
    if (!member['uid']) {
      return Response.json(
        { error: 'AI access is set once the invite is accepted' },
        { status: 409 },
      )
    }

    const { before, after } = await setHostPermissions({
      orgId,
      uid: String(member['uid']),
      hostId,
      permissions: toggles,
    })
    const verdict = aiPermissionsOf(after)
    await membersRef.doc(memberId).update({ aiPermissions: verdict })
    const actor = {
      uid: decoded.uid,
      email: decoded.email ? String(decoded.email) : null,
    }
    await logHostActivity(
      hostId,
      actor,
      `Changed member AI access to ${describeAiPermissions(verdict)}`,
      {
        type: 'member',
        id: memberId,
        ...(member['email'] ? { name: String(member['email']) } : {}),
      },
    )
    const subjectName = [host['displayName'], member['email']]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .join(' · ')
    for (const change of pluginPermissionChanges(before, after)) {
      if (!isAiPermission(change.permission)) continue
      await runPluginEventHandlers('org.permissions.changed', {
        orgId,
        actor,
        subject: { type: 'host', id: hostId, name: subjectName },
        permission: change.permission,
        granted: change.granted,
      })
    }
    return Response.json({ ok: true, aiPermissions: verdict }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/host-permissions]', error)
    return Response.json({ error: 'Member operation failed' }, { status: 500 })
  }
}

export { handler as PATCH }
