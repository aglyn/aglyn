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

'use client'

import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryPlan,
  type ListQueryRequest,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  type DocumentData,
  documentId,
  limit,
  orderBy,
  query,
  type Query,
  type QueryConstraint,
  Timestamp,
  where,
} from 'firebase/firestore'
import { type DependencyList, useMemo } from 'react'
import {
  usePagedCollection,
  type UsePagedCollectionOptions,
  type UsePagedCollectionResult,
} from './use-paged-collection'

/*
 * The web-SDK twin of the list query plan (AGL-3321): the plan's predicates
 * and its one order as `QueryConstraint`s, for a list that reads Firestore
 * from the browser. The Admin twin is `applyListQuery` in the console.
 *
 * ⚠️ These run under SECURITY RULES. A predicate on a field a rule does not
 * let the reader filter by arrives as a permission error, not an empty page.
 */

const path = (value: string) => (value === LIST_QUERY_ID_PATH ? documentId() : value)

const valueOf = (value: ListQueryFilter['value']): unknown =>
  value instanceof Date
    ? Timestamp.fromDate(value)
    : Array.isArray(value)
      ? [...value]
      : value

/** The plan as web-SDK constraints: every predicate, then its one order. */
export function listQueryConstraints(plan: ListQueryPlan): QueryConstraint[] {
  return [
    ...plan.filters.map((filter) => where(path(filter.path) as never, filter.op, valueOf(filter.value))),
    orderBy(path(plan.orderBy.path) as never, plan.orderBy.direction),
  ]
}

export interface UseListQueryOptions extends UsePagedCollectionOptions {
  /** The collection, or null while its path is not known yet. */
  collection: Query<DocumentData> | null
  declaration: ListQueryDeclaration
  request: ListQueryRequest
  /** Identifies the collection — the primitive ids its path is built from. */
  deps: DependencyList
}

export interface UseListQueryResult<T> extends UsePagedCollectionResult<T> {
  /** What the query holds, what it refused and what it says about it. */
  plan: ListQueryPlan
}

/**
 * A list whose EVERY clause and search word is on its Firestore query
 * (AGL-3321), paged by that query — `usePagedCollection` over the plan's
 * constraints, so each page is a page of matches and none is narrowed in
 * memory afterwards.
 *
 * A new plan is a new query and the pager starts over. The plan comes back
 * beside the rows for the list to show its refusals and notices
 * (`ListQueryNotices`) and to mark which chips reached the query.
 */
export function useListQuery<T = DocumentData>(
  options: UseListQueryOptions,
): UseListQueryResult<T> {
  const { collection, declaration, request, deps, ...pagedOptions } = options
  const plan = useMemo(
    () => planListQuery(declaration, request, nameSearchNormalizers),
    // The request is data; its JSON is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [declaration, JSON.stringify(request)],
  )
  const planKey = useMemo(
    () => JSON.stringify({ filters: plan.filters, orderBy: plan.orderBy }),
    [plan],
  )
  const paged = usePagedCollection<T>(
    (pageLimit) => {
      if (!collection) return null
      return query(collection, ...listQueryConstraints(plan), limit(pageLimit))
    },
    [...deps, planKey],
    pagedOptions,
  )
  return { ...paged, plan }
}
