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
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useFirestoreCollection, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import type { Dayjs } from 'dayjs'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  checkInItemLabel,
  checkInRainCheckIsOpen,
  checkInStatusLabel,
  checkInTimeLabel,
  describeWristband,
  POS_CHECK_IN_ROUTE,
  rainCheckLabel,
  type CheckInDayTotals,
  type CheckInRow,
} from '../../../model/commerce-check-in'
import { callPosOps } from './pos-ops-api'
import { PosRainCheckDialog } from './pos-rain-check-dialog.component'
import { escapeHtml } from '../../../utils/escape-html'
import CommerceStatTile from '../commerce-stat-tile.component'
import { EntitlementGatedCard } from '../entitlement-gate.component'
import { POS_RECEIPT_STYLES } from './pos-receipt'
import { printPosDocument } from './pos-shift-report.component'

/*==========================================
 * TODAY'S CHECK-INS (AGL-4043): who is due at the window on a day, who is
 * checked in, by whom and with which wristband, from
 * `GET /api/commerce/pos-check-in`. The day is a whole, bounded list, so
 * the grid sorts it by any column itself.
 *=========================================*/

export interface PosCheckInsCardProps {
  hostId: string
  /** The viewer may work the register: what the route's gate asks. */
  canManagePos?: boolean
}

const HEADER = "Today's check-ins"
const HELP = pluginDocsHelp('posOperations', { anchor: '#check-in-at-the-window' })
const DAY_FORMAT = 'YYYY-MM-DD'

interface DayList {
  dayKey: string
  timeZone: string
  totals: CheckInDayTotals
  checkIns: CheckInRow[]
  truncated?: boolean
}

type Answer =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; list: DayList }
  | { state: 'error'; error: string }

