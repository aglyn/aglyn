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
 * PER-TENANT SENDING REPUTATION — the durable half.
 *
 * The policy is pure and lives in `@aglyn/shared-util-email`
 * (`sender-reputation.ts`); this adds the counters that make a rate a fact
 * rather than an intention, and the daily claim that paces a workspace's
 * first week.
 *
 * ## One document per workspace per day
 *
 * `rateLimits/emailRep_{YYYY-MM-DD}_{orgId}` holds four numbers:
 *
 *  - `claimed` — campaign messages the day's ramp has granted. The PACING
 *    counter, taken before a send and reconciled to what actually left.
 *  - `accepted` — campaign messages that actually left. The DENOMINATOR every
 *    rate divides by.
 *  - `bounced`, `complained` — what the provider reported back.
 *
 * A day per document rather than a map of days on one, because the day is
 * what the TTL policy can sweep: `rateLimits` already carries an `expiresAt`
 * policy, and a document that ages out is a window that prunes itself. A map
 * of every day a workspace has ever sent would grow forever and would have to
 * be pruned by a job nobody would write.
 *
 * A per-ORG document rather than per-site, because the org is the tenant: the
 * plan, the monthly allowance and the hourly share are all keyed on it, and a
 * merchant with three sites on one domain is one sender to a mailbox
 * provider.
 *
 * The window document deliberately carries **no `lastAtMs`** — the
 * rate-limiter health probe queries this collection on that field, and a
 * per-day document in its range would compete with the degradation markers it
 * exists to find. The same reasoning as `sendRate_*` and `sendRateOrg_*`
 * beside it.
 *
 * ## Which day a bounce is filed under
 *
 * The day the EVENT arrived, not the day the message was sent. The webhook
 * knows the first and would need a per-message lookup for the second, and
 * over a seven-day window the two differ only at the edges — a bounce lands
 * within minutes and a complaint within hours or a day. Stated because the
 * rate is a ratio of two things counted on slightly different clocks, and a
 * reader comparing it against a provider's dashboard should know why they
 * will not agree to the last decimal.
 *
 * ## Failure posture: OPEN, and that is not the usual answer here
 *
 * An unreadable counter grades `ok` and grants the send, matching
 * `consumeEmailSendBudget` and `claimOrgEmailSendBudget`. The breaker is the
 * one control in this file that could refuse a paying customer's campaign,
 * and a refusal produced by a Firestore blip is an outage dressed as a policy
 * decision. The reputation risk it fails to catch is bounded by an hour of
 * sending; the refusal it would produce is not bounded by anything.
 */

