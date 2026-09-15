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
 * HOW MUCH A MAILBOX MAY SEND (AGL-2979).
 *
 * ## The daily cap
 *
 * A mailbox sends at most the least of three numbers in one of its own
 * days: the cap its owner configured; the warm-up ramp — 10 a day in its
 * first week, 20 in its second, 30 from its third — while a ramp is running;
 * and {@link OUTREACH_DAILY_CAP_MAX}, which nothing lifts. Mailbox providers
 * judge a new sender by how its volume grows, and a mailbox that goes from
 * nothing to fifty on its first morning is judged accordingly.
 *
 * ## The tick
 *
 * The runtime runs every {@link OUTREACH_TICK_MINUTES} minutes. What is left
 * of the day's cap is spread over the ticks left in the window, so thirty
 * emails go out across the working day rather than in its first half hour,
 * and no tick sends more than {@link OUTREACH_SENDS_PER_TICK_MAX}.
 *
 * ## Which due enrollments go first
 *
 * Follow-ups before first emails: a thread already started is a
 * conversation a delay would break, and a first email can start tomorrow
 * just as well. Then the longest-waiting, then the id, so two runs over the
 * same enrollments agree. One email per address per tick, whatever the data
 * says.
 *==========================================*/

import {
  isValidTimeZone,
  nextWeeklyOpening,
  zonedCalendarDaysBetween,
  zonedDayKey,
} from '@aglyn/shared-util-timestamp/zoned-time'
import type {
  OutreachEnrollment,
  OutreachMailbox,
  OutreachSendWindow,
  OutreachSequence,
} from '../model/outreach.types'
import { effectiveOutreachWindow, isOutreachWindowOpen, outreachWindowSchedule } from './schedule'
import { firstEmailStepIndex } from './sequence-validation'

/** The ramp's daily caps: week one, week two, and every week after. */
export const OUTREACH_RAMP_DAILY_CAPS: readonly number[] = [10, 20, 30]

/** The most any mailbox sends in one day, whatever is configured. */
export const OUTREACH_DAILY_CAP_MAX = 50

/** How often the sending runtime runs, in minutes. */
export const OUTREACH_TICK_MINUTES = 15

/** The most one mailbox sends in one run. */
export const OUTREACH_SENDS_PER_TICK_MAX = 5

const MINUTE_MS = 60_000

/**
 * The ramp's cap for the day `nowMs` falls in, or `null` when no ramp is
 * running. Weeks are counted in calendar days of the mailbox's zone from the
 * day the ramp began, which is day one of week one; a start in the future
 * reads as week one.
 */
export function outreachRampCap(
  rampStartedAtMs: number | null | undefined,
  nowMs: number,
  timeZone: string,
): number | null {
  if (typeof rampStartedAtMs !== 'number' || !Number.isFinite(rampStartedAtMs)) return null
  const days = zonedCalendarDaysBetween(rampStartedAtMs, nowMs, timeZone)
  const week = Math.max(0, Math.floor(days / 7))
  return OUTREACH_RAMP_DAILY_CAPS[Math.min(week, OUTREACH_RAMP_DAILY_CAPS.length - 1)]
}

/** The day's cap: the least of the configured cap, the ramp and the ceiling. */
export function outreachDailyCap(input: {
  configuredCap: number
  rampStartedAtMs: number | null | undefined
  nowMs: number
  timeZone: string
}): number {
  const configured = Number.isFinite(input.configuredCap)
    ? Math.max(0, Math.floor(input.configuredCap))
    : 0
  const ramp = outreachRampCap(input.rampStartedAtMs, input.nowMs, input.timeZone)
  return Math.min(configured, ramp ?? OUTREACH_DAILY_CAP_MAX, OUTREACH_DAILY_CAP_MAX)
}

/**
 * How many emails the mailbox has sent today: its counter when the counter
 * belongs to today in the mailbox's zone, and `0` when it belongs to an
 * earlier day.
 */
export function outreachSentToday(
  health: Pick<OutreachMailbox['health'], 'sentToday' | 'sentOnDay'> | null | undefined,
  nowMs: number,
  timeZone: string,
): number {
  if (!health || health.sentOnDay !== zonedDayKey(nowMs, timeZone)) return 0
  const sent = Number(health.sentToday)
  return Number.isFinite(sent) ? Math.max(0, Math.floor(sent)) : 0
}

/** Why a mailbox may send nothing this run. */
export type OutreachTickHold = 'mailbox_not_connected' | 'invalid_timezone' | 'daily_cap_reached'

export interface OutreachTickAllowanceInput {
  mailbox: Pick<
    OutreachMailbox,
    'status' | 'dailyCap' | 'rampStartedAtMs' | 'timezone' | 'window' | 'health'
  >
  nowMs: number
  /**
   * The window the day's sends are spread across. The mailbox's own by
   * default; when it is closed but a sequence's own window is open, the
   * remainder is not paced and only the per-run maximum holds.
   */
  paceWindow?: OutreachSendWindow | null
  tickMinutes?: number
  perTickMax?: number
}

export interface OutreachTickAllowance {
  /** How many emails this run may send from the mailbox. */
  allowance: number
  dailyCap: number
  sentToday: number
  remainingToday: number
  /** Why the allowance is zero, when a rule rather than an empty queue made it so. */
  hold: OutreachTickHold | null
}

