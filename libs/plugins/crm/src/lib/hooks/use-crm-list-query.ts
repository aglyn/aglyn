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

import type { ListFilterField, ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useFirestore, useScopeTokens } from '@aglyn/tenant-feature-instance'
import {
  useListQuery,
  type UseListQueryResult,
} from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { collection as collectionRef } from 'firebase/firestore'
import { useMemo } from 'react'
import { crmListAsk, crmListPlanReadBack } from '../model/crm-list-query'
import { crmScopeListable } from './use-crm-scope'

/**
 * Whether this reader's CRM queries may drop the `visibleTo` clause — fold
 * the search into it, or stand an array clause in its place (AGL-3321).
 *
 * At the organization level there is no clause to drop. Under a site the
 * rules prove a query without one only for an ORG-WIDE member, so the
 * member's reach is read, and until it has answered the answer is no: a
 * search refused for a second is better than a list the rules refuse.
 */
export function useCrmFoldsScope(
  orgId: string | null | undefined,
  visibleTo: readonly string[] | null,
): boolean {
  const reach = useScopeTokens(visibleTo && orgId ? orgId : undefined)
  return visibleTo === null || (reach.loaded && reach.orgWide)
}

export interface UseCrmListQueryOptions {
  /** The org root, or `null` until it is known. */
  scope: readonly [string, string] | null
  /** The collection under the org root. */
  collection: string
  /** The reader's scope tokens, or `null` at the organization level. */
  visibleTo: readonly string[] | null
  /** Whether the reader may run queries without the scope clause — see `useCrmFoldsScope`. */
  foldsScope: boolean
  declaration: ListQueryDeclaration
  clauses: readonly ListFilterRequest[]
  search?: readonly string[]
  sort?: ListQuerySort | null
  /** Predicates beside the scope the list always applies (a task view, a pipeline). */
  base?: readonly ListQueryFilter[]
  /**
   * A clause that IMPLIES the scope clause: one no record outside the
   * reader's scope can answer (a contact's facet key for the viewing
   * holder). When the reader may run a query without the scope clause
   * (`foldsScope`) and such a clause reaches the query, it stands in the
   * scope clause's place — the one array clause a query has is then spent
   * on it. Only when it is actually SERVED: a scope dropped for a clause the
   * plan then refused would list records outside the scope.
   */
  impliesScope?: (clause: ListFilterRequest) => boolean
  /**
   * A reader whose access is some sites keeps the scope clause, which is the
   * query's one array clause, so their search cannot be a token search —
   * folded or not, the rules prove it only from `visibleTo`. It is served
   * instead as a PREFIX of this text field beside the scope clause (a range
   * over its `lowerPath`), and `notice` says so. Absent, their search is
   * refused by name.
   */
  prefixSearch?: { field: ListFilterField; notice: string }
  /**
   * A clause that stands ALONE beside the scope: a range that orders the
   * list by its own field, served without a composite per other clause. A
   * solo clause set beside any other, or beside the search, is refused by
   * name rather than asked.
   */
  soloClause?: (clause: ListFilterRequest) => boolean
  /** `false` holds the query — no read until the list has what it needs. */
  enabled?: boolean
  pageSize?: number
}

/**
 * A CRM list on its query (AGL-3321): the scope clause as the plan's base,
 * the reader's declaration (`crmListDeclarationFor`), every clause and the
 * search word planned together and paged by `useListQuery`.
 */
export function useCrmListQuery<T>(options: UseCrmListQueryOptions): UseListQueryResult<T> {
  const firestore = useFirestore()
  const {
    scope,
    collection,
    visibleTo,
    foldsScope,
    declaration,
    clauses,
    search,
    sort,
    base,
    impliesScope,
    prefixSearch,
    soloClause,
    enabled = true,
    pageSize,
  } = options
  const readable = enabled && Boolean(scope) && crmScopeListable(visibleTo)
  const ref = useMemo(
    () => (readable && scope ? collectionRef(firestore, scope[0], scope[1], collection) : null),
    [readable, firestore, scope, collection],
  )
  const ask = useMemo(
    () => crmListAsk(options),
    // The options object is new every render; these are what the ask reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTo, foldsScope, declaration, clauses, search, sort, base, impliesScope, prefixSearch, soloClause],
  )
  const result = useListQuery<T>({
    collection: ref,
    declaration: ask.reader,
    request: ask.request,
    deps: [scope?.[0] ?? null, scope?.[1] ?? null, collection, readable],
    idField: '$id',
    ...(pageSize ? { pageSize } : {}),
  })
  const plan = useMemo(() => crmListPlanReadBack(result.plan, ask), [result.plan, ask])
  return useMemo(() => ({ ...result, plan }), [result, plan])
}

export default useCrmListQuery
