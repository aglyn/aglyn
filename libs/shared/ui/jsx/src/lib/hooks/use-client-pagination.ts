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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '../const/table-pagination'
import type { ListPaginationProps } from '../components/list-pagination.component'

export interface ClientPagination<T> {
  /** Zero-based. */
  page: number
  pageSize: number
  /** The rows of the current page. */
  pageItems: T[]
  setPage: (page: number) => void
  /** Changes the page size and returns to the first page. */
  setPageSize: (pageSize: number) => void
  /** Everything `ListPagination` needs, for a list held whole in memory. */
  paginationProps: ListPaginationProps
}

/**
 * A list already held whole in memory, paged for `ListPagination` (AGL-3637).
 *
 * The pairing every plugin was writing by hand: a page and a page size in
 * state, a `slice()`, and the footer's props. The page is pulled back inside
 * the list when it shrinks under the reader — a filter that leaves two rows
 * must not strand them on an empty page five. A list fetched page by page
 * from Firestore pages with `usePagedCollection` instead.
 */
export function useClientPagination<T>(
  items: readonly T[],
  options: { pageSize?: number } = {},
): ClientPagination<T> {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSizeState] = useState(options.pageSize ?? TABLE_PAGE_SIZE_DEFAULT)
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1)
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [page, lastPage])
  const current = Math.min(page, lastPage)
  const pageItems = useMemo(
    () => items.slice(current * pageSize, (current + 1) * pageSize),
    [items, current, pageSize],
  )
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    setPage(0)
  }, [])
  return {
    page: current,
    pageSize,
    pageItems,
    setPage,
    setPageSize,
    paginationProps: {
      page: current,
      pageSize,
      rowCount: pageItems.length,
      count: items.length,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
    },
  }
}
