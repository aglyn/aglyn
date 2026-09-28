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
 * A SECURITY LOCK STOPS A SITE'S MONEY, AND THE LIFT PUTS BACK EXACTLY
 * WHAT IT STOPPED (AGL-3364).
 *
 * AGL-3359 let a lock cancel the WORKSPACE's own subscription. A locked
 * tenant also takes money from its own customers: membership renewals keep
 * charging, and the seller's connected account keeps paying out. Two
 * steps, run after the lock and never able to undo it:
 *
 * 1. RENEWALS. Every live subscription a locked site sells — found from
 *    the selling plugin's own records through `core.recurring-charge-
 *    sources`, never a broad Stripe search — gets
 *    `pause_collection[behavior]=void`.
 *
 *    `void`, not `keep_as_draft`: these subscriptions live on the PLATFORM
 *    account (destination charges, AGL-1956), where the merchant cannot see
 *    or act on a draft, and a security lock usually means the cards may be
 *    stolen. A voided invoice is a final "not charged" record; a draft is a
 *    charge waiting for someone to finalize it months later, on a card that
 *    should not be charged at all. Nothing is canceled or refunded, and
 *    pausing collection sends the customer nothing.
 *
 * 2. PAYOUTS. The seller's connected account is switched to manual payouts
 *    and its previous schedule saved. The platform can set this on Express
 *    and Custom accounts only; a Standard account is reported as "not
 *    controllable — pause in the Dashboard", not as a failure.
 *
 * EXACTLY WHAT IT STOPPED. Each pause is recorded in `lockdownBillingPauses`
 * (Admin SDK only; no client rule opens it) with the locks HOLDING it. A
 * subscription that was already paused before the lock is not recorded and
 * so is never resumed by us: the merchant paused it, the merchant keeps it
 * paused. A second lock over the same subscription or account joins the
 * holders instead of pausing again, and only the LAST holder's lift resumes
 * or restores — so lifting a site lock while its workspace is still locked
 * leaves the money stopped.
 *
 * Nothing here throws to its caller: every failure comes back as an
 * unconfirmed step, beside a lock that stands.
 *=========================================*/

import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import type { RecurringChargeSource } from '@aglyn/aglyn/plugin-manager/plugin-recurring-charges'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { isTerminalSubscriptionStatus, stripe } from './org-subscription-cancel'

/** Admin-SDK only; the default-deny rules never open it. */
export const LOCKDOWN_BILLING_PAUSES_COLLECTION = 'lockdownBillingPauses'

/** What a Stripe pause writes, and what a read-back must show. */
export const PAUSE_COLLECTION_BEHAVIOR = 'void'

export type LockdownPauseScope = 'org' | 'host'

/** `org:{id}` / `host:{id}`: the holder a lock writes and its lift removes. */
export function lockdownHolderKey(scope: LockdownPauseScope, targetId: string): string {
  return `${scope}:${targetId}`
}

/*------------------------------------------
 * WHO: the sites, and the seller's account
 *-----------------------------------------*/

/** How many sites of one workspace a lock pauses. */
const HOSTS_MAX = 200

export interface LockdownBillingTarget {
  orgId: string | null
  hostIds: string[]
  /** The owner's connected account (`profiles/{ownerUid}.stripeAccountId`). */
  accountId: string | null
  lookupErrors: string[]
}

/**
 * The sites and the seller's connected account behind an org or host lock.
 * An org's sites are the hosts naming it (`hosts.orgId`); a site's seller is
 * its workspace's owner, whose profile holds the Connect linkage every
 * storefront pays out through.
 */
export async function resolveLockdownBillingTarget(
  firestore: Firestore,
  scope: LockdownPauseScope,
  targetId: string,
): Promise<LockdownBillingTarget> {
  const lookupErrors: string[] = []
  let orgId: string | null = scope === 'org' ? targetId : null
  let hostIds: string[] = scope === 'host' ? [targetId] : []
  try {
    if (scope === 'host') {
      const host = await firestore.collection('hosts').doc(targetId).get()
      orgId = String(host.get('orgId') ?? '') || null
    } else {
      const hosts = await firestore
        .collection('hosts')
        .where('orgId', '==', targetId)
        .limit(HOSTS_MAX + 1)
        .get()
      hostIds = hosts.docs.map((doc) => doc.id)
      if (hostIds.length > HOSTS_MAX) {
        hostIds = hostIds.slice(0, HOSTS_MAX)
        lookupErrors.push(
          `The workspace has more than ${HOSTS_MAX} sites; only the first ${HOSTS_MAX} were paused.`,
        )
      }
    }
  } catch (error) {
    lookupErrors.push(`Finding the sites failed: ${messageOf(error)}`)
  }
  let accountId: string | null = null
  if (orgId) {
    try {
      const ownerUid = String(
        (await firestore.collection('orgs').doc(orgId).get()).get('ownerUid') ?? '',
      )
      if (ownerUid) {
        accountId =
          String(
            (await firestore.collection('profiles').doc(ownerUid).get()).get(
              'stripeAccountId',
            ) ?? '',
          ) || null
      }
    } catch (error) {
      lookupErrors.push(`Finding the seller's payout account failed: ${messageOf(error)}`)
    }
  }
  return { orgId, hostIds, accountId, lookupErrors }
}

