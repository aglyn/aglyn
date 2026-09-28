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
 * WHAT "NEXT SEND" MEANS ONCE THE TIME HAS COME (AGL-3366).
 *
 * An enrollment's `nextDueAtMs` is the earliest it may go, not when it
 * goes. The runtime sends a mailbox's share of the day each run (see
 * `./sending-capacity`), follow-ups first, so on a busy morning a first
 * email can stay due for an hour or more. A past timestamp in that state
 * reads as a send that failed; what it is, is a place in a queue.
 *
 * So a due, active enrollment is described by why it is still waiting:
 * paced across the window, waiting for the window to open, over today's
 * cap, or held because its mailbox or sequence is not sending. No "sends
 * by" time is projected: the order is decided across every sequence on the
 * mailbox, which no one page of enrollments can see.
 *==========================================*/

import { isValidTimeZone, nextWeeklyOpening, zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import type {
  OutreachEnrollment,
  OutreachMailbox,
  OutreachSequence,
} from '../model/outreach.types'
import { effectiveOutreachWindow, isOutreachWindowOpen, outreachWindowSchedule } from './schedule'
import { outreachTickAllowance, type OutreachTickAllowance } from './sending-capacity'

/** Why a due enrollment has not gone yet. */
export type OutreachQueuedReason =
  /** Its turn comes in a later run: the day's cap is spread over the window. */
  | 'paced'
  /** A task step, which the next run turns into a CRM task. */
  | 'next_run'
  /** The send window is closed; it goes when the window next opens. */
  | 'window_closed'
  /** The mailbox has sent its cap for today. */
  | 'daily_cap_reached'
  /** The mailbox is missing, paused or disconnected: nothing sends. */
  | 'mailbox_not_sending'
  /** The sequence is not active: nothing sends. */
  | 'sequence_not_active'

export type OutreachNextSendState =
  | { kind: 'none' }
  | { kind: 'scheduled'; dueAtMs: number }
  | {
      kind: 'queued'
      dueAtMs: number
      reason: OutreachQueuedReason
      /** When the window it waits for next opens, for the two reasons that wait on one. */
      opensAtMs: number | null
      /** The mailbox's allowance this run, when the mailbox is known and sending. */
      pacing: Pick<OutreachTickAllowance, 'allowance' | 'dailyCap' | 'sentToday'> | null
    }

export interface OutreachNextSendInput {
  enrollment: Pick<OutreachEnrollment, 'status' | 'nextDueAtMs' | 'stopReason' | 'stepIndex'>
  /** The enrollment's sequence; omitted when the reader does not have it. */
  sequence?: Pick<OutreachSequence, 'status' | 'steps' | 'settings'> | null
  /**
   * The enrollment's mailbox: `undefined` while it is still loading, which
   * reads as "paced" without figures, and `null` when there is none.
   */
  mailbox: Pick<
    OutreachMailbox,
    'status' | 'dailyCap' | 'rampStartedAtMs' | 'timezone' | 'window' | 'health'
  > | null | undefined
  nowMs: number
}

/**
 * The first opening of the window on a later local day than `nowMs`'s —
 * when a mailbox that has spent today's cap sends again.
 */
function openingOnALaterDay(
  nowMs: number,
  schedule: ReturnType<typeof outreachWindowSchedule>,
  timeZone: string,
): number | null {
  const today = zonedDayKey(nowMs, timeZone)
  let atMs = nowMs
  for (let guard = 0; guard < 16; guard += 1) {
    const opening = nextWeeklyOpening(atMs, schedule, timeZone)
    if (!opening) return null
    if (opening.startMs > nowMs && zonedDayKey(opening.startMs, timeZone) !== today) {
      return opening.startMs
    }
    atMs = opening.endMs
  }
  return null
}

/** What an enrollment's "Next send" says — see the module note. */
export function outreachNextSendState(input: OutreachNextSendInput): OutreachNextSendState {
  const { enrollment, sequence, mailbox, nowMs } = input
  const due = enrollment.nextDueAtMs
  if (enrollment.status !== 'active' && enrollment.status !== 'paused') return { kind: 'none' }
  if (typeof due !== 'number' || !Number.isFinite(due)) return { kind: 'none' }
  if (enrollment.status === 'paused' || enrollment.stopReason || due > nowMs) {
    return { kind: 'scheduled', dueAtMs: due }
  }
  const queued = (
    reason: OutreachQueuedReason,
    opensAtMs: number | null = null,
    pacing: OutreachTickAllowance | null = null,
  ): OutreachNextSendState => ({
    kind: 'queued',
    dueAtMs: due,
    reason,
    opensAtMs,
    pacing: pacing
      ? { allowance: pacing.allowance, dailyCap: pacing.dailyCap, sentToday: pacing.sentToday }
      : null,
  })

  if (sequence && sequence.status !== 'active') return queued('sequence_not_active')
  if (mailbox === undefined) return queued('paced')
  if (!mailbox || mailbox.status !== 'connected' || !isValidTimeZone(mailbox.timezone)) {
    return queued('mailbox_not_sending')
  }
  const step = sequence?.steps?.[enrollment.stepIndex]
  if (step?.kind === 'task') return queued('next_run')

  const window = effectiveOutreachWindow(sequence?.settings?.window, mailbox.window)
  const schedule = outreachWindowSchedule(window)
  const allowance = outreachTickAllowance({ mailbox, nowMs })
  if (allowance.hold === 'daily_cap_reached') {
    return queued('daily_cap_reached', openingOnALaterDay(nowMs, schedule, mailbox.timezone), allowance)
  }
  if (!isOutreachWindowOpen(nowMs, window, mailbox.timezone)) {
    const opening = nextWeeklyOpening(nowMs, schedule, mailbox.timezone)
    return queued('window_closed', opening?.startMs ?? null, allowance)
  }
  return queued('paced', null, allowance)
}
