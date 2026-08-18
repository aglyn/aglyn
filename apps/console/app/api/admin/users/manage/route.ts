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
  authForPool,
  consumePasswordResetSend,
  emailUnverifiedResponse,
  eraseUser,
  findUserByUidAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
  passwordResetThrottleMessage,
  setClaimsInOwningPool,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  originFromHeaders,
  sendAuthPasswordResetEmail,
  sendPasswordChangedNotice,
  validateNewPassword,
} from '../../../_lib/password-admin'

const ACTIONS = [
  'grantStaff',
  'revokeStaff',
  'disable',
  'enable',
  'setRole',
  'updateProfile',
  'sendPasswordReset',
  'setPassword',
  // Permanent, and the only action here that cannot be undone by another
  // action (AGL-1140). Everything else on this list is reversible.
  'erase',
] as const
const STAFF_ROLES = ['support', 'billing', 'super'] as const
type ManageAction = (typeof ACTIONS)[number]

/**
 * Staff user management (AGL-204): grant/revoke the `staff` custom claim
 * and disable/enable accounts from the admin UI instead of the CLI
 * script. Self-lockout guarded (no self-revoke, no self-disable); every
 * action writes an adminAudit entry.
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

  const action = String(body?.action ?? '') as ManageAction
  const uid = String(body?.uid ?? '')
  if (!uid || !ACTIONS.includes(action)) {
    return Response.json({ error: 'Missing uid or unknown action' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // RBAC (AGL-206): user management is super-only. A missing role fails
    // CLOSED to the least-privileged `support` (AGL-495) — never default to
    // super, or a role-less staff token silently gets super. Existing staff
    // must be re-granted with an explicit staffRole (set-staff-claim --role).
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }
    if (
      decoded.uid === uid &&
      (action === 'revokeStaff' || action === 'disable' || action === 'erase')
    ) {
      return Response.json({ error: 'You cannot lock yourself out' }, { status: 400 })
    }

    // Erasure runs BEFORE the pool lookup below (AGL-1140). `eraseUser` does
    // its own cross-pool resolution and, more to the point, deliberately
    // treats an account with no auth record as still erasable — a profile
    // doc and roster rows can outlive the record. Requiring `findUserByUid`
    // to succeed first would refuse exactly the half-deleted accounts most
    // in need of cleaning up.
    if (action === 'erase') {
      const reason = String(body?.reason ?? '').trim().slice(0, 500)
      if (!reason) {
        // A permanent deletion should carry why it was ordered. This is the
        // record that answers "who asked for this" a year from now.
        return Response.json(
          { error: 'A reason is required to erase an account' },
          { status: 400 },
        )
      }
      const result = await eraseUser(uid)
      if (!result.ok) {
        return Response.json(
          {
            error:
              result.skippedReason === 'owns-orgs'
                ? 'This person owns workspaces — transfer ownership or delete them first'
                : 'No such account',
            skippedReason: result.skippedReason,
            blockers: result.blockers,
          },
          { status: result.skippedReason === 'owns-orgs' ? 409 : 404 },
        )
      }
      await firebaseAdmin
        .app()
        .firestore()
        .collection('adminAudit')
        .add({
          actorUid: decoded.uid,
          actorEmail: decoded.email ?? null,
          action: 'user.erased',
          target: `users/${uid}`,
          // The uid is all that is left to identify them by — the account it
          // named no longer exists — so the reason has to carry the meaning.
          after: { reason, ...result.deleted },
          at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
      return Response.json({ ok: true, deleted: result.deleted }, { status: 200 })
    }

    // Resolve which pool the TARGET lives in (AGL-1122) and mutate there.
    // Custom claims and profile edits are per-pool: `setCustomUserClaims` on
    // the project pool cannot grant staff to — or disable — an SSO account,
    // whose uid only exists inside its org's GCIP tenant. `auth` above stays
    // the project pool, which is correct for verifying the CALLER's token.
    const found = await findUserByUidAcrossPools(uid)
    if (!found) {
      return Response.json({ error: 'No such account' }, { status: 404 })
    }
    const target = found.record
    const targetAuth = authForPool(found.tenantId)
    const before = {
      staff: Boolean(target.customClaims?.['staff']),
      staffRole: target.customClaims?.['staffRole'] ?? null,
      disabled: target.disabled,
    }

    // Identity edits (AGL-361): names, photo, email — audited with the
    // previous values; email changes mark the address unverified.
    if (action === 'updateProfile') {
      const displayName = String(body?.displayName ?? '').trim().slice(0, 120)
      const photoUrl = String(body?.photoUrl ?? '').trim().slice(0, 500)
      const email = String(body?.email ?? '').trim().toLowerCase()
      if (photoUrl && !/^https:\/\//i.test(photoUrl)) {
        return Response.json({ error: 'Photo URLs must be https://' }, { status: 400 })
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Enter a valid email' }, { status: 400 })
      }
      await targetAuth.updateUser(uid, {
        displayName: displayName || undefined,
        photoURL: photoUrl || undefined,
        ...(email && email !== target.email
          ? { email, emailVerified: false }
          : {}),
      })
      // Mirror to the users doc so console lists stay consistent.
      await firebaseAdmin
        .app()
        .firestore()
        .collection('users')
        .doc(uid)
        .set(
          {
            ...(displayName ? { displayName } : {}),
            ...(photoUrl ? { photoUrl } : {}),
          },
          { merge: true },
        )
      await firebaseAdmin.app().firestore().collection('adminAudit').add({
        actorUid: decoded.uid,
        action: 'user.updateProfile',
        target: `users/${uid}`,
        before: {
          displayName: target.displayName ?? null,
          photoURL: target.photoURL ?? null,
          email: target.email ?? null,
        },
        after: {
          displayName: displayName || null,
          photoURL: photoUrl || null,
          email: email || target.email || null,
        },
        at: FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true }, { status: 200 })
    }

    // Password help (AGL-912). Both actions need somewhere to send mail —
    // a reset link is useless without an inbox, and a silent password change
    // the holder never learns about is worse than no change at all. An
    // account with no email address (phone/anonymous provider) gets neither.
    if (action === 'sendPasswordReset' || action === 'setPassword') {
      if (!target.email) {
        return Response.json({
          error: 'This account has no email address',
        }, { status: 400 })
      }
      const origin = originFromHeaders(headers)
      const actorName = 'Aglyn support'

      if (action === 'sendPasswordReset') {
        // Throttled per recipient and per actor (AGL-920). Staff are trusted,
        // but the cap protects the recipient's mailbox rather than guarding
        // against staff — several people helping one user still add up to a
        // pile of unsolicited mail.
        const throttle = await consumePasswordResetSend({
          actorKey: decoded.uid,
          recipientKey: target.email,
        })
        if (!throttle.allowed) {
          return Response.json(
            { error: passwordResetThrottleMessage(throttle) },
            {
              status: 429,
              headers: { 'Retry-After': String(throttle.retryAfterSeconds) },
            },
          )
        }
        const sent = await sendAuthPasswordResetEmail({
          email: target.email,
          origin,
          actorName,
        })
        if (!sent) {
          return Response.json({
            error: 'Could not send the reset email — check email settings',
          }, { status: 502 })
        }
        await firebaseAdmin.app().firestore().collection('adminAudit').add({
          actorUid: decoded.uid,
          action: 'user.sendPasswordReset',
          target: `users/${uid}`,
          before: null,
          after: { email: target.email },
          at: FieldValue.serverTimestamp(),
        })
        return Response.json({ ok: true }, { status: 200 })
      }

      const validated = validateNewPassword(body?.password)
      if (validated.error) {
        return Response.json({ error: validated.error }, { status: 400 })
      }
      await targetAuth.updateUser(uid, { password: validated.password })
      // Sessions outlive the credential otherwise: an id token stays valid
      // for up to an hour and a refresh token indefinitely, so whoever was
      // signed in with the OLD password keeps working. Revoking is the
      // difference between "changed the password" and "took back the
      // account" — which is the point of the action.
      //
      // `targetAuth`, not `auth` (AGL-2005). `auth` is the PROJECT pool — it
      // is the right receiver for verifying the CALLER's token above and the
      // wrong one for touching the target, whose uid may only exist inside a
      // GCIP tenant. The password landed in the tenant pool one line up while
      // the revocation went to the project pool, so for an SSO account the
      // credential changed and every existing session stayed valid: the exact
      // half-done state this call exists to prevent. Not hypothetical — the
      // AGL-1962 audit found a `tokensValidAfterTime` of 2026-08-14 sitting on
      // the forged project-pool twin while the real account's never moved.
      await targetAuth.revokeRefreshTokens(uid)
      const notified = await sendPasswordChangedNotice({
        email: target.email,
        origin,
        actorName,
      })
      // The audit records THAT the password changed, never the password.
      await firebaseAdmin.app().firestore().collection('adminAudit').add({
        actorUid: decoded.uid,
        action: 'user.setPassword',
        target: `users/${uid}`,
        before: null,
        after: { email: target.email, holderNotified: notified },
        at: FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true, notified }, { status: 200 })
    }

    const requestedRole = String(body?.role ?? '')
    // Claim writes go through `setClaimsInOwningPool` (AGL-1993) rather than
    // the `targetAuth` resolved above. Same pool in the ordinary case, but it
    // re-resolves at write time and RETURNS the pool it wrote to, so the audit
    // row below can record it — a uid alone does not identify an account when
    // the same uid can exist in two pools.
    let claimWrite: Awaited<ReturnType<typeof setClaimsInOwningPool>> = null
    if (action === 'setRole') {
      if (!STAFF_ROLES.includes(requestedRole as any)) {
        return Response.json({ error: 'Unknown role' }, { status: 400 })
      }
      if (decoded.uid === uid && requestedRole !== 'super') {
        return Response.json({ error: 'You cannot demote yourself' }, { status: 400 })
      }
      claimWrite = await setClaimsInOwningPool(uid, {
        ...(target.customClaims ?? {}),
        staff: true,
        staffRole: requestedRole,
      })
    } else if (action === 'grantStaff' || action === 'revokeStaff') {
      claimWrite = await setClaimsInOwningPool(uid, {
        ...(target.customClaims ?? {}),
        staff: action === 'grantStaff',
        // Grants default to the least-privileged role (AGL-206).
        ...(action === 'grantStaff' ? { staffRole: 'support' } : {}),
      })
    } else {
      await targetAuth.updateUser(uid, { disabled: action === 'disable' })
    }

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: `user.${action}`,
        target: `users/${uid}`,
        // WHICH pool the claim landed in (AGL-1993). `null` is the project
        // pool; a tenant id means an SSO identity. Recorded because a staff
        // grant on an identity in a CUSTOMER's tenant is exactly the row a
        // staff-access review needs to see.
        targetTenantId: claimWrite ? claimWrite.tenantId : (found.tenantId ?? null),
        before,
        after: {
          staff:
            action === 'grantStaff' || action === 'setRole'
              ? true
              : action === 'revokeStaff'
                ? false
                : before.staff,
          staffRole:
            action === 'setRole'
              ? requestedRole
              : action === 'grantStaff'
                ? 'support'
                : before.staffRole,
          disabled:
            action === 'disable'
              ? true
              : action === 'enable'
                ? false
                : before.disabled,
        },
        at: FieldValue.serverTimestamp(),
      })

    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Action failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
