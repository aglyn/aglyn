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
 * PICKLIST MAPPING — what to do with a file's values a picklist does not hold.
 *
 * For each picklist column the wizard lists the DISTINCT values the file
 * carries. A value the organization's list already holds (by label in any
 * case or spacing, or by value id) is matched. Every other value gets a
 * choice, made once and applied to every row that carries it:
 *
 *  - map it to an existing value;
 *  - add it to the organization's list as a new value (with a group, and a
 *    meaning when the list needs one);
 *  - leave the field blank on those rows;
 *  - refuse those rows.
 *
 * Built on the picklist engine (`app-utils/picklists.ts`): labels compare
 * by its key, new value ids are minted by it, and an added value can never
 * take a standard value's id.
 *=========================================*/

import {
  PICKLIST_VALUES_MAX,
  mintPicklistValueId,
  normalizePicklistLabel,
  picklistLabelKey,
  picklistValueByLabel,
} from '../app-utils/picklists'
import type { PicklistSpec, PicklistValue, PicklistValueSet } from '../app-utils/picklists'
import { textSimilarity } from './similarity'

/** One distinct value of a column, with where it occurs. */
export interface PicklistIncomingValue {
  /** The first spelling the file used. */
  value: string
  /** The comparison key ({@link picklistLabelKey}). */
  key: string
  /** How many cells carry it. */
  count: number
  /** The first few row indexes that carry it. */
  rows: number[]
}

/** How many row indexes a distinct value keeps as samples. */
export const PICKLIST_SAMPLE_ROWS = 5

/**
 * The distinct values of a column, in the order first seen. A multi-value
 * cell (an array) counts each of its values.
 */
export function collectPicklistValues(
  cells: Iterable<{ row: number; value: unknown }>,
): PicklistIncomingValue[] {
  const byKey = new Map<string, PicklistIncomingValue>()
  for (const { row, value } of cells) {
    const values = Array.isArray(value) ? value : [value]
    for (const entry of values) {
      const label = normalizePicklistLabel(entry)
      if (!label) continue
      const key = picklistLabelKey(label)
      const seen = byKey.get(key)
      if (seen) {
        seen.count += 1
        if (seen.rows.length < PICKLIST_SAMPLE_ROWS && !seen.rows.includes(row)) seen.rows.push(row)
      } else {
        byKey.set(key, { value: label, key, count: 1, rows: [row] })
      }
    }
  }
  return [...byKey.values()]
}

/** A value of the list an incoming value might have meant. */
export interface PicklistSuggestion {
  valueId: string
  label: string
  confidence: number
}

/** An incoming value the list holds. */
export interface PicklistMatched extends PicklistIncomingValue {
  valueId: string
  /** The label as the list spells it — what records store. */
  label: string
  /** The list holds it deactivated; storing it is allowed but worth a word. */
  inactive: boolean
  /** Matched by value id rather than by label. */
  byId: boolean
}

/** An incoming value the list does not hold. */
export interface PicklistUnmatched extends PicklistIncomingValue {
  /** The list's values it is closest to, strongest first. */
  suggestions: PicklistSuggestion[]
}

export interface PicklistMatchResult {
  matched: PicklistMatched[]
  unmatched: PicklistUnmatched[]
}

/** The least similarity a suggestion is offered at. */
export const PICKLIST_SUGGESTION_THRESHOLD = 0.6

/**
 * The incoming values against the organization's effective list. A value
 * matches a list value by label (any case or spacing) or by id; the rest
 * are unmatched, each with the closest list values as suggestions.
 */
export function matchPicklistValues(
  set: PicklistValueSet,
  incoming: readonly PicklistIncomingValue[],
): PicklistMatchResult {
  const matched: PicklistMatched[] = []
  const unmatched: PicklistUnmatched[] = []
  for (const value of incoming) {
    const byLabel = picklistValueByLabel(set, value.value)
    const byId =
      byLabel ?? set.values.find((entry) => entry.id.toLowerCase() === value.value.toLowerCase()) ?? null
    if (byId) {
      matched.push({ ...value, valueId: byId.id, label: byId.label, inactive: !byId.active, byId: !byLabel })
      continue
    }
    const suggestions = set.values
      .filter((entry) => entry.active)
      .map((entry) => ({
        valueId: entry.id,
        label: entry.label,
        confidence: Math.round(textSimilarity(value.value, entry.label) * 1000) / 1000,
      }))
      .filter((entry) => entry.confidence >= PICKLIST_SUGGESTION_THRESHOLD)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
    unmatched.push({ ...value, suggestions })
  }
  return { matched, unmatched }
}

/** What to do with one unmatched value. */
export type PicklistValueChoice =
  | { action: 'mapTo'; valueId: string }
  | { action: 'addValue'; label?: string; group?: string | null; meaning?: string | null }
  | { action: 'leaveBlank' }
  | { action: 'refuseRow' }

/** The suggestion confidence at which "map to it" is proposed outright. */
export const PICKLIST_AUTO_MAP_CONFIDENCE = 0.9

/**
 * The choice proposed before the person decides: map to a near-certain
 * suggestion; else add the value to an open list (an unrestricted one with
 * no meanings, which would store it as typed anyway); else leave it blank.
 * Every proposal is shown and can be changed — none is applied unseen.
 */
export function proposePicklistChoice(spec: PicklistSpec, value: PicklistUnmatched): PicklistValueChoice {
  const top = value.suggestions[0]
  if (top && top.confidence >= PICKLIST_AUTO_MAP_CONFIDENCE) return { action: 'mapTo', valueId: top.valueId }
  if (!spec.restricted && !spec.meanings?.length) return { action: 'addValue' }
  return { action: 'leaveBlank' }
}

