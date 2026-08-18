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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  lockdownRefusal,
  normalizeMemberPhotoUrl,
  propagateMemberPhoto,
} from '@aglyn/tenant-data-admin'

/**
 * Push the avatar you just saved onto every org roster row that names you
 * (AGL-1976).
 *
 * Manage Account → Profile image already writes `users/{uid}.photoUrl` and the
 * auth record, both client-side, and neither is what a colleague reads.
 * `orgs/{orgId}/members/{uid}.photoURL` is, and it is `allow write: if false`
 * in the Firestore rules — correctly, because that document also carries
 * `role`, `allHosts`, `hostAccess` and `roleId`. Hence a route.
 *
 * **The uid comes from the verified token and there is no target parameter.**
 * A route that took a uid in the body would be a way to put an arbitrary image
 * URL on somebody else's roster row in front of their whole workspace; a route
 * whose only possible subject is its caller cannot be turned into one. This is
 * the same shape `/api/account/close` uses and for the same reason.
 *
 * Not re-authenticated, unlike close: this is reversible by repeating it, and
 * a re-auth popup on an avatar save would be theatre.
 *
 * The empty string is a real value and means CLEAR — otherwise a removed
 * avatar lingers on the roster after it is gone from every other surface.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const auth = firebaseAdmin.app().auth()
    // Peek, then re-verify against the tenant when there is one — an SSO
    // account's record lives in a per-org GCIP pool and the default verifier
    // is not the authority on it (AGL-1122). This route exists BECAUSE those
    // accounts cannot be read from the project pool, so getting the
    // verification pool wrong here would fail exactly the members it is for.
    const peek = await auth.verifyIdToken(idToken)
    const tenantId = peek.firebase?.tenant
    const decoded = tenantId
      ? await auth.tenantManager().authForTenant(tenantId).verifyIdToken(idToken)
      : peek
    if (!decoded.email_verified && !tenantId) {
      // An SSO account is verified by its IdP; a self-serve one has to have
      // confirmed its address before its picture appears next to colleagues.
      return emailUnverifiedResponse()
    }

    // Lockdown verdict (AGL-1506). Platform and user scope only — there is no
    // single org here, the write fans across every workspace the caller
    // belongs to. Staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
    })
    if (locked) return locked

    // Validated HERE rather than trusted from the client that offered it. The
    // value becomes an `<img src>` on every colleague's screen, so the
    // client's identical check is a courtesy to the person typing and this one
    // is the boundary (the same https-only rule `resolveIdpPhotoUrl` applies
    // to an IdP assertion).
    const normalized = normalizeMemberPhotoUrl(body?.photoUrl)
    if (!normalized.ok) {
      return Response.json(
        {
          error:
            normalized.reason === 'too-long'
              ? 'That image URL is too long'
              : 'Image URLs must be https://',
        },
        { status: 400 },
      )
    }

    const result = await propagateMemberPhoto({
      uid: decoded.uid,
      photoURL: normalized.photoURL,
    })
    return Response.json(
      { ok: true, orgs: result.orgIds.length, cleared: result.cleared },
      { status: 200 },
    )
  } catch (error) {
    console.error('[account/photo] failed', error)
    return Response.json({ error: 'Saving the image failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
