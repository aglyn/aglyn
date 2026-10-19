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
 * APPEND-ONLY HISTORY (AGL-3959).
 *
 * Work that bills — Site Care minutes and extra time, and the flat-quoted
 * project invoice after it (AGL-3970) — keeps one dated row per thing that
 * happened: a minute entry, a timer start, an approval, a charge, an email,
 * a correction. Nothing is overwritten. A fix is a new row that says what it
 * was before, what it is now, who changed it and why, so the record a person
 * can be shown is the whole record.
 *
 * Each row carries two tellings of the same fact: `summary`, written for the
 * owner in plain words (it is what their statement lists), and the
 * structured `before` / `after` / `stripe` a staff member or the
 * reconciliation reads. This module is the row's shape and its rules; the
 * write — always a `create`, in the same batch as the change it records — is
 * `@aglyn/tenant-data-admin/server/append-only-history-write`.
 */

/** The longest reason or summary a row keeps. */
export const HISTORY_TEXT_MAX = 500

/** The Stripe object a row's money movement names. */
export interface HistoryStripeRef {
  /** `invoiceitem`, `credit_note`, `refund`, `invoice`. */
  object: string
  id: string
  /** Whole cents the object moved, when it moved money. */
  amountCents?: number
}

/** One row. */
export interface AppendOnlyHistoryRow {
  /** When it happened, epoch ms. */
  atMs: number
  /** Who did it; null when nobody did (a scheduled check). */
  byUid: string | null
  byEmail: string | null
  /** What kind of thing happened, `noun.verb`: `minutes.corrected`. */
  kind: string
  /** What happened, in plain words an owner can read. */
  summary: string
  /** Why; required on every correction. */
  reason: string | null
  before: Readonly<Record<string, unknown>> | null
  after: Readonly<Record<string, unknown>> | null
  stripe: HistoryStripeRef | null
  /** The record the row belongs to, when the history is shared by many. */
  subjectId: string | null
}

export interface HistoryRowInput {
  atMs: number
  by: { uid: string | null; email: string | null }
  kind: string
  summary: string
  reason?: string | null
  before?: Readonly<Record<string, unknown>> | null
  after?: Readonly<Record<string, unknown>> | null
  stripe?: HistoryStripeRef | null
  subjectId?: string | null
}

/** A trimmed, bounded reason, or null when blank. */
export function cleanHistoryReason(reason: unknown): string | null {
  const text = typeof reason === 'string' ? reason.trim().slice(0, HISTORY_TEXT_MAX) : ''
  return text ? text : null
}

/**
 * The reason a correction must carry, or an error to show. Every change to
 * something already recorded goes through this, so "why" is never optional
 * where it matters.
 */
export function requireHistoryReason(
  reason: unknown,
): { ok: true; reason: string } | { ok: false; error: string } {
  const cleaned = cleanHistoryReason(reason)
  return cleaned ? { ok: true, reason: cleaned } : { ok: false, error: 'Say why — a reason is required.' }
}

/** A row from its parts, every field present so a reader never guesses. */
export function historyRow(input: HistoryRowInput): AppendOnlyHistoryRow {
  return {
    atMs: Math.floor(input.atMs),
    byUid: input.by.uid ?? null,
    byEmail: input.by.email ?? null,
    kind: input.kind,
    summary: String(input.summary ?? '').trim().slice(0, HISTORY_TEXT_MAX),
    reason: cleanHistoryReason(input.reason ?? null),
    before: input.before ?? null,
    after: input.after ?? null,
    stripe: input.stripe ?? null,
    subjectId: input.subjectId ?? null,
  }
}

/** Rows oldest first, ties kept in the order they were read. */
export function sortHistoryRows<Row extends Pick<AppendOnlyHistoryRow, 'atMs'>>(
  rows: readonly Row[],
): Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.atMs - b.row.atMs || a.index - b.index)
    .map(({ row }) => row)
}
