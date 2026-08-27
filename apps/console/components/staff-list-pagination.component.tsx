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

/**
 * What the staff list ROUTES page at. Not a choice this control makes — it
 * mirrors `PAGE_SIZE` in `/api/admin/orgs` so the count line adds up.
 */
const STAFF_ROUTE_PAGE_SIZE = 25

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
}

/**
 * The staff lists' footer — the console's shared one (AGL-693).
 *
 * Extracted from the Organizations list so the Users list is the same control
 * and not a second one that looks like it; it is now the same control as
 * every OTHER list too, rather than a third grammar that merely resembled
 * them. Rendered whenever the page has rows — including on a single page —
 * because a control that appears only once there is more than one page is a
 * control staff cannot learn.
 *
 * ⚠️ No size menu yet, and that is a property of what is behind it: the page
 * size is fixed by the ROUTE (`/api/admin/orgs` pages 25, the Users list pages
 * through Firebase Auth), so offering the menu would offer a choice the
 * request cannot carry. Passing `onPageSizeChange` is all this needs once
 * those routes take a size.
 */
export default function StaffListPaginationControls<TRow>({
  pagination,
  shown,
}: StaffListPaginationControlsProps<TRow>) {
  const { rows, pageIndex, hasMore, loading, loadPage } = pagination
  const count = shown === undefined ? (rows?.length ?? 0) : shown
  if (!rows?.length) return null
  return (
    <ListPagination
      page={pageIndex}
      // The size the routes actually serve. Stated rather than guessed: the
      // count line is arithmetic over it, so a wrong number here would read
      // as a wrong total.
      pageSize={STAFF_ROUTE_PAGE_SIZE}
      rowCount={count}
      hasMore={hasMore}
      disabled={loading}
      onPageChange={(next) => {
        if (next === pageIndex) return
        void loadPage(next)
      }}
    />
  )
}