/** How many emails a mailbox may send in this run — see the module note. */
export function outreachTickAllowance(input: OutreachTickAllowanceInput): OutreachTickAllowance {
  const { mailbox, nowMs } = input
  const none = (hold: OutreachTickHold, dailyCap = 0, sentToday = 0): OutreachTickAllowance => ({
    allowance: 0,
    dailyCap,
    sentToday,
    remainingToday: Math.max(0, dailyCap - sentToday),
    hold,
  })
  if (mailbox?.status !== 'connected') return none('mailbox_not_connected')
  if (!isValidTimeZone(mailbox.timezone)) return none('invalid_timezone')
  const dailyCap = outreachDailyCap({
    configuredCap: mailbox.dailyCap,
    rampStartedAtMs: mailbox.rampStartedAtMs,
    nowMs,
    timeZone: mailbox.timezone,
  })
  const sentToday = outreachSentToday(mailbox.health, nowMs, mailbox.timezone)
  const remainingToday = Math.max(0, dailyCap - sentToday)
  if (remainingToday === 0) return none('daily_cap_reached', dailyCap, sentToday)
  const tickMinutes = Math.max(1, input.tickMinutes ?? OUTREACH_TICK_MINUTES)
  const perTickMax = Math.max(0, Math.floor(input.perTickMax ?? OUTREACH_SENDS_PER_TICK_MAX))
  const paceWindow = input.paceWindow === undefined ? mailbox.window : input.paceWindow
  const opening = nextWeeklyOpening(nowMs, outreachWindowSchedule(paceWindow), mailbox.timezone)
  let paced = remainingToday
  if (opening && opening.startMs <= nowMs) {
    const ticksLeft = Math.max(1, Math.ceil((opening.endMs - nowMs) / (tickMinutes * MINUTE_MS)))
    paced = Math.ceil(remainingToday / ticksLeft)
  }
  return {
    allowance: Math.min(remainingToday, paced, perTickMax),
    dailyCap,
    sentToday,
    remainingToday,
    hold: null,
  }
}

/** One due enrollment beside the sequence it runs through. */
export interface OutreachDueCandidate {
  enrollment: Pick<
    OutreachEnrollment,
    'id' | 'status' | 'nextDueAtMs' | 'stepIndex' | 'email' | 'mailboxId' | 'sequenceId'
  >
  sequence: Pick<OutreachSequence, 'id' | 'status' | 'steps' | 'settings'>
}

export interface OutreachDueSelection {
  /** Email steps to send this run, in the order to send them. */
  emails: OutreachDueCandidate[]
  /** Task steps due now. Each becomes a CRM task; none spends the allowance. */
  tasks: OutreachDueCandidate[]
  /** Email steps that were due inside their window and did not fit this run. */
  deferred: OutreachDueCandidate[]
}

export interface OutreachDueSelectionInput {
  candidates: readonly OutreachDueCandidate[]
  mailbox: Pick<OutreachMailbox, 'id' | 'timezone' | 'window'>
  nowMs: number
  /** {@link outreachTickAllowance}'s `allowance`. */
  allowance: number
}

const byDueThenId = (a: OutreachDueCandidate, b: OutreachDueCandidate) =>
  (a.enrollment.nextDueAtMs ?? 0) - (b.enrollment.nextDueAtMs ?? 0) ||
  (a.enrollment.id < b.enrollment.id ? -1 : a.enrollment.id > b.enrollment.id ? 1 : 0)

/**
 * The due enrollments one mailbox runs now, in order — see the module note.
 * An enrollment is due when it and its sequence are active, it belongs to
 * this mailbox, its time has come, and — for an email — its window is open.
 */
export function selectDueOutreachEnrollments(input: OutreachDueSelectionInput): OutreachDueSelection {
  const { mailbox, nowMs } = input
  const emails: Array<{ candidate: OutreachDueCandidate; followUp: boolean }> = []
  const tasks: OutreachDueCandidate[] = []
  for (const candidate of input.candidates ?? []) {
    const { enrollment, sequence } = candidate ?? ({} as OutreachDueCandidate)
    if (enrollment?.status !== 'active' || sequence?.status !== 'active') continue
    if (enrollment.sequenceId !== sequence.id || enrollment.mailboxId !== mailbox.id) continue
    const due = enrollment.nextDueAtMs
    if (typeof due !== 'number' || !Number.isFinite(due) || due > nowMs) continue
    const step = sequence.steps?.[enrollment.stepIndex]
    if (step?.kind === 'task') {
      tasks.push(candidate)
    } else if (step?.kind === 'email') {
      const window = effectiveOutreachWindow(sequence.settings?.window, mailbox.window)
      if (!isOutreachWindowOpen(nowMs, window, mailbox.timezone)) continue
      emails.push({
        candidate,
        followUp: enrollment.stepIndex > firstEmailStepIndex(sequence.steps),
      })
    }
  }
  emails.sort(
    (a, b) => Number(b.followUp) - Number(a.followUp) || byDueThenId(a.candidate, b.candidate),
  )
  const allowance = Math.max(0, Math.floor(Number(input.allowance) || 0))
  const selected: OutreachDueCandidate[] = []
  const deferred: OutreachDueCandidate[] = []
  const addresses = new Set<string>()
  for (const { candidate } of emails) {
    const address = String(candidate.enrollment.email ?? '').trim().toLowerCase()
    if (selected.length < allowance && !addresses.has(address)) {
      selected.push(candidate)
      addresses.add(address)
    } else {
      deferred.push(candidate)
    }
  }
  return { emails: selected, tasks: tasks.sort(byDueThenId), deferred }
}
