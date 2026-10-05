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
 * THE PLAN — what an import WILL do, row by row, before it does anything.
 *
 * Given the rows (mapped and derived), each row's match outcome, the
 * records those matched, and the policy, the plan says for every row:
 * create, update, unchanged, skip or fail — with the field-by-field diff
 * (before → after, and which policy decided it) and the warnings it
 * raised. Nothing is written; the dry run IS this function run on the
 * server over every row.
 *
 * ## Warnings are typed and must be acknowledged
 *
 * Every class of thing that could surprise a person — a guessed date
 * order, a picklist value nobody chose for, a non-blank value about to be
 * overwritten, a value about to be cleared — is a warning class with a
 * count and samples. The classes in {@link ACKNOWLEDGED_WARNING_CLASSES}
 * (and a derivation class holding a flagged guess) must each be
 * acknowledged before Apply is enabled; {@link missingAcknowledgements}
 * says which are outstanding.
 *=========================================*/

import type { FieldDerivation, FieldProblem } from './derive'
import type { RowMatchOutcome } from './match'
import {
  appendTransferList,
  applyFieldPolicy,
  compareTransferValues,
  isBlankTransferValue,
  resolveFieldPolicy,
  resolveRecordPolicy,
  transferValuesEqual,
} from './policy'
import type {
  FieldPolicyOutcome,
  TransferFieldMode,
  TransferPolicy,
  TransferPolicySource,
  TransferValuesComparator,
} from './policy'
import { isTransferFieldWritable } from './resource'
import type { TransferField } from './resource'

/** What a row will do. */
export type TransferRowVerdict = 'create' | 'update' | 'unchanged' | 'skip' | 'fail'

export const TRANSFER_ROW_VERDICTS: readonly TransferRowVerdict[] = ['create', 'update', 'unchanged', 'skip', 'fail']

/** Why a row is skipped or fails. */
export type TransferRowReason =
  | 'matchedSkipped'
  | 'newSkipped'
  | 'skippedByChoice'
  | 'ambiguousSkipped'
  | 'ambiguousUnresolved'
  | 'duplicateInFile'
  | 'missingRequired'
  | 'refusedValue'
  | 'matchedRecordMissing'
  | 'planLimit'
  | 'resourceRule'

/** A class of thing the person is warned about. */
export type TransferWarningClass =
  | 'derivation'
  | 'ambiguousDate'
  | 'unmatchedPicklist'
  | 'newPicklistValue'
  | 'unresolvedLookup'
  | 'ambiguousMatch'
  | 'duplicateInFile'
  | 'lockedRule'
  | 'droppedCell'
  | 'overwriteNonBlank'
  | 'clearValue'
  | 'planLimit'
  /**
   * What the owning plugin's own checks found in the file — a column, an
   * address, a count — named in each sample's `detail`. Raised by a
   * resource's `plan`, never by the core.
   */
  | 'screening'
  /**
   * The owning plugin's finding about one row — a rule no field policy can
   * say — folded in by `withTransferResourceFindings`; it may refuse the row.
   */
  | 'resourceRule'

export const TRANSFER_WARNING_CLASSES: readonly TransferWarningClass[] = [
  'derivation',
  'ambiguousDate',
  'unmatchedPicklist',
  'newPicklistValue',
  'unresolvedLookup',
  'ambiguousMatch',
  'duplicateInFile',
  'lockedRule',
  'droppedCell',
  'overwriteNonBlank',
  'clearValue',
  'planLimit',
  'screening',
  'resourceRule',
]

/**
 * The classes that always need an acknowledgement. `derivation` needs one
 * only when it holds a flagged guess; every other class is a change to data
 * or a row held back, and the person says they have seen it.
 */
export const ACKNOWLEDGED_WARNING_CLASSES: readonly TransferWarningClass[] = TRANSFER_WARNING_CLASSES.filter(
  (entry) => entry !== 'derivation',
)

/**
 * Something an earlier step of the wizard decided about a row: a picklist
 * value that was added, left blank or refuses the row; a lookup that did
 * not resolve. `refuse` fails the row.
 */
