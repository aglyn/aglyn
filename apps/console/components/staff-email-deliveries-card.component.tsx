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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListQueryNotices } from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Chip, Link, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useMemo, useRef, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import { type StaffListPage, useStaffListPagination } from '../hooks/use-staff-list-pagination'
import StaffListPaginationControls from './staff-list-pagination.component'
import StaffEmailMessageDialog from './staff-email-message-dialog.component'
import {
  EMAIL_DELIVERIES_COLUMN_SORTS,
  EMAIL_DELIVERIES_SORT,
} from '../utils/email-deliveries-list-query'
import type { StaffEmailDeliveryRow } from './staff-user-email-history-card.component'

/**
 * One message of `/api/admin/email-deliveries` — the whole delivery record,
 * the same shape the account page's history lists, so a row opens the same
 * message dialog.
 */
type DeliveryRow = StaffEmailDeliveryRow & { $id: string }

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | undefined> = {
  delivered: 'success',
  opened: 'success',
  clicked: 'success',
  delayed: 'warning',
  bounced: 'error',
  complained: 'error',
  failed: 'error',
}

const DELIVERY_PAGE_SORT_HEADERS = { hostId: 'Site' }
/** The table has no filters, so nothing is ever refused. */
const NO_REFUSALS: ReadonlyArray<{ label: string; reason: string }> = []

export interface StaffEmailDeliveriesCardProps {
  /** One site's mail… */
  hostId?: string
  /** …or every site of an organization's. */
  orgId?: string
  /** Site names by id, for the Site column on an organization's card. */
  siteNames?: Readonly<Record<string, string>>
}

/**
 * The emails a site — or every site of an organization — sent, newest first
 * (AGL-3380): recipient, subject, sender, what became of it, and opens and
 * clicks. The record is the delivery log the staff account page reads,
 * queried across recipients by site; the message bodies are not stored, so
 * what a message said is its subject and its sender.
 */
