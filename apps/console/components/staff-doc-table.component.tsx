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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { ListQueryNotices } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import type { ListPageSort } from '@aglyn/shared-util-tools/list-query/list-column-sort'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  type DocumentData,
  getDocs,
  limit,
  query,
  type QueryDocumentSnapshot,
  startAfter,
} from 'firebase/firestore'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import { type StaffListPage, useStaffListPagination } from '../hooks/use-staff-list-pagination'
import StaffListPaginationControls from './staff-list-pagination.component'

/*
 * PAGED TABLES OF A CUSTOMER'S DOCUMENTS, FOR STAFF (AGL-3379).
 *
 * The staff site and organization pages list what a site or an organization
 * holds — pages, layouts, forms — each a paged walk of one
 * collection in document-id order, the one order that drops nothing, read
 * with the client SDK (the rules admit staff on every site and organization
 * subcollection). No table here filters: a filter would be a match over the
 * page on screen, which is the thing the console's lists no longer do
 * (AGL-3321).
 *
 * Every header sorts (AGL-3680): a stored field on the QUERY, by the tab's
 * declaration (`staff-site-content-list-query.ts` says which and why), and a
 * derived one — a Status chip — over the page, saying so.
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

/** A tab with no declaration of its own: the id walk, no header orders. */
const ID_WALK: ListQueryDeclaration = {
  fields: [],
  sorts: [{ path: LIST_QUERY_ID_PATH, direction: 'asc' }],
}

/**
 * One page of a collection's walk in the planned order, reading one past the
 * page so "is there more" is observed rather than guessed. A page starts
 * after the previous page's last DOCUMENT — its snapshot, so the cursor
 * carries the sort field's value and the id that breaks its ties.
 */
function useCollectionWalk(
  path: readonly string[] | null,
  declaration: ListQueryDeclaration,
  base: readonly ListQueryFilter[],
  sort: ListQuerySort | null,
  onError: (error: unknown) => void,
) {
  const firestore = useFirestore()
  const key = path?.join('/') ?? ''
  const plan = useMemo(
    () => planListQuery(declaration, { clauses: [], sort, base }, nameSearchNormalizers),
    [declaration, sort, base],
  )
  const planKey = JSON.stringify({ filters: plan.filters, orderBy: plan.orderBy })
  // The last document of each page read, by id: the next page's cursor.
  const cursors = useRef(new Map<string, QueryDocumentSnapshot<DocumentData>>())
  const fetchPage = useCallback(
    async (cursor: string | null, _index: number, pageSize: number): Promise<StaffListPage<StaffDocRow>> => {
      if (!path) return { rows: [], hasMore: false, nextCursor: null }
      const after = cursor ? cursors.current.get(cursor) : undefined
      const snapshot = await getDocs(
        query(
          collection(firestore, path[0], ...path.slice(1)),
          ...listQueryConstraints(plan),
          ...(after ? [startAfter(after)] : []),
          limit(pageSize + 1),
        ),
      )
      const docs = snapshot.docs.slice(0, pageSize)
      const hasMore = snapshot.docs.length > pageSize
      const last = docs[docs.length - 1]
      if (last) cursors.current.set(last.id, last)
      return {
        rows: docs.map((docSnap) => ({ $id: docSnap.id, ...docSnap.data() })),
        hasMore,
        nextCursor: hasMore ? (last?.id ?? null) : null,
      }
    },
    // A new path or plan is a new walk; `plan` is identified by `planKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firestore, key, planKey],
  )
  const pagination = useStaffListPagination<StaffDocRow>({
    fetchPage,
    onError,
    enabled: Boolean(path),
  })
  return { pagination, plan }
}

const NO_BASE: readonly ListQueryFilter[] = []

/** A paged table of one collection, with its columns and row actions. */
export function StaffDocTable(props: {
  path: readonly string[] | null
  /**
   * What the tab's query may order by: its default first, then one
   * `ListQuerySort` per header and direction (AGL-3680). Absent, the id walk.
   */
  declaration?: ListQueryDeclaration
  /** The tab's scope, on every query — e.g. email designs' `kind == email`. */
  base?: readonly ListQueryFilter[]
  /** Derived columns, sorted over the page: field → value. */
  pageSorts?: Readonly<Record<string, ListPageSort<StaffDocRow>>>
  /** Headers, for the page-sort notice: field → label. */
  headers?: Readonly<Record<string, string>>
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
  const declaration = props.declaration ?? ID_WALK
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(null)
  const { pagination, plan } = useCollectionWalk(
    props.path,
    declaration,
    props.base ?? NO_BASE,
    askedSort,
    reportError,
  )
  const columnSort = useListColumnSort<StaffDocRow>({
    sorts: declaration.sorts,
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: plan.orderBy,
    rows: pagination.rows,
    pageSorts: props.pageSorts,
    headers: props.headers,
  })
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
      <ListQueryNotices refused={[]} notices={[...plan.notices, ...columnSort.notices]} />
      <ListTable
        rows={columnSort.rows}
        columnSort={columnSort}
        columns={columns}
        loading={pagination.loading}
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
