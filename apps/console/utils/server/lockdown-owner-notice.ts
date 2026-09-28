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
 * EVERY LOCK AND LIFT EMAILS THE PEOPLE IT LOCKED (AGL-3368).
 *
 * A lock signs its owners out and stops the workspace sending anything, so
 * the one thing that can still reach them is the platform's own mail. This
 * sends that notice for every scope a lock names someone at — a workspace
 * (its owners and admins), a site and a custom domain (the owning
 * workspace's owners and admins, and the site's managers), a workspace
 * feature, and an account (the person themself) — through the risk notice
 * seam, from the platform's sender, with:
 *
 * - the lock's own customer-facing message, verbatim — the same words the
 *   lock serves on its notice page (`lockdownNotice`);
 * - what the lock affects: the sites, whether everyone was signed out, a
 *   canceled subscription, paused renewals and payouts;
 * - how to appeal: reply, or write to the support address;
 * - and never why: nothing staff typed as rationale goes anywhere but the
 *   audit row.
 *
 * A lift sends the matching "restored" notice to the same people.
 *
 * The outcome comes back as a step the lockdown route reports in "Actions
 * taken in this session" beside the billing steps, verified or not, so a
 * lock can never skip its email silently. Staff may untick "Email the
 * owners" (a legal hold); that is recorded as its own line, not as silence.
 *=========================================*/

import { createHash } from 'crypto'
import {
  lockdownFeatureLabel,
  lockdownNotice,
  type LockdownFeatureKey,
  type LockdownReasonCode,
  type LockdownScope,
} from '@aglyn/aglyn/app-utils/lockdown'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import type { RiskEventKind } from '@aglyn/shared-util-email/risk-notice-catalog'
import type {
  RiskEventInput,
  RiskNoticeResult,
} from '@aglyn/tenant-data-admin/server/risk-notice'

type AdminFirestore = FirebaseFirestore.Firestore

/** The scopes a lock can name somebody at. Platform-wide locks name nobody. */
const NOTICE_KINDS: Record<string, { lock: RiskEventKind; unlock: RiskEventKind }> = {
  org: { lock: 'workspace-locked', unlock: 'workspace-unlocked' },
  host: { lock: 'site-locked', unlock: 'site-unlocked' },
  domain: { lock: 'domain-locked', unlock: 'domain-unlocked' },
  user: { lock: 'account-locked', unlock: 'account-unlocked' },
  feature: { lock: 'feature-locked', unlock: 'feature-unlocked' },
}

/** What else the lock or lift did, for the notice's "what this affects". */
export interface LockdownNoticeEffects {
  sessionsRevoked?: boolean
  subscriptionCanceled?: boolean
  renewalsPaused?: boolean
  payoutsPaused?: boolean
  renewalsResumed?: boolean
  payoutsRestored?: boolean
  /** A user lock's workspaces locked with it. */
  ownedWorkspacesLocked?: number
}

/** The step the lockdown route reports. */
export interface LockdownOwnerNoticeStep {
  attempted: boolean
  /** True only when every person the notice was for was emailed. */
  confirmed: boolean
  kind: RiskEventKind | null
  scope: string
  targetId: string
  recipients: number
  emailed: number
  emailFailed: number
  /** Why nothing was emailed, when nothing was. */
  skipped: string | null
  error: string | null
}

