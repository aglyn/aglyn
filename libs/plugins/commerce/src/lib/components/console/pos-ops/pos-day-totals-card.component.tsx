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
import { Alert, Button, Chip, Divider, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import type { Dayjs } from 'dayjs'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  posDayRangeLabel,
  posDayReportIsEmpty,
  posDayReportSections,
  POS_DAY_REPORT_MAX_DAYS,
  POS_DAY_REPORT_ROUTE,
  type PosDayReport,
} from '../../../model/commerce-pos-day-report'
import { formatReceiptMoney } from '../../../model/commerce-receipt'
import { escapeHtml } from '../../../utils/escape-html'
import CommerceStatTile from '../commerce-stat-tile.component'
import { EntitlementGatedCard } from '../entitlement-gate.component'
import { POS_RECEIPT_STYLES } from './pos-receipt'
import { printPosDocument } from './pos-shift-report.component'

/*==========================================
 * DAY TOTALS (AGL-4037): one day's or one event's sales across every
 * register, shift and cashier, from `GET /api/commerce/pos-day-report`.
 *
 * The figures are the server's: the card formats them and never sums them.
 * Every table holds a whole, bounded answer (seven tenders at most, the
 * site's registers, its staff, the range's shifts), so the grid sorts each
 * by any column itself.
 *=========================================*/

export interface PosDayTotalsCardProps {
  hostId: string
  /** The viewer may work the register: what the route's gate asks. */
  canManagePos?: boolean
}

const HEADER = 'Day totals'
const HELP = pluginDocsHelp('posOperations', { anchor: '#day-and-event-totals' })
const DAY_FORMAT = 'YYYY-MM-DD'

type Answer =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; report: PosDayReport }
  | { state: 'error'; error: string }

/** A time as the shifts table lists it, in the viewer's locale. */
const when = (ms?: number | null) =>
  ms
    ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''

