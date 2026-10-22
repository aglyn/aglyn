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

/*==========================================
 * PLACING AN AUTOMATIC SECURITY HOLD (AGL-3450).
 *
 * The page screen asks for a hold (`securityHolds/{orgId}`, written by
 * `@aglyn/tenant-data-admin/server/page-security-hold`); this places it,
 * through the same cores the staff panic button uses — `applyOrgLockdown`,
 * `applyHostLockdown`, `applyUserLockdown`, `sendLockdownOwnerNotice` — so a
 * hold revokes sessions, evicts the tenant cache, rotates raw download URLs,
 * tells the owners and writes `adminAudit` exactly as a staff `security` lock
 * does. What differs is only who placed it: every audit row names
 * {@link SECURITY_HOLD_ACTOR_UID}, and its note names the screen, the version,
 * the signal and the abuse row.
 *
 * Three locks, one hold:
 *
 *  - the WORKSPACE, `security`, full — members signed out, every site down;
 *  - the SITE, `security` with `enforcement: 'takedown'`, so the page stays
 *    down through a store outage that would otherwise fail an ordinary lock
 *    open;
 *  - the ACCOUNT that published the page: the version's `createdBy`, else the
 *    screen's, else the workspace owner — and only a uid that IS a member of
 *    the workspace, so a forged `createdBy` cannot lock a stranger.
 *
 * What it does NOT do is cancel the subscription or pause the sites' money:
 * those are flags the staff route never infers from a reason, and a cancel
 * cannot be undone by a lift. A hold is precautionary; staff who confirm it
 * re-place it as `abuse` on Staff → Lockdown, where the console ticks both.
 *
 * Never the house workspace, never one a staff account owns, never a staff
 * account: each is checked here, on the authoritative records, before
 * anything is written. A target already locked is left exactly as it was set.
 *=========================================*/

import { runOrgLockdownParticipants } from '@aglyn/aglyn/plugin-manager/plugin-org-lockdown'
import { LOCKDOWNS_COLLECTION, userLockdownDocId } from '@aglyn/aglyn/server'
import {
  findUserByUidAcrossPools,
  notifyRiskEvent,
  raiseOperatorAlert,
} from '@aglyn/tenant-data-admin'
import { applyAccountLockToMail } from '@aglyn/tenant-data-admin/server/account-lock-mail'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  claimSecurityHold,
  isHouseWorkspace,
  listPendingSecurityHolds,
  SECURITY_HOLD_ACTOR_UID,
  SECURITY_HOLD_LOCK_REASON,
  type SecurityHoldRecord,
  settleSecurityHold,
} from '@aglyn/tenant-data-admin/server/page-security-hold'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import { FieldValue } from 'firebase-admin/firestore'
import { lockdownNoticeReference, sendLockdownOwnerNotice } from './lockdown-owner-notice'
import { applyHostLockdown, applyOrgLockdown } from './org-lockdown'
import { applyUserLockdown } from './user-lockdown'

type AdminFirestore = FirebaseFirestore.Firestore

/** One lock the hold placed, or why it did not. */
export interface SecurityHoldLockStep {
  scope: 'org' | 'host' | 'user'
  targetId: string | null
  outcome: 'locked' | 'already-locked' | 'skipped' | 'failed'
  detail?: string
  ownerNotice?: Record<string, unknown> | null
}

/** What applying one hold did. */
export interface SecurityHoldApplication {
  orgId: string
  state: 'applied' | 'skipped'
  skipped?: string
  locks: SecurityHoldLockStep[]
  accountUid: string | null
  alert?: string | null
}

/** What one sweep did. */
export interface SecurityHoldSweep {
  pending: number
  applied: number
  skipped: number
  failed: number
  holds: SecurityHoldApplication[]
}

const ORG_LOCK = { reason: SECURITY_HOLD_LOCK_REASON, mode: 'full' as const }
const HOST_LOCK = { ...ORG_LOCK, enforcement: 'takedown' as const }

/** The lock's shape as the staff route's audit rows record it. */
function auditShape(enforcement: 'standard' | 'takedown') {
  return {
    reason: SECURITY_HOLD_LOCK_REASON,
    message: null,
    untilMs: null,
    mode: 'full',
    enforcement,
  }
}

/** The same shape, read off a target that was not locked. */
const UNLOCKED_SHAPE = {
  locked: false,
  reason: null,
  message: null,
  untilMs: null,
  mode: 'full',
  enforcement: 'standard',
}

