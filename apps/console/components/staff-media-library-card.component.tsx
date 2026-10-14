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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListQueryNotices } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Box, Chip, Link, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useMemo, useRef, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import { type StaffListPage, useStaffListPagination } from '../hooks/use-staff-list-pagination'
import {
  STAFF_MEDIA_COLUMN_SORTS,
  STAFF_MEDIA_SORT,
  type StaffMediaRow,
  staffMediaSizeLabel,
  staffMediaTypeLabel,
} from '../utils/staff-media-library'
import StaffListPaginationControls from './staff-list-pagination.component'
import StaffMediaAssetDialog from './staff-media-asset-dialog.component'

/** The table has no filters, so nothing is ever refused. */
const NO_REFUSALS: ReadonlyArray<{ label: string; reason: string }> = []

const THUMB = 40

export interface StaffMediaLibraryCardProps {
  /** A workspace's shared library… */
  orgId?: string
  /** …or one site's own. */
  hostId?: string
}

function Thumb({ row }: { row: StaffMediaRow }) {
  const box = {
    width: THUMB,
    height: THUMB,
    borderRadius: 1,
    flexShrink: 0,
    bgcolor: 'action.hover',
  }
  if (row.thumbSrc) {
    return (
      <Box
        component="img"
        src={row.thumbSrc}
        alt=""
        loading="lazy"
        sx={{ ...box, objectFit: 'cover', display: 'block' }}
      />
    )
  }
  return (
    <Stack sx={{ ...box, alignItems: 'center', justifyContent: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, fontWeight: 600 }}>
        {staffMediaTypeLabel(row.contentType).split(' ')[0].slice(0, 4)}
      </Typography>
    </Stack>
  )
}

/**
 * A workspace's — or a site's — media library, for staff: read-only.
 *
 * Thumbnail, name, type, size and created date, newest first, one page at a
 * time on the route's query (`/api/admin/media-library`); every header
 * orders that query. A row opens the asset: preview, storage path, owner,
 * visibility and where it is used. There is no upload, replace or delete
 * here on purpose — staff change a library from the workspace itself.
 *
 * Every page read and every opened asset is recorded in the staff audit log
 * as data staff looked at, by the routes that serve them.
 */
export function StaffMediaLibraryCard({ orgId, hostId }: StaffMediaLibraryCardProps) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | null)?.uid ?? null
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState<StaffMediaRow | null>(null)
  const scopeQuery = hostId
    ? `hostId=${encodeURIComponent(hostId)}`
    : orgId
      ? `orgId=${encodeURIComponent(orgId)}`
      : ''
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(null)
  const sortParam = askedSort
    ? `&sort=${encodeURIComponent(`${askedSort.path}:${askedSort.direction}`)}`
    : ''

  const fetchPage = useCallback(
    async (cursor: string | null, _index: number, pageSize: number): Promise<StaffListPage<StaffMediaRow>> => {
      const response = await authorizedFetch(
        userRef.current,
        `/api/admin/media-library?${scopeQuery}&pageSize=${pageSize}${sortParam}` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Media library failed')
      return { rows: payload.rows ?? [], hasMore: payload.hasMore, nextCursor: payload.nextCursor }
    },
    [scopeQuery, sortParam],
  )
  const reportError = useCallback(
    (error: unknown) => {
      console.error(error)
      enqueueSnackbar('Could not read the media library', { variant: 'error' })
    },
    [enqueueSnackbar],
  )
  const pagination = useStaffListPagination<StaffMediaRow>({
    fetchPage,
    onError: reportError,
    enabled: Boolean(scopeQuery && uid),
  })
  const columnSort = useListColumnSort<StaffMediaRow>({
    sorts: STAFF_MEDIA_COLUMN_SORTS,
    defaultSort: STAFF_MEDIA_SORT,
    sort: askedSort,
    onSortChange: setAskedSort,
    rows: pagination.rows,
  })

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'thumb',
        headerName: '',
        width: THUMB + 24,
        renderCell: ({ row }: { row: StaffMediaRow }) => (
          <Stack sx={{ justifyContent: 'center', height: '100%' }}>
            <Thumb row={row} />
          </Stack>
        ),
      },
      {
        field: 'name',
        headerName: 'Name',
        flex: 1.4,
        minWidth: 200,
        renderCell: ({ row }: { row: StaffMediaRow }) => (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%', minWidth: 0 }}>
            <Link
              component="button"
              type="button"
              variant="body2"
              underline="hover"
              noWrap
              sx={{ textAlign: 'left', maxWidth: '100%' }}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(row)
              }}
            >
              {row.name}
            </Link>
            {row.private ? <Chip size="small" color="warning" label="Private" /> : null}
            {row.deleted ? <Chip size="small" color="error" variant="outlined" label="In trash" /> : null}
          </Stack>
        ),
      },
      {
        field: 'contentType',
        headerName: 'Type',
        flex: 0.7,
        minWidth: 110,
        valueGetter: (_value, row: StaffMediaRow) => staffMediaTypeLabel(row.contentType),
      },
      {
        field: 'sizeBytes',
        headerName: 'Size',
        flex: 0.5,
        minWidth: 90,
        valueGetter: (_value, row: StaffMediaRow) => staffMediaSizeLabel(row.sizeBytes),
      },
      {
        field: 'createdAt',
        headerName: 'Created',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: StaffMediaRow) =>
          row.createdAtMs ? new Date(row.createdAtMs).toLocaleString() : '—',
      },
      {
        field: 'usedBy',
        headerName: 'Used by',
        flex: 0.8,
        minWidth: 130,
        renderCell: ({ row }: { row: StaffMediaRow }) => (
          <Stack sx={{ justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" color={row.usedBy ? 'text.primary' : 'text.secondary'} noWrap>
              {row.usedBy
                ? row.usedBy.map((site) => site.name).join(', ') || 'Nowhere'
                : 'Open to scan'}
            </Typography>
          </Stack>
        ),
      },
    ],
    [],
  )

  return (
    <CardDisplay
      header={hostId ? 'Site media library' : 'Media library'}
      help={docsHelp('staffConsole', {
        anchor: '#staff-media-library',
        excerpt:
          'The files a workspace or a site stores, read-only, newest first. Opening the card or a file is recorded in the staff audit log.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {hostId
            ? 'Files stored in this site’s own library. Files shared across the workspace are on its organization page. Read-only; viewing is recorded in the staff audit log.'
            : 'Files in this workspace’s shared library. Read-only; viewing is recorded in the staff audit log.'}
        </Typography>
        <ListQueryNotices refused={NO_REFUSALS} notices={columnSort.notices} />
        <ListTable
          rows={columnSort.rows}
          columns={columns}
          loading={pagination.loading}
          columnSort={columnSort}
          noRowsLabel="No media in this library"
          hideFooter
          rowHeight={Math.max(TABLE_ROW_HEIGHT, THUMB + 12)}
          onOpen={(_id, row) => setOpen(row as StaffMediaRow)}
        />
        <StaffListPaginationControls pagination={pagination} />
        {/* Mounted only while an asset is open: it reads (and audits) on mount. */}
        {open ? (
          <StaffMediaAssetDialog scopeQuery={scopeQuery} row={open} onClose={() => setOpen(null)} />
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

export default StaffMediaLibraryCard
