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

/**
 * A TEST DOUBLE for `useListQuery` (AGL-3321) — for specs only.
 *
 * It runs the REAL `planListQuery` over the request, then answers the plan
 * the way Firestore would: each of `plan.filters` (==, !=, ranges, in,
 * array-contains, array-contains-any, the document id) over fixture rows,
 * the plan's one order, and pages of the requested size. A card spec mocks
 * the hook with it:
 *
 *     jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
 *       require('@aglyn/tenant-feature-instance/testing/list-query-double')
 *         .listQueryModule(
 *           () => mockRows,
 *           jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
 *         ))
 *
 * and asserts both what the plan asked for (`lastListQueryPlan()`) and which
 * rows came back — so a spec can prove a match past the first page is found.
 *
 * ⛔ Never import this outside a spec. It is exactly the in-memory matching
 * the lists stopped doing; a production path through it is the bug AGL-3321
 * removed.
 */

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryFilter,
  type ListQueryPlan,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useMemo, useState } from 'react'
import type { UseListQueryOptions, UseListQueryResult } from '../hooks/use-list-query'

type Row = Record<string, unknown> & { $id?: string }

const read = (row: Row, path: string): unknown =>
  path === LIST_QUERY_ID_PATH
    ? row.$id
    : path.split('.').reduce<unknown>(
        (at, key) => (at == null ? undefined : (at as Record<string, unknown>)[key]),
        row,
      )

const comparable = (value: unknown): unknown => {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return (value as { toMillis(): number }).toMillis()
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    return (value as { seconds: number }).seconds * 1000
  }
  return value
}

/** Whether a row answers one predicate, as Firestore reads it. */
export function rowAnswers(row: Row, filter: ListQueryFilter): boolean {
  const held = read(row, filter.path)
  const want = filter.value
  switch (filter.op) {
    case '==':
      return want === null ? held === null : comparable(held) === comparable(want)
    case '!=':
      // Firestore's `!=` also requires the field to exist.
      return held !== undefined && comparable(held) !== comparable(want)
    case 'in':
      return (want as readonly unknown[]).some((entry) => comparable(entry) === comparable(held))
    case 'array-contains':
      return Array.isArray(held) && held.includes(want as never)
    case 'array-contains-any':
      return Array.isArray(held) && (want as readonly unknown[]).some((entry) => held.includes(entry))
    default: {
      if (held === undefined || held === null) return false
      const a = comparable(held) as number | string
      const b = comparable(want) as number | string
      if (filter.op === '<') return a < b
      if (filter.op === '<=') return a <= b
      if (filter.op === '>') return a > b
      return a >= b
    }
  }
}

/** The rows a plan's query returns, in its order — Firestore's answer, restated. */
export function answerListQuery<T extends Row>(rows: readonly T[], plan: ListQueryPlan): T[] {
  const { path, direction } = plan.orderBy
  return rows
    .filter((row) => plan.filters.every((filter) => rowAnswers(row, filter)))
    // `orderBy` drops a document missing the field it sorts by.
    .filter((row) => path === LIST_QUERY_ID_PATH || read(row, path) !== undefined)
    .sort((left, right) => {
      const a = comparable(read(left, path)) as number | string
      const b = comparable(read(right, path)) as number | string
      const order = a < b ? -1 : a > b ? 1 : String(left.$id).localeCompare(String(right.$id))
      return direction === 'desc' ? -order : order
    })
}

let lastPlan: ListQueryPlan | null = null

/** The plan the double answered last, for a spec to assert what was asked. */
export const lastListQueryPlan = (): ListQueryPlan | null => lastPlan

/**
 * `useListQuery`, answered from `rows()` instead of Firestore — same
 * signature, same paging surface as `usePagedCollection`.
 */
export function useListQueryDouble<T = Row>(
  rows: () => readonly Row[],
  options: UseListQueryOptions,
): UseListQueryResult<T> {
  const { declaration, request } = options
  const pageSizeOption = options.pageSize ?? 10
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(pageSizeOption)
  const plan = useMemo(
    () => planListQuery(declaration, request, nameSearchNormalizers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [declaration, JSON.stringify(request)],
  )
  lastPlan = plan
  const matched = answerListQuery(rows(), plan)
  const windowRows = matched.slice(0, pageSize * (page + 1) + 1)
  return {
    data: windowRows as unknown as T[],
    rows: matched.slice(page * pageSize, (page + 1) * pageSize) as unknown as T[],
    hasMore: matched.length > pageSize * (page + 1),
    page,
    setPage,
    pageSize,
    setPageSize: (next: number) => {
      setPageSize(next)
      setPage(0)
    },
    status: 'success',
    error: undefined,
    fromCache: false,
    serverDenied: false,
    plan,
  } as unknown as UseListQueryResult<T>
}

/**
 * A module to hand `jest.mock('…/hooks/use-list-query', …)`: the double in
 * place of the hook, the real `listQueryConstraints` beside it.
 *
 * `actual` is the real module, which the spec's factory passes in as
 * `jest.requireActual(…)`. Jest injects `jest` into each spec module rather
 * than setting it on `globalThis`, so this file cannot reach it itself.
 */
export function listQueryModule(rows: () => readonly Row[], actual: object) {
  return {
    ...actual,
    useListQuery: (options: UseListQueryOptions) => useListQueryDouble(rows, options),
  }
}
