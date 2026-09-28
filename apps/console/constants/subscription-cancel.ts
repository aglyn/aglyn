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
 * The vocabulary of a staff subscription cancellation (AGL-3359), shared by
 * `/api/admin/billing/cancel-subscription`, the lockdown route that calls the
 * same helper, and the two console surfaces that offer it.
 *
 * Same shape as the refund reasons (`refund-reasons.ts`): a code from a fixed
 * set plus a free-text note, so an `adminAudit` reader reads the same two
 * fields whichever money-adjacent staff action wrote the row. `other` is the
 * one code that means nothing without the note.
 */

/** When the subscription stops. `now` never invoices and never prorates. */
export type SubscriptionCancelWhen = 'now' | 'period_end'

export function isSubscriptionCancelWhen(
  value: unknown,
): value is SubscriptionCancelWhen {
  return value === 'now' || value === 'period_end'
}

export type SubscriptionCancelReasonCode =
  | 'fraud'
  | 'security'
  | 'abuse'
  | 'customer-request'
  | 'other'

const REASON_KEYS: Record<SubscriptionCancelReasonCode, true> = {
  fraud: true,
  security: true,
  abuse: true,
  'customer-request': true,
  other: true,
}

export const SUBSCRIPTION_CANCEL_REASON_CODES = Object.keys(
  REASON_KEYS,
) as SubscriptionCancelReasonCode[]

export function isSubscriptionCancelReasonCode(
  value: unknown,
): value is SubscriptionCancelReasonCode {
  return typeof value === 'string' && value in REASON_KEYS
}

/** Staff-surface labels; the key stays the wire and audit identity. */
export const SUBSCRIPTION_CANCEL_REASON_LABELS: Record<
  SubscriptionCancelReasonCode,
  string
> = {
  fraud: 'Fraud or a stolen payment method',
  security: 'Security lockdown',
  abuse: 'Abuse or terms violation',
  'customer-request': 'Customer asked us to',
  other: 'Other — say what, below',
}

/** Internal staff rationale — never shown to the customer. */
export const SUBSCRIPTION_CANCEL_NOTE_MAX = 400

/**
 * The validated reason, or null. `other` without a note is refused, on the
 * server as well as in the dialog, so no cancellation is recorded blank.
 */
export function normalizeSubscriptionCancelReason(
  code: unknown,
  note: unknown,
): { reason: SubscriptionCancelReasonCode; note: string } | null {
  if (!isSubscriptionCancelReasonCode(code)) return null
  const text =
    typeof note === 'string'
      ? note.trim().slice(0, SUBSCRIPTION_CANCEL_NOTE_MAX)
      : ''
  if (code === 'other' && text.length === 0) return null
  return { reason: code, note: text }
}

/**
 * Should a lock with this reason cancel billing unless the operator says
 * otherwise? Only `security`.
 *
 * `billing` locks exist so a customer can fix their card and come back, a
 * `maintenance` lock is ours, and a `manual` lock can mean anything — none of
 * them may end a subscription by default. The route applies no default at
 * all (an absent flag is "do not cancel"); this predicate is only the
 * console's initial checkbox state, kept here so the two lockdown controls
 * and the runbook's matrix have one source.
 */
export function lockdownCancelsBillingByDefault(reason: unknown): boolean {
  return reason === 'security'
}
