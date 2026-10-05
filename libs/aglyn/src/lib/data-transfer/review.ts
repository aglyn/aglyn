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
 * THE REVIEW — what the wizard shows the person about a whole file.
 *
 * The derivations counted per field, the rows against existing records, the
 * conflicts a policy decides and the rows more than one record matched. The
 * job engine computes them over the stored file and the kit's in-memory
 * client over its own records, from these same functions, so a step reads
 * the same in a spec as it does against the server.
 *=========================================*/

import { deriveDate, type DeriveOptions, type FieldDerivation, type FieldProblem } from './derive'
import { summarizeMatches, type MatchKeySpec, type RowMatchOutcome } from './match'
import type { PlannedTransferRow, TransferPlanRow, TransferRowVerdict } from './plan'
import {
  applyFieldPolicy,
  compareTransferValues,
  isBlankTransferValue,
  resolveFieldPolicy,
  type TransferPolicy,
  type TransferValuesComparator,
} from './policy'
import { isTransferFieldWritable, type TransferField } from './resource'
import {
  TRANSFER_MATCH_ROWS_PER_KIND,
  TRANSFER_PLAN_SAMPLE_PER_VERDICT,
  TRANSFER_REVIEW_SAMPLES,
  type TransferAmbiguity,
  type TransferConflict,
  type TransferDateOrder,
  type TransferDerivationSummary,
  type TransferMatchReview,
} from './transfer-api'

/** The per-field derive options a person's date-order choices make. */
export function transferDateOrderOptions(
  dateOrders: Readonly<Record<string, TransferDateOrder>> | undefined,
): Record<string, DeriveOptions> {
  const options: Record<string, DeriveOptions> = {}
  for (const [fieldId, order] of Object.entries(dateOrders ?? {})) {
    if (order === 'mdy' || order === 'dmy') options[fieldId] = { date: { order }, dateTime: { order } }
  }
  return options
}

/** One row as read: the raw cells by field, and what reading them did. */
export interface TransferReviewRow {
  index: number
  /** Field id → the raw cell, from `mapTransferRow`. */
  cells: Readonly<Record<string, unknown>>
  derivations?: readonly FieldDerivation[]
  problems?: readonly FieldProblem[]
}

/**
 * What reading each of `fields` did over every row: cells filled, read as
 * they were, each derivation and problem counted with a few examples, and
 * the dates that read either way round.
 */
export function summarizeTransferDerivations(
  fields: readonly TransferField[],
  rows: readonly TransferReviewRow[],
  samples = TRANSFER_REVIEW_SAMPLES,
): TransferDerivationSummary[] {
  return fields.map((field) => {
    const summary: TransferDerivationSummary = {
      fieldId: field.id,
      filled: 0,
      unchanged: 0,
      derivations: [],
      problems: [],
      ambiguousDates: 0,
    }
    for (const row of rows) {
      const raw = row.cells[field.id]
      if (isBlankTransferValue(raw)) continue
      summary.filled += 1
      const own = (row.derivations ?? []).filter((entry) => entry.fieldId === field.id)
      const problems = (row.problems ?? []).filter((entry) => entry.fieldId === field.id)
      if (!own.length && !problems.length) summary.unchanged += 1
      for (const entry of own) {
        const tally = summary.derivations.find((count) => count.kind === entry.kind)
        if (tally) {
          tally.count += 1
          tally.flagged ||= entry.flagged
          if (tally.samples.length < samples) tally.samples.push({ row: row.index, from: entry.from, to: entry.to })
        } else {
          summary.derivations.push({
            kind: entry.kind,
            note: entry.note,
            count: 1,
            flagged: entry.flagged,
            samples: [{ row: row.index, from: entry.from, to: entry.to }],
          })
        }
      }
      for (const entry of problems) {
        const tally = summary.problems.find((count) => count.code === entry.code)
        if (tally) {
          tally.count += 1
          if (tally.samples.length < samples) tally.samples.push({ row: row.index, raw: entry.raw })
        } else {
          summary.problems.push({
            code: entry.code,
            message: entry.message,
            count: 1,
            samples: [{ row: row.index, raw: entry.raw }],
          })
        }
      }
      // Ambiguity is a property of the cell, whatever order the person chose.
      if (
        (field.type === 'date' || field.type === 'datetime') &&
        deriveDate(raw).derivations.some((entry) => entry.kind === 'ambiguousDate')
      ) {
        summary.ambiguousDates += 1
      }
    }
    return summary
  })
}

