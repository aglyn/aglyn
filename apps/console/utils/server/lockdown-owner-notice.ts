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
