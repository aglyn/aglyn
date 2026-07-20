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
 * API key MANAGEMENT (AGL-619): the console-session-authed plane for creating,
 * listing, and revoking a customer's REST API keys. This is distinct from the
 * `/api/v1` data plane (which authenticates with the keys themselves). Key
 * creation mints the secret and returns it once; only its hash is stored.
 */
import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listApiKeys,
  logOrgActivity,
  mintApiKey,
  normalizeScopes,
  resolveOrgMembership,
  revokeApiKey,
} from '@aglyn/tenant-data-admin'

/** Only owners/admins manage keys; any member may view the (metadata) list. */
const MANAGER_ROLES = new Set(['owner', 'admin'])

async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    body,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String((method === 'GET' ? query.orgId : body?.orgId) ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (!actor && !isStaff) {
      return Response.json(
        { error: 'You are not a member of that organization' },
        { status: 403 },
      )
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgSnap = await firestore.collection('orgs').doc(orgId).get()
    const org = orgSnap.data() ?? {}
    if (!checkEntitlement(org, 'apiAccess')) {
      return Response.json(
        { error: 'API access requires the Business plan' },
        { status: 403 },
      )
    }

    if (method === 'GET') {
      return Response.json({ keys: await listApiKeys(orgId) })
    }

    const isManager =
      isStaff || MANAGER_ROLES.has(String(actor?.member?.role))
    if (!isManager) {
      return Response.json(
        { error: 'Managing API keys requires the owner or admin role' },
        { status: 403 },
      )
    }

    const action = String(body?.action ?? '')
    const activityActor = { uid: decoded.uid, email: decoded.email }

    if (action === 'create') {
      const name = String(body?.name ?? '').trim() || 'API key'
      const scopes = normalizeScopes(
        Array.isArray(body?.scopes) ? body.scopes.map(String) : [],
      )
      if (scopes.length === 0) {
        return Response.json(
          { error: 'Select at least one scope' },
          { status: 400 },
        )
      }
      const { token, key } = await mintApiKey({
        orgId,
        name,
        scopes,
        createdBy: decoded.uid,
      })
      await logOrgActivity(orgId, activityActor, 'Created an API key', {
        type: 'org',
        id: key.keyId,
        name,
      })
      return Response.json({ token, key })
    }

    if (action === 'revoke') {
      const keyId = String(body?.keyId ?? '')
      if (!keyId) {
        return Response.json({ error: 'Missing keyId' }, { status: 400 })
      }
      const revoked = await revokeApiKey(orgId, keyId)
      if (revoked) {
        await logOrgActivity(orgId, activityActor, 'Revoked an API key', {
          type: 'org',
          id: keyId,
        })
      }
      return Response.json({ revoked })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'API key request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
