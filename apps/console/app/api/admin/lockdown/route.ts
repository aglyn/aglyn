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
 * Every action also ANSWERS WITH A FRESH READ of what it wrote (AGL-1571).
 * A click is a request, and a request that never left the pointer looks
 * exactly like one that succeeded — the drill's missed lift was caught only
 * because someone went back to Firestore instead of trusting the click. So
 * the route states the post-condition (`verified`) and whether it matches
 * the intent (`confirmed`) rather than leaving the console to assume it,
 * and the same read is available on its own as a scoped GET probe.
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
  invalidateUserLockdownCache,
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

/**
 * The lock's shape as the audit trail has to remember it (AGL-1572).
 *
 * A row that says `locked: true` and nothing else cannot tell "staff armed
 * a 15-minute dead-man lock" from "staff armed an indefinite one and walked
 * away" — the single distinction that decides, weeks later, whether a lock
 * that outlived its incident was procedure or an accident. The same applies
 * in reverse on a lift: `before.untilMs` is what says whether the operator
 * released a time-boxed lock early or cleaned up a forgotten one.
 *
 * `message` rides along because it is the only record of what the affected
 * customers were actually told.
 *
 * `null` rather than `undefined` throughout: Firestore rejects undefined
 * values by default, and an ABSENT key reads as "this trail never captured
 * expiry at all" — exactly the ambiguity this function exists to end.
 */
function auditLockShape(lock: {
  reason?: unknown
  message?: unknown
  untilMs?: unknown
}): { reason: string | null; message: string | null; untilMs: number | null } {
  return {
    reason: typeof lock.reason === 'string' ? lock.reason : null,
    message: typeof lock.message === 'string' ? lock.message : null,
    untilMs: typeof lock.untilMs === 'number' ? lock.untilMs : null,
  }
}

async function audit(options: {
  actorUid: string
  actorEmail?: string | null
  action: string
  /**
   * Stored top-level so the audit log filters by scope on an equality
   * match. It is derivable from `target`, but only by prefix-matching a
   * path — and `lockdowns/` alone covers three different scopes.
   */
  scope: string
  target: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}): Promise<void> {
  await firebaseAdmin.app().firestore().collection('adminAudit').add({
    actorUid: options.actorUid,
    actorEmail: options.actorEmail ?? null,
    action: options.action,
    scope: options.scope,
    target: options.target,
    before: options.before,
    after: options.after,
    at: FieldValue.serverTimestamp(),
  })
}

/**
 * One target's lock state as the SERVER currently sees it (AGL-1571).
 *
 * `readAtMs` is the server's clock at the moment of the read, and it is the
 * field that does the work: the staff page shows it verbatim so a panel is
 * always a statement about a moment, never an implicit "now". A panel that
 * cannot go stale invisibly is the only kind an operator can safely believe.
 */
export interface LockState {
  scope: string
  targetId: string
  /** False only when the org/host doc itself is missing — a typo'd id. */
  exists: boolean
  locked: boolean
  reason: string | null
  message: string | null
  untilMs: number | null
  /** When the lock was engaged, if it is. */
  atMs: number | null
  readAtMs: number
}

type AdminFirestore = ReturnType<ReturnType<typeof firebaseAdmin.app>['firestore']>

/** `suspendedAt` is a Timestamp on orgs and plain epoch ms on hosts. */
function toMillis(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  return null
}

/**
 * Re-read a target's lock state from Firestore, whichever carrier holds it —
 * `lockdowns/*` for platform/feature/user, the `suspended*` family on the
 * org/host doc for the other two.
 *
 * This is the drill's own safety move made part of the product. The lockdown
 * drill only caught a lift that never registered because it went back to
 * Firestore instead of trusting the click; a click is a request, and a
 * request that never left the pointer looks exactly like one that succeeded.
 * Every write below answers with a fresh read of what it wrote, so the
 * console can state the post-condition rather than assume it.
 */
async function readLockState(
  firestore: AdminFirestore,
  scope: string,
  targetId: string,
): Promise<LockState> {
  const base = { scope, targetId, readAtMs: Date.now() }
  if (scope === 'org' || scope === 'host') {
    const snapshot = await firestore
      .collection(scope === 'org' ? 'orgs' : 'hosts')
      .doc(targetId)
      .get()
    return {
      ...base,
      exists: snapshot.exists,
      locked: snapshot.exists && snapshot.get('suspendedAt') != null,
      reason: snapshot.get('suspendedReasonCode') ?? null,
      message: snapshot.get('suspendedMessage') ?? null,
      untilMs: snapshot.get('suspendedUntilMs') ?? null,
      atMs: toMillis(snapshot.get('suspendedAt')),
    }
  }
  const docId =
    scope === 'platform'
      ? PLATFORM_LOCKDOWN_DOC_ID
      : scope === 'feature'
        ? featureLockdownDocId(
            targetId as Parameters<typeof featureLockdownDocId>[0],
          )
        : userLockdownDocId(targetId)
  const snapshot = await firestore
    .collection(LOCKDOWNS_COLLECTION)
    .doc(docId)
    .get()
  const data = snapshot.data()
  return {
    ...base,
    // These scopes carry the lock in the doc's EXISTENCE, so there is no
    // such thing as a missing target — absent is simply unlocked.
    exists: true,
    locked: data != null,
    reason: (data?.['reason'] as string) ?? null,
    message: (data?.['message'] as string) ?? null,
    untilMs: (data?.['untilMs'] as number) ?? null,
    atMs: (data?.['atMs'] as number) ?? null,
  }
}

