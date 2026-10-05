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
 * CONFLICT POLICY — what a row does to the record it matched, field by field.
 *
 * Record level, the person chooses what happens on a match (update it,
 * skip the row, or create a duplicate anyway), on no match (create or
 * skip) and on an ambiguous match (skip, or choose per row).
 *
 * Field level, the person chooses how an incoming value meets the one the
 * record holds:
 *
 *  - `overwrite` — the file's value replaces it;
 *  - `fillBlanks` — the file's value is written only where the record has none;
 *  - `keepExisting` — the field is never changed on an existing record;
 *  - `append` — list fields (tags, multi-select) gain the file's items;
 *
 * and, separately, what a BLANK cell means: `leave` the value alone, or
 * `clear` it.
 *
 * ## Precedence
 *
 * For row R and field F, the first of these that speaks decides:
 *
 *  1. a locked rule the owning plugin declared for F (stage never moves
 *     backward, consent is never asserted from a file) — the person sees it,
 *     with its reason, and cannot change it;
 *  2. the person's override for row R, field F;
 *  3. the person's choice for field F;
 *  4. the type default (lists append);
 *  5. the person's default for every field.
 *=========================================*/

import { isTransferListType } from './resource'
import type { TransferField } from './resource'

/** What happens to a row that matched an existing record. */
export type TransferOnMatch = 'update' | 'skip' | 'duplicate'
/** What happens to a row that matched nothing. */
export type TransferOnNew = 'create' | 'skip'
/** What happens to a row that matched several records. */
export type TransferOnAmbiguous = 'skip' | 'ask'

export interface TransferRecordPolicy {
  onMatch: TransferOnMatch
  onNew: TransferOnNew
  onAmbiguous: TransferOnAmbiguous
}

/** How an incoming value meets the existing one. */
export type TransferFieldMode = 'overwrite' | 'fillBlanks' | 'keepExisting' | 'append'

/** What a blank cell means for a field. */
export type TransferBlankMeans = 'leave' | 'clear'

export interface TransferFieldPolicy {
  mode: TransferFieldMode
  blank: TransferBlankMeans
}

/** A rule the owning plugin imposes on a field; shown locked, with its reason. */
export interface TransferLockedRule {
  fieldId: string
  /** Why, in a sentence the person reads ("A stage never moves backward"). */
  reason: string
  /** The policy forced on the field; parts left out stay the person's choice. */
  forced?: Partial<TransferFieldPolicy>
  /** The file's values are never written to this field at all. */
  refuseValues?: boolean
}

/** A person's choice for one row. */
export interface TransferRowOverride {
  /** What to do with the row, whatever its match said. */
  action?: 'create' | 'update' | 'skip'
  /** The record to update — how an ambiguous row is resolved. */
  recordId?: string
  /** Per-field choices for this row. */
  fields?: Readonly<Record<string, Partial<TransferFieldPolicy>>>
}

export interface TransferPolicy {
  record: TransferRecordPolicy
  /** The default for every field. */
  fieldDefault: TransferFieldPolicy
  /** Per-field choices. */
  fields: Readonly<Record<string, Partial<TransferFieldPolicy>>>
  /** The owning plugin's locked rules. */
  locked: readonly TransferLockedRule[]
  /** Per-row choices, by row index. */
  rows: Readonly<Record<number, TransferRowOverride>>
}

/** Update what matches, create what does not, and ask about the rest. */
export const DEFAULT_TRANSFER_RECORD_POLICY: TransferRecordPolicy = {
  onMatch: 'update',
  onNew: 'create',
  onAmbiguous: 'ask',
}

/**
 * Fill blanks and leave on blank: the default never replaces or clears a
 * value somebody already has. Anything stronger is a choice the person makes.
 */
export const DEFAULT_TRANSFER_FIELD_POLICY: TransferFieldPolicy = {
  mode: 'fillBlanks',
  blank: 'leave',
}

/** A policy with every part present, defaults filling what `partial` leaves out. */
export function createTransferPolicy(partial: Partial<TransferPolicy> = {}): TransferPolicy {
  return {
    record: { ...DEFAULT_TRANSFER_RECORD_POLICY, ...partial.record },
    fieldDefault: { ...DEFAULT_TRANSFER_FIELD_POLICY, ...partial.fieldDefault },
    fields: partial.fields ?? {},
    locked: partial.locked ?? [],
    rows: partial.rows ?? {},
  }
}

/** Where a resolved field policy came from. */
export type TransferPolicySource = 'locked' | 'row' | 'field' | 'type' | 'default'

/** The policy that applies to one row's field, and why. */
export interface ResolvedFieldPolicy extends TransferFieldPolicy {
  /** Where the MODE came from. */
  source: TransferPolicySource
  /** The locked rule, when one applies to the field. */
  locked?: TransferLockedRule
  /** The file's value is never written. */
  refuseValues: boolean
}

/**
 * The policy for row `rowIndex`, field `field` (see the precedence in the
 * block header). `append` on a field that is not a list is read as
 * `overwrite` — appending to a single value is replacing it.
 */
export function resolveFieldPolicy(
  policy: TransferPolicy,
  rowIndex: number,
  field: TransferField,
): ResolvedFieldPolicy {
  const locked = policy.locked.find((rule) => rule.fieldId === field.id)
  const row = policy.rows[rowIndex]?.fields?.[field.id]
  const chosen = policy.fields[field.id]
  const list = isTransferListType(field.type)

  let mode: TransferFieldMode
  let source: TransferPolicySource
  if (locked?.forced?.mode) {
    mode = locked.forced.mode
    source = 'locked'
  } else if (row?.mode) {
    mode = row.mode
    source = 'row'
  } else if (chosen?.mode) {
    mode = chosen.mode
    source = 'field'
  } else if (list) {
    mode = 'append'
    source = 'type'
  } else {
    mode = policy.fieldDefault.mode
    source = 'default'
  }
  if (mode === 'append' && !list) mode = 'overwrite'

  const blank = locked?.forced?.blank ?? row?.blank ?? chosen?.blank ?? policy.fieldDefault.blank
  return {
    mode,
    blank,
    source,
    refuseValues: Boolean(locked?.refuseValues),
    ...(locked ? { locked } : {}),
  }
}

