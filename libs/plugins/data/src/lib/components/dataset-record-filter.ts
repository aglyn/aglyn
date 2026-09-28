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
  DATASET_FILTER_PREFIX_MAX,
  type DatasetModel,
  datasetFilterTextKey,
  datasetFilterToken,
  datasetFilterValuePath,
  datasetFilterWords,
  datasetSearchToken,
} from '@aglyn/aglyn'
import type { ListFilterField, ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListFilterClause,
  ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryNormalizers,
  type ListQueryPlan,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE RECORDS TABLE IS ONE QUERY (AGL-3321).
 *
 * Every clause in the Filters panel and the quick-search word are
 * predicates on the records query, planned by the shared `planListQuery`
 * and answered by Firestore; nothing is matched over rows already loaded.
 *
 * A record's fields live under `values`, which is exempt from indexing (see
 * `datasetFilterKeys`), so the query reads the two fields every writer
 * stamps beside it:
 *
 *   `filterValues.<fieldId> ==`       an equality — a picked option, a
 *                                     boolean, a number, plain text (by its
 *                                     lower-cased key);
 *   `filterKeys array-contains`       ONE word-level clause — a text
 *                                     `contains` (`f:<id>^<prefix>`), a list
 *                                     member (`f:<id>=<member>`), or the
 *                                     quick-search word (`s:<prefix>`).
 *
 * Firestore's automatic single-field indexes compose any number of those
 * equalities and one `array-contains` under `orderBy(documentId())` by index
 * merging, so the table needs NO composite index — which it could not have:
 * every dataset's fields are its author's, and a composite per field per
 * dataset is not something an index file can list.
 *
 * What one such query cannot hold is not offered, or refused by name:
 *
 *   - no ranges. `>` on a number or a date on a timestamp is one inequality,
 *     which must then lead the order, and beside any equality it needs a
 *     composite per dataset. Numbers offer `=`, timestamps nothing.
 *   - no negations and no empty checks: Firestore has neither for a field a
 *     writer omits.
 *   - one array clause: a `contains` beside the search, or a second
 *     `contains`, is refused through `ListQueryNotices`, never half-applied.
 *   - one word of a `contains` or a search: the first word is asked, and the
 *     table says so for the rest.
 */

/** The array the word-level clauses and the quick search ask. */
const TOKENS_PATH = 'filterKeys'

/**
 * The grid column a dataset field is shown in. Prefixed, because field ids
 * are the dataset author's and may be any name, `actions` included.
 */
export const recordColumn = (fieldId: string) => `values.${fieldId}`
const COLUMN_PREFIX = recordColumn('')
const fieldIdOf = (column: string) =>
  column.startsWith(COLUMN_PREFIX) ? column.slice(COLUMN_PREFIX.length) : column

/**
 * How the records' filter fields were normalized (`dataset-models.ts`): a
 * typed text value becomes its `filterValues` key, and a search word its
 * `s:` token — so the query asks for exactly what the writers stored.
 */
export const datasetRecordNormalizers: ListQueryNormalizers = {
  key: datasetFilterTextKey,
  token: (value) => datasetSearchToken(value) ?? '',
  // No field offers `endsWith`, so nothing is ever reversed.
  reversed: (value) => value,
  maxPrefix: DATASET_FILTER_PREFIX_MAX,
}

