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

import { isValidTimeZone, zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  OUTREACH_DAILY_CAP_MAX,
  OUTREACH_RAMP_DAILY_CAPS,
  outreachDailyCap,
} from '../engine/sending-capacity'
import type {
  OutreachMailbox,
  OutreachMailboxHealth,
  OutreachMailboxStatus,
  OutreachSendAsAddress,
  OutreachSendWindow,
} from '../model/outreach.types'

/**
 * A MAILBOX'S SETTINGS, AS BOTH HALVES READ THEM (AGL-2978).
 *
 * The rules a mailbox's settings are held to — the cap, the ramp, the sending
 * window, the timezone, which send-as addresses count — in one client-safe
 * module, so the panel that greys out a field and the route that refuses the
 * write give the same answer.
 *
 * The ceiling, the ramp and a mailbox's day are the engine's
 * (`../engine/sending-capacity.ts`, AGL-2979) and the shared zoned-time
 * helpers': the panel shows today's limit with the very function the sending
 * runtime enforces it with, so the two cannot drift.
 */

/** The daily cap a new mailbox starts with. */
export const OUTREACH_DEFAULT_DAILY_CAP = 20

/** The most a mailbox may send in one day, whatever it is set to: the engine's ceiling. */
export const OUTREACH_MAX_DAILY_CAP = OUTREACH_DAILY_CAP_MAX

/**
 * The warm-up ramp, as the panel prints it: the most a mailbox sends a day in
 * its first week, its second, and every week after — the engine's
 * `OUTREACH_RAMP_DAILY_CAPS`. The cap still applies on top, so a mailbox
 * capped at 20 sends 20 in week three, not 30.
 */
export const OUTREACH_RAMP_STEPS: ReadonlyArray<{ week: number; limit: number }> =
  OUTREACH_RAMP_DAILY_CAPS.map((limit, index) => ({ week: index + 1, limit }))

/** Mon–Fri, 9:00 to 17:00 — the window a new mailbox starts with. */
export const OUTREACH_DEFAULT_WINDOW: OutreachSendWindow = {
  days: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}

/** How many mailboxes one member may connect in one organization. */
export const OUTREACH_MAX_MAILBOXES_PER_MEMBER = 5

/** The longest From name accepted. */
export const OUTREACH_DISPLAY_NAME_MAX = 100

/** Day labels, `0` Sunday, as the window's `days` count them. */
export const OUTREACH_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Today's limit: the cap, lowered by the ramp while it runs — the engine's
 * `outreachDailyCap`, read in the mailbox's zone (UTC for one it does not
 * know), with the stored cap read defensively first.
 */
export function outreachEffectiveDailyCap(
  mailbox: Pick<OutreachMailbox, 'dailyCap' | 'rampStartedAtMs' | 'timezone'>,
  nowMs: number,
): number {
  return outreachDailyCap({
    configuredCap: clampDailyCap(mailbox.dailyCap),
    rampStartedAtMs: mailbox.rampStartedAtMs,
    nowMs,
    timeZone: isValidTimezone(mailbox.timezone) ? mailbox.timezone : 'UTC',
  })
}

/** A stored cap read defensively: an integer from 1 to the maximum. */
export function clampDailyCap(value: unknown): number {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number) || number < 1) return OUTREACH_DEFAULT_DAILY_CAP
  return Math.min(number, OUTREACH_MAX_DAILY_CAP)
}

/** Why a settings value was refused, in the words the panel shows. */
export type OutreachSettingsRefusal = { field: string; message: string }

/** A cap as typed: a whole number from 1 to 50, or a refusal. */
export function validateDailyCap(value: unknown): number | OutreachSettingsRefusal {
  const number = typeof value === 'number' ? value : Number.NaN
  if (!Number.isInteger(number) || number < 1 || number > OUTREACH_MAX_DAILY_CAP) {
    return {
      field: 'dailyCap',
      message: `The daily cap must be a whole number from 1 to ${OUTREACH_MAX_DAILY_CAP}.`,
    }
  }
  return number
}

/** A window as sent: days 0–6 at least once, whole minutes, start before end. */
export function validateSendWindow(value: unknown): OutreachSendWindow | OutreachSettingsRefusal {
  const record = (value ?? {}) as Partial<OutreachSendWindow>
  const days = Array.isArray(record.days) ? record.days : []
  const unique = [...new Set(days)]
  if (!unique.length || !unique.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
    return { field: 'window', message: 'Choose at least one day to send on.' }
  }
  const start = Number(record.startMinute)
  const end = Number(record.endMinute)
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > 24 * 60 ||
    start >= end
  ) {
    return { field: 'window', message: 'The sending window must start before it ends, within one day.' }
  }
  return { days: unique.sort((a, b) => a - b), startMinute: start, endMinute: end }
}