import {
  EMAIL_REPUTATION_WINDOW_DAYS,
  emailRampVerdict,
  emailReputationVerdict,
  normalizeEmailReputationPolicy,
  orgDailyCampaignCeiling,
  reputationDayKey,
  reputationWindowDayKeys,
  daysBetween,
  type EmailRampVerdict,
  type EmailReputationCounts,
  type EmailReputationPolicy,
  type EmailReputationVerdict,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from './firebase-admin'
import { RATE_LIMIT_COLLECTION } from './rate-limit-store'

/** Id prefix for the per-org, per-day reputation documents. */
export const EMAIL_REPUTATION_DOC_PREFIX = 'emailRep_'

/** One day in ms, named so the arithmetic below reads as arithmetic. */
const DAY_MS = 86_400_000

/** The document id for one workspace's day. */
export function emailReputationDocId(dayKey: string, orgId: string): string {
  return `${EMAIL_REPUTATION_DOC_PREFIX}${dayKey}_${orgId}`
}

/** The counted fields, so a writer cannot invent a fifth by typo. */
export type EmailReputationCounter =
  | 'claimed'
  | 'accepted'
  | 'bounced'
  | 'complained'

function reputationRef(firestore: any, dayKey: string, orgId: string): any {
  return firestore
    .collection(RATE_LIMIT_COLLECTION)
    .doc(emailReputationDocId(dayKey, orgId))
}

/** A stored count, clamped. A corrupt negative reads as 0, never as headroom. */
function storedCount(snapshot: any, field: EmailReputationCounter): number {
  const value = Number((snapshot?.exists ? snapshot.get(field) : 0) ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * When a day's document may be swept.
 *
 * One window plus a day of slack past the end of the day it counts, so the
 * oldest day a rate still divides by is never deleted underneath the read
 * that needs it.
 */
function reputationExpiresAt(dayStartMs: number): Date {
  return new Date(dayStartMs + (EMAIL_REPUTATION_WINDOW_DAYS + 2) * DAY_MS)
}

/** Midnight UTC of the day a timestamp falls in. */
function dayStartMs(atMs: number): number {
  return Math.floor(atMs / DAY_MS) * DAY_MS
}

/**
 * Adds to one of a workspace's daily counters.
 *
 * **Never throws.** Reputation accounting runs after mail has gone out, or
 * inside a webhook the provider will retry — a counter write that failed must
 * not turn a delivered campaign into a 500 or a webhook into a retry storm.
 * `FieldValue.increment` rather than a transaction because nothing decides
 * anything from this write: the decision is made by a separate read, and an
 * increment is the contention-free way to record a fact.
 */
export async function recordEmailReputationEvent(options: {
  orgId: string
  counter: EmailReputationCounter
  count?: number
  atMs?: number
  firestore?: any
}): Promise<void> {
  const orgId = String(options.orgId ?? '')
  const count = Math.floor(Number(options.count ?? 1))
  if (!orgId || !Number.isFinite(count) || count <= 0) return
  const atMs = Number(options.atMs ?? Date.now())
  const at = Number.isFinite(atMs) && atMs > 0 ? atMs : Date.now()
  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    await reputationRef(firestore, reputationDayKey(at), orgId).set(
      {
        [options.counter]: firebaseAdmin.firestore.FieldValue.increment(count),
        orgId,
        dayKey: reputationDayKey(at),
        // NOT `lastAtMs` — see the storage note at the top of this file.
        expiresAt: reputationExpiresAt(dayStartMs(at)),
      },
      { merge: true },
    )
  } catch (error) {
    console.error('[sender-reputation] counter write failed', error)
  }
}

/** Campaign messages that actually left, for a workspace. The denominator. */
export function recordCampaignAccepted(
  orgId: string,
  count: number,
  options?: { atMs?: number; firestore?: any },
): Promise<void> {
  return recordEmailReputationEvent({
    orgId,
    counter: 'accepted',
    count,
    ...options,
  })
}

/**
 * A permanent bounce or a spam complaint, attributed to the workspace that
 * sent it.
 *
 * The suppression the same event produces is a separate act and is not
 * conditional on this: an address comes off the list whether or not the
 * counter write lands.
 */
export function recordEmailReputationFailure(
  orgId: string,
  kind: 'bounce' | 'complaint',
  options?: { atMs?: number; firestore?: any },
): Promise<void> {
  return recordEmailReputationEvent({
    orgId,
    counter: kind === 'complaint' ? 'complained' : 'bounced',
    count: 1,
    ...options,
  })
}

/** The counts a workspace's window holds, plus what the ramp needs. */
export interface SenderReputationWindow extends EmailReputationCounts {
  /**
   * Campaign messages the ramp has granted TODAY.
   *
   * Read here rather than by a second query because today's document is
   * already in this window: the ramp needs one number off it and the rates
   * need three off all of them, and two reads of one document to answer two
   * questions about the same workspace is a round trip nobody has to pay.
   */
  claimedToday: number
  /** Days the window covers. */
  windowDays: number
  /** True when the window could not be read and everything below is zero. */
  degraded: boolean
}

/**
 * Sums a workspace's last {@link EMAIL_REPUTATION_WINDOW_DAYS} days.
 *
 * One `getAll` over the window's day documents — seven reads per campaign,
 * not per message, and none at all for a workspace that has never sent. An
 * absent day is a quiet day and reads as zero.
 */
export async function readSenderReputationWindow(options: {
  orgId: string
  now?: number
  windowDays?: number
  firestore?: any
}): Promise<SenderReputationWindow> {
  const windowDays = Math.max(
    1,
    Math.floor(Number(options.windowDays ?? EMAIL_REPUTATION_WINDOW_DAYS)) ||
      EMAIL_REPUTATION_WINDOW_DAYS,
  )
  const empty: SenderReputationWindow = {
    accepted: 0,
    bounced: 0,
    complained: 0,
    claimedToday: 0,
    windowDays,
    degraded: false,
  }
  const orgId = String(options.orgId ?? '')
  if (!orgId) return empty
  const now = Number(options.now ?? Date.now())
  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const dayKeys = reputationWindowDayKeys(now, windowDays)
    const today = reputationDayKey(now)
    const snapshots = await firestore.getAll(
      ...dayKeys.map((dayKey) => reputationRef(firestore, dayKey, orgId)),
    )
    return snapshots.reduce(
      (totals: SenderReputationWindow, snapshot: any, index: number) => ({
        ...totals,
        accepted: totals.accepted + storedCount(snapshot, 'accepted'),
        bounced: totals.bounced + storedCount(snapshot, 'bounced'),
        complained: totals.complained + storedCount(snapshot, 'complained'),
        claimedToday:
          dayKeys[index] === today
            ? totals.claimedToday + storedCount(snapshot, 'claimed')
            : totals.claimedToday,
      }),
      empty,
    )
  } catch (error) {
    console.error('[sender-reputation] window unavailable — grading ok', error)
    return { ...empty, degraded: true }
  }
}

/** A workspace's reputation, and whether its campaigns may go out. */
export interface SenderReputationRead extends EmailReputationVerdict {
  /** True when the window could not be read, so nothing was graded. */
  degraded: boolean
  /** The counts the grade was made from, so a caller can size a ramp too. */
  window: SenderReputationWindow
}

/**
 * Grades one workspace.
 *
 * The policy and the grace period come from the ORG DOCUMENT, which the
 * campaign sender has already read — passed in rather than re-fetched, so
 * this costs the window read and nothing else.
 */
export async function readSenderReputation(options: {
  orgId: string
  policy?: unknown
  reinstatedUntilMs?: unknown
  now?: number
  firestore?: any
}): Promise<SenderReputationRead> {
  const now = Number(options.now ?? Date.now())
  const window = await readSenderReputationWindow({
    orgId: options.orgId,
    now,
    firestore: options.firestore,
  })
  const verdict = emailReputationVerdict({
    counts: window,
    // A degraded read grades against zeroes, which is `ok` by construction.
    // Stated rather than special-cased: the fail-open posture at the top of
    // this file is the reason, and a branch here would be a second place for
    // it to be got wrong.
    policy: normalizeEmailReputationPolicy(options.policy),
    windowDays: window.windowDays,
    reinstatedUntilMs: Number(options.reinstatedUntilMs ?? 0) || null,
    now,
  })
  return { ...verdict, degraded: window.degraded, window }
}

/**
 * The ramp step a workspace has EARNED, from a window it has already read.
 *
 * A thin wrapper over the pure policy that supplies the one number the policy
 * cannot know: what a graduated workspace's day is, which is a share of the
 * live platform ceiling and therefore moves with a staff ramp.
 */
export function resolveOrgEmailRamp(options: {
  /** Days since the workspace was created; null or absent graduates it. */
  ageDays: number | null | undefined
  /** Campaign messages it has delivered inside the window. */
  deliveredLifetime: number
  /** The live platform ceiling. */
  platformPerHour: number
}): EmailRampVerdict {
  return emailRampVerdict({
    ageDays: options.ageDays,
    deliveredLifetime: options.deliveredLifetime,
    graduatedPerDay: orgDailyCampaignCeiling(options.platformPerHour),
  })
}

/** The answer to a per-day ramp claim. Every field is a stated number. */
export interface OrgEmailSendDayClaim {
  allowed: boolean
  /** Messages claimed today BEFORE this send. */
  used: number
  /** What this workspace may send today. */
  ceiling: number
  /** Headroom after this send, floored at 0. */
  remaining: number
  /** When the day rolls and a deferred campaign may go, ms. */
  retryAtMs: number
  /** The ramp decision the ceiling came from. */
  ramp: EmailRampVerdict
  /** True when the counter was unreachable and this failed open. */
  degraded: boolean
  /**
   * What to hand {@link reconcileOrgEmailSendDay} once the batch is done.
   * Null when nothing was claimed — a graduated workspace, a parked control,
   * or a refusal.
   */
  reservation: OrgEmailSendDayReservation | null
}

/** A claim on a day's ramp, so an undelivered remainder can be given back. */
export interface OrgEmailSendDayReservation {
  orgId: string
  dayKey: string
  claimed: number
}

/**
 * THE NEW-SENDER RAMP, ENFORCED.
 *
 * Claims `count` campaign messages against what this workspace may send
 * today, atomically. The transaction reads the counter and writes an ABSOLUTE
 * value derived from that read rather than an increment, for the reason
 * `reserveCampaignEmailSends` and `claimOrgEmailSendBudget` both do: the read
 * is the authority for the decision, and an increment proves nothing about
 * the value the decision was made from.
 *
 * The ceiling arrives as a resolved {@link EmailRampVerdict} rather than
 * being derived here, because the caller has already paid the window read
 * that decides which step the workspace is on — see
 * {@link resolveOrgEmailRamp}. A graduated workspace claims nothing at all:
 * the ramp does not bind it, and the hourly share that does has already been
 * claimed by the time this runs.
 *
 * **Campaigns only**, like the hourly claim beside it. This function is not
 * on `sendEmail`'s path and cannot be reached by a transactional message.
 *
 * A refused claim writes NOTHING — a campaign that resumes tomorrow must not
 * have spent tomorrow's budget on being told no.
 */
export async function claimOrgEmailSendDay(options: {
  orgId: string
  /** Messages this batch would send. */
  count: number
  /** What this workspace may send today, from {@link resolveOrgEmailRamp}. */
  ramp: EmailRampVerdict
  /** False parks the control, exactly as the platform governor's flag does. */
  enabled?: boolean
  now?: number
  firestore?: any
}): Promise<OrgEmailSendDayClaim> {
  const now = Number(options.now ?? Date.now())
  const at = Number.isFinite(now) && now > 0 ? now : Date.now()
  const dayKey = reputationDayKey(at)
  const retryAtMs = dayStartMs(at) + DAY_MS
  const count = Math.max(0, Math.floor(Number(options.count) || 0))
  const orgId = String(options.orgId ?? '')
  const ramp = options.ramp

  const granted = (
    used: number,
    degraded: boolean,
    reservation: OrgEmailSendDayReservation | null,
  ): OrgEmailSendDayClaim => ({
    allowed: true,
    used,
    ceiling: ramp.perDay,
    remaining: Math.max(0, ramp.perDay - (used + count)),
    retryAtMs,
    ramp,
    degraded,
    reservation,
  })

  // A parked control still reports a real ceiling, so a surface reading this
  // does not blank while the control is off.
  if (options.enabled === false) return granted(0, false, null)
  // A graduated workspace is not paced by the ramp at all. No read, no write,
  // and no claim to give back.
  if (ramp.graduated) return granted(0, false, null)
  if (!orgId) return granted(0, true, null)

  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const ref = reputationRef(firestore, dayKey, orgId)
    return await firestore.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const used = storedCount(snapshot, 'claimed')
      if (used + count > ramp.perDay) {
        // A refused claim writes NOTHING.
        return {
          allowed: false,
          used,
          ceiling: ramp.perDay,
          remaining: Math.max(0, ramp.perDay - used),
          retryAtMs,
          ramp,
          degraded: false,
          reservation: null,
        }
      }
      tx.set(
        ref,
        {
          claimed: used + count,
          orgId,
          dayKey,
          expiresAt: reputationExpiresAt(dayStartMs(at)),
        },
        { merge: true },
      )
      return granted(used, false, { orgId, dayKey, claimed: count })
    })
  } catch (error) {
    console.error('[sender-reputation] day window unavailable — allowing', error)
    return granted(0, true, null)
  }
}