/**
 * What is wrong with a set of choices, as sentences: a value with no
 * choice, a mapping to a value the list does not hold, an added value that
 * needs a meaning or names an unknown group or meaning, two added values
 * with one label, or more values than a list may hold.
 */
export function picklistChoiceProblems(
  spec: PicklistSpec,
  set: PicklistValueSet,
  unmatched: readonly PicklistUnmatched[],
  choices: Readonly<Record<string, PicklistValueChoice | undefined>>,
): string[] {
  const problems: string[] = []
  const labels = new Set(set.values.map((value) => picklistLabelKey(value.label)))
  let added = 0
  for (const value of unmatched) {
    const choice = choices[value.key]
    if (!choice) {
      problems.push(`Choose what to do with "${value.value}".`)
      continue
    }
    if (choice.action === 'mapTo' && !set.values.some((entry) => entry.id === choice.valueId)) {
      problems.push(`"${value.value}" is mapped to a value the list does not hold.`)
    }
    if (choice.action !== 'addValue') continue
    added += 1
    const label = normalizePicklistLabel(choice.label ?? value.value)
    if (!label) problems.push(`"${value.value}" needs a label to be added.`)
    else if (labels.has(picklistLabelKey(label))) problems.push(`"${label}" is already in the list or added twice.`)
    labels.add(picklistLabelKey(label))
    if (spec.meanings?.length) {
      if (!choice.meaning) problems.push(`"${label}" needs a meaning to be added.`)
      else if (!spec.meanings.includes(choice.meaning)) problems.push(`"${label}" names an unknown meaning.`)
    }
    if (choice.group && !spec.groups?.some((group) => group.id === choice.group)) {
      problems.push(`"${label}" names an unknown group.`)
    }
  }
  if (set.values.length + added > PICKLIST_VALUES_MAX) {
    problems.push(`A list holds at most ${PICKLIST_VALUES_MAX} values; this would make ${set.values.length + added}.`)
  }
  return problems
}

/** What one incoming value becomes. */
export type PicklistCellOutcome =
  | { kind: 'value'; label: string; valueId: string }
  | { kind: 'blank' }
  | { kind: 'refuse' }

/** The choices applied: the list with added values, and how each incoming value resolves. */
export interface PicklistResolution {
  /** The list with every added value appended, active. */
  set: PicklistValueSet
  /** The values to add to the organization's list. */
  added: PicklistValue[]
  /** Incoming key → outcome, for matched and unmatched values alike. */
  outcomes: Map<string, PicklistCellOutcome>
}

/**
 * The choices applied to the list. Matched values resolve to the list's
 * own label; added values are minted ids that never collide with a stored
 * or standard id. A value with no choice resolves to blank — callers check
 * {@link picklistChoiceProblems} first.
 */
export function resolvePicklistChoices(
  spec: PicklistSpec,
  set: PicklistValueSet,
  result: PicklistMatchResult,
  choices: Readonly<Record<string, PicklistValueChoice | undefined>>,
): PicklistResolution {
  const values = set.values.map((value) => ({ ...value }))
  const added: PicklistValue[] = []
  const outcomes = new Map<string, PicklistCellOutcome>()
  for (const value of result.matched) {
    outcomes.set(value.key, { kind: 'value', label: value.label, valueId: value.valueId })
  }
  const taken = (): string[] => [...values.map((value) => value.id), ...spec.standardValues.map((value) => value.id)]
  for (const value of result.unmatched) {
    const choice = choices[value.key]
    if (choice?.action === 'mapTo') {
      const target = values.find((entry) => entry.id === choice.valueId)
      outcomes.set(value.key, target ? { kind: 'value', label: target.label, valueId: target.id } : { kind: 'blank' })
    } else if (choice?.action === 'addValue') {
      const label = normalizePicklistLabel(choice.label ?? value.value)
      const existing = values.find((entry) => picklistLabelKey(entry.label) === picklistLabelKey(label))
      if (existing) {
        outcomes.set(value.key, { kind: 'value', label: existing.label, valueId: existing.id })
        continue
      }
      const entry: PicklistValue = {
        id: mintPicklistValueId(label, taken()),
        label,
        active: true,
        ...(spec.groups?.length ? { group: choice.group ?? null } : {}),
        ...(spec.meanings?.length ? { meaning: choice.meaning ?? null } : {}),
      }
      values.push(entry)
      added.push(entry)
      outcomes.set(value.key, { kind: 'value', label: entry.label, valueId: entry.id })
    } else if (choice?.action === 'refuseRow') {
      outcomes.set(value.key, { kind: 'refuse' })
    } else {
      outcomes.set(value.key, { kind: 'blank' })
    }
  }
  return { set: { values, defaultValueId: set.defaultValueId }, added, outcomes }
}

/** One cell through a resolution: the label to store, blank, or refuse the row. */
export function resolvePicklistCell(resolution: PicklistResolution, raw: unknown): PicklistCellOutcome {
  const label = normalizePicklistLabel(raw)
  if (!label) return { kind: 'blank' }
  return resolution.outcomes.get(picklistLabelKey(label)) ?? { kind: 'blank' }
}

/**
 * A multi-value cell through a resolution: the labels to store, in order and
 * without repeats; `refuse` when any value refuses the row.
 */
export function resolveMultiPicklistCell(
  resolution: PicklistResolution,
  raw: readonly unknown[],
): { kind: 'values'; labels: string[] } | { kind: 'refuse' } {
  const labels: string[] = []
  for (const entry of raw) {
    const outcome = resolvePicklistCell(resolution, entry)
    if (outcome.kind === 'refuse') return { kind: 'refuse' }
    if (outcome.kind === 'value' && !labels.includes(outcome.label)) labels.push(outcome.label)
  }
  return { kind: 'values', labels }
}
