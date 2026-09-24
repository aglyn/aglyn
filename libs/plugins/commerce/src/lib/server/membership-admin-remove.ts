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

import { hostRoleCanWrite, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { isMemberDocumentId, memberCredentialRef } from './member-credentials'

/**
 * Remove a SITE MEMBER from the console (AGL-3308): the profile and its
 * credential document, in one batch.
 *
 * The password hash lives in a collection no client can reach, so a client
 * delete of the profile would leave it behind — a credential for an account
 * the site owner removed. The rules therefore refuse a client delete of any
 * member that has a credential document, and this route is the removal.
 *
 * Who may call it is who the rules let delete a profile before it: a site
 * role that writes content (`admin`, `editor` or `author` in the host's
 * `memberRoles`). A frozen site is refused by the dispatcher's lockdown gate
 * before this runs, the half the rules spelled `hostWritesFrozen`.
 *
 * Removing the profile also ends every session the member holds:
 * `readActiveMemberSession` reads a missing profile as signed out.
 *
 * Idempotent. A member already gone answers 200, and a credential document
 * left without its profile is cleared on the way.
 */
export const membershipAdminRemoveHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers['authorization'] ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const hostId = String(req.body?.hostId ?? '')
  const memberId = String(req.body?.memberId ?? '')
  if (!hostId || !memberId) {
    return res.status(400).json({ error: 'Missing hostId or memberId' })
  }
  if (!isMemberDocumentId(memberId)) {
    return res.status(400).json({ error: 'Unknown member' })
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      // The shape of emailUnverifiedResponse (AGL-479), by hand for the same
      // reason as membership-admin-password: this is a (req, res) handler.
      return res.status(403).json({
        error: 'Verify your email to continue',
        reason: 'email-unverified',
      })
    }
    const firestore = app.firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!hostSnapshot.exists || !hostRoleCanWrite(memberRole)) {
      return res.status(403).json({ error: 'Not permitted' })
    }

    const batch = firestore.batch()
    batch.delete(hostRef.collection('siteMembers').doc(memberId))
    batch.delete(memberCredentialRef(hostRef, memberId))
    await batch.commit()
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Could not remove the member' })
  }
}
