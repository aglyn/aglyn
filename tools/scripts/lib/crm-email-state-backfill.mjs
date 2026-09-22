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

// The decisions of `backfill-crm-email-state.mjs` (AGL-3245), pure, so
// `crm-email-state-backfill.test.mjs` can pin them without a database.
//
// The lists the senders consult are keyed by `personKey` — sha256 of the
// normalized address — and carry no address a record could be found by.
// So the backfill goes the other way: it walks every contact and every
// lead, keys each by its own address, and asks the two lists what they
// hold for that key. What they hold becomes the record's `emailState`, by
// the same ranking the live stamp keeps (`email-state.ts`): the stronger
// verdict wins, and a record that already holds it is left alone.

import { createHash } from 'node:crypto'

/** `email-state.ts`'s ranking, restated: a member's mark over every automatic verdict. */
export const EMAIL_STATE_RANK = {
  ok: 0,
  bounced: 1,
  blocked: 2,
  unsubscribed: 3,
  complained: 4,
  do_not_contact: 5,
}

export function normalizeEmail(input) {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320 ? email : null
}

/** `personKey`, restated: sha256 of the normalized address, full hex. */
export function personKey(email) {
  const normalized = normalizeEmail(email)
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null
}

/** A Firestore Timestamp, a number, or a date-like value, as epoch ms; `0` for none. */
export function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  if (value && typeof value.seconds === 'number') return value.seconds * 1000
  const parsed = value ? Date.parse(String(value)) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * The verdict an `emailSuppressions/{key}` row gives, or `null` for a
 * released row. A staff entry is a do-not-contact by a person.
 */
export function stateFromSuppression(row) {
  if (!row || row.releasedAt) return null
  const reason = String(row.reason ?? 'bounce')
  const context = typeof row.context === 'string' && row.context ? row.context : null
  const outreach = context === 'outreach'
  const status = reason === 'complaint' ? 'complained' : reason === 'staff' ? 'do_not_contact' : 'bounced'
  return {
    status,
    atMs: toMs(row.suppressedAt) || toMs(row.createdAt),
    source: reason === 'staff' ? 'member' : outreach ? 'outreach' : 'campaign',
    detail: reason === 'staff' ? 'Suppressed by staff.' : context ? `Reported by the ${context} send.` : null,
  }
}

/** The verdict an `orgs/{orgId}/outreachDoNotContact/{key}` entry gives. */
export function stateFromDoNotContact(entry) {
  if (!entry) return null
  const reason = String(entry.reason ?? 'manual')
  const status =
    reason === 'unsubscribe'
      ? 'unsubscribed'
      : reason === 'hard_bounce'
        ? 'bounced'
        : reason === 'gateway_block'
          ? 'blocked'
          : 'do_not_contact'
  const detail = typeof entry.detail === 'string' && entry.detail ? entry.detail : null
  return {
    status,
    atMs: toMs(entry.addedAtMs),
    source: entry.source === 'member' ? 'member' : 'outreach',
    detail,
    ...(typeof entry.enrollmentId === 'string' && entry.enrollmentId ? { enrollmentId: entry.enrollmentId } : {}),
  }
}

/** The strongest of several verdicts: by rank, then the latest. */
export function strongestState(states) {
  let best = null
  for (const state of states) {
    if (!state) continue
    if (
      !best ||
      EMAIL_STATE_RANK[state.status] > EMAIL_STATE_RANK[best.status] ||
      (EMAIL_STATE_RANK[state.status] === EMAIL_STATE_RANK[best.status] && state.atMs > best.atMs)
    ) {
      best = state
    }
  }
  return best
}

/** A stored `emailState`, held to its shape, or `null`. */
export function readState(record) {
  const raw = record?.emailState
  if (!raw || typeof raw !== 'object' || !(raw.status in EMAIL_STATE_RANK)) return null
  return {
    status: raw.status,
    atMs: toMs(raw.atMs),
    source: raw.source === 'outreach' || raw.source === 'member' ? raw.source : 'campaign',
    detail: typeof raw.detail === 'string' && raw.detail ? raw.detail : null,
    ...(typeof raw.enrollmentId === 'string' && raw.enrollmentId ? { enrollmentId: raw.enrollmentId } : {}),
  }
}

/**
 * What one record should hold after the lists have spoken: the write to
 * make, or `null` when the record already holds a verdict as strong or
 * the lists hold nothing for it.
 */
export function planRecordEmailState({ record, suppression, doNotContact }) {
  const incoming = strongestState([stateFromSuppression(suppression), stateFromDoNotContact(doNotContact)])
  if (!incoming) return null
  const current = readState(record)
  if (current && EMAIL_STATE_RANK[current.status] > EMAIL_STATE_RANK[incoming.status]) return null
  if (
    current &&
    current.status === incoming.status &&
    current.atMs === incoming.atMs &&
    current.source === incoming.source &&
    current.detail === incoming.detail
  ) {
    return null
  }
  return incoming
}
