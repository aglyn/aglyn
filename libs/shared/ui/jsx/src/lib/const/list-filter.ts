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
  getGridBooleanOperators,
  getGridDateOperators,
  getGridNumericOperators,
  getGridStringOperators,
  type GridFilterOperator,
} from '@mui/x-data-grid'

/**
 * ONE declaration of what a paged list can be filtered by (AGL-693).
 *
 * A paged list filters on the SERVER or it does not filter: `filterMode="server"`
 * stops the grid narrowing anything itself, so the panel shows the rows already
 * fetched — ten of them by default — and an operator the route does not answer
 * becomes a control that quietly does nothing. On a staff list whose whole job
 * is that nobody is missing, "no matches" is the one answer it must never give
 * wrongly.
 *
 * So a list declares its filterable fields ONCE, in a module both its route and
 * its page import. The declaration decides two things that must never disagree:
 * which operators the menu offers (here) and which predicates the query builds
 * (`applyListFilter`, server-side, which needs firebase-admin and so cannot
 * live in this file).
 *
 * ## Why the menu is shorter than MUI's
 *
 * Firestore has equality, `in`, ranges and `array-contains`. Everything below
 * is built from those four:
 *
 *   equals / isAnyOf   equality and `in` (Firestore caps `in` at 30 values)
 *   startsWith         a range over the normalized lower-case key
 *   endsWith           a range over the key stored REVERSED — a range is
 *                      anchored at the FRONT of a value, so storing the value
 *                      backwards is the only way to ask about its end
 *   contains           `array-contains` over word-prefix tokens, so it is
 *                      WORD-level: "coffee" finds "Acme Coffee", "offee" does
 *                      not find anything
 *   before / after     ranges on a timestamp or a number
 *   isNotEmpty         `!= null`, which in Firestore also requires the field to
 *                      EXIST — which is the meaning wanted
 *
 * ⛔ `doesNotContain` is offered nowhere and cannot be. Firestore has no
 * negated substring match, and no denormalization fixes it: the inverse of a
 * token array is every string the value does not contain, which is unbounded.
 *
 * ⚠️ The two empty operators depend on how a field's WRITERS behave, which is
 * what `presence` declares. Firestore cannot query for absence at all:
 * `where(path, '==', null)` matches an explicit null and never a missing field,
 * while `where(path, '!=', null)` additionally requires the field to exist.
 * So a field that writers omit can answer `isNotEmpty` exactly and can never
 * answer `isEmpty` — it would say "none" to a question with real answers — and
 * a field that is always written answers both, but each with a foregone
 * result. Only a `nullable` field earns both operators for real.
 */

/** How a field can be queried, which decides which operators it offers. */
export type ListFilterKind =
  | 'text'
  | 'exact'
  | 'boolean'
  | 'number'
  | 'date'
  | 'id'

export interface ListFilterField {
  /** The grid column's `field` — what the client sends back. */
  column: string
  kind: ListFilterKind
  /** The Firestore field path the predicate targets. */
  path: string
  /**
   * The normalized lower-case twin, for `equals` and `startsWith` on text.
   * Without one a text field offers neither: a raw value is case-sensitive, so
   * it would miss rather than fail.
   */
  lowerPath?: string
  /** Word-prefix token array, for `contains`. */
  tokensPath?: string
  /** The reversed key, for `endsWith`. */
  reversedPath?: string
  /**
   * How the field's writers treat "no value", which is the only thing that
   * decides whether the empty operators mean anything:
   *
   *   `sparse`   (default) writers OMIT the field. `isNotEmpty` is exact;
   *              `isEmpty` is unanswerable and so is not offered.
   *   `nullable` writers store `null`. Both operators are exact and both can
   *              return rows — the only case where offering them is useful.
   *   `always`   the field is never absent and never null. Both operators have
   *              a foregone answer (all rows, then none), so neither is
   *              offered: a control whose result is known is a control that
   *              wastes the reader's time.
   */
  presence?: 'sparse' | 'nullable' | 'always'
}

/** The empty-operators a field can honestly offer. See `presence`. */
const emptyOperators = (field: ListFilterField): string[] => {
  switch (field.presence ?? 'sparse') {
    case 'always':
      return []
    case 'nullable':
      return ['isEmpty', 'isNotEmpty']
    default:
      return ['isNotEmpty']
  }
}

/** The operators a field offers, derived from the paths it actually has. */
export function listFilterOperators(field: ListFilterField): string[] {
  const empties = emptyOperators(field)
  switch (field.kind) {
    case 'text':
      return [
        ...(field.tokensPath ? ['contains'] : []),
        ...(field.lowerPath ? ['equals', 'startsWith'] : []),
        ...(field.reversedPath ? ['endsWith'] : []),
        ...empties,
      ]
    case 'exact':
      return ['equals', 'isAnyOf', ...empties]
    case 'id':
      // An id is never absent, so the empty operators would answer nothing.
      return ['equals', 'startsWith', 'isAnyOf']
    case 'boolean':
      return ['is']
    case 'number':
      return ['=', '!=', '>', '>=', '<', '<=', ...empties]
    case 'date':
      return ['is', 'after', 'onOrAfter', 'before', 'onOrBefore', ...empties]
    default:
      return []
  }
}

