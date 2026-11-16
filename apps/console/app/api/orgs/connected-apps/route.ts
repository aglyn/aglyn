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
 * Connected apps (AGL-4225): the session-authenticated plane for listing and
 * disconnecting the apps connected to a workspace through sign-in — any MCP
 * client. The twin of the API keys
 * route, held to the SAME permission: "Manage API keys" (`org.apiKeys`) over
 * the whole workspace, because a connection is a key a person approved
 * instead of copied.
 *
 * Unlike key creation, neither listing nor disconnecting needs the plan: a
 * workspace that has dropped API access must still be able to see and end
 * the connections it made while it had it.
 */
import { isOrgWideMember, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  disconnectConnectorGrant,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listConnectorGrants,
  lockdownRefusal,
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { recordWithoutFailing } from '../../_lib/connector-oauth-http'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
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
      return Response.json({ error: 'You are not a member of that organization' }, { status: 403 })
    }

    const orgSnap = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
    const locked = await lockdownRefusal({
      request,
      staff: isStaff,
      uid: decoded.uid,
      org: orgSnap.data() ?? {},
    })
    if (locked) return locked

    const isManager =
      isStaff ||
      (isOrgWideMember(actor?.member) &&
        (await memberHasOrgPermission(orgId, actor?.member, 'org.apiKeys')))
    if (!isManager) {
      return Response.json(
        {
          error: 'Your role does not include "Manage API keys" — ask an organization admin',
          reason: 'permission',
          permission: 'org.apiKeys',
        },
        { status: 403 },
      )
    }

    if (method === 'GET') {
      return Response.json({ apps: await listConnectorGrants(orgId) })
    }

    if (String(body?.action ?? '') !== 'disconnect') {
      return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
    const grantId = String(body?.grantId ?? '')
    if (!grantId) return Response.json({ error: 'Missing grantId' }, { status: 400 })
    const result = await disconnectConnectorGrant(orgId, grantId)
    if (result.disconnected) {
      // The connection has ended; the record of it must not turn that into a 500.
      await recordWithoutFailing(() =>
        logOrgActivity(orgId, { uid: decoded.uid, email: decoded.email }, 'Disconnected an app', {
          type: 'org',
          id: grantId,
          ...(result.appName ? { name: result.appName } : {}),
        }),
      )
    }
    return Response.json({ disconnected: result.disconnected })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Connected apps request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
