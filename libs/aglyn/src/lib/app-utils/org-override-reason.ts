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
 * WHY a staff org override was made (AGL-1652).
 *
 * The override dialog changes what an organization is ENTITLED to and BILLED
 * against — since AGL-1635 it can also set `transactionFeePhysicalPct`,
 * `transactionFeeDigitalPct` and `marketplaceFeePct`, and force an
 * unreleased feature on for one paying customer. Its `adminAudit` row
 * recorded the actor, the target and a full before/after, and nothing at all
 * about why. `before`/`after` shows that a fee changed; only a reason can
 * show it was the negotiated rate rather than a slip, and that question is
 * asked months later during a billing dispute, when the row can no longer be
 * back-filled.
 *
 * ## The field family is AGL-1501's, deliberately
 *
 * `reason` (a code from a fixed set) + `note` (free text, staff-only) is the
 * shape lockdown and media quarantine already use, so an operator reading an
 * audit row is reading the same two fields whichever staff action wrote it.
 * What is NOT borrowed is the vocabulary: lockdown's
 * security/billing/maintenance/manual describes an INCIDENT, and an override
 * is not one. A negotiated enterprise rate recorded as "billing" is a record
 * that cannot answer the only question anyone ever asks of it.
 *
 * The AGL-1512 `message` field is absent for the same kind of reason: a
 * quarantine notice is shown to the customer, and an override reason is
 * not — nothing here reaches a tenant surface.
 *
 * ## Required, and why a code rather than free text
 *
 * A required free-text box is defeated by typing "x", and a box that can be
 * defeated that cheaply buys a false sense of a record. A fixed set cannot
 * be: every value is one somebody has to stand behind, and the set is small
 * enough to read as a distribution across a quarter.
 *
 * `other` is the escape hatch that keeps the set honest — without one, staff
 * pick the nearest wrong code and the whole vocabulary rots. It is the one
 * code that says nothing by itself, so it is the one code that REQUIRES the
 * note: see {@link orgOverrideReasonNeedsNote}. Every other code may carry a
 * note and does not need one.
 */
export type OrgOverrideReasonCode =
  | 'enterprise'
  | 'support'
  | 'beta'
  | 'correction'
  | 'trial'
  | 'other'

const ORG_OVERRIDE_REASON_KEYS: Record<OrgOverrideReasonCode, true> = {
  enterprise: true,
  support: true,
  beta: true,
  correction: true,
  trial: true,
  other: true,
}

export const ORG_OVERRIDE_REASON_CODES = Object.keys(
  ORG_OVERRIDE_REASON_KEYS,
) as OrgOverrideReasonCode[]

export function isOrgOverrideReasonCode(
  value: unknown,
): value is OrgOverrideReasonCode {
  return typeof value === 'string' && value in ORG_OVERRIDE_REASON_KEYS
}

/** Staff-surface labels; the key stays the wire/audit identity. */
export const ORG_OVERRIDE_REASON_LABELS: Record<
  OrgOverrideReasonCode,
  string
> = {
  enterprise: 'Negotiated enterprise or custom contract',
  support: 'Support remediation or goodwill',
  beta: 'Early access to an unreleased feature',
  correction: 'Correcting an earlier mistake',
  trial: 'Sales trial or proof of concept',
  other: 'Other — say what, below',
}

/** Internal staff rationale — never shown to the customer. */
export const ORG_OVERRIDE_NOTE_MAX = 1000

/**
 * Does this code mean nothing without the note? Only `other` does. Keeping
 * this a predicate rather than an inline `=== 'other'` is what lets the
 * dialog's Save gate and any later server-side gate agree by construction.
 */
export function orgOverrideReasonNeedsNote(
  code: OrgOverrideReasonCode,
): boolean {
  return code === 'other'
}

/** The two fields an `org.override` audit row carries beside before/after. */
export interface OrgOverrideReason {
  reason: OrgOverrideReasonCode
  /**
   * Explicit `null` when absent, never `undefined` — this value goes
   * straight into a Firestore write, and Firestore rejects `undefined`.
   */
  note: string | null
}

/**
 * The ONE predicate for "is this a reason worth writing down".
 *
 * Returns `null` — never a defaulted value — when the code is unrecognised,
 * or when `other` arrives without a note. A defaulted reason would be worse
 * than none: it would put a code somebody never chose next to a fee change
 * they did make.
 *
 * Whitespace-only notes are treated as absent, which is what makes the
 * `other` gate real rather than a space-bar away from being satisfied.
 */
export function normalizeOrgOverrideReason(
  code: unknown,
  note?: unknown,
): OrgOverrideReason | null {
  if (!isOrgOverrideReasonCode(code)) return null
  const trimmed =
    typeof note === 'string' && note.trim()
      ? note.trim().slice(0, ORG_OVERRIDE_NOTE_MAX)
      : null
  if (orgOverrideReasonNeedsNote(code) && !trimmed) return null
  return { reason: code, note: trimmed }
}

/**
 * How an override reason reads on a staff surface: the label, plus the note
 * when there is one. Shared so the audit log and the org detail page cannot
 * drift into describing the same row two different ways.
 *
 * A row written before AGL-1652 has no reason at all, and says so — the gap
 * is a fact about the record, and rendering it as blank would let a
 * pre-AGL-1652 override pass for one nobody had to explain.
 */
export function orgOverrideReasonSummary(
  reason: unknown,
  note?: unknown,
): string | null {
  if (!isOrgOverrideReasonCode(reason)) return null
  const label = ORG_OVERRIDE_REASON_LABELS[reason]
  return typeof note === 'string' && note.trim()
    ? `${label} — ${note.trim()}`
    : label
}
