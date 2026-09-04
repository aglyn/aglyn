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

import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import type { StaffListPagination } from '../hooks/use-staff-list-pagination'

export interface StaffListPaginationControlsProps<TRow> {
  /** The value returned by `useStaffListPagination`. */
  pagination: StaffListPagination<TRow>
  /**
   * How many rows the table is actually showing. Defaults to the page size
   * the hook holds; the Users list passes its own count because it collapses
   * cross-pool twins before rendering, and a strip that said `6 shown` over a
   * table of 5 rows would be a small lie in the one place staff go to check
   * that nobody is missing.
   */
  shown?: number
  /**
   * Offer the size menu. Off for a list whose size the ROUTE dictates — the
   * Users list pages at Firebase Auth's width because anything smaller hides
   * tenant-pool accounts, and a menu there would offer a choice the request
   * cannot honor.
   */
  sizeMenu?: boolean
}

/**
 * The staff lists' footer — the console's shared one (AGL-2501).
 *
 * Extracted from the Organizations list so the Users list is the same control
 * and not a second one that looks like it; it is now the same control as
 * every OTHER list too, rather than a third grammar that merely resembled
 * them. Rendered whenever the page has rows — including on a single page —
 * because a control that appears only once there is more than one page is a
 * control staff cannot learn.
 *
 * The size menu is real: `useStaffListPagination` carries the choice into
 * each request, and both staff list routes clamp it to the shared options.
 * Changing it discards every cursor collected so far — a cursor names a
 * position in a walk of a given width, and under a different width it points
 * somewhere else.
 */
export default function StaffListPaginationControls<TRow>({
  pagination,
  shown,
  sizeMenu = true,
}: StaffListPaginationControlsProps<TRow>) {
  const { rows, pageIndex, hasMore, loading, loadPage, pageSize, setPageSize } =
    pagination
  const count = shown === undefined ? (rows?.length ?? 0) : shown
  if (!rows?.length) return null
  return (
    <ListPagination
      page={pageIndex}
      pageSize={pageSize}
      rowCount={count}
      hasMore={hasMore}
      disabled={loading}
      onPageChange={(next) => {
        if (next === pageIndex) return
        void loadPage(next)
      }}
      onPageSizeChange={sizeMenu ? setPageSize : undefined}
    />
  )
}
