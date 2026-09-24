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
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { Alert, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useEffect, useMemo, useState } from 'react'

/** The server's page size. Fixed, so the reader is not offered a choice. */
const PAGE_SIZE = 25

/** Which recipients the table asks for. Matches the route's own vocabulary. */
type EngagementFilter = 'all' | 'opened' | 'clicked'

/*
 * What the recipients grid's Filters panel offers (AGL-3317): the one filter
 * the route serves, as a hidden select column. The route answers it over the
 * whole delivery log, one cursor page at a time, and serves nothing else —
 * so no other column filters, and there is no quick search, which could only
 * ever narrow the page on screen.
 */
const RECIPIENT_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'engagement', kind: 'exact', path: 'engagement', operators: ['equals'] },
]
const RECIPIENT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  engagement: 'Engagement',
}
const RECIPIENT_FILTER_OPTIONS = {
  engagement: [
    { value: 'opened', label: 'Opened it' },
    { value: 'clicked', label: 'Clicked something' },
  ],
}
const RECIPIENT_HIDDEN_COLUMNS = { engagement: false }

interface RecipientRow {
  messageId: string
  to: string
  subject: string | null
  campaignId: string | null
  status: string
  openCount: number
  clickCount: number
  clickedLinks: string[]
  firstSeenAtMs: number
  lastEventAtMs: number
}

const recipientsDocsHelp = pluginDocsHelp('emailCampaigns', {
  anchor: '#opens--clicks',
  excerpt:
    'The people an email reached, and which of them opened it or clicked ' +
    'a link — read from the per-recipient delivery log.',
})

export interface EmailRecipientsCardProps {
  hostId: string
  /**
   * Read every message built from this template.
   *
   * Exactly one of `screenId` and `emailId` is passed. The route takes the
   * SCOPE rather than a list of message ids because a caller who could name
   * ids could name another site's, and the narrower input is the one that
   * cannot be got wrong later.
   */
  screenId?: string
  /** Read one message. */
  emailId?: string
}

/**
 * WHO, not how many.
 *
 * ## Why this is a fetch and not a listen
 *
 * Every other card on this page reads Firestore directly. This one cannot:
 * the per-recipient delivery log lives at `emailDeliveries/{sha256(address)}`
 * — one platform-level collection holding every site's mail and every
 * transactional message besides — and the query that narrows it to this
 * site's campaigns is a collection-group query whose scoping predicate is
 * part of the query. A security rule cannot require a `where` clause, so
 * there is no rule that would admit this read and refuse the same read
 * without the filter. The narrowing happens on the server, behind the same
 * site role the send path requires.
 *
 * ## Why it is its own card
 *
 * A separate card is a separate mount, and this is the only read on either
 * detail page whose cost grows with how much mail there has been. It asks
 * once on mount and once per page turn — never on a poll — so a reader who
 * came for the preview and the totals above pays for one page of this and
 * nothing more.
 *
 * ## The cursor, and why "Previous" keeps a stack
 *
 * The route pages forward with an opaque cursor, which is the only shape a
 * Firestore query offers without counting the whole result first. Going back
 * therefore means remembering where each page started, so the cursors are
 * kept in a list indexed by page — `null` for the first — rather than
 * re-walking forward from the beginning.
 */