/*------------------------------------------
 * RENEWALS
 *-----------------------------------------*/

export type RenewalPauseOutcome =
  /** Paused by this lock. */
  | 'paused'
  /** Already paused by another lock; this lock joined its holders. */
  | 'held'
  /** Paused before the lock by someone else; left alone, never resumed by us. */
  | 'already-paused'
  /** Canceled or expired in Stripe; nothing to pause. */
  | 'not-live'
  | 'failed'

export type RenewalResumeOutcome =
  /** Resumed: this lift was the last lock holding it. */
  | 'resumed'
  /** Another lock still holds it; it stays paused. */
  | 'still-held'
  | 'failed'

export interface RenewalStep<Outcome> {
  id: string
  hostId: string | null
  outcome: Outcome
  error: string | null
  /** The read-back shows what was asked for. */
  confirmed: boolean
}

export interface RenewalsResult<Outcome> {
  attempted: true
  configured: boolean
  lookupErrors: string[]
  subscriptions: Array<RenewalStep<Outcome>>
  /** Subscriptions this call changed in Stripe. */
  changed: number
  confirmed: boolean
}

const messageOf = (error: unknown) =>
  (error as Error)?.message ?? String(error)

const stripeError = (reply: { status: number; body: any }) =>
  reply.body?.error?.message ?? `HTTP ${reply.status}`

const subscriptionRecordId = (subscriptionId: string) => `sub_${subscriptionId}`
const payoutRecordId = (accountId: string) => `payout_${accountId}`

