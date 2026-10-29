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

import * as CommerceModel from '../../model'
import { posMoney } from '../../model/commerce-pos-ops'
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, limit, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import QuoteEditorDialog, { type QuoteRow } from './quote-editor-dialog.component'

export interface HostQuotesCardProps {
  hostId: string
  /** Holds "Create and edit quotes" (`commerce.quotes`). */
  canEdit: boolean
  /** Holds "Send quotes and invoices to customers" (`commerce.quotes.send`). */
  canSend: boolean
}

/**
 * How many quotes the list reads. The whole set is read and the grid sorts
 * it by any column; a store past this many is told the list stops short.
 */
const QUOTE_CEILING = 500

/** The products the editor's picker offers. */
const PRODUCT_WINDOW = 200

const REFUSAL = commerceSitePermissionRefusal('commerce.quotes')

interface QuoteListRow extends QuoteRow {
  customerLabel: string
  firstItem: string
  moreItems: number
  statusKey: ReturnType<typeof CommerceModel.quoteDisplayStatus>['key']
  statusLabel: string
  totalCents: number
  updatedAtMs: number
}

/** One quote as its row draws and sorts it. */
function quoteListRow(quote: QuoteRow): QuoteListRow {
  const customer = quote.quote?.customer
  const status = CommerceModel.quoteDisplayStatus(quote)
  const items = quote.lineItems ?? []
  return {
    ...quote,
    customerLabel: customer?.name || customer?.company || customer?.email || '',
    firstItem: items[0]?.name ?? '',
    moreItems: Math.max(0, items.length - 1),
    statusKey: status.key,
    statusLabel: status.label,
    totalCents: Number(quote.totals?.totalCents ?? 0),
    // The customer's latest answer counts as an update (AGL-4096), so a quote
    // they just approved or asked changes to sorts to the top.
    updatedAtMs: Math.max(
      Number(quote.quote?.updatedAtMs ?? 0),
      Number(CommerceModel.latestQuoteResponse(quote.quote)?.atMs ?? 0),
    ),
  }
}

/**
 * Quotes (AGL-4093): prices put to a customer before they buy, beside the
 * orders they become. A quote is an unpaid order on the `quote` channel, so
 * this reads `hosts/{hostId}/orders` for that channel alone; the Orders list
 * above never shows one until it is paid.
 */
export function HostQuotesCard(props: HostQuotesCardProps) {
  const { hostId, canEdit, canSend } = props
  const firestore = useFirestore()
  const { data: quoteDocs, status } = useFirestoreCollection<QuoteRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'orders'),
        where('channel', '==', 'quote'),
        limit(QUOTE_CEILING + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const quotes = useMemo(() => ceilingedWindow<QuoteRow>(quoteDocs ?? undefined, QUOTE_CEILING), [quoteDocs])
  const rows = useMemo(() => Array.from(quotes.rows, quoteListRow), [quotes])

  const { data: productDocs } = useFirestoreCollection<Record<string, any>>(
    () => collectionCeiling(collection(firestore, 'hosts', hostId, 'products'), PRODUCT_WINDOW),
    [firestore, hostId],
    { idField: '$id' },
  )
  const products = useMemo(
    () => ceilingedWindow<Record<string, any>>(productDocs ?? undefined, PRODUCT_WINDOW).rows.filter((product) => !product['deletedAt']),
    [productDocs],
  )

  /** The quote open in the editor: its id, or `new`. */
  const [openId, setOpenId] = useState<string | null>(null)
  const openQuote = openId && openId !== 'new' ? (quotes.rows.find((row) => row.$id === openId) ?? null) : null

  // A manager notice opens its quote (AGL-4096): `?quote=<id>` on the Orders
  // page, once that quote has loaded.
  const [linkedId, setLinkedId] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('quote') ?? ''),
  )
  useEffect(() => {
    if (!linkedId || !quotes.rows.some((row) => row.$id === linkedId)) return
    setOpenId(linkedId)
    setLinkedId('')
  }, [linkedId, quotes.rows])

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'number',
        headerName: 'Quote',
        flex: 1,
        minWidth: 160,
        renderCell: ({ row }: { row: QuoteListRow }) => (
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {CommerceModel.formatQuoteNumber(row, row.$id)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row.moreItems ? `${row.firstItem} and more` : row.firstItem}
            </Typography>
          </Stack>
        ),
      },
      {
        field: 'customerLabel',
        headerName: 'Customer',
        flex: 1,
        minWidth: 160,
        renderCell: ({ row }: { row: QuoteListRow }) => (
          <Typography variant="body2" noWrap>
            {row.customerLabel || '—'}
          </Typography>
        ),
      },
      {
        field: 'totalCents',
        headerName: 'Total',
        type: 'number',
        width: 140,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: { row: QuoteListRow }) => (
          <Stack sx={{ alignItems: 'flex-end', minWidth: 0, width: 1 }}>
            <Typography variant="body2">{posMoney(row.totalCents)}</Typography>
            {row.quote?.tax?.kind === 'at-payment' && CommerceModel.isUnpaidQuote(row) ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {'plus tax at payment'}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'statusLabel',
        headerName: 'Status',
        width: 180,
        renderCell: ({ row }: { row: QuoteListRow }) => (
          <Chip
            size="small"
            variant="outlined"
            label={row.statusLabel}
            color={CommerceModel.QUOTE_STATUS_COLOR[row.statusKey]}
          />
        ),
      },
      {
        field: 'updatedAtMs',
        headerName: 'Updated',
        type: 'number',
        width: 140,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ row }: { row: QuoteListRow }) => (
          <Typography variant="body2" noWrap>
            {row.updatedAtMs ? new Date(row.updatedAtMs).toLocaleDateString() : '—'}
          </Typography>
        ),
      },
    ],
    [],
  )

  const empty = status === 'success' && rows.length === 0

  return (
    <CardDisplay
      header={'Quotes'}
      subheader={'Prices for a customer’s order before they buy'}
      help={pluginDocsHelp('quotes', {
        anchor: '#make-a-quote',
        title: 'Quotes',
        excerpt:
          'Put a price to a customer with your products, items typed for the job and anything ' +
          'included. A quote becomes an order when it is paid.',
      })}
      HeaderProps={{
        action: (
          <BlockedControl blocked={!canEdit} reason={REFUSAL}>
            <Button size="small" variant="contained" onClick={() => setOpenId('new')}>
              {'New quote'}
            </Button>
          </BlockedControl>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      {empty ? (
        <Typography variant="body2" color="text.secondary">
          {'No quotes yet. A quote prices a customer’s order before they buy: your products, ' +
            'items typed for the job, and anything you include at no charge.'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {quotes.truncated ? (
            <Typography variant="caption" color="text.secondary">
              {'This store has more quotes than the list shows at once.'}
            </Typography>
          ) : null}
          <ListTable
            aria-label="Quotes"
            rows={rows}
            columns={columns}
            loading={status === 'loading'}
            onOpen={(id) => setOpenId(id)}
            quickFilter
            initialState={{ sorting: { sortModel: [{ field: 'updatedAtMs', sort: 'desc' }] } }}
            noRowsLabel="No quotes match"
          />
        </Stack>
      )}
      {/* A quote deleted while open closes its editor rather than turn it into a new one. */}
      {openId === 'new' || openQuote ? (
        <QuoteEditorDialog
          key={openId}
          hostId={hostId}
          quote={openQuote}
          products={products}
          canEdit={canEdit}
          canSend={canSend}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </CardDisplay>
  )
}
HostQuotesCard.displayName = 'HostQuotesCard'

export default HostQuotesCard