/** The audit row's note: why a system placed this lock. */
function auditNote(hold: SecurityHoldRecord, scope: string, targetId: string): string {
  const signals = hold.signals.map((signal) => signal.code).join(', ') || 'a phishing signal'
  return [
    `Automatic security hold by the page screen (AGL-3450): ${hold.pageLabel || `screen ${hold.screenId}`}`,
    `(screen ${hold.screenId}, version ${hold.versionId}) on site ${hold.hostId} was held for ${signals};`,
    `abuse row ${hold.reviewId} (${hold.reference}).`,
    `Notice reference ${lockdownNoticeReference(scope, targetId)}.`,
  ].join(' ')
}

/** Download-token rotation, flattened the way the staff route's rows carry it. */
function rotationShape(
  results: ReadonlyArray<{ scanned: number; rotated: number; failed: number; truncated: boolean; ok: boolean }> = [],
): Record<string, unknown> {
  if (!results.length) return {}
  const sum = (pick: (entry: (typeof results)[number]) => number) =>
    results.reduce((total, entry) => total + (pick(entry) || 0), 0)
  return {
    downloadTokensRotated: sum((entry) => entry.rotated),
    downloadTokensScanned: sum((entry) => entry.scanned),
    downloadTokenFailures: sum((entry) => entry.failed),
    downloadTokenRotationTruncated: results.some((entry) => entry.truncated || !entry.ok),
  }
}

async function audit(
  firestore: AdminFirestore,
  hold: SecurityHoldRecord,
  scope: 'org' | 'host' | 'user',
  targetId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await addAdminAudit(firestore, {
    actorUid: SECURITY_HOLD_ACTOR_UID,
    actorEmail: null,
    action: 'lockdown.lock',
    scope,
    target: scope === 'org' ? `orgs/${targetId}` : scope === 'host' ? `hosts/${targetId}` : `users/${targetId}`,
    before: UNLOCKED_SHAPE,
    after: {
      locked: true,
      ...auditShape(scope === 'host' ? 'takedown' : 'standard'),
      automated: true,
      via: 'page-security-hold',
      reviewId: hold.reviewId,
      ...after,
    },
    note: auditNote(hold, scope, targetId),
    at: FieldValue.serverTimestamp(),
  })
}

/** A string field of a document, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The account that published the page: the version's `createdBy`, else the
 * screen's, else the workspace owner — the first that is a MEMBER of the
 * workspace. A version written from the browser may carry any `createdBy`, so
 * membership is what stops a forged one from locking somebody else.
 */
export async function resolveHoldAccount(
  firestore: AdminFirestore,
  hold: Pick<SecurityHoldRecord, 'orgId' | 'hostId' | 'screenId' | 'versionId'>,
  org: Record<string, unknown>,
): Promise<string | null> {
  const screenRef = firestore
    .collection('hosts')
    .doc(hold.hostId)
    .collection('screens')
    .doc(hold.screenId)
  const [version, screen] = await Promise.all([
    screenRef.collection('versions').doc(hold.versionId).get().catch(() => null),
    screenRef.get().catch(() => null),
  ])
  const owner = text(org['ownerUid'])
  const candidates = [
    text(version?.get('createdBy')),
    text(screen?.get('createdBy')),
    owner,
  ].filter((uid, index, all): uid is string => Boolean(uid) && all.indexOf(uid) === index)
  for (const uid of candidates) {
    if (uid === owner) return uid
    const member = await firestore
      .collection('orgs')
      .doc(hold.orgId)
      .collection('members')
      .doc(uid)
      .get()
      .catch(() => null)
    if (member?.exists) return uid
  }
  return null
}

/** The plugins' part in a workspace lock (AGL-3365), as the staff route runs it. Never throws. */
async function orgLockParticipants(orgId: string): Promise<void> {
  try {
    const { serverPluginLoader } = await import('../server-plugin-loader')
    await serverPluginLoader.ensureAll(['consoleApi'])
    await runOrgLockdownParticipants({ orgId, locked: true, reason: SECURITY_HOLD_LOCK_REASON })
  } catch (error) {
    console.error('[security-hold] org lock participants failed', orgId, error)
  }
}

/** Is this uid a staff account? */
async function staffAccount(uid: string | null): Promise<boolean> {
  if (!uid) return false
  const found = await findUserByUidAcrossPools(uid)
  return found?.record.customClaims?.['staff'] === true
}

/**
 * Place one claimed hold. Each lock is its own step: a lock that fails is
 * reported beside the others, never instead of them.
 */