/** Pause every live subscription the locked sites sell. */
export async function pauseMembershipRenewals(options: {
  firestore: Firestore
  scope: LockdownPauseScope
  targetId: string
  hostIds: readonly string[]
  sources: ReadonlyArray<{ pluginId: string; source: RecurringChargeSource }>
  secretKey: string | undefined
  actorUid: string
}): Promise<RenewalsResult<RenewalPauseOutcome>> {
  const { firestore, secretKey } = options
  const holder = lockdownHolderKey(options.scope, options.targetId)
  const lookupErrors: string[] = []
  if (!secretKey) {
    return {
      attempted: true,
      configured: false,
      lookupErrors: ['Stripe is not configured on this deployment.'],
      subscriptions: [],
      changed: 0,
      confirmed: false,
    }
  }
  const found = new Map<string, string>()
  for (const { pluginId, source } of options.sources) {
    try {
      for (const record of await source.listLiveSubscriptions({
        hostIds: options.hostIds,
      })) {
        if (record.subscriptionId) found.set(record.subscriptionId, record.hostId)
      }
    } catch (error) {
      lookupErrors.push(`${pluginId}: listing its subscriptions failed: ${messageOf(error)}`)
    }
  }

  const steps: Array<RenewalStep<RenewalPauseOutcome>> = []
  let changed = 0
  for (const [id, hostId] of found) {
    const recordRef = firestore
      .collection(LOCKDOWN_BILLING_PAUSES_COLLECTION)
      .doc(subscriptionRecordId(id))
    try {
      const existing = await recordRef.get()
      if (existing.exists) {
        const holders = (existing.get('holders') as string[] | undefined) ?? []
        if (!holders.includes(holder)) {
          await recordRef.set({ holders: [...holders, holder] }, { merge: true })
        }
        steps.push({ id, hostId, outcome: 'held', error: null, confirmed: true })
        continue
      }
      const current = await stripe(secretKey, 'GET', `subscriptions/${encodeURIComponent(id)}`)
      if (!current.ok) {
        steps.push({ id, hostId, outcome: 'failed', error: stripeError(current), confirmed: false })
        continue
      }
      if (isTerminalSubscriptionStatus(current.body?.status)) {
        steps.push({ id, hostId, outcome: 'not-live', error: null, confirmed: true })
        continue
      }
      if (current.body?.pause_collection) {
        // Someone else paused it — the merchant, or staff by hand. Not ours
        // to resume, so it is not recorded.
        steps.push({ id, hostId, outcome: 'already-paused', error: null, confirmed: true })
        continue
      }
      // Recorded FIRST: a pause that landed with no record could never be
      // resumed by the lift. A failed write below removes it again.
      await recordRef.set({
        kind: 'subscription',
        subscriptionId: id,
        hostId,
        holders: [holder],
        behavior: PAUSE_COLLECTION_BEHAVIOR,
        pausedAtMs: Date.now(),
        pausedBy: options.actorUid,
      })
      const write = await stripe(secretKey, 'POST', `subscriptions/${encodeURIComponent(id)}`, {
        'pause_collection[behavior]': PAUSE_COLLECTION_BEHAVIOR,
      })
      if (!write.ok) {
        await recordRef.delete().catch(() => undefined)
        steps.push({ id, hostId, outcome: 'failed', error: stripeError(write), confirmed: false })
        continue
      }
      changed += 1
      const reread = await stripe(secretKey, 'GET', `subscriptions/${encodeURIComponent(id)}`)
      const confirmed =
        reread.ok && reread.body?.pause_collection?.behavior === PAUSE_COLLECTION_BEHAVIOR
      steps.push({
        id,
        hostId,
        outcome: 'paused',
        error: confirmed ? null : `Read-back did not show the pause: ${reread.ok ? 'no pause_collection' : stripeError(reread)}`,
        confirmed,
      })
    } catch (error) {
      steps.push({ id, hostId, outcome: 'failed', error: messageOf(error), confirmed: false })
    }
  }
  return {
    attempted: true,
    configured: true,
    lookupErrors,
    subscriptions: steps,
    changed,
    confirmed: lookupErrors.length === 0 && steps.every((step) => step.confirmed),
  }
}

/** The records this lock holds, of one kind. */
async function heldRecords(
  firestore: Firestore,
  holder: string,
  kind: 'subscription' | 'payouts',
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snapshot = await firestore
    .collection(LOCKDOWN_BILLING_PAUSES_COLLECTION)
    .where('holders', 'array-contains', holder)
    .get()
  return snapshot.docs.filter((doc) => doc.get('kind') === kind)
}

/**
 * Resume exactly what this lock paused. A subscription another lock still
 * holds stays paused; one this lock never recorded is never touched.
 */
