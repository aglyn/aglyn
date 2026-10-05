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
 *
 * ## The resource sets where the person starts (AGL-3548)
 *
 * The core's starting point — fill blanks, leave on blank — never replaces
 * a value somebody already has, which is right for a person's record and
 * wrong for a record the file is the definition of: a redirect re-imported
 * with a new destination is meant to point there. A resource declares its
 * own starting point ({@link TransferPolicyDefaults}); the wizard opens the
 * Conflicts step on it and the person may still change every part, and the
 * dry run fills whatever a request leaves out from it
 * ({@link withTransferPolicyDefaults}).
 *
 * ## The resource may say when two values are the same
 *
 * The core compares values as stored (lists as sets, caseless). A resource
 * whose write folds a value — a status kept in lower case, a path kept
 * without its trailing slash — passes a {@link TransferValuesComparator}, so
 * `Published` against `published` is no conflict and no change, in the
 * review and the dry run alike.
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

/**
 * Where a resource starts the person (see the block header): its record
 * policy, its default for every field and its choices for single fields,
 * each part optional. The person's choices are made on top of it.
 */
export interface TransferPolicyDefaults {
  record?: Partial<TransferRecordPolicy>
  fieldDefault?: Partial<TransferFieldPolicy>
  fields?: Readonly<Record<string, Partial<TransferFieldPolicy>>>
  /** Why the resource starts here, in a sentence the Conflicts step shows. */
  note?: string
}

const RECORD_CHOICES = {
  onMatch: ['update', 'skip', 'duplicate'],
  onNew: ['create', 'skip'],
  onAmbiguous: ['skip', 'ask'],
} as const
const FIELD_MODES: readonly TransferFieldMode[] = ['overwrite', 'fillBlanks', 'keepExisting', 'append']
const BLANK_MEANS: readonly TransferBlankMeans[] = ['leave', 'clear']

function fieldChoice(raw: unknown, list: boolean): Partial<TransferFieldPolicy> {
  const choice = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<TransferFieldPolicy> = {}
  const mode = choice['mode'] as TransferFieldMode
  if (FIELD_MODES.includes(mode) && (mode !== 'append' || list)) out.mode = mode
  const blank = choice['blank'] as TransferBlankMeans
  if (BLANK_MEANS.includes(blank)) out.blank = blank
  return out
}

/**
 * A resource's defaults as far as they hold for these fields: a choice for a
 * field the catalog lacks, or one that can never be written, is dropped, as
 * is `append` on a field that is not a list and any value that is not a
 * choice — so a context whose catalog differs (one dataset's fields) never
 * makes a dry run refuse the resource's own defaults.
 */
export function transferPolicyDefaultsFor(
  defaults: TransferPolicyDefaults | null | undefined,
  fields: readonly TransferField[],
): TransferPolicyDefaults {
  if (!defaults) return {}
  const out: TransferPolicyDefaults = {}
  const record: Partial<TransferRecordPolicy> = {}
  for (const [part, allowed] of Object.entries(RECORD_CHOICES) as Array<[keyof TransferRecordPolicy, readonly string[]]>) {
    const value = defaults.record?.[part]
    if (typeof value === 'string' && allowed.includes(value)) (record as Record<string, string>)[part] = value
  }
  if (Object.keys(record).length) out.record = record
  const fieldDefault = fieldChoice(defaults.fieldDefault, false)
  if (Object.keys(fieldDefault).length) out.fieldDefault = fieldDefault
  const byId = new Map(fields.map((field) => [field.id, field]))
  const chosen: Record<string, Partial<TransferFieldPolicy>> = {}
  for (const [fieldId, raw] of Object.entries(defaults.fields ?? {})) {
    const field = byId.get(fieldId)
    if (!field || field.readOnly || field.derived || field.system) continue
    const choice = fieldChoice(raw, isTransferListType(field.type))
    if (Object.keys(choice).length) chosen[fieldId] = choice
  }
  if (Object.keys(chosen).length) out.fields = chosen
  if (typeof defaults.note === 'string' && defaults.note.trim()) out.note = defaults.note.trim()
  return out
}

/**
 * The person's choices on top of a resource's defaults: each part of the
 * record policy and of the field default is the person's where they said
 * one and the resource's where they did not. Field choices sent at all are
 * the person's whole set — the wizard starts them from the resource's, so a
 * choice the person took back stays taken back — and the resource's when
 * none are sent. What neither says, {@link createTransferPolicy} fills from
 * the core's defaults.
 */
export function withTransferPolicyDefaults(
  defaults: TransferPolicyDefaults | null | undefined,
  chosen: Partial<TransferPolicy> = {},
): Partial<TransferPolicy> {
  if (!defaults) return chosen
  return {
    ...chosen,
    record: { ...DEFAULT_TRANSFER_RECORD_POLICY, ...defaults.record, ...chosen.record },
    fieldDefault: { ...DEFAULT_TRANSFER_FIELD_POLICY, ...defaults.fieldDefault, ...chosen.fieldDefault },
    fields: chosen.fields ?? { ...(defaults.fields ?? {}) },
  }
}

/**
 * The policy a person starts from: the core's defaults with the resource's
 * on top, and no row or field choice beyond the resource's own. The wizard
 * opens on this.
 */
export function startingTransferPolicy(
  defaults: TransferPolicyDefaults | null | undefined,
): Pick<TransferPolicy, 'record' | 'fieldDefault' | 'fields' | 'rows'> {
  return {
    record: { ...DEFAULT_TRANSFER_RECORD_POLICY, ...defaults?.record },
    fieldDefault: { ...DEFAULT_TRANSFER_FIELD_POLICY, ...defaults?.fieldDefault },
    fields: { ...(defaults?.fields ?? {}) },
    rows: {},
  }
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

/**
 * A resource's answer to "are these the same value" for one field (see the
 * block header) — `true` or `false`, or `undefined` to leave it to
 * {@link transferValuesEqual}.
 */
export type TransferValuesComparator = (field: TransferField, a: unknown, b: unknown) => boolean | undefined

/** Two values of `field` compared by the resource's comparator, then the core's. */
export function compareTransferValues(
  field: TransferField,
  a: unknown,
  b: unknown,
  comparator?: TransferValuesComparator,
): boolean {
  if (comparator) {
    const said = comparator(field, a, b)
    if (typeof said === 'boolean') return said
  }
  return transferValuesEqual(a, b)
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
 * touched. Blank means the cell was mapped and empty. `equal` decides
 * whether the value the record ends with differs from the one it holds —
 * the resource's comparator, when it has one.
 */
export function applyFieldPolicy(
  resolved: Pick<ResolvedFieldPolicy, 'mode' | 'blank' | 'refuseValues'>,
  before: unknown,
  incoming: unknown,
  equal: (a: unknown, b: unknown) => boolean = transferValuesEqual,
): FieldPolicyOutcome {
  const same = (after: unknown, rule: FieldPolicyOutcome['rule']): FieldPolicyOutcome => ({
    after,
    changed: !equal(before, after),
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