export function EmailRecipientsCard(props: EmailRecipientsCardProps) {
  const { hostId, screenId, emailId } = props
  const { data: user } = useUser()

  const gridFilter = useListGridFilter({ selectFields: ['engagement'], single: true })
  const asked = gridFilter.clauses.find((clause) => clause.field === 'engagement')?.value
  const filter: EngagementFilter =
    asked === 'opened' || asked === 'clicked' ? asked : 'all'
  const [page, setPage] = useState(0)
  /** Cursor for each page. Index 0 is always `null` — the first page. */
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [rows, setRows] = useState<RecipientRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const [campaignsOmitted, setCampaignsOmitted] = useState(0)
  const [campaignsRead, setCampaignsRead] = useState(0)

  const cursor = cursors[page] ?? null

  useEffect(() => {
    if (!user) return undefined
    let active = true
    setLoading(true)
    setFailure(null)
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          '/api/campaigns/recipients',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hostId,
              ...(screenId ? { screenId } : {}),
              ...(emailId ? { emailId } : {}),
              filter,
              cursor,
            }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setRows([])
          setHasMore(false)
          setFailure(String(payload?.error ?? 'Could not read recipients'))
          return
        }
        /*
         * A read that FAILED is not a campaign nobody opened.
         *
         * The route answers 200 with `lookupFailed` for a delivery-log read
         * that could not run — a missing collection-group index is the likely
         * one — because the rest of the payload is still true. Rendering that
         * as an empty table is how a merchant concludes their campaign
         * reached nobody, which is the one wrong answer this table can give.
         */
        if (payload?.lookupFailed) {
          setRows([])
          setHasMore(false)
          setFailure(
            'The delivery log could not be read, so this table is empty for ' +
              'a reason that has nothing to do with your campaign. The ' +
              'numbers above come from the campaigns themselves and are ' +
              'unaffected.',
          )
          return
        }
        const nextRows: RecipientRow[] = Array.isArray(payload?.rows)
          ? payload.rows
          : []
        setRows(nextRows)
        setCampaignsOmitted(Number(payload?.campaignsOmitted ?? 0))
        setCampaignsRead(Number(payload?.campaignsRead ?? 0))
        const nextCursor: string | null = payload?.cursor ?? null
        setHasMore(Boolean(nextCursor))
        if (nextCursor) {
          setCursors((existing) => {
            if (existing[page + 1] === nextCursor) return existing
            const next = existing.slice(0, page + 1)
            next[page + 1] = nextCursor
            return next
          })
        }
      } catch (error) {
        console.error(error)
        if (active) {
          setRows([])
          setHasMore(false)
          setFailure('Could not read recipients')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, hostId, screenId, emailId, filter, cursor, page])

  // A new filter is a new result set, so the cursors collected under the old
  // one describe positions in a query that no longer exists.
  const [askedFilter, setAskedFilter] = useState<EngagementFilter>(filter)
  if (askedFilter !== filter) {
    setAskedFilter(filter)
    setPage(0)
    setCursors([null])
  }

  const columns = useMemo<GridColDef<RecipientRow>[]>(
    () => [
      {
        field: 'to',
        headerName: 'Recipient',
        flex: 1,
        minWidth: 240,
        renderCell: ({ row }) => (
          <Stack spacing={0.5} sx={{ py: 1, minWidth: 0, wordBreak: 'break-all' }}>
            <Typography variant="body2">{row.to}</Typography>
            {/*
             * WHICH links, under the person who followed them. The
             * per-campaign link rollup counts destinations and names nobody;
             * this is the other half of the same question, and it is the half
             * a merchant asks when they want to know who to call.
             */}
            {row.clickedLinks.map((link) => (
              <Typography key={link} variant="caption" color="text.secondary">
                {link}
              </Typography>
            ))}
          </Stack>
        ),
      },
      ...(emailId
        ? []
        : [
            {
              field: 'subject',
              headerName: 'Email',
              flex: 1,
              minWidth: 180,
              valueGetter: (_value: unknown, row: RecipientRow) => row.subject ?? '—',
            } satisfies GridColDef<RecipientRow>,
          ]),
      {
        field: 'status',
        headerName: 'State',
        width: 130,
        renderCell: ({ row }) => <Chip size="small" label={row.status} />,
      },
      {
        field: 'openCount',
        headerName: 'Opens',
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        width: 100,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {row.openCount.toLocaleString()}
          </Typography>
        ),
      },
      {
        field: 'clickCount',
        headerName: 'Clicks',
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        width: 100,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {row.clickCount.toLocaleString()}
          </Typography>
        ),
      },
      {
        field: 'lastEventAtMs',
        headerName: 'Last event',
        width: 190,
        renderCell: ({ row }) =>
          row.lastEventAtMs ? new Date(row.lastEventAtMs).toLocaleString() : '—',
      },
    ],
    [emailId],
  )
  const filterColumns = useMemo(
    () =>
      listFilterGridColumns(
        columns as GridColDef[],
        RECIPIENT_FILTER_FIELDS,
        RECIPIENT_FILTER_OPTIONS,
        RECIPIENT_FILTER_HEADERS,
      ),
    [columns],
  )

  return (
    <CardDisplay
      header={'Recipients'}
      help={recipientsDocsHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {(emailId
            ? 'One row per address this email was sent to, newest first. '
            : 'One row per message sent from this template, newest first. ') +
            'Opens are counted by a tracking pixel a mail client may block ' +
            'or pre-fetch, so an absent open is weaker evidence than a click.'}
        </Typography>

        <ListFilterChips
          fields={RECIPIENT_FILTER_FIELDS}
          headers={RECIPIENT_FILTER_HEADERS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
          options={RECIPIENT_FILTER_OPTIONS}
        />

        {failure ? <Alert severity="warning">{failure}</Alert> : null}

        {campaignsOmitted ? (
          <Alert severity="info">
            {'This template has been used by more emails than one read can ' +
              `span. These rows cover its ${campaignsRead} most recent ` +
              `emails; ${campaignsOmitted} older ` +
              `${campaignsOmitted === 1 ? 'email is' : 'emails are'} ` +
              'not included.'}
          </Alert>
        ) : null}

        {rows.length === 0 && !loading && !failure && filter === 'all' ? (
          <Typography variant="body2" color="text.secondary">
            {'No delivery records have been kept for this yet.'}
          </Typography>
        ) : (
          <ListTable
            aria-label="Recipients"
            rows={rows}
            columns={filterColumns}
            loading={loading}
            getRowId={(row: RecipientRow) => row.messageId}
            rowHeight={TABLE_ROW_HEIGHT}
            // A recipient carries the links they followed beneath the
            // address, so a row is as tall as its list of links.
            getRowHeight={() => 'auto'}
            // One page of a cursor feed, turned by the footer below: the grid
            // neither slices it nor filters the page and calls that the log.
            // Its panel's one filter is the route's (AGL-3317).
            hideFooter
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            initialState={{ columns: { columnVisibilityModel: RECIPIENT_HIDDEN_COLUMNS } }}
            noRowsLabel="Nobody in the delivery log matches that yet"
          />
        )}

        {/*
         * A cursor feed knows whether ANOTHER page exists and never how many
         * rows there are in total, so `hasMore` is passed and `count` is not
         * — the control renders "1–25 of more than 25" rather than inventing
         * a total nobody paid to count.
         */}
        <ListPagination
          page={page}
          pageSize={PAGE_SIZE}
          rowCount={rows.length}
          hasMore={hasMore}
          disabled={loading}
          onPageChange={setPage}
        />

        <Typography variant="caption" color="text.secondary">
          {'Up to ten distinct destinations are kept per recipient, so a ' +
            'reader who clicked more links than that has the rest counted ' +
            'but not listed.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
EmailRecipientsCard.displayName = 'EmailRecipientsCard'

export default EmailRecipientsCard