/** The day totals as a printable 80 mm document, like the Z report. */
export function posDayReportDocument(input: { report: PosDayReport }): string {
  const money = (cents: number) => formatReceiptMoney(cents, input.report.currency)
  const body = posDayReportSections(input.report, money)
    .map(
      (section) =>
        `<hr class="rule"><div class="title">${escapeHtml(section.section.toUpperCase())}</div>` +
        section.rows
          .map(
            (row) =>
              `<div class="row${row.strong ? ' total' : ''}"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(row.value)}</span></div>`,
          )
          .join(''),
    )
    .join('')
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>DAY TOTALS</title><style>${POS_RECEIPT_STYLES}</style></head><body>` +
    `<div class="receipt"><div class="center"><div class="store">${escapeHtml(input.report.storeName || 'Register')}</div>` +
    `<div class="title">DAY TOTALS</div><div class="muted">${escapeHtml(posDayRangeLabel(input.report))}</div></div>` +
    `${body}</div></body></html>`
  )
}

function DrawerRows(props: { report: PosDayReport; money: (cents: number) => string }) {
  const drawers = posDayReportSections(props.report, props.money).find((section) => section.section === 'Cash drawers')
  return (
    <Stack spacing={0.5}>
      {drawers?.rows.map((row) => (
        <Stack key={row.label} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="body2" color={row.strong ? 'text.primary' : 'text.secondary'}>
            {row.label}
          </Typography>
          <Typography variant={row.strong ? 'subtitle2' : 'body2'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {row.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1}>
      <Typography variant="overline">{props.title}</Typography>
      {props.children}
    </Stack>
  )
}

function PosDayTotalsBody(props: PosDayTotalsCardProps) {
  const { hostId, canManagePos = false } = props
  const { data: user } = useUser()
  const [from, setFrom] = useState<Dayjs | null>(null)
  const [to, setTo] = useState<Dayjs | null>(null)
  const [answer, setAnswer] = useState<Answer>({ state: 'idle' })
  const [exporting, setExporting] = useState(false)

  const url = useCallback(
    (format?: 'csv') => {
      const params = new URLSearchParams({ hostId })
      if (from?.isValid()) params.set('from', from.format(DAY_FORMAT))
      if (to?.isValid()) params.set('to', to.format(DAY_FORMAT))
      if (format) params.set('format', format)
      return `${POS_DAY_REPORT_ROUTE}?${params.toString()}`
    },
    [hostId, from, to],
  )

  useEffect(() => {
    if (!user || !canManagePos) return
    let live = true
    setAnswer({ state: 'loading' })
    void (async () => {
      try {
        const response = await authorizedFetch(user as never, url(), { method: 'GET' })
        const body = (await response.json().catch(() => ({}))) as { report?: PosDayReport; error?: string }
        if (!live) return
        setAnswer(
          response.ok && body.report
            ? { state: 'ready', report: body.report }
            : { state: 'error', error: body.error || 'The day totals could not be read.' },
        )
      } catch {
        if (live) setAnswer({ state: 'error', error: 'The day totals could not be read. Check the connection.' })
      }
    })()
    return () => {
      live = false
    }
  }, [user, canManagePos, url])

  const report = answer.state === 'ready' ? answer.report : null
  const money = useCallback((cents: number) => formatReceiptMoney(cents, report?.currency ?? 'usd'), [report?.currency])
  const moneyColumn = useCallback(
    (field: string, headerName: string, minWidth = 110): GridColDef => ({
      field,
      headerName,
      type: 'number',
      minWidth,
      flex: 1,
      valueFormatter: (value: number | null | undefined) => (value == null ? '—' : money(value)),
    }),
    [money],
  )

  const tenderColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'label', headerName: 'Tender', flex: 1, minWidth: 140 },
      moneyColumn('salesCents', 'Sales'),
      moneyColumn('refundsCents', 'Refunds'),
      moneyColumn('netCents', 'Net'),
    ],
    [moneyColumn],
  )
  const salesColumns = useCallback(
    (nameHeader: string): GridColDef[] => [
      { field: 'name', headerName: nameHeader, flex: 1, minWidth: 140 },
      { field: 'orderCount', headerName: 'Orders', type: 'number', minWidth: 90 },
      moneyColumn('grossSalesCents', 'Gross sales'),
      moneyColumn('tipsCents', 'Tips', 90),
      moneyColumn('refundsCents', 'Refunds'),
      moneyColumn('netSalesCents', 'Net sales'),
    ],
    [moneyColumn],
  )
  const registerColumns = useMemo(() => salesColumns('Register'), [salesColumns])
  const cashierColumns = useMemo(() => salesColumns('Cashier'), [salesColumns])
  const shiftColumns = useMemo<GridColDef[]>(
    () => [
      { field: 'registerName', headerName: 'Register', minWidth: 120, flex: 1 },
      {
        field: 'openedAtMs',
        headerName: 'Opened',
        minWidth: 140,
        valueFormatter: (value: number) => when(value),
      },
      {
        field: 'closedAtMs',
        headerName: 'Closed',
        minWidth: 140,
        // Open shifts sort after every closed one, by when they opened.
        valueGetter: (_value: unknown, row: Record<string, any>) =>
          row['closedAtMs'] ?? Number.MAX_SAFE_INTEGER - (row['openedAtMs'] ?? 0),
        renderCell: ({ row }: { row: Record<string, any> }) =>
          row['status'] === 'open' ? <Chip size="small" color="success" label="Open" /> : when(row['closedAtMs']),
      },
      { field: 'openedByName', headerName: 'Opened by', minWidth: 130 },
      moneyColumn('openingFloatCents', 'Starting cash'),
      moneyColumn('netSalesCents', 'Net sales'),
      moneyColumn('expectedCashCents', 'Expected'),
      moneyColumn('countedCashCents', 'Counted'),
      {
        field: 'varianceCents',
        headerName: 'Variance',
        type: 'number',
        minWidth: 110,
        renderCell: ({ row }: { row: Record<string, any> }) =>
          row['varianceCents'] != null ? (
            <Chip
              size="small"
              variant="outlined"
              color={row['varianceCents'] === 0 ? 'success' : 'warning'}
              label={money(row['varianceCents'])}
            />
          ) : (
            '—'
          ),
      },
    ],
    [moneyColumn, money],
  )

  const rows = useMemo(
    () =>
      report
        ? {
            tenders: report.byTender.map((row) => ({ ...row, $id: row.method })),
            registers: report.byRegister.map((row) => ({ ...row, $id: row.registerId || 'none' })),
            cashiers: report.byCashier.map((row) => ({ ...row, $id: row.memberId || 'none' })),
            shifts: report.shifts.map((row) => ({ ...row, $id: `${row.registerId}/${row.shiftId}` })),
          }
        : null,
    [report],
  )

  const exportCsv = async () => {
    if (!user || !report) return
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
      link.download = `day-totals-${report.from}${report.to === report.from ? '' : `-to-${report.to}`}.csv`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    } finally {
      setExporting(false)
    }
  }

  const print = () => {
    if (!report) return
    printPosDocument(posDayReportDocument({ report }))
  }

  const lastDay = from?.isValid() ? from.add(POS_DAY_REPORT_MAX_DAYS - 1, 'day') : undefined

  return (
    <CardDisplay
      header={HEADER}
      help={HELP}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => void exportCsv()} disabled={!report || exporting}>
              {'Export CSV'}
            </Button>
            <Button size="small" onClick={print} disabled={!report}>
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
            {'Day totals are for members who can use the register: a site admin or editor with the "Use the point of sale" permission.'}
          </Alert>
        ) : null}
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
            <DatePicker
              label="From"
              value={from}
              onChange={(value) => {
                setFrom(value)
                if (value?.isValid() && to?.isValid() && (to.isBefore(value) || to.diff(value, 'day') >= POS_DAY_REPORT_MAX_DAYS)) {
                  setTo(value)
                }
              }}
              disabled={!canManagePos}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={to}
              onChange={setTo}
              {...(from?.isValid() ? { minDate: from } : {})}
              {...(lastDay ? { maxDate: lastDay } : {})}
              disabled={!canManagePos}
              slotProps={{ textField: { size: 'small' } }}
            />
            <Button
              size="small"
              disabled={!canManagePos || (!from && !to)}
              onClick={() => {
                setFrom(null)
                setTo(null)
              }}
            >
              {'Today'}
            </Button>
          </Stack>
        </LocalizationProvider>
        {answer.state === 'loading' ? (
          <Typography variant="body2" color="text.secondary">
            {'Adding up every register…'}
          </Typography>
        ) : null}
        {answer.state === 'error' ? <Alert severity="warning">{answer.error}</Alert> : null}
        {report && rows ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {`${posDayRangeLabel(report)} · ${report.timeZone} · every register and cashier`}
            </Typography>
            {report.truncated ? (
              <Alert severity="warning">
                {'These days had more activity than one report reads; the figures are partial. Choose fewer days.'}
              </Alert>
            ) : null}
            {posDayReportIsEmpty(report) ? (
              <Typography variant="body2" color="text.secondary">
                {'No register sales, returns or shifts on these days.'}
              </Typography>
            ) : (
              <>
                <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
                  <CommerceStatTile label="Net sales" value={money(report.totals.netSalesCents)} />
                  <CommerceStatTile label="Gross sales" value={money(report.totals.grossSalesCents)} />
                  <CommerceStatTile label="Orders" value={String(report.totals.orderCount)} />
                  <CommerceStatTile label="Tips" value={money(report.totals.tipsCents)} />
                  <CommerceStatTile label="Tax" value={money(report.totals.taxCents)} />
                  <CommerceStatTile label="Discounts" value={money(report.totals.discountsCents)} />
                  <CommerceStatTile
                    label={`Refunds (${report.totals.refundCount})`}
                    value={money(report.totals.refundsCents)}
                  />
                </Stack>
                <Section title="By tender">
                  <ListTable aria-label="Day totals by tender" rows={rows.tenders} columns={tenderColumns} hideFooter noRowsLabel="No sales" />
                </Section>
                <Section title="By register">
                  <ListTable aria-label="Day totals by register" rows={rows.registers} columns={registerColumns} hideFooter noRowsLabel="No register sales" />
                </Section>
                <Section title="By cashier">
                  <ListTable aria-label="Day totals by cashier" rows={rows.cashiers} columns={cashierColumns} hideFooter noRowsLabel="No cashier sales" />
                </Section>
                <Divider />
                <Section title="Cash drawers">
                  <DrawerRows report={report} money={money} />
                </Section>
                <Section title="Shifts">
                  {/* The one table that grows with the range: the grid pages it. */}
                  <ListTable aria-label="Shifts on these days" rows={rows.shifts} columns={shiftColumns} noRowsLabel="No shifts on these days" />
                </Section>
              </>
            )}
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

/**
 * Day totals (AGL-4037): beside the shift history, for a store with a
 * register, on a plan with the point of sale.
 */
export function PosDayTotalsCard(props: PosDayTotalsCardProps) {
  const firestore = useFirestore()
  // Whether the store has a register at all: the first by id is enough to
  // answer, and an id order drops no register.
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
      upsell={'Totals for a day or an event across every register, shift and cashier come with the point of sale.'}
    >
      <PosDayTotalsBody {...props} />
    </EntitlementGatedCard>
  )
}

PosDayTotalsCard.displayName = 'PosDayTotalsCard'

export default PosDayTotalsCard
