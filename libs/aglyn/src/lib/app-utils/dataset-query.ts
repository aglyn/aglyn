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
 * Dataset query layer (AGL-181): filter/sort/limit over typed documents,
 * shared by the console editor and the tenant renderer's repeatable
 * expansion. Deliberately evaluated IN MEMORY over the already-bounded
 * reads (editor page / `REPEAT_MAX_RECORDS`) — the Firestore reality
 * check from the issue: this sidesteps inequality-filter and composite-
 * index constraints entirely, at the documented cost that documents
 * beyond the fetch bound are never considered. The bound is explicit,
 * never silently unbounded.
 */

import type { DatasetModel } from './dataset-models'

export type DatasetQueryOp =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'

export const DATASET_QUERY_OPS: DatasetQueryOp[] = [
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'contains',
]

export interface DatasetQueryWhere {
  fieldId: string
  op: DatasetQueryOp
  /** Literal, compared with type-aware coercion against stored values. */
  value: string
}

export interface DatasetQuery {
  where?: DatasetQueryWhere[]
  orderBy?: { fieldId: string; direction?: 'asc' | 'desc' }
  limit?: number
}

/**
 * Parses the authoring shorthand `field op value` (e.g. `price <= 20`,
 * `tier == plus`, `tags contains red`). Null for unparseable input so
 * callers fail open (no filter) rather than filtering wrongly.
 */
export function parseDatasetFilter(input: string): DatasetQueryWhere | null {
  const match = String(input ?? '')
    .trim()
    .match(/^([A-Za-z][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<|contains)\s+(.+)$/)
  if (!match) return null
  return {
    fieldId: match[1],
    op: match[2] as DatasetQueryOp,
    value: match[3].trim(),
  }
}

/** Parses `field` or `field desc` into an orderBy config. */
export function parseDatasetSort(
  input: string,
): DatasetQuery['orderBy'] | null {
  const match = String(input ?? '')
    .trim()
    .match(/^([A-Za-z][A-Za-z0-9_]*)(?:\s+(asc|desc))?$/i)
  if (!match) return null
  return {
    fieldId: match[1],
    direction: match[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc',
  }
}

const comparable = (value: unknown): number | string | null => {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const numeric = Number(value)
    return Number.isFinite(numeric) && value.trim() !== '' ? numeric : value
  }
  return null
}

function matches(stored: unknown, where: DatasetQueryWhere): boolean {
  const { op, value } = where
  if (op === 'contains') {
    if (Array.isArray(stored)) {
      return stored.some(
        (entry) => String(entry).toLowerCase() === value.toLowerCase(),
      )
    }
    return String(stored ?? '')
      .toLowerCase()
      .includes(value.toLowerCase())
  }
  if (op === '==' || op === '!=') {
    const equal =
      typeof stored === 'boolean'
        ? String(stored) === value.toLowerCase()
        : String(stored ?? '') === value
    return op === '==' ? equal : !equal
  }
  const left = comparable(stored)
  const right = comparable(value)
  if (left == null || right == null || typeof left !== typeof right) {
    return false
  }
  switch (op) {
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '<':
      return left < right
    case '<=':
      return left <= right
  }
  return false
}

/**
 * Applies where/orderBy/limit to in-memory rows. Where-clauses on fields
 * absent from the model still run (stored-value comparison) so v1
 * datasets work; timestamps compare numerically (epoch millis storage).
 */
export function applyDatasetQuery<Row extends Record<string, unknown>>(
  model: DatasetModel | undefined,
  rows: Row[],
  query: DatasetQuery,
): Row[] {
  let result = rows
  for (const where of query.where ?? []) {
    result = result.filter((row) => matches(row[where.fieldId], where))
  }
  if (query.orderBy) {
    const { fieldId, direction } = query.orderBy
    const sign = direction === 'desc' ? -1 : 1
    result = [...result].sort((a, b) => {
      const left = comparable(a[fieldId])
      const right = comparable(b[fieldId])
      if (left == null) return 1
      if (right == null) return -1
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * sign
      }
      return String(left).localeCompare(String(right)) * sign
    })
  }
  if (query.limit != null && query.limit > 0) {
    result = result.slice(0, query.limit)
  }
  return result
}
