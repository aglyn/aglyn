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

import type * as Aglyn from '@aglyn/aglyn'
import {
  mediaPosterThumbnailSrc,
  mediaThumbnailSrc,
} from '@aglyn/aglyn/app-utils/media-src'
import {
  listActionsColumn,
  ListRowActions,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { GridColDef, GridSortModel } from '@mui/x-data-grid'
import type { ReactNode } from 'react'
import { mediaFileTypeIcon } from '../../utils/media-file-icon'
import { MEDIA_SORT_ORDER, type MediaSort } from '@aglyn/aglyn/app-utils/media-filter'

/**
 * The List view of the media library (AGL-3327): the same files the
 * thumbnail grid draws, as the console's shared `ListTable`.
 *
 * Both views read ONE filter model, one set of chips, one sort and one
 * selection, all held by the library. This module only says how a file
 * reads as a row — and, because the Grid view's toolbar is the same grid
 * with its body collapsed, the columns it builds are also what that
 * toolbar's Filters panel lists and what its Export writes.
 *
 * "Used on" is not a column. Where a file is used is not stored anywhere:
 * the Details drawer finds it by scanning every page, layout, component and
 * email on demand, which is a request per file rather than a field per row.
 */

/** A file's actions, as the card's overflow menu offers them. */
export interface MediaRowHandlers {
  onCopyUrl?: () => void
  onCopySignedLink?: () => void
  onSetPrivate?: (makePrivate: boolean) => void
  onDownload?: () => void
  onReplace?: () => void
  onDetails?: () => void
  onDelete?: () => void
}

/**
 * The card's menu, item for item and under the same conditions
 * (`MediaAssetCard`): a private file offers its temporary link instead of a
 * URL it does not have.
 */
export function mediaRowMenuItems(
  media: Aglyn.AglynHostMedia,
  handlers: MediaRowHandlers,
): RowActionsMenuItem[] {
  const items: RowActionsMenuItem[] = []
  if (handlers.onCopyUrl && !media.private) {
    items.push({ key: 'copy-url', label: 'Copy URL', onClick: handlers.onCopyUrl })
  }
  if (handlers.onCopySignedLink && media.private) {
    items.push({
      key: 'copy-signed-link',
      label: 'Copy temporary link',
      onClick: handlers.onCopySignedLink,
    })
  }
  if (handlers.onSetPrivate) {
    const setPrivate = handlers.onSetPrivate
    items.push({
      key: 'private',
      label: media.private ? 'Publish file' : 'Make private',
      onClick: () => setPrivate(!media.private),
    })
  }
  if (handlers.onDownload) {
    items.push({ key: 'download', label: 'Download file', onClick: handlers.onDownload })
  }
  if (handlers.onReplace) {
    items.push({ key: 'replace', label: 'Replace file', onClick: handlers.onReplace })
  }
  if (handlers.onDetails) {
    items.push({ key: 'details', label: 'Details', onClick: handlers.onDetails })
  }
  if (handlers.onDelete) {
    items.push({
      key: 'delete',
      label: 'Delete',
      destructive: true,
      onClick: handlers.onDelete,
    })
  }
  return items
}

/** The grid's sort for the library's, and back. */
export function mediaSortModel(sort: MediaSort): GridSortModel {
  const order = MEDIA_SORT_ORDER[sort]
  return [{ field: order.column ?? 'uploaded', sort: order.direction }]
}

export function mediaSortFromModel(
  model: GridSortModel,
  current: MediaSort,
): MediaSort {
  const [first] = model
  if (!first?.sort) return current
  if (first.field === 'fileName') return 'name'
  if (first.field === 'size') return 'size'
  if (first.field === 'uploaded') return first.sort === 'asc' ? 'oldest' : 'newest'
  return current
}

const seconds = (value: unknown): number | null => {
  const stored = value as { seconds?: unknown; toMillis?: () => number } | null
  if (typeof stored?.seconds === 'number') return stored.seconds
  if (typeof stored?.toMillis === 'function') return stored.toMillis() / 1000
  return null
}

/** `m:ss`, the way a video player writes a length. */
const duration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** `1200 × 800`, and a video's length after it; empty when nothing was measured. */
export function mediaDimensionsLabel(media: Aglyn.AglynHostMedia): string {
  const video = media.video
  const width = media.width ?? video?.width
  const height = media.height ?? video?.height
  const size = width && height ? `${width} × ${height}` : ''
  const length = video?.durationMs ? duration(video.durationMs) : ''
  return [size, length].filter(Boolean).join(' · ')
}

/** The row's thumbnail: the image's small variant, a video's poster, or its glyph. */
function MediaRowThumb(props: { media: Aglyn.AglynHostMedia }) {
  const { media } = props
  const contentType = String(media.contentType ?? '')
  const src = contentType.startsWith('image/')
    ? mediaThumbnailSrc(media, 320)
    : contentType.startsWith('video/')
      ? mediaPosterThumbnailSrc(media, 320)
      : undefined
  const { Icon, label } = mediaFileTypeIcon(contentType)
  return (
    <Box
      sx={{
        width: 40,
        height: 40,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'action.hover',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.secondary',
        flexShrink: 0,
      }}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          alt={media.alt || media.fileName || ''}
          loading="lazy"
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Icon fontSize="small" titleAccess={label} />
      )}
    </Box>
  )
}

