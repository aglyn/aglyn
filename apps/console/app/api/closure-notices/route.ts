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
  readClosureNotices,
  type ClosureSubject,
} from '@aglyn/aglyn/plugin-manager/plugin-closure-notices'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../_lib/invalid-id-token-response'

/**
 * `GET /api/closure-notices` (AGL-4038): what the plugins say a closure will
 * change, for the delete-workspace and close-account screens to print above
 * their confirm (`@aglyn/aglyn/plugin-manager/plugin-closure-notices`).
 *
 *   ?subject=workspace&orgId=…  the workspace's owner, as only the owner may
 *                               ask to delete it, or staff
 *   ?subject=account            the signed-in person's own account
 *
 * Read-only, and never a gate: the closure routes take no notice of it, so
 * nothing answered here can hold a deletion back. Every source answers in its
 * own words; one that could not is named in `unavailable`.
 */
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const params = new URL(request.url).searchParams
  const kind = params.get('subject')
  const orgId = String(params.get('orgId') ?? '')
  if (kind !== 'workspace' && kind !== 'account') return json({ error: 'Unknown subject' }, 400)
  if (kind === 'workspace' && !/^[A-Za-z0-9_-]{1,128}$/.test(orgId)) {
    return json({ error: 'Missing orgId' }, 400)
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    let subject: ClosureSubject
    if (kind === 'workspace') {
      const org = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
      if (!org.exists) return json({ error: 'Unknown organization' }, 404)
      // The owner, who alone may ask to delete it (`/api/orgs/delete`), or staff.
      if (org.get('ownerUid') !== decoded.uid && decoded['staff'] !== true) {
        return json({ error: 'Only the organization owner can see this' }, 403)
      }
      // Lockdown verdict (AGL-1506), as `/api/orgs/delete` itself answers it:
      // a locked workspace can't ask to be deleted, so it has nothing to warn.
      const locked = await lockdownRefusal({
        request,
        staff: decoded['staff'] === true,
        uid: decoded.uid,
        org: org.data(),
      })
      if (locked) return locked
      subject = { kind: 'workspace', orgId }
    } else {
      // Not org-scoped: the caller's own account, which `/api/account/close`
      // closes whatever any workspace's lockdown, so its warnings stay readable.
      subject = { kind: 'account', uid: decoded.uid }
    }
    return json(await readClosureNotices(subject))
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[closure-notices]', error)
    return json({ error: 'Closure notices failed' }, 500)
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
