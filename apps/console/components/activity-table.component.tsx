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

import { CardDisplay, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { GridColDef, GridFilterModel } from '@mui/x-data-grid'
import { Alert, Stack, Typography } from '@mui/material'
import { TABLE_ROW_HEIGHT } from '../constants/shared'

export interface ActivityTableProps {
  header: string
  /** The card's `?`. Passed in because the docs topic differs by surface. */
  help?: HelpTipContent
  /** What this table is OF, in the caller's own words. */
  description?: string
  columns: GridColDef[]
  rows: readonly any[]
  getRowId: (row: any) => string
  loading?: boolean
  /**
   * The read FAILED, which is not the same as there being nothing. Rendering
   * the two the same way is a lie with a clean-looking face, and this is the
   * kind of table where that costs most.
   */
  unreadable?: boolean
  emptyLabel?: string
  unreadableLabel?: string
  /**
   * Supply only when the SOURCE narrows itself. Its presence is what puts the
   * grid in `filterMode="server"`; without it the grid filters the page it
   * holds, which on a paged feed answers "nothing happened" about everything
   * that is not on screen.
   */
  onFilterModelChange?: (model: GridFilterModel) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  /** A cursor feed: whether a further page exists. */
  hasMore?: boolean
  /** A client-side list: the real total, which it genuinely knows. */
  count?: number
  paginationDisabled?: boolean
}

/**
 * ONE table for every activity and audit read-out in the console.
 *
 * The staff user page is where this became unarguable: two tables of audit
 * data, stacked, in two visual languages. "Activity by this account" was a
 * real component — grid, toolbar, column filters, chips, a working footer —
 * and "Recent audit trail" directly beneath it was a hand-rolled
 * `<Table size="small">` written inline in the page, with no toolbar, no
 * footer, a different row density and plain text where the other used chips.
 * Only one of the two could be paged, filtered or exported, and nothing said
 * which or why.
 *
 * Adding a footer to the hand-rolled one would have left two implementations
 * and made them merely similar, which is how they drifted apart in the first
 * place. This is the shared piece instead: the card, the grid, the toolbar,
 * the empty and unreadable states, and the footer.
 *
 * What it deliberately does NOT own is the COLUMNS or the source. The two
 * tables on that page show genuinely different things — what an account did,
 * and what staff did to it — and the page's copy is careful about the
 * distinction. A shared presentation must not flatten it.
 *
 * ## Paged two ways, on purpose
 *
 * A cursor feed passes `hasMore` and pages by re-reading; a table over rows
 * already in memory passes `count` and slices. `ListPagination` already
 * models both, so the difference stays where it belongs — with whoever owns
 * the data — instead of forcing every caller onto a cursor it does not have.
 */
export function ActivityTable(props: ActivityTableProps) {
  const {
    header,
    help,
    description,
    columns,
    rows,
    getRowId,
    loading,
    unreadable,
    emptyLabel = 'No activity recorded.',
    unreadableLabel = 'The activity log could not be read. This is not the ' +
      'same as there being none — try again, or check the browser console.',
    onFilterModelChange,
    page,
    pageSize,
    onPageChange,
    onPageSizeChange,
    hasMore,
    count,
    paginationDisabled,
  } = props

  return (
    // `contentGutter*` like every other card on these pages — without them a
    // card's content sits flush against its own border while the ones above
    // and below it are inset, which reads as a rendering fault rather than a
    // new card.
    <CardDisplay header={header} help={help} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        {description ? (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        ) : null}
        {unreadable ? (
          <Alert severity="warning">{unreadableLabel}</Alert>
        ) : rows.length === 0 && !loading ? (
          <Typography variant="body2" color="text.secondary">
            {emptyLabel}
          </Typography>
        ) : (
          <ListTable
            rows={rows as any[]}
            columns={columns}
            getRowId={getRowId}
            /*
             * NO `onOpen`. An audit row is not a record you open, and a
             * row-click would promise a destination these rows do not have.
             */
            hideFooter
            rowHeight={TABLE_ROW_HEIGHT}
            /*
             * A filter panel that narrows ONE PAGE is worse than none.
             *
             * A caller with a server handler puts the grid in server mode and
             * the source answers the filter. A caller without one holds a
             * single page of rows, so the grid's own pass would narrow those
             * and call it the answer — on an audit read-out, "nothing
             * happened" is the wrong answer to give about every page but this
             * one. The panel is turned off there rather than left inert.
             */
            {...(onFilterModelChange
              ? { filterMode: 'server' as const, onFilterModelChange }
              : { disableColumnFilter: true })}
          />
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={rows.length}
          {...(count === undefined ? { hasMore } : { count })}
          disabled={paginationDisabled}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </Stack>
    </CardDisplay>
  )
}
ActivityTable.displayName = 'ActivityTable'

export default ActivityTable
