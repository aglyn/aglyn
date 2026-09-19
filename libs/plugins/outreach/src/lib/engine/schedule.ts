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
 * WHEN A STEP COMES DUE (AGL-2979).
 *
 * A step waits a number of BUSINESS days after the one before it, counted on
 * the mailbox's own calendar — the rep's Monday, not the server's — and then
 * waits again, if it has to, for the sending window to open. So a follow-up
 * two business days after a Friday 16:40 send is due Tuesday at about 16:40,
 * and one that lands on a Saturday or after hours goes out at the next
 * opening instead.
 *
 * ## Jitter
 *
 * Every due time moves by up to half of {@link OUTREACH_DUE_JITTER_MINUTES}
 * either way, drawn from an injected random source, and never out of the
 * window it was placed in. A person does not answer every follow-up at the
 * same minute, and a mailbox whose mail leaves on the dot reads like the
 * software it is. A time that had to be moved to an opening only moves later,
 * so a morning's worth of follow-ups is spread over the first hour rather
 * than stacked on the opening minute.
 *
 * The random source is a parameter so a test can pin it and so nothing here
 * reads a clock or a global.
 *==========================================*/

import {
  addZonedBusinessDays,
  isValidTimeZone,
  isWithinWeeklySchedule,
  nextWeeklyOpening,
  type WeeklySchedule,
} from '@aglyn/shared-util-timestamp/zoned-time'
import type { OutreachSendWindow } from '../model/outreach.types'

/** How far a due time may move, in total: half of it either way. */
export const OUTREACH_DUE_JITTER_MINUTES = 60

/**
 * How long an out-of-office reply holds the next step back, in business
 * days — a working week, the usual length of an absence — measured from
 * when the reply arrived. A step already due later than that keeps its time.
 */
export const OUTREACH_AUTO_REPLY_POSTPONE_BUSINESS_DAYS = 5

/** A source of numbers in `[0, 1)`, such as `Math.random`. */
export type OutreachRandom = () => number

const MINUTE_MS = 60_000

/** A send window as the weekly schedule the zone math reads. */
export function outreachWindowSchedule(
  window: OutreachSendWindow | null | undefined,
): WeeklySchedule {
  const schedule: Record<number, { start: number; end: number }[]> = {}
  if (!window || !Array.isArray(window.days)) return schedule
  for (const day of window.days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      schedule[day] = [{ start: window.startMinute, end: window.endMinute }]
    }
  }
  return schedule
}

/** The window a sequence's steps go out in: its own, or else its mailbox's. */
export function effectiveOutreachWindow(
  sequenceWindow: OutreachSendWindow | null | undefined,
  mailboxWindow: OutreachSendWindow | null | undefined,
): OutreachSendWindow | null {
  return sequenceWindow ?? mailboxWindow ?? null
}

/** Whether `atMs` is inside the window, read in `timeZone`. */
export function isOutreachWindowOpen(
  atMs: number,
  window: OutreachSendWindow | null | undefined,
  timeZone: string,
): boolean {
  if (!isValidTimeZone(timeZone)) return false
  return isWithinWeeklySchedule(atMs, outreachWindowSchedule(window), timeZone)
}

function draw(random: OutreachRandom | null | undefined): number {
  const value = typeof random === 'function' ? random() : 0.5
  if (!Number.isFinite(value)) return 0.5
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON)
}

export interface OutreachDueInput {
  /** The instant the wait is counted from: the last step's send, or the enrollment. */
  fromMs: number
  delayBusinessDays: number
  /** The mailbox's IANA zone. */
  timeZone: string
  /** The window the step goes out in — {@link effectiveOutreachWindow}. */
  window: OutreachSendWindow | null | undefined
  random: OutreachRandom
  /** Defaults to {@link OUTREACH_DUE_JITTER_MINUTES}; `0` places the time exactly. */
  jitterMinutes?: number
}

/**
 * When a step comes due — see the module note — or `null` when it never
 * can: a zone `Intl` does not know, a delay that is not a whole number of
 * days, or a window that never opens.
 */
export function scheduleOutreachDue(input: OutreachDueInput): number | null {
  const { fromMs, timeZone } = input
  if (!Number.isFinite(fromMs) || !isValidTimeZone(timeZone)) return null
  const delay = input.delayBusinessDays
  if (!Number.isInteger(delay) || delay < 0) return null
  const base = addZonedBusinessDays(fromMs, delay, timeZone)
  const opening = nextWeeklyOpening(base, outreachWindowSchedule(input.window), timeZone)
  if (!opening) return null
  const jitterMs = Math.max(0, input.jitterMinutes ?? OUTREACH_DUE_JITTER_MINUTES) * MINUTE_MS
  const lastMs = opening.endMs - 1
  if (opening.startMs > base) {
    const span = Math.min(jitterMs, lastMs - opening.startMs)
    return opening.startMs + Math.floor(draw(input.random) * span)
  }
  const shifted = base + Math.round((draw(input.random) - 0.5) * jitterMs)
  return Math.min(lastMs, Math.max(opening.startMs, shifted))
}

export interface OutreachAutoReplyPostponeInput {
  /** The enrollment's `nextDueAtMs`; `null` has nothing waiting to hold back. */
  nextDueAtMs: number | null
  /** When the automatic reply arrived. */
  receivedAtMs: number
  timeZone: string
  window: OutreachSendWindow | null | undefined
  random: OutreachRandom
  businessDays?: number
}

/**
 * The due time after an out-of-office reply: at least
 * {@link OUTREACH_AUTO_REPLY_POSTPONE_BUSINESS_DAYS} business days after the
 * reply, never earlier than the step was already due. An automatic reply
 * says the person is away, not that they answered, so the enrollment waits
 * and does not stop.
 */
export function postponeOutreachForAutoReply(
  input: OutreachAutoReplyPostponeInput,
): number | null {
  if (input.nextDueAtMs === null || !Number.isFinite(input.nextDueAtMs)) return null
  const postponed = scheduleOutreachDue({
    fromMs: input.receivedAtMs,
    delayBusinessDays: input.businessDays ?? OUTREACH_AUTO_REPLY_POSTPONE_BUSINESS_DAYS,
    timeZone: input.timeZone,
    window: input.window,
    random: input.random,
  })
  return postponed === null ? input.nextDueAtMs : Math.max(input.nextDueAtMs, postponed)
}