export function StaffEmailDeliveriesCard(props: StaffEmailDeliveriesCardProps) {
  const { hostId, orgId, siteNames } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const { enqueueSnackbar } = useSnackbar()
  const [sitesOmitted, setSitesOmitted] = useState(0)
  const [open, setOpen] = useState<DeliveryRow | null>(null)
  const scope = hostId ? `hostId=${encodeURIComponent(hostId)}` : orgId ? `orgId=${encodeURIComponent(orgId)}` : ''
  const uid = (user as { uid?: string } | null)?.uid ?? null
  /*
   * EVERY HEADER SORTS (AGL-3680), on the route's query
   * (`EMAIL_DELIVERIES_COLUMN_SORTS`); the Site name sorts the page. A new
   * order is a new walk from page one.
   */
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(null)
  const sortParam = askedSort
    ? `&sort=${encodeURIComponent(`${askedSort.path}:${askedSort.direction}`)}`
    : ''

  const fetchPage = useCallback(
    async (cursor: string | null, _index: number, pageSize: number): Promise<StaffListPage<DeliveryRow>> => {
      const response = await authorizedFetch(
        userRef.current,
        `/api/admin/email-deliveries?${scope}&pageSize=${pageSize}${sortParam}` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Delivery log failed')
      setSitesOmitted(Number(payload.sitesOmitted ?? 0))
      return { rows: payload.rows ?? [], hasMore: payload.hasMore, nextCursor: payload.nextCursor }
    },
    [scope, sortParam],
  )
  const reportError = useCallback(
    (error: unknown) => {
      console.error(error)
      enqueueSnackbar('Could not read the delivery log', { variant: 'error' })
    },
    [enqueueSnackbar],
  )
  const pagination = useStaffListPagination<DeliveryRow>({
    fetchPage,
    onError: reportError,
    enabled: Boolean(scope && uid),
  })
  const pageSorts = useMemo(
    () => ({
      hostId: (row: DeliveryRow) => (row.hostId && siteNames?.[row.hostId]) || row.hostId || null,
    }),
    [siteNames],
  )
  const columnSort = useListColumnSort<DeliveryRow>({
    sorts: EMAIL_DELIVERIES_COLUMN_SORTS,
    defaultSort: EMAIL_DELIVERIES_SORT,
    sort: askedSort,
    onSortChange: setAskedSort,
    rows: pagination.rows,
    pageSorts,
    headers: DELIVERY_PAGE_SORT_HEADERS,
  })

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'to',
        headerName: 'To',
        flex: 1.1,
        minWidth: 180,
        renderCell: ({ row }: { row: DeliveryRow }) => (
          <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
            {/* The recipient opens the message, as a click on the row does. */}
            <Link
              component="button"
              type="button"
              variant="body2"
              underline="hover"
              noWrap
              sx={{ lineHeight: 1.25, textAlign: 'left', maxWidth: '100%' }}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(row)
              }}
            >
              {row.to}
            </Link>
            {row.context ? (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.25 }}>
                {row.context}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'subject',
        headerName: 'Subject',
        flex: 1.4,
        minWidth: 200,
        valueGetter: (_value, row: DeliveryRow) => row.subject ?? '—',
      },
      ...(orgId
        ? [
            {
              field: 'hostId',
              headerName: 'Site',
              flex: 0.9,
              minWidth: 150,
              valueGetter: (_value: unknown, row: DeliveryRow) =>
                (row.hostId && siteNames?.[row.hostId]) || row.hostId || '—',
              renderCell: ({ row }: { row: DeliveryRow }) =>
                row.hostId ? (
                  <AppLink
                    href={buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: row.hostId })}
                    onClick={(event: any) => event.stopPropagation()}
                  >
                    {siteNames?.[row.hostId] ?? row.hostId}
                  </AppLink>
                ) : (
                  '—'
                ),
            } satisfies GridColDef,
          ]
        : []),
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.9,
        minWidth: 150,
        renderCell: ({ row }: { row: DeliveryRow }) => (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
            <Chip
              size="small"
              label={row.bounceType ? `${row.status} (${row.bounceType})` : row.status}
              color={STATUS_COLOR[row.status] ?? 'default'}
              variant={STATUS_COLOR[row.status] ? 'filled' : 'outlined'}
              title={row.detail ?? undefined}
            />
          </Stack>
        ),
      },
      {
        field: 'engagement',
        headerName: 'Opens · clicks',
        flex: 0.6,
        minWidth: 110,
        valueGetter: (_value, row: DeliveryRow) => `${row.openCount} · ${row.clickCount}`,
      },
      {
        field: 'firstSeenAtMs',
        headerName: 'Sent',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: DeliveryRow) =>
          row.firstSeenAtMs ? new Date(row.firstSeenAtMs).toLocaleString() : '—',
      },
    ],
    [orgId, siteNames],
  )

  return (
    <CardDisplay
      header={'Emails sent'}
      help={docsHelp('staffConsole', {
        anchor: '#emails-sent',
        excerpt:
          'Every email the site sent — campaigns, form notifications, site account mail — with what became of it. Mail the platform sends to members is on each member\'s own staff page.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {sitesOmitted ? (
          <Alert severity="info">
            {`This organization has more than 30 sites; the log covers the first 30 by id and leaves out ${sitesOmitted}. Open a site to read its mail.`}
          </Alert>
        ) : null}
        <ListQueryNotices refused={NO_REFUSALS} notices={columnSort.notices} />
        <ListTable
          rows={columnSort.rows}
          columns={columns}
          loading={pagination.loading}
          // A header orders the route's query; the Site name sorts this page.
          columnSort={columnSort}
          noRowsLabel="No email recorded for this scope"
          hideFooter
          rowHeight={TABLE_ROW_HEIGHT}
          onOpen={(_id, row) => setOpen(row as DeliveryRow)}
        />
        <StaffListPaginationControls pagination={pagination} />
        {/* Mounted only while a message is open: it fetches the body on mount. */}
        {open ? <StaffEmailMessageDialog row={open} onClose={() => setOpen(null)} /> : null}
      </Stack>
    </CardDisplay>
  )
}

export default StaffEmailDeliveriesCard