export async function resumeMembershipRenewals(options: {
  firestore: Firestore
  scope: LockdownPauseScope
  targetId: string
  secretKey: string | undefined
}): Promise<RenewalsResult<RenewalResumeOutcome>> {
  const { firestore, secretKey } = options
  const holder = lockdownHolderKey(options.scope, options.targetId)
  let records: FirebaseFirestore.QueryDocumentSnapshot[]
  try {
    records = await heldRecords(firestore, holder, 'subscription')
  } catch (error) {
    return {
      attempted: true,
      configured: Boolean(secretKey),
      lookupErrors: [`Reading what the lock paused failed: ${messageOf(error)}`],
      subscriptions: [],
      changed: 0,
      confirmed: false,
    }
  }
  const steps: Array<RenewalStep<RenewalResumeOutcome>> = []
  let changed = 0
  for (const record of records) {
    const id = String(record.get('subscriptionId') ?? '')
    const hostId = String(record.get('hostId') ?? '') || null
    const others = ((record.get('holders') as string[] | undefined) ?? []).filter(
      (entry) => entry !== holder,
    )
    try {
      if (others.length) {
        await record.ref.set({ holders: others }, { merge: true })
        steps.push({ id, hostId, outcome: 'still-held', error: null, confirmed: true })
        continue
      }
      if (!secretKey) {
        steps.push({ id, hostId, outcome: 'failed', error: 'Stripe is not configured on this deployment.', confirmed: false })
        continue
      }
      // An empty value unsets `pause_collection`, and the next invoice
      // collects as normal. The record is kept on failure, so lifting again
      // retries exactly this one.
      const write = await stripe(secretKey, 'POST', `subscriptions/${encodeURIComponent(id)}`, {
        pause_collection: '',
      })
      if (!write.ok) {
        steps.push({ id, hostId, outcome: 'failed', error: stripeError(write), confirmed: false })
        continue
      }
      changed += 1
      await record.ref.delete()
      const reread = await stripe(secretKey, 'GET', `subscriptions/${encodeURIComponent(id)}`)
      const confirmed = reread.ok && !reread.body?.pause_collection
      steps.push({
        id,
        hostId,
        outcome: 'resumed',
        error: confirmed ? null : 'Read-back still shows a pause.',
        confirmed,
      })
    } catch (error) {
      steps.push({ id, hostId, outcome: 'failed', error: messageOf(error), confirmed: false })
    }
  }
  return {
    attempted: true,
    configured: Boolean(secretKey),
    lookupErrors: [],
    subscriptions: steps,
    changed,
    confirmed: steps.every((step) => step.confirmed),
  }
}

/*------------------------------------------
 * PAYOUTS
 *-----------------------------------------*/

/** A payout schedule as Stripe reports it, the part we restore. */
export interface PayoutSchedule {
  interval: string
  delay_days?: number
  weekly_anchor?: string
  monthly_anchor?: number
}

/**
 * Whether the platform may set this connected account's payout schedule.
 * Express and Custom accounts: yes. A Standard account — or any account
 * whose owner has Stripe's full dashboard — controls its own payouts, and
 * a write would be refused.
 */
export function platformControlsPayouts(account: any): boolean {
  const type = account?.type
  if (type === 'standard') return false
  if (type === 'express' || type === 'custom') return true
  const dashboard = account?.controller?.stripe_dashboard?.type
  return dashboard === 'express' || dashboard === 'none'
}

export type PayoutPauseOutcome =
  | 'paused'
  /** Already held manual by another lock; this lock joined its holders. */
  | 'held'
  /** Already on manual payouts; recorded, so the lift restores manual. */
  | 'already-manual'
  /** A Standard account: pause it in the Stripe Dashboard. */
  | 'not-controllable'
  /** The seller has no connected account; nothing pays out. */
  | 'no-account'
  | 'failed'

export type PayoutResumeOutcome = 'restored' | 'still-held' | 'failed'

export interface PayoutsResult<Outcome> {
  attempted: true
  accountId: string | null
  outcome: Outcome | 'nothing-held'
  /** The schedule saved at the lock, or restored at the lift. */
  schedule: PayoutSchedule | null
  error: string | null
  confirmed: boolean
}

const scheduleOf = (account: any): PayoutSchedule | null => {
  const schedule = account?.settings?.payouts?.schedule
  if (!schedule?.interval) return null
  return {
    interval: String(schedule.interval),
    ...(Number.isFinite(Number(schedule.delay_days))
      ? { delay_days: Number(schedule.delay_days) }
      : {}),
    ...(schedule.weekly_anchor ? { weekly_anchor: String(schedule.weekly_anchor) } : {}),
    ...(Number.isFinite(Number(schedule.monthly_anchor))
      ? { monthly_anchor: Number(schedule.monthly_anchor) }
      : {}),
  }
}

