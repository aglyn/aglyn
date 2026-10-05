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

import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQueryOp,
  ListQueryPlan,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * "THE CURRENT FILTER" OF A COMMERCE LIST, CARRIED TO AN EXPORT (AGL-3531).
 *
 * A list's filter is its Firestore query (AGL-3321): the predicates and the
 * one order `planListQuery` made of the chips and the search. The export
 * reads the same query on the server, so the list hands over exactly that —
 * the planned predicates and order — rather than the chips, whose dates the
 * browser resolved in the person's own timezone.
 *
 * The server reads through the Admin SDK, so it never takes a predicate on
 * faith: every path must be one the list's declaration names (a field's
 * path, lower-cased key or tokens, the search tokens, the list's base), the
 * operator one Firestore has, and the value plain data. Anything else is
 * refused, never widened to "everything".
 */

/** What a list sends as its export filter. */
export interface CommerceListFilter {
  filters: ListQueryFilter[]
  orderBy: ListQuerySort
}

const OPS: readonly ListQueryOp[] = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'array-contains',
  'array-contains-any',
]

/** The id path a plan names the document id by. */
const ID_PATH = '__name__'

/** The filter a list hands the export dialog: its plan's predicates and order, as plain data. */
export function commerceListFilter(plan: Pick<ListQueryPlan, 'filters' | 'orderBy'>): CommerceListFilter {
  return {
    filters: plan.filters.map((filter) => ({
      path: filter.path,
      op: filter.op,
      value:
        filter.value instanceof Date
          ? filter.value.getTime()
          : Array.isArray(filter.value)
            ? [...filter.value]
            : filter.value,
    })),
    orderBy: { path: plan.orderBy.path, direction: plan.orderBy.direction },
  }
}

/** Every path the declaration lets a query name. */
function allowedPaths(declaration: ListQueryDeclaration, base: readonly string[]): Set<string> {
  const paths = new Set<string>([ID_PATH, ...base])
  for (const field of declaration.fields) {
    for (const path of [field.path, field.lowerPath, field.tokensPath, field.containsOrderBy]) {
      if (path) paths.add(path)
    }
  }
  if (declaration.search) paths.add(declaration.search.tokensPath)
  for (const sort of declaration.sorts) paths.add(sort.path)
  return paths
}

const plain = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value)

/**
 * The filter a request carried, checked against the list's declaration.
 * Throws a sentence naming what was refused.
 */
export function readCommerceListFilter(
  value: unknown,
  declaration: ListQueryDeclaration,
  base: readonly string[] = [],
): CommerceListFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The filter could not be read.')
  }
  const raw = value as { filters?: unknown; orderBy?: unknown }
  const paths = allowedPaths(declaration, base)
  const filters: ListQueryFilter[] = []
  for (const entry of Array.isArray(raw.filters) ? raw.filters : []) {
    const { path, op, value: operand } = (entry ?? {}) as Record<string, unknown>
    if (typeof path !== 'string' || !paths.has(path)) {
      throw new Error(`The filter names "${String(path)}", which this list does not filter by.`)
    }
    if (!OPS.includes(op as ListQueryOp)) throw new Error(`The filter uses an unknown operator.`)
    const list = op === 'in' || op === 'array-contains-any'
    if (list) {
      if (!Array.isArray(operand) || !operand.length || operand.length > 30 || !operand.every(plain)) {
        throw new Error('The filter holds a list it cannot ask for.')
      }
    } else if (!plain(operand)) {
      throw new Error('The filter holds a value it cannot ask for.')
    }
    filters.push({ path, op: op as ListQueryOp, value: operand as ListQueryFilter['value'] })
  }
  const order = (raw.orderBy ?? {}) as Record<string, unknown>
  const direction = order.direction === 'desc' ? 'desc' : 'asc'
  const orderPath = typeof order.path === 'string' ? order.path : (declaration.sorts[0]?.path ?? ID_PATH)
  if (!paths.has(orderPath)) throw new Error(`The filter orders by "${orderPath}", which this list does not sort by.`)
  return { filters, orderBy: { path: orderPath, direction } }
}
