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

import { CardDisplay, GridItems } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import ListTable from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import BillingOpenInvoicesCardComponent from '../../../../../../components/billing/billing-open-invoices-card.component'
import { docsHelp } from '../../../../../../constants/docs-links'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'
import {
  INVOICE_FILTER_FIELDS,
  INVOICE_FILTER_HEADERS,
  INVOICE_FILTER_OPTIONS,
  INVOICE_SELECT_FIELDS,
  invoiceQueryString,
  planInvoiceQuery,
} from '../../../../../../utils/billing-invoice-query'
import { stripeOtherModeInvoiceNotice } from '../../../../../../utils/stripe-mode-notice'

/** One invoice as `/api/billing/invoices` serializes it. */
interface InvoiceRow {
  id: string
  number: string | null
  status: string | null
  amountDueCents: number
  totalCents: number
  currency: string
  created: string | null
  paidAt: string | null
  periodEnd: string | null
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
  receiptUrl: string | null
}

/*
 * The history grid's Filters panel and quick search are asked of STRIPE
 * (AGL-3321): the page turns them into the parameters `planInvoiceQuery`
 * writes, and `/api/billing/invoices` asks Stripe's own list, search and
 * retrieve — see `utils/billing-invoice-query.ts`. Nothing is matched over
 * the invoices already loaded, so an invoice from three years ago is found
 * as readily as this month's.
 */
const INVOICE_GRID_COLUMNS = (): GridColDef[] =>
  listFilterGridColumns(
    INVOICE_COLUMNS as GridColDef[],
    INVOICE_FILTER_FIELDS,
    INVOICE_FILTER_OPTIONS,
    INVOICE_FILTER_HEADERS,
  )

/*
 * EVERY HEADER SORTS THE INVOICES LOADED (AGL-3680).
 *
 * Stripe lists invoices newest first and offers no other order, so no
 * header can be the query's: each sorts the invoices loaded so far, and the
 * header and the notice say so. "Load older invoices" adds to what a header
 * sorts. Documents is a set of links, not a value, and does not sort.
 */
const INVOICE_PAGE_SORTS = {
  number: (invoice: InvoiceRow) => invoice.number ?? invoice.id,
  created: (invoice: InvoiceRow) => (invoice.created ? new Date(invoice.created) : null),
  status: (invoice: InvoiceRow) => invoice.status,
  totalCents: (invoice: InvoiceRow) => invoice.totalCents,
}
const INVOICE_SORT_HEADERS = {
  number: 'Invoice',
  created: 'Date',
  status: 'Status',
  totalCents: 'Amount',
}
const NO_QUERY_SORTS = [] as const
const NO_INVOICES: InvoiceRow[] = []

const INVOICE_COLUMNS: GridColDef<InvoiceRow>[] = [
  {
    field: 'number',
    headerName: 'Invoice',
    flex: 1,
    minWidth: 150,
    valueGetter: (_value, invoice) => invoice.number ?? invoice.id,
  },
  {
    field: 'created',
    headerName: 'Date',
    type: 'date',
    width: 130,
    valueGetter: (_value, invoice) =>
      invoice.created ? new Date(invoice.created) : null,
    valueFormatter: (value: Date | null) => value?.toLocaleDateString() ?? '—',
  },
  {
    field: 'status',
    headerName: 'Status',
    width: 140,
    renderCell: ({ row: invoice }) => (
      <Chip
        label={invoice.status ?? '—'}
        size="small"
        variant="outlined"
        color={
          invoice.status === 'paid'
            ? 'success'
            : invoice.status === 'open'
              ? 'warning'
              : 'default'
        }
      />
    ),
  },
  {
    field: 'totalCents',
    headerName: 'Amount',
    width: 150,
    valueFormatter: (_value, invoice) =>
      `$${(invoice.totalCents / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`,
  },
  {
    field: 'documents',
    headerName: 'Documents',
    flex: 1,
    minWidth: 180,
    align: 'right',
    headerAlign: 'right',
    sortable: false,
    renderCell: ({ row: invoice }) => (
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
        {invoice.hostedInvoiceUrl ? (
          <Link
            href={invoice.hostedInvoiceUrl}
            target="_blank"
            rel="noreferrer"
            variant="body2"
          >
            {'View'}
          </Link>
        ) : null}
        {invoice.invoicePdf ? (
          <Link href={invoice.invoicePdf} variant="body2">
            {'PDF'}
          </Link>
        ) : null}
        {invoice.receiptUrl ? (
          <Link
            href={invoice.receiptUrl}
            target="_blank"
            rel="noreferrer"
            variant="body2"
          >
            {'Receipt'}
          </Link>
        ) : null}
      </Stack>
    ),
  },
]

