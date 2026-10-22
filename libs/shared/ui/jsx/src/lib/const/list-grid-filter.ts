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
  getGridSingleSelectOperators,
  getGridStringOperators,
  type GridColDef,
  type GridFilterOperator,
} from '@mui/x-data-grid'
import {
  type ListFilterField,
  type ListFilterKind,
  listFilterOperators,
} from './list-filter'
import {
  type ListFilterClause,
  type ListFilterOption,
  SELECT_TO_GRID,
} from '@aglyn/shared-util-tools/list-query/list-filter-codecs'

export {
  type ListFilterClause,
  type ListFilterOption,
  type ListGridFilterCodec,
  listPlainCodec,
  listSelectCodec,
} from '@aglyn/shared-util-tools/list-query/list-filter-codecs'

/*
 * ONE path from a list's filter clauses to the data grid's own Filters panel
 * and quick search, and back (AGL-3313, shared by every list since AGL-3317).
 *
 * A list stores what it is narrowed by as clauses — `{ field, op, value }`,
 * the shape saved views hold — and edits them through the grid's toolbar
 * rather than controls of its own. What a list declares is its fields, as
 * the `ListFilterField` grammar (`./list-filter`), plus the choices of the
 * fields whose values are picked rather than typed. The grid then offers
 * each as a typed column: a `singleSelect` with its choices where there are
 * choices, the operators the grammar allows otherwise.
 *
 * The clauses keep their stored shape, so a view saved before the panel
 * reads unchanged: the panel shows `equals` as the select's `is` and writes
 * `is` back as `equals`, and a list whose clauses were stored in some other
 * shape says so with a codec.
 */

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

/** A row's value at a dotted path (`owner.email`), or undefined. */
const valueAtPath = (row: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (at, key) => (at == null ? undefined : (at as Record<string, unknown>)[key]),
      row,
    )

/**
 * How a filter-only column's cell reads a stored value: an option's label
 * when the field has choices (`true` → "Suspended"), a list joined, a
 * Firestore timestamp or a date as the local date and time, Yes/No for a
 * bare boolean, and the value itself otherwise.
 */
export function listFilterCellText(
  value: unknown,
  labels: ReadonlyMap<string, string> = new Map(),
): string {
  if (value === undefined || value === null || value === '') return ''
  if (Array.isArray(value)) {
    return value.map((entry) => listFilterCellText(entry, labels)).filter(Boolean).join(', ')
  }
  const label = labels.get(String(value))
  if (label !== undefined) return label
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'object') {
    const seconds = (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
      (value as { _seconds?: unknown })._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleString()
    return ''
  }
  return String(value)
}

/**
 * What a column that exists only so the Filters panel can reach its field
 * draws when a reader turns it on in Manage columns: the row's own value —
 * by the column's name, else the field's stored path — read as
 * {@link listFilterCellText} reads it.
 *
 * These columns used to be `hideable: false`, because they had no cell and
 * an unhidden one was a strip of blanks. MUI's Manage columns draws a
 * column that cannot be hidden as a DISABLED, greyed-out checkbox, so every
 * staff table listed half its fields as if they were switched off for good
 * (Zach, 2026-10-09: "why are these columns disabled?"). With a cell of
 * their own they are ordinary columns: hidden by default, one click away.
 */
function filterOnlyColumnProps(
  field: ListFilterField,
  options: Readonly<Record<string, readonly ListFilterOption[]>>,
): Pick<GridColDef, 'valueGetter' | 'renderCell' | 'minWidth' | 'flex'> {
  const labels = new Map((options[field.column] ?? []).map((choice) => [choice.value, choice.label]))
  const read = (row: unknown) => {
    const own = valueAtPath(row, field.column)
    return own === undefined ? valueAtPath(row, field.path) : own
  }
  return {
    minWidth: 140,
    flex: 0.8,
    valueGetter: (_value: unknown, row: unknown) => read(row),
    renderCell: (params: { value?: unknown }) => listFilterCellText(params.value, labels),
  } as Pick<GridColDef, 'valueGetter' | 'renderCell' | 'minWidth' | 'flex'>
}

/**
 * Fields a reader can filter by that are NOT columns on the table.
 *
 * MUI's filter panel lists COLUMNS — `gridFilterableColumnDefinitionsSelector`
 * reads every column definition, hidden ones included — so a filterable field
 * with no column is a field nobody can reach however well the route answers it.
 * Declaring it as a hidden column keeps one source of truth, the field list,
 * instead of a second list of "extra filters" that drifts from it.
 *
 * Each draws the row's value (`filterOnlyColumnProps`), so it is an ordinary
 * column in Manage columns — hidden by default, never greyed out as locked.
 *
 * Pair with {@link hiddenFilterVisibility}, which is what actually hides them.
 */