/** A name for a row or a record: its first non-blank text value. */
export function transferRowLabel(values: Readonly<Record<string, unknown>> | null | undefined): string | undefined {
  if (!values) return undefined
  const text = Object.values(values).find((value) => typeof value === 'string' && value.trim())
  return typeof text === 'string' ? text : undefined
}

/** Every record id an outcome names. */
export function transferMatchedRecordIds(outcomes: readonly RowMatchOutcome[]): string[] {
  const ids = new Set<string>()
  for (const outcome of outcomes) {
    if (outcome.kind === 'matched') ids.add(outcome.recordId)
    if (outcome.kind === 'ambiguous') for (const id of outcome.recordIds) ids.add(id)
  }
  return [...ids]
}

/**
 * The rows against existing records: every outcome counted, and at most
 * `perKind` rows of each outcome listed, each named from its own values.
 */
export function transferMatchReview(
  keys: readonly MatchKeySpec[],
  outcomes: readonly RowMatchOutcome[],
  values: ReadonlyArray<Readonly<Record<string, unknown>>>,
  perKind = TRANSFER_MATCH_ROWS_PER_KIND,
): TransferMatchReview {
  const listed: Record<RowMatchOutcome['kind'], number> = { new: 0, matched: 0, ambiguous: 0, duplicateInFile: 0 }
  const rows: TransferMatchReview['rows'] = []
  outcomes.forEach((outcome, row) => {
    if (listed[outcome.kind] >= perKind) return
    listed[outcome.kind] += 1
    const label = transferRowLabel(values[row])
    rows.push({ row, outcome, ...(label ? { label } : {}) })
  })
  return { keys: [...keys], summary: summarizeMatches(outcomes), rows }
}

export interface TransferConflictsInput {
  fields: ReadonlyMap<string, TransferField>
  rows: readonly TransferPlanRow[]
  matches: readonly RowMatchOutcome[]
  /** Record id → what the record holds now. */
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  policy: TransferPolicy
  /** The resource's comparator, so the review and the dry run agree on what differs. */
  valuesEqual?: TransferValuesComparator
}

/**
 * The matched rows whose non-blank file values differ from non-blank
 * values the record holds, field by field, with what the policy makes of
 * each now. A row the person pointed at a record (`policy.rows`) is
 * compared with that record. `matches` are the outcomes the dry run plans
 * with — the resource's own, when it matches rows itself — and `valuesEqual`
 * the resource's comparator, so a value the resource folds is no conflict.
 */
export function transferPlanConflicts(input: TransferConflictsInput): TransferConflict[] {
  const conflicts: TransferConflict[] = []
  input.rows.forEach((row) => {
    const outcome = input.matches[row.index]
    const chosen = input.policy.rows[row.index]?.recordId
    const recordId = chosen ?? (outcome?.kind === 'matched' ? outcome.recordId : null)
    if (!recordId) return
    const record = input.existing.get(recordId)
    if (!record) return
    const fields = Object.entries(row.values).flatMap(([fieldId, incoming]) => {
      const field = input.fields.get(fieldId)
      if (!field || !isTransferFieldWritable(field)) return []
      const before = record[fieldId]
      const equal = (a: unknown, b: unknown) => compareTransferValues(field, a, b, input.valuesEqual)
      if (isBlankTransferValue(incoming) || isBlankTransferValue(before) || equal(before, incoming)) return []
      const resolved = resolveFieldPolicy(input.policy, row.index, field)
      return [
        {
          fieldId,
          before,
          incoming,
          after: applyFieldPolicy(resolved, before, incoming, equal).after,
          mode: resolved.mode,
          source: resolved.source,
        },
      ]
    })
    if (fields.length) conflicts.push({ row: row.index, recordId, fields })
  })
  return conflicts
}

/** The rows more than one record matched. */
export function transferAmbiguities(outcomes: readonly RowMatchOutcome[]): TransferAmbiguity[] {
  return outcomes.flatMap((outcome, row) =>
    outcome.kind === 'ambiguous' ? [{ row, via: outcome.via, recordIds: [...outcome.recordIds] }] : [],
  )
}

/** At most `perVerdict` planned rows of each verdict, in row order. */
export function transferPlanSample(
  rows: readonly PlannedTransferRow[],
  perVerdict = TRANSFER_PLAN_SAMPLE_PER_VERDICT,
): PlannedTransferRow[] {
  const taken: Partial<Record<TransferRowVerdict, number>> = {}
  return rows.filter((row) => {
    const count = taken[row.verdict] ?? 0
    if (count >= perVerdict) return false
    taken[row.verdict] = count + 1
    return true
  })
}
