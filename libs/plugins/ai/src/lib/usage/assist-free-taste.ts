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

import { FieldValue } from 'firebase-admin/firestore'
import {
  assistUsdFromCredits,
  type AssistRefusedBy,
} from '@aglyn/aglyn/app-utils/assist-credits'
import {
  FREE_AI_TASTE_CREDITS_PER_MONTH,
  resolveEffectivePlan,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { sendStaffAlertEmail } from '@aglyn/tenant-data-admin/server/staff-alert-email'

/**
 * The Free AI taste's precautions (AGL-2925) — the half of the meter that
 * exists only because the Free band has no invoice behind it.
 *
 * `FREE_AI_TASTE_CREDITS_PER_MONTH` gives every Free workspace 300 credits a
 * month as a wall. A wall per WORKSPACE is not a bound per PERSON: one
 * account may hold three free workspaces (AGL-2265), a script can mint
 * accounts faster than a person can, and a refused brief costs the same
 * tokens as an answered one. So the taste is metered a second time, per
 * account, and bounded three more ways. Everything below is read and
 * decided INSIDE `reserveAssistMessage`'s transaction, so a burst of
 * concurrent requests cannot each read "under" and all proceed — the same
 * property every other rung of that reservation has.
 *
 * ## Documents (both ABSENT from firebase-firestore.rules on purpose)
 *
 *   users/{uid}/aiUsage/{YYYY-MM}          the ACCOUNT's month:
 *     { month, estCostUsd, requests, days: { [YYYY-MM-DD]: { requests,
 *       refusals } }, updatedAt }
 *   platformAiFreeSpend/{YYYY-MM-DD}       the PLATFORM's day of free spend:
 *     { day, estCostUsd, requests, refusals, alertedAt?, pausedAt?,
 *       updatedAt }
 *
 * The account document sits under `users/{uid}`, whose owner may read and
 * write the user document itself. It may not touch this subcollection: the
 * `users` block matches its subcollections BY NAME and carries no wildcard,
 * so an unmatched name is default-deny for every client, staff included —
 * the same property `assistUsage` relies on one level down. An owner who
 * could write here could reset their own allowance, which is the whole
 * meter. The platform document is a top-level collection alongside
 * `platformCronBeats`, unmatched and therefore closed, and every reader is
 * an Admin-SDK reader behind the staff gate.
 *
 * ## Whose account
 *
 * The WORKSPACE OWNER's. A member invited to someone else's free workspace
 * draws from that workspace's band and from its owner's allowance, never
 * from their own account: the owner is the person the free workspace is
 * attributed to for the ceiling on how many they may hold, and attributing
 * the spend the same way is what keeps the two bounds describing one
 * person. `ownerUid` first, `createdByUid` for an org that predates
 * ownership stamping — the same union the free-workspace count reads.
 */

/** Where an account's month of free AI spend lives, under `users/{uid}`. */
export const FREE_AI_ACCOUNT_USAGE_COLLECTION = 'aiUsage'

/** The top-level collection holding one document per UTC day of free spend. */
export const PLATFORM_AI_FREE_SPEND_COLLECTION = 'platformAiFreeSpend'

/**
 * Refusals a day before an account's free generation pauses. Three, not
 * one: a single declined brief is a normal outcome of asking an assistant
 * for things, and pausing on it would punish an ordinary afternoon. Three
 * in a day is somebody probing what the model will write.
 */
export const AI_FREE_REFUSALS_PER_DAY = 3

/** The share of the platform ceiling at which staff are told, once a day. */
export const AI_FREE_PLATFORM_ALERT_SHARE = 0.8

/** The account allowance, in USD of provider spend — the taste, per person. */
export const FREE_AI_ACCOUNT_BUDGET_USD = assistUsdFromCredits(
  FREE_AI_TASTE_CREDITS_PER_MONTH,
)

/**
 * Free requests one account may make a UTC day, across its workspaces
 * (`AI_FREE_DAILY_REQUESTS`, default 30).
 *
 * A request, not a message: this counts every reservation the account's
 * free workspaces take, at either door. Thirty is three times the
 * per-workspace message cap, so one workspace never hits it before its own
 * cap and three workspaces hit it exactly when their caps would have
 * summed — it bounds the multiplier, not the ordinary day. Zero is honored
 * as "no free requests", which is a decision an operator may write down;
 * junk and an empty value take the default.
 */
export function aiFreeDailyRequests(): number {
  const raw = process.env.AI_FREE_DAILY_REQUESTS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 30
}

/**
 * The platform-wide ceiling on ONE UTC day of free-tier provider spend
 * (`AI_FREE_DAILY_PLATFORM_CEILING_USD`, default $25).
 *
 * Every other bound here is per something — per workspace, per account,
 * per address — and a wave of new accounts clears all of them one at a
 * time. This is the bound on the sum. At 80% of it staff are mailed; at
 * 100% every free reservation refuses until the day rolls, paid workspaces
 * untouched, and the manual `ai-generate` lockdown key remains the switch
 * for anything the ceiling did not catch.
 *
 * Fails to the DEFAULT, never to "no ceiling", for the reason the operator
 * COGS limit does: an empty, negative, zero or unparseable value is not a
 * decision to run unbounded. There is deliberately no `off` word — a
 * deployment that wants no ceiling sets a figure it is content to spend.
 */
export function aiFreeDailyPlatformCeilingUsd(): number {
  const raw = String(process.env.AI_FREE_DAILY_PLATFORM_CEILING_USD ?? '').trim()
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25
}

/** The account a free workspace's spend is attributed to. */
export interface FreeAssistAccount {
  /**
   * The workspace owner's uid, or `null` for an org document that names no
   * owner and no creator — every org created since ownership was stamped
   * names one, so `null` is the shape of a fixture or a very old record.
   * The account rungs are skipped for it; the org's own band still binds.
   */
  accountUid: string | null
}

/** The org fields the attribution reads, beside the billing ones. */
export type AssistMeteredOrg = Partial<AglynOrgBilling> & {
  ownerUid?: string | null
  createdByUid?: string | null
}

/**
 * The account to meter a workspace's free spend against, or `null` when the
 * workspace is not on the Free plan and none of this applies.
 *
 * `resolveEffectivePlan`, not `org.plan`: a workspace whose subscription
 * died is Free again, and its spend is the taste's spend again.
 */
export function freeAssistAccount(
  org: AssistMeteredOrg | null | undefined,
): FreeAssistAccount | null {
  if (resolveEffectivePlan(org) !== 'free') return null
  const owner = String(org?.ownerUid ?? '').trim()
  const creator = String(org?.createdByUid ?? '').trim()
  return { accountUid: owner || creator || null }
}

export function freeAccountUsageRef(
  firestore: FirebaseFirestore.Firestore,
  accountUid: string,
  month: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('users')
    .doc(accountUid)
    .collection(FREE_AI_ACCOUNT_USAGE_COLLECTION)
    .doc(month)
}

export function platformFreeSpendRef(
  firestore: FirebaseFirestore.Firestore,
  day: string,
): FirebaseFirestore.DocumentReference {
  return firestore.collection(PLATFORM_AI_FREE_SPEND_COLLECTION).doc(day)
}

/** What the reservation read about the account and the platform. */
export interface FreeTasteReads {
  accountCostUsd: number
  accountRequestsToday: number
  accountRefusalsToday: number
  platformCostUsd: number
  platformPaused: boolean
}

/** The two snapshots, as the transaction handed them over, into figures. */
export function freeTasteReadsFrom(
  account: FirebaseFirestore.DocumentSnapshot | null,
  platform: FirebaseFirestore.DocumentSnapshot | null,
  day: string,
): FreeTasteReads {
  const days = (account?.get('days') ?? {}) as Record<
    string,
    { requests?: unknown; refusals?: unknown } | undefined
  >
  const today = days[day] ?? {}
  return {
    accountCostUsd: Number(account?.get('estCostUsd') ?? 0),
    accountRequestsToday: Number(today.requests ?? 0),
    accountRefusalsToday: Number(today.refusals ?? 0),
    platformCostUsd: Number(platform?.get('estCostUsd') ?? 0),
    platformPaused: Boolean(platform?.get('pausedAt')),
  }
}

/**
 * Which of the taste's own precautions refuses, or `null` when none does —
 * pure, so the spec can force every rung red without a Firestore.
 *
 * Checked in the order the reads are cheapest to explain: the daily
 * request cap and the refusal pause (both reset on a clock the customer
 * can be told about), then the account's month (an upgrade is the way
 * out), then the platform ceiling (nobody's doing; try again tomorrow).
 * The org's own rungs — its daily message cap, its band — run before this
 * in the reservation, so a workspace at its own band hears about its own
 * band rather than about its owner's other workspaces.
 *
 * Every comparison is `>=` against a count the reservation is about to
 * increment, so a cap of N admits exactly N. A paused platform refuses
 * regardless of the running figure: the pause is a decision recorded on
 * the document, and a ceiling raised by an operator mid-day does not undo
 * it — the day rolls, or staff clear the document.
 */
export function freeTasteRefusal(
  reads: FreeTasteReads,
  limits: {
    dailyRequests?: number
    refusalsPerDay?: number
    accountBudgetUsd?: number
    platformCeilingUsd?: number
  } = {},
): Extract<AssistRefusedBy, 'requests' | 'refusals' | 'account' | 'platform'> | null {
  const dailyRequests = limits.dailyRequests ?? aiFreeDailyRequests()
  const refusalsPerDay = limits.refusalsPerDay ?? AI_FREE_REFUSALS_PER_DAY
  const accountBudgetUsd = limits.accountBudgetUsd ?? FREE_AI_ACCOUNT_BUDGET_USD
  const platformCeilingUsd =
    limits.platformCeilingUsd ?? aiFreeDailyPlatformCeilingUsd()
  if (reads.accountRequestsToday >= dailyRequests) return 'requests'
  if (reads.accountRefusalsToday >= refusalsPerDay) return 'refusals'
  if (reads.accountCostUsd >= accountBudgetUsd) return 'account'
  if (reads.platformPaused || reads.platformCostUsd >= platformCeilingUsd) {
    return 'platform'
  }
  return null
}

/**
 * The account-side write one admitted free reservation owes: a request
 * counted for the month and for the day. `set(…, { merge: true })` with
 * nested increments, so the first request of a month conjures the document
 * and a day's map entry appears the first time that day is counted.
 */
export function freeAccountReservationWrite(
  month: string,
  day: string,
): Record<string, unknown> {
  const increment = FieldValue.increment
  return {
    month,
    requests: increment(1),
    days: { [day]: { requests: increment(1) } },
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/**
 * The two writes one metered free turn owes, beside the org's own rollup.
 *
 * A `refusal` stop is the one case where the meters disagree on purpose. The
 * tokens were spent, so the PLATFORM document — which bounds our money —
 * takes the cost and counts the refusal. The ACCOUNT's credits do not move:
 * a refusal never draws credits, because a customer whose brief was
 * declined has not been given anything, and because a run of declined
 * briefs is answered by the refusal pause rather than by an emptied band.
 * The account's day counts the refusal, which is what the pause reads.
 */
export function freeTasteMeterWrites(input: {
  estCostUsd: number
  refused: boolean
  day: string
  month: string
}): { account: Record<string, unknown>; platform: Record<string, unknown> } {
  const increment = FieldValue.increment
  const serverTimestamp = FieldValue.serverTimestamp
  const { estCostUsd, refused, day, month } = input
  return {
    account: refused
      ? {
          month,
          days: { [day]: { refusals: increment(1) } },
          updatedAt: serverTimestamp(),
        }
      : { month, estCostUsd: increment(estCostUsd), updatedAt: serverTimestamp() },
    platform: {
      day,
      estCostUsd: increment(estCostUsd),
      requests: increment(1),
      refusals: increment(refused ? 1 : 0),
      updatedAt: serverTimestamp(),
    },
  }
}

/**
 * After a free turn is metered: tell staff at 80% of the day's ceiling,
 * and record the pause at 100% — each ONCE per UTC day, deduplicated on
 * the day document itself inside a transaction, so two turns landing
 * together cannot both cross a threshold and both announce it.
 *
 * The refusal at the ceiling is NOT decided here; `freeTasteRefusal` reads
 * the figure inside every reservation and refuses on it directly. This
 * only says so out loud: the email, and an `adminAudit` row under
 * `platform.aiFreeSpend.paused` so the staff audit trail shows the day the
 * taste switched itself off. Both are best-effort and neither can fail the
 * turn that triggered them — the turn is already paid for.
 *
 * Returns what it announced, for the spec and for the log.
 */
export async function announcePlatformFreeSpend(
  firestore: FirebaseFirestore.Firestore,
  day: string,
): Promise<{ alerted: boolean; paused: boolean; estCostUsd: number }> {
  const ceilingUsd = aiFreeDailyPlatformCeilingUsd()
  const ref = platformFreeSpendRef(firestore, day)
  const crossed = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const estCostUsd = Number(snapshot.get('estCostUsd') ?? 0)
    const alert =
      !snapshot.get('alertedAt') &&
      estCostUsd >= ceilingUsd * AI_FREE_PLATFORM_ALERT_SHARE
    const pause = !snapshot.get('pausedAt') && estCostUsd >= ceilingUsd
    if (alert || pause) {
      tx.set(
        ref,
        {
          ...(alert ? { alertedAt: FieldValue.serverTimestamp() } : {}),
          ...(pause ? { pausedAt: FieldValue.serverTimestamp() } : {}),
        },
        { merge: true },
      )
    }
    return { alerted: alert, paused: pause, estCostUsd }
  })
  if (!crossed.alerted && !crossed.paused) return crossed

  const figure = `$${crossed.estCostUsd.toFixed(2)} of the $${ceilingUsd.toFixed(2)} ceiling`
  if (crossed.paused) {
    await firestore
      .collection('adminAudit')
      .add({
        actorUid: 'system:ai-free-spend',
        action: 'platform.aiFreeSpend.paused',
        target: `${PLATFORM_AI_FREE_SPEND_COLLECTION}/${day}`,
        after: { day, estCostUsd: crossed.estCostUsd, ceilingUsd },
        at: FieldValue.serverTimestamp(),
      })
      .catch((error) =>
        console.error('[ai-free-spend] audit row failed', error),
      )
  }
  await sendStaffAlertEmail({
    subject: crossed.paused
      ? `Free AI generation paused for ${day}: ${figure}`
      : `Free AI spend at 80% of today's ceiling (${day}): ${figure}`,
    text: crossed.paused
      ? `Free-tier AI spend for ${day} (UTC) reached ${figure} ` +
        '(AI_FREE_DAILY_PLATFORM_CEILING_USD). Every Free workspace is ' +
        'refused AI generation until the UTC day rolls; paid workspaces are ' +
        'unaffected. If this is an abuse wave rather than organic use, the ' +
        '`ai-generate` feature lock on Staff → Lockdown stops generation ' +
        'for everyone, and the assist signals page shows which workspaces ' +
        'spent it.'
      : `Free-tier AI spend for ${day} (UTC) is at ${figure} ` +
        '(AI_FREE_DAILY_PLATFORM_CEILING_USD). At 100% every Free ' +
        'workspace is refused AI generation until the day rolls. The ' +
        'assist signals page shows the day so far; the `ai-generate` ' +
        'feature lock on Staff → Lockdown is the manual stop.',
    context: 'ai-free-spend',
  })
  return crossed
}

/** The staff readout of today's free spend, for the assist signals page. */
export interface PlatformFreeSpendReadout {
  day: string
  estCostUsd: number
  requests: number
  refusals: number
  ceilingUsd: number
  /** True once the 80% mail went out today. */
  alerted: boolean
  /** True while free generation is refused for the day. */
  paused: boolean
}

export async function readPlatformFreeSpend(
  firestore: FirebaseFirestore.Firestore,
  day: string,
): Promise<PlatformFreeSpendReadout> {
  const snapshot = await platformFreeSpendRef(firestore, day).get()
  const ceilingUsd = aiFreeDailyPlatformCeilingUsd()
  const estCostUsd = Number(snapshot.get('estCostUsd') ?? 0)
  return {
    day,
    estCostUsd,
    requests: Number(snapshot.get('requests') ?? 0),
    refusals: Number(snapshot.get('refusals') ?? 0),
    ceilingUsd,
    alerted: Boolean(snapshot.get('alertedAt')),
    // The pause is the recorded decision OR the live figure: a day that
    // crossed the ceiling before anything announced it is paused all the
    // same, because the reservation refuses on the figure.
    paused: Boolean(snapshot.get('pausedAt')) || estCostUsd >= ceilingUsd,
  }
}
