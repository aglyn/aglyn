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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  inMemoryListField,
  type ListFilterOption,
  upsertListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import {
  Alert,
  AlertTitle,
  Chip,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'
import {
  taxReturnFindingGroups,
  type TaxReturnFindingRow,
  type TaxReturnPayload,
} from '../utils/tx-return-webfile'

/** One flagged invoice, once, with every finding that lists it. */
type FindingListRow = TaxReturnFindingRow & {
  $id: string
  /** The ids of the finding groups this row appears under. */
  groups: string[]
}

/*
 * What the findings grid filters and searches by. The card holds every row
 * the period's findings name (the route caps the read and says so above) and
 * pages them itself, so both answer over all of them before a page is
 * sliced. `groups` is an array of finding ids, matched member by member.
 */
const FINDING_FILTER_FIELDS = [
  inMemoryListField('invoiceId', 'text'),
  {
    ...inMemoryListField('groups', 'select'),
    tokensPath: 'groups',
    verbatimTokens: true,
  },
  inMemoryListField('jurisdiction', 'select'),
  inMemoryListField('paidAt', 'date'),
]
const FINDING_FILTER_HEADERS: Readonly<Record<string, string>> = {
  invoiceId: 'Invoice',
  groups: 'Finding',
  jurisdiction: 'Bucketed as',
  paidAt: 'Paid',
}
const FINDING_SEARCH_PATHS = ['invoiceId', 'orgId', 'jurisdiction']

/** How a bucket reads: `unknown` is the row with no readable address. */
const bucketLabel = (jurisdiction: string) =>
  jurisdiction === 'unknown' ? 'No address' : jurisdiction

/**
 * WHICH ROWS — the half of every finding that never reached the screen.
 *
 * The verdict banner above said *"1 row needs attention — Rows billed without
 * automatic tax"* and there was no way, anywhere in the product, to learn
 * which row. That finding's own text says what is at stake: if the row is a
 * sale in the filing jurisdiction, tax was under-collected and is still owed,
 * and the platform pays it out of the receipt. An operator cannot begin on
 * that without an invoice id.
 *
 * The counts reached the screen because `taxReturnSummary` computes them; the
 * identities did not because the route projected rows the page never read and
 * the table below it aggregates by jurisdiction. Both halves now come from one
 * predicate (`taxReturnRowFindings`), so a count and its list cannot disagree.
 *
 * ## Why a card, and not rows inside the banner
 *
 * The banner is the verdict and its prominence is its whole function — the
 * page's own rule is that a qualified figure must never read as a final one,
 * and it earns that by being short enough to read before somebody presses
 * Submit at the authority. Up to `ROW_CAP` rows inside it would destroy
 * exactly that property.
 *
 * A single table, every flagged row once, rather than a table per finding,
 * because a row commonly raises two — no address AND no stated base — and
 * repeating it under each would make one problem look like several. Which
 * finding to read is the grid's Finding filter, a select over the findings
 * this period raised; the chips above carry the counts, so the banner's list
 * and this card show the same numbers from the same source, and pressing one
 * sets that same filter.
 *
 * ## What it shows, and what it deliberately does not
 *
 * Enough to act on a row and no more: the invoice id, the jurisdiction it was
 * BUCKETED under (the fact that put it on or off the return), the money, the
 * paid date, and a link into Stripe. These rows carry customer identifiers and
 * amounts on a `super`-gated staff page, and a filing surface that grows into
 * a customer export is a different and worse thing.
 */
export default function StaffTaxFindingsCard({
  payload,
  loading,
}: {
  payload: TaxReturnPayload | null
  loading: boolean
}) {
  const groups = useMemo(() => taxReturnFindingGroups(payload), [payload])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)

  const rows = useMemo((): FindingListRow[] => {
    const byInvoice = new Map<string, FindingListRow>()
    for (const group of groups) {
      for (const row of group.rows) {
        const held = byInvoice.get(row.invoiceId)
        if (held) held.groups.push(group.id)
        else byInvoice.set(row.invoiceId, { ...row, $id: row.invoiceId, groups: [group.id] })
      }
    }
    return [...byInvoice.values()]
  }, [groups])
  const options = useMemo(
    (): Record<string, readonly ListFilterOption[]> => ({
      groups: groups.map((group) => ({ value: group.id, label: group.label })),
      // The buckets the period's rows were filed under — the resolver's own
      // keys, so there is no catalog beyond what the rows hold.
      jurisdiction: [...new Set(rows.map((row) => row.jurisdiction))]
        .sort()
        .map((jurisdiction) => ({ value: jurisdiction, label: bucketLabel(jurisdiction) })),
    }),
    [groups, rows],
  )
  const findingFilter = useListRowsFilter({
    rows,
    fields: FINDING_FILTER_FIELDS,
    options,
    headers: FINDING_FILTER_HEADERS,
    search: FINDING_SEARCH_PATHS,
  })
  const { clauses, setClauses } = findingFilter.gridFilter
  const matched = findingFilter.rows

  /*
   * The finding a clause asks for, when it asks for exactly one — the one
   * whose explanation the card shows. A clause the period no longer raises
   * matches nothing, and the chips still show it so it can be removed.
   */
  const askedGroupId = clauses.find(
    (clause) => clause.field === 'groups' && clause.op === 'equals',
  )?.value
  const asked = groups.find((group) => group.id === askedGroupId) ?? null
  const unnamed = groups.filter((group) => !group.namesRows)

  useEffect(() => {
    setPage(0)
  }, [payload, clauses])
  const visible = matched.slice(page * pageSize, page * pageSize + pageSize)

  const labelOf = useMemo(
    () => new Map(groups.map((group) => [group.id as string, group.label])),
    [groups],
  )
  const { filterColumns } = findingFilter
  const columns = useMemo(
    () =>
      filterColumns([
        {
          field: 'invoiceId',
          headerName: 'Invoice',
          flex: 1.2,
          minWidth: 200,
          renderCell: ({ row }: { row: FindingListRow }) => (
            <Stack sx={{ py: 1 }}>
              {/*
                Into Stripe, where the invoice can be read and fixed.
                `noopener` because the dashboard is another origin and the
                console's tab must not be reachable from it.
              */}
              {row.stripeUrl ? (
                <Link
                  href={row.stripeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{ fontFamily: 'monospace' }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {row.invoiceId}
                </Link>
              ) : (
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {row.invoiceId}
                </Typography>
              )}
              {row.orgId ? (
                <Typography variant="caption" color="text.secondary">
                  {row.orgId}
                </Typography>
              ) : null}
            </Stack>
          ),
        },
        {
          field: 'jurisdiction',
          headerName: 'Bucketed as',
          width: 140,
          renderCell: ({ row }: { row: FindingListRow }) => (
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace' }}
              color={row.jurisdiction === 'unknown' ? 'warning.main' : 'text.primary'}
            >
              {bucketLabel(row.jurisdiction)}
            </Typography>
          ),
        },
        {
          field: 'grossDollars',
          headerName: 'Gross',
          type: 'number',
          width: 120,
          valueGetter: (_value, row: FindingListRow) => Number(row.grossDollars),
          renderCell: ({ row }: { row: FindingListRow }) => (
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {`$${row.grossDollars}`}
            </Typography>
          ),
        },
        {
          field: 'taxDollars',
          headerName: 'Tax',
          type: 'number',
          width: 110,
          valueGetter: (_value, row: FindingListRow) => Number(row.taxDollars),
          renderCell: ({ row }: { row: FindingListRow }) => (
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {`$${row.taxDollars}`}
            </Typography>
          ),
        },
        {
          field: 'paidAt',
          headerName: 'Paid',
          type: 'date',
          width: 120,
          valueGetter: (_value, row: FindingListRow) =>
            row.paidAt ? new Date(row.paidAt) : null,
          renderCell: ({ row }: { row: FindingListRow }) => (
            <Typography variant="caption" color="text.secondary">
              {row.paidAt ? row.paidAt.slice(0, 10) : 'Not stated'}
            </Typography>
          ),
        },
        {
          /*
            EVERY finding the row raises. A row that raises two is one
            problem, and seeing both at once is what stops it being fixed
            twice or half.
          */
          field: 'groups',
          headerName: 'Findings',
          flex: 1.4,
          minWidth: 220,
          sortable: false,
          renderCell: ({ row }: { row: FindingListRow }) => (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, py: 1 }}>
              {row.groups.map((finding) => (
                <Chip
                  key={finding}
                  size="small"
                  variant="outlined"
                  label={labelOf.get(finding) ?? finding}
                />
              ))}
            </Stack>
          ),
        },
      ] as GridColDef<FindingListRow>[] as GridColDef[]),
    [filterColumns, labelOf],
  )

  if (!payload) {
    return null
  }
  if (!groups.length) {
    return null
  }

  return (
    <CardDisplay
      header={'Findings — the rows behind each count'}
      help={docsHelp('salesTaxReturn', {
        anchor: '#rows-that-need-attention',
        excerpt:
          'Every finding above, resolved to the invoices it is about — the ' +
          'invoice id, where the customer was, the money and a link into ' +
          'Stripe.',
      })}
      subheader={
        'A count with no rows behind it cannot be acted on. Every flagged ' +
        'invoice is listed once; pick a finding to narrow the table to it.'
      }
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {/* The counts, one per finding. Pressing one sets the grid's Finding
            filter to it — the same clause the Filters panel writes. */}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          {groups.map((group) => (
            <Chip
              key={group.id}
              size="small"
              clickable
              aria-pressed={asked?.id === group.id}
              onClick={() =>
                setClauses(
                  upsertListFilterClause(
                    clauses,
                    'groups',
                    asked?.id === group.id
                      ? null
                      : { field: 'groups', op: 'equals', value: group.id },
                  ),
                )
              }
              variant={asked?.id === group.id ? 'filled' : 'outlined'}
              color={
                group.severity === 'blocking'
                  ? 'error'
                  : group.severity === 'review'
                    ? 'warning'
                    : 'default'
              }
              label={`${group.count} · ${group.label}`}
            />
          ))}
        </Stack>

        {asked ? (
          <Typography variant="body2" color="text.secondary">
            {asked.detail}
          </Typography>
        ) : null}
        {/*
          A COUNT WITH NO ROWS IS NOT A CLEAN FINDING. It is a response that
          could not name them — the state a client chunk cached from before
          the per-row findings lands in. The table below would silently lack
          them, on a page about money owed to a state, so each is named.
        */}
        {unnamed.map((group) => (
          <Alert key={group.id} severity="warning">
            <AlertTitle>{`This response cannot name these rows — ${group.label}`}</AlertTitle>
            {`The period reports ${group.count} of these and carries no ` +
              'per-row findings, which is what a response from before ' +
              'they existed looks like. Reload the page; if it persists, ' +
              'export the working papers and read the rows there.'}
          </Alert>
        ))}

        {rows.length ? (
          <>
            <ListFilterChips {...findingFilter.chipsProps} />
            <ListTable
              aria-label="Findings"
              rows={visible}
              columns={columns}
              {...findingFilter.gridProps}
              // An invoice carries its org beneath it and a row may raise
              // several findings, so a row is as tall as its content.
              getRowHeight={() => 'auto'}
              // Held whole and paged by the footer below.
              hideFooter
              noRowsLabel="No rows match these filters"
            />
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={visible.length}
              count={matched.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              disabled={loading}
            />
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
StaffTaxFindingsCard.displayName = 'StaffTaxFindingsCard'
