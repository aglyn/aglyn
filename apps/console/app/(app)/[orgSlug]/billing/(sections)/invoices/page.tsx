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
import ListTable from '@aglyn/shared-ui-jsx/components/list-table.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import BillingOpenInvoicesCardComponent from '../../../../../../components/billing/billing-open-invoices-card.component'
import { docsHelp } from '../../../../../../constants/docs-links'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'
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
 * What the history grid's Filters panel and quick search offer (AGL-3317).
 * The list holds every invoice it has loaded, so both are answered over
 * those, and the caption under the chips says so while older ones remain.
 * Status is picked from the statuses the loaded invoices carry: the route
 * passes Stripe's word through, and a status no loaded invoice has would
 * match nothing here.
 */
const INVOICE_FILTER_FIELDS = [
  inMemoryListField('number', 'text'),
  inMemoryListField('created', 'date'),
  inMemoryListField('status', 'select'),
]
const INVOICE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  number: 'Invoice',
  created: 'Date',
  status: 'Status',
}
const INVOICE_SEARCH_FIELDS = ['number', 'id'] as const

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
const NO_INVOICES: InvoiceRow[] = []

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
  const fetchInvoices = useCallback(
    async (cursor?: string | null) => {
      if (!orgId || !user) return
      setInvoicesLoading(true)
      try {
        const response = await authorizedFetch(
          user,
          `/api/billing/invoices?orgId=${encodeURIComponent(orgId)}` +
            (cursor ? `&startingAfter=${encodeURIComponent(cursor)}` : ''),
        )
        if (!response.ok) return
        const payload = await response.json()
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
    [orgId, user],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, user, permissionsLoaded])

  const invoiceStatusOptions = useMemo(
    () => ({
      status: [
        ...new Set(
          (invoices ?? [])
            .map((invoice) => invoice.status)
            .filter((status): status is string => Boolean(status)),
        ),
      ].map((status) => ({ value: status, label: status })),
    }),
    [invoices],
  )
  const invoiceFilter = useListRowsFilter({
    rows: invoices ?? NO_INVOICES,
    fields: INVOICE_FILTER_FIELDS,
    options: invoiceStatusOptions,
    headers: INVOICE_FILTER_HEADERS,
    search: INVOICE_SEARCH_FIELDS,
  })

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
        help={docsHelp('billing', {
          anchor: '#outstanding',
          excerpt:
            'Paying an invoice that failed, including when the subscription has already been cancelled.',
        })}
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
                            anchor: '#payments',
                            excerpt:
                              'Invoices from Stripe with status and amounts, plus ' +
                              'links to the hosted invoice, PDF, and receipt.',
                          })}
                          contentGutterX
                          contentGutterY
                        >
                          {invoices === null ? (
                            <Typography variant="body2" color="text.secondary">
                              {'Invoices appear here once billing is configured.'}
                            </Typography>
                          ) : invoices.length === 0 ? (
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
                              <ListFilterChips {...invoiceFilter.chipsProps} />
                              {invoiceFilter.filtering && invoicesHasMore ? (
                                <Typography variant="caption" color="text.secondary">
                                  {`Filtering the ${invoices.length} invoices loaded so far — loading older invoices reaches more.`}
                                </Typography>
                              ) : null}
                              <ListTable
                                aria-label="Invoices"
                                rows={invoiceFilter.rows}
                                columns={invoiceFilter.filterColumns(INVOICE_COLUMNS as GridColDef[])}
                                getRowId={(invoice: InvoiceRow) => invoice.id}
                                // Every loaded invoice is on screen, and the
                                // button below loads older ones: the history
                                // grows rather than pages.
                                hideFooter
                                // The panel and the search are the grid's; the
                                // card answers them over what it loaded
                                // (AGL-3317).
                                {...invoiceFilter.gridProps}
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
