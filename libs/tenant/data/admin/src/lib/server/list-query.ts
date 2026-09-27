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

import { FieldPath, Timestamp } from 'firebase-admin/firestore'

/*
 * THE ADMIN TWIN OF THE LIST QUERY PLAN (AGL-3321).
 *
 * `planListQuery` (`@aglyn/shared-ui-jsx/const/list-query-plan`) composes a
 * list's clauses and search into one SDK-free plan; this puts that plan on
 * an Admin query, for a route that reads a list on the server — a console
 * route or a plugin's API handler alike, which is why it lives here and not
 * in the console. The web twin is `listQueryConstraints` in the instance
 * library.
 *
 * The plan's shape is restated structurally rather than imported, so this
 * data library stays free of the UI library that plans it: any object with
 * these fields is a plan, and `ListQueryPlan` is one.
 */

/** The document id, as the plan spells it. */
const ID_PATH = '__name__'

/** The part of a list query plan the query is built from. */
export interface AdminListQueryPlan {
  filters: ReadonlyArray<{
    path: string
    op: FirebaseFirestore.WhereFilterOp
    value: unknown
  }>
  orderBy: { path: string; direction: 'asc' | 'desc' }
}

const planValue = (value: unknown): unknown =>
  value instanceof Date ? Timestamp.fromDate(value) : Array.isArray(value) ? [...value] : value

/**
 * Every predicate the plan holds, then its one order.
 *
 * The caller pages it with its own cursor (`startAfter` a document in the
 * plan's order) and matches nothing afterwards: what the plan refused is not
 * applied, and the route says so in its response (`plan.refused`).
 */
export function applyListQuery(
  ref: FirebaseFirestore.Query,
  plan: AdminListQueryPlan,
): FirebaseFirestore.Query {
  const path = (value: string) => (value === ID_PATH ? FieldPath.documentId() : value)
  let query = ref
  for (const filter of plan.filters) {
    query = query.where(path(filter.path), filter.op, planValue(filter.value))
  }
  return query.orderBy(path(plan.orderBy.path), plan.orderBy.direction)
}