export function hiddenFilterColumns(
  fields: readonly ListFilterField[],
  visible: readonly string[],
  headers: Readonly<Record<string, string>> = {},
): GridColDef[] {
  return fields
    .filter((field) => !visible.includes(field.column))
    .map((field) => ({
      field: field.column,
      headerName: headers[field.column] ?? field.column,
      ...filterOnlyColumnProps(field, {}),
      ...listFilterColumn(fields, field.column),
    }))
    .filter((column) => column.filterable)
}

/** The select operators a field's allowed clause operators map to. */
export function listSelectOperators(allowed: readonly string[]) {
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
export function listFilterGridColumns(
  columns: readonly GridColDef[],
  fields: readonly ListFilterField[],
  options: Readonly<Record<string, readonly ListFilterOption[]>> = {},
  headers: Readonly<Record<string, string>> = {},
): GridColDef[] {
  const selectProps = (field: ListFilterField) => {
    const choices = options[field.column] ?? []
    const operators = listSelectOperators(listFilterOperators(field))
    return {
      type: 'singleSelect' as const,
      valueOptions: choices.map((choice) => ({ value: choice.value, label: choice.label })),
      filterable: choices.length > 0 && operators.length > 0,
      filterOperators: operators,
    }
  }
  /*
   * A column made a select keeps what it DREW. The grid formats a
   * `singleSelect` cell as the label of the option its value matches, and as
   * nothing when none does — so a column whose `valueGetter` hands back a
   * label (an address for an actor id, a site name for a scope id) went
   * blank the moment it gained a filter (AGL-3321). A column with its own
   * `renderCell` is left alone; any other draws the matching option's label
   * when there is one, and its own value when there is not.
   */
  const keepsItsCell = (column: GridColDef, field: ListFilterField) => {
    if (column.renderCell) return {}
    const labels = new Map(
      (options[field.column] ?? []).map((choice) => [choice.value, choice.label]),
    )
    return {
      renderCell: (params: { value?: unknown }) => {
        const value = params.value
        if (value === undefined || value === null) return ''
        return labels.get(String(value)) ?? String(value)
      },
    }
  }
  const shown = columns.map((column): GridColDef => {
    if (column.filterable === false && column.hideable === false) return column
    const field = fields.find((entry) => entry.column === column.field)
    if (!field) return { ...column, filterable: false }
    if (options[field.column]) {
      return { ...column, ...selectProps(field), ...keepsItsCell(column, field) } as GridColDef
    }
    return { ...column, ...listFilterColumn(fields, field.column) }
  })
  const present = columns.map((column) => column.field)
  /*
   * A field with choices is judged filterable by its choices, not by the
   * grid's operators for its kind: a Yes/No `boolean` field allows `equals`,
   * which the grid's boolean pool names `is`, so judged the plain way it has
   * no operator and was dropped before its choices could make it a select —
   * leaving a served filter nobody could reach (AGL-3332's Clicked). A field
   * with choices stays a column even while they are empty (products not yet
   * loaded): the list still reads a clause on it back through that column.
   */
  const hidden = fields
    .filter((field) => !present.includes(field.column))
    .flatMap((field): GridColDef[] => {
      const base = {
        field: field.column,
        headerName: headers[field.column] ?? field.column,
        ...filterOnlyColumnProps(field, options),
      }
      if (options[field.column]) return [{ ...base, ...selectProps(field) } as GridColDef]
      const plain = listFilterColumn(fields, field.column)
      return plain.filterable ? [{ ...base, ...plain } as GridColDef] : []
    })
  return [...shown, ...hidden]
}

/**
 * Whether a row answers a quick search: every whitespace-separated word
 * appears, case-insensitively, in SOME of the row's searched values. A
 * blank search matches every row, so an emptied box is the list unfiltered.
 * An array value (tags) is searched member by member.
 */
export function listRowMatchesSearch(
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
export function upsertListFilterClause<Clause extends ListFilterClause>(
  clauses: readonly Clause[],
  field: string,
  next: Clause | null,
): Clause[] {
  const at = clauses.findIndex((clause) => clause.field === field)
  const rest = clauses.filter((clause) => clause.field !== field)
  if (!next) return rest
  if (at === -1) return [...rest, next]
  return [...rest.slice(0, at), next, ...rest.slice(at)]
}

export { listFilterClauseSentence } from './list-filter-sentence'
