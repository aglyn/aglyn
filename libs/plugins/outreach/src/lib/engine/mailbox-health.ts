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
 * WHEN A MAILBOX STOPS ITSELF (AGL-2979).
 *
 * Bounces are the one signal a small sender gets early: at this volume the
 * mailbox providers' own dashboards show nothing, and a list with bad
 * addresses in it shows up as hard bounces days before it shows up as a
 * reputation problem. So a mailbox pauses itself, and a person re-checks
 * the list before it sends again, when:
 *
 * - it collects {@link OUTREACH_PAUSE_BOUNCES_PER_DAY} hard bounces in one
 *   of its own days; or
 * - more than {@link OUTREACH_PAUSE_BOUNCE_RATE} of its last
 *   {@link OUTREACH_BOUNCE_RATE_WINDOW_SENDS} sends hard-bounced, once the
 *   window holds at least {@link OUTREACH_BOUNCE_RATE_MIN_SENDS} of them
 *   (AGL-3244). Under that floor one bounce IS the rate — 1 of 21 is 4.8% —
 *   and a single gateway block on a cold day closed a whole sending window
 *   on the strength of one address. A mailbox with fewer sends is still
 *   judged on the sends it has by the first rule: a second bounce in one
 *   day pauses it whatever the window holds; or
 * - a reply called its email spam in the last week — a complaint is worth a
 *   week of review, and the pause lasts until the week is out.
 *
 * Only hard bounces count. A soft bounce is a full mailbox or a busy server,
 * and the sending server is still retrying it.
 *==========================================*/

/** Hard bounces in one mailbox day that pause the mailbox. */
export const OUTREACH_PAUSE_BOUNCES_PER_DAY = 2

/** How many of the most recent sends the bounce rate is taken over. */
export const OUTREACH_BOUNCE_RATE_WINDOW_SENDS = 50

/** The bounce rate a mailbox may not exceed over that window. */
export const OUTREACH_PAUSE_BOUNCE_RATE = 0.03

/**
 * The fewest sends the window must hold before its bounce rate is judged
 * (AGL-3244). Below it the daily rule alone pauses the mailbox.
 */
export const OUTREACH_BOUNCE_RATE_MIN_SENDS = 25

/** How long a spam complaint keeps a mailbox paused. */
export const OUTREACH_COMPLAINT_PAUSE_MS = 7 * 24 * 60 * 60 * 1000

export type OutreachHealthPauseReason = 'bounces_today' | 'bounce_rate' | 'complaint'

export interface OutreachMailboxHealthInput {
  /** Hard bounces on this mailbox's mail received during its current local day. */
  bouncesToday: number
  /**
   * The mailbox's most recent sends — at most
   * {@link OUTREACH_BOUNCE_RATE_WINDOW_SENDS} of them — and how many of
   * those hard-bounced.
   */
  recentSends: number
  recentHardBounces: number
  /** When a reply last called this mailbox's email spam, or `null`. */
  lastComplaintAtMs?: number | null
  nowMs: number
}

export interface OutreachMailboxHealthDecision {
  pause: boolean
  reason: OutreachHealthPauseReason | null
  /** What the mailbox's page says, in a sentence. */
  message: string | null
  /** For a complaint, when the pause may end; `null` when a person has to resume it. */
  pausedUntilMs: number | null
}

const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

/** Whether a mailbox should pause itself now — see the module note. */
export function decideOutreachMailboxHealth(
  input: OutreachMailboxHealthInput,
): OutreachMailboxHealthDecision {
  const bouncesToday = count(input.bouncesToday)
  if (bouncesToday >= OUTREACH_PAUSE_BOUNCES_PER_DAY) {
    return {
      pause: true,
      reason: 'bounces_today',
      message: `Paused after ${bouncesToday} hard bounces today. Re-check the addresses in your sequences before resuming.`,
      pausedUntilMs: null,
    }
  }
  const sends = Math.min(count(input.recentSends), OUTREACH_BOUNCE_RATE_WINDOW_SENDS)
  const bounces = Math.min(count(input.recentHardBounces), sends)
  if (sends >= OUTREACH_BOUNCE_RATE_MIN_SENDS && bounces / sends > OUTREACH_PAUSE_BOUNCE_RATE) {
    const percent = ((bounces / sends) * 100).toFixed(1)
    return {
      pause: true,
      reason: 'bounce_rate',
      message: `Paused: ${bounces} of the last ${sends} emails hard-bounced (${percent}%). Re-check the addresses in your sequences before resuming.`,
      pausedUntilMs: null,
    }
  }
  const complaintAtMs = input.lastComplaintAtMs
  if (
    typeof complaintAtMs === 'number' &&
    Number.isFinite(complaintAtMs) &&
    input.nowMs < complaintAtMs + OUTREACH_COMPLAINT_PAUSE_MS
  ) {
    return {
      pause: true,
      reason: 'complaint',
      message:
        'Paused for a week after a reply called an email spam. Review who your sequences are reaching.',
      pausedUntilMs: complaintAtMs + OUTREACH_COMPLAINT_PAUSE_MS,
    }
  }
  return { pause: false, reason: null, message: null, pausedUntilMs: null }
}