/** What the notice says the lock or lift covers. Pure. */
export function lockdownAffectedText(input: {
  action: 'lock' | 'unlock'
  scope: string
  mode?: string | null
  effects?: LockdownNoticeEffects
}): string {
  const effects = input.effects ?? {}
  const readOnly = input.mode === 'read-only'
  const parts: string[] = []
  if (input.action === 'lock') {
    switch (input.scope) {
      case 'org':
        parts.push(
          readOnly
            ? 'your sites keep serving, but nothing in the workspace can be changed'
            : 'your sites show a notice instead of their pages, and nothing in the workspace can be changed',
        )
        if (!readOnly) parts.push('no email is sent on the workspace’s behalf')
        break
      case 'host':
        parts.push(
          readOnly
            ? 'the site keeps serving, but it cannot be changed'
            : 'the site shows a notice instead of its pages, and it cannot be changed',
        )
        break
      case 'domain':
        parts.push('the domain shows a notice; the site still serves on its platform address')
        break
      case 'user':
        parts.push('you are signed out and cannot sign in')
        break
      case 'feature':
        parts.push('this one capability is off; everything else keeps working')
        break
    }
    if (effects.sessionsRevoked && input.scope !== 'user') {
      parts.push('everyone was signed out of the console')
    }
    if (effects.ownedWorkspacesLocked) {
      parts.push(
        effects.ownedWorkspacesLocked === 1
          ? 'the workspace you own was locked with it'
          : 'the workspaces you own were locked with it',
      )
    }
    if (effects.subscriptionCanceled) {
      parts.push('the subscription was canceled, with no refund')
    }
    if (effects.renewalsPaused) parts.push('your customers’ renewals are paused, and nobody is charged')
    if (effects.payoutsPaused) parts.push('payouts to your bank are paused; the money stays in your balance')
  } else {
    parts.push(
      input.scope === 'user'
        ? 'you can sign in again'
        : input.scope === 'domain'
          ? 'the domain serves your site again'
          : input.scope === 'feature'
            ? 'the capability is back on'
            : 'everything is back as it was, and you can sign in again',
    )
    if (effects.renewalsResumed) parts.push('your customers’ renewals have resumed on their normal schedule')
    if (effects.payoutsRestored) parts.push('payouts are back on your normal schedule')
    if (input.scope === 'org') {
      parts.push('a subscription canceled with the lock stays canceled — restart it from Billing')
    }
  }
  const sentence = parts.join('; ')
  return sentence ? `${sentence[0].toUpperCase()}${sentence.slice(1)}.` : ''
}

/** Who the notice is about, in the owners' words, and where it lives. */
async function subjectFor(
  firestore: AdminFirestore,
  scope: string,
  targetId: string,
  orgId: string | null,
): Promise<{ orgId: string | null; hostId: string | null; label: string; path: string | null }> {
  if (scope === 'org') {
    return { orgId: targetId, hostId: null, label: 'your workspace', path: null }
  }
  if (scope === 'host') {
    const host = await firestore.collection('hosts').doc(targetId).get()
    const sub = String(host.get('subdomain') ?? '')
    const name = String(host.get('name') ?? host.get('displayName') ?? '') || sub || 'your site'
    return {
      orgId: (host.get('orgId') as string | undefined) ?? null,
      hostId: targetId,
      label: sub ? `the site "${name}" (${sub}.${TENANT_APEX})` : `the site "${name}"`,
      path: `/${targetId}`,
    }
  }
  if (scope === 'domain') {
    const owner = await firestore.collection('hosts').where('cname', '==', targetId).limit(1).get()
    const host = owner.docs[0]
    return {
      orgId: (host?.get('orgId') as string | undefined) ?? null,
      hostId: host?.id ?? null,
      label: `the domain ${targetId}`,
      path: host ? `/${host.id}/admin/domain` : null,
    }
  }
  if (scope === 'feature') {
    return {
      orgId,
      hostId: null,
      label: lockdownFeatureLabel(targetId as LockdownFeatureKey),
      path: null,
    }
  }
  return { orgId: null, hostId: null, label: 'your account', path: null }
}

/**
 * Send one lock or lift notice, and say how it went. Never throws: the
 * lock it reports on has already happened.
 */