export interface MediaListColumnsOptions {
  formatBytes: (bytes: number) => string
  /** `Blog / Covers`, or the legacy folder name, or empty. */
  folderLabel: (media: Aglyn.AglynHostMedia) => string
  /** A person's name for an `uploadedBy` value. */
  uploaderLabel: (uploadedBy: string | undefined) => string
  /** Wraps a row's name so it can be dragged onto a folder; absent in a picker. */
  draggable?: (media: Aglyn.AglynHostMedia, children: ReactNode) => ReactNode
  /** Staff-disabled notice for a file (AGL-1612), when it has one. */
  quarantine?: (media: Aglyn.AglynHostMedia) => { body: string; contact: string | null } | null
  /** The row's actions; absent in a picker, where a row click chooses. */
  actions?: (media: Aglyn.AglynHostMedia) => MediaRowHandlers
}

/**
 * The List view's columns.
 *
 * Sortable where the library's query can order: Name A to Z, Size largest
 * first, Uploaded either way. Each offers only those directions
 * (`sortingOrder`), because a direction the index set does not hold would be
 * a query that fails in production.
 */
export function mediaListColumns(options: MediaListColumnsOptions): GridColDef[] {
  const { formatBytes, folderLabel, uploaderLabel, draggable, quarantine, actions } =
    options
  const columns: GridColDef[] = [
    {
      field: 'thumb',
      headerName: 'Preview',
      width: 56,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      disableExport: true,
      renderHeader: () => null,
      renderCell: ({ row }) => <MediaRowThumb media={row} />,
    },
    {
      field: 'fileName',
      headerName: 'Name',
      flex: 1.4,
      minWidth: 160,
      sortingOrder: ['asc'],
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => row.fileName ?? row.$id,
      renderCell: ({ row, value }) => {
        const notice = quarantine?.(row) ?? null
        const content = (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
              {String(value ?? '')}
            </Typography>
            {row.private ? (
              <Tooltip title="Private — needs a signed link, and cannot be placed on a page">
                <Chip
                  size="small"
                  color="warning"
                  icon={<VisibilityOffOutlinedIcon />}
                  label="Private"
                />
              </Tooltip>
            ) : null}
            {notice ? (
              <Tooltip title={notice.contact ? `${notice.body} (${notice.contact})` : notice.body}>
                <Chip size="small" color="error" icon={<BlockOutlinedIcon />} label="Disabled" />
              </Tooltip>
            ) : null}
          </Stack>
        )
        return draggable ? draggable(row, content) : content
      },
    },
    {
      // The Filters panel reads this column as the Type select over families
      // (`listFilterGridColumns`); the cell and the export keep the file's
      // own format, which says more than its family.
      field: 'type',
      headerName: 'Type',
      width: 96,
      sortable: false,
      valueGetter: (_value, row: Aglyn.AglynHostMedia) =>
        mediaFileTypeIcon(row.contentType).label,
      valueFormatter: (value) => String(value ?? ''),
    },
    {
      field: 'size',
      headerName: 'Size',
      width: 90,
      sortingOrder: ['desc'],
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => Number(row.sizeBytes ?? 0),
      valueFormatter: (value) => formatBytes(Number(value ?? 0)),
    },
    {
      field: 'dimensions',
      headerName: 'Dimensions',
      width: 120,
      sortable: false,
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => mediaDimensionsLabel(row),
    },
    {
      field: 'tags',
      headerName: 'Tags',
      flex: 1,
      minWidth: 120,
      sortable: false,
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => (row.tags ?? []).join(', '),
      renderCell: ({ row }) => {
        const tags = (row as Aglyn.AglynHostMedia).tags ?? []
        const shown = tags.slice(0, 3)
        return (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            {shown.map((tag) => (
              <Chip key={tag} size="small" label={tag} />
            ))}
            {tags.length > shown.length ? (
              <Tooltip title={tags.slice(shown.length).join(', ')}>
                <Typography variant="caption" color="text.secondary">
                  {`+${tags.length - shown.length}`}
                </Typography>
              </Tooltip>
            ) : null}
          </Stack>
        )
      },
    },
    {
      field: 'folder',
      headerName: 'Folder',
      flex: 0.8,
      minWidth: 110,
      sortable: false,
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => folderLabel(row),
    },
    {
      field: 'uploaded',
      headerName: 'Uploaded',
      type: 'date',
      width: 124,
      sortingOrder: ['desc', 'asc'],
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => {
        const at = seconds(row.createdAt)
        return at === null ? null : new Date(at * 1000)
      },
    },
    {
      // A select in the Filters panel, over the uploaders the library has
      // seen; the cell and the export name the person, as the chip does.
      field: 'uploadedBy',
      headerName: 'Uploaded by',
      flex: 0.8,
      minWidth: 120,
      sortable: false,
      valueGetter: (_value, row: Aglyn.AglynHostMedia) => uploaderLabel(row.uploadedBy),
      valueFormatter: (value) => String(value ?? ''),
    },
  ]
  if (actions) {
    columns.push(
      listActionsColumn((row: Aglyn.AglynHostMedia) => (
        <ListRowActions
          label={row.fileName ?? String(row.$id)}
          items={mediaRowMenuItems(row, actions(row))}
        />
      )),
    )
  }
  return columns
}
