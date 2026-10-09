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
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  listFilterGridColumns,
  type ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import {
  type ListQuerySort,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { MAIL_GATEWAY_LABELS, MAIL_GATEWAYS, type MailGateway } from '@aglyn/shared-util-email'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, AlertTitle, Button, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import useStaffListQuery from '../hooks/use-staff-list-query'
import {
  MAIL_GATEWAY_LEDGER_COLUMN_SORTS,
  MAIL_GATEWAY_LEDGER_FILTER_FIELDS,
  MAIL_GATEWAY_LEDGER_FILTER_HEADERS,
  MAIL_GATEWAY_LEDGER_LIST_QUERY,
  MAIL_GATEWAY_LEDGER_LIST_SORT,
} from '../utils/mail-gateway-ledger-list-query'
import StaffListPaginationControls from './staff-list-pagination.component'

/**
 * The figures worked out from the last thirty days at read time sort the
 * page on screen (AGL-3680): nothing stored holds them to order a query by.
 */
const LEDGER_PAGE_SORTS = {
  holds: (row: MailGatewayLedgerRowView) => row.holds,
  blocked30: (row: MailGatewayLedgerRowView) => row.blocked30 ?? 0,
  delivered30: (row: MailGatewayLedgerRowView) => row.delivered30 ?? 0,
}
const LEDGER_PAGE_SORT_HEADERS = {
  holds: 'State',
  blocked30: 'Refused (30 days)',
  delivered30: 'Delivered (30 days)',
}

/** One ledger as `/api/admin/email-health/gateways` returns it. */
export interface MailGatewayLedgerRowView {
  id: string
  sendingDomain: string
  gateway: MailGateway | null
  shared: boolean
  holds: boolean
  blocked30?: number
  delivered30?: number
  blocked?: number
  delivered?: number
  lastBlockedAtMs?: number | null
  lastBlockedDetail?: string | null
  updatedAtMs?: number
}

interface LedgerSummary {
  sinceMs: number
  refused: MailGatewayLedgerRowView[]
  held: MailGatewayLedgerRowView[]
  truncated: boolean
}

const ENDPOINT = '/api/admin/email-health/gateways'
const NO_SEARCH: readonly string[] = []
const ROWS_PARAMS = { view: 'rows' }
const SELECT_FIELDS = ['gateway']

/** A gateway's display name, or the raw value for one this page does not know. */
export const gatewayLabel = (gateway: string | null | undefined): string =>
  gateway ? (MAIL_GATEWAY_LABELS[gateway as MailGateway] ?? gateway) : '—'

const GATEWAY_OPTIONS: Record<string, readonly ListFilterOption[]> = {
  gateway: MAIL_GATEWAYS.filter((gateway) => gateway !== 'none').map((gateway) => ({
    value: gateway,
    label: MAIL_GATEWAY_LABELS[gateway],
  })),
}

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : '—')

/** One held pair, as the alert above the table names it. */
export function heldSentence(row: MailGatewayLedgerRowView): string {
  const refusals = row.blocked30 ?? 0
  return (
    `${row.sendingDomain} → ${gatewayLabel(row.gateway)}: refused ` +
    `${refusals === 2 ? 'twice' : `${refusals} times`} in 30 days with no delivery` +
    (row.shared ? ' — a shared sender, so every tenant on it is held' : '')
  )
}

/**
 * THE MAIL GATEWAY LEDGER (AGL-3328): what each mail gateway did with mail
 * from each sending domain the Resend path sends from.
 *
 * Two refusals of a sending domain in thirty days, with no delivery beside
 * them, hold that domain's bulk mail — campaigns, workflows, sequences — to
 * everyone behind the gateway; transactional mail still goes. On the
 * platform's own domain or a pooled one the hold reaches every tenant, which
 * is the reason for this card: the held pairs are named first, then the
 * whole ledger as a table whose every filter is on the route's query.
 */
