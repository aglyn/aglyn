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

import { createHash } from 'node:crypto'
import {
  decideOutreachMailboxHealth,
  OUTREACH_BOUNCE_RATE_WINDOW_SENDS,
  type OutreachMailboxHealthDecision,
} from '../engine/mailbox-health'
import { mailboxRef } from '../mailboxes/mailbox-credentials'
import { outreachLastSevenDays, outreachLocalDay } from '../mailboxes/mailbox-settings'
import type {
  OutreachMailbox,
  OutreachMailboxDailyHealth,
  OutreachRecentSend,
} from '../model/outreach.types'
import type { OutreachRuntimeDeps } from './runtime-deps'

/**
 * WHAT A MAILBOX'S HEALTH IS JUDGED ON, KEPT AS IT HAPPENS (AGL-2981).
 *
 * The engine's `decideOutreachMailboxHealth` is pure: it needs the hard
 * bounces in the mailbox's current day, its last fifty sends and which of
 * them bounced, and when a reply last called its mail spam. This is where
 * the runtime keeps those on the mailbox document:
 *
 * - a send appends `{ id, atMs, bounced: false }` to `health.recentSends`,
 *   the id a digest of its `Message-ID`, never its recipient, and the list
 *   keeps the last {@link OUTREACH_BOUNCE_RATE_WINDOW_SENDS};
 * - a hard bounce marks its send there, when the send is still in the
 *   window, and counts on `health.daily[<its local day>].bounces`;
 * - a complaint moves `health.lastComplaintAtMs`.
 *
 * The health is judged when NEW evidence arrives — a bounce or a complaint
 * this run recorded — and never otherwise. A member who re-checked the list
 * and resumed the mailbox is not paused again by the evidence they already
 * answered; the next bounce is new evidence, and is judged with the window
 * it lands in.
 *
 * A pause is the mailbox's own: status `paused` with `autoPause` beside it,
 * which the Mailboxes card shows as the reason, and a line on the
 * organization's activity feed under `outreach:mailbox`.
 */

/** The activity target a mailbox's rows are filed under (AGL-2978). */
const MAILBOX_TARGET = 'outreach:mailbox' as const

/** How many local days of `health.daily` the runtime keeps. */
const DAILY_DAYS_KEPT = 14

/** The digest a send is named by in `recentSends`. */
export function outreachSendDigest(messageId: string): string {
  return createHash('sha256').update(String(messageId).trim()).digest('hex').slice(0, 16)
}

/** The window with one more send in it, the oldest dropped past the limit. */
export function withRecentSend(
  recent: readonly OutreachRecentSend[] | null | undefined,
  send: OutreachRecentSend,
): OutreachRecentSend[] {
  return [...(recent ?? []).filter((entry) => entry?.id !== send.id), send].slice(
    -OUTREACH_BOUNCE_RATE_WINDOW_SENDS,
  )
}

/** The engine's inputs, read off a mailbox as stored. */
export function outreachMailboxHealthInput(
  mailbox: Pick<OutreachMailbox, 'health' | 'timezone'>,
  nowMs: number,
): Parameters<typeof decideOutreachMailboxHealth>[0] {
  const recent = (mailbox.health?.recentSends ?? []).slice(-OUTREACH_BOUNCE_RATE_WINDOW_SENDS)
  const today = outreachLocalDay(nowMs, mailbox.timezone)
  return {
    bouncesToday: Number(mailbox.health?.daily?.[today]?.bounces ?? 0) || 0,
    recentSends: recent.length,
    recentHardBounces: recent.filter((send) => send?.bounced === true).length,
    lastComplaintAtMs: mailbox.health?.lastComplaintAtMs ?? null,
    nowMs,
  }
}

/** The daily map with the days older than the runtime keeps dropped. */
function prunedDaily(
  daily: Record<string, OutreachMailboxDailyHealth> | undefined,
  nowMs: number,
  timezone: string,
): Record<string, OutreachMailboxDailyHealth> {
  const kept = new Set<string>()
  for (let week = 0; week * 7 < DAILY_DAYS_KEPT; week += 1) {
    for (const day of outreachLastSevenDays(nowMs - week * 7 * 86_400_000, timezone)) kept.add(day)
  }
  return Object.fromEntries(Object.entries(daily ?? {}).filter(([day]) => kept.has(day)))
}