export async function sendLockdownOwnerNotice(input: {
  firestore: AdminFirestore
  notifyRisk: (event: RiskEventInput) => Promise<RiskNoticeResult>
  action: 'lock' | 'unlock'
  scope: string
  targetId: string
  /** A feature lock's workspace; absent on a platform-wide feature lock. */
  orgId?: string | null
  /** False when staff unticked "Email the owners". */
  emailOwners: boolean
  lock?: {
    reason: string
    message?: string | null
    mode?: string | null
    untilMs?: number | null
  } | null
  effects?: LockdownNoticeEffects
  /** Extra people to tell: a user lock's owned workspaces are told on their own. */
  nowMs?: number
}): Promise<LockdownOwnerNoticeStep | null> {
  const kinds = NOTICE_KINDS[input.scope]
  // A platform-wide lock (or a platform-wide feature lock) names no
  // workspace, so there is nobody in particular to write to.
  if (!kinds || (input.scope === 'feature' && !input.orgId)) return null
  const kind = kinds[input.action]
  const step: LockdownOwnerNoticeStep = {
    attempted: false,
    confirmed: false,
    kind,
    scope: input.scope,
    targetId: input.targetId,
    recipients: 0,
    emailed: 0,
    emailFailed: 0,
    skipped: null,
    error: null,
  }
  try {
    const subject = await subjectFor(
      input.firestore,
      input.scope,
      input.targetId,
      input.orgId ?? null,
    )
    // The customer-facing words the lock SERVES: staff's message, or the
    // per-reason default beneath it.
    const message =
      input.action === 'lock' && input.lock
        ? lockdownNotice({
            scope: input.scope as LockdownScope,
            ...(input.scope === 'feature' ? { feature: input.targetId as LockdownFeatureKey } : {}),
            reason: (input.lock.reason || 'manual') as LockdownReasonCode,
            ...(input.lock.message ? { message: input.lock.message } : {}),
            ...(input.lock.mode ? { mode: input.lock.mode as never } : {}),
            ...(input.lock.untilMs ? { untilMs: input.lock.untilMs } : {}),
          }).body
        : null
    step.attempted = true
    const result = await input.notifyRisk({
      kind,
      orgId: subject.orgId,
      hostId: subject.hostId,
      userUid: input.scope === 'user' ? input.targetId : null,
      item: { label: subject.label, path: subject.path },
      occurredAtMs: input.nowMs ?? Date.now(),
      lock: {
        message,
        affected: lockdownAffectedText({
          action: input.action,
          scope: input.scope,
          mode: input.lock?.mode ?? null,
          effects: input.effects,
        }),
        scope: input.scope,
        targetId: input.targetId,
      },
      emailOwners: input.emailOwners,
    })
    step.recipients = result.owners.recipients
    step.emailed = result.owners.emailed
    step.emailFailed = result.owners.emailFailed
    step.skipped = result.owners.emailSkipped
    step.error = result.error
    step.confirmed =
      !result.error &&
      (input.emailOwners
        ? result.owners.recipients > 0 &&
          result.owners.emailed > 0 &&
          result.owners.emailFailed === 0
        : // Unticked on purpose: the step is what was asked for, not a send.
          true)
    return step
  } catch (error) {
    step.error = (error as Error)?.message ?? String(error)
    return step
  }
}

/** The one-line account of a notice step, for the audit row and the log. */
export function lockdownOwnerNoticeLine(step: LockdownOwnerNoticeStep): string {
  if (!step.attempted) return `Owner email not sent: ${step.error ?? step.skipped ?? 'the notice did not run'}`
  if (step.error) return `Owner email FAILED: ${step.error}`
  if (step.skipped && step.emailed === 0) return `Owner email not sent: ${step.skipped}`
  return (
    `Owner email (${step.kind}): sent to ${step.emailed} of ${step.recipients}` +
    (step.emailFailed ? `, ${step.emailFailed} FAILED` : '')
  )
}

/*==========================================
 * RESEND THE OWNER NOTICE FOR LOCKS THAT ALREADY STAND (AGL-3368).
 *
 * Locks placed before owner notices existed told nobody. This sends each of
 * them the lock email it would have sent — the lock's stored customer-facing
 * message, what it affects, how to appeal — through the same lockdown kinds,
 * for a LIST of targets at once, because one actor's accounts, workspaces
 * and sites resolve to the same few people:
 *
 * - ONE email per distinct recipient, listing everything locked for them
 *   (a user lock and the workspace that user owns are one email, not two);
 * - idempotent per (lock, recipient): a lock is keyed by its scope, target
 *   and the instant it was placed, so a second press reports "already sent
 *   at …" rather than mailing again — unless staff tick "send again"; a lock
 *   lifted and placed again is a new lock and is sent afresh.
 *=========================================*/

