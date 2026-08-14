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
 * THE PANIC BUTTON (AGL-1501). Staff-only, super-role-only; the ONLY writer
 * of lockdown state on every scope — the Firestore rules close `lockdowns/*`
 * to all client writes including staff, because a lockdown is not a flag
 * write: it is the flag PLUS session revocation PLUS the `orgSuspended`
 * projection fan-out PLUS tenant cache eviction, and a path that could set
 * the flag without the rest would be a lockdown that looks set and enforces
 * nothing (the kill-switch project's "rejection is not a kill" lesson).
 *
 * Scopes and carriers:
 *  - `platform` → `lockdowns/platform` (server-side type-to-confirm)
 *  - `org`      → `orgs/{id}.suspendedAt` family (the shipped AGL-202
 *                 carrier, extended) via `applyOrgLockdown`
 *  - `host`     → `hosts/{id}.suspendedAt` family via `applyHostLockdown`
 *  - `user`     → `lockdowns/user--{uid}` + Firebase Auth `disabled` +
 *                 pool-aware refresh-token revocation
 *
 * Every action — lock AND unlock — writes an `adminAudit` row.
 *
 * Where this is operated from: /admin/lockdown (StaffGuard'd page). The
 * runbook is apps/docs/docs/staff-console/lockdown.md.
 */

import {
  featureLockdownDocId,
  isLockdownFeatureKey,
  isLockdownReasonCode,
  LOCKDOWN_FEATURE_KEYS,
  LOCKDOWN_MESSAGE_MAX,
  LOCKDOWNS_COLLECTION,
  PLATFORM_LOCKDOWN_DOC_ID,
  pluginRequestFromWeb,
  userLockdownDocId,
} from '@aglyn/aglyn/server'
import {
  authForPool,
  emailUnverifiedResponse,
  findUserByUidAcrossPools,
  firebaseAdmin,
  invalidateFeatureLockdownCache,
  invalidatePlatformLockdownCache,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  applyHostLockdown,
  applyOrgLockdown,
} from '../../../../utils/server/org-lockdown'

export const dynamic = 'force-dynamic'

const SCOPES = new Set(['platform', 'org', 'host', 'user', 'feature'])

/**
 * The platform scope's server-side type-to-confirm. The UI asks the
 * operator to type it; requiring it HERE too means no script, console
 * mishap or replayed request can take the whole platform down with a
 * one-field body.
 */
const PLATFORM_CONFIRM_PHRASE = 'LOCK PLATFORM'

async function audit(options: {
  actorUid: string
  actorEmail?: string | null
  action: string
  target: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}): Promise<void> {
  await firebaseAdmin.app().firestore().collection('adminAudit').add({
    actorUid: options.actorUid,
    actorEmail: options.actorEmail ?? null,
    action: options.action,
    target: options.target,
    before: options.before,
    after: options.after,
    at: FieldValue.serverTimestamp(),
  })
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()

    if (method === 'GET') {
      // The current-state read for the staff page: the lockdowns collection
      // (platform + user scopes). Org/host lockdowns live on their own docs
      // and are visible on the org/host staff surfaces.
      const snapshot = await firestore
        .collection(LOCKDOWNS_COLLECTION)
        .limit(200)
        .get()
      const records = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      return Response.json({ records }, { status: 200 })
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    // Locking and lifting are super-only, matching org suspension's bar
    // (rules gate `suspendedAt` on isSuperStaff). Fails CLOSED to the
    // least-privileged role on a missing claim (AGL-495).
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }

    const action = String(body?.action ?? '')
    const scope = String(body?.scope ?? '')
    const targetId = String(body?.targetId ?? '').trim()
    if (action !== 'lock' && action !== 'unlock') {
      return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
    if (!SCOPES.has(scope)) {
      return Response.json({ error: 'Unknown scope' }, { status: 400 })
    }
    if (scope !== 'platform' && !targetId) {
      return Response.json({ error: 'Missing targetId' }, { status: 400 })
    }

    const reason = body?.reason
    if (action === 'lock' && !isLockdownReasonCode(reason)) {
      return Response.json(
        { error: 'reason must be security | billing | maintenance | manual' },
        { status: 400 },
      )
    }
    const message =
      typeof body?.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, LOCKDOWN_MESSAGE_MAX)
        : undefined
    const untilMs =
      typeof body?.untilMs === 'number' && Number.isFinite(body.untilMs)
        ? body.untilMs
        : undefined
    if (action === 'lock' && untilMs !== undefined && untilMs <= Date.now()) {
      return Response.json(
        { error: 'untilMs is in the past — that lockdown would never bite' },
        { status: 400 },
      )
    }
    const lock = { reason: String(reason), message, untilMs }
    const actor = {
      actorUid: decoded.uid,
      actorEmail: decoded.email ? String(decoded.email) : null,
    }

    /*==========================================
     * PLATFORM
     *=========================================*/
    if (scope === 'platform') {
      if (action === 'lock' && body?.confirm !== PLATFORM_CONFIRM_PHRASE) {
        return Response.json(
          { error: `Type-to-confirm required: send confirm: "${PLATFORM_CONFIRM_PHRASE}"` },
          { status: 400 },
        )
      }
      const ref = firestore
        .collection(LOCKDOWNS_COLLECTION)
        .doc(PLATFORM_LOCKDOWN_DOC_ID)
      const before = (await ref.get()).data() ?? null
      if (action === 'lock') {
        await ref.set({
          scope: 'platform',
          reason: lock.reason,
          ...(message ? { message } : {}),
          ...(untilMs !== undefined ? { untilMs } : {}),
          atMs: Date.now(),
          actorUid: decoded.uid,
        })
      } else {
        await ref.delete()
      }
      // The process that pressed the button serves fresh verdicts NOW;
      // other processes converge within the reader's 15s TTL.
      invalidatePlatformLockdownCache()
      await audit({
        ...actor,
        action: `lockdown.${action}`,
        target: `lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`,
        before: { locked: before != null, reason: before?.['reason'] ?? null },
        after: {
          locked: action === 'lock',
          ...(action === 'lock' ? { reason: lock.reason } : {}),
        },
      })
      return Response.json({ ok: true, scope, action }, { status: 200 })
    }

    /*==========================================
     * FEATURE (AGL-1510)
     *=========================================*/
    if (scope === 'feature') {
      // No type-to-confirm phrase, deliberately. The platform phrase exists
      // because one field in one body takes EVERYTHING down; a feature lock
      // takes one named capability down and leaves the platform serving —
      // the same blast-radius class as an org or host lock, which also
      // confirm by explicit target + super role + audit rather than typing.
      // Incident response wants the narrow lever fast; the wide one slow.
      if (!isLockdownFeatureKey(targetId)) {
        return Response.json(
          {
            error: `Unknown feature — one of: ${LOCKDOWN_FEATURE_KEYS.join(', ')}`,
          },
          { status: 400 },
        )
      }
      const ref = firestore
        .collection(LOCKDOWNS_COLLECTION)
        .doc(featureLockdownDocId(targetId))
      const before = (await ref.get()).data() ?? null
      if (action === 'lock') {
        await ref.set({
          scope: 'feature',
          feature: targetId,
          reason: lock.reason,
          ...(message ? { message } : {}),
          ...(untilMs !== undefined ? { untilMs } : {}),
          atMs: Date.now(),
          actorUid: decoded.uid,
        })
      } else {
        await ref.delete()
      }
      // The process that flipped the switch enforces it NOW; other
      // processes converge within the reader's 15s TTL.
      invalidateFeatureLockdownCache()
      await audit({
        ...actor,
        action: `lockdown.${action}`,
        target: `lockdowns/${featureLockdownDocId(targetId)}`,
        before: { locked: before != null, reason: before?.['reason'] ?? null },
        after: {
          locked: action === 'lock',
          feature: targetId,
          ...(action === 'lock' ? { reason: lock.reason } : {}),
        },
      })
      return Response.json(
        { ok: true, scope, action, feature: targetId },
        { status: 200 },
      )
    }

    /*==========================================
     * USER
     *=========================================*/
    if (scope === 'user') {
      if (targetId === decoded.uid) {
        // The self-guard users/manage has, for the same reason.
        return Response.json(
          { error: 'You cannot lock yourself out' },
          { status: 400 },
        )
      }
      const found = await findUserByUidAcrossPools(targetId)
      if (!found) {
        return Response.json({ error: 'No such account' }, { status: 404 })
      }
      if (action === 'lock' && found.record.customClaims?.['staff'] === true) {
        // The un-panic invariant's write-side twin: the verdict ignores
        // lockdowns for staff, so a "locked" staff account would only be a
        // disabled auth record nobody can see the reason for. Revoke the
        // staff claim first (users/manage) if a staff account must go.
        return Response.json(
          { error: 'Staff accounts cannot be locked — revoke staff first' },
          { status: 400 },
        )
      }
      const ref = firestore
        .collection(LOCKDOWNS_COLLECTION)
        .doc(userLockdownDocId(targetId))
      const before = (await ref.get()).data() ?? null
      const pool = authForPool(found.tenantId)
      if (action === 'lock') {
        await ref.set({
          scope: 'user',
          reason: lock.reason,
          ...(message ? { message } : {}),
          ...(untilMs !== undefined ? { untilMs } : {}),
          atMs: Date.now(),
          actorUid: decoded.uid,
        })
        // The logout is real: disable stops new sign-ins, the revoke kills
        // the session cookie at its next `verifySessionCookie(…, true)`
        // exchange and the SDK's next token refresh. Pool-scoped — the
        // project-pool revoke would silently miss an SSO-tenant account.
        await pool.updateUser(targetId, { disabled: true })
        await pool.revokeRefreshTokens(targetId)
      } else {
        await ref.delete()
        await pool.updateUser(targetId, { disabled: false })
      }
      await audit({
        ...actor,
        action: `lockdown.${action}`,
        target: `users/${targetId}`,
        before: { locked: before != null, reason: before?.['reason'] ?? null },
        after: {
          locked: action === 'lock',
          ...(action === 'lock' ? { reason: lock.reason } : {}),
        },
      })
      return Response.json({ ok: true, scope, action }, { status: 200 })
    }

    /*==========================================
     * ORG
     *=========================================*/
    if (scope === 'org') {
      const orgSnapshot = await firestore.collection('orgs').doc(targetId).get()
      if (!orgSnapshot.exists) {
        return Response.json({ error: 'No such workspace' }, { status: 404 })
      }
      const result = await applyOrgLockdown({
        firestore,
        orgId: targetId,
        action,
        lock,
        // Security/manual mean "everyone out NOW". Billing/maintenance keep
        // sessions so members can reach billing settings and fix it — the
        // org's sites and writes are locked server-side either way.
        revokeMemberTokens:
          lock.reason === 'security' || lock.reason === 'manual',
      })
      await audit({
        ...actor,
        action: `lockdown.${action}`,
        target: `orgs/${targetId}`,
        before: { locked: orgSnapshot.get('suspendedAt') != null },
        after: {
          locked: action === 'lock',
          ...(action === 'lock' ? { reason: lock.reason } : {}),
          tokensRevoked: result.tokensRevoked,
        },
      })
      return Response.json({ ok: true, scope, action, ...result }, { status: 200 })
    }

    /*==========================================
     * HOST
     *=========================================*/
    const hostSnapshot = await firestore.collection('hosts').doc(targetId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'No such site' }, { status: 404 })
    }
    const result = await applyHostLockdown({
      firestore,
      hostId: targetId,
      action,
      lock,
    })
    await audit({
      ...actor,
      action: `lockdown.${action}`,
      target: `hosts/${targetId}`,
      before: { locked: hostSnapshot.get('suspendedAt') != null },
      after: {
        locked: action === 'lock',
        ...(action === 'lock' ? { reason: lock.reason } : {}),
      },
    })
    return Response.json({ ok: true, scope, action, ...result }, { status: 200 })
  } catch (error) {
    console.error('[admin/lockdown] failed', error)
    return Response.json({ error: 'Lockdown action failed' }, { status: 500 })
  }
}

export { handler as GET, handler as POST }
