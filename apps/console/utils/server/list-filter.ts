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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  nameSearchKey,
  nameSearchReversed,
  nameSearchToken,
} from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'

/**
 * The query half of the list-filter contract (AGL-693).
 *
 * The declaration and the operator menu live in
 * `@aglyn/shared-ui-jsx/const/list-filter`, which is client-safe; this file is
 * the server twin that turns one declared field plus an operator into a
 * Firestore query. They read the same `ListFilterField`, so a list cannot offer
 * an operator this file will not answer.
 */

export type { ListFilterField }

export interface ListFilterInput {
  field: string
  op: string
  value: string
}

export interface ListFilterOptions {
  /** Sort field for a `contains`, which cannot order by its token array. */
  containsOrderBy?: string
  /**
   * The list's own sort field, when the caller owns it — an activity feed
   * ordered by `createdAt` with a cursor into that ordering. Set it and the
   * translator adds predicates without touching `orderBy`, refusing any that
   * would need a different one.
   */
  fixedOrderBy?: string
}

/** Firestore caps `in` at 30 values. */
const IN_LIMIT = 30

const toDate = (value: string): Date | null => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const csv = (raw: string): string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, IN_LIMIT)

/**
 * Read the filter a request carries, or `null` when it carries none.
 *
 * Each list's route asked for these three parameters by hand, which is three
 * chances per route to spell one differently from the page that sends it.
 */
export function readListFilter(
  query: Partial<Record<string, unknown>>,
): ListFilterInput | null {
  const field = String(query['filterField'] ?? '')
  const op = String(query['filterOp'] ?? '')
  if (!field || !op) return null
  return { field, op, value: String(query['filterValue'] ?? '') }
}

/**
 * Build the filtered query, or `null` when this list cannot answer the ask.
 *
 * `null` means "not filtered", and the caller lists everything unfiltered.
 * That is deliberate: an operator the console cannot serve must not read as
 * "no such record", which is exactly what returning an empty page would say.
 *
 * `orderBy` is picked so no combination needs an index nobody built — a range
 * orders by the field it ranges over, and an equality orders by document id,
 * both served by the automatic single-field indexes. Only `array-contains`
 * needs a composite with its sort field, and a list declaring `tokensPath`
 * owes that index.
 */
