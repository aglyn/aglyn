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

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterInput } from './list-filter'

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

/** The words a search asks for; none for a blank search. */
export function auditLogSearchWords(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
}
