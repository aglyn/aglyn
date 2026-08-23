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
 * WHY a staff subscription refund was issued (AGL-2486).
 *
 * Refunds could only be done in the Stripe dashboard, which means the only
 * record of one was Stripe's — an actor, an amount, and no rationale that
 * Aglyn's own audit trail could show. That is the same gap AGL-1652 closed
 * for org overrides, and this borrows its shape deliberately: a `reason` code
 * from a fixed set plus an optional free-text `note`, so an operator reading
 * `adminAudit` reads the same two fields whichever staff action wrote the
 * row.
 *
 * The vocabulary is NOT borrowed. An override reason describes a commercial
 * decision about entitlements; a refund reason has to answer "why did money
 * go back", which is asked during a chargeback response, a tax reconciliation
 * or a churn review — three readers an override code cannot serve.
 *
 * A code rather than a required text box, for AGL-1652's reason: a mandatory
 * free-text field is defeated by typing "x", and a set small enough to read
 * as a distribution across a quarter is worth more than a box that can be.
 * `other` is the escape hatch that stops staff picking the nearest wrong
 * code, and is therefore the one code that requires the note.
 */
export type RefundReasonCode =
  | 'duplicate'
  | 'billing-error'
  | 'service-failure'
  | 'goodwill'
  | 'cancellation'
  | 'fraud'
  | 'other'

const REFUND_REASON_KEYS: Record<RefundReasonCode, true> = {
  duplicate: true,
  'billing-error': true,
  'service-failure': true,
  goodwill: true,
  cancellation: true,
  fraud: true,
  other: true,
}

export const REFUND_REASON_CODES = Object.keys(
  REFUND_REASON_KEYS,
) as RefundReasonCode[]

export function isRefundReasonCode(value: unknown): value is RefundReasonCode {
  return typeof value === 'string' && value in REFUND_REASON_KEYS
}

/** Staff-surface labels; the key stays the wire and audit identity. */
export const REFUND_REASON_LABELS: Record<RefundReasonCode, string> = {
  duplicate: 'Duplicate charge',
  'billing-error': 'Billing error on our side',
  'service-failure': 'Outage or service failure',
  goodwill: 'Goodwill or retention',
  cancellation: 'Cancellation — unused period',
  fraud: 'Fraudulent or unauthorized charge',
  other: 'Other — say what, below',
}

/** Internal staff rationale — never shown to the customer. */
export const REFUND_NOTE_MAX = 1000

/**
 * Does this code mean nothing without a note? Only `other`.
 *
 * A predicate rather than an inline `=== 'other'` so the dialog's confirm
 * gate and the route's server-side gate agree by construction — the money
 * moves on the server, and a client-only check is decoration.
 */
export function refundReasonNeedsNote(code: RefundReasonCode): boolean {
  return code === 'other'
}

/**
 * The complete, validated reason for the audit row, or null.
 *
 * Returning null for an unusable pair — no code, or `other` with an empty
 * note — makes the reason a BOUNDARY rather than a suggestion: the route
 * refuses before it reaches Stripe, so there is no path that moves money and
 * then discovers the record is blank.
 */
export function normalizeRefundReason(
  code: unknown,
  note: unknown,
): { reason: RefundReasonCode; note: string } | null {
  if (!isRefundReasonCode(code)) return null
  const text = typeof note === 'string' ? note.trim().slice(0, REFUND_NOTE_MAX) : ''
  if (refundReasonNeedsNote(code) && text.length === 0) return null
  return { reason: code, note: text }
}
