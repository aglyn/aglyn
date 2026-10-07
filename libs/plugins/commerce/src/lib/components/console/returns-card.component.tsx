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

import * as CommerceModel from '../../model'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useFirestore, usePagedCollection } from '@aglyn/tenant-feature-instance'
import ReturnDetailDialog from './return-detail-dialog.component'

export interface ReturnsCardProps {
  hostId: string
}

/** The query key the Returns list opens one return's dialog by. */
export const RETURNS_RETURN_PARAM = 'return'

type ReturnFilter = CommerceModel.ReturnStatus | 'all'

/**
 * What is coming back, as the row's summary: "2× Mug, 1× Tee" from the names
 * a return keeps, or "3 items" for one opened before it kept them.
 */
export function itemsSummary(entry: Pick<CommerceModel.HostReturn, 'lines'>): string {
  const lines = entry.lines ?? []
  if (lines.length > 0 && lines.every((line) => line.name)) {
    return lines.map((line) => `${Math.max(0, Number(line.quantity) || 0)}× ${line.name}`).join(', ')
  }
  const units = lines.reduce(
    (sum, line) => sum + Math.max(0, Number(line.quantity) || 0),
    0,
  )
  return `${units} ${units === 1 ? 'item' : 'items'}`
}

/**
 * Returns (RMA, AGL-3611): every return on the store, newest first.
 *
 * THE STATUS FILTER IS THE QUERY. `status == X` ordered by `createdAtMs`
 * descending, served by the `returns(status ASC, createdAtMs DESC)`
 * composite; "All" is the single-field order alone. The footer pages that
 * query's answer, so page two of "Requested" is page two of the requests,
 * never a page of the store narrowed afterwards.
 *
 * `?return={id}` opens that return's dialog on arrival — the address the
 * merchant's "return requested" notification links to. The dialog reads the
 * return by id, so one that is not on this page opens just the same.
 */
export function ReturnsCard(props: ReturnsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const [filter, setFilter] = useState<ReturnFilter>('all')
  const {
    rows: returns,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    status,
  } = usePagedCollection<CommerceModel.HostReturn & { $id: string }>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'returns'),
        ...(filter === 'all' ? [] : [where('status', '==', filter)]),
        orderBy('createdAtMs', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId, filter],
    { idField: '$id' },
  )

  const searchParams = useSearchParams()
  const seededId = searchParams?.get(RETURNS_RETURN_PARAM) ?? null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Once per id, so closing the dialog does not reopen it on the next render.
  const seeded = useRef<string | null>(null)
  useEffect(() => {
    if (!seededId || seeded.current === seededId) return
    seeded.current = seededId
    setSelectedId(seededId)
  }, [seededId])

  return (
    <CardDisplay
      header={'Returns'}
      help={pluginDocsHelp('ordersAndReturns', { anchor: '#run-a-return' })}
      HeaderProps={{
        action: (
          <TextField
            label="Status"
            value={filter}
            onChange={(event) => setFilter(event.target.value as ReturnFilter)}
            size="small"
            select
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="all">{'All'}</MenuItem>
            {CommerceModel.RETURN_STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {CommerceModel.RETURN_STATUS_LABELS[value]}
              </MenuItem>
            ))}
          </TextField>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {returns.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {status === 'loading'
              ? 'Loading returns…'
              : filter === 'all'
                ? 'No returns yet. When a buyer asks to send something back, or you start a return from an order, it appears here.'
                : `No ${CommerceModel.RETURN_STATUS_LABELS[filter].toLowerCase()} returns.`}
          </Typography>
        ) : (
          <List disablePadding>
            {returns.map((entry) => (
              <ListItemButton
                key={entry.$id}
                onClick={() => setSelectedId(entry.$id)}
                divider
              >
                <ListItemText
                  primary={`${entry.orderNumber} · ${
                    entry.customerName || entry.customerEmail || 'Guest buyer'
                  }`}
                  secondary={`${itemsSummary(entry)} · Requested ${new Date(
                    entry.createdAtMs,
                  ).toLocaleDateString()}`}
                />
                <Chip
                  label={CommerceModel.RETURN_STATUS_LABELS[entry.status] ?? entry.status}
                  size="small"
                  color={CommerceModel.RETURN_STATUS_COLOR[entry.status] ?? 'default'}
                  variant="outlined"
                />
              </ListItemButton>
            ))}
          </List>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={returns.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Stack>
      {selectedId ? (
        <ReturnDetailDialog
          hostId={hostId}
          returnId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </CardDisplay>
  )
}
ReturnsCard.displayName = 'ReturnsCard'

export default ReturnsCard