export interface TransferRowNote {
  class: Extract<TransferWarningClass, 'unmatchedPicklist' | 'newPicklistValue' | 'unresolvedLookup'>
  fieldId: string
  value: string
  refuse?: boolean
  detail?: string
}

/** One row as the plan takes it. */
export interface TransferPlanRow {
  /** Its index in the file. */
  index: number
  /** Field id → value; `null` for a mapped blank cell; absent for unmapped. */
  values: Readonly<Record<string, unknown>>
  derivations?: readonly FieldDerivation[]
  problems?: readonly FieldProblem[]
  notes?: readonly TransferRowNote[]
}

/** One field a row changes. */
export interface TransferFieldChange {
  fieldId: string
  before: unknown
  after: unknown
  mode: TransferFieldMode
  source: TransferPolicySource
  rule: FieldPolicyOutcome['rule']
}

/** One row's verdict. */
export interface PlannedTransferRow {
  index: number
  verdict: TransferRowVerdict
  /** The record updated (or `null` for a create). */
  recordId: string | null
  reason?: TransferRowReason
  /** Required fields a create lacked. */
  missing?: string[]
  /** Fields that change, before → after; on a create, `before` is `null`. */
  diff: TransferFieldChange[]
  /** Values the file had that this row will not write because of a locked rule. */
  heldBack: string[]
  warnings: TransferWarningClass[]
  match: RowMatchOutcome
}

/** One example of a warning. */
export interface TransferWarningSample {
  /** The row's index in the file; {@link TRANSFER_FILE_SAMPLE_ROW} for something about the whole file. */
  row: number
  fieldId?: string
  value?: string
  detail?: string
}

/** The `row` of a warning sample about the whole file rather than one row (a column's name). */
export const TRANSFER_FILE_SAMPLE_ROW = -1

/** One class of warning, counted. */
export interface TransferWarning {
  class: TransferWarningClass
  /** Occurrences (a row can raise a class for several fields). */
  count: number
  /** Distinct rows that raised it. */
  rows: number
  fieldIds: string[]
  samples: TransferWarningSample[]
  requiresAcknowledgement: boolean
}

export type TransferPlanSummary = Record<TransferRowVerdict, number> & { total: number }

export interface TransferPlan {
  rows: PlannedTransferRow[]
  summary: TransferPlanSummary
  warnings: TransferWarning[]
  /** The classes that must be acknowledged before the plan may be applied. */
  acknowledgementsRequired: TransferWarningClass[]
}

/** Bounds the plan enforces as it goes, from the organization's plan. */
export interface TransferPlanLimits {
  /** The most records this import may create. */
  maxCreates?: number
  /** The most records this import may write (creates and updates). */
  maxWrites?: number
}

export interface BuildTransferPlanInput {
  fields: readonly TransferField[]
  rows: readonly TransferPlanRow[]
  /** One per row, in the same order. */
  matches: readonly RowMatchOutcome[]
  /** Record id → its current values by field id. */
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  policy: TransferPolicy
  limits?: TransferPlanLimits
  /** Samples kept per warning class; default 5. */
  sampleSize?: number
  /**
   * The resource's answer to whether a field's value changes (AGL-3548):
   * a value it folds on write (`Published`, `published`) is not a change.
   */
  valuesEqual?: TransferValuesComparator
}

interface Tally {
  count: number
  rows: Set<number>
  fields: Set<string>
  samples: TransferWarningSample[]
  flagged: boolean
}

class WarningTally {
  private readonly byClass = new Map<TransferWarningClass, Tally>()

  constructor(private readonly sampleSize: number) {}

  add(entry: TransferWarningClass, sample: TransferWarningSample, flagged = true): void {
    const tally: Tally = this.byClass.get(entry) ?? { count: 0, rows: new Set(), fields: new Set(), samples: [], flagged: false }
    tally.count += 1
    tally.rows.add(sample.row)
    if (sample.fieldId) tally.fields.add(sample.fieldId)
    if (tally.samples.length < this.sampleSize) tally.samples.push(sample)
    tally.flagged ||= flagged
    this.byClass.set(entry, tally)
  }