/**
 * What is owed, and what has already been paid.
 *
 * ## Outstanding appears here AND on Plan, deliberately
 *
 * A customer arriving from a dunning email is signed out, lands on the
 * org-agnostic entry, and is dropped on the billing landing — which is Plan.
 * Making them find a tab called Invoices before they can pay is exactly the
 * hunting this split is supposed to remove. So the card is on both, and that
 * duplication is a decision rather than an oversight.
 *
 * It is safe to duplicate because the card holds no state worth desynchronising
 * and the route refuses a second payment: `pay` re-reads the invoice from
 * Stripe and answers `alreadyPaid` if it has been settled, whichever copy the
 * button was pressed on.
 */
const BillingInvoicesSection: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { orgId } = useCurrentOrg()
  const { can, loaded: permissionsLoaded } = useOrgPermissions()

  /**
   * Stripe's billing portal, reachable from the section that recovers a failed
   * payment.
   *
   * It is the fallback while the native pay button is still unproven against a
   * real decline, and this is where its absence would cost somebody money —
   * not behind a button labelled "manage payment methods", which now goes to
   * the surface that manages them.
   */
  const openPortal = useCallback(async () => {
    const response = await authorizedFetch(user, '/api/billing/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, action: 'portal' }),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload?.url) window.location.assign(payload.url)
  }, [orgId, user])

  // Invoice history (AGL-248, AGL-534), billing.view-gated server-side.
  // Cursor-paginated; "Load more" appends older invoices.
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)
  const [invoicesHasMore, setInvoicesHasMore] = useState(false)
  const [invoiceCursor, setInvoiceCursor] = useState<string | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  /**
   * This deployment's Stripe mode, but ONLY when it is the reason the list is
   * empty (AGL-2486). `null` means the empty list is a real observation.
   */
  const [invoicesOtherMode, setInvoicesOtherMode] = useState<
    'live' | 'test' | null
  >(null)
  const gridFilter = useListGridFilter({ selectFields: INVOICE_SELECT_FIELDS })
  const invoicePlan = useMemo(
    () => planInvoiceQuery(gridFilter.clauses, gridFilter.searchWords),
    [gridFilter.clauses, gridFilter.searchWords],
  )
  const invoiceParams = invoiceQueryString(invoicePlan.params)
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.length > 0
  /** The request a response answers, so a late one for old filters is dropped. */
  const latestParams = useRef('')
  const fetchInvoices = useCallback(
    async (cursor?: string | null) => {
      if (!orgId || !user) return
      latestParams.current = invoiceParams
      setInvoicesLoading(true)
      try {
        const response = await authorizedFetch(
          user,
          `/api/billing/invoices?orgId=${encodeURIComponent(orgId)}` +
            invoiceParams +
            (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
        )
        if (!response.ok) return
        const payload = await response.json()
        if (latestParams.current !== invoiceParams) return
        setInvoices((previous) =>
          cursor
            ? [...(previous ?? []), ...(payload.invoices ?? [])]
            : (payload.invoices ?? []),
        )
        setInvoicesHasMore(payload.hasMore === true)
        setInvoiceCursor(payload.nextCursor ?? null)
        // Only the route can know this — the browser has no idea which Stripe
        // key the server holds. Strict `=== true` so an older cached response
        // that predates the field reads as "a real empty list", not as a
        // mode problem.
        setInvoicesOtherMode(
          payload.otherModeOnly === true
            ? payload.deploymentMode === 'live'
              ? 'live'
              : 'test'
            : null,
        )
      } catch {
        // The card keeps its current state on failure.
      } finally {
        setInvoicesLoading(false)
      }
    },
    [orgId, user, invoiceParams],
  )
  useEffect(() => {
    // `!permissionsLoaded ||`, never `permissionsLoaded && !can(…)`. Written
    // the second way this fires DURING the permission read: `can()` fails open
    // to an owner's map while `loaded` is false, so the guard could only refuse
    // once the answer was already in — which is exactly when it is no longer
    // needed. The route 403s a reader without `billing.view`, so this was not
    // the leak; it is the same mistake one layer down, and asking a question
    // you are not yet entitled to ask is how a fail-open on the other side
    // becomes a real one.
    if (!orgId || !user || !permissionsLoaded || !can('billing.view')) return
    void fetchInvoices()
    // A new filter or search is a new question: the history starts over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, user, permissionsLoaded, invoiceParams])
  const invoiceColumns = useMemo(INVOICE_GRID_COLUMNS, [])
  const columnSort = useListColumnSort<InvoiceRow>({
    sorts: NO_QUERY_SORTS,
    rows: invoices ?? NO_INVOICES,
    pageSorts: INVOICE_PAGE_SORTS,
    headers: INVOICE_SORT_HEADERS,
  })
  const invoiceRefusals = useMemo(
    () =>
      listQueryRefusals(invoicePlan.refused, {
        fields: INVOICE_FILTER_FIELDS,
        headers: INVOICE_FILTER_HEADERS,
        options: INVOICE_FILTER_OPTIONS,
      }),
    [invoicePlan],
  )

  /*
   * Masonry, and the two sizes are the point: `Outstanding` is usually one
   * sentence and `Billing history` is a table. Stacked, both took the full
   * 1110px column and the short one wasted a row. A table earns its width, so
   * it keeps eight of twelve and the short card takes the four beside it.
   */
  return (
    <GridItems
      spacing={3}
      masonry
      items={[
        {
          size: { xs: 12, md: 4 },
          children: (
      <CardDisplay
        header={'Outstanding'}
        subheader={'Anything unpaid, and the button that settles it.'}
        help={docsHelp('billing', { anchor: '#outstanding' })}
        contentGutterX
        contentGutterY
      >
        <BillingOpenInvoicesCardComponent
          orgId={orgId}
          canManage={can('billing.manage')}
          onOpenPortal={
            can('billing.manage') ? () => void openPortal() : undefined
          }
            />
          </CardDisplay>
          ),
        },
        {
          size: { xs: 12, md: 8 },
          children: (
      <CardDisplay
                          header={'Billing history'}
                          help={docsHelp('billing', {
                            anchor: '#billing-history',
                          })}
                          contentGutterX
                          contentGutterY
                        >
                          {invoices === null ? (
                            <Typography variant="body2" color="text.secondary">
                              {'Invoices appear here once billing is configured.'}
                            </Typography>
                          ) : invoices.length === 0 && !filtering ? (
                            // An empty list has two meanings and they are not
                            // interchangeable (AGL-2486): never billed, or
                            // billed in the Stripe mode this deployment cannot
                            // read. Only the second one gets an Alert.
                            invoicesOtherMode ? (
                              <Alert severity="info">
                                {stripeOtherModeInvoiceNotice(invoicesOtherMode)}
                              </Alert>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                {'No invoices yet.'}
                              </Typography>
                            )
                          ) : (
                            <>
                              <ListFilterChips
                                fields={INVOICE_FILTER_FIELDS}
                                headers={INVOICE_FILTER_HEADERS}
                                clauses={gridFilter.clauses}
                                onChange={gridFilter.setClauses}
                                options={INVOICE_FILTER_OPTIONS}
                              />
                              <ListQueryNotices
                                refused={invoiceRefusals}
                                notices={[...invoicePlan.notices, ...columnSort.notices]}
                              />
                              <ListTable
                                aria-label="Invoices"
                                rows={columnSort.rows as InvoiceRow[]}
                                columns={invoiceColumns}
                                getRowId={(invoice: InvoiceRow) => invoice.id}
                                // Every loaded invoice is on screen, and the
                                // button below loads older ones: the history
                                // grows rather than pages.
                                hideFooter
                                // Newest first, as Stripe returns them, until
                                // a header sorts the invoices loaded and says
                                // so (`columnSort`).
                                columnSort={columnSort}
                                // The panel and the search are Stripe's: the
                                // grid narrows nothing itself (AGL-3321).
                                filterMode="server"
                                filterModel={gridFilter.filterModel}
                                onFilterModelChange={gridFilter.onFilterModelChange}
                                quickFilter
                                noRowsLabel="No invoices match these filters"
                              />
                              {invoicesHasMore ? (
                                <Box sx={{ textAlign: 'center', mt: 1 }}>
                                  <Button
                                    size="small"
                                    color="primary"
                                    disabled={invoicesLoading}
                                    onClick={() => void fetchInvoices(invoiceCursor)}
                                  >
                                    {invoicesLoading
                                      ? 'Loading…'
                                      : 'Load older invoices'}
                                  </Button>
                                </Box>
                              ) : null}
                            </>
                          )}
                        </CardDisplay>
          ),
        },
      ]}
    />
  )
}
BillingInvoicesSection.displayName = 'Page:BillingInvoices'

export default BillingInvoicesSection