/**
 * What a write answers with: not "your request succeeded" but "here is the
 * target, read back after the write". `confirmed` compares that read against
 * what was asked for — a `false` means the write returned and the state
 * still disagrees, which the console has to surface as an alarm rather than
 * a quiet success.
 */
async function actionResponse(options: {
  firestore: AdminFirestore
  scope: string
  targetId: string
  action: 'lock' | 'unlock'
  extra?: object
}): Promise<Response> {
  const verified = await readLockState(
    options.firestore,
    options.scope,
    options.targetId,
  )
  return Response.json(
    {
      ok: true,
      scope: options.scope,
      action: options.action,
      verified,
      confirmed: verified.locked === (options.action === 'lock'),
      ...options.extra,
    },
    { status: 200 },
  )
}

async function handler(request: Request): Promise<Response> {
  const { method, body, query, headers: rawHeaders } =
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
      // A scoped probe: "what is the state of THIS target, right now".
      // Read-only and open to every staff role, like the list below — the
      // super gate exists to stop writes, and an operator who cannot check
      // whether a lock is still engaged is the whole failure mode of
      // AGL-1571. Org and host state is unreachable from the lockdowns
      // collection, so without this the panic page could say nothing at all
      // about the two scopes whose locks are widest.
      const probeScope = String(query?.['scope'] ?? '')
      if (probeScope) {
        if (!SCOPES.has(probeScope)) {
          return Response.json({ error: 'Unknown scope' }, { status: 400 })
        }
        const probeTarget = String(query?.['targetId'] ?? '').trim()
        if (probeScope !== 'platform' && !probeTarget) {
          return Response.json({ error: 'Missing targetId' }, { status: 400 })
        }
        if (probeScope === 'feature' && !isLockdownFeatureKey(probeTarget)) {
          return Response.json(
            {
              error: `Unknown feature — one of: ${LOCKDOWN_FEATURE_KEYS.join(', ')}`,
            },
            { status: 400 },
          )
        }
        return Response.json(
          { state: await readLockState(firestore, probeScope, probeTarget) },
          { status: 200 },
        )
      }

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
        scope: 'platform',
        target: `lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`,
        before: { locked: before != null, ...auditLockShape(before ?? {}) },
        after: {
          locked: action === 'lock',
          ...(action === 'lock' ? auditLockShape(lock) : {}),
        },
      })
      return actionResponse({ firestore, scope, targetId: '', action })
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
        scope: 'feature',
        target: `lockdowns/${featureLockdownDocId(targetId)}`,
        before: { locked: before != null, ...auditLockShape(before ?? {}) },
        after: {
          locked: action === 'lock',
          feature: targetId,
          ...(action === 'lock' ? auditLockShape(lock) : {}),
        },
      })
      return actionResponse({
        firestore,
        scope,
        targetId,
        action,
        extra: { feature: targetId },
      })
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
      // The process that took the action refuses (or readmits) this uid NOW;
      // other processes converge within the reader's 15s TTL (AGL-1522). The
      // hard kill never rode that cache — the disable + revoke above stand
      // on their own.
      invalidateUserLockdownCache(targetId)
      await audit({
        ...actor,
        action: `lockdown.${action}`,
        scope: 'user',
        target: `users/${targetId}`,
        before: { locked: before != null, ...auditLockShape(before ?? {}) },
        after: {
          locked: action === 'lock',
          ...(action === 'lock' ? auditLockShape(lock) : {}),
        },
      })
      return actionResponse({ firestore, scope, targetId, action })
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
        scope: 'org',
        target: `orgs/${targetId}`,
        before: {
          locked: orgSnapshot.get('suspendedAt') != null,
          // The org scope carries the lock on the org doc's `suspended*`
          // family, not in `lockdowns/*` — same three facts, other names.
          ...auditLockShape({
            reason: orgSnapshot.get('suspendedReasonCode'),
            message: orgSnapshot.get('suspendedMessage'),
            untilMs: orgSnapshot.get('suspendedUntilMs'),
          }),
        },
        after: {
          locked: action === 'lock',
          ...(action === 'lock' ? auditLockShape(lock) : {}),
          tokensRevoked: result.tokensRevoked,
        },
      })
      return actionResponse({ firestore, scope, targetId, action, extra: result })
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
      scope: 'host',
      target: `hosts/${targetId}`,
      before: {
        locked: hostSnapshot.get('suspendedAt') != null,
        ...auditLockShape({
          reason: hostSnapshot.get('suspendedReasonCode'),
          message: hostSnapshot.get('suspendedMessage'),
          untilMs: hostSnapshot.get('suspendedUntilMs'),
        }),
      },
      after: {
        locked: action === 'lock',
        ...(action === 'lock' ? auditLockShape(lock) : {}),
      },
    })
    return actionResponse({ firestore, scope, targetId, action, extra: result })
  } catch (error) {
    console.error('[admin/lockdown] failed', error)
    return Response.json({ error: 'Lockdown action failed' }, { status: 500 })
  }
}

export { handler as GET, handler as POST }