/** The form params that set `schedule` back exactly. */
export function payoutScheduleParams(schedule: PayoutSchedule): Record<string, string> {
  const prefix = 'settings[payouts][schedule]'
  return {
    [`${prefix}[interval]`]: schedule.interval,
    ...(schedule.interval === 'weekly' && schedule.weekly_anchor
      ? { [`${prefix}[weekly_anchor]`]: schedule.weekly_anchor }
      : {}),
    ...(schedule.interval === 'monthly' && schedule.monthly_anchor !== undefined
      ? { [`${prefix}[monthly_anchor]`]: String(schedule.monthly_anchor) }
      : {}),
    ...(schedule.interval !== 'manual' && schedule.delay_days !== undefined
      ? { [`${prefix}[delay_days]`]: String(schedule.delay_days) }
      : {}),
  }
}

/** Switch the seller's connected account to manual payouts, saving its schedule. */
export async function pauseSellerPayouts(options: {
  firestore: Firestore
  scope: LockdownPauseScope
  targetId: string
  accountId: string | null
  secretKey: string | undefined
  actorUid: string
}): Promise<PayoutsResult<PayoutPauseOutcome>> {
  const { firestore, accountId, secretKey } = options
  const holder = lockdownHolderKey(options.scope, options.targetId)
  const result = (
    outcome: PayoutPauseOutcome,
    confirmed: boolean,
    extra: { schedule?: PayoutSchedule | null; error?: string | null } = {},
  ): PayoutsResult<PayoutPauseOutcome> => ({
    attempted: true,
    accountId,
    outcome,
    schedule: extra.schedule ?? null,
    error: extra.error ?? null,
    confirmed,
  })
  if (!accountId) return result('no-account', true)
  if (!secretKey) {
    return result('failed', false, { error: 'Stripe is not configured on this deployment.' })
  }
  const recordRef = firestore
    .collection(LOCKDOWN_BILLING_PAUSES_COLLECTION)
    .doc(payoutRecordId(accountId))
  try {
    const existing = await recordRef.get()
    if (existing.exists) {
      const holders = (existing.get('holders') as string[] | undefined) ?? []
      if (!holders.includes(holder)) {
        await recordRef.set({ holders: [...holders, holder] }, { merge: true })
      }
      return result('held', true, {
        schedule: (existing.get('previousSchedule') as PayoutSchedule) ?? null,
      })
    }
    const account = await stripe(secretKey, 'GET', `accounts/${encodeURIComponent(accountId)}`)
    if (!account.ok) return result('failed', false, { error: stripeError(account) })
    if (!platformControlsPayouts(account.body)) {
      return result('not-controllable', false, {
        error: 'Not controllable: a Standard account runs its own payouts. Pause them in the Stripe Dashboard.',
      })
    }
    const previous = scheduleOf(account.body)
    if (!previous) {
      return result('failed', false, { error: 'Stripe reported no payout schedule to save.' })
    }
    await recordRef.set({
      kind: 'payouts',
      accountId,
      holders: [holder],
      previousSchedule: previous,
      pausedAtMs: Date.now(),
      pausedBy: options.actorUid,
    })
    if (previous.interval === 'manual') {
      return result('already-manual', true, { schedule: previous })
    }
    const write = await stripe(secretKey, 'POST', `accounts/${encodeURIComponent(accountId)}`, {
      'settings[payouts][schedule][interval]': 'manual',
    })
    if (!write.ok) {
      await recordRef.delete().catch(() => undefined)
      return result('failed', false, { schedule: previous, error: stripeError(write) })
    }
    const reread = await stripe(secretKey, 'GET', `accounts/${encodeURIComponent(accountId)}`)
    const confirmed = reread.ok && scheduleOf(reread.body)?.interval === 'manual'
    return result('paused', confirmed, {
      schedule: previous,
      error: confirmed ? null : 'Read-back does not show manual payouts.',
    })
  } catch (error) {
    return result('failed', false, { error: messageOf(error) })
  }
}

