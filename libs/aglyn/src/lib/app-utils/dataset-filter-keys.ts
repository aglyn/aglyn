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

// TYPE imports only. `tools/scripts/backfill-dataset-filter-keys.mjs` imports
// this file directly under Node's type stripping, which erases these lines and
// would fail on any import that has to resolve at run time.
import type { DatasetFieldDefinition, DatasetModel } from './dataset-models'

/**
 * A dataset record's FILTER TOKENS: every question the records table can ask
 * of a record, flattened into one array of strings Firestore indexes on its
 * own.
 *
 * ## Why a token array, and not the values
 *
 * A record's fields live under `values`, a user-defined, unbounded map that
 * the index configuration exempts from indexing — auto-indexing it can exceed
 * Firestore's per-document index-entry limit — so `where('values.<field>', …)`
 * is refused. A composite index per dataset would need an admin call per
 * dataset, runs into the project's composite-index cap, and is deleted by the
 * next `firestore:indexes` deploy of a file that does not list it.
 *
 * `filterKeys` needs none of that. Firestore's AUTOMATIC single-field index
 * serves `where('filterKeys', 'array-contains', token)` with
 * `orderBy(documentId())`, so one clause, or one search word, reaches every
 * record of any dataset on any project, with no index deploy.
 *
 * ## The token grammar
 *
 *   `f:<fieldId>=<value>`   a field equals a value. Enum (a text field with
 *                           `validation.options`) values are kept exactly;
 *                           plain text is lower-cased, trimmed and clipped to
 *                           {@link DATASET_FILTER_VALUE_MAX} characters;
 *                           booleans are `true`/`false`; numbers are
 *                           `String(number)`; a `sorted` list contributes one
 *                           token per member.
 *   `f:<fieldId>^<prefix>`  a word of a plain text field starts with this.
 *   `s:<prefix>`            a word of ANY text value (enums and list members
 *                           included) starts with this — the quick search.
 *
 * Timestamps, references, maps, bytes, coordinates and nil fields carry no
 * field tokens: a timestamp is asked in ranges, which one token cannot serve,
 * and the rest are not asked about by value.
 *
 * The array is sorted, de-duplicated and capped at
 * {@link DATASET_FILTER_KEYS_MAX}. Past the cap, the `=` tokens are kept
 * first, then the per-field word prefixes, then the search prefixes, so a
 * very long record loses search reach before it loses exact matches.
 */
export const DATASET_FILTER_KEYS_MAX = 500

/** Plain text values are clipped to this many characters in an `=` token. */
export const DATASET_FILTER_VALUE_MAX = 64
/** Word prefixes run from 1 to this many characters. */
export const DATASET_FILTER_PREFIX_MAX = 12
/** Only the first this-many words of a value contribute prefixes. */
export const DATASET_FILTER_WORDS_MAX = 40

/** One clause of the records table's filter: `{ field, op, value }`. */
export interface DatasetFilterClause {
  field: string
  op: string
  value: string
}

/**
 * The words of a text value: split on anything that is not a letter or a
 * digit, lower-cased, at most {@link DATASET_FILTER_WORDS_MAX} of them.
 */
export function datasetFilterWords(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, DATASET_FILTER_WORDS_MAX)
}

/** A word's prefixes, 1 to {@link DATASET_FILTER_PREFIX_MAX} characters. */
function prefixes(word: string): string[] {
  const chars = Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX)
  return chars.map((_char, at) => chars.slice(0, at + 1).join(''))
}

/** A word clipped the way its stored prefixes are. */
function clipWord(word: string): string {
  return Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX).join('')
}

const isEnum = (field: DatasetFieldDefinition): boolean =>
  field.type === 'text' && (field.validation?.options?.length ?? 0) > 0

const isNumeric = (field: DatasetFieldDefinition): boolean =>
  field.type === 'int32' || field.type === 'int64' || field.type === 'float'

/**
 * A stored value as text, or null. Numbers are accepted because a form or an
 * automation stores every value as text and an import may do the reverse.
 */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Plain text as its `=` token's value: lower-cased, trimmed, clipped. */
function textKey(value: string): string {
  return Array.from(value.trim().toLowerCase())
    .slice(0, DATASET_FILTER_VALUE_MAX)
    .join('')
}

/** A stored number (or its text form) as its `=` token's value. */
function numberKey(value: unknown): string | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) ? String(number) : null
}

/** A stored boolean (or its text form) as its `=` token's value. */
function boolKey(value: unknown): string | null {
  if (typeof value === 'boolean') return String(value)
  if (value === 'true' || value === 'false') return value
  return null
}

/** Every field a model declares, in display order and then the rest. */
function modelFieldIds(model: DatasetModel): string[] {
  return [...new Set([...(model.order ?? []), ...Object.keys(model.fields ?? {})])]
}