export async function applySecurityHold(
  firestore: AdminFirestore,
  hold: SecurityHoldRecord,
): Promise<SecurityHoldApplication> {
  const locks: SecurityHoldLockStep[] = []
  const skip = (reason: string): SecurityHoldApplication => ({
    orgId: hold.orgId,
    state: 'skipped',
    skipped: reason,
    locks,
    accountUid: null,
  })

  const orgSnapshot = await firestore.collection('orgs').doc(hold.orgId).get()
  if (!orgSnapshot.exists) return skip('The workspace no longer exists.')
  const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
  if (isHouseWorkspace({ hostId: hold.hostId, org })) {
    return skip('The house workspace is never held automatically.')
  }
  if (await staffAccount(text(org['ownerUid']))) {
    return skip('A staff account owns this workspace; it is never held automatically.')
  }
  const accountUid = await resolveHoldAccount(firestore, hold, org)

  // 1. The workspace.
  if (orgSnapshot.get('suspendedAt') != null) {
    locks.push({ scope: 'org', targetId: hold.orgId, outcome: 'already-locked' })
  } else {
    try {
      const result = await applyOrgLockdown({
        firestore,
        orgId: hold.orgId,
        action: 'lock',
        lock: ORG_LOCK,
        // A security lock means "everyone out NOW", as the staff route's.
        revokeMemberTokens: true,
      })
      await audit(firestore, hold, 'org', hold.orgId, {
        tokensRevoked: result.tokensRevoked,
        ...rotationShape(result.downloadTokensRotated),
      })
      // What the workspace owns inside plugins (AGL-3365): listings out of
      // browse while it is locked. Never able to undo the lock.
      await orgLockParticipants(hold.orgId)
      const ownerNotice = await sendLockdownOwnerNotice({
        firestore,
        notifyRisk: notifyRiskEvent,
        action: 'lock',
        scope: 'org',
        targetId: hold.orgId,
        emailOwners: true,
        lock: ORG_LOCK,
        effects: { sessionsRevoked: result.tokensRevoked > 0 },
      })
      locks.push({ scope: 'org', targetId: hold.orgId, outcome: 'locked', ownerNotice: ownerNotice ? { ...ownerNotice } : null })
    } catch (error) {
      locks.push({ scope: 'org', targetId: hold.orgId, outcome: 'failed', detail: String((error as Error)?.message ?? error) })
    }
  }

  // 2. The site, as a takedown.
  try {
    const hostSnapshot = await firestore.collection('hosts').doc(hold.hostId).get()
    if (!hostSnapshot.exists) {
      locks.push({ scope: 'host', targetId: hold.hostId, outcome: 'skipped', detail: 'The site no longer exists.' })
    } else if (hostSnapshot.get('suspendedAt') != null) {
      locks.push({ scope: 'host', targetId: hold.hostId, outcome: 'already-locked' })
    } else {
      const result = await applyHostLockdown({
        firestore,
        hostId: hold.hostId,
        action: 'lock',
        lock: HOST_LOCK,
      })
      await audit(firestore, hold, 'host', hold.hostId, rotationShape(result.downloadTokensRotated))
      // The workspace notice above already tells the owners their sites are
      // down; the site's own notice is recorded in the console, not mailed a
      // second time.
      const ownerNotice = await sendLockdownOwnerNotice({
        firestore,
        notifyRisk: notifyRiskEvent,
        action: 'lock',
        scope: 'host',
        targetId: hold.hostId,
        emailOwners: false,
        lock: HOST_LOCK,
      })
      locks.push({ scope: 'host', targetId: hold.hostId, outcome: 'locked', ownerNotice: ownerNotice ? { ...ownerNotice } : null })
    }
  } catch (error) {
    locks.push({ scope: 'host', targetId: hold.hostId, outcome: 'failed', detail: String((error as Error)?.message ?? error) })
  }

  // 3. The account that published it.
  if (!accountUid) {
    locks.push({ scope: 'user', targetId: null, outcome: 'skipped', detail: 'No member of the workspace could be named as the publisher.' })
  } else {
    try {
      const found = await findUserByUidAcrossPools(accountUid)
      const existing = await firestore
        .collection(LOCKDOWNS_COLLECTION)
        .doc(userLockdownDocId(accountUid))
        .get()
      if (!found) {
        locks.push({ scope: 'user', targetId: accountUid, outcome: 'skipped', detail: 'The account no longer exists.' })
      } else if (found.record.customClaims?.['staff'] === true) {
        locks.push({ scope: 'user', targetId: accountUid, outcome: 'skipped', detail: 'Staff accounts are never locked.' })
      } else if (existing.exists) {
        locks.push({ scope: 'user', targetId: accountUid, outcome: 'already-locked' })
      } else {
        await applyUserLockdown({
          firestore,
          uid: accountUid,
          tenantId: found.tenantId,
          action: 'lock',
          lock: { reason: SECURITY_HOLD_LOCK_REASON },
          actorUid: SECURITY_HOLD_ACTOR_UID,
        })
        await audit(firestore, hold, 'user', accountUid, {})
        const ownerNotice = await sendLockdownOwnerNotice({
          firestore,
          notifyRisk: notifyRiskEvent,
          action: 'lock',
          scope: 'user',
          targetId: accountUid,
          emailOwners: true,
          lock: { reason: SECURITY_HOLD_LOCK_REASON },
        })
        // The account's addresses off the house sites' lists, after its
        // notice (AGL-3420). Not a ban, so the platform list is untouched.
        await applyAccountLockToMail({ uid: accountUid, record: found.record, ban: false }).catch(
          (error: unknown) => console.error('[security-hold] account mail lists failed', accountUid, error),
        )
        locks.push({ scope: 'user', targetId: accountUid, outcome: 'locked', ownerNotice: ownerNotice ? { ...ownerNotice } : null })
      }
    } catch (error) {
      locks.push({ scope: 'user', targetId: accountUid, outcome: 'failed', detail: String((error as Error)?.message ?? error) })
    }
  }

  // The abuse row says what was placed, so staff deciding it see the hold.
  const placed = locks.filter((step) => step.outcome === 'locked')
  await firestore
    .collection(ABUSE_REPORT_COLLECTION)
    .doc(hold.reviewId)
    .set(
      {
        securityHold: {
          orgId: hold.orgId,
          hostId: hold.hostId,
          uid: accountUid,
          locks: locks.map((step) => ({ scope: step.scope, targetId: step.targetId, outcome: step.outcome })),
          appliedAtMs: Date.now(),
        },
      },
      { merge: true },
    )
    .catch((error: unknown) => console.error('[security-hold] abuse row not annotated', hold.reviewId, error))

  // Staff hear about the one lock no person placed, once per workspace.
  const describe = (step: SecurityHoldLockStep) =>
    step.scope === 'org'
      ? `the workspace (${step.targetId})`
      : step.scope === 'host'
        ? `the site (${step.targetId}, takedown)`
        : `the publishing account (${step.targetId})`
  const alert = await raiseOperatorAlert('security.pageSecurityHold', {
    dedupeKey: hold.orgId,
    orgId: hold.orgId,
    hostId: hold.hostId,
    context: {
      orgName: text(org['name']) ?? hold.orgId,
      orgId: hold.orgId,
      hostId: hold.hostId,
      siteName: hold.siteName ?? hold.hostId,
      page: hold.pageLabel || `Screen ${hold.screenId}`,
      signal: hold.evidence,
      locks: placed.length ? placed.map(describe).join(', ') : 'nothing new — every target was already locked or skipped',
      reference: hold.reference,
      reviewId: hold.reviewId,
    },
  })
  return {
    orgId: hold.orgId,
    state: 'applied',
    locks,
    accountUid,
    alert: alert.outcome,
  }
}

