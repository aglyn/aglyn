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

import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListQueryRefusal, ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type StaffListPagination,
  useStaffListPagination,
} from './use-staff-list-pagination'

/*
 * THE PAGE SIDE OF A ROUTE-SERVED STAFF LIST (AGL-3321).
 *
 * Sends the Filters panel's clauses and the search box's words to the list's
 * route, which puts every one on its Firestore query
 * (`utils/server/staff-list-query.ts`), and pages the answer with the one
 * staff cursor walk (`useStaffListPagination`). The page never narrows the
 * rows it is handed: a clause the route could not put on its query comes
 * back in `refused`, for `ListQueryNotices`, and is not applied at all.
 *
 * A new clause, search or sort is a new query, and the walk starts over at
 * page one. The search is debounced, because each settled word is a read.
 */

export interface UseStaffListQueryOptions {
  /** The route, or null while the page cannot read yet (no staff claim). */
  endpoint: string | null
  clauses: readonly ListFilterRequest[]
  search: readonly string[]
  sort?: ListQuerySort | null
  /** Parameters the route takes besides the query's own (a scope, a tab). */
  params?: Readonly<Record<string, string>>
  /** Where the route puts its rows in the response; `rows` by default. */
  rowsKey?: string
  onError?: (error: unknown) => void
  pageSize?: number
}

export interface StaffListQuery<Row> extends StaffListPagination<Row> {
  /** What the route could not put on its query, and why. */
  refused: ListQueryRefusal[]
  /** What the route said about what it did serve. */
  notices: string[]
  /** The last read failed; the rows are not an answer. */
  failed: boolean
  /** A clause or a search word is in force. */
  filtering: boolean
}

/** The debounce on the search box, in milliseconds. */
const SEARCH_SETTLE_MS = 300

export function useStaffListQuery<Row>(
  options: UseStaffListQueryOptions,
): StaffListQuery<Row> {
  const { endpoint, clauses, search, sort = null, params, rowsKey = 'rows', onError } = options
  const { data: user } = useUser()
  /*
   * The account and the error reporter are read through refs: a new object
   * for the same signed-in account, or an inline `onError`, is not a new
   * question, and treating it as one would re-read the page on every render.
   * What identifies the reader is its uid.
   */
  const userRef = useRef(user)
  userRef.current = user
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const reportError = useCallback((error: unknown) => onErrorRef.current?.(error), [])
  const uid = user ? ((user as { uid?: string }).uid ?? 'signed-in') : null
  const typed = search.join(' ').trim()
  const [settled, setSettled] = useState(typed)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [typed])

  const [refused, setRefused] = useState<ListQueryRefusal[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [failed, setFailed] = useState(false)

  // The request as data: its JSON is its identity, so an equal request from
  // a new array is not a new query.
  const requestKey = JSON.stringify({
    clauses: clauses.map(({ field, op, value }) => ({ field, op, value })),
    settled,
    sort,
    params: params ?? {},
  })

  const fetchPage = useCallback(
    async (cursor: string | null, _pageIndex: number, pageSize: number) => {
      if (!endpoint) return { rows: [] as Row[], hasMore: false }
      const request = JSON.parse(requestKey) as {
        clauses: ListFilterRequest[]
        settled: string
        sort: ListQuerySort | null
        params: Record<string, string>
      }
      const url = new URL(endpoint, window.location.origin)
      for (const [key, value] of Object.entries(request.params)) url.searchParams.set(key, value)
      url.searchParams.set('pageSize', String(pageSize))
      if (request.clauses.length) url.searchParams.set('filters', JSON.stringify(request.clauses))
      if (request.settled) url.searchParams.set('search', request.settled)
      if (request.sort) url.searchParams.set('sort', `${request.sort.path}:${request.sort.direction}`)
      if (cursor) url.searchParams.set('cursor', cursor)
      try {
        const response = await authorizedFetch(userRef.current, url.toString())
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error ?? 'The list could not be read')
        setFailed(false)
        setRefused(Array.isArray(payload?.refused) ? payload.refused : [])
        setNotices(Array.isArray(payload?.notices) ? payload.notices : [])
        return {
          rows: (Array.isArray(payload?.[rowsKey]) ? payload[rowsKey] : []) as Row[],
          hasMore: Boolean(payload?.hasMore),
          nextCursor: payload?.nextCursor ?? null,
        }
      } catch (error) {
        setFailed(true)
        throw error
      }
    },
    // `uid` is the reader's identity; a sign-in or a switch of account re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, requestKey, rowsKey, uid],
  )

  const pagination = useStaffListPagination<Row>({
    fetchPage,
    onError: reportError,
    enabled: Boolean(endpoint && uid),
    pageSize: options.pageSize,
  })

  const filtering = useMemo(() => clauses.length > 0 || typed.length > 0, [clauses, typed])
  return { ...pagination, refused, notices, failed, filtering }
}

export default useStaffListQuery
