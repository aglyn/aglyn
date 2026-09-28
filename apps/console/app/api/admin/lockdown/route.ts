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
 *  - `domain`   → `lockdowns/domain--{hostname}` (AGL-1513) — locks ONE
 *                 attached custom domain while the same site keeps serving
 *                 on its platform subdomain. Keyed on the NAME, not the host
 *                 id, so the lock survives a detach/re-attach and can be
 *                 placed on a name that is currently attached to nothing —
 *                 which is the state a dispute is usually resolved in.
 *  - `user`     → `lockdowns/user--{uid}` + Firebase Auth `disabled` +
 *                 pool-aware refresh-token revocation
 *
 * Every action — lock AND unlock — writes an `adminAudit` row.
 *
 * A lock can also stop BILLING (AGL-3359): `cancelSubscription: true` on an
 * org lock cancels the workspace's subscriptions now, no refund, and
 * `lockOwnedWorkspaces: true` on a user lock locks and cancels every
 * workspace that account owns. An org or host lock can also stop the SITES'
 * money (AGL-3364): `pauseRenewals: true` pauses the membership renewals
 * they sell and `pausePayouts: true` switches the seller to manual payouts;
 * the lift resumes and restores exactly what that lock paused. All of them
 * run after the lock is written, report as their own step, and can never
 * undo or hide the lock. No flag is implied by a reason — the console
 * defaults them on for `security` only.
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
  domainLockdownDocId,
  featureLockdownDocId,
  orgFeatureLockdownDocId,
  isLockableDomain,
  isLockdownEnforcement,
  isLockdownFeatureKey,
  isLockdownMode,
  isLockdownReasonCode,
  LOCKDOWN_ENFORCEMENTS,
  listLockdownFeatureKeys,
  LOCKDOWN_MESSAGE_MAX,
  LOCKDOWN_MODES,
  LOCKDOWNS_COLLECTION,
  type LockdownEnforcement,
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
  invalidateDomainLockdownCache,
  invalidateFeatureLockdownCache,
  invalidatePlatformLockdownCache,
  invalidateTokenRevocationCache,
  invalidateUserLockdownCache,
  isImpersonationSession,
  lockdownJsonResponse,
  readSignupsCreationTriggerStatus,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { FieldValue } from 'firebase-admin/firestore'
import {
  applyHostLockdown,
  applyOrgLockdown,
} from '../../../../utils/server/org-lockdown'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'

export const dynamic = 'force-dynamic'

const SCOPES = new Set([
  'platform',
  'org',
  'host',
  'domain',
  'user',
  'feature',
])

/**
 * The workspace a feature lock is scoped to (AGL-2927), read off a body or
 * a query. `null` when none was named — the platform-wide document —
 * `false` when one was named and cannot be a document id, which is refused
 * rather than written into a doc id that no door would ever read.
 */
function lockScopeOrgId(value: unknown): string | null | false {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return false
  const orgId = value.trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(orgId) ? orgId : false
}

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
  enforcement?: unknown
}): {
  reason: string | null
  message: string | null
  untilMs: number | null
  mode: string
  enforcement: string
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
    // Recorded on both sides and never null, for the same reason as `mode`
    // (AGL-1621). "Staff issued a takedown that holds through a database
    // outage" and "staff placed an ordinary lock" are different acts with
    // different legal weight, and a takedown is exactly the row someone
    // will later have to produce evidence about. The storage default is
    // applied here so a row about a pre-AGL-1621 lock reads `standard`
    // rather than a gap a reader has to interpret.
    enforcement: lock.enforcement === 'takedown' ? 'takedown' : 'standard',
  }
}

/**
 * The AGL-1526 raw-URL revocation, flattened onto the audit row.
 *
 * Absent entirely when rotation was not attempted (any non-`security` lock,
 * any read-only lock, any unlock), so the row never implies a revocation
 * that policy declined to perform. When it DID run, `truncated` rides along
 * — a capped scan leaves live raw URLs behind, and an incident reviewer
 * reading "rotated: 5000" must be able to see that it was not all of them.
 */
