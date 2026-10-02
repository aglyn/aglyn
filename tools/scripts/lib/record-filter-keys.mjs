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
 * A dataset record's filter fields, for plain Node scripts (AGL-3321).
 *
 * The records table queries `filterKeys` (word tokens, `array-contains`) and
 * `filterValues` (one scalar per field, `==`), which every writer stamps
 * through `datasetIntegrityFields` / `datasetIntegrityUpdate` in
 * `libs/plugins/data/src/lib/model/dataset-models.ts`. A script cannot import
 * that module (it imports other modules at run time), yet a backfill or a
 * seed must stamp exactly what the library stamps: a record spelled any
 * other way answers no filter. This file is the ONE script-side
 * restatement; the backfill and the seeds import it rather than carrying
 * their own.
 *
 * Both sides are held to `dataset-filter-keys.fixtures.json`: the library's
 * `dataset-filter-keys.spec.ts` asserts it against the TypeScript functions,
 * and `backfill-dataset-filter-keys.mjs --self-test` against these.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_MODEL = join(here, '..', '..', '..', 'libs', 'plugins', 'data', 'src', 'lib', 'model')

/** `DATASET_FILTER_KEYS_MAX`: the most tokens one record carries. */
export const DATASET_FILTER_KEYS_MAX = 500
/** `DATASET_FILTER_VALUE_MAX`: plain text is clipped to this in a key. */
export const DATASET_FILTER_VALUE_MAX = 64
/** `DATASET_FILTER_PREFIX_MAX`: word prefixes run from 1 to this. */
export const DATASET_FILTER_PREFIX_MAX = 12
/** `DATASET_FILTER_WORDS_MAX`: only this many words of a value count. */
export const DATASET_FILTER_WORDS_MAX = 40

/**
 * `datasetFilterWords`: split on anything not a letter or digit, lower-cased.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function datasetFilterWords(text) {
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, DATASET_FILTER_WORDS_MAX)
}

/** A word's prefixes, 1 to `DATASET_FILTER_PREFIX_MAX` characters. */
function prefixes(word) {
  const chars = Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX)
  return chars.map((_char, at) => chars.slice(0, at + 1).join(''))
}

/** A word clipped the way its stored prefixes are. */
function clipWord(word) {
  return Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX).join('')
}

const isEnum = (field) =>
  field.type === 'text' && (field.validation?.options?.length ?? 0) > 0

const isNumeric = (field) =>
  field.type === 'int32' || field.type === 'int64' || field.type === 'float'

/** A stored value as text, or null. */
function asText(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * `datasetFilterTextKey`: lower-cased, trimmed, clipped.
 *
 * @param {string} value
 * @returns {string}
 */
export function datasetFilterTextKey(value) {
  return Array.from(value.trim().toLowerCase())
    .slice(0, DATASET_FILTER_VALUE_MAX)
    .join('')
}

/** A stored number (or its text form) as its key. */
function numberKey(value) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return Number.isFinite(number) ? String(number) : null
}

/** A stored boolean (or its text form) as its key. */
function boolKey(value) {
  if (typeof value === 'boolean') return String(value)
  if (value === 'true' || value === 'false') return value
  return null
}

/** Every field a model declares, in display order and then the rest. */
function modelFieldIds(model) {
  return [...new Set([...(model.order ?? []), ...Object.keys(model.fields ?? {})])]
}

/**
 * `datasetFilterKeys`: the sorted, de-duplicated, capped token array.
 *
 * @param {{ fields?: Record<string, any>, order?: string[] }} model
 * @param {Record<string, unknown> | undefined} values
 * @returns {string[]}
 */
