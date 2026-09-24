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
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useMemo } from 'react'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import {
  NOTIFICATION_FILTER_FIELDS,
  NOTIFICATION_FILTER_HEADERS,
  NOTIFICATION_FILTER_OPTIONS,
} from '../utils/notification-filters'
import type { NotificationWorkspace } from '../utils/notification-links'

/** The label a notification's type reads as, or the stored type itself. */
const typeLabel = (type: string | undefined): string =>
  (NOTIFICATION_TYPE_LABELS as Record<string, string>)[type ?? ''] ?? type ?? ''

/** What the Workspace cell reads for a row whose org was never recorded. */
const NO_WORKSPACE = '—'

/**
 * One row per notification: what it says, what kind it is, which workspace
 * it is about, when it arrived, and whether it is still unread. The title
 * carries the unread weight, and the body rides beneath it on one line.
 *
 * Built per render rather than declared once, because the Workspace column
 * needs the caller's resolver — the org names live with the page's org scope
 * and its host index, not here.
 */
const notificationColumns = (
  workspaceOf: (notification: any) => NotificationWorkspace,
): GridColDef[] => [
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
    /**
     * WHICH WORKSPACE THIS IS ABOUT (AGL-3249).
     *
     * A reader who belongs to more than one could not tell, and the feed
     * mixes them: it is keyed by PERSON (`users/{uid}/notifications`), not by
     * the workspace currently open.
     *
     * Three readings, and the third is deliberately not a guess — see
     * `resolveNotificationWorkspace`, which refuses the open workspace as a
     * fallback. An em dash says "not recorded", which is the truth for the
     * backlog written before the emitters stamped an org.
     */
    field: 'workspace',
    headerName: 'Workspace',
    width: 180,
    // Sorted and exported on the text, so the CSV download carries the same
    // three readings the cell draws.
    valueGetter: (_value, row) => {
      const workspace = workspaceOf(row)
      if (workspace.kind === 'staff') return 'Platform'
      return workspace.kind === 'workspace' ? workspace.label : NO_WORKSPACE
    },
    renderCell: ({ row }) => {
      const workspace = workspaceOf(row)
      if (workspace.kind === 'staff') {
        // Outlined, so a platform row is legible as NOT one of the reader's
        // workspaces at a glance rather than by reading the word.
        return <Chip size="small" variant="outlined" label="Platform" />
      }
      if (workspace.kind === 'workspace') {
        return (
          <Typography variant="body2" noWrap title={workspace.label}>
            {workspace.label}
          </Typography>
        )
      }
      return (
        <Typography variant="body2" color="text.disabled">
          {NO_WORKSPACE}
        </Typography>
      )
    },
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
    /**
     * READ OR NOT, and it SAYS SO EITHER WAY (AGL-3249).
     *
     * This drew the chip for an unread row and nothing at all for a read one,
     * so the steady state of a feed anybody keeps up with — every row read —
     * was a header over an empty strip. Reported as "always empty, idk what
     * it does", which is the correct reading of a column that never speaks.
     *
     * The chip is also the only LEGEND for the unread signal the title's font
     * weight carries, so the column earns its width; what it could not do was
     * stay silent for the majority of rows.
     */
    field: 'readAt',
    headerName: 'Status',
    width: 100,
    align: 'right',
    headerAlign: 'right',
    valueGetter: (_value, row) => (row.readAt ? 'Read' : 'New'),
    renderCell: ({ row }) =>
      row.readAt ? (
        <Typography variant="body2" color="text.disabled">
          Read
        </Typography>
      ) : (
        <Chip size="small" color="primary" label="New" />
      ),
  },
]

export interface NotificationsTableProps {
  /** One page of the signed-in person's notifications, newest first. */
  rows: any[]
  /** A row was opened: mark it read and follow its link. */
  onOpen: (notification: any) => void
  /**
   * Which workspace a row is about, for the Workspace column. The page owns
   * this because the org names are in its org scope and its host index.
   * Absent, every row reads as unattributed rather than as the open
   * workspace — the column must never invent an answer (AGL-3249).
   */
  workspaceOf?: (notification: any) => NotificationWorkspace
  page: number
  pageSize: number
  /** Whether the feed holds a page after this one. */
  hasMore: boolean
  /** A page is being read, so the pager holds still. */
  loading?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  /**
   * The Filters panel, bound by the page to the clauses its query serves
   * (AGL-3321). Absent, the panel is off, as it was before the feed's
   * query could answer it.
   */
  gridFilter?: ListGridFilter
}

/**
 * THE NOTIFICATIONS FEED, AS A RECORD LIST (AGL-3045).
 *
 * The shared grid scrolls its own columns inside the card, where a bare table
 * cut a long title or type off at the card's edge. The row opens the
 * notification, as the table's row did.
 *
 * The rows are ONE page of a cursor feed, turned by the pager under the
 * grid, so the grid's own footer is off.
 *
 * The Filters panel is the FEED'S, not the page's (AGL-3321): Type and
 * Status are equalities the feed's query applies beneath its `createdAt`
 * cursor (`utils/notification-filters.ts`), so every page the pager turns is
 * a page of the filtered feed. The search box stays off: a notification's
 * words are held by no index, so a search could only narrow the page on
 * screen and would call that the whole feed.
 */
export function NotificationsTable(props: NotificationsTableProps) {
  const {
    rows,
    onOpen,
    workspaceOf,
    page,
    pageSize,
    hasMore,
    loading,
    onPageChange,
    onPageSizeChange,
    gridFilter,
  } = props
  const columns = useMemo(
    () =>
      listFilterGridColumns(
        notificationColumns(workspaceOf ?? (() => ({ kind: 'unknown' }))),
        NOTIFICATION_FILTER_FIELDS,
        NOTIFICATION_FILTER_OPTIONS,
        NOTIFICATION_FILTER_HEADERS,
      ),
    [workspaceOf],
  )
  const filtering = Boolean(gridFilter?.clauses.length)
  return (
    <>
      {gridFilter ? (
        <ListFilterChips
          fields={NOTIFICATION_FILTER_FIELDS}
          headers={NOTIFICATION_FILTER_HEADERS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
          options={NOTIFICATION_FILTER_OPTIONS}
        />
      ) : null}
      {rows.length === 0 && !loading && !filtering ? (
        <Typography variant="body2" color="text.secondary">
          {"You're all caught up."}
        </Typography>
      ) : (
        <ListTable
          aria-label="Notifications"
          rows={rows}
          columns={columns}
          rowHeight={TABLE_ROW_HEIGHT}
          hideFooter
          // No index holds a notification's words; see above.
          quickFilter={false}
          onOpen={(_id, row) => onOpen(row)}
          noRowsLabel="No notifications match these filters"
          {...(gridFilter
            ? {
                filterMode: 'server' as const,
                filterModel: gridFilter.filterModel,
                onFilterModelChange: gridFilter.onFilterModelChange,
              }
            : { disableColumnFilter: true })}
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
