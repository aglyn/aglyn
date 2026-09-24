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
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import useStaffListPagination from '../hooks/use-staff-list-pagination'
import {
  SUPPRESSION_FILTER_FIELDS,
  SUPPRESSION_FILTER_HEADERS,
  SUPPRESSION_FILTER_OPTIONS,
  SUPPRESSION_REASON_LABELS,
  SUPPRESSION_SELECT_FIELDS,
  suppressionClauseStandsAlongside,
} from '../utils/email-suppression-filters'
import StaffListPaginationControls from './staff-list-pagination.component'

interface PlatformSuppression {
  $id: string
  email?: string
  reason?: string
  context?: string | null
  hostId?: string | null
  releasedAt?: { seconds?: number } | null
  suppressedAt?: { seconds?: number } | null
  createdAt?: { seconds?: number } | null
}

const describeReason = (reason: unknown) =>
  SUPPRESSION_REASON_LABELS[String(reason ?? '')] ?? {
    label: String(reason ?? 'Unknown'),
    color: 'default' as const,
  }

const day = (seconds: number | undefined): string =>
  seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : '—'

function onDate(row: PlatformSuppression): string {
  return day(row.createdAt?.seconds ?? row.suppressedAt?.seconds)
}

/** Columns the table draws; the other filter fields reach the panel hidden. */
const VISIBLE_COLUMNS = ['email', 'reason', 'context', 'status', 'createdAt']

/**
 * THE PLATFORM-WIDE SUPPRESSION LIST, with a reader and a release.
 *
 * ## What was missing
 *
 * `emailSuppressions` is written by the Resend webhook on every permanent
 * bounce and every complaint, for every sender in the product — invites,
 * verification, receipts, the usage summary — and `listEmailSuppressions` and
 * `releaseEmail` were written to read and lift an entry and had **no callers
 * anywhere**. So an address could be suppressed platform-wide by a machine
 * and never seen or lifted by anybody.
 *
 * The failure that produces is the one support cannot answer: a customer
 * whose address landed here — a typo, a mailbox that was full at exactly the
 * wrong moment and reported permanent, a bounce from a corporate filter that
 * has since been fixed — stops receiving mail from the whole platform, and no
 * screen anywhere says why. This is that screen.
 *
 * ## Why a merchant does not get this control
 *
 * A merchant's own Suppressions card owns the PER-SITE list: a preference
 * about one sender's mail, theirs to add to and remove from. This list is
 * evidence about an ADDRESS, learned anywhere in the product and applying
 * everywhere in it — so lifting one is deciding, on behalf of every other
 * tenant on the shared sending domain, that a hard bounce or a spam report
 * should be mailed again. That is a platform act.
 *
 * ## Why the reason box is required
 *
 * A release is recorded in `adminAudit`, and a record saying only that
 * somebody did it answers half the question it is kept for. The refusal is on
 * the ROUTE as well as here — a disabled button is a courtesy, not a control.
 */
export default function StaffEmailSuppressionsCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [error, setError] = useState<string | null>(null)
  const [releasing, setReleasing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  /*
   * The Filters panel and the search, SERVED by the route (AGL-3321): every
   * clause is a predicate beneath the list's cursor, so each page the footer
   * turns is a page of the narrowed list. Status and Last reported stand
   * beside anything; Reason, Learned from and Site ID are one at a time,
   * because each pair would need an index of its own. See
   * `utils/email-suppression-filters.ts`.
   */
  const gridFilter = useListGridFilter({
    selectFields: SUPPRESSION_SELECT_FIELDS,
    single: true,
    keepAlongside: suppressionClauseStandsAlongside,
  })
  const filtersKey = JSON.stringify(
    gridFilter.clauses.map(({ field, op, value }) => ({ field, op, value })),
  )
  const searchKey = gridFilter.searchWords.join(' ').trim()
  /** The debounced search the route was last asked, one query per settled term. */
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchKey), 300)
    return () => clearTimeout(timer)
  }, [searchKey])
  const filtering = gridFilter.clauses.length > 0 || Boolean(searchKey)

  /*
   * THE CONSOLE'S ONE CURSOR WALK, not a second one that resembles it.
   *
   * A list this long is a window over something that grows — one row per
   * address that has ever bounced permanently or reported spam anywhere in
   * the product — so a fixed read would hide whichever entries fell past it,
   * with nothing on screen to say so. That is the exact defect this list
   * exists to explain, and it would be a poor screen that reproduced it.
   *
   * A new filter or search is a new walk: `fetchPage` changes with them, and
   * the walk restarts at its first page.
   */
  const fetchPage = useCallback(
    async (cursor: string | null, _pageIndex: number, pageSize: number) => {
      const params = new URLSearchParams({ limit: String(pageSize) })
      if (cursor) params.set('cursor', cursor)
      if (filtersKey !== '[]') params.set('filters', filtersKey)
      if (search) params.set('search', search)
      const response = await authorizedFetch(
        user,
        `/api/admin/emails/suppressions?${params.toString()}`,
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = payload?.error ?? 'Could not read the suppression list'
        setError(message)
        throw new Error(message)
      }
      setError(null)
      return {
        rows: (payload?.entries ?? []) as PlatformSuppression[],
        nextCursor: payload?.nextCursor ?? null,
        hasMore: Boolean(payload?.hasMore),
      }
    },
    [user, filtersKey, search],
  )
  // Held at an error rather than an empty list. "Nothing is suppressed" is a
  // confident wrong answer in the reassuring direction, and this card exists
  // to explain mail that is not arriving.
  const onError = useCallback(
    (reason: unknown) =>
      setError((current) =>
        current ??
        (reason instanceof Error && reason.message
          ? reason.message
          : 'Could not read the suppression list'),
      ),
    [],
  )
  const pagination = useStaffListPagination<PlatformSuppression>({
    fetchPage,
    onError,
  })
  const entries = pagination.rows

  const release = useCallback(
    async (email: string) => {
      if (busy) return
      setBusy(true)
      try {
        const response = await authorizedFetch(
          user,
          '/api/admin/emails/suppressions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, note: note.trim() }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'The address was not released',
            { variant: 'warning', allowDuplicate: true },
          )
        }
        enqueueSnackbar(
          payload?.released
            ? 'Released — this address can be mailed again'
            : 'That address was not on the list',
          { variant: payload?.released ? 'success' : 'info', persist: false },
        )
        setReleasing(null)
        setNote('')
        // Re-read rather than trusting the click: the card shows what is
        // stored, not what was asked for.
        pagination.refresh()
      } finally {
        setBusy(false)
      }
    },
    [busy, user, note, enqueueSnackbar, pagination],
  )

  const columns = useMemo<GridColDef[]>(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'email',
            headerName: 'Address',
            flex: 1.4,
            minWidth: 200,
            filterable: false,
            renderCell: ({ row }) =>
              row.email || (
                <Typography variant="body2" color="text.secondary">
                  {'(address not recorded)'}
                </Typography>
              ),
          },
          {
            field: 'reason',
            headerName: 'Reason',
            width: 150,
            renderCell: ({ row }) => {
              const described = describeReason(row.reason)
              return (
                <Chip
                  size="small"
                  color={described.color}
                  variant="outlined"
                  label={described.label}
                />
              )
            },
          },
          {
            /*
             * WHICH SENDER produced the address that died. It is the first
             * thing a support question needs — an invite that bounced is a
             * mistyped address, and a receipt that bounced is a customer who
             * has lost their mailbox. Filtered by the sender's tag; the site
             * beside it is the hidden Site ID filter.
             */
            field: 'context',
            headerName: 'Learned from',
            flex: 1,
            minWidth: 140,
            renderCell: ({ row }) => (
              <Typography variant="caption" color="text.secondary">
                {row.context || '—'}
                {row.hostId ? ` · ${row.hostId}` : ''}
              </Typography>
            ),
          },
          {
            field: 'status',
            headerName: 'Status',
            width: 150,
            valueGetter: (_value, row: PlatformSuppression) =>
              row.releasedAt ? 'Released' : 'Active',
            renderCell: ({ row }) =>
              row.releasedAt ? (
                <Typography variant="caption" color="text.secondary">
                  {`Released ${day(row.releasedAt?.seconds)}`}
                </Typography>
              ) : (
                <Chip size="small" color="error" label="Active" />
              ),
          },
          {
            field: 'createdAt',
            headerName: 'Since',
            width: 120,
            filterable: false,
            valueGetter: (_value, row: PlatformSuppression) => onDate(row),
          },
          listActionsColumn(
            (row: PlatformSuppression) => {
              const address = row.email ?? ''
              // A released entry suppresses nothing, so there is nothing to lift.
              if (row.releasedAt) return null
              return releasing === address ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'flex-end', py: 0.5 }}
                >
                  <TextField
                    size="small"
                    label="Why"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    // The grid's own cell keys (arrows, space) stay out of the box.
                    onKeyDown={(event) => event.stopPropagation()}
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                  <Button
                    size="small"
                    color="error"
                    disabled={busy || note.trim().length < 8}
                    onClick={() => void release(address)}
                  >
                    {'Release'}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setReleasing(null)
                      setNote('')
                    }}
                  >
                    {'Cancel'}
                  </Button>
                </Stack>
              ) : (
                <Button
                  size="small"
                  color="error"
                  disabled={!address}
                  onClick={() => {
                    setReleasing(address)
                    setNote('')
                  }}
                >
                  {'Release'}
                </Button>
              )
            },
            { width: releasing ? 380 : 110 },
          ),
        ],
        SUPPRESSION_FILTER_FIELDS,
        SUPPRESSION_FILTER_OPTIONS,
        SUPPRESSION_FILTER_HEADERS,
      ),
    [busy, note, release, releasing],
  )

  const loading = pagination.loading && !entries.length

  return (
    <CardDisplay
      header={'Platform suppressions'}
      help={docsHelp('staffConsole', {
        anchor: '#system-emails',
        excerpt:
          'Addresses no Aglyn mail reaches, learned from a permanent bounce ' +
          'or a spam report anywhere in the product.',
      })}
      subheader={
        'Addresses that bounced permanently or reported spam, on any send ' +
        'from any site. Nothing in the product mails one until it is released.'
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Alert severity="info">
          {'This list is separate from a merchant’s own Suppressions card. ' +
            'A merchant removing their site’s entry does NOT lift one of ' +
            'these — which is why an address can keep being skipped after ' +
            'they have already removed it from their list.'}
        </Alert>
        <ListFilterChips
          fields={SUPPRESSION_FILTER_FIELDS}
          headers={SUPPRESSION_FILTER_HEADERS}
          options={SUPPRESSION_FILTER_OPTIONS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
        />
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : loading ? (
          <Typography variant="body2">{'Loading…'}</Typography>
        ) : entries.length === 0 && !filtering ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing is suppressed platform-wide.'}
          </Typography>
        ) : null}
        {!error && (entries.length > 0 || filtering) ? (
          <ListTable
            aria-label="Platform suppressions"
            rows={entries}
            columns={columns}
            getRowId={(row: PlatformSuppression) => row.$id}
            loading={pagination.loading}
            rowHeight={TABLE_ROW_HEIGHT}
            // The row holding the Why box is as tall as the box.
            getRowHeight={() => 'auto'}
            // One page of a cursor walk, turned by the footer below: the grid
            // neither slices it nor filters it and calls that the list. The
            // route answers the panel and the search.
            hideFooter
            filterMode="server"
            quickFilter
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            initialState={{
              columns: {
                columnVisibilityModel: hiddenFilterVisibility(
                  SUPPRESSION_FILTER_FIELDS,
                  VISIBLE_COLUMNS,
                ),
              },
            }}
            noRowsLabel="No suppressions match these filters"
          />
        ) : null}
        {/*
          The console's shared footer, so this list is the same control as
          every other staff list rather than a third grammar that resembles
          them. No size menu: the ROUTE bounds a page, and offering a choice
          it clamps would be a menu that does not do what it says.
        */}
        <StaffListPaginationControls
          pagination={pagination}
          shown={entries.length}
          sizeMenu={false}
        />
      </Stack>
    </CardDisplay>
  )
}
StaffEmailSuppressionsCard.displayName = 'StaffEmailSuppressionsCard'
