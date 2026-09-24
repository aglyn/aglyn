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

import type { CrmViewFilterClause } from '@aglyn/aglyn'
import {
  gridFilterRequests,
  hiddenFilterColumns,
  type ListFilterField,
  listFilterColumn,
  listFilterOperators,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  getGridSingleSelectOperators,
  type GridColDef,
  type GridFilterItem,
} from '@mui/x-data-grid'

/*
 * ONE path from a CRM list's saved-view clauses to the data grid's own
 * Filters panel and quick search, and back (AGL-3313).
 *
 * Every CRM list stores what it is narrowed by as view clauses —
 * `{ field, op, value }`, the shape saved views have held since AGL-2617 —
 * and every one of them now edits those clauses through the grid's toolbar
 * rather than a control of its own. What a list declares is its fields,
 * as the `ListFilterField` grammar the console's other paged lists speak
 * (the content entries, the staff lists), plus the choices of the fields
 * whose values are picked rather than typed. The grid then offers each as a
 * typed column: a `singleSelect` with its choices where there are choices,
 * the operators the grammar allows otherwise.
 *
 * The clauses keep their stored shape, so a view saved with the old
 * dropdowns reads unchanged: the panel shows `equals` as the select's `is`
 * and writes `is` back as `equals`, and a list whose clauses were stored in
 * some other shape (Leads' campaign `contains`, its lead source `isEmpty`)
 * says so with a codec.
 */

/** A choice for a field whose value is picked rather than typed. */
export interface CrmFilterOption {
  value: string
  label: string
}

/** The grid operator each stored select operator shows as. */
const SELECT_TO_GRID: Readonly<Record<string, string>> = {
  equals: 'is',
  doesNotEqual: 'not',
  isAnyOf: 'isAnyOf',
}
const SELECT_FROM_GRID: Readonly<Record<string, string>> = {
  is: 'equals',
  not: 'doesNotEqual',
  isAnyOf: 'isAnyOf',
}

/**
 * How one field's stored clause and the panel's item translate. A field
 * with choices uses {@link crmSelectCodec}; a typed one, {@link crmPlainCodec}.
 * A list whose clauses predate the panel supplies its own.
 */
export interface CrmGridFilterCodec {
  toItem: (clause: CrmViewFilterClause) => Pick<GridFilterItem, 'operator' | 'value'> | null
  toClause: (item: GridFilterItem) => CrmViewFilterClause | null
}

/** The panel's item as a clause, through the grammar's one notion of "usable". */
const plainClause = (item: GridFilterItem): CrmViewFilterClause | null =>
  gridFilterRequests({ items: [item] })[0] ?? null

/** A typed field: the stored operator IS the grid's. */
export const crmPlainCodec: CrmGridFilterCodec = {
  toItem: (clause) => ({
    operator: clause.op,
    value: clause.value === '' ? undefined : clause.value,
  }),
  toClause: plainClause,
}

/** A picked field: `equals` shows as `is`, and `isAnyOf` holds a comma list. */
export const crmSelectCodec: CrmGridFilterCodec = {
  toItem: (clause) => {
    const operator = SELECT_TO_GRID[clause.op]
    if (!operator) return null
    return {
      operator,
      value:
        operator === 'isAnyOf'
          ? clause.value.split(',').map((entry) => entry.trim()).filter(Boolean)
          : clause.value,
    }
  },
  toClause: (item) => {
    const op = SELECT_FROM_GRID[String(item.operator)]
    const request = op ? plainClause(item) : null
    return request && op ? { ...request, op } : null
  },
}

/** The select operators a field's allowed clause operators map to. */
export function crmSelectOperators(allowed: readonly string[]) {
  const shown = allowed.map((op) => SELECT_TO_GRID[op]).filter(Boolean)
  return getGridSingleSelectOperators().filter((operator) =>
    shown.includes(operator.value),
  )
}

/**
 * The list's columns, each made filterable exactly as far as its field is
 * declared, and every declared field that is not a column added as a
 * permanently hidden one — the panel lists columns, so a field with none
 * could not be reached (`hiddenFilterColumns`).
 *
 * A field with choices becomes a `singleSelect` over them, whatever the
 * column rendered before; one without keeps the grammar's operators; a
 * column no field declares offers no filter, because the list, not the
 * grid, answers every filter and would have nothing to answer it with.
 */
export function crmFilterColumns(
  columns: readonly GridColDef[],
  fields: readonly ListFilterField[],
  options: Readonly<Record<string, readonly CrmFilterOption[]>> = {},
  headers: Readonly<Record<string, string>> = {},
): GridColDef[] {
  const selectProps = (field: ListFilterField) => {
    const choices = options[field.column] ?? []
    const operators = crmSelectOperators(listFilterOperators(field))
    return {
      type: 'singleSelect' as const,
      valueOptions: choices.map((choice) => ({ value: choice.value, label: choice.label })),
      filterable: choices.length > 0 && operators.length > 0,
      filterOperators: operators,
    }
  }
  const shown = columns.map((column): GridColDef => {
    if (column.filterable === false && column.hideable === false) return column
    const field = fields.find((entry) => entry.column === column.field)
    if (!field) return { ...column, filterable: false }
    if (options[field.column]) return { ...column, ...selectProps(field) } as GridColDef
    return { ...column, ...listFilterColumn(fields, field.column) }
  })
  const present = columns.map((column) => column.field)
  const hidden = hiddenFilterColumns(fields, present, headers).map(
    (column): GridColDef => {
      const field = fields.find((entry) => entry.column === column.field)
      return field && options[field.column]
        ? ({ ...column, ...selectProps(field) } as GridColDef)
        : column
    },
  )
  return [...shown, ...hidden]
}

/**
 * Whether a row answers a quick search: every whitespace-separated word
 * appears, case-insensitively, in SOME of the row's searched values. A
 * blank search matches every row, so an emptied box is the list unfiltered.
 * An array value (tags) is searched member by member.
 */
export function crmRowMatchesSearch(
  row: object,
  paths: readonly string[],
  words: readonly string[],
): boolean {
  const asked = words.map((word) => word.trim().toLowerCase()).filter(Boolean)
  if (!asked.length) return true
  const values = paths
    .flatMap((path) => {
      const value = path
        .split('.')
        .reduce<unknown>(
          (at, key) => (at == null ? undefined : (at as Record<string, unknown>)[key]),
          row,
        )
      return Array.isArray(value) ? value : [value]
    })
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).toLowerCase())
    .filter(Boolean)
  return asked.every((word) => values.some((value) => value.includes(word)))
}

/**
 * The clauses with one field's clause set: replaced in place where the field
 * already had one, appended where it did not, removed when `next` is null.
 * A field holds ONE clause, which is what the panel edits.
 */
export function crmUpsertClause(
  clauses: readonly CrmViewFilterClause[],
  field: string,
  next: CrmViewFilterClause | null,
): CrmViewFilterClause[] {
  const at = clauses.findIndex((clause) => clause.field === field)
  const rest = clauses.filter((clause) => clause.field !== field)
  if (!next) return rest
  if (at === -1) return [...rest, next]
  return [...rest.slice(0, at), next, ...rest.slice(at)]
}
