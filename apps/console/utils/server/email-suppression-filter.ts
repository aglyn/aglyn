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
  listFilterOperators,
  type ListFilterField,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  SUPPRESSION_ALONGSIDE_FIELDS,
  SUPPRESSION_FILTER_FIELDS,
  SUPPRESSION_SEARCH_FIELD,
  SUPPRESSION_SINGLE_FIELDS,
} from '../email-suppression-filters'
import { applyListFilter, type ListFilterInput } from './list-filter'

/** The list's own sort, which every predicate is added beneath. */
const ORDER_FIELD = 'suppressedAt'

/** More clauses than the list has fields is not a request the card makes. */
const MAX_CLAUSES = SUPPRESSION_FILTER_FIELDS.length

/**
 * The clauses a request carries, from its `filters` parameter: a JSON array
 * of `{ field, op, value }`. `null` when it carries something that is not
 * that, which the route refuses rather than reading as "no filter".
 */
export function readSuppressionFilters(
  query: Partial<Record<string, unknown>>,
): ListFilterInput[] | null {
  const raw = query['filters']
  if (raw === undefined || raw === '') return []
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_CLAUSES) return null
  const clauses: ListFilterInput[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null
    const { field, op, value } = entry as Record<string, unknown>
    if (typeof field !== 'string' || typeof op !== 'string') return null
    clauses.push({ field, op, value: typeof value === 'string' ? value : '' })
  }
  return clauses
}

/** Where each field's predicate goes, so one ask always builds one shape. */
const rank = (field: string): number =>
  field === 'status' ? 0 : SUPPRESSION_SINGLE_FIELDS.includes(field) ? 1 : 3

/** The narrowed query, or why the ask was refused; exactly one is set. */
export interface SuppressionQuery {
  query: FirebaseFirestore.Query | null
  error: string | null
}

const refuse = (error: string): SuppressionQuery => ({ query: null, error })

/**
 * The staff suppression list's query narrowed by the clauses and the search,
 * through the console's one translator (`applyListFilter`, with the order
 * pinned). Every clause is served on the query; there is no window. The
 * caller adds the `suppressedAt` DESC order and the cursor.
 *
 * Refused, with the reason, rather than dropped: a clause on a field the list
 * does not declare, an operator the field does not offer, a value the
 * translator cannot use, two clauses on one field, or two of the
 * one-at-a-time fields. Dropping any of those would list a superset under a
 * chip that says it was narrowed.
 *
 * The search is a word prefix of the address (`emailTokens`); a query that
 * normalizes to nothing is no search.
 */
export function suppressionQuery(
  ref: FirebaseFirestore.Query,
  clauses: readonly ListFilterInput[],
  search: string,
): SuppressionQuery {
  const seen = new Set<string>()
  let singles = 0
  for (const clause of clauses) {
    const field = SUPPRESSION_FILTER_FIELDS.find((entry) => entry.column === clause.field)
    if (!field) return refuse(`This list cannot be filtered by ${clause.field}`)
    if (!listFilterOperators(field).includes(clause.op)) {
      return refuse(`This list cannot filter ${clause.field} that way`)
    }
    if (seen.has(clause.field)) {
      return refuse(`Only one filter on ${clause.field} at a time`)
    }
    seen.add(clause.field)
    if (SUPPRESSION_SINGLE_FIELDS.includes(clause.field)) singles += 1
    else if (!SUPPRESSION_ALONGSIDE_FIELDS.includes(clause.field)) {
      return refuse(`This list cannot be filtered by ${clause.field}`)
    }
  }
  if (singles > 1) {
    return refuse('Filter by one of Reason, Learned from or Site ID at a time')
  }

  // Equalities, then the search, then the range: the order the indexes list.
  const ordered = [...clauses].sort((a, b) => rank(a.field) - rank(b.field))
  const equalities = ordered.filter((clause) => rank(clause.field) < 2)
  const ranges = ordered.filter((clause) => rank(clause.field) >= 2)
  let query = ref
  const apply = (
    fields: readonly ListFilterField[],
    input: ListFilterInput,
  ): FirebaseFirestore.Query | null =>
    applyListFilter(query, fields, input, { fixedOrderBy: ORDER_FIELD })

  for (const clause of equalities) {
    const next = apply(SUPPRESSION_FILTER_FIELDS, clause)
    if (!next) return refuse(`This list cannot use that value for ${clause.field}`)
    query = next
  }
  const words = search.trim()
  if (words) {
    // Null when the words normalize to no token, which is no search.
    const next = apply([SUPPRESSION_SEARCH_FIELD], {
      field: SUPPRESSION_SEARCH_FIELD.column,
      op: 'contains',
      value: words,
    })
    if (next) query = next
  }
  for (const clause of ranges) {
    const next = apply(SUPPRESSION_FILTER_FIELDS, clause)
    if (!next) return refuse(`This list cannot use that value for ${clause.field}`)
    query = next
  }
  return { query, error: null }
}
