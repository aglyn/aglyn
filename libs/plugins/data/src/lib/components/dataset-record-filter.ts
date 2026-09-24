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

import {
  type DatasetModel,
  datasetFilterKeys,
  datasetFilterToken,
  datasetFilterTokens,
  datasetFilterWords,
  datasetSearchToken,
} from '@aglyn/aglyn'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  filterListRows,
  inMemoryListField,
  type ListFilterClause,
  type ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/**
 * How many records a filter the query cannot serve on its own is matched
 * over. Past it the card says the window was full; a single clause or a
 * single search word reaches every record without one.
 */
export const RECORD_FILTER_WINDOW = 1000

/**
 * The grid column a dataset field is shown in. Prefixed, because field ids
 * are the dataset author's and may be any name, `actions` included.
 */
export const recordColumn = (fieldId: string) => `values.${fieldId}`
const COLUMN_PREFIX = recordColumn('')
const fieldIdOf = (column: string) =>
  column.startsWith(COLUMN_PREFIX) ? column.slice(COLUMN_PREFIX.length) : column

/** What the records grid's Filters panel offers for one dataset model. */
export interface DatasetRecordFilter {
  fields: ListFilterField[]
  options: Record<string, ListFilterOption[]>
  headers: Record<string, string>
  selectFields: string[]
}

const BOOLEAN_OPTIONS: ListFilterOption[] = [
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
]

/**
 * The model's fields as filter fields, each reading the record row at
 * `values.<fieldId>`: an enum is a select over its options, a boolean a
 * true/false select, numbers and timestamps number and date fields, a list a
 * member match, and plain text a text field. References, maps, bytes,
 * coordinates and nil fields offer no filter.
 */
export function datasetRecordFilter(model: DatasetModel): DatasetRecordFilter {
  const fields: ListFilterField[] = []
  const options: Record<string, ListFilterOption[]> = {}
  const headers: Record<string, string> = {}
  const selectFields: string[] = []
  for (const fieldId of model.order ?? []) {
    const field = model.fields?.[fieldId]
    if (!field) continue
    const column = recordColumn(fieldId)
    const choices = field.type === 'text' ? (field.validation?.options ?? []) : []
    let declared: ListFilterField | null = null
    if (field.type === 'text' && choices.length) {
      declared = inMemoryListField(column, 'select')
      options[column] = choices.map((choice) => ({ value: choice, label: choice }))
    } else if (field.type === 'text') {
      declared = inMemoryListField(column, 'text')
    } else if (field.type === 'bool') {
      declared = inMemoryListField(column, 'select')
      options[column] = BOOLEAN_OPTIONS
    } else if (field.type === 'int32' || field.type === 'int64' || field.type === 'float') {
      declared = inMemoryListField(column, 'number')
    } else if (field.type === 'timestamp') {
      declared = inMemoryListField(column, 'date')
    } else if (field.type === 'sorted') {
      // A list matches by whole member, as its `=` tokens do.
      declared = {
        column,
        path: column,
        kind: 'text',
        tokensPath: column,
        verbatimTokens: true,
        operators: ['contains', 'isEmpty', 'isNotEmpty'],
      }
    }
    if (!declared) continue
    fields.push(declared)
    headers[column] = field.name || fieldId
    if (options[column]) selectFields.push(column)
  }
  return { fields, options, headers, selectFields }
}

/** Which condition the query serves, and what is left to match in memory. */
export interface RecordFilterPlan {
  /** The `filterKeys` token the query narrows by, or null for the plain walk. */
  token: string | null
  /** The column of the served clause; null when a search word is served. */
  servedField: string | null
  /** Whether anything is left for the window to match. */
  windowed: boolean
  /** Every token each token-served clause needs, by clause index. */
  clauseTokens: Array<string[] | null>
  /** Every quick-search token, one per word. */
  searchTokens: string[]
  clauses: readonly ListFilterClause[]
}

const asFieldClause = (clause: ListFilterClause) => ({
  field: fieldIdOf(clause.field),
  op: clause.op,
  value: clause.value,
})

/**
 * The served condition is the first clause a token answers, else the first
 * search word; the walk is windowed whenever anything else is in force.
 */
export function planRecordFilter(
  model: DatasetModel,
  clauses: readonly ListFilterClause[],
  searchWords: readonly string[],
): RecordFilterPlan {
  const clauseTokens = clauses.map((clause) =>
    datasetFilterTokens(model, asFieldClause(clause)),
  )
  const searchTokens = [
    ...new Set(
      searchWords
        .flatMap((word) => datasetFilterWords(word))
        .map((word) => datasetSearchToken(word))
        .filter((token): token is string => Boolean(token)),
    ),
  ]
  const servedAt = clauses.findIndex((clause) =>
    Boolean(datasetFilterToken(model, asFieldClause(clause))),
  )
  const token =
    servedAt >= 0
      ? datasetFilterToken(model, asFieldClause(clauses[servedAt]))
      : (searchTokens[0] ?? null)
  const complete =
    servedAt >= 0
      ? clauses.length === 1 &&
        searchTokens.length === 0 &&
        clauseTokens[servedAt]?.length === 1
      : clauses.length === 0 && searchTokens.length <= 1
  return {
    token,
    servedField: servedAt >= 0 ? clauses[servedAt].field : null,
    windowed: !complete,
    clauseTokens,
    searchTokens,
    clauses,
  }
}

/**
 * The window's records that answer every condition.
 *
 * A token-served clause and the quick search are matched by the SAME tokens
 * the query uses, computed from the record's values under the current model,
 * so a record answers in memory exactly when it would answer on the server —
 * a text `contains` is a word-prefix match either way. Everything else
 * (ranges, dates, empty checks, negations, `isAnyOf`) is matched by the
 * shared grammar over `values.<fieldId>`.
 */
export function matchRecordWindow<Row extends { values?: Record<string, unknown> }>(
  model: DatasetModel,
  fields: readonly ListFilterField[],
  rows: readonly Row[],
  plan: RecordFilterPlan,
): Row[] {
  const served = new Set(
    plan.clauses.filter((_clause, at) => plan.clauseTokens[at] !== null),
  )
  const needed = [
    ...plan.clauseTokens.flatMap((tokens) => tokens ?? []),
    ...plan.searchTokens,
  ]
  const rest = filterListRows(
    rows,
    fields,
    plan.clauses,
    { paths: [], words: [] },
    (clause) => served.has(clause),
  )
  if (!needed.length) return rest
  return rest.filter((row) => {
    const keys = new Set(datasetFilterKeys(model, row.values))
    return needed.every((token) => keys.has(token))
  })
}