/** Whether a string names an IANA timezone this runtime knows, of a sane length to store. */
export function isValidTimezone(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && isValidTimeZone(value)
}

/** Whether text holds a character below space, or DEL — a line break included. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

/** A From name as typed: one line, not too long, or a refusal. */
export function validateDisplayName(value: unknown): string | OutreachSettingsRefusal {
  const name = typeof value === 'string' ? value.trim() : ''
  if (hasControlCharacter(name) || name.length > OUTREACH_DISPLAY_NAME_MAX) {
    return {
      field: 'displayName',
      message: `The display name must be one line of at most ${OUTREACH_DISPLAY_NAME_MAX} characters.`,
    }
  }
  return name
}

/** `9:00`, `17:30`, `24:00` — a minute of the day as the panel prints it. */
export function formatMinuteOfDay(minute: number): string {
  const hours = Math.floor(minute / 60)
  return `${hours}:${String(minute % 60).padStart(2, '0')}`
}

/** A status as the panel names it. */
export const OUTREACH_MAILBOX_STATUS_LABELS: Record<OutreachMailboxStatus, string> = {
  connected: 'Active',
  paused: 'Paused',
  reconnect_required: 'Reconnect required',
  disconnected: 'Disconnected',
}

/**
 * `YYYY-MM-DD` for an instant, in a timezone (UTC for an unknown one) — the
 * day key the sending runtime counts a mailbox's sends under.
 */
export function outreachLocalDay(nowMs: number, timezone: string): string {
  return zonedDayKey(nowMs, isValidTimezone(timezone) ? timezone : 'UTC')
}

/** The seven mailbox-local days ending today, newest first. */
export function outreachLastSevenDays(nowMs: number, timezone: string): string[] {
  const days: string[] = []
  // Stepping by whole days in UTC and formatting in the zone can repeat or
  // skip a day across a DST change, so collect distinct days until seven.
  for (let offset = 0; days.length < 7 && offset < 9; offset += 1) {
    const day = outreachLocalDay(nowMs - offset * 24 * 60 * 60 * 1000, timezone)
    if (!days.includes(day)) days.push(day)
  }
  return days
}

/** The last seven days of sending, summed, and whether anything was ever sent. */
export interface OutreachHealthSummary {
  sent: number
  bounces: number
  replies: number
  /** False until the mailbox's first send: the panel says "No sends yet". */
  hasSent: boolean
}

export function summarizeMailboxHealth(
  health: Partial<OutreachMailboxHealth> | null | undefined,
  timezone: string,
  nowMs: number,
): OutreachHealthSummary {
  const daily = health?.daily ?? {}
  const summary = { sent: 0, bounces: 0, replies: 0 }
  for (const day of outreachLastSevenDays(nowMs, timezone)) {
    const counts = daily[day]
    if (!counts) continue
    summary.sent += Math.max(0, Number(counts.sent) || 0)
    summary.bounces += Math.max(0, Number(counts.bounces) || 0)
    summary.replies += Math.max(0, Number(counts.replies) || 0)
  }
  const everSent =
    typeof health?.lastSentAtMs === 'number' ||
    Object.values(daily).some((counts) => Number(counts?.sent) > 0)
  return { ...summary, hasSent: everSent }
}

/** Gmail's send-as entry, as the transport reads it. */
export interface SendAsListing {
  sendAsEmail: string
  displayName: string
  isPrimary: boolean
  isDefault: boolean
  verificationStatus: string | null
}

/**
 * The send-as addresses a mailbox may offer: the account's own address, and
 * every alias Gmail marks `accepted`. A `pending` alias is one Gmail is still
 * waiting for its owner to confirm, and sending as it would be sending as an
 * address nobody has shown is theirs.
 */
export function verifiedSendAsAddresses(listing: readonly SendAsListing[]): OutreachSendAsAddress[] {
  const seen = new Set<string>()
  const addresses: OutreachSendAsAddress[] = []
  for (const entry of listing) {
    const email = String(entry.sendAsEmail ?? '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    if (!entry.isPrimary && entry.verificationStatus !== 'accepted') continue
    seen.add(email)
    addresses.push({
      email,
      displayName: String(entry.displayName ?? '').trim(),
      isPrimary: Boolean(entry.isPrimary),
      isDefault: Boolean(entry.isDefault),
    })
  }
  return addresses
}

/** The send-as a new mailbox starts with: Gmail's default, else its own address. */
export function defaultSendAs(options: readonly OutreachSendAsAddress[], accountEmail: string): string {
  return (
    options.find((option) => option.isDefault)?.email ??
    options.find((option) => option.isPrimary)?.email ??
    accountEmail
  )
}