export default function MailGatewayLedgerCard() {
  const { data: user } = useUser()
  const [summary, setSummary] = useState<LedgerSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!user) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(user, ENDPOINT, { cache: 'no-store' })
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Gateway ledger read failed')
          return
        }
        setSummary(body as LedgerSummary)
      } catch {
        if (active) setError('Gateway ledger read failed')
      }
    })()
    return () => {
      active = false
    }
  }, [user, reloadKey])

  const gridFilter = useListGridFilter({ selectFields: SELECT_FIELDS })
  const onError = useCallback(
    (reason: unknown) =>
      setError(reason instanceof Error && reason.message ? reason.message : 'Gateway ledger read failed'),
    [],
  )
  /*
   * EVERY HEADER SORTS (AGL-3680): the stored columns on the route's query
   * (`MAIL_GATEWAY_LEDGER_COLUMN_SORTS`), the thirty-day figures over the
   * page. The plan says which order the route reads in, so the header shows
   * that one.
   */
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(null)
  const orderPlan = useMemo(
    () =>
      planListQuery(
        MAIL_GATEWAY_LEDGER_LIST_QUERY,
        { clauses: gridFilter.clauses, sort: askedSort },
        nameSearchNormalizers,
      ),
    [gridFilter.clauses, askedSort],
  )
  const ledger = useStaffListQuery<MailGatewayLedgerRowView>({
    endpoint: user ? ENDPOINT : null,
    clauses: gridFilter.clauses,
    search: NO_SEARCH,
    sort: askedSort,
    params: ROWS_PARAMS,
    onError,
  })
  const columnSort = useListColumnSort<MailGatewayLedgerRowView>({
    sorts: MAIL_GATEWAY_LEDGER_COLUMN_SORTS,
    defaultSort: MAIL_GATEWAY_LEDGER_LIST_SORT,
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: orderPlan.orderBy,
    rows: ledger.rows,
    pageSorts: LEDGER_PAGE_SORTS,
    headers: LEDGER_PAGE_SORT_HEADERS,
  })
  const { refresh } = ledger
  const reload = useCallback(() => {
    setError(null)
    setReloadKey((key) => key + 1)
    refresh()
  }, [refresh])

  const columns: GridColDef[] = useMemo(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'sendingDomain',
            headerName: 'Sending domain',
            flex: 1,
            minWidth: 170,
            renderCell: ({ row }: { row: MailGatewayLedgerRowView }) => (
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {row.sendingDomain}
              </Typography>
            ),
          },
          { field: 'gateway', headerName: 'Gateway', flex: 0.8, minWidth: 150 },
          {
            field: 'shared',
            headerName: 'Shared sender',
            type: 'boolean',
            width: 130,
          },
          {
            field: 'holds',
            headerName: 'State',
            width: 110,
            filterable: false,
            renderCell: ({ row }: { row: MailGatewayLedgerRowView }) => (
              <Chip
                size="small"
                variant="outlined"
                color={row.holds ? 'error' : 'success'}
                label={row.holds ? 'Held' : 'Clear'}
              />
            ),
          },
          {
            field: 'blocked30',
            headerName: 'Refused (30 days)',
            type: 'number',
            width: 150,
            filterable: false,
            valueGetter: (value) => value ?? 0,
          },
          {
            field: 'delivered30',
            headerName: 'Delivered (30 days)',
            type: 'number',
            width: 160,
            filterable: false,
            valueGetter: (value) => value ?? 0,
          },
          {
            field: 'lastBlockedAtMs',
            headerName: 'Last refusal',
            width: 190,
            filterable: false,
            valueGetter: (value) => when(value as number | null),
          },
          {
            field: 'lastBlockedDetail',
            headerName: 'Last diagnostic',
            flex: 1.6,
            minWidth: 240,
            filterable: false,
            renderCell: ({ row }: { row: MailGatewayLedgerRowView }) => (
              <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', whiteSpace: 'normal' }}
              >
                {row.lastBlockedDetail ?? '—'}
              </Typography>
            ),
          },
        ],
        MAIL_GATEWAY_LEDGER_FILTER_FIELDS,
        GATEWAY_OPTIONS,
        MAIL_GATEWAY_LEDGER_FILTER_HEADERS,
      ),
    [],
  )

  return (
    <CardDisplay
      header={'Mail gateway ledger'}
      help={docsHelp('platformHealth', {
        anchor: '#mail-gateway-ledger',
        excerpt:
          'What each mail gateway did with mail from each sending domain. Two refusals in thirty days with no delivery hold that domain’s bulk mail behind the gateway.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack useFlexGap direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {'Refusals and deliveries each security gateway and mail host gave each sending ' +
              'domain. Two refusals in thirty days with no delivery hold that domain’s bulk ' +
              'mail — campaigns, workflows and sequences — to everyone behind the gateway. ' +
              'Transactional mail is never held.'}
          </Typography>
          <Button size="small" onClick={reload}>
            {'Refresh'}
          </Button>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {!summary && !error ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : null}

        {summary ? (
          summary.held.length ? (
            <Alert severity={summary.held.some((row) => row.shared) ? 'error' : 'warning'}>
              <AlertTitle>{'Held now'}</AlertTitle>
              <Stack spacing={0.5}>
                {summary.held.map((row) => (
                  <Typography key={row.id} variant="body2">
                    {heldSentence(row)}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          ) : (
            <Alert severity="success">
              {`No sending domain is held. ${summary.refused.length} ` +
                `${summary.refused.length === 1 ? 'gateway has' : 'gateways have'} refused a ` +
                `sending domain since ${new Date(summary.sinceMs).toLocaleDateString()}, none twice with no delivery.`}
            </Alert>
          )
        ) : null}
        {summary?.truncated ? (
          <Alert severity="warning">
            {'The read of recent refusals hit its cap, so the oldest are missing from the list ' +
              'above. The table below is complete.'}
          </Alert>
        ) : null}

        <ListFilterChips
          fields={MAIL_GATEWAY_LEDGER_FILTER_FIELDS}
          headers={MAIL_GATEWAY_LEDGER_FILTER_HEADERS}
          options={GATEWAY_OPTIONS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
        />
        <ListQueryNotices
          refused={listQueryRefusals(ledger.refused, {
            fields: MAIL_GATEWAY_LEDGER_FILTER_FIELDS,
            headers: MAIL_GATEWAY_LEDGER_FILTER_HEADERS,
            options: GATEWAY_OPTIONS,
          })}
          notices={[...ledger.notices, ...columnSort.notices]}
        />
        <ListTable
          aria-label="Mail gateway ledger"
          rows={columnSort.rows}
          columns={columns}
          getRowId={(row: MailGatewayLedgerRowView) => row.id}
          loading={ledger.loading}
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          noRowsLabel="No gateway has answered a sending domain yet"
          // One page of a cursor walk. A stored column's header orders the
          // query; a thirty-day figure sorts this page and says so.
          hideFooter
          columnSort={columnSort}
          getRowHeight={() => 'auto'}
        />
        <StaffListPaginationControls pagination={ledger} shown={ledger.rows.length} sizeMenu={false} />
      </Stack>
    </CardDisplay>
  )
}