/** The record-level policy for one row, with the person's row choice folded in. */
export function resolveRecordPolicy(
  policy: TransferPolicy,
  rowIndex: number,
): TransferRecordPolicy & { action?: TransferRowOverride['action']; recordId?: string } {
  const row = policy.rows[rowIndex]
  return {
    ...policy.record,
    ...(row?.action ? { action: row.action } : {}),
    ...(row?.recordId ? { recordId: row.recordId } : {}),
  }
}

/**
 * What is wrong with a policy against a field list, as sentences: a choice
 * or rule for a field that does not exist, an append on a field that is not
 * a list, and a person's choice that a locked rule overrides.
 */
export function transferPolicyProblems(policy: TransferPolicy, fields: readonly TransferField[]): string[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const problems: string[] = []
  const check = (fieldId: string, setting: Partial<TransferFieldPolicy>, where: string): void => {
    const field = byId.get(fieldId)
    if (!field) {
      problems.push(`${where} names "${fieldId}", which is not a field.`)
      return
    }
    if (setting.mode === 'append' && !isTransferListType(field.type)) {
      problems.push(`${where}: "${field.label}" is not a list, so it cannot be appended to.`)
    }
    const locked = policy.locked.find((rule) => rule.fieldId === fieldId)
    if (locked?.forced?.mode && setting.mode && setting.mode !== locked.forced.mode) {
      problems.push(`${where}: "${field.label}" is locked — ${locked.reason}`)
    }
  }
  for (const [fieldId, setting] of Object.entries(policy.fields)) check(fieldId, setting, 'A field choice')
  for (const [row, override] of Object.entries(policy.rows)) {
    for (const [fieldId, setting] of Object.entries(override.fields ?? {})) {
      check(fieldId, setting, `Row ${Number(row) + 1}`)
    }
  }
  for (const rule of policy.locked) {
    if (!byId.has(rule.fieldId)) problems.push(`A locked rule names "${rule.fieldId}", which is not a field.`)
  }
  return problems
}

/** Whether a value is blank: absent, empty text, an empty list or an empty object. */
export function isBlankTransferValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object' && !(value instanceof Date)) {
    return Object.values(value as Record<string, unknown>).every(isBlankTransferValue)
  }
  return false
}

function listKey(item: unknown): string {
  return typeof item === 'string' ? item.trim().toLowerCase() : JSON.stringify(item)
}

/** Two lists as one: the existing items, then the incoming ones it lacks (in any case). */
export function appendTransferList(existing: unknown, incoming: unknown): unknown[] {
  const before = Array.isArray(existing) ? existing : isBlankTransferValue(existing) ? [] : [existing]
  const after = Array.isArray(incoming) ? incoming : isBlankTransferValue(incoming) ? [] : [incoming]
  const seen = new Set(before.map(listKey))
  const merged = [...before]
  for (const item of after) {
    const key = listKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

/** What a policy makes of one field. */
export interface FieldPolicyOutcome {
  /** The value the record will hold. */
  after: unknown
  /** Whether that differs from what it holds. */
  changed: boolean
  /** Why it is what it is, for the diff table. */
  rule: 'written' | 'filled' | 'kept' | 'appended' | 'cleared' | 'leftBlank' | 'refused'
}

/** Whether two field values are the same value; lists compare as sets, caseless. */
export function transferValuesEqual(a: unknown, b: unknown): boolean {
  if (isBlankTransferValue(a) && isBlankTransferValue(b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const keys = new Set(a.map(listKey))
    return b.every((item) => keys.has(listKey(item)))
  }
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as Date).getTime() === new Date(b as Date).getTime()
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    return [...keys].every((key) => transferValuesEqual(left[key], right[key]))
  }
  return a === b
}

/**
 * One incoming value against the record's value under a resolved policy.
 * `incoming` absent means the column was not mapped: the field is not
 * touched. Blank means the cell was mapped and empty.
 */
export function applyFieldPolicy(
  resolved: Pick<ResolvedFieldPolicy, 'mode' | 'blank' | 'refuseValues'>,
  before: unknown,
  incoming: unknown,
): FieldPolicyOutcome {
  const same = (after: unknown, rule: FieldPolicyOutcome['rule']): FieldPolicyOutcome => ({
    after,
    changed: !transferValuesEqual(before, after),
    rule,
  })
  if (resolved.refuseValues) return { after: before, changed: false, rule: 'refused' }
  if (resolved.mode === 'keepExisting') return { after: before, changed: false, rule: 'kept' }
  if (isBlankTransferValue(incoming)) {
    if (resolved.blank === 'clear' && (resolved.mode === 'overwrite' || resolved.mode === 'append')) {
      return same(null, 'cleared')
    }
    return { after: before, changed: false, rule: 'leftBlank' }
  }
  switch (resolved.mode) {
    case 'overwrite':
      return same(incoming, 'written')
    case 'fillBlanks':
      return isBlankTransferValue(before) ? same(incoming, 'filled') : { after: before, changed: false, rule: 'kept' }
    case 'append':
      return same(appendTransferList(before, incoming), 'appended')
  }
}