/** Admin-SDK only: which lock notices reached which recipient, and when. */
export const LOCKDOWN_NOTICE_LEDGER_COLLECTION = 'lockdownNoticeLedger'

/** How many targets one resend takes. */
export const LOCKDOWN_RESEND_MAX_TARGETS = 50

/** The scopes an existing lock can be re-announced for. */
export const LOCKDOWN_RESEND_SCOPES: ReadonlySet<string> = new Set(['org', 'host', 'domain', 'user'])

/** One lock that stands, as the resend reads it. */
export interface StandingLock {
  scope: 'org' | 'host' | 'domain' | 'user'
  targetId: string
  /** `scope:targetId:atMs` — a new lock on the same target is a new key. */
  lockKey: string
  reason: string
  message: string | null
  mode: string | null
  untilMs: number | null
  orgId: string | null
  hostId: string | null
  label: string
  path: string | null
}

/** One person a resend writes to. */
export interface LockRecipient {
  uid: string
  email: string
}

/** What one recipient got, for the route's answer and the log. */
export interface ResendRecipientOutcome {
  uid: string
  email: string
  /** Every lock this person is listed for, sent now or before. */
  lockKeys: string[]
  outcome: 'sent' | 'already-sent' | 'failed'
  /** The locks this send newly covered. */
  sentLockKeys: string[]
  /** When the earliest already-covered lock was sent, for "already sent at …". */
  alreadySentAtMs: number | null
  error: string | null
}

export interface ResendTargetOutcome {
  scope: string
  targetId: string
  locked: boolean
  recipients: number
  error: string | null
}

export interface LockdownResendResult {
  targets: ResendTargetOutcome[]
  recipients: ResendRecipientOutcome[]
  /** Every standing lock reached every one of its people, now or before. */
  confirmed: boolean
}

