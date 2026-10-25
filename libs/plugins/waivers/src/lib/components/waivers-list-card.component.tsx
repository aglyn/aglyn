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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { ListTable, listActionsColumn } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { Alert, Button, Chip, Stack } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import { WAIVER_STATUS_LABELS, validityLabel, type WaiverTemplate } from '../model/waiver'
import { ShareWaiverDialog } from './share-waiver-dialog.component'

export interface WaiversListCardProps {
  hostId: string
  waivers: WaiverTemplate[] | null
  error: string | null
  canManage: boolean
  canCollect: boolean
  onOpen: (waiverId: string | 'new') => void
  onSignAtWindow: (waiverId: string) => void
}

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * The site's waivers (AGL-4042): every one it wrote, sortable by any column
 * (the list is whole and bounded), with what each row can do: edit it, share
 * its link and QR, or hand a tablet over to sign it at the window.
 */
export function WaiversListCard(props: WaiversListCardProps) {
  const { waivers, canManage, canCollect } = props
  const [sharing, setSharing] = useState<WaiverTemplate | null>(null)
  const rows = useMemo(() => (waivers ?? []).map((waiver) => ({ ...waiver, $id: waiver.id })), [waivers])
  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'title', headerName: 'Waiver', flex: 1, minWidth: 200 },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 120,
        renderCell: ({ row }: { row: WaiverTemplate }) => (
          <Chip
            size="small"
            variant={row.status === 'published' ? 'filled' : 'outlined'}
            color={row.status === 'published' ? 'success' : 'default'}
            label={WAIVER_STATUS_LABELS[row.status]}
          />
        ),
      },
      { field: 'version', headerName: 'Version', type: 'number', minWidth: 90 },
      {
        field: 'validity',
        headerName: 'Good for',
        minWidth: 200,
        flex: 1,
        valueGetter: (_value: unknown, row: WaiverTemplate) => validityLabel(row.validity),
      },
      {
        field: 'updatedAtMs',
        headerName: 'Last changed',
        minWidth: 170,
        type: 'number',
        valueFormatter: (value: number) => (value ? when(value) : ''),
      },
      listActionsColumn(
        (row: WaiverTemplate) => (
          <Stack direction="row" spacing={0.5}>
            <Button size="small" onClick={() => setSharing(row)}>
              {'Share'}
            </Button>
            <BlockedControl
              blocked={row.status !== 'published' || !canCollect}
              reason={!canCollect ? 'Taking signatures needs the Collect waivers permission.' : 'Publish this waiver to take signatures.'}
            >
              <Button size="small" onClick={() => props.onSignAtWindow(row.id)}>
                {'Sign at window'}
              </Button>
            </BlockedControl>
          </Stack>
        ),
        { width: 220 },
      ),
    ],
    [canCollect, props],
  )
  return (
    <CardDisplay
      header="Waivers"
      help={pluginDocsHelp('waivers', { anchor: '#share-it-before-riders-arrive' })}
      HeaderProps={{
        action: (
          <BlockedControl blocked={!canManage} reason="Writing waivers needs the Manage waivers permission.">
            <Button size="small" variant="contained" onClick={() => props.onOpen('new')}>
              {'New waiver'}
            </Button>
          </BlockedControl>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {props.error ? <Alert severity="error">{props.error}</Alert> : null}
        <ListTable
          aria-label="Waivers"
          rows={rows}
          columns={columns}
          loading={waivers === null && !props.error}
          onOpen={(id) => props.onOpen(id)}
          noRowsLabel="No waivers yet"
          noRowsDescription="Write your waiver once, publish it, and riders can sign it before they arrive or at the window."
        />
      </Stack>
      <ShareWaiverDialog hostId={props.hostId} waiver={sharing} onClose={() => setSharing(null)} />
    </CardDisplay>
  )
}

export default WaiversListCard
