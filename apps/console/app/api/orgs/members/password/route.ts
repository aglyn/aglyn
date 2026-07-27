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
  isImpersonationSession,
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  blockedReasonForOrgSetPassword,
  originFromHeaders,
  sendAuthPasswordResetEmail,
  sendPasswordChangedNotice,
  validateNewPassword,
} from '../../../_lib/password-admin'

/**
 * Password help for a team member (AGL-913): an org admin gets a teammate
 * back into their account without going through staff.
 *
 * Two actions with deliberately different bars, because they are not
 * equally dangerous. `sendPasswordReset` mails a link to the member's own
 * inbox — the admin never learns the password, so the worst case is an
 * unwanted email. `setPassword` hands the admin working credentials for
 * somebody else's account.
 *
 * That second one matters more here than on the staff page, because Aglyn
 * console accounts are GLOBAL Firebase Auth identities, not per-org records.
 * One person, one account, however many organizations they work with — so
 * an unrestricted "set their password" would let any org admin take over an
 * account that also has access to a competitor's workspace, or that carries
 * staff claims. The guards below narrow it to the case where the org really
 * does own the whole account: the member belongs to this org and nowhere
 * else, is not the owner, is not staff, and is not the admin themselves.
 * Anything outside that goes through the reset email instead.
 */

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
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
  const targetUid = String((method === 'GET' ? query.uid : body?.uid) ?? '')
  const action = String(body?.action ?? '')
  if (!orgId || !targetUid) {
    return Response.json({ error: 'Missing orgId or uid' }, { status: 400 })
  }
  if (
    method === 'POST' &&
    action !== 'sendPasswordReset' &&
    action !== 'setPassword'
  ) {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const firestore = firebaseAdmin.app().firestore()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (!actor && !isStaff) {
      return Response.json({
        error: 'You are not a member of that organization',
      }, { status: 403 })
    }
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'members.manage'))
    ) {
      return Response.json({
        error: 'Managing members requires the members.manage permission',
      }, { status: 403 })
    }

    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    // Membership is the scope of this endpoint: without it an org admin
    // could aim either action at any uid in the platform.
    const memberSnapshot = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(targetUid)
      .get()
    if (!memberSnapshot.exists) {
      return Response.json({
        error: 'That person is not a member of this organization',
      }, { status: 404 })
    }

    const target = await auth.getUser(targetUid)

    if (method === 'GET') {
      const blockedReason = target.email
        ? await blockedReasonForOrgSetPassword({
            firestore,
            target,
            orgId,
            ownerUid: orgSnapshot.get('ownerUid'),
            actorUid: decoded.uid,
          })
        : null
      return Response.json({
        email: target.email ?? null,
        canSetPassword: Boolean(target.email) && !blockedReason,
        blockedReason,
      }, { status: 200 })
    }

    if (!target.email) {
      return Response.json({
        error: 'This account has no email address',
      }, { status: 400 })
    }
    const origin = originFromHeaders(headers)
    const actorName =
      decoded['name'] ??
      decoded.email ??
      `An admin at ${orgSnapshot.get('name') ?? 'your organization'}`
    const targetName =
      memberSnapshot.get('displayName') ??
      memberSnapshot.get('email') ??
      targetUid

    if (action === 'sendPasswordReset') {
      const sent = await sendAuthPasswordResetEmail({
        email: target.email,
        origin,
        actorName: String(actorName),
      })
      if (!sent) {
        return Response.json({
          error: 'Could not send the reset email — try again shortly',
        }, { status: 502 })
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        `Sent ${targetName} a password reset email`,
        { type: 'member', id: targetUid, name: targetName },
      )
      return Response.json({ ok: true }, { status: 200 })
    }

    // --- setPassword: the account-takeover guards -----------------------
    const blockedReason = await blockedReasonForOrgSetPassword({
      firestore,
      target,
      orgId,
      ownerUid: orgSnapshot.get('ownerUid'),
      actorUid: decoded.uid,
    })
    if (blockedReason) {
      return Response.json({ error: blockedReason }, { status: 403 })
    }

    const validated = validateNewPassword(body?.password)
    if (validated.error) {
      return Response.json({ error: validated.error }, { status: 400 })
    }
    await auth.updateUser(targetUid, { password: validated.password })
    // Without this the member's existing sessions keep working on the old
    // credential, which makes "set their password" a much weaker statement
    // than it looks (see the staff route, AGL-912).
    await auth.revokeRefreshTokens(targetUid)
    const notified = await sendPasswordChangedNotice({
      email: target.email,
      origin,
      actorName: String(actorName),
    })
    // Records that it happened and who did it — never the password itself.
    void logOrgActivity(
      orgId,
      { uid: decoded.uid, email: decoded.email },
      `Set a new password for ${targetName}`,
      { type: 'member', id: targetUid, name: targetName },
    )
    return Response.json({ ok: true, notified }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Password operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