/** The tokens described in {@link DATASET_FILTER_KEYS_MAX}'s comment. */
export function datasetFilterKeys(
  model: DatasetModel,
  values: Record<string, unknown> | undefined,
): string[] {
  const exact: string[] = []
  const fieldWords: string[] = []
  const search: string[] = []
  const searchable = (text: string) => {
    for (const word of datasetFilterWords(text)) {
      for (const prefix of prefixes(word)) search.push(`s:${prefix}`)
    }
  }
  for (const fieldId of modelFieldIds(model)) {
    const field = model.fields?.[fieldId]
    const stored = values?.[fieldId]
    if (!field || stored == null) continue
    if (field.type === 'text') {
      const text = asText(stored)
      if (text == null || !text.trim()) continue
      if (isEnum(field)) {
        exact.push(`f:${fieldId}=${text}`)
      } else {
        exact.push(`f:${fieldId}=${textKey(text)}`)
        for (const word of datasetFilterWords(text)) {
          for (const prefix of prefixes(word)) {
            fieldWords.push(`f:${fieldId}^${prefix}`)
          }
        }
      }
      searchable(text)
    } else if (field.type === 'bool') {
      const key = boolKey(stored)
      if (key) exact.push(`f:${fieldId}=${key}`)
    } else if (isNumeric(field)) {
      const key = numberKey(stored)
      if (key) exact.push(`f:${fieldId}=${key}`)
    } else if (field.type === 'sorted') {
      for (const member of Array.isArray(stored) ? stored : [stored]) {
        const text = asText(member)?.trim()
        if (!text) continue
        exact.push(`f:${fieldId}=${text}`)
        searchable(text)
      }
    }
  }
  const kept = [...new Set([...exact, ...fieldWords, ...search])].slice(
    0,
    DATASET_FILTER_KEYS_MAX,
  )
  return kept.sort()
}

/**
 * The one token that serves a filter clause over every record, or null when
 * no token can: the clause is then matched over a window of records instead.
 *
 *  - enum, boolean, number and list `equals` → the `=` token of the value;
 *  - plain text `equals` → the lower-cased `=` token;
 *  - plain text `contains` → the `^` token of the value's FIRST word, so a
 *    served `contains` is a word-prefix match, not a mid-string one;
 *  - everything else — ranges, dates, `isEmpty`, `isAnyOf`, negations — null.
 *
 * `clause.field` is the field id. The operator names are the grid's: a
 * select's `equals`, a number's `=`, a boolean's `is`, a list's `contains`.
 */
export function datasetFilterToken(
  model: DatasetModel,
  clause: DatasetFilterClause,
): string | null {
  const field = model.fields?.[clause.field]
  if (!field) return null
  const { op } = clause
  const value = String(clause.value ?? '')
  if (!value.trim()) return null
  const equals = op === 'equals' || op === '=' || op === 'is'
  if (field.type === 'text') {
    if (isEnum(field)) return equals ? `f:${clause.field}=${value}` : null
    if (equals) return `f:${clause.field}=${textKey(value)}`
    if (op === 'contains') {
      const [first] = datasetFilterWords(value)
      return first ? `f:${clause.field}^${clipWord(first)}` : null
    }
    return null
  }
  if (field.type === 'bool') {
    const key = boolKey(value.trim())
    return equals && key ? `f:${clause.field}=${key}` : null
  }
  if (isNumeric(field)) {
    const key = numberKey(value)
    return equals && key ? `f:${clause.field}=${key}` : null
  }
  if (field.type === 'sorted') {
    return equals || op === 'contains' ? `f:${clause.field}=${value.trim()}` : null
  }
  return null
}

/**
 * Every token a record must hold to answer a clause, or null when the clause
 * is not token-served. The same as {@link datasetFilterToken} except for a
 * plain text `contains` of several words, which needs each word's prefix —
 * the query can serve only one of them, and the rest are matched over the
 * rows it returns, by these same tokens, so both answers agree.
 */
export function datasetFilterTokens(
  model: DatasetModel,
  clause: DatasetFilterClause,
): string[] | null {
  const first = datasetFilterToken(model, clause)
  if (!first) return null
  const field = model.fields?.[clause.field]
  if (field?.type === 'text' && !isEnum(field) && clause.op === 'contains') {
    return datasetFilterWords(clause.value).map(
      (word) => `f:${clause.field}^${clipWord(word)}`,
    )
  }
  return [first]
}

/**
 * The quick-search token for one typed word, or null for a word with no
 * letters or digits. A word with punctuation inside it is asked by its first
 * run — split the search text with {@link datasetFilterWords} to ask for
 * every run.
 */
export function datasetSearchToken(word: string): string | null {
  const [first] = datasetFilterWords(word)
  return first ? `s:${clipWord(first)}` : null
}
