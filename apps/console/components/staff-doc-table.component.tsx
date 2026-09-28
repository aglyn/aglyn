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

import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  startAfter,
} from 'firebase/firestore'
import { type ReactNode, useCallback, useMemo } from 'react'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import { type StaffListPage, useStaffListPagination } from '../hooks/use-staff-list-pagination'
import StaffListPaginationControls from './staff-list-pagination.component'

/*
 * PAGED TABLES OF A CUSTOMER'S DOCUMENTS, FOR STAFF (AGL-3379).
 *
 * The staff site and organization pages list what a site or an organization
 * holds — pages, forms, automations, campaigns — each a paged walk of one
 * collection in document-id order, the one order that drops nothing, read
 * with the client SDK (the rules admit staff on every site and organization
 * subcollection). No table here filters: a filter would be a match over the
 * page on screen, which is the thing the console's lists no longer do
 * (AGL-3321).
 */

/** A document as a row: its id, and the fields the tables read. */
export type StaffDocRow = { $id: string } & Record<string, any>

export const whenOf = (value: any): string => {
  const date =
    typeof value?.toDate === 'function'
      ? value.toDate()
      : typeof value === 'number'
        ? new Date(value)
        : null
  return date ? date.toLocaleString() : '—'
}

export const nameOf = (row: StaffDocRow): string =>
  String(row['displayName'] || row['name'] || row['templateKey'] || row.$id)

/**
 * One page of a collection's id-ordered walk, reading one past the page so
 * "is there more" is observed rather than guessed.
 */
function useCollectionWalk(
  path: readonly string[] | null,
  constraints: readonly QueryConstraint[],
  onError: (error: unknown) => void,
) {
  const firestore = useFirestore()
  const key = path?.join('/') ?? ''
  const fetchPage = useCallback(
    async (cursor: string | null, _index: number, pageSize: number): Promise<StaffListPage<StaffDocRow>> => {
      if (!path) return { rows: [], hasMore: false, nextCursor: null }
      const snapshot = await getDocs(
        query(
          collection(firestore, path[0], ...path.slice(1)),
          ...constraints,
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(pageSize + 1),
        ),
      )
      const docs = snapshot.docs.slice(0, pageSize)
      const hasMore = snapshot.docs.length > pageSize
      return {
        rows: docs.map((docSnap) => ({ $id: docSnap.id, ...docSnap.data() })),
        hasMore,
        nextCursor: hasMore ? (docs[docs.length - 1]?.id ?? null) : null,
      }
    },
    // `constraints` is built from `key` and stable inputs by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firestore, key],
  )
  return useStaffListPagination<StaffDocRow>({ fetchPage, onError, enabled: Boolean(path) })
}

/** A paged table of one collection, with its columns and row actions. */
export function StaffDocTable(props: {
  path: readonly string[] | null
  constraints?: readonly QueryConstraint[]
  columns: GridColDef[]
  /** The row's action cluster; a table with none draws no Actions column. */
  actions?: (row: StaffDocRow) => ReactNode
  onOpen?: (row: StaffDocRow) => void
  noRowsLabel: string
}) {
  const { enqueueSnackbar } = useSnackbar()
  const reportError = useCallback(
    (error: unknown) => {
      console.error(error)
      enqueueSnackbar('Could not read this list', { variant: 'error' })
    },
    [enqueueSnackbar],
  )
  const constraints = useMemo(() => props.constraints ?? [], [props.constraints])
  const pagination = useCollectionWalk(props.path, constraints, reportError)
  const { actions } = props
  const columns = useMemo(
    () => (actions ? [...props.columns, listActionsColumn(actions, { width: 110 })] : props.columns),
    [props.columns, actions],
  )
  const byId = useMemo(
    () => new Map(pagination.rows.map((row) => [row.$id, row])),
    [pagination.rows],
  )
  return (
    <Stack spacing={1}>
      <ListTable
        rows={pagination.rows}
        columns={columns}
        loading={pagination.loading}
        disableColumnSorting
        noRowsLabel={props.noRowsLabel}
        onOpen={
          props.onOpen
            ? (id) => {
                const row = byId.get(String(id))
                if (row) props.onOpen?.(row)
              }
            : undefined
        }
        hideFooter
        rowHeight={TABLE_ROW_HEIGHT}
      />
      <StaffListPaginationControls pagination={pagination} />
    </Stack>
  )
}

/** The name cell: the document's name over its id. */
export const nameColumn = (headerName: string): GridColDef => ({
  field: 'displayName',
  headerName,
  flex: 1.4,
  minWidth: 200,
  valueGetter: (_value, row: StaffDocRow) => nameOf(row),
  renderCell: ({ row }: { row: StaffDocRow }) => (
    <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
      <Typography variant="body2" noWrap sx={{ lineHeight: 1.25 }}>
        {nameOf(row)}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: 'monospace', lineHeight: 1.25 }}
        noWrap
      >
        {row.$id}
      </Typography>
    </Stack>
  ),
})

export const updatedColumn: GridColDef = {
  field: 'updatedAt',
  headerName: 'Updated',
  flex: 0.9,
  minWidth: 160,
  valueGetter: (_value, row: StaffDocRow) => whenOf(row['updatedAt']),
  renderCell: ({ row }: { row: StaffDocRow }) => (
    <Typography variant="caption" color="text.secondary">
      {whenOf(row['updatedAt'])}
    </Typography>
  ),
}

export const chipsColumn = (
  headerName: string,
  chips: (row: StaffDocRow) => Array<{ label: string; color?: 'error' | 'warning' | 'success' }>,
): GridColDef => ({
  field: 'status',
  headerName,
  flex: 1,
  minWidth: 160,
  valueGetter: (_value, row: StaffDocRow) =>
    chips(row)
      .map((chip) => chip.label)
      .join(', '),
  renderCell: ({ row }: { row: StaffDocRow }) => (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      sx={{ alignItems: 'center', height: '100%', flexWrap: 'wrap' }}
    >
      {chips(row).map((chip) => (
        <Chip
          key={chip.label}
          size="small"
          variant={chip.color ? 'filled' : 'outlined'}
          color={chip.color ?? 'default'}
          label={chip.label}
        />
      ))}
    </Stack>
  ),
})

/** The trigger and steps of an automation, read-only. */
export function AutomationDialog(props: { row: StaffDocRow | null; onClose: () => void }) {
  const { row, onClose } = props
  const steps: any[] = Array.isArray(row?.['steps']) ? row['steps'] : []
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{row ? nameOf(row) : ''}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {'Trigger'}
            </Typography>
            <Typography variant="body2">
              {row?.['trigger']?.event ?? 'Manual — runs only when called'}
            </Typography>
            {row?.['trigger']?.filter ? (
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {`when ${row['trigger'].filter}`}
              </Typography>
            ) : null}
          </Box>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {`Steps (${steps.length})`}
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 420,
              }}
            >
              {JSON.stringify(steps, null, 2)}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