/** The day's list as a printable 80 mm document, like the day totals. */
export function posCheckInsDocument(list: DayList): string {
  const rows = list.checkIns
    .map(
      (row) =>
        `<div class="row"><span>${escapeHtml(`${row.customerName || row.customerEmail || 'Customer'} · ${checkInItemLabel(row)}`)}</span>` +
        `<span>${escapeHtml(
          row.status === 'checked_in'
            ? [checkInTimeLabel(row.checkedInAtMs, list.timeZone), describeWristband(row.wristband)].filter(Boolean).join(' ')
            : checkInRainCheckIsOpen(row)
              ? 'Rain check'
              : '—',
        )}</span></div>`,
    )
    .join('')
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>CHECK-INS</title><style>${POS_RECEIPT_STYLES}</style></head><body>` +
    `<div class="receipt"><div class="center"><div class="title">CHECK-INS</div>` +
    `<div class="muted">${escapeHtml(list.dayKey)} · ${list.totals.checkedIn} of ${list.totals.expected} checked in</div></div>` +
    `<hr class="rule">${rows}</div></body></html>`
  )
}

function PosCheckInsBody(props: PosCheckInsCardProps) {
  const { hostId, canManagePos = false } = props
  const { data: user } = useUser()
  const [day, setDay] = useState<Dayjs | null>(null)
  const [answer, setAnswer] = useState<Answer>({ state: 'idle' })
  const [exporting, setExporting] = useState(false)
  /** The pass a rain check is being given on (AGL-4043). */
  const [rainCheckRow, setRainCheckRow] = useState<CheckInRow | null>(null)
  const [actionError, setActionError] = useState('')

  const url = useCallback(
    (format?: 'csv') => {
      const params = new URLSearchParams({ hostId })
      if (day?.isValid()) params.set('day', day.format(DAY_FORMAT))
      if (format) params.set('format', format)
      return `${POS_CHECK_IN_ROUTE}?${params.toString()}`
    },
    [hostId, day],
  )

  const load = useCallback(async () => {
    if (!user || !canManagePos) return
    setAnswer({ state: 'loading' })
    try {
      const response = await authorizedFetch(user as never, url(), { method: 'GET' })
      const body = (await response.json().catch(() => ({}))) as Partial<DayList> & { error?: string }
      setAnswer(
        response.ok && body.checkIns
          ? { state: 'ready', list: body as DayList }
          : { state: 'error', error: body.error || 'The check-ins could not be read.' },
      )
    } catch {
      setAnswer({ state: 'error', error: 'The check-ins could not be read. Check the connection.' })
    }
  }, [user, canManagePos, url])

  useEffect(() => {
    void load()
  }, [load])

  const list = answer.state === 'ready' ? answer.list : null
  const todayKey = list ? zonedDayKey(Date.now(), list.timeZone) : ''

  const undoRainCheck = useCallback(
    async (row: CheckInRow) => {
      setActionError('')
      const done = await callPosOps<{ checkIn?: CheckInRow }>(user, 'pos-check-in', {
        hostId,
        action: 'undo_rain_check',
        id: row.id,
      })
      if (!done.ok) return setActionError(done.body.error ?? 'The rain check could not be undone.')
      await load()
    },
    [user, hostId, load],
  )

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'customerName',
        headerName: 'Name',
        flex: 1,
        minWidth: 150,
        valueGetter: (_value: unknown, row: CheckInRow) => row.customerName || row.customerEmail || '',
      },
      {
        field: 'itemName',
        headerName: 'Item',
        flex: 1,
        minWidth: 160,
        valueGetter: (_value: unknown, row: CheckInRow) => checkInItemLabel(row),
      },
      {
        field: 'orderLabel',
        headerName: 'Order',
        minWidth: 100,
        valueGetter: (_value: unknown, row: CheckInRow) => row.orderLabel ?? (row.source === 'reservation' ? 'Stay' : ''),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 120,
        valueGetter: (_value: unknown, row: CheckInRow) => checkInStatusLabel(row),
        renderCell: ({ row }: { row: CheckInRow }) =>
          row.status === 'checked_in' ? (
            <Chip size="small" color="success" label="Checked in" />
          ) : checkInRainCheckIsOpen(row) ? (
            <Chip size="small" color="info" variant="outlined" label="Rain check" />
          ) : (
            <Chip size="small" variant="outlined" label="Expected" />
          ),
      },
      {
        field: 'rainCheck',
        headerName: 'Rain check',
        minWidth: 200,
        flex: 1,
        valueGetter: (_value: unknown, row: CheckInRow) => rainCheckLabel(row),
      },
      {
        field: 'checkedInAtMs',
        headerName: 'Checked in at',
        type: 'number',
        minWidth: 120,
        valueFormatter: (value: number | null) => (list ? checkInTimeLabel(value, list.timeZone) : ''),
      },
      { field: 'checkedInByName', headerName: 'By', minWidth: 120 },
      {
        field: 'wristband',
        headerName: 'Wristband',
        minWidth: 120,
        valueGetter: (_value: unknown, row: CheckInRow) => describeWristband(row.wristband),
      },
      {
        // What a pass waiting at the window can still have done to it: a
        // rain check, or one taken back. Not a value, so nothing to sort.
        field: 'rainCheckAction',
        headerName: '',
        minWidth: 150,
        sortable: false,
        filterable: false,
        hideable: false,
        disableColumnMenu: true,
        renderCell: ({ row }: { row: CheckInRow }) =>
          row.source !== 'order' || row.status !== 'expected' ? null : row.rainCheck ? (
            <Button size="small" disabled={!canManagePos} onClick={() => void undoRainCheck(row)}>
              {'Undo rain check'}
            </Button>
          ) : (
            <Button size="small" disabled={!canManagePos || !todayKey} onClick={() => setRainCheckRow(row)}>
              {'Rain check'}
            </Button>
          ),
      },
    ],
    [list, canManagePos, todayKey, undoRainCheck],
  )
  const rows = useMemo(() => (list ? list.checkIns.map((row) => ({ ...row, $id: row.id })) : []), [list])

  const exportCsv = async () => {
    if (!user || !list) return
    setExporting(true)
    try {
      const response = await authorizedFetch(user as never, url('csv'), { method: 'GET' })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setAnswer({ state: 'error', error: body.error || 'The spreadsheet could not be made.' })
        return
      }
      const blob = new Blob([await response.text()], { type: 'text/csv;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `check-ins-${list.dayKey}.csv`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    } finally {
      setExporting(false)
    }
  }

  return (
    <CardDisplay
      header={HEADER}
      help={HELP}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => void load()} disabled={!canManagePos || answer.state === 'loading'}>
              {'Refresh'}
            </Button>
            <Button size="small" onClick={() => void exportCsv()} disabled={!list || exporting}>
              {'Export CSV'}
            </Button>
            <Button size="small" onClick={() => list && printPosDocument(posCheckInsDocument(list))} disabled={!list}>
              {'Print'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2.5}>
        {!canManagePos ? (
          <Alert severity="info">
            {'Check-ins are for members who can use the register: a site admin or editor with the "Use the point of sale" permission.'}
          </Alert>
        ) : null}
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <DatePicker
              label="Day"
              value={day}
              onChange={setDay}
              disabled={!canManagePos}
              slotProps={{ textField: { size: 'small' } }}
            />
            <Button size="small" disabled={!canManagePos || !day} onClick={() => setDay(null)}>
              {'Today'}
            </Button>
          </Stack>
        </LocalizationProvider>
        {answer.state === 'loading' ? (
          <Typography variant="body2" color="text.secondary">
            {'Reading who is due…'}
          </Typography>
        ) : null}
        {answer.state === 'error' ? <Alert severity="warning">{answer.error}</Alert> : null}
        {list ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {`${list.dayKey} · ${list.timeZone} · passes and stays that need check-in`}
            </Typography>
            {list.truncated ? (
              <Alert severity="warning">
                {'This day has more check-ins than one list reads; some are missing here.'}
              </Alert>
            ) : null}
            <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
              <CommerceStatTile label="Expected" value={String(list.totals.expected)} />
              <CommerceStatTile label="Checked in" value={String(list.totals.checkedIn)} />
              <CommerceStatTile label="Still to come" value={String(list.totals.expected - list.totals.checkedIn)} />
              {list.totals.rainChecks ? (
                <CommerceStatTile label="Rain checks" value={String(list.totals.rainChecks)} />
              ) : null}
            </Stack>
            {actionError ? <Alert severity="warning">{actionError}</Alert> : null}
            <ListTable
              aria-label="Check-ins on this day"
              rows={rows}
              columns={columns}
              noRowsLabel="Nobody is due to check in on this day"
            />
          </>
        ) : null}
      </Stack>
      <PosRainCheckDialog
        row={rainCheckRow}
        hostId={hostId}
        todayKey={todayKey}
        onClose={() => setRainCheckRow(null)}
        onDone={() => {
          setRainCheckRow(null)
          void load()
        }}
      />
    </CardDisplay>
  )
}

/**
 * Today's check-ins (AGL-4043): beside the day totals, for a store with a
 * register, on a plan with the point of sale.
 */
export function PosCheckInsCard(props: PosCheckInsCardProps) {
  const firestore = useFirestore()
  // Whether the store has a register at all, as the day totals ask it.
  const { data: registers, status } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', props.hostId, 'registers'), orderBy(documentId()), limit(1)),
    [firestore, props.hostId],
    { idField: '$id' },
  )
  if (status === 'success' && !registers?.length) return null
  return (
    <EntitlementGatedCard
      hostId={props.hostId}
      feature="pos"
      header={HEADER}
      help={HELP}
      upsell={'Checking in passes, camping and stays at the window, with wristbands, comes with the point of sale.'}
    >
      <PosCheckInsBody {...props} />
    </EntitlementGatedCard>
  )
}

PosCheckInsCard.displayName = 'PosCheckInsCard'

export default PosCheckInsCard
