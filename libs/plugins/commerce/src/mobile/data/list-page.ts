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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryPlan,
  type ListQueryRequest,
  planListQuery,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  collection,
  documentId,
  type DocumentData,
  type Firestore,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  startAfter,
  Timestamp,
  where,
} from 'firebase/firestore'

/*
 * One page of a console list, read the way the console reads it (AGL-3621).
 *
 * The list's declaration (`ORDER_LIST_QUERY`, `PRODUCT_LIST_QUERY`) and the
 * shared planner decide every predicate and the one order, so the phone asks
 * Firestore exactly what the console grid asks and is served by the same
 * composite indexes — a filter is never a match over the rows already loaded.
 * What the plan refuses comes back with the page, for the screen to say.
 */

/** A page's cursor: the last document read, or null for the first page. */
export type ListCursor = QueryDocumentSnapshot<DocumentData> | null

export interface ListPage<T> {
  rows: T[]
  /** Where the next page starts, or null when this was the last. */
  next: ListCursor
  plan: ListQueryPlan
}

export const LIST_PAGE_SIZE = 25

const fieldPath = (path: string) => (path === LIST_QUERY_ID_PATH ? documentId() : path)

const valueOf = (value: ListQueryFilter['value']): unknown =>
  value instanceof Date ? Timestamp.fromDate(value) : Array.isArray(value) ? [...value] : value

/** The plan as JS-SDK constraints: every predicate, then its one order. */
export function planConstraints(plan: ListQueryPlan): QueryConstraint[] {
  return [
    ...plan.filters.map((filter) =>
      where(fieldPath(filter.path) as never, filter.op, valueOf(filter.value)),
    ),
    orderBy(fieldPath(plan.orderBy.path) as never, plan.orderBy.direction),
  ]
}

export function planList(
  declaration: ListQueryDeclaration,
  request: ListQueryRequest,
): ListQueryPlan {
  return planListQuery(declaration, request, nameSearchNormalizers)
}

/**
 * Reads one page. One extra document is asked for so the last page knows it
 * is the last without a second, empty read.
 */
export async function readListPage<T>(input: {
  firestore: Firestore
  path: string
  plan: ListQueryPlan
  cursor: ListCursor
  pageSize?: number
  map: (id: string, data: DocumentData) => T
}): Promise<ListPage<T>> {
  const size = input.pageSize ?? LIST_PAGE_SIZE
  const constraints = [
    ...planConstraints(input.plan),
    ...(input.cursor ? [startAfter(input.cursor)] : []),
    limit(size + 1),
  ]
  const snapshot = await getDocs(query(collection(input.firestore, input.path), ...constraints))
  const docs = snapshot.docs.slice(0, size)
  return {
    rows: docs.map((doc) => input.map(doc.id, doc.data())),
    next: snapshot.docs.length > size ? docs[docs.length - 1] : null,
    plan: input.plan,
  }
}

/** Splits the quick search's text into the words the planner takes. */
export function searchWords(text: string): string[] {
  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean)
}