/**
 * Returns the undelivered part of a day's ramp claim.
 *
 * The hourly claim is deliberately never reconciled — its window is an hour
 * and an unrefunded remainder costs the org the rest of it. A DAY is long
 * enough that the same choice would cost a new workspace its whole first day
 * over one failed batch, which is the opposite of what a ramp is for.
 *
 * **Never throws** and never drives the counter below zero, exactly as
 * `reconcileCampaignSendReservation` does one surface over.
 */
export async function reconcileOrgEmailSendDay(
  reservation: OrgEmailSendDayReservation | null | undefined,
  delivered: number,
  firestore?: any,
): Promise<void> {
  if (!reservation?.orgId) return
  const sent = Math.max(0, Math.floor(Number(delivered) || 0))
  const refund = Math.max(0, reservation.claimed - sent)
  if (refund <= 0) return
  try {
    const db = firestore ?? firebaseAdmin.app().firestore()
    const ref = reputationRef(db, reservation.dayKey, reservation.orgId)
    await db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const used = storedCount(snapshot, 'claimed')
      tx.set(ref, { claimed: Math.max(0, used - refund) }, { merge: true })
    })
  } catch (error) {
    console.error('[sender-reputation] day reconcile failed', error)
  }
}

/**
 * How old a workspace is, in days, from whatever its `createdAt` turns out to
 * be.
 *
 * Firestore hands back a `Timestamp`, a restore or a fixture can leave a
 * number, and an org written before the field existed has nothing. All three
 * are handled and the last one answers `null`, which
 * {@link claimOrgEmailSendDay} reads as graduated — the only safe direction,
 * for the reason stated there.
 */
export function orgAgeDays(
  createdAt: unknown,
  now: number = Date.now(),
): number | null {
  const raw = createdAt as
    | { toMillis?: () => number; seconds?: number }
    | number
    | string
    | null
    | undefined
  let createdMs = 0
  if (typeof raw === 'number') createdMs = raw
  else if (typeof raw === 'string') createdMs = Date.parse(raw)
  else if (typeof raw?.toMillis === 'function') createdMs = raw.toMillis()
  else if (typeof raw?.seconds === 'number') createdMs = raw.seconds * 1000
  /*
   * The one check, and it has to answer `null` rather than 0. A creation date
   * that could not be read is an org whose record predates the field, which
   * is an EXISTING customer; `0` would say "created today" and ramp every
   * paying tenant on the platform down to the first step.
   */
  if (!Number.isFinite(createdMs) || createdMs <= 0) return null
  return daysBetween(createdMs, now)
}

/** Re-exported so a caller reads one module for the whole control. */
export type { EmailReputationPolicy, EmailRampVerdict }
