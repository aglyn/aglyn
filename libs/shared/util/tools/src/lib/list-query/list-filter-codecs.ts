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

import { gridFilterRequests, type ListFilterRequest } from './list-filter'

/*
 * The clause shapes and codecs of the grid filter grammar that need no grid:
 * what a list stores, and how a stored clause and a Filters panel item
 * translate. The web's data grid (`@aglyn/shared-ui-jsx/const/list-grid-filter`)
 * and a surface with no grid at all — the native app — read a list's
 * declaration through the same codecs.
 */

/**
 * A Filters panel item, structurally: the fields of the data grid's
 * `GridFilterItem` a codec reads and writes, so this module needs no grid.
 */
export interface ListFilterPanelItem {
  id?: number | string
  field: string
  operator: string
  // The grid types a panel value as `any`; a codec narrows it.
  value?: any
}

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
export const SELECT_TO_GRID: Readonly<Record<string, string>> = {
  equals: 'is',
  doesNotEqual: 'not',
  isAnyOf: 'isAnyOf',
}

/** The stored operator each grid select operator saves as. */
export const SELECT_FROM_GRID: Readonly<Record<string, string>> = {
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
  toItem: (clause: ListFilterClause) => Pick<ListFilterPanelItem, 'operator' | 'value'> | null
  toClause: (item: ListFilterPanelItem) => ListFilterClause | null
}

/** The panel's item as a clause, through the grammar's one notion of "usable". */
export const plainClause = (item: ListFilterPanelItem): ListFilterClause | null =>
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
