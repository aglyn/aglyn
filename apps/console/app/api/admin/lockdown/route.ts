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
  isLockdownMode,
  isLockdownReasonCode,
  LOCKDOWN_FEATURE_KEYS,
  LOCKDOWN_MESSAGE_MAX,
  LOCKDOWN_MODES,
  LOCKDOWNS_COLLECTION,
  type LockdownMode,
  PLATFORM_LOCKDOWN_DOC_ID,
  pluginRequestFromWeb,
  userLockdownDocId,
} from '@aglyn/aglyn/server'
import {
  authForPool,
  emailUnverifiedResponse,
  featureLockdownRefusal,
  findUserByUidAcrossPools,
  firebaseAdmin,
  getLockdownVerdict,
  invalidateFeatureLockdownCache,
  invalidatePlatformLockdownCache,
  invalidateUserLockdownCache,
  isImpersonationSession,
  lockdownJsonResponse,
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
  mode?: unknown
}): {
  reason: string | null
  message: string | null
  untilMs: number | null
  mode: string
} {
  return {
    reason: typeof lock.reason === 'string' ? lock.reason : null,
    message: typeof lock.message === 'string' ? lock.message : null,
    untilMs: typeof lock.untilMs === 'number' ? lock.untilMs : null,
    // Recorded on BOTH sides of every row and never null (AGL-1511): "staff
    // froze writes" and "staff took the workspace down" are different
    // actions with different blast radii, and a trail that cannot tell them
    // apart cannot answer the only question anyone asks it afterwards. The
    // storage default is applied here so a row about a pre-AGL-1511 lock
    // reads `full` rather than a gap the reader has to interpret.
    mode: lock.mode === 'read-only' ? 'read-only' : 'full',
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
  /** `full` | `read-only`; `full` whenever the carrier says nothing. */
  mode: LockdownMode
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
      mode:
        snapshot.get('suspendedMode') === 'read-only' ? 'read-only' : 'full',
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
    mode: data?.['mode'] === 'read-only' ? 'read-only' : 'full',
    reason: (data?.['reason'] as string) ?? null,
    message: (data?.['message'] as string) ?? null,
    untilMs: (data?.['untilMs'] as number) ?? null,
    atMs: (data?.['atMs'] as number) ?? null,
  }
}

/**
 * THE VERDICT PROBE (AGL-1573): what would a given caller be told right now?
 *
 * The bind this answers: the identity authorised to engage a lockdown is
 * `staffRole === 'super'`, and `getLockdownVerdict` returns null for
 * `staff === true` on its FIRST line — so the operator who presses the
 * button is, by construction, the one identity that can never see its
 * effect. Dropping the credential does not help either: auth runs before
 * the verdict, so an anonymous caller gets 401 and never reaches it. The
 * 423 therefore sits in a band between 401 and staff-bypass that a solo
 * staff operator cannot occupy.
 *
 * This does not escape that bind — it sidesteps the need to. Instead of
 * BEING the refused caller, staff describe one: a uid, an org, a host, and
 * the same `getLockdownVerdict` every chokepoint calls answers for that
 * subject. The refusal body is produced by calling the real
 * `lockdownJsonResponse` and reading it back, so this can never drift into
 * a second, prettier rendering of the truth — if the 423 changes, this
 * changes with it.
 *
 * WHAT IT IS NOT: a wire observation. It reports what THIS process computes
 * from state it reads now; it does not prove any route returned it, and a
 * warm process elsewhere can still be up to PLATFORM_TTL_MS behind. The
 * response says so in `kind` and the staff page repeats it, because a
 * computed verdict mistaken for a measured one is exactly the class of
 * belief the AGL-1571 read-back exists to end.
 *
 * The subject's OWN staff claim is looked up and passed through rather than
 * assumed false: evaluating a staff uid truthfully answers "not locked —
 * they bypass every scope", and silently reporting that as an unlocked
 * platform would be a lie of the most reassuring kind.
 */