function auditRotationShape(
  results: Array<{
    scanned: number
    rotated: number
    failed: number
    truncated: boolean
    ok: boolean
  }> = [],
): Record<string, unknown> {
  if (!results.length) return {}
  const sum = (pick: (r: (typeof results)[number]) => number) =>
    results.reduce((total, entry) => total + (pick(entry) || 0), 0)
  return {
    downloadTokensRotated: sum((r) => r.rotated),
    downloadTokensScanned: sum((r) => r.scanned),
    downloadTokenFailures: sum((r) => r.failed),
    downloadTokenRotationTruncated: results.some((r) => r.truncated || !r.ok),
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
  await addAdminAudit(firebaseAdmin.app().firestore(), {
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
  /**
   * `standard` | `takedown`; `standard` whenever the carrier says nothing
   * (AGL-1621). Read back so the operator can VERIFY the class they chose
   * actually landed — a takedown that silently wrote as standard looks
   * identical on the page and behaves differently in the incident.
   */
  enforcement: LockdownEnforcement
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
  /** The workspace a feature lock is scoped to (AGL-2927); absent = platform-wide. */
  orgId?: string,
): Promise<LockState> {
  const base = {
    scope,
    targetId,
    ...(scope === 'feature' && orgId ? { orgId } : {}),
    readAtMs: Date.now(),
  }
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
      enforcement:
        snapshot.get('suspendedEnforcement') === 'takedown'
          ? 'takedown'
          : 'standard',
      atMs: toMillis(snapshot.get('suspendedAt')),
    }
  }
  const docId =
    scope === 'platform'
      ? PLATFORM_LOCKDOWN_DOC_ID
      : scope === 'feature'
        ? orgId
          ? orgFeatureLockdownDocId(
              targetId as Parameters<typeof featureLockdownDocId>[0],
              orgId,
            )
          : featureLockdownDocId(
              targetId as Parameters<typeof featureLockdownDocId>[0],
            )
        : // AGL-1513: `domain--{hostname}`, the same existence-is-the-lever
          // shape as platform/feature/user, so it needs only its own id.
          scope === 'domain'
          ? domainLockdownDocId(targetId)
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
    enforcement:
      data?.['enforcement'] === 'takedown' ? 'takedown' : 'standard',
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
  const subjectScopes = {
    staff: subjectStaff,
    uid: uid || null,
    org: orgSnapshot?.exists ? (orgSnapshot.data() as never) : undefined,
    host: hostSnapshot?.exists ? (hostSnapshot.data() as never) : undefined,
  }

  /**
   * Build the ACTUAL refusal and read it back, rather than re-describing it.
   * `getLockdownVerdict` answers per INTENT since AGL-1511, so an answer for
   * one intent is not an answer for the other.
   */
  const evaluateIntent = async (intent: 'read' | 'write') => {
    const state = await getLockdownVerdict({ ...subjectScopes, intent })
    if (!state) return { locked: false, verdict: null, refusal: null }
    const response = lockdownJsonResponse(state)
    return {
      locked: true,
      verdict: state,
      refusal: { status: response.status, body: await response.json() },
    }
  }

  /**
   * BOTH INTENTS, ALWAYS (AGL-1628). The probe used to evaluate without an
   * intent, which meant `write` — true for a write and false for the read the
   * same caller is making right now. Under a read-only lock that reported a
   * flat "locked" with a 423 body, and the one question read-only mode
   * creates ("their site is up but they cannot save — is that us?") could not
   * be answered from this panel at all.
   *
   * Evaluated rather than toggled: an incident is the wrong moment to make an
   * operator pick the right radio button, and the second evaluation costs no
   * extra Firestore read (the platform and user reads are memoized, and the
   * org/host docs are already in hand).
   */
  const [reads, writes] = await Promise.all([
    evaluateIntent('read'),
    evaluateIntent('write'),
  ])

  // The pre-AGL-1628 keys keep meaning the WRITE case, so anything already
  // reading this response — the staff page, a runbook, a saved curl — keeps
  // reading exactly what it read before.
  const state = writes.verdict
  const refusal = writes.refusal

  // A feature lock refuses a capability without touching the scope verdict,
  // so "what is this customer seeing" is incomplete without it — a caller
  // whose org is fine may still be unable to upload or check out.
  const features = await Promise.all(
    listLockdownFeatureKeys().map(async (feature) => {
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
      /**
       * The same verdict asked BOTH ways (AGL-1628). Under a read-only lock
       * these disagree, and that disagreement IS the answer: reads pass,
       * writes refuse. Under a full lock both refuse; under no lock both
       * pass; for staff both pass, because they bypass every scope.
       *
       * `writes` duplicates the `locked`/`refusal` pair above on purpose —
       * those keys have always meant the write case and keep meaning it, so
       * a saved script reading them is unaffected, while a reader who wants
       * the distinction does not have to know that history.
       */
      reads: { locked: reads.locked, refusal: reads.refusal },
      writes: { locked: writes.locked, refusal: writes.refusal },
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
  orgId?: string
  extra?: object
}): Promise<Response> {
  const verified = await readLockState(
    options.firestore,
    options.scope,
    options.targetId,
    options.orgId,
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

interface LockActor {
  actorUid: string
  actorEmail: string | null
}

interface LockRequest {
  reason: string
  message?: string
  untilMs?: number
  mode: LockdownMode
  enforcement: LockdownEnforcement
}

type OrgSnapshot = FirebaseFirestore.DocumentSnapshot

/**
 * One workspace lock or lift, with its audit row — the org scope's whole
 * write path. A function so the user scope's "and the workspaces they own"
 * (AGL-3359) runs the very same path rather than a second copy of it.
 */
async function lockOrgAndAudit(options: {
  firestore: AdminFirestore
  actor: LockActor
  orgId: string
  orgSnapshot: OrgSnapshot
  action: 'lock' | 'unlock'
  lock: LockRequest
  /** Set when the lock was placed as part of another scope's action. */
  via?: string
}) {
  const { firestore, actor, orgId, orgSnapshot, action, lock } = options
  const result = await applyOrgLockdown({
    firestore,
    orgId,
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
      lock.mode !== 'read-only' &&
      (lock.reason === 'security' || lock.reason === 'manual'),
  })
  await audit({
    ...actor,
    action: `lockdown.${action}`,
    scope: 'org',
    target: `orgs/${orgId}`,
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
      ...(options.via ? { via: options.via } : {}),
      tokensRevoked: result.tokensRevoked,
      // AGL-1526 completion, on the row: how many raw
      // `firebasestorage.googleapis.com?...&token=` URLs this lock
      // actually killed. Recorded even when it is zero, because
      // "rotation ran and found nothing" and "rotation never ran" are
      // different facts to an incident reviewer.
      ...auditRotationShape(result.downloadTokensRotated),
    },
  })
  return result
}

/**
 * The billing half of a lock (AGL-3359): cancel every subscription of the
 * workspace NOW, no refund, through the same helper as the staff org page.
 *
 * Runs only after the lock is written and audited, and cannot throw: any
 * failure comes back as an unconfirmed step, so the response still reports a
 * lock that landed. Lifting the lock later never recreates a subscription.
 *
 * Loaded on demand. Only a lock that asks for it pays for the Stripe and
 * price-map modules, and the rest of this route keeps no dependency on them.
 */
async function cancelBillingAfterLock(options: {
  firestore: AdminFirestore
  actor: LockActor
  orgId: string
  reason: string
}): Promise<Record<string, unknown>> {
  try {
    const {
      auditOrgSubscriptionCancel,
      cancellationComment,
      cancelOrgSubscriptions,
    } = await import('../../../../utils/server/org-subscription-cancel')
    const result = await cancelOrgSubscriptions({
      orgId: options.orgId,
      when: 'now',
      comment: cancellationComment({
        reason: options.reason,
        actorUid: options.actor.actorUid,
        via: 'lockdown',
      }),
    })
    await auditOrgSubscriptionCancel(options.firestore, {
      ...options.actor,
      reason: options.reason,
      note: null,
      via: 'lockdown',
      result,
    }).catch((error: unknown) => {
      // The cancel already happened or did not; a lost audit row cannot
      // change that, so it is logged rather than reported as a failed cancel.
      console.error('[admin/lockdown] cancel audit write failed', error)
    })
    return { attempted: true, ...result }
  } catch (error) {
    console.error('[admin/lockdown] subscription cancel failed', error)
    return {
      attempted: true,
      orgId: options.orgId,
      when: 'now',
      confirmed: false,
      changed: 0,
      subscriptions: [],
      lookupErrors: [
        `The cancel did not run: ${(error as Error)?.message ?? String(error)}`,
      ],
    }
  }
}

/**
 * A tenant lock's money steps (AGL-3364): pause the membership renewals the
 * locked sites sell, and switch the seller's connected account to manual
 * payouts. Each is asked for by its own explicit flag — the console ticks
 * both for `security` only — and runs after the lock is durable. Neither
 * can throw here: a failure is an unconfirmed step beside a lock that
 * stands. Loaded on demand, with the plugins that declare what a site
 * sells, so a lock that asks for neither pays for none of it.
 */
async function pauseMoneyAfterLock(options: {
  firestore: AdminFirestore
  actor: LockActor
  scope: 'org' | 'host'
  targetId: string
  reason: string
  renewals: boolean
  payouts: boolean
}): Promise<Record<string, unknown>> {
  if (!options.renewals && !options.payouts) return {}
  const steps: Record<string, unknown> = {}
  try {
    const billing = await import('../../../../utils/server/lockdown-billing-pause')
    const target = await billing.resolveLockdownBillingTarget(
      options.firestore,
      options.scope,
      options.targetId,
    )
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (options.renewals) {
      const { serverPluginLoader } = await import('../../../../utils/server-plugin-loader')
      const { listRecurringChargeSources } = await import(
        '@aglyn/aglyn/plugin-manager/plugin-recurring-charges'
      )
      await serverPluginLoader.ensureAll(['consoleApi'])
      const renewals = await billing.pauseMembershipRenewals({
        firestore: options.firestore,
        scope: options.scope,
        targetId: options.targetId,
        hostIds: target.hostIds,
        sources: listRecurringChargeSources(),
        secretKey,
        actorUid: options.actor.actorUid,
      })
      const withLookups = {
        ...renewals,
        lookupErrors: [...target.lookupErrors, ...renewals.lookupErrors],
        confirmed: renewals.confirmed && target.lookupErrors.length === 0,
      }
      steps['renewalsPause'] = withLookups
      await billing
        .auditLockdownBillingStep(options.firestore, {
          ...options.actor,
          scope: options.scope,
          targetId: options.targetId,
          reason: options.reason,
          action: 'lockdown.renewals-pause',
          result: withLookups,
        })
        .catch((error: unknown) =>
          console.error('[admin/lockdown] renewals audit write failed', error),
        )
    }
    if (options.payouts) {
      const payouts = await billing.pauseSellerPayouts({
        firestore: options.firestore,
        scope: options.scope,
        targetId: options.targetId,
        accountId: target.accountId,
        secretKey,
        actorUid: options.actor.actorUid,
      })
      steps['payoutsPause'] = payouts
      await billing
        .auditLockdownBillingStep(options.firestore, {
          ...options.actor,
          scope: options.scope,
          targetId: options.targetId,
          reason: options.reason,
          action: 'lockdown.payouts-pause',
          result: { ...payouts },
        })
        .catch((error: unknown) =>
          console.error('[admin/lockdown] payouts audit write failed', error),
        )
    }
  } catch (error) {
    console.error('[admin/lockdown] money pause failed', error)
    const failed = {
      attempted: true,
      confirmed: false,
      error: `The pause did not run: ${(error as Error)?.message ?? String(error)}`,
    }
    if (options.renewals && !steps['renewalsPause']) {
      steps['renewalsPause'] = { ...failed, subscriptions: [], lookupErrors: [failed.error] }
    }
    if (options.payouts && !steps['payoutsPause']) steps['payoutsPause'] = failed
  }
  return steps
}

/**
 * A lift's half (AGL-3364): resume exactly the renewals and restore exactly
 * the payout schedule THIS lock paused, and nothing it did not. Always runs
 * on an org or host lift — it touches only what this lock recorded, so a
 * lock that paused nothing costs one read and reports nothing.
 */
async function resumeMoneyAfterLift(options: {
  firestore: AdminFirestore
  actor: LockActor
  scope: 'org' | 'host'
  targetId: string
}): Promise<Record<string, unknown>> {
  try {
    const billing = await import('../../../../utils/server/lockdown-billing-pause')
    const secretKey = process.env.STRIPE_SECRET_KEY
    const renewals = await billing.resumeMembershipRenewals({
      firestore: options.firestore,
      scope: options.scope,
      targetId: options.targetId,
      secretKey,
    })
    const payouts = await billing.restoreSellerPayouts({
      firestore: options.firestore,
      scope: options.scope,
      targetId: options.targetId,
      secretKey,
    })
    const steps: Record<string, unknown> = {}
    if (renewals.subscriptions.length || renewals.lookupErrors.length) {
      steps['renewalsResume'] = renewals
      await billing
        .auditLockdownBillingStep(options.firestore, {
          ...options.actor,
          scope: options.scope,
          targetId: options.targetId,
          reason: null,
          action: 'lockdown.renewals-resume',
          result: { ...renewals },
        })
        .catch((error: unknown) =>
          console.error('[admin/lockdown] renewals audit write failed', error),
        )
    }
    if (payouts.outcome !== 'nothing-held') {
      steps['payoutsRestore'] = payouts
      await billing
        .auditLockdownBillingStep(options.firestore, {
          ...options.actor,
          scope: options.scope,
          targetId: options.targetId,
          reason: null,
          action: 'lockdown.payouts-restore',
          result: { ...payouts },
        })
        .catch((error: unknown) =>
          console.error('[admin/lockdown] payouts audit write failed', error),
        )
    }
    return steps
  } catch (error) {
    console.error('[admin/lockdown] money resume failed', error)
    return {
      renewalsResume: {
        attempted: true,
        confirmed: false,
        subscriptions: [],
        lookupErrors: [
          `The resume did not run: ${(error as Error)?.message ?? String(error)}`,
        ],
      },
    }
  }
}

/** How many owned workspaces one user lock will lock and cancel. */
const OWNED_WORKSPACES_MAX = 25

/**
 * A user lock's "and the workspaces they solely own" (AGL-3359).
 *
 * Owned means `orgs.ownerUid` — the owner seat is single, so every workspace
 * it names is this account's alone; workspaces they are merely a MEMBER of
 * are never touched. Each one goes through the org scope's own path: locked
 * (unless it already is, whose lock is left exactly as it was set) and
 * audited as its own row, then its billing cancelled.
 */
async function lockOwnedWorkspaces(options: {
  firestore: AdminFirestore
  actor: LockActor
  uid: string
  lock: LockRequest
}): Promise<Record<string, unknown>> {
  const { firestore, actor, uid, lock } = options
  let owned: OrgSnapshot[]
  try {
    const snapshot = await firestore
      .collection('orgs')
      .where('ownerUid', '==', uid)
      .limit(OWNED_WORKSPACES_MAX + 1)
      .get()
    owned = snapshot.docs as OrgSnapshot[]
  } catch (error) {
    return {
      confirmed: false,
      workspaces: [],
      error: `Finding the workspaces this account owns failed: ${
        (error as Error)?.message ?? String(error)
      }`,
    }
  }
  const truncated = owned.length > OWNED_WORKSPACES_MAX
  const workspaces: Array<Record<string, unknown>> = []
  for (const orgSnapshot of owned.slice(0, OWNED_WORKSPACES_MAX)) {
    const orgId = orgSnapshot.id
    const slug = orgSnapshot.get('slug') ?? null
    const alreadyLocked = orgSnapshot.get('suspendedAt') != null
    let lockError: string | null = null
    if (!alreadyLocked) {
      try {
        await lockOrgAndAudit({
          firestore,
          actor,
          orgId,
          orgSnapshot,
          action: 'lock',
          lock,
          via: `user-lock:${uid}`,
        })
      } catch (error) {
        lockError = (error as Error)?.message ?? String(error)
      }
    }
    const verified = await readLockState(firestore, 'org', orgId)
    const subscriptionCancel = await cancelBillingAfterLock({
      firestore,
      actor,
      orgId,
      reason: lock.reason,
    })
    workspaces.push({
      orgId,
      slug,
      alreadyLocked,
      lockError,
      verified,
      confirmed: verified.locked,
      subscriptionCancel,
    })
  }
  return {
    workspaces,
    truncated,
    confirmed:
      !truncated &&
      workspaces.every(
        (workspace) =>
          workspace['confirmed'] === true &&
          (workspace['subscriptionCancel'] as { confirmed?: boolean })
            ?.confirmed === true,
      ),
  }
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
              error: `Unknown feature — one of: ${listLockdownFeatureKeys().join(', ')}`,
            },
            { status: 400 },
          )
        }
        // A feature probe may name the workspace it asks about (AGL-2927):
        // the staff org page reads its AI pause through this.
        const probeOrgId =
          probeScope === 'feature' ? lockScopeOrgId(query?.['orgId']) : null
        if (probeOrgId === false) {
          return Response.json({ error: 'Malformed orgId' }, { status: 400 })
        }
        return Response.json(
          {
            state: await readLockState(
              firestore,
              probeScope,
              probeTarget,
              probeOrgId ?? undefined,
            ),
          },
          { status: 200 },
        )
      }

      // The current-state read for the staff page: the lockdowns collection
      // (platform + user scopes). Org/host lockdowns live on their own docs
      // and are visible on the org/host staff surfaces.
      //
      // Alongside it, and NOT after it: whether the signups lock's
      // creation-level valve is armed (AGL-1531). That answer lives in
      // Identity Platform rather than in this repo, so the panic page can
      // only state it by asking. In parallel because the panic page's load
      // time is the one thing an incident cannot spend.
      const [snapshot, signupsCreationTrigger] = await Promise.all([
        firestore.collection(LOCKDOWNS_COLLECTION).limit(200).get(),
        // Never allowed to take the panic page down. This probe reaches an
        // API outside this deployment; if it fails in a way its own guards
        // did not anticipate, the page must still render every lock — an
        // unknown valve is a caveat, an unrenderable page is an outage.
        Promise.resolve()
          .then(() => readSignupsCreationTriggerStatus())
          .catch(() => ({
            status: 'unknown' as const,
            reason: 'The Identity Platform probe failed on this server.',
          })),
      ])
      const records = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      return Response.json(
        { records, signupsCreationTrigger },
        { status: 200 },
      )
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
    // Read-only is refused on the scopes where it would be a LIE rather than
    // a milder lock, instead of being quietly accepted and downgraded. An
    // operator who asked for the gentler lock and silently got the harder one
    // is the failure this refusal exists to prevent — and, in the `domain`
    // case below, the failure it did NOT prevent until AGL-1621.
    const READ_ONLY_REFUSED: Record<string, string> = {
      //  - `user` — the user lock's teeth are the Firebase Auth `disabled`
      //    flag and refresh-token revocation. Those are all-or-nothing; a
      //    "read-only user" would be an ordinary full lockout wearing a label
      //    that says otherwise, which is the worst of both.
      user:
        'read-only has no meaning at the user scope — a user lock is ' +
        'all-or-nothing. Use scope platform, org or host, or lock user in full.',
      //  - `feature` — a feature lock already names a single capability, and
      //    every one of them (signups, uploads, checkout, installs, ai-assist,
      //    ai-generate) IS a write. "Read-only checkout" describes nothing.
      feature:
        'read-only has no meaning at the feature scope — a feature lock is ' +
        'all-or-nothing. Use scope platform, org or host, or lock feature in full.',
      //  - `domain` (AGL-1513, refused since AGL-1621) — this one shipped
      //    ACCEPTED and was the bug. The scope arrived after AGL-1511, was
      //    never added to this list, and its carrier write never got the
      //    `mode` spread the other carriers have; so `mode: 'read-only'`
      //    returned 200, was dropped on the floor, and the document read back
      //    through `lockdownMode()` as `full` — the absent-means-full
      //    fail-safe doing its job on a value the operator had supplied. An
      //    operator asked for the lighter action, was told it worked, and a
      //    whole custom domain went dark.
      //
      //    Persisting the field instead would have been the wrong repair,
      //    because read-only has NO enforcement surface at this scope:
      //
      //      * every path that knows about the domain scope is a path that
      //        SERVES — the edge verdict (`mode !== 'read-only'` decides
      //        `blocked`), the page loader (`!isReadOnlyLockdown` decides the
      //        maintenance fallback), and the locked-notice route itself. All
      //        three keep serving under read-only, by design;
      //      * and neither write gate resolves the domain scope at all.
      //        `getSiteLockdown` and `getLockdownVerdict` compose
      //        platform/org/host(/user), never `domain`, and they cannot: both
      //        are keyed by hostId, while a domain lock is keyed by HOSTNAME,
      //        and a site can carry several attached names. The write path
      //        never learns which name the request arrived on.
      //
      //    So a stored read-only domain lock would refuse nothing anywhere
      //    while the console reported LOCKED. It is also the same
      //    contradiction the read-only takedown refusal names one block down:
      //    a domain lock exists to stop serving THIS NAME (hijack, dispute,
      //    abuse), and read-only is defined as continuing to serve it.
      domain:
        'read-only has no meaning at the domain scope — a domain lock stops ' +
        'serving one name, and read-only keeps serving it. Nothing would ' +
        'refuse. Lock the domain in full, or use scope org or host for a ' +
        'read-only freeze across the whole site.',
    }
    if (action === 'lock' && mode === 'read-only' && READ_ONLY_REFUSED[scope]) {
      return Response.json(
        { error: READ_ONLY_REFUSED[scope] },
        { status: 400 },
      )
    }
    /*=================================================================
     * ENFORCEMENT (AGL-1621): what happens if we cannot READ this lock.
     *================================================================*/
    // Absent = `standard` = fail open, which is the shipped behaviour and
    // the safety default. Every existing caller — the staff page's other
    // cards, the billing auto-lock sweep, any runbook curl — keeps failing
    // open without knowing this field exists, and an operator who does not
    // make a choice gets the availability-preserving one.
    const enforcement: LockdownEnforcement = isLockdownEnforcement(
      body?.enforcement,
    )
      ? body.enforcement
      : 'standard'
    // A junk value is REFUSED rather than silently defaulted. Defaulting is
    // right for an absent field (the operator said nothing) and wrong for a
    // malformed one (the operator meant something and we could not read it)
    // — and here the two possible mistakes are "a takedown quietly became
    // an ordinary lock" and "an ordinary lock quietly became fail-closed".
    if (
      action === 'lock' &&
      body?.enforcement !== undefined &&
      !isLockdownEnforcement(body.enforcement)
    ) {
      return Response.json(
        {
          error: `enforcement must be one of: ${LOCKDOWN_ENFORCEMENTS.join(', ')}`,
        },
        { status: 400 },
      )
    }
    // A read-only takedown is a contradiction, and refused for the same
    // reason read-only is refused at the user and feature scopes: it would
    // be a label that lies. `read-only` keeps SERVING the content and only
    // refuses writes — so a "read-only takedown" is a takedown that
    // continues to publish the very material it was issued over, while its
    // fail-closed classification implies the opposite.
    if (action === 'lock' && enforcement === 'takedown' && mode === 'read-only') {
      return Response.json(
        {
          error:
            'A takedown cannot be read-only — a read-only lock keeps serving ' +
            'the content and only refuses writes. Use mode: full for a ' +
            'takedown, or enforcement: standard for a read-only lock.',
        },
        { status: 400 },
      )
    }
    const lock = { reason: String(reason), message, untilMs, mode, enforcement }
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
          // Stored ONLY for takedowns (AGL-1621), same discipline as `mode`:
          // a standard lock's document stays byte-identical to one written
          // before the field existed, so absent keeps meaning fail-open.
          ...(enforcement === 'takedown' ? { enforcement } : {}),
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
            error: `Unknown feature — one of: ${listLockdownFeatureKeys().join(', ')}`,
          },
          { status: 400 },
        )
      }
      // WORKSPACE-scoped (AGL-2927) when the body names an org: the same
      // capability switched off for ONE customer, on its own carrier, so
      // the platform-wide document is neither written nor implied. The
      // staff org page's AI pause is this with `ai-assist` and
      // `ai-generate` — a spend stop that leaves the entitlement in place,
      // so lifting it restores exactly what the customer bought.
      const featureOrgId = lockScopeOrgId(body?.orgId)
      if (featureOrgId === false) {
        return Response.json({ error: 'Malformed orgId' }, { status: 400 })
      }
      const featureDocId = featureOrgId
        ? orgFeatureLockdownDocId(targetId, featureOrgId)
        : featureLockdownDocId(targetId)
      const ref = firestore.collection(LOCKDOWNS_COLLECTION).doc(featureDocId)
      const before = (await ref.get()).data() ?? null
      if (action === 'lock') {
        await ref.set({
          scope: 'feature',
          feature: targetId,
          ...(featureOrgId ? { orgId: featureOrgId } : {}),
          // Stored ONLY for takedowns (AGL-1621), same discipline as `mode`:
          // a standard lock's document stays byte-identical to one written
          // before the field existed, so absent keeps meaning fail-open.
          ...(enforcement === 'takedown' ? { enforcement } : {}),
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
        target: `lockdowns/${featureDocId}`,
        before: { locked: before != null, ...auditLockShape(before ?? {}) },
        after: {
          locked: action === 'lock',
          feature: targetId,
          ...(featureOrgId ? { orgId: featureOrgId } : {}),
          ...(action === 'lock' ? auditLockShape(lock) : {}),
        },
      })
      return actionResponse({
        firestore,
        scope,
        targetId,
        action,
        orgId: featureOrgId ?? undefined,
        extra: {
          feature: targetId,
          ...(featureOrgId ? { orgId: featureOrgId } : {}),
        },
      })
    }

    /*==========================================
     * DOMAIN (AGL-1513)
     *=========================================*/
    if (scope === 'domain') {
      // Lock ONE attached name while the same site keeps serving on its
      // platform subdomain. No type-to-confirm, same reasoning as `feature`:
      // this is the NARROW lever, and it is narrower than a host takedown —
      // the customer's content is fine, the name is the problem.
      if (!isLockableDomain(targetId)) {
        return Response.json(
          {
            error:
              'Not a lockable domain — expected a custom hostname outside the platform apex',
          },
          { status: 400 },
        )
      }
      const hostname = targetId.trim().toLowerCase()
      const ref = firestore
        .collection(LOCKDOWNS_COLLECTION)
        .doc(domainLockdownDocId(hostname))
      const before = (await ref.get()).data() ?? null
      if (action === 'lock') {
        await ref.set({
          scope: 'domain',
          // Stored ONLY for takedowns (AGL-1621), same discipline as `mode`:
          // a standard lock's document stays byte-identical to one written
          // before the field existed, so absent keeps meaning fail-open.
          ...(enforcement === 'takedown' ? { enforcement } : {}),
          reason: lock.reason,
          ...(message ? { message } : {}),
          ...(untilMs !== undefined ? { untilMs } : {}),
          atMs: Date.now(),
          actorUid: decoded.uid,
        })
      } else {
        await ref.delete()
      }
      // The process that flipped the switch enforces it NOW; other processes
      // converge within the reader's 15s TTL.
      invalidateDomainLockdownCache(hostname)
      await audit({
        ...actor,
        action: `lockdown.${action}`,
        scope: 'domain',
        target: `lockdowns/${domainLockdownDocId(hostname)}`,
        before: { locked: before != null, ...auditLockShape(before ?? {}) },
        after: {
          locked: action === 'lock',
          domain: hostname,
          ...(action === 'lock' ? auditLockShape(lock) : {}),
        },
      })
      return actionResponse({
        firestore,
        scope,
        targetId: hostname,
        action,
        extra: { domain: hostname },
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
          // Stored ONLY for takedowns (AGL-1621), same discipline as `mode`:
          // a standard lock's document stays byte-identical to one written
          // before the field existed, so absent keeps meaning fail-open.
          ...(enforcement === 'takedown' ? { enforcement } : {}),
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
        invalidateTokenRevocationCache(targetId, found.tenantId ?? null)
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
      // AGL-3359: the account's own workspaces, locked and their billing
      // stopped, after the account lock is durable. Reported beside it and
      // never able to undo it. A lift never touches them — each workspace
      // is lifted on its own, and no lift recreates a subscription.
      const ownedWorkspaces =
        action === 'lock' && body?.lockOwnedWorkspaces === true
          ? await lockOwnedWorkspaces({
              firestore,
              actor,
              uid: targetId,
              lock,
            })
          : undefined
      return actionResponse({
        firestore,
        scope,
        targetId,
        action,
        ...(ownedWorkspaces ? { extra: { ownedWorkspaces } } : {}),
      })
    }

    /*==========================================
     * ORG
     *=========================================*/
    if (scope === 'org') {
      const orgSnapshot = await firestore.collection('orgs').doc(targetId).get()
      if (!orgSnapshot.exists) {
        return Response.json({ error: 'No such workspace' }, { status: 404 })
      }
      const result = await lockOrgAndAudit({
        firestore,
        actor,
        orgId: targetId,
        orgSnapshot,
        action,
        lock,
      })
      // AFTER the lock is durable and audited, and never able to undo it
      // (AGL-3359). A lock that fails to cancel billing is still a lock; the
      // cancel is reported as its own step with its own `confirmed`.
      const subscriptionCancel =
        action === 'lock' && body?.cancelSubscription === true
          ? await cancelBillingAfterLock({
              firestore,
              actor,
              orgId: targetId,
              reason: lock.reason,
            })
          : undefined
      // The workspace's SITES' money (AGL-3364): their members' renewals and
      // the seller's payouts, paused after the lock, restored by the lift.
      const money =
        action === 'lock'
          ? await pauseMoneyAfterLock({
              firestore,
              actor,
              scope: 'org',
              targetId,
              reason: lock.reason,
              renewals: body?.pauseRenewals === true,
              payouts: body?.pausePayouts === true,
            })
          : await resumeMoneyAfterLift({ firestore, actor, scope: 'org', targetId })
      return actionResponse({
        firestore,
        scope,
        targetId,
        action,
        extra: {
          ...result,
          ...(subscriptionCancel ? { subscriptionCancel } : {}),
          ...money,
        },
      })
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
        ...auditRotationShape(result.downloadTokensRotated),
      },
    })
    // The site's money (AGL-3364), after the lock is durable and audited.
    const money =
      action === 'lock'
        ? await pauseMoneyAfterLock({
            firestore,
            actor,
            scope: 'host',
            targetId,
            reason: lock.reason,
            renewals: body?.pauseRenewals === true,
            payouts: body?.pausePayouts === true,
          })
        : await resumeMoneyAfterLift({ firestore, actor, scope: 'host', targetId })
    return actionResponse({
      firestore,
      scope,
      targetId,
      action,
      extra: { ...result, ...money },
    })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/lockdown] failed', error)
    return Response.json({ error: 'Lockdown action failed' }, { status: 500 })
  }
}

export { handler as GET, handler as POST }