/** What the records grid's Filters panel offers for one dataset model. */
export interface DatasetRecordFilter {
  /** The query declaration: every field below, the id order, the search. */
  declaration: ListQueryDeclaration
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
 * The model's fields as query fields, each shown in column
 * `values.<fieldId>`:
 *
 *   enum text     picked: is, is any of          `filterValues.<id>`
 *   plain text    contains (one word), equals,   `filterKeys`,
 *                 is any of (ignoring case)      `filterValues.<id>`
 *   bool          picked: is                     `filterValues.<id>`
 *   numbers       =                              `filterValues.<id>`
 *   list          contains (a whole member)      `filterKeys`
 *
 * Timestamps, references, maps, bytes, coordinates and nil fields offer no
 * filter. A field whose id no query path can name (a v1 column with a `.`
 * in it — `datasetFilterValuePath`) offers only its `contains`.
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
    const valuePath = datasetFilterValuePath(fieldId)
    const choices = field.type === 'text' ? (field.validation?.options ?? []) : []
    let declared: ListFilterField | null = null
    if (field.type === 'text' && choices.length) {
      if (valuePath) {
        declared = { column, kind: 'exact', path: valuePath, operators: ['equals', 'isAnyOf'] }
        options[column] = choices.map((choice) => ({ value: choice, label: choice }))
      }
    } else if (field.type === 'text') {
      // A `contains` asks the token the clause's value is turned into
      // (`recordQueryClause`), matched as given.
      declared = {
        column,
        kind: 'text',
        path: valuePath ?? column,
        tokensPath: TOKENS_PATH,
        verbatimTokens: true,
        ...(valuePath ? { lowerPath: valuePath } : {}),
        operators: valuePath ? ['contains', 'equals', 'isAnyOf'] : ['contains'],
      }
    } else if (field.type === 'bool') {
      if (valuePath) {
        declared = { column, kind: 'boolean', path: valuePath, operators: ['equals'] }
        options[column] = BOOLEAN_OPTIONS
      }
    } else if (field.type === 'int32' || field.type === 'int64' || field.type === 'float') {
      if (valuePath) declared = { column, kind: 'number', path: valuePath, operators: ['='] }
    } else if (field.type === 'sorted') {
      declared = {
        column,
        kind: 'text',
        path: column,
        tokensPath: TOKENS_PATH,
        verbatimTokens: true,
        operators: ['contains'],
      }
    }
    if (!declared) continue
    fields.push(declared)
    headers[column] = field.name || fieldId
    if (options[column]) selectFields.push(column)
  }
  return {
    declaration: {
      fields,
      // The document name: the one order no record can be missing (see the
      // card), and the one every automatic index already ends in.
      sorts: [{ path: LIST_QUERY_ID_PATH, direction: 'asc' }],
      search: { tokensPath: TOKENS_PATH },
    },
    fields,
    options,
    headers,
    selectFields,
  }
}

/**
 * A clause as the query asks it: a `contains` becomes the `filterKeys`
 * token of its first word (text) or of its member (list). Everything else
 * goes as typed — the planner applies the text key, the number, the boolean.
 */
function recordQueryClause(model: DatasetModel, clause: ListFilterClause): ListFilterRequest {
  if (clause.op !== 'contains') return { field: clause.field, op: clause.op, value: clause.value }
  const token = datasetFilterToken(model, {
    field: fieldIdOf(clause.field),
    op: 'contains',
    value: clause.value,
  })
  return { field: clause.field, op: clause.op, value: token ?? '' }
}

const clipWord = (word: string) =>
  Array.from(word).slice(0, DATASET_FILTER_PREFIX_MAX).join('')

/** The records query, and what it says to the reader. */
export interface DatasetRecordPlan {
  plan: ListQueryPlan
  /** What was not put on the query, as the reader asked it, and why. */
  refused: Array<{ clause: ListFilterClause | 'search'; reason: string }>
  /** What WAS served, where it differs from what was typed. */
  notices: string[]
}

/**
 * The clauses and search words as ONE records query (`planListQuery`), with
 * the refusals mapped back to the clauses as the reader typed them, and the
 * notices said in the reader's words rather than as stored tokens.
 */
export function planRecordQuery(
  model: DatasetModel,
  filter: DatasetRecordFilter,
  clauses: readonly ListFilterClause[],
  searchWords: readonly string[],
): DatasetRecordPlan {
  const asked = new Map<ListFilterRequest, ListFilterClause>()
  const queryClauses = clauses.map((clause) => {
    const queryClause = recordQueryClause(model, clause)
    asked.set(queryClause, clause)
    return queryClause
  })
  const plan = planListQuery(
    filter.declaration,
    { clauses: queryClauses, search: searchWords },
    datasetRecordNormalizers,
  )
  const refused = plan.refused.map((entry) => ({
    clause: entry.clause === 'search' ? ('search' as const) : (asked.get(entry.clause) ?? entry.clause),
    reason: entry.reason,
  }))

  const notices: string[] = []
  const oneWord = (label: string, text: string) => {
    const words = datasetFilterWords(text)
    if (words.length > 1) {
      notices.push(
        `${label} matches one word at a time: showing records with a word starting "${clipWord(words[0])}".`,
      )
    }
    if (words.some((word) => Array.from(word).length > DATASET_FILTER_PREFIX_MAX)) {
      notices.push(`${label} reads the first ${DATASET_FILTER_PREFIX_MAX} letters of a word.`)
    }
  }
  if (plan.searched) oneWord('Search', searchWords.join(' '))
  for (const served of plan.served) {
    const clause = asked.get(served)
    // A list's `contains` is a whole member; only text is asked by word.
    if (clause?.op !== 'contains') continue
    if (model.fields?.[fieldIdOf(clause.field)]?.type !== 'text') continue
    oneWord(`${filter.headers[clause.field] ?? clause.field} contains`, clause.value)
  }
  return { plan, refused, notices }
}