const bump = (
  daily: Record<string, OutreachMailboxDailyHealth>,
  day: string,
  field: keyof OutreachMailboxDailyHealth,
  by = 1,
) => {
  const counts = daily[day] ?? { sent: 0, bounces: 0, replies: 0 }
  daily[day] = { ...counts, [field]: Math.max(0, Number(counts[field]) || 0) + by }
}

/** What one run learned about a mailbox, applied in one write. */
export interface OutreachMailboxHealthDelta {
  /** Hard bounces, each with when it arrived and the send it reports, when known. */
  bounces: Array<{ atMs: number; messageId: string | null }>
  replies: number
  /** The latest complaint this run read, epoch ms. */
  complaintAtMs: number | null
}

export const emptyOutreachHealthDelta = (): OutreachMailboxHealthDelta => ({
  bounces: [],
  replies: 0,
  complaintAtMs: null,
})

/**
 * Applies a run's evidence to a mailbox and pauses it when the engine says
 * so — one transaction — then writes the activity line a pause earns.
 * Answers the decision that paused it, or `null`.
 */
export async function applyOutreachMailboxHealth(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'logOrgActivity'>,
  input: { orgId: string; mailboxId: string; delta: OutreachMailboxHealthDelta },
): Promise<OutreachMailboxHealthDecision | null> {
  const { delta } = input
  if (!delta.bounces.length && !delta.replies && delta.complaintAtMs === null) return null
  const firestore = deps.firestore()
  const nowMs = deps.now()
  const ref = mailboxRef(firestore, input.orgId, input.mailboxId)
  const outcome = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const mailbox = { ...(snapshot.data() as OutreachMailbox), id: snapshot.id }
    const timezone = mailbox.timezone
    const daily = prunedDaily(mailbox.health?.daily, nowMs, timezone)
    let recent = [...(mailbox.health?.recentSends ?? [])]
    for (const bounce of delta.bounces) {
      bump(daily, outreachLocalDay(bounce.atMs, timezone), 'bounces')
      if (bounce.messageId) {
        const id = outreachSendDigest(bounce.messageId)
        recent = recent.map((send) => (send?.id === id ? { ...send, bounced: true } : send))
      }
    }
    if (delta.replies) bump(daily, outreachLocalDay(nowMs, timezone), 'replies', delta.replies)
    const lastComplaintAtMs =
      delta.complaintAtMs === null
        ? (mailbox.health?.lastComplaintAtMs ?? null)
        : Math.max(delta.complaintAtMs, Number(mailbox.health?.lastComplaintAtMs) || 0)
    const health = {
      ...mailbox.health,
      bounces: Math.max(0, Number(mailbox.health?.bounces) || 0) + delta.bounces.length,
      replies: Math.max(0, Number(mailbox.health?.replies) || 0) + delta.replies,
      daily,
      recentSends: recent,
      lastComplaintAtMs,
    }
    const judged = { ...mailbox, health }
    const newEvidence = delta.bounces.length > 0 || delta.complaintAtMs !== null
    const decision =
      newEvidence && mailbox.status === 'connected'
        ? decideOutreachMailboxHealth(outreachMailboxHealthInput(judged, nowMs))
        : null
    const update: Record<string, unknown> = { health, updatedAtMs: nowMs }
    if (decision?.pause && decision.reason && decision.message) {
      update['status'] = 'paused'
      update['autoPause'] = {
        reason: decision.reason,
        message: decision.message,
        atMs: nowMs,
        untilMs: decision.pausedUntilMs,
      }
    }
    transaction.update(ref, update)
    return decision?.pause ? { decision, email: mailbox.email } : null
  })
  if (!outcome) return null
  await deps.logOrgActivity(
    input.orgId,
    { uid: null },
    `Paused an Outreach mailbox automatically: ${outcome.decision.message}`,
    { type: MAILBOX_TARGET, id: input.mailboxId, name: outcome.email },
  )
  return outcome.decision
}
