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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { revalidateHostAliases } from '../../../../utils/server/tenant-revalidate'
import {
  disconnectHostCustomDomain,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Releases a custom domain: removes it from the tenant deployment and clears
 * `host.cname` (AGL-742).
 *
 * Disconnect used to clear `host.cname` client-side only, leaving the hostname
 * registered forever. The platform kept serving it, so with no host holding
 * that cname `get-host.ts` resolved nothing and the domain 404'd instead of
 * being released — while certificates kept renewing and the domain counted
 * against the deployment's limit.
 *
 * Deliberately does NOT touch DNS. A real custom domain's CNAME lives in the
 * customer's own zone; we have no access to it and must not imply otherwise.
 *
 * A name that was never registered (`not-found`) is treated as success — it is
 * the desired end state already, mirroring how attach tolerates a name that is
 * already registered. Auth: Firebase ID token; caller must be a host admin.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // "Manage site settings" (`site.manage`, AGL-4047).
    if (!holdsSiteKey(hostSnapshot, decoded.uid, 'site.manage')) {
      return Response.json({ error: siteKeyRefusal('site.manage') }, { status: 403 })
    }

    // Lockdown verdict (AGL-1506): host doc in hand; the owning org's doc
    // is fetched for the org scope (an org lock never stamps host docs, so
    // host-only would miss it) — a domain detach is a rare admin mutation,
    // and the read is request-cache-deduped. Staff bypass is the un-panic
    // invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    // Only this host's own domain may be released — never a domain read off
    // the request body, which would let an admin detach someone else's.
    // The release — provider detach, the subdomain serving again, the twin,
    // the cleared claim, the activity entry and the plugin event — lives in
    // `disconnectHostCustomDomain` (AGL-3961), so a plugin releasing a name it
    // bought takes exactly this path. Authorization stays here.
    const released = await disconnectHostCustomDomain({
      hostId,
      actor: {
        uid: decoded.uid,
        email: decoded.email ? String(decoded.email) : null,
      },
    })
    if (released.ok === 'already-clear') {
      return Response.json({ detached: true, alreadyClear: true }, { status: 200 })
    }
    if (released.ok === 'refused') {
      return Response.json({ error: released.error }, { status: released.status })
    }

    // AFTER the write, never before: the tenant re-reads on the next request,
    // so busting first would race the delete and re-warm the entry we are
    // trying to drop. The domain no longer resolves to this host, and the
    // `cname--` alias entry is the only thing that still says it does.
    await revalidateHostAliases({
      subdomain: released.subdomain,
      hostId,
      cname: released.domain,
    })
    return Response.json({ detached: true }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Detach failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
