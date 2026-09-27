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
  getGridSingleSelectOperators,
  type GridColDef,
  type GridFilterItem,
} from '@mui/x-data-grid'
import {
  gridFilterRequests,
  hiddenFilterColumns,
  type ListFilterField,
  type ListFilterRequest,
  listFilterColumn,
  listFilterOperatorLabel,
  listFilterOperators,
  matchListFilter,
} from './list-filter'

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

/** One clause a list is narrowed by; `label` names a picked value on a chip. */
export interface ListFilterClause extends ListFilterRequest {
  label?: string
}

/** A choice for a field whose value is picked rather than typed. */
export interface ListFilterOption {
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
 * with choices uses {@link listSelectCodec}; a typed one,
 * {@link listPlainCodec}. A list whose clauses predate the panel supplies
 * its own.
 */
export interface ListGridFilterCodec {
  toItem: (clause: ListFilterClause) => Pick<GridFilterItem, 'operator' | 'value'> | null
  toClause: (item: GridFilterItem) => ListFilterClause | null
}

/** The panel's item as a clause, through the grammar's one notion of "usable". */
const plainClause = (item: GridFilterItem): ListFilterClause | null =>
  gridFilterRequests({ items: [item] })[0] ?? null

/** A typed field: the stored operator IS the grid's. */
export const listPlainCodec: ListGridFilterCodec = {
  toItem: (clause) => ({
    operator: clause.op,
    value: clause.value === '' ? undefined : clause.value,
  }),
  toClause: plainClause,
}

/** A picked field: `equals` shows as `is`, and `isAnyOf` holds a comma list. */
export const listSelectCodec: ListGridFilterCodec = {
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

/** Operators that carry no value. */
const VALUELESS_OPERATORS = new Set(['isEmpty', 'isNotEmpty'])
/** Operators that take several values, comma-joined the way the grammar splits them. */
const MULTI_OPERATORS = new Set(['isAnyOf'])

const dayLabel = (raw: string): string => {
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? raw : at.toLocaleDateString()
}

/**
 * How a clause reads as a sentence — "Owner is Dana", "Created on or after
 * 1 Jan", "Reason is any of Bounced, Complained": its header, its operator,
 * and its value by the label of the option it names.
 *
 * ONE wording, used by the chips over a list and by the notices that say a
 * clause was not applied (`listQueryRefusals`), so the two cannot describe
 * the same clause differently.
 */
export function listFilterClauseSentence(
  clause: ListFilterClause,
  context: {
    fields: readonly ListFilterField[]
    headers?: Readonly<Record<string, string>>
    options?: Readonly<Record<string, readonly ListFilterOption[]>>
  },
): string {
  const field = context.fields.find((entry) => entry.column === clause.field)
  const header = context.headers?.[clause.field] ?? clause.field
  const choices = context.options?.[clause.field]
  const named = (value: string) =>
    choices?.find((option) => option.value === value)?.label ?? value
  const value = VALUELESS_OPERATORS.has(clause.op)
    ? ''
    : MULTI_OPERATORS.has(clause.op)
      ? clause.value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map(named)
          .join(', ')
      : clause.label ?? (field?.kind === 'date' ? dayLabel(clause.value) : named(clause.value))
  return `${header} ${listFilterOperatorLabel(clause.op)}${value ? ` ${value}` : ''}`
}