export function applyListFilter(
  ref: FirebaseFirestore.Query,
  fields: readonly ListFilterField[],
  input: ListFilterInput | null,
  options: ListFilterOptions = {},
): FirebaseFirestore.Query | null {
  if (!input) return null
  const byId = firebaseAdmin.firestore.FieldPath.documentId()
  const field = fields.find((entry) => entry.column === input.field)
  if (!field) return null
  const raw = (input.value ?? '').trim()
  const op = input.op
  /*
   * A list whose ORDER is not the filter's to choose.
   *
   * The activity feeds are `orderBy('createdAt', 'desc')` and their cursor is
   * a document in that ordering — re-sorting them to suit a predicate would
   * not narrow the list, it would shuffle it and invalidate every cursor
   * already issued. Firestore also requires the first `orderBy` to be the
   * range field, so with the order pinned only two shapes are possible:
   * equality (any field, given a composite index) and a range over the sort
   * field ITSELF. Anything else returns null and the list stays unfiltered,
   * which is the honest answer to an ask this list cannot serve.
   */
  const pinned = options.fixedOrderBy
  const ordered = (query: FirebaseFirestore.Query, by: string | FirebaseFirestore.FieldPath) =>
    pinned ? query : query.orderBy(by)
  const rangeAllowed = (path: string) => !pinned || pinned === path

  if (op === 'isEmpty') {
    // Only where writers store `null`; Firestore cannot find documents that
    // simply LACK a field. See `presence` on the shared declaration.
    if (field.presence !== 'nullable') return null
    return ordered(ref.where(field.path, '==', null), byId)
  }
  if (op === 'isNotEmpty') {
    // `!=` also requires the field to EXIST, which is the meaning wanted.
    if (field.presence === 'always') return null
    if (!rangeAllowed(field.path)) return null
    return ordered(ref.where(field.path, '!=', null), field.path)
  }

  if (field.kind === 'boolean') {
    // MUI sends the empty string when the tri-state control is cleared.
    if (raw !== 'true' && raw !== 'false') return null
    return ordered(ref.where(field.path, '==', raw === 'true'), byId)
  }

  if (!raw) return null

  /*
   * `\uf8ff` is a very high private-use codepoint, so `[prefix, prefix + \uf8ff]`
   * spans every string that STARTS with the prefix. Without it the range
   * collapses to `[prefix, prefix]` — an exact match wearing the shape of a
   * prefix search, which is the quiet way "starts with" stops working.
   */
  const range = (path: string, prefix: string) =>
    prefix && rangeAllowed(path)
      ? ref.orderBy(path).startAt(prefix).endAt(`${prefix}\uf8ff`)
      : null

  if (field.kind === 'text') {
    if (op === 'contains' && field.tokensPath) {
      const token = nameSearchToken(raw)
      if (!token) return null
      const sortBy = options.containsOrderBy ?? field.lowerPath ?? field.path
      const contains = ref.where(field.tokensPath, 'array-contains', token)
      return pinned ? contains : contains.orderBy(sortBy)
    }
    if (op === 'equals' && field.lowerPath) {
      return ordered(ref.where(field.lowerPath, '==', nameSearchKey(raw)), byId)
    }
    if (op === 'startsWith' && field.lowerPath) {
      return range(field.lowerPath, nameSearchKey(raw))
    }
    if (op === 'endsWith' && field.reversedPath) {
      return range(field.reversedPath, nameSearchReversed(raw))
    }
    return null
  }

  if (field.kind === 'id') {
    if (op === 'equals') return ordered(ref.where(byId, '==', raw), byId)
    if (op === 'startsWith') {
      if (pinned) return null
      return ref.orderBy(byId).startAt(raw).endAt(`${raw}\uf8ff`)
    }
    if (op === 'isAnyOf') {
      const values = csv(raw)
      return values.length ? ordered(ref.where(byId, 'in', values), byId) : null
    }
    return null
  }

  if (field.kind === 'exact') {
    if (op === 'equals') return ordered(ref.where(field.path, '==', raw), byId)
    if (op === 'isAnyOf') {
      const values = csv(raw)
      return values.length
        ? ordered(ref.where(field.path, 'in', values), byId)
        : null
    }
    return null
  }

  if (field.kind === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    const comparison: Record<string, FirebaseFirestore.WhereFilterOp> = {
      '=': '==',
      '!=': '!=',
      '>': '>',
      '>=': '>=',
      '<': '<',
      '<=': '<=',
    }
    const operator = comparison[op]
    if (!operator) return null
    if (operator === '==') return ordered(ref.where(field.path, '==', value), byId)
    if (!rangeAllowed(field.path)) return null
    return ordered(ref.where(field.path, operator, value), field.path)
  }

  if (field.kind === 'date') {
    const day = toDate(raw)
    if (!day) return null
    const start = new Date(day)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const stamp = (date: Date) =>
      firebaseAdmin.firestore.Timestamp.fromDate(date)
    /*
     * `is` is a DAY, not an instant. A stored timestamp carries a time, so
     * equality against midnight matches nothing — a date column filtered by
     * `is` would answer "none" for every row, every time.
     */
    if (!rangeAllowed(field.path)) return null
    if (op === 'is') {
      const bounded = pinned ? ref : ref.orderBy(field.path)
      return bounded.startAt(stamp(start)).endAt(stamp(end))
    }
    const bound: Record<string, [FirebaseFirestore.WhereFilterOp, Date]> = {
      after: ['>=', end],
      onOrAfter: ['>=', start],
      before: ['<', start],
      onOrBefore: ['<', end],
    }
    const found = bound[op]
    if (!found) return null
    return ordered(ref.where(field.path, found[0], stamp(found[1])), field.path)
  }

  return null
}