export function datasetFilterKeys(model, values) {
  const exact = []
  const fieldWords = []
  const search = []
  const searchable = (text) => {
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
        exact.push(`f:${fieldId}=${datasetFilterTextKey(text)}`)
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

/** `FILTER_VALUE_ID`: field ids a query path can name. */
const FILTER_VALUE_ID = /^[^.~*/[\]`]+$/

/**
 * `datasetFilterValuePath`: `filterValues.<id>`, or null.
 *
 * @param {string} fieldId
 * @returns {string | null}
 */
export function datasetFilterValuePath(fieldId) {
  return FILTER_VALUE_ID.test(fieldId) && !/^__.*__$/.test(fieldId)
    ? `filterValues.${fieldId}`
    : null
}

/**
 * `datasetFilterValues`: `{ [fieldId]: scalar }` for enum text, plain text,
 * booleans and numbers.
 *
 * @param {{ fields?: Record<string, any>, order?: string[] }} model
 * @param {Record<string, unknown> | undefined} values
 * @returns {Record<string, string | number | boolean>}
 */
export function datasetFilterValues(model, values) {
  const out = {}
  for (const fieldId of modelFieldIds(model)) {
    const field = model.fields?.[fieldId]
    const stored = values?.[fieldId]
    if (!field || stored == null || !datasetFilterValuePath(fieldId)) continue
    if (field.type === 'text') {
      const text = asText(stored)
      if (text == null || !text.trim()) continue
      out[fieldId] = isEnum(field) ? text : datasetFilterTextKey(text)
    } else if (field.type === 'bool') {
      const key = boolKey(stored)
      if (key) out[fieldId] = key === 'true'
    } else if (isNumeric(field)) {
      const key = numberKey(stored)
      if (key) out[fieldId] = Number(key)
    }
  }
  return out
}

/**
 * `datasetFilterToken`: the `filterKeys` token a clause asks for, or null.
 *
 * @param {{ fields?: Record<string, any> }} model
 * @param {{ field: string, op: string, value: string }} clause
 * @returns {string | null}
 */
export function datasetFilterToken(model, clause) {
  const field = model.fields?.[clause.field]
  if (!field) return null
  const { op } = clause
  const value = String(clause.value ?? '')
  if (!value.trim()) return null
  const equals = op === 'equals' || op === '=' || op === 'is'
  if (field.type === 'text') {
    if (isEnum(field)) return equals ? `f:${clause.field}=${value}` : null
    if (equals) return `f:${clause.field}=${datasetFilterTextKey(value)}`
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
 * `datasetSearchToken`: the quick-search token for one typed word, or null.
 *
 * @param {string} word
 * @returns {string | null}
 */
export function datasetSearchToken(word) {
  const [first] = datasetFilterWords(word)
  return first ? `s:${clipWord(first)}` : null
}

/**
 * `datasetIntegrityFields`, minus `referencedIds`, for a script that CREATES
 * a record: the filter fields, each omitted when empty.
 *
 * @param {{ fields?: Record<string, any>, order?: string[] }} model
 * @param {Record<string, unknown> | undefined} values
 */
export function datasetFilterFields(model, values) {
  const filterKeys = datasetFilterKeys(model, values)
  const filterValues = datasetFilterValues(model, values)
  return {
    ...(filterKeys.length ? { filterKeys } : {}),
    ...(Object.keys(filterValues).length ? { filterValues } : {}),
  }
}

/**
 * `effectiveDatasetModel`, reduced to what reaches the filter fields (ids and
 * types): a v1 dataset's `fields` list is every column as a text field.
 * {@link modelShimAgrees} checks the library still says so.
 */
export function effectiveModel(dataset) {
  const model = dataset.model
  if (model?.fields && model.order?.length) return model
  const fields = Array.isArray(dataset.fields) ? dataset.fields : []
  return {
    fields: Object.fromEntries(fields.map((name) => [name, { name, type: 'text' }])),
    order: [...fields],
  }
}

/** The source guard: {@link effectiveModel} still restates the library's rule. */
export function modelShimAgrees(source) {
  const code = source ?? readFileSync(join(DATA_MODEL, 'dataset-models.ts'), 'utf8')
  const at = code.indexOf('export function effectiveDatasetModel(')
  if (at < 0) {
    return { ok: false, why: '`effectiveDatasetModel` not found in dataset-models.ts' }
  }
  const body = code.slice(at, at + 400)
  const ok =
    body.includes('dataset.model?.fields && dataset.model.order?.length') &&
    body.includes('deriveModelFromFields(dataset.fields ?? [])')
  return {
    ok,
    why: ok
      ? '`effectiveDatasetModel` matches the shim'
      : '`effectiveDatasetModel` changed — update `effectiveModel` in lib/record-filter-keys.mjs',
  }
}
