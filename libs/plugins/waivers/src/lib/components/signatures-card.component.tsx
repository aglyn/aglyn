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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { Alert, Button, Chip, MenuItem, Stack, TextField } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import type { Dayjs } from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { formatDayKey, type WaiverTemplate } from '../model/waiver'
import { WAIVER_METHOD_LABELS, type WaiverSignatureRow } from '../model/waiver-signature'
import { PaperWaiverDialog } from './paper-waiver-dialog.component'
import { SignatureDetailDialog } from './signature-detail-dialog.component'
import { saveBlob, useWaiversFetch } from './waivers-api'

export interface SignaturesCardProps {
  hostId: string
  waivers: WaiverTemplate[]
  canManage: boolean
  canCollect: boolean
  /** A search to open on, like a rider's name from check-in (AGL-4042). */
  initialQuery?: string
}

const when = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Who signed (AGL-4042): the site's signatures newest first, searched by a
 * signer's or a minor's name, an email or a day, and narrowed to one waiver —
 * each a query of its own on the server, a page at a time. The rows on
 * screen sort by any column. Export takes every match as a spreadsheet.
 */
export function SignaturesCard(props: SignaturesCardProps) {
  const { hostId, canCollect, canManage } = props
  const { ready, request, download } = useWaiversFetch()
  const [text, setText] = useState(props.initialQuery ?? '')
  const [query, setQuery] = useState((props.initialQuery ?? '').trim())
  const [day, setDay] = useState<Dayjs | null>(null)
  const [waiverId, setWaiverId] = useState('')
  const [rows, setRows] = useState<WaiverSignatureRow[] | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  /** The row each page opens after: page 0 opens at the newest. */
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [paper, setPaper] = useState(false)
  const [exporting, setExporting] = useState(false)

  // A typed search settles before it is asked.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [text])

  const search = day?.isValid() ? day.format('YYYY-MM-DD') : query
  const filters = useMemo(() => ({ hostId, q: search || undefined, waiverId: waiverId || undefined }), [hostId, search, waiverId])

  // Any change of what is asked starts again at the first page.
  useEffect(() => {
    setPage(0)
    setCursors([null])
  }, [filters, pageSize])

  useEffect(() => {
    if (!ready || !canCollect) return
    let live = true
    const after = cursors[page]
    setRows(null)
    setError(null)
    void request<{ signatures: WaiverSignatureRow[]; next: string | null }>(WAIVERS_API_ROUTES.signatures, {
      query: { ...filters, limit: String(pageSize), ...(after ? { after } : {}) },
    })
      .then((answer) => {
        if (!live) return
        setRows(answer.signatures)
        setHasMore(Boolean(answer.next))
        setCursors((prior) => {
          const copy = prior.slice(0, page + 1)
          copy[page + 1] = answer.next
          return copy
        })
      })
      .catch((caught: Error) => live && setError(caught.message))
    return () => {
      live = false
    }
    // `cursors` is written here; reading it through `page` is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, canCollect, request, filters, page, pageSize, revision])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const blob = await download(WAIVERS_API_ROUTES.signatures, { query: { ...filters, format: 'csv' } })
      saveBlob(blob, `waiver-signatures${search ? `-${search.replace(/[^a-z0-9-]+/gi, '-')}` : ''}.csv`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The spreadsheet could not be made.')
    } finally {
      setExporting(false)
    }
  }

  const tableRows = useMemo(
    () =>
      (rows ?? []).map((row) => ({
        ...row,
        $id: row.id,
        minorsText: row.minors.map((minor) => minor.name).join(', '),
        waiverText: `${row.waiverTitle} (v${row.version})`,
      })),
    [rows],
  )
  const columns = useMemo<GridColDef[]>(
    () => [
      { field: 'signedAtMs', headerName: 'Signed', type: 'number', minWidth: 170, valueFormatter: (value: number) => when(value) },
      { field: 'signerName', headerName: 'Signer', flex: 1, minWidth: 160 },
      { field: 'minorsText', headerName: 'Minors', flex: 1, minWidth: 140 },
      { field: 'email', headerName: 'Email', flex: 1, minWidth: 180 },
      { field: 'waiverText', headerName: 'Waiver', flex: 1, minWidth: 180 },
      {
        field: 'method',
        headerName: 'How',
        minWidth: 130,
        valueGetter: (_value: unknown, row: WaiverSignatureRow) => WAIVER_METHOD_LABELS[row.method],
      },
      {
        field: 'validThroughDayKey',
        headerName: 'Good through',
        minWidth: 140,
        valueFormatter: (value: string) => formatDayKey(value),
      },
      {
        field: 'voided',
        headerName: 'Status',
        minWidth: 110,
        type: 'boolean',
        renderCell: ({ row }: { row: WaiverSignatureRow }) =>
          row.voided ? (
            <Chip size="small" color="warning" label="Voided" />
          ) : row.retainedUntilMs ? (
            <Chip size="small" variant="outlined" color="info" label={`Kept until ${when(row.retainedUntilMs)}`} />
          ) : (
            <Chip size="small" variant="outlined" color="success" label="Signed" />
          ),
      },
    ],
    [],
  )

  return (
    <CardDisplay
      header="Signatures"
      help={pluginDocsHelp('waivers', { anchor: '#find-a-signature' })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            <BlockedControl blocked={!canCollect} reason="Recording waivers needs the Collect waivers permission.">
              <Button size="small" onClick={() => setPaper(true)}>
                {'Record paper waiver'}
              </Button>
            </BlockedControl>
            <BlockedControl blocked={!canCollect} reason="Signatures need the Collect waivers permission.">
              <Button size="small" onClick={() => void exportCsv()} disabled={exporting || !rows?.length}>
                {'Export CSV'}
              </Button>
            </BlockedControl>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {!canCollect ? (
          <Alert severity="info">
            {'Signatures hold signers’ personal details, so they are for site admins and editors whose Collect waivers permission is on.'}
          </Alert>
        ) : null}
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              label="Search a name or an email"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                if (event.target.value) setDay(null)
              }}
              disabled={!canCollect}
              fullWidth
            />
            <DatePicker
              label="Signed on"
              value={day}
              disabled={!canCollect}
              onChange={(value) => {
                setDay(value)
                if (value) setText('')
              }}
              slotProps={{ field: { clearable: true }, textField: { sx: { minWidth: 180 } } }}
            />
            <TextField
              select
              label="Waiver"
              value={waiverId}
              onChange={(event) => setWaiverId(event.target.value)}
              disabled={!canCollect}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">{'Every waiver'}</MenuItem>
              {props.waivers.map((waiver) => (
                <MenuItem key={waiver.id} value={waiver.id}>
                  {waiver.title}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </LocalizationProvider>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {canCollect ? (
          <ListTable
            aria-label="Signatures"
            rows={tableRows}
            columns={columns}
            loading={rows === null && !error}
            onOpen={(id) => setOpen(id)}
            hideFooter
            noRowsLabel={search ? 'No signature matches' : 'No signatures yet'}
            noRowsDescription={search ? 'Search a whole first or last name, a full email address, or pick a day.' : 'Share a waiver’s link, or sign one at the window.'}
          />
        ) : null}
        {canCollect ? (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={rows?.length ?? 0}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        ) : null}
      </Stack>
      <SignatureDetailDialog
        hostId={hostId}
        signatureId={open}
        canManage={canManage}
        onClose={() => setOpen(null)}
        onChanged={() => setRevision((value) => value + 1)}
      />
      <PaperWaiverDialog
        hostId={hostId}
        open={paper}
        waivers={props.waivers}
        onClose={() => setPaper(false)}
        onRecorded={() => setRevision((value) => value + 1)}
      />
    </CardDisplay>
  )
}

export default SignaturesCard