/** Restore exactly the schedule the lock saved, once no lock holds it. */
export async function restoreSellerPayouts(options: {
  firestore: Firestore
  scope: LockdownPauseScope
  targetId: string
  secretKey: string | undefined
}): Promise<PayoutsResult<PayoutResumeOutcome>> {
  const { firestore, secretKey } = options
  const holder = lockdownHolderKey(options.scope, options.targetId)
  let records: FirebaseFirestore.QueryDocumentSnapshot[]
  try {
    records = await heldRecords(firestore, holder, 'payouts')
  } catch (error) {
    return {
      attempted: true,
      accountId: null,
      outcome: 'failed',
      schedule: null,
      error: `Reading what the lock paused failed: ${messageOf(error)}`,
      confirmed: false,
    }
  }
  const record = records[0]
  if (!record) {
    return { attempted: true, accountId: null, outcome: 'nothing-held', schedule: null, error: null, confirmed: true }
  }
  const accountId = String(record.get('accountId') ?? '')
  const previous = record.get('previousSchedule') as PayoutSchedule
  const others = ((record.get('holders') as string[] | undefined) ?? []).filter(
    (entry) => entry !== holder,
  )
  const result = (
    outcome: PayoutResumeOutcome,
    confirmed: boolean,
    error: string | null = null,
  ): PayoutsResult<PayoutResumeOutcome> => ({
    attempted: true,
    accountId,
    outcome,
    schedule: previous ?? null,
    error,
    confirmed,
  })
  try {
    if (others.length) {
      await record.ref.set({ holders: others }, { merge: true })
      return result('still-held', true)
    }
    if (!secretKey) return result('failed', false, 'Stripe is not configured on this deployment.')
    const write = await stripe(
      secretKey,
      'POST',
      `accounts/${encodeURIComponent(accountId)}`,
      payoutScheduleParams(previous),
    )
    if (!write.ok) return result('failed', false, stripeError(write))
    await record.ref.delete()
    const reread = await stripe(secretKey, 'GET', `accounts/${encodeURIComponent(accountId)}`)
    const restored = scheduleOf(reread.body)
    const confirmed =
      reread.ok &&
      restored?.interval === previous.interval &&
      (previous.weekly_anchor === undefined || restored?.weekly_anchor === previous.weekly_anchor) &&
      (previous.monthly_anchor === undefined || restored?.monthly_anchor === previous.monthly_anchor)
    return result('restored', confirmed, confirmed ? null : 'Read-back does not match the saved schedule.')
  } catch (error) {
    return result('failed', false, messageOf(error))
  }
}

/*------------------------------------------
 * AUDIT
 *-----------------------------------------*/

/**
 * One `adminAudit` row per step, failures included: the attempt that did
 * not land is the row an incident reviewer most needs.
 */
export async function auditLockdownBillingStep(
  firestore: Firestore,
  options: {
    actorUid: string
    actorEmail?: string | null
    scope: LockdownPauseScope
    targetId: string
    reason: string | null
    action:
      | 'lockdown.renewals-pause'
      | 'lockdown.renewals-resume'
      | 'lockdown.payouts-pause'
      | 'lockdown.payouts-restore'
    result: Record<string, unknown>
  },
): Promise<void> {
  await addAdminAudit(firestore, {
    actorUid: options.actorUid,
    actorEmail: options.actorEmail ?? null,
    action: options.action,
    scope: options.scope,
    target: `${options.scope === 'org' ? 'orgs' : 'hosts'}/${options.targetId}`,
    reason: options.reason,
    via: 'lockdown',
    // Stated on the row: a pause moves no money in either direction.
    refunded: false,
    canceled: false,
    before: null,
    after: options.result,
    at: FieldValue.serverTimestamp(),
  })
}
