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

import { NOTIFICATION_TYPE_LABELS } from '@aglyn/aglyn/app-utils/notifications'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { TABLE_ROW_HEIGHT } from '../constants/shared'

/** The label a notification's type reads as, or the stored type itself. */
const typeLabel = (type: string | undefined): string =>
  (NOTIFICATION_TYPE_LABELS as Record<string, string>)[type ?? ''] ?? type ?? ''

/**
 * One row per notification: what it says, what kind it is, when it arrived,
 * and whether it is still unread. The title carries the unread weight, and
 * the body rides beneath it on one line.
 */
const NOTIFICATION_COLUMNS: GridColDef[] = [
  {
    field: 'title',
    headerName: 'Notification',
    flex: 1,
    minWidth: 260,
    renderCell: ({ row }) => (
      <Stack sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: row.readAt ? 'fontWeightRegular' : 'fontWeightMedium' }}
        >
          {row.title}
        </Typography>
        {row.body ? (
          <Typography variant="caption" color="text.secondary" noWrap title={row.body}>
            {row.body}
          </Typography>
        ) : null}
      </Stack>
    ),
  },
  {
    field: 'type',
    headerName: 'Type',
    width: 190,
    valueGetter: (_value, row) => typeLabel(row.type),
    renderCell: ({ row }) => <Chip size="small" label={typeLabel(row.type)} />,
  },
  {
    field: 'createdAt',
    headerName: 'When',
    width: 200,
    // Sorted on the instant, drawn as a local string: a grid sorting the
    // drawn text puts 12 January before 2 February.
    valueGetter: (_value, row) => row.createdAt?.toDate?.()?.getTime?.() ?? 0,
    renderCell: ({ row }) => row.createdAt?.toDate?.().toLocaleString() ?? '',
  },
  {
    field: 'readAt',
    headerName: 'Status',
    width: 100,
    align: 'right',
    headerAlign: 'right',
    valueGetter: (_value, row) => (row.readAt ? 'Read' : 'New'),
    renderCell: ({ row }) =>
      row.readAt ? null : <Chip size="small" color="primary" label="New" />,
  },
]

export interface NotificationsTableProps {
  /** One page of the signed-in person's notifications, newest first. */
  rows: any[]
  /** A row was opened: mark it read and follow its link. */
  onOpen: (notification: any) => void
  page: number
  pageSize: number
  /** Whether the feed holds a page after this one. */
  hasMore: boolean
  /** A page is being read, so the pager holds still. */
  loading?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

/**
 * THE NOTIFICATIONS FEED, AS A RECORD LIST (AGL-3045).
 *
 * The shared grid scrolls its own columns inside the card, where a bare table
 * cut a long title or type off at the card's edge. The row opens the
 * notification, as the table's row did.
 *
 * The rows are ONE page of a cursor feed, turned by the pager under the
 * grid, so the grid's own footer is off, and so are its search box and
 * filter panel, which could only narrow the page on screen and would call
 * that the whole feed.
 */
export function NotificationsTable(props: NotificationsTableProps) {
  const {
    rows,
    onOpen,
    page,
    pageSize,
    hasMore,
    loading,
    onPageChange,
    onPageSizeChange,
  } = props
  return (
    <>
      {rows.length === 0 && !loading ? (
        <Typography variant="body2" color="text.secondary">
          {"You're all caught up."}
        </Typography>
      ) : (
        <ListTable
          aria-label="Notifications"
          rows={rows}
          columns={NOTIFICATION_COLUMNS}
          rowHeight={TABLE_ROW_HEIGHT}
          hideFooter
          disableColumnFilter
          quickFilter={false}
          onOpen={(_id, row) => onOpen(row)}
        />
      )}
      <ListPagination
        page={page}
        pageSize={pageSize}
        rowCount={rows.length}
        hasMore={hasMore}
        disabled={loading}
        onPageChange={(next) => {
          if (next !== page) onPageChange(next)
        }}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  )
}
NotificationsTable.displayName = 'NotificationsTable'

export default NotificationsTable