/**
 * Apply every pending hold: claim, place, settle. One hold's failure never
 * stops the next. Called by the fifteen-minute tick and at the end of any
 * console sweep that may have held a page.
 */
export async function applyPendingSecurityHolds(
  firestore: AdminFirestore,
  options: { limit?: number; nowMs?: number } = {},
): Promise<SecurityHoldSweep> {
  const pending = await listPendingSecurityHolds(firestore, options.limit ?? 20)
  const sweep: SecurityHoldSweep = { pending: pending.length, applied: 0, skipped: 0, failed: 0, holds: [] }
  for (const candidate of pending) {
    try {
      const hold = await claimSecurityHold(firestore, candidate.orgId, options.nowMs ?? Date.now())
      if (!hold) continue
      const application = await applySecurityHold(firestore, hold)
      await settleSecurityHold(firestore, hold.orgId, application.state, {
        ...(application.skipped ? { skipped: application.skipped } : {}),
        accountUid: application.accountUid,
        locks: application.locks.map((step) => ({
          scope: step.scope,
          targetId: step.targetId,
          outcome: step.outcome,
          ...(step.detail ? { detail: step.detail } : {}),
        })),
        alert: application.alert ?? null,
      })
      sweep.holds.push(application)
      if (application.state === 'applied') sweep.applied += 1
      else sweep.skipped += 1
    } catch (error) {
      sweep.failed += 1
      console.error('[security-hold] a hold could not be applied', candidate.orgId, error)
    }
  }
  return sweep
}