const operatorPool = (kind: ListFilterKind): GridFilterOperator[] => {
  switch (kind) {
    case 'boolean':
      return getGridBooleanOperators()
    case 'number':
      return getGridNumericOperators()
    case 'date':
      return getGridDateOperators()
    default:
      return getGridStringOperators()
  }
}

/**
 * The MUI operators for a field — the same list `listFilterOperators` names,
 * resolved to the grid's own operator objects so the panel keeps its native
 * inputs (a date picker for a date, a number field for a number).
 */
export function gridFilterOperators(
  field: ListFilterField,
): GridFilterOperator[] {
  const allowed = listFilterOperators(field)
  return operatorPool(field.kind).filter((operator) =>
    allowed.includes(operator.value),
  )
}

/**
 * Spread onto a `GridColDef` to make a column filterable exactly as far as the
 * query can serve it. A column with NO declared field is turned off entirely —
 * deliberately, because the alternative is a funnel icon that opens a panel
 * nothing honours.
 */
export function listFilterColumn(
  fields: readonly ListFilterField[],
  column: string,
): { filterable: boolean; filterOperators?: GridFilterOperator[] } {
  const field = fields.find((entry) => entry.column === column)
  if (!field) return { filterable: false }
  const operators = gridFilterOperators(field)
  return operators.length
    ? { filterable: true, filterOperators: operators }
    : { filterable: false }
}

/** What a page sends the route: one field, one operator, one value. */
export interface ListFilterRequest {
  field: string
  op: string
  value: string
}

/** Operators that carry no value — the grid leaves `item.value` undefined. */
const VALUELESS = ['isEmpty', 'isNotEmpty']

/**
 * The one filter item a server-paged list can act on, read off a grid model.
 *
 * ONE, because Firestore composes predicates only through indexes nobody built
 * for every pair of columns; the first usable item wins and the rest are the
 * reader's to remove. Every list read this off the model itself, and each did
 * it slightly differently — the common miss being `isEmpty`, which sets no
 * value at all and so was skipped by any check that required one.
 */
export function gridFilterRequest(model: {
  items?: Array<{ field?: unknown; operator?: unknown; value?: unknown }>
}): ListFilterRequest | null {
  const usable = (model.items ?? []).find((item) => {
    if (!item.field || !item.operator) return false
    if (VALUELESS.includes(String(item.operator))) return true
    if (item.value === undefined || item.value === null) return false
    return Array.isArray(item.value)
      ? item.value.length > 0
      : String(item.value).trim() !== ''
  })
  if (!usable) return null
  const raw = usable.value
  const value = Array.isArray(raw)
    ? raw.join(',')
    : // A date column hands back a `Date`, whose default string form is a
      // locale rendering the server would have to guess at. ISO travels
      // unambiguously and `new Date` reads it back exactly.
      raw instanceof Date
      ? raw.toISOString()
      : raw === undefined || raw === null
        ? ''
        : String(raw)
  return { field: String(usable.field), op: String(usable.operator), value }
}

/**
 * Fields a reader can filter by that are NOT columns on the table.
 *
 * MUI's filter panel lists COLUMNS — `gridFilterableColumnDefinitionsSelector`
 * reads every column definition, hidden ones included — so a filterable field
 * with no column is a field nobody can reach however well the route answers it.
 * Declaring it as a permanently hidden column keeps one source of truth, the
 * field list, instead of a second list of "extra filters" that drifts from it.
 *
 * `hideable: false` keeps them out of Manage columns as well: a column with no
 * `renderCell` and no width has nothing to show, and a reader who unhid one
 * would get a strip of blank cells for their trouble.
 *
 * Pair with {@link hiddenFilterVisibility}, which is what actually hides them.
 */
export function hiddenFilterColumns(
  fields: readonly ListFilterField[],
  visible: readonly string[],
  headers: Readonly<Record<string, string>> = {},
): Array<{
  field: string
  headerName: string
  hideable: boolean
  filterable: boolean
  filterOperators?: GridFilterOperator[]
}> {
  return fields
    .filter((field) => !visible.includes(field.column))
    .map((field) => ({
      field: field.column,
      headerName: headers[field.column] ?? field.column,
      hideable: false,
      ...listFilterColumn(fields, field.column),
    }))
    .filter((column) => column.filterable)
}

/** The visibility model that hides what {@link hiddenFilterColumns} added. */
export function hiddenFilterVisibility(
  fields: readonly ListFilterField[],
  visible: readonly string[],
): Record<string, boolean> {
  return Object.fromEntries(
    fields
      .filter((field) => !visible.includes(field.column))
      .map((field) => [field.column, false]),
  )
}