async function evaluateVerdict(
  firestore: AdminFirestore,
  subject: { uid: string; orgId: string; hostId: string },
): Promise<Response> {
  const { uid, orgId, hostId } = subject
  if (!uid && !orgId && !hostId) {
    return Response.json(
      { error: 'Give at least one of uid, orgId or hostId to evaluate' },
      { status: 400 },
    )
  }

  // An ABSENT scope is not an unlocked one: `getLockdownVerdict` simply does
  // not evaluate a scope it was handed nothing for. The operator is told
  // which scopes this answer actually covers, so a "not locked" for a uid
  // alone is never read as "this customer's workspace is fine".
  const [orgSnapshot, hostSnapshot, found] = await Promise.all([
    orgId ? firestore.collection('orgs').doc(orgId).get() : null,
    hostId ? firestore.collection('hosts').doc(hostId).get() : null,
    uid ? findUserByUidAcrossPools(uid).catch(() => null) : null,
  ])

  const subjectStaff = found?.record.customClaims?.['staff'] === true
  const state = await getLockdownVerdict({
    staff: subjectStaff,
    uid: uid || null,
    org: orgSnapshot?.exists ? (orgSnapshot.data() as never) : undefined,
    host: hostSnapshot?.exists ? (hostSnapshot.data() as never) : undefined,
  })

  // Build the ACTUAL refusal and read it back, rather than re-describing it.
  let refusal: { status: number; body: unknown } | null = null
  if (state) {
    const response = lockdownJsonResponse(state)
    refusal = { status: response.status, body: await response.json() }
  }

  // A feature lock refuses a capability without touching the scope verdict,
  // so "what is this customer seeing" is incomplete without it — a caller
  // whose org is fine may still be unable to upload or check out.
  const features = await Promise.all(
    LOCKDOWN_FEATURE_KEYS.map(async (feature) => {
      const response = await featureLockdownRefusal({
        feature,
        staff: subjectStaff,
      })
      return {
        feature,
        locked: response != null,
        body: response ? await response.json() : null,
      }
    }),
  )

  return Response.json(
    {
      kind: 'computed-verdict',
      note:
        'COMPUTED, not observed. This is the verdict this server process ' +
        'derives for the described caller right now — not proof that any ' +
        'route returned it, and other processes may be up to 15s behind.',
      computedAtMs: Date.now(),
      subject: {
        uid: uid || null,
        orgId: orgId || null,
        hostId: hostId || null,
        /** Null where the scope was not asked about at all. */
        uidExists: uid ? found != null : null,
        orgExists: orgId ? orgSnapshot?.exists === true : null,
        hostExists: hostId ? hostSnapshot?.exists === true : null,
        staff: uid ? subjectStaff : null,
      },
      /** The scopes this answer actually covers; the rest were not asked. */
      evaluated: [
        'platform',
        ...(orgSnapshot?.exists ? ['org'] : []),
        ...(hostSnapshot?.exists ? ['host'] : []),
        ...(uid ? ['user'] : []),
      ],
      staffBypass: subjectStaff,
      locked: state != null,
      verdict: state,
      refusal,
      features,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
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
      // The verdict probe (AGL-1573): "what would THIS caller be told".
      // Read-only and open to every staff role, like the state probe below
      // — during a live incident the person who needs to answer "what is
      // this customer actually seeing right now" is usually support, not
      // the super-role operator who armed the lock.
      if (query?.['verdict'] !== undefined) {
        return evaluateVerdict(firestore, {
          uid: String(query?.['uid'] ?? '').trim(),
          orgId: String(query?.['orgId'] ?? '').trim(),
          hostId: String(query?.['hostId'] ?? '').trim(),
        })
      }

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

    /*==========================================
     * MODE (AGL-1511): how hard the lock bites.
     *=========================================*/
    // Absent = `full`, so every existing caller — the staff page's other
    // cards, the billing auto-lock sweep, any runbook curl — keeps its
    // shipped behaviour without knowing this field exists.
    const mode: LockdownMode = isLockdownMode(body?.mode) ? body.mode : 'full'
    if (action === 'lock' && body?.mode !== undefined && !isLockdownMode(body.mode)) {
      return Response.json(
        { error: `mode must be one of: ${LOCKDOWN_MODES.join(', ')}` },
        { status: 400 },
      )
    }
    // Read-only is refused on the two scopes where it would be a LIE rather
    // than a milder lock, instead of being quietly accepted and downgraded:
    //
    //  - `user` — the user lock's teeth are the Firebase Auth `disabled`
    //    flag and refresh-token revocation. Those are all-or-nothing; a
    //    "read-only user" would be an ordinary full lockout wearing a label
    //    that says otherwise, which is the worst of both.
    //  - `feature` — a feature lock already names a single capability, and
    //    every one of them (signups, uploads, checkout, installs, ai-assist)
    //    IS a write. "Read-only checkout" describes nothing.
    //
    // An operator who asked for the gentler lock and silently got the harder
    // one is the failure this refusal exists to prevent.
    if (action === 'lock' && mode === 'read-only' && (scope === 'user' || scope === 'feature')) {
      return Response.json(
        {
          error:
            `read-only has no meaning at the ${scope} scope — a ${scope} lock ` +
            `is all-or-nothing. Use scope platform, org or host, or lock ` +
            `${scope} in full.`,
        },
        { status: 400 },
      )
    }
    const lock = { reason: String(reason), message, untilMs, mode }
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
          // Stored ONLY for read-only (AGL-1511): a full lock's document is
          // byte-identical to one written before the field existed, so no
          // migration and no re-interpretation of history.
          ...(mode === 'read-only' ? { mode } : {}),
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
        //
        // READ-ONLY NEVER REVOKES (AGL-1511), whatever the reason. Logging
        // everyone out is a full lockdown's effect; doing it here would
        // deliver "your sites keep serving and you can keep reading" by
        // signing every member out of the console. The write freeze is
        // enforced at the chokepoints, which is where it belongs — the
        // session is not the mechanism.
        revokeMemberTokens:
          mode !== 'read-only' &&
          (lock.reason === 'security' || lock.reason === 'manual'),
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
            mode: orgSnapshot.get('suspendedMode'),
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
          mode: hostSnapshot.get('suspendedMode'),
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
