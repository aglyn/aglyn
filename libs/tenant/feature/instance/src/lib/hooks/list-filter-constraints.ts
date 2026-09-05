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
  documentId,
  endAt,
  orderBy,
  startAt,
  Timestamp,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import type {
  ListFilterField,
  ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'

/**
 * The same filter contract, for a list that queries Firestore from the BROWSER
 * (AGL-2501).
 *
 * The console's paged cards read their collections directly through
 * `usePagedCollection` rather than through a route, so the server translator —
 * which speaks firebase-admin — cannot serve them. This is its twin in the web
 * SDK, reading the same `ListFilterField` declaration so a list cannot offer an
 * operator its query will not answer.
 *
 * The reason it must exist at all is that these cards filtered the rows they
 * had. A paged card holds ten; typing a name that is on page four answers "no
 * such member", which reads as the record not existing rather than as the
 * search not reaching it.
 *
 * ⚠️ A predicate here runs under SECURITY RULES, unlike the server twin. A
 * field a rule does not permit reading is not a field this can filter on, and
 * the failure arrives as a permission error rather than as an empty page.
 */

/** Firestore caps `in` at 30 values. */
const IN_LIMIT = 30

/** A very high private-use codepoint — see the server twin for why. */
const HIGH = '\uf8ff'

const csv = (raw: string): string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, IN_LIMIT)

const key = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase()

/** Reverse by CODEPOINT — `split('')` tears surrogate pairs in half. */
const reversed = (value: string): string => [...key(value)].reverse().join('')

const toDay = (value: string): { start: Date; end: Date } | null => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const start = new Date(parsed)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

export interface ListFilterConstraintOptions {
  /**
   * The list's own sort field, when the caller owns it. Set it and the
   * translator adds predicates WITHOUT an `orderBy` of its own, refusing any
   * that would need a different one — see the server twin's `fixedOrderBy`.
   */
  fixedOrderBy?: string
  /** Sort field for a `contains`, which cannot order by its token array. */
  containsOrderBy?: string
}

/**
 * Constraints for one declared filter, or `null` when this list cannot serve
 * the ask.
 *
 * `null` means "not filtered", and the caller queries unfiltered. That is
 * deliberate and it is the whole point: an operator the console cannot serve
 * must not read as "no such record", which is what an empty page would say.
 */
export function listFilterConstraints(
  fields: readonly ListFilterField[],
  input: ListFilterRequest | null,
  options: ListFilterConstraintOptions = {},
): QueryConstraint[] | null {
  if (!input) return null
  const field = fields.find((entry) => entry.column === input.field)
  if (!field) return null
  const raw = (input.value ?? '').trim()
  const op = input.op
  const pinned = options.fixedOrderBy
  const sorted = (by: string | ReturnType<typeof documentId>) =>
    pinned ? [] : [orderBy(by as never)]
  const rangeAllowed = (path: string) => !pinned || pinned === path

  if (op === 'isEmpty') {
    // Only where writers store `null`; Firestore cannot find documents that
    // simply LACK a field. See `presence` on the shared declaration.
    if (field.presence !== 'nullable') return null
    return [where(field.path, '==', null), ...sorted(documentId())]
  }
  if (op === 'isNotEmpty') {
    // `!=` also requires the field to EXIST, which is the meaning wanted.
    if (field.presence === 'always') return null
    if (!rangeAllowed(field.path)) return null
    return [where(field.path, '!=', null), ...sorted(field.path)]
  }

  if (field.kind === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return null
    return [where(field.path, '==', raw === 'true'), ...sorted(documentId())]
  }

  if (!raw) return null

  const prefixRange = (path: string, prefix: string) =>
    prefix && rangeAllowed(path)
      ? [orderBy(path), startAt(prefix), endAt(`${prefix}${HIGH}`)]
      : null

  if (field.kind === 'text') {
    if (op === 'contains' && field.tokensPath) {
      // An id array is matched as typed — see `verbatimTokens`.
      const token = field.verbatimTokens ? raw : key(raw).split(' ')[0]
      if (!token) return null
      const sortBy = field.containsOrderBy ?? options.containsOrderBy ?? field.lowerPath ?? field.path
      return [
        where(field.tokensPath, 'array-contains', token),
        ...(pinned ? [] : [orderBy(sortBy)]),
      ]
    }
    if (op === 'equals' && field.lowerPath) {
      return [where(field.lowerPath, '==', key(raw)), ...sorted(documentId())]
    }
    if (op === 'startsWith' && field.lowerPath) {
      return prefixRange(field.lowerPath, key(raw))
    }
    if (op === 'endsWith' && field.reversedPath) {
      return prefixRange(field.reversedPath, reversed(raw))
    }
    return null
  }

  if (field.kind === 'id') {
    if (op === 'equals') {
      return [where(documentId(), '==', raw), ...sorted(documentId())]
    }
    if (op === 'startsWith') {
      if (pinned) return null
      return [orderBy(documentId()), startAt(raw), endAt(`${raw}${HIGH}`)]
    }
    if (op === 'isAnyOf') {
      const values = csv(raw)
      return values.length
        ? [where(documentId(), 'in', values), ...sorted(documentId())]
        : null
    }
    return null
  }

  if (field.kind === 'exact') {
    if (op === 'equals') {
      return [where(field.path, '==', raw), ...sorted(documentId())]
    }
    if (op === 'isAnyOf') {
      const values = csv(raw)
      return values.length
        ? [where(field.path, 'in', values), ...sorted(documentId())]
        : null
    }
    return null
  }

  if (field.kind === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    if (op === '=') {
      return [where(field.path, '==', value), ...sorted(documentId())]
    }
    const comparison: Record<string, '!=' | '>' | '>=' | '<' | '<='> = {
      '!=': '!=',
      '>': '>',
      '>=': '>=',
      '<': '<',
      '<=': '<=',
    }
    const operator = comparison[op]
    if (!operator || !rangeAllowed(field.path)) return null
    return [where(field.path, operator, value), ...sorted(field.path)]
  }

  if (field.kind === 'date') {
    const day = toDay(raw)
    if (!day || !rangeAllowed(field.path)) return null
    const stamp = (date: Date) => Timestamp.fromDate(date)
    /*
     * `is` is a DAY, not an instant. A stored timestamp carries a time, so
     * equality against midnight matches nothing — a date column filtered by
     * `is` would answer "none" for every row, every time.
     */
    if (op === 'is') {
      return [
        ...(pinned ? [] : [orderBy(field.path)]),
        startAt(stamp(day.start)),
        endAt(stamp(day.end)),
      ]
    }
    const bound: Record<string, ['>=' | '<', Date]> = {
      after: ['>=', day.end],
      onOrAfter: ['>=', day.start],
      before: ['<', day.start],
      onOrBefore: ['<', day.end],
    }
    const found = bound[op]
    if (!found) return null
    return [
      where(field.path, found[0], stamp(found[1])),
      ...sorted(field.path),
    ]
  }

  return null
}
