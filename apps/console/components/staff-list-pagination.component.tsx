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

import { Button, Stack, Typography } from '@mui/material'
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
}

/**
 * PREVIOUS / `Page n · m shown` / NEXT for a staff list (AGL-2486).
 *
 * Extracted from the Organizations list so the Users list is the same
 * control and not a second one that looks like it. Rendered whenever the
 * page has rows — including on a single page — because a control that
 * appears only once there is more than one page is a control staff cannot
 * learn.
 */
export default function StaffListPaginationControls<TRow>({
  pagination,
  shown,
}: StaffListPaginationControlsProps<TRow>) {
  const { rows, pageIndex, hasMore, loading, loadPage } = pagination
  const count = shown === undefined ? (rows?.length ?? 0) : shown
  if (!rows?.length) return null
  return (
    <Stack direction="row" spacing={1.5} sx={{ mt: 1, alignItems: 'center' }}>
      <Button
        size="small"
        variant="outlined"
        disabled={loading || pageIndex === 0}
        onClick={() => void loadPage(pageIndex - 1)}
      >
        {'Previous'}
      </Button>
      <Typography variant="caption" color="text.secondary">
        {`Page ${pageIndex + 1} · ${count} shown`}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        disabled={loading || !hasMore}
        onClick={() => void loadPage(pageIndex + 1)}
      >
        {'Next'}
      </Button>
    </Stack>
  )
}
