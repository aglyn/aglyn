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
import { listRowMatchesSearch } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { applyListFilter, type ListFilterInput } from './list-filter'

/**
 * The clauses an audit-log request carries, from its `filters` parameter: a
 * JSON array of `{ field, op, value }`. `[]` for none; `null` for anything
 * that is not that, which the route refuses rather than reading as "no
 * filter" — an unreadable ask answered with the whole log would be listed
 * under chips that say it was narrowed.
 */
export function readAuditLogFilters(
  query: Partial<Record<string, unknown>>,
  fields: readonly ListFilterField[],
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
  if (!Array.isArray(parsed) || parsed.length > fields.length) return null
  const clauses: ListFilterInput[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null
    const { field, op, value } = entry as Record<string, unknown>
    if (typeof field !== 'string' || typeof op !== 'string') return null
    clauses.push({ field, op, value: typeof value === 'string' ? value : '' })
  }
  return clauses
}

/**
 * Why a set of clauses cannot be served, or `null` when every one can: a
 * field the list does not declare, an operator the field does not offer, an
 * empty value, or two clauses on one field.
 */
export function auditLogFilterRefusal(
  fields: readonly ListFilterField[],
  clauses: readonly ListFilterInput[],
): string | null {
  const seen = new Set<string>()
  for (const clause of clauses) {
    const field = fields.find((entry) => entry.column === clause.field)
    if (!field) return `This log cannot be filtered by ${clause.field}`
    if (!listFilterOperators(field).includes(clause.op)) {
      return `This log cannot filter ${clause.field} that way`
    }
    if (!clause.value.trim()) return `A filter on ${clause.field} needs a value`
    if (seen.has(clause.field)) return `Only one filter on ${clause.field} at a time`
    seen.add(clause.field)
  }
  return null
}

/**
 * The query narrowed by every clause, beneath the feed's own `createdAt`
 * order — or `null` when the translator cannot serve one of them, which the
 * caller answers as a refusal rather than a wider list.
 */
export function applyAuditLogFilters(
  ref: FirebaseFirestore.Query,
  fields: readonly ListFilterField[],
  clauses: readonly ListFilterInput[],
): FirebaseFirestore.Query | null {
  let query = ref
  for (const clause of clauses) {
    const narrowed = applyListFilter(query, fields, clause, { fixedOrderBy: 'createdAt' })
    if (!narrowed) return null
    query = narrowed
  }
  return query
}

/** The words a search asks for; none for a blank search. */
export function auditLogSearchWords(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
}

/**
 * Whether an entry answers the search: every word appears, case-insensitively,
 * in one of `paths` — the same test the grid's own quick search applies to
 * rows it holds, so a word matches on the server exactly as it would on screen.
 */
export function auditLogSearchMatcher(
  words: readonly string[],
  paths: readonly string[],
): ((entry: object) => boolean) | null {
  if (!words.length) return null
  return (entry) => listRowMatchesSearch(entry, paths, words)
}