/** The ledger id for one (lock, recipient). Hex, like every other ledger. */
export function lockNoticeLedgerId(lockKey: string, email: string): string {
  return createHash('sha256')
    .update(`lock-notice:${lockKey}:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 40)
}

/**
 * Group standing locks by the person they reach, so each person gets one
 * email. Pure: the input is each lock with its resolved recipients.
 */
export function groupLockNoticesByRecipient(
  entries: ReadonlyArray<{ lock: StandingLock; recipients: readonly LockRecipient[] }>,
): Array<{ recipient: LockRecipient; locks: StandingLock[] }> {
  const byEmail = new Map<string, { recipient: LockRecipient; locks: StandingLock[] }>()
  for (const entry of entries) {
    for (const recipient of entry.recipients) {
      const email = recipient.email.trim().toLowerCase()
      if (!email.includes('@')) continue
      const group = byEmail.get(email) ?? { recipient: { uid: recipient.uid, email }, locks: [] }
      if (!group.locks.some((lock) => lock.lockKey === entry.lock.lockKey)) group.locks.push(entry.lock)
      byEmail.set(email, group)
    }
  }
  return [...byEmail.values()]
}

/** The kind one combined email is sent as: the broadest lock in it. */
export function resendNoticeKind(locks: readonly StandingLock[]): RiskEventKind {
  const scopes = new Set(locks.map((lock) => lock.scope))
  if (scopes.has('user')) return 'account-locked'
  if (scopes.has('org')) return 'workspace-locked'
  if (scopes.has('host')) return 'site-locked'
  return 'domain-locked'
}

/** `a, b and c`. */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** The customer-facing message a standing lock serves. */
function standingMessage(lock: StandingLock): string {
  return lockdownNotice({
    scope: lock.scope as LockdownScope,
    reason: (lock.reason || 'manual') as LockdownReasonCode,
    ...(lock.message ? { message: lock.message } : {}),
    ...(lock.mode ? { mode: lock.mode as never } : {}),
    ...(lock.untilMs ? { untilMs: lock.untilMs } : {}),
  }).body
}

/**
 * Resend the owner notice for standing locks. Never throws; every target and
 * every recipient comes back with its own outcome.
 */
export async function resendLockdownOwnerNotices(input: {
  firestore: AdminFirestore
  targets: ReadonlyArray<{ scope: string; targetId: string }>
  sendAgain: boolean
  notifyRisk: (event: RiskEventInput) => Promise<RiskNoticeResult>
  /** The standing lock on a target, or null when it is not locked. */
  readLock: (scope: StandingLock['scope'], targetId: string) => Promise<StandingLock | null>
  /** The people a lock reaches: owners and admins, site managers, the account. */
  recipientsFor: (lock: StandingLock) => Promise<LockRecipient[]>
  nowMs?: number
}): Promise<LockdownResendResult> {
  const nowMs = input.nowMs ?? Date.now()
  const targets: ResendTargetOutcome[] = []
  const entries: Array<{ lock: StandingLock; recipients: LockRecipient[] }> = []
  const seenTargets = new Set<string>()
  for (const target of input.targets.slice(0, LOCKDOWN_RESEND_MAX_TARGETS)) {
    const key = `${target.scope}:${target.targetId}`
    if (seenTargets.has(key)) continue
    seenTargets.add(key)
    const outcome: ResendTargetOutcome = {
      scope: target.scope,
      targetId: target.targetId,
      locked: false,
      recipients: 0,
      error: null,
    }
    targets.push(outcome)
    if (!LOCKDOWN_RESEND_SCOPES.has(target.scope) || !target.targetId) {
      outcome.error = 'Only an org, host, domain or user lock can be re-announced.'
      continue
    }
    try {
      const lock = await input.readLock(target.scope as StandingLock['scope'], target.targetId)
      if (!lock) {
        outcome.error = 'Not locked — there is nothing to announce.'
        continue
      }
      outcome.locked = true
      const recipients = await input.recipientsFor(lock)
      outcome.recipients = recipients.length
      if (!recipients.length) outcome.error = 'Nobody to email: no owner, admin or account address on record.'
      entries.push({ lock, recipients })
    } catch (error) {
      outcome.error = (error as Error)?.message ?? String(error)
    }
  }

  const ledger = input.firestore.collection(LOCKDOWN_NOTICE_LEDGER_COLLECTION)
  const recipients: ResendRecipientOutcome[] = []
  for (const group of groupLockNoticesByRecipient(entries)) {
    const outcome: ResendRecipientOutcome = {
      uid: group.recipient.uid,
      email: group.recipient.email,
      lockKeys: group.locks.map((lock) => lock.lockKey),
      outcome: 'failed',
      sentLockKeys: [],
      alreadySentAtMs: null,
      error: null,
    }
    recipients.push(outcome)
    try {
      const refs = group.locks.map((lock) => ledger.doc(lockNoticeLedgerId(lock.lockKey, group.recipient.email)))
      const prior = await Promise.all(refs.map((ref) => ref.get()))
      const sentAt = prior.map((snapshot) => (snapshot.exists ? Number(snapshot.get('sentAtMs') ?? 0) : 0))
      const due = input.sendAgain ? group.locks : group.locks.filter((_lock, index) => !sentAt[index])
      const already = sentAt.filter(Boolean)
      if (already.length) outcome.alreadySentAtMs = Math.min(...already)
      if (!due.length) {
        outcome.outcome = 'already-sent'
        continue
      }
      const kind = resendNoticeKind(due)
      const messages = [...new Set(due.map(standingMessage))]
      const firstOrg = due.find((lock) => lock.orgId)?.orgId ?? null
      const result = await input.notifyRisk({
        kind,
        orgId: firstOrg,
        hostId: due.length === 1 ? due[0].hostId : null,
        userUid: due.find((lock) => lock.scope === 'user')?.targetId ?? null,
        item: {
          label: listed(due.map((lock) => lock.label)),
          path: due.length === 1 ? due[0].path : null,
        },
        occurredAtMs: nowMs,
        lock: {
          message:
            messages.length === 1
              ? messages[0]
              : due.map((lock) => `${lock.label}: ${standingMessage(lock)}`).join(' '),
          affected: due
            .map((lock) =>
              `${due.length > 1 ? `For ${lock.label}: ` : ''}${lockdownAffectedText({
                action: 'lock',
                scope: lock.scope,
                mode: lock.mode,
              })}`,
            )
            .join(' '),
          scope: due[0].scope,
          targetId: due[0].targetId,
        },
        recipients: [group.recipient],
        // One notice per (recipient, set of locks, send): a resend on purpose
        // is a new notice, a double click within the same send is not.
        dedupeKey: `lock-resend:${group.recipient.email}:${due
          .map((lock) => lock.lockKey)
          .sort()
          .join('|')}${input.sendAgain ? `:${nowMs}` : ''}`,
      })
      if (result.error) {
        outcome.error = result.error
        continue
      }
      if (result.duplicate) {
        outcome.outcome = 'already-sent'
        continue
      }
      if (result.owners.emailed < 1) {
        outcome.error = result.owners.emailSkipped ?? 'The email did not send.'
        continue
      }
      await Promise.all(
        due.map((lock) =>
          ledger.doc(lockNoticeLedgerId(lock.lockKey, group.recipient.email)).set({
            lockKey: lock.lockKey,
            scope: lock.scope,
            targetId: lock.targetId,
            email: group.recipient.email,
            uid: group.recipient.uid,
            kind,
            sentAtMs: nowMs,
          }),
        ),
      )
      outcome.outcome = 'sent'
      outcome.sentLockKeys = due.map((lock) => lock.lockKey)
    } catch (error) {
      outcome.error = (error as Error)?.message ?? String(error)
    }
  }
  return {
    targets,
    recipients,
    confirmed:
      targets.every((target) => target.locked && !target.error) &&
      recipients.every((recipient) => recipient.outcome !== 'failed'),
  }
}

/**
 * A target's standing lock, from the lock state the lockdown route reads
 * (`readLockState`), or null when it is not locked.
 */
export async function standingLockFrom(
  firestore: AdminFirestore,
  scope: StandingLock['scope'],
  targetId: string,
  state: {
    locked: boolean
    reason?: string | null
    message?: string | null
    mode?: string | null
    untilMs?: number | null
    atMs?: number | null
  },
): Promise<StandingLock | null> {
  if (!state.locked) return null
  const subject = await subjectFor(firestore, scope, targetId, null)
  return {
    scope,
    targetId,
    lockKey: `${scope}:${targetId}:${state.atMs ?? 0}`,
    reason: state.reason ?? 'manual',
    message: state.message ?? null,
    mode: state.mode ?? null,
    untilMs: state.untilMs ?? null,
    orgId: subject.orgId,
    hostId: subject.hostId,
    label: subject.label,
    path: subject.path,
  }
}

/**
 * The people a standing lock reaches, with their addresses: an account lock
 * its own person; any other its workspace's owners and admins, and for a
 * site or domain the site's managers too — the audience the lock notice
 * itself goes to.
 */
export async function lockRecipientsFor(
  firestore: AdminFirestore,
  lock: StandingLock,
  deps: {
    listOwners: (orgId: string) => Promise<Array<{ uid: string; email: string | null }>>
    lookupEmail: (uid: string) => Promise<string | null>
  },
): Promise<LockRecipient[]> {
  const people = new Map<string, string | null>()
  if (lock.scope === 'user') {
    people.set(lock.targetId, null)
  } else {
    if (lock.orgId) {
      for (const owner of await deps.listOwners(lock.orgId)) people.set(owner.uid, owner.email)
    }
    if (lock.hostId) {
      const host = await firestore.collection('hosts').doc(lock.hostId).get()
      const roles = (host.get('memberRoles') as Record<string, string> | undefined) ?? {}
      for (const [uid, role] of Object.entries(roles)) {
        if ((role === 'admin' || role === 'editor') && !people.has(uid)) people.set(uid, null)
      }
    }
  }
  const recipients: LockRecipient[] = []
  for (const [uid, known] of people) {
    const email = (known ?? (await deps.lookupEmail(uid).catch(() => null)) ?? '').trim().toLowerCase()
    if (email.includes('@')) recipients.push({ uid, email })
  }
  return recipients
}
