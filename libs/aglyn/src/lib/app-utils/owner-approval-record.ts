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
 * THE OWNER'S RECORDED YES (AGL-3959).
 *
 * Paid work beyond what a subscription includes is billed only after the
 * owner agreed to it, and the owner never clicks anything in the console to
 * agree: they say yes to a person — at the booth, on the phone, by text or by
 * email — and STAFF record how and when. Saving the record emails the owner a
 * confirmation, and that email is the written record.
 *
 * This module is the record's shape and its rules, with no Firestore and no
 * product in it, so any staff surface that bills by an approval reads it the
 * same way: Site Care's extra time first, and the flat-quoted project invoice
 * (AGL-3970) after it. A correction never edits a record in place: it is a
 * new record with `version` one higher, `corrected: true` and the reason, and
 * the old one stays in the request's history.
 */

/** How the owner said yes. */
export const OWNER_APPROVAL_CHANNELS = ['in-person', 'phone', 'text', 'email'] as const

export type OwnerApprovalChannel = (typeof OWNER_APPROVAL_CHANNELS)[number]

/** The channel as a sentence reads it: "by phone", "in person". */
export const OWNER_APPROVAL_CHANNEL_WORDS: Readonly<Record<OwnerApprovalChannel, string>> = {
  'in-person': 'in person',
  phone: 'by phone',
  text: 'by text message',
  email: 'by email',
}

/** The channel as a picker labels it. */
export const OWNER_APPROVAL_CHANNEL_LABELS: Readonly<Record<OwnerApprovalChannel, string>> = {
  'in-person': 'In person',
  phone: 'Phone call',
  text: 'Text message',
  email: 'Email',
}

/** The longest approval an hourly record may carry, in hours. */
export const OWNER_APPROVAL_MAX_HOURS = 40

/** The longest note or reason a record keeps. */
export const OWNER_APPROVAL_NOTE_MAX = 500

/** One recorded yes. Written by staff, read by the close and the emails. */
export interface OwnerApprovalRecord {
  /** Whole hours the owner agreed to, at most. */
  hours: number
  /** The published hourly rate the owner agreed to, in whole dollars. */
  rateUsd: number
  channel: OwnerApprovalChannel
  /** When the owner said yes, epoch ms. */
  approvedAtMs: number
  /** When staff recorded it, epoch ms. */
  recordedAtMs: number
  recordedByUid: string
  recordedByEmail: string | null
  /** What the owner said yes to, in staff's words; optional. */
  note: string | null
  /** 1 for the first record; each correction is one higher. */
  version: number
  /** True on every record after the first. */
  corrected: boolean
  /** Why it was corrected; required when `corrected`. */
  correctionReason: string | null
}

export type OwnerApprovalInputResult =
  | { ok: true; record: OwnerApprovalRecord }
  | { ok: false; error: string }

/** A trimmed, bounded string, or null when blank. */
function cleanText(value: unknown, max: number): string | null {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : ''
  return text ? text : null
}

/**
 * Reads what staff typed into a record, refusing anything the record cannot
 * honestly say. `previous` is the record it corrects, when there is one: a
 * correction needs a reason, and the reason is what the history and the
 * re-sent confirmation say changed.
 */
export function readOwnerApprovalInput(
  raw: Readonly<Record<string, unknown>> | null | undefined,
  context: {
    rateUsd: number
    nowMs: number
    by: { uid: string; email: string | null }
    previous?: OwnerApprovalRecord | null
    /**
     * The most hours the record may carry; `OWNER_APPROVAL_MAX_HOURS` unless
     * the surface says otherwise. A flat-quoted project (AGL-3970) records
     * the quote's own whole hours, which a redesign can take past a week.
     */
    maxHours?: number
  },
): OwnerApprovalInputResult {
  const hours = Number(raw?.['hours'])
  const maxHours = context.maxHours ?? OWNER_APPROVAL_MAX_HOURS
  if (!Number.isInteger(hours) || hours < 1 || hours > maxHours) {
    return {
      ok: false,
      error: `Enter the hours the owner approved, a whole number from 1 to ${maxHours}.`,
    }
  }
  const channel = String(raw?.['channel'] ?? '') as OwnerApprovalChannel
  if (!OWNER_APPROVAL_CHANNELS.includes(channel)) {
    return { ok: false, error: 'Choose how the owner said yes.' }
  }
  const approvedAtMs = Number(raw?.['approvedAtMs'])
  if (!Number.isFinite(approvedAtMs) || approvedAtMs <= 0) {
    return { ok: false, error: 'Enter when the owner said yes.' }
  }
  // A minute of clock skew is allowed; a yes recorded for tomorrow is not one
  // anybody has heard yet.
  if (approvedAtMs > context.nowMs + 60_000) {
    return { ok: false, error: 'The owner’s yes cannot be in the future.' }
  }
  const previous = context.previous ?? null
  const correctionReason = cleanText(raw?.['reason'], OWNER_APPROVAL_NOTE_MAX)
  if (previous && !correctionReason) {
    return { ok: false, error: 'Say why the approval is being corrected.' }
  }
  return {
    ok: true,
    record: {
      hours,
      rateUsd: context.rateUsd,
      channel,
      approvedAtMs: Math.floor(approvedAtMs),
      recordedAtMs: context.nowMs,
      recordedByUid: context.by.uid,
      recordedByEmail: context.by.email,
      note: cleanText(raw?.['note'], OWNER_APPROVAL_NOTE_MAX),
      version: previous ? Math.max(1, Number(previous.version) || 1) + 1 : 1,
      corrected: Boolean(previous),
      correctionReason: previous ? correctionReason : null,
    },
  }
}

/** A stored record read back defensively, or null when it is not one. */
export function readOwnerApprovalRecord(value: unknown): OwnerApprovalRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<OwnerApprovalRecord>
  const hours = Number(record.hours)
  if (!Number.isInteger(hours) || hours < 1) return null
  if (!OWNER_APPROVAL_CHANNELS.includes(record.channel as OwnerApprovalChannel)) return null
  return {
    hours,
    rateUsd: Number(record.rateUsd) || 0,
    channel: record.channel as OwnerApprovalChannel,
    approvedAtMs: Number(record.approvedAtMs) || 0,
    recordedAtMs: Number(record.recordedAtMs) || 0,
    recordedByUid: String(record.recordedByUid ?? ''),
    recordedByEmail: record.recordedByEmail ?? null,
    note: record.note ?? null,
    version: Number(record.version) || 1,
    corrected: record.corrected === true,
    correctionReason: record.correctionReason ?? null,
  }
}

/** "2 hours", "1 hour". */
export function describeHours(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/**
 * The confirmation's one sentence, in the owner's words: what they agreed
 * to, how and when.
 */
export function ownerApprovalSentence(
  record: Pick<OwnerApprovalRecord, 'hours' | 'rateUsd' | 'channel' | 'approvedAtMs'>,
  what: string,
  formatDate: (ms: number) => string,
): string {
  return (
    `You approved up to ${describeHours(record.hours)} of extra time at ` +
    `$${record.rateUsd} an hour for “${what}”, ` +
    `${OWNER_APPROVAL_CHANNEL_WORDS[record.channel]} on ${formatDate(record.approvedAtMs)}.`
  )
}
