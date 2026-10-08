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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListQueryNotices } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import type { GridColDef } from '@mui/x-data-grid'
import { useEffect, useMemo, useState } from 'react'
import {
  POS_SHIFT_COLUMN_SORTS,
  POS_SHIFT_LIST_QUERY,
} from '../../../constants/pos-shift-list-query'
import { posMoney, posShiftsCsv, type PosShift } from '../../../model/commerce-pos-ops'
import { PosShiftReportView } from './pos-shift-report.component'

export interface PosShiftHistoryCardProps {
  hostId: string
}

type ShiftRow = PosShift & { $id: string }

/**
 * "By" is whichever name the shift carries, so it sorts the page on screen
 * (AGL-3680); every other column is the query's order (`POS_SHIFT_COLUMN_SORTS`).
 */
const SHIFT_PAGE_SORTS = {
  by: (row: ShiftRow) => row.closedByName ?? row.openedByName ?? '',
}
const SHIFT_PAGE_SORT_HEADERS = { by: 'By' }

/** A shift's time as the history lists it, in the viewer's locale. */
const when = (ms?: number | null) =>
  ms
    ? new Date(ms).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

/**
 * Shift history (AGL-3609): one register's shifts, newest first, from an
 * ordered Firestore query — open ones included — with each closed shift's Z
 * report a click away and the shifts on the page exportable as a spreadsheet.
 */
export function PosShiftHistoryCard(props: PosShiftHistoryCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: registerDocs, status: registersStatus } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'registers'), limit(25)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const registers = useMemo(
    () =>
      [...(registerDocs ?? [])].sort((a: any, b: any) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')),
      ),
    [registerDocs],
  )
  const [registerId, setRegisterId] = useState('')
  useEffect(() => {
    if (!registerId && registers.length) setRegisterId(registers[0].$id)
  }, [registerId, registers])
  /*
   * Every header sorts (AGL-3680): the asked order is the query's, over every
   * shift the register has, newest first until a header is clicked.
   */
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(POS_SHIFT_COLUMN_SORTS[0])
  const shiftsRef = useMemo(
    () =>
      registerId
        ? collection(firestore, 'hosts', hostId, 'registers', registerId, 'shifts')
        : null,
    [firestore, hostId, registerId],
  )
  const {
    rows: shifts,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    status,
    plan,
  } = useListQuery<ShiftRow>({
    collection: shiftsRef,
    declaration: POS_SHIFT_LIST_QUERY,
    request: { clauses: [], sort: askedSort },
    deps: [firestore, hostId, registerId],
    idField: '$id',
  })
  const columnSort = useListColumnSort<ShiftRow>({
    sorts: POS_SHIFT_COLUMN_SORTS,
    defaultSort: POS_SHIFT_COLUMN_SORTS[0],
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: plan.orderBy,
    rows: shifts,
    pageSorts: SHIFT_PAGE_SORTS,
    headers: SHIFT_PAGE_SORT_HEADERS,
  })
  const [selected, setSelected] = useState<ShiftRow | null>(null)
  const registerName = registers.find((register: any) => register.$id === registerId)?.name ?? ''

  const columns = useMemo(
    () =>
      [
        {
          field: 'openedAtMs',
          headerName: 'Opened',
          flex: 1,
          minWidth: 150,
          valueFormatter: (value: number) => when(value),
        },
        {
          field: 'closedAtMs',
          headerName: 'Closed',
          flex: 1,
          minWidth: 150,
          renderCell: ({ row }: { row: ShiftRow }) =>
            row.status === 'open' ? <Chip size="small" color="success" label="Open" /> : when(row.closedAtMs),
        },
        {
          field: 'by',
          headerName: 'By',
          minWidth: 140,
          valueGetter: (_value: unknown, row: ShiftRow) => row.closedByName ?? row.openedByName ?? '',
        },
        {
          field: 'netSales',
          headerName: 'Net sales',
          type: 'number',
          minWidth: 110,
          valueGetter: (_value: unknown, row: ShiftRow) =>
            row.report ? posMoney(row.netSalesCents ?? row.report.netSalesCents) : '—',
        },
        {
          field: 'expectedCashCents',
          headerName: 'Expected',
          type: 'number',
          minWidth: 110,
          valueFormatter: (value: number | null | undefined) => (value != null ? posMoney(value) : '—'),
        },
        {
          field: 'countedCashCents',
          headerName: 'Counted',
          type: 'number',
          minWidth: 110,
          valueFormatter: (value: number | null | undefined) => (value != null ? posMoney(value) : '—'),
        },
        {
          field: 'varianceCents',
          headerName: 'Variance',
          minWidth: 110,
          align: 'right',
          headerAlign: 'right',
          renderCell: ({ row }: { row: ShiftRow }) =>
            row.varianceCents != null ? (
              <Chip
                size="small"
                variant="outlined"
                color={row.varianceCents === 0 ? 'success' : 'warning'}
                label={posMoney(row.varianceCents)}
              />
            ) : (
              '—'
            ),
        },
      ] as GridColDef[],
    [],
  )

  const exportCsv = () => {
    const csv = posShiftsCsv(
      shifts.map((shift) => ({ ...shift, id: shift.$id, registerName })),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shifts-${registerName.replace(/[^A-Za-z0-9_-]+/g, '-') || registerId}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // A store without a register has no shifts to show.
  if (registersStatus === 'success' && !registers.length) return null

  return (
    <CardDisplay
      header={'Shift history'}
      help={pluginDocsHelp('posOperations', { anchor: '#shifts-and-the-cash-drawer' })}
      HeaderProps={{
        action: (
          <Button size="small" onClick={exportCsv} disabled={!shifts.length}>
            {'Export CSV'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {registers.length > 1 ? (
          <TextField
            select
            size="small"
            label="Register"
            value={registerId}
            onChange={(event) => setRegisterId(event.target.value)}
            sx={{ maxWidth: 280 }}
          >
            {registers.map((register: any) => (
              <MenuItem key={register.$id} value={register.$id}>
                {register.name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {/* Empty only in the default order: a header that came back empty keeps the grid to click another. */}
        {status === 'success' && !shifts.length && askedSort === POS_SHIFT_COLUMN_SORTS[0] ? (
          <Typography variant="body2" color="text.secondary">
            {'No shifts yet. Open one from the register before the first sale of the day.'}
          </Typography>
        ) : (
          <>
            <ListQueryNotices refused={[]} notices={[...plan.notices, ...columnSort.notices]} />
            <ListTable
              aria-label="Shift history"
              rows={columnSort.rows}
              columns={columns}
              // The query orders and pages the shifts, or the page does for "By".
              columnSort={columnSort}
              hideFooter
              noRowsLabel="No shifts yet"
              onOpen={(_id, row) => (row as ShiftRow).report && setSelected(row as ShiftRow)}
            />
          </>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={shifts.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Stack>
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{`Z report · ${when(selected?.closedAtMs)}`}</DialogTitle>
        <DialogContent>
          {selected?.report ? <PosShiftReportView report={selected.report} shift={selected} /> : null}
          {selected?.closingNote ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {selected.closingNote}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>{'Done'}</Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

PosShiftHistoryCard.displayName = 'PosShiftHistoryCard'

export default PosShiftHistoryCard