  list(): TransferWarning[] {
    return TRANSFER_WARNING_CLASSES.filter((entry) => this.byClass.has(entry)).map((entry) => {
      const tally = this.byClass.get(entry) as Tally
      return {
        class: entry,
        count: tally.count,
        rows: tally.rows.size,
        fieldIds: [...tally.fields],
        samples: tally.samples,
        requiresAcknowledgement: ACKNOWLEDGED_WARNING_CLASSES.includes(entry) || tally.flagged,
      }
    })
  }
}

/** Whether a field's new value carries what the file said (every item, for a list). */
function reflects(after: unknown, incoming: unknown): boolean {
  if (Array.isArray(incoming)) return transferValuesEqual(appendTransferList(after, incoming), after)
  return transferValuesEqual(after, incoming)
}

function display(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** The plan for a file (see the block header). */
export function buildTransferPlan(input: BuildTransferPlanInput): TransferPlan {
  const byId = new Map(input.fields.map((field) => [field.id, field]))
  const tally = new WarningTally(input.sampleSize ?? 5)
  const limits = input.limits ?? {}
  let creates = 0
  let writes = 0

  const rows = input.rows.map((row, position): PlannedTransferRow => {
    const match = input.matches[position] ?? { kind: 'new' }
    const warnings = new Set<TransferWarningClass>()
    const warn = (entry: TransferWarningClass, sample: Omit<TransferWarningSample, 'row'>, flagged = true): void => {
      warnings.add(entry)
      tally.add(entry, { row: row.index, ...sample }, flagged)
    }
    const finish = (
      verdict: TransferRowVerdict,
      recordId: string | null,
      extra: Partial<PlannedTransferRow> = {},
    ): PlannedTransferRow => ({
      index: row.index,
      verdict,
      recordId,
      diff: [],
      heldBack: [],
      ...extra,
      warnings: [...warnings],
      match,
    })

    for (const entry of row.derivations ?? []) {
      warn(entry.kind === 'ambiguousDate' ? 'ambiguousDate' : 'derivation', {
        fieldId: entry.fieldId,
        value: entry.from,
        detail: `${entry.note} → ${entry.to}`,
      }, entry.flagged)
    }
    for (const problem of row.problems ?? []) {
      warn('droppedCell', { fieldId: problem.fieldId, value: problem.raw, detail: problem.message })
    }
    let refused = false
    for (const note of row.notes ?? []) {
      warn(note.class, { fieldId: note.fieldId, value: note.value, ...(note.detail ? { detail: note.detail } : {}) })
      if (note.refuse) refused = true
    }
    if (refused) return finish('fail', null, { reason: 'refusedValue' })

    const record = resolveRecordPolicy(input.policy, row.index)
    let target: { kind: 'create' } | { kind: 'update'; recordId: string } | { kind: 'skip'; reason: TransferRowReason }
    if (record.action === 'skip') {
      target = { kind: 'skip', reason: 'skippedByChoice' }
    } else if (record.action === 'create') {
      target = { kind: 'create' }
    } else if (record.recordId) {
      target = { kind: 'update', recordId: record.recordId }
    } else if (match.kind === 'duplicateInFile') {
      warn('duplicateInFile', { value: match.via.value, fieldId: match.via.fieldId, detail: `Same as row ${match.firstRow + 1}` })
      target = { kind: 'skip', reason: 'duplicateInFile' }
    } else if (match.kind === 'ambiguous') {
      warn('ambiguousMatch', {
        fieldId: match.via.fieldId,
        value: match.via.value,
        detail: `${match.recordIds.length} records match`,
      })
      target = { kind: 'skip', reason: record.onAmbiguous === 'skip' ? 'ambiguousSkipped' : 'ambiguousUnresolved' }
    } else if (match.kind === 'matched') {
      if (match.alsoMatched?.length) {
        warn('ambiguousMatch', {
          fieldId: match.via.fieldId,
          value: match.via.value,
          detail: `Another key points at ${match.alsoMatched.length} other record(s)`,
        })
      }
      if (record.onMatch === 'skip') target = { kind: 'skip', reason: 'matchedSkipped' }
      else if (record.onMatch === 'duplicate') target = { kind: 'create' }
      else target = { kind: 'update', recordId: match.recordId }
    } else {
      target = record.onNew === 'skip' ? { kind: 'skip', reason: 'newSkipped' } : { kind: 'create' }
    }
    if (target.kind === 'skip') return finish('skip', null, { reason: target.reason })

    const before = target.kind === 'update' ? input.existing.get(target.recordId) : {}
    if (!before) return finish('fail', target.kind === 'update' ? target.recordId : null, { reason: 'matchedRecordMissing' })

    const diff: TransferFieldChange[] = []
    const heldBack: string[] = []
    for (const [fieldId, incoming] of Object.entries(row.values)) {
      const field = byId.get(fieldId)
      if (!field || !isTransferFieldWritable(field)) continue
      const resolved = resolveFieldPolicy(input.policy, row.index, field)
      const current = target.kind === 'update' ? before[fieldId] : null
      const equal = (a: unknown, b: unknown) => compareTransferValues(field, a, b, input.valuesEqual)
      // A new record has nothing to keep, fill around or append to: the
      // file's value is written unless a locked rule refuses it.
      const outcome =
        target.kind === 'create'
          ? applyFieldPolicy({ mode: 'overwrite', blank: 'leave', refuseValues: resolved.refuseValues }, null, incoming, equal)
          : applyFieldPolicy(resolved, current, incoming, equal)
      if (
        resolved.locked &&
        (resolved.refuseValues || resolved.source === 'locked') &&
        !isBlankTransferValue(incoming) &&
        !reflects(outcome.after, incoming)
      ) {
        heldBack.push(fieldId)
        warn('lockedRule', { fieldId, value: display(incoming), detail: resolved.locked.reason })
      }
      if (!outcome.changed) continue
      if (target.kind === 'update') {
        if (outcome.rule === 'cleared') warn('clearValue', { fieldId, value: display(current) })
        else if (!isBlankTransferValue(current) && outcome.rule !== 'appended') {
          warn('overwriteNonBlank', { fieldId, value: display(current), detail: `→ ${display(outcome.after)}` })
        }
      }
      diff.push({
        fieldId,
        before: target.kind === 'update' ? (current ?? null) : null,
        after: outcome.after,
        mode: target.kind === 'create' ? 'overwrite' : resolved.mode,
        source: resolved.source,
        rule: outcome.rule,
      })
    }

    if (target.kind === 'create') {
      const missing = input.fields
        .filter((field) => field.required && isBlankTransferValue(diff.find((change) => change.fieldId === field.id)?.after))
        .map((field) => field.id)
      if (missing.length) return finish('fail', null, { reason: 'missingRequired', missing, heldBack })
      if ((limits.maxCreates !== undefined && creates >= limits.maxCreates) || (limits.maxWrites !== undefined && writes >= limits.maxWrites)) {
        warn('planLimit', { detail: 'Past what the plan allows' })
        return finish('fail', null, { reason: 'planLimit', heldBack })
      }
      creates += 1
      writes += 1
      return finish('create', null, { diff, heldBack })
    }
    if (!diff.length) return finish('unchanged', target.recordId, { heldBack })
    if (limits.maxWrites !== undefined && writes >= limits.maxWrites) {
      warn('planLimit', { detail: 'Past what the plan allows' })
      return finish('fail', target.recordId, { reason: 'planLimit', heldBack })
    }
    writes += 1
    return finish('update', target.recordId, { diff, heldBack })
  })

  const summary: TransferPlanSummary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  const warnings = tally.list()
  return {
    rows,
    summary,
    warnings,
    acknowledgementsRequired: warnings.filter((entry) => entry.requiresAcknowledgement).map((entry) => entry.class),
  }
}

/** The classes still to acknowledge before the plan may be applied. */
export function missingAcknowledgements(
  plan: Pick<TransferPlan, 'acknowledgementsRequired'>,
  acknowledged: Iterable<TransferWarningClass>,
): TransferWarningClass[] {
  const seen = new Set(acknowledged)
  return plan.acknowledgementsRequired.filter((entry) => !seen.has(entry))
}

/** Whether the plan may be applied: something to write and every required acknowledgement given. */
export function canApplyTransferPlan(
  plan: Pick<TransferPlan, 'acknowledgementsRequired' | 'summary'>,
  acknowledged: Iterable<TransferWarningClass>,
): boolean {
  return plan.summary.create + plan.summary.update > 0 && missingAcknowledgements(plan, acknowledged).length === 0
}

/** The rows that will write, in file order — what the job engine applies. */
export function plannedWrites(plan: Pick<TransferPlan, 'rows'>): PlannedTransferRow[] {
  return plan.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')
}

/**
 * One thing the owning plugin found about a planned row that no field policy
 * can say — a redirect that loops, an off-site destination, a rule its own
 * write path refuses — raised from the resource's `plan` hook.
 */
export interface TransferResourceFinding {
  row: number
  /** What the person should know, in a sentence. */
  detail: string
  fieldId?: string
  value?: string
  /** Refuse the row (it fails as `resourceRule`) rather than only warn about it. */
  refuse?: boolean
}

/**
 * The plan with the plugin's findings folded in: each finding is a
 * `resourceRule` warning on its row (acknowledged before Apply, like every
 * class but a plain derivation), and a `refuse` finding fails a row that
 * would have written. The summary and the acknowledgements follow.
 */
export function withTransferResourceFindings(
  plan: TransferPlan,
  findings: readonly TransferResourceFinding[],
  sampleSize = 5,
): TransferPlan {
  if (!findings.length) return plan
  const byIndex = new Map(plan.rows.map((row) => [row.index, row]))
  const touched = new Map<number, PlannedTransferRow>()
  const rowsRaised = new Set<number>()
  const fieldIds = new Set<string>()
  const samples: TransferWarningSample[] = []
  let count = 0
  for (const finding of findings) {
    const original = byIndex.get(finding.row)
    if (!original) continue
    const row = touched.get(finding.row) ?? { ...original, warnings: [...original.warnings] }
    if (!row.warnings.includes('resourceRule')) row.warnings.push('resourceRule')
    if (finding.refuse && row.verdict !== 'skip' && row.verdict !== 'fail') {
      row.verdict = 'fail'
      row.reason = 'resourceRule'
      row.diff = []
    }
    touched.set(finding.row, row)
    count += 1
    rowsRaised.add(finding.row)
    if (finding.fieldId) fieldIds.add(finding.fieldId)
    if (samples.length < sampleSize) {
      samples.push({
        row: finding.row,
        ...(finding.fieldId ? { fieldId: finding.fieldId } : {}),
        ...(finding.value !== undefined ? { value: finding.value } : {}),
        detail: finding.detail,
      })
    }
  }
  if (!count) return plan
  const rows = plan.rows.map((row) => touched.get(row.index) ?? row)
  const summary: TransferPlanSummary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  const prior = plan.warnings.find((entry) => entry.class === 'resourceRule')
  const raised: TransferWarning = {
    class: 'resourceRule',
    count: (prior?.count ?? 0) + count,
    rows: (prior?.rows ?? 0) + rowsRaised.size,
    fieldIds: [...new Set([...(prior?.fieldIds ?? []), ...fieldIds])],
    samples: [...(prior?.samples ?? []), ...samples].slice(0, sampleSize),
    requiresAcknowledgement: true,
  }
  const warnings = TRANSFER_WARNING_CLASSES.flatMap((entry) =>
    entry === 'resourceRule' ? [raised] : plan.warnings.filter((warning) => warning.class === entry),
  )
  return {
    rows,
    summary,
    warnings,
    acknowledgementsRequired: warnings.filter((entry) => entry.requiresAcknowledgement).map((entry) => entry.class),
  }
}
