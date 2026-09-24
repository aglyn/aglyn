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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  inMemoryListField,
  type ListFilterClause,
  upsertListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  checkEntitlement,
  ORDERS_CUSTOMER_PARAM,
  ORDERS_ORDER_PARAM,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import {
  Alert,
  AlertTitle,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, doc, getDoc, limit, orderBy, query } from 'firebase/firestore'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useOrgPlan,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

import CommerceStatTile from './commerce-stat-tile.component'
import OrderDetailDialog, {
  DISPUTE_COLOR,
} from './order-detail-dialog.component'

/**
 * How far back the table, its filters and its export reach.
 *
 * This window cannot be paged the way a plain list can. The Filters panel,
 * the search and the CSV export all run over what was read, so a page of ten
 * would quietly narrow every one of them — a status filter would search a
 * tenth of the orders and report confidently on what it found. Bounding the read and saying where the
 * bound falls keeps the filters honest about their own scope.
 */
const ORDERS_WINDOW = 200

/** A name map for the filter menu; it renders no product rows of its own. */
const PRODUCT_NAME_WINDOW = 100

/*
 * What the orders grid's Filters panel offers. The card holds its whole
 * window, so the panel and the search answer over every order it read.
 *
 * Status and Channel are the order's own enumerations; Disputes is apart
 * from Status on purpose, because the two are orthogonal: an OPEN dispute
 * sits on an order that is still `paid`, and a lost one on `refunded`
 * beside every ordinary refund. Product is the ids of every line item, so
 * a cart, POS or draft order is found by any product it holds. The date is
 * the field the query orders by, which every order writer stamps.
 */
const ORDER_FILTER_FIELDS = [
  inMemoryListField('orderLabel', 'text'),
  inMemoryListField('customerEmail', 'text'),
  inMemoryListField('channelKey', 'select'),
  inMemoryListField('statusKey', 'select'),
  inMemoryListField('createdAtMs', 'date'),
  { ...inMemoryListField('productIds', 'select'), tokensPath: 'productIds', verbatimTokens: true },
  inMemoryListField('disputeKey', 'select'),
]
const ORDER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  orderLabel: 'Order',
  customerEmail: 'Customer',
  channelKey: 'Channel',
  statusKey: 'Status',
  createdAtMs: 'Date',
  productIds: 'Product',
  disputeKey: 'Disputes',
}
const ORDER_STATUS_OPTIONS = (
  Object.keys(CommerceModel.ORDER_STATUS_LABELS) as (keyof typeof CommerceModel.ORDER_STATUS_LABELS)[]
).map((status) => ({ value: status, label: CommerceModel.ORDER_STATUS_LABELS[status] }))
const ORDER_CHANNEL_OPTIONS = (
  Object.keys(CommerceModel.ORDER_CHANNEL_LABELS) as (keyof typeof CommerceModel.ORDER_CHANNEL_LABELS)[]
).map((channel) => ({ value: channel, label: CommerceModel.ORDER_CHANNEL_LABELS[channel] }))
/*
 * `lost` is the badge's tone, not the raw dispute status: a dispute that was
 * WON also closes with money untouched, and listing it as charged back would
 * tell a merchant they lost a case they won.
 */
const ORDER_DISPUTE_OPTIONS = [
  { value: 'open', label: 'Open dispute' },
  { value: 'lost', label: 'Charged back' },
]
/** What the quick search reads on an order row. */
const ORDER_SEARCH_FIELDS = ['orderLabel', 'customerEmail', 'itemName'] as const
/** The filter-only columns never show. */
const ORDER_HIDDEN_COLUMNS = hiddenFilterVisibility(ORDER_FILTER_FIELDS, [
  'orderLabel',
  'customerEmail',
  'channelKey',
  'statusKey',
  'createdAtMs',
])

/** The clause the dispute banner's "Show them" sets. */
const OPEN_DISPUTE_CLAUSE: ListFilterClause = {
  field: 'disputeKey',
  op: 'equals',
  value: 'open',
}

export interface HostOrdersCardProps {
  hostId: string
}

/**
 * Orders console (AGL-287): filterable list over webhook-written order
 * docs with a detail dialog (timeline, fulfill, refund, cancel, notes,
 * packing slip) and draft orders that send the buyer a payment link.
 */
export function HostOrdersCard(props: HostOrdersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  /**
   * The most recent orders, in the order the table shows them.
   *
   * `createdAtMs` is the field every order writer in the plugin stamps and the
   * one `reconcile-stock` already walks the collection by. Ordering on it is
   * what makes this window the RECENT orders: an unordered cap is answered in
   * document-id order, and orders are keyed by generated ids, so it returns a
   * pseudo-random sample that a client sort then dresses as newest-first.
   */
  const { data: orderDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'orders'),
        orderBy('createdAtMs', 'desc'),
        limit(ORDERS_WINDOW + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'products'),
        PRODUCT_NAME_WINDOW,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const orderWindow = useMemo(
    () => ceilingedWindow<any>(orderDocs ?? undefined, ORDERS_WINDOW),
    [orderDocs],
  )
  const productWindow = useMemo(
    () => ceilingedWindow<any>(productDocs ?? undefined, PRODUCT_NAME_WINDOW),
    [productDocs],
  )
  const productNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const product of productWindow.rows) {
      map[product.$id] = product.name ?? product.$id
    }
    return map
  }, [productWindow])

  /**
   * The money tiles are the `commerceAnalytics` surface (AGL-1938,
   * AGL-2056), and this is the third place they appear. Rendering them
   * ungated here would undo both of those passes and hand a Starter org
   * the Pro figures one tab away from the upgrade prompt that refuses
   * them. The TABLE below is not gated — a list of your own orders is not
   * a paid feature.
   */
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const showStats =
    orgReady && checkEntitlement(org as never, 'commerceAnalytics')

  // The query returns the window already newest-first; re-sorting it here
  // would only restate the order it arrived in.
  const orders = orderWindow.rows

  /*
   * The grid's clauses (AGL-96, AGL-3317), held here so two things outside
   * the grid can set one: the CRM's contact page links with the buyer's
   * address to answer "what has this customer ordered" (AGL-2622), seeded as
   * a Customer clause matched as a substring so a domain finds every buyer at
   * a company; and the dispute banner's "Show them".
   */
  const searchParams = useSearchParams()
  const [clauses, setClauses] = useState<ListFilterClause[]>(() => {
    const customer = searchParams?.get(ORDERS_CUSTOMER_PARAM)?.trim()
    return customer
      ? [{ field: 'customerEmail', op: 'contains', value: customer }]
      : []
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /*
   * An order named in the URL opens in its dialog on arrival (AGL-2622). A
   * contact's timeline names the order that made the person a customer,
   * and the address it links to is this list with `?order={id}`. The
   * window is the newest two hundred, and an order from last year is not
   * in it, so the document is read once by id and held beside the window
   * for the dialog; an order that IS in the window is found there first
   * and the read is skipped. Once per id — the ref keeps a re-render from
   * reopening a dialog the merchant has since closed — and the landing read
   * is judged against the ref rather than an effect cleanup, because the
   * `setSelectedId` above re-renders before the read lands and a cleanup
   * keyed on any dep would cancel the answer to the question just asked.
   */
  const seededOrderId = searchParams?.get(ORDERS_ORDER_PARAM) ?? null
  const [seededOrder, setSeededOrder] = useState<any | null>(null)
  const seededOpened = useRef<string | null>(null)
  useEffect(() => {
    if (!seededOrderId || seededOpened.current === seededOrderId) return
    if (orderDocs === undefined) return
    seededOpened.current = seededOrderId
    setSelectedId(seededOrderId)
    if (orderDocs.some((order: any) => order.$id === seededOrderId)) return
    void getDoc(doc(firestore, 'hosts', hostId, 'orders', seededOrderId))
      .then((snapshot) => {
        if (seededOpened.current !== snapshot.id || !snapshot.exists()) return
        setSeededOrder({ ...snapshot.data(), $id: snapshot.id })
      })
      .catch(() => undefined)
  }, [seededOrderId, orderDocs, firestore, hostId])
  const [draft, setDraft] = useState<{
    productId: string
    variantId: string
    quantity: string
    email: string
    /** Destination the merchant declared, once they have been asked. */
    shipTo?: string
    /**
     * Revealed only when the server refuses for want of a destination
     * (AGL-1792). A merchant whose rates are the same everywhere — or who
     * configured none — is never asked and never sees this field.
     */
    shipCountries?: string[]
    busy?: boolean
  } | null>(null)
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  /**
   * Each order with the values the grid shows and filters by. `liftLegacyOrder`
   * names a status and channel on a row that predates them, and Product
   * reads the line items first (AGL-1747): the flat `productId` is written
   * only by the two buy-now Stripe paths.
   */
  const orderRows = useMemo(
    () =>
      orders.map((order: any) => {
        const lifted = CommerceModel.liftLegacyOrder(order)
        const dispute = CommerceModel.describeOrderDispute(lifted)
        const productIds = [
          ...new Set(
            [
              ...(lifted.lineItems ?? []).map((line) => line.productId),
              order.productId,
            ].filter((id): id is string => typeof id === 'string' && id !== ''),
          ),
        ]
        return {
          ...order,
          orderLabel: CommerceModel.formatOrderNumber(lifted, order.$id),
          itemName:
            lifted.lineItems?.[0]?.name ??
            productNames[order.productId] ??
            order.productId ??
            '',
          statusKey: lifted.status,
          channelKey: lifted.channel ?? 'online',
          netCents: CommerceModel.orderNetCents(lifted),
          disputeBadge: dispute,
          productIds,
          disputeKey: CommerceModel.orderHasOpenDispute(lifted)
            ? 'open'
            : dispute?.tone === 'lost'
              ? 'lost'
              : '',
        }
      }),
    [orders, productNames],
  )
  const productOptions = useMemo(
    () =>
      productWindow.rows.map((product: any) => ({
        value: String(product.$id),
        label: String(product.name ?? product.$id),
      })),
    [productWindow],
  )
  const filterOptions = useMemo(
    () => ({
      statusKey: ORDER_STATUS_OPTIONS,
      channelKey: ORDER_CHANNEL_OPTIONS,
      productIds: productOptions,
      disputeKey: ORDER_DISPUTE_OPTIONS,
    }),
    [productOptions],
  )
  const listFilter = useListRowsFilter({
    rows: orderRows,
    fields: ORDER_FILTER_FIELDS,
    options: filterOptions,
    headers: ORDER_FILTER_HEADERS,
    search: ORDER_SEARCH_FIELDS,
    clauses,
    onChange: setClauses,
  })
  const visibleOrders = listFilter.rows
  const showingOpenDisputes = clauses.some(
    (clause) =>
      clause.field === OPEN_DISPUTE_CLAUSE.field &&
      clause.op === OPEN_DISPUTE_CLAUSE.op &&
      clause.value === OPEN_DISPUTE_CLAUSE.value,
  )

  /**
   * Raised over EVERY loaded order, not the visible ones (AGL-1796). A
   * merchant filtered to "delivered" still has a deadline running on a `paid`
   * order, and the evidence window is days long.
   */
  const openDisputes = useMemo(
    () =>
      CommerceModel.summariseOpenDisputes(
        orders.map((order: any) => CommerceModel.liftLegacyOrder(order)),
      ),
    [orders],
  )
  /**
   * 30-day money summary with the prior 30 days behind it (AGL-2136). Over
   * the LOADED window, like every other figure on this card — the query is
   * `limit(200)`, so a store past 200 orders in 60 days is summarising a
   * slice. That is the same bound the analytics card has always had, and
   * making this one silently different would be worse than sharing it.
   */
  const summary = useMemo(
    () => CommerceModel.summarizeOrderWindow(orders, { nowMs: Date.now() }),
    [orders],
  )

  const handleExportCsv = useCallback(() => {
    // The rows themselves are built by the pure model helper (AGL-1747) so the
    // column-by-column arithmetic is unit-testable without a Firestore mock.
    const csv = CommerceModel.buildOrdersCsv(visibleOrders, productNames)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'orders.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [visibleOrders, productNames])

  /**
   * Idempotency key for ONE draft attempt (AGL-1697).
   *
   * Minted lazily on the first create click, NOT per call — two clicks (or a
   * click retried after a lost response) must present ONE key so the server
   * replays the original payment link instead of minting a second order.
   * Retired whenever a content field changes: an edited draft is a different
   * order, and replaying the old one against it would hand the merchant a
   * link priced for fields they no longer see. Answering the shipping-country
   * ask also retires it, which is safe — that refusal is served before the
   * server takes the claim, so the first key was never spent.
   */
  const draftAttemptKey = useRef('')
  useEffect(() => {
    draftAttemptKey.current = ''
  }, [
    draft?.productId,
    draft?.variantId,
    draft?.quantity,
    draft?.email,
    draft?.shipTo,
  ])

  const handleDraftCreate = useCallback(async () => {
    if (!draft?.productId) return
    setDraft((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      if (!draftAttemptKey.current) {
        draftAttemptKey.current =
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const response = await authorizedFetch(
        user,
        '/api/commerce/draft-order',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Stable across a retry of THIS attempt (AGL-1697), so a
            // double-click cannot mint two live payment links.
            'Idempotency-Key': draftAttemptKey.current,
          },
          body: JSON.stringify({
            hostId,
            productId: draft.productId,
            variantId: draft.variantId || undefined,
            quantity: Number(draft.quantity) || 1,
            email: draft.email || undefined,
            // A request, never an instruction: the server resolves the
            // rates for this country AND restricts the payment link's
            // collectable addresses to it, so declaring one cannot buy a
            // cheaper zone's rate than the address the buyer then enters
            // (AGL-1721).
            ...(draft.shipTo ? { shippingCountry: draft.shipTo } : {}),
          }),
        },
      )
      const payload = await response.json()
      if (!response.ok) {
        // The merchant's rates differ by destination, so the server will not
        // price this order until it knows one (AGL-1792). Reveal the field and
        // let them answer; a store whose rates are the same everywhere, or
        // which configured none, never sends this and never shows it.
        if (payload?.needsShippingCountry) {
          setDraft((prev) =>
            prev
              ? {
                  ...prev,
                  shipCountries: (
                    payload.shippingCountries as string[] | undefined
                  )?.length
                    ? (payload.shippingCountries as string[])
                    : [...CommerceModel.CHECKOUT_SHIPPING_COUNTRIES],
                }
              : prev,
          )
        }
        return void enqueueSnackbar(payload?.error ?? 'Draft order failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      await navigator.clipboard.writeText(payload.url).catch(() => undefined)
      enqueueSnackbar('Draft created — payment link copied', {
        variant: 'success',
        persist: false,
      })
      setDraft(null)
    } finally {
      setDraft((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [draft, user, hostId, enqueueSnackbar])

  const selectedOrder =
    (orderDocs ?? []).find((order: any) => order.$id === selectedId) ??
    (seededOrder && seededOrder.$id === selectedId ? seededOrder : null)

  /**
   * Shared by the two triggers (AGL-1805) so the empty state and the toolbar
   * cannot drift into opening the dialog with different starting fields.
   */
  const openDraft = useCallback(
    () => setDraft({ productId: '', variantId: '', quantity: '1', email: '' }),
    [],
  )

  /** What the draft dialog can actually offer. */
  const selectableProducts = useMemo(
    () => productWindow.rows.filter((product: any) => !product.deletedAt),
    [productWindow],
  )

  /*
   * The six columns `/product/commerce` advertises, in the order the mockup
   * shows them — every fact scannable on its own, Channel included.
   */
  const orderColumns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'orderLabel',
        headerName: 'Order',
        flex: 1,
        minWidth: 160,
        renderCell: ({ row }: any) => {
          const extraItems = Math.max(0, (row.lineItems?.length ?? 0) - 1)
          return (
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {row.orderLabel}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {extraItems ? `${row.itemName} +${extraItems} more` : row.itemName}
              </Typography>
            </Stack>
          )
        },
      },
      {
        field: 'customerEmail',
        headerName: 'Customer',
        flex: 1,
        minWidth: 180,
        renderCell: ({ row }: any) => (
          <Typography variant="body2" noWrap>
            {row.customerEmail || '—'}
          </Typography>
        ),
      },
      {
        field: 'channelKey',
        headerName: 'Channel',
        width: 120,
        renderCell: ({ row }: any) => (
          <Typography variant="body2">
            {CommerceModel.orderChannelLabel(row.channelKey)}
          </Typography>
        ),
      },
      {
        field: 'netCents',
        headerName: 'Total',
        type: 'number',
        width: 150,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }: any) => (
          <Stack sx={{ alignItems: 'flex-end', minWidth: 0, width: 1 }}>
            <Typography variant="body2">
              {`$${(row.netCents / 100).toFixed(2)}`}
            </Typography>
            {row.refundedCents ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {`$${((row.totals?.totalCents ?? row.amountCents ?? 0) / 100).toFixed(2)} less refunds`}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'statusKey',
        headerName: 'Status',
        width: 230,
        renderCell: ({ row }: any) => {
          // A lost chargeback leaves `status: 'refunded'` (AGL-1787), so the
          // status pill cannot tell the two apart either — which is why the
          // dispute chip sits beside it rather than being folded into it.
          const dispute: ReturnType<typeof CommerceModel.describeOrderDispute> =
            row.disputeBadge
          return (
            <Stack sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Chip
                  label={
                    CommerceModel.ORDER_STATUS_LABELS[
                      row.statusKey as CommerceModel.OrderStatus
                    ] ?? row.statusKey
                  }
                  size="small"
                  color={
                    CommerceModel.ORDER_STATUS_COLOR[
                      row.statusKey as CommerceModel.OrderStatus
                    ] ?? 'default'
                  }
                  variant="outlined"
                />
                {dispute ? (
                  <Tooltip title={dispute.detail}>
                    <Chip
                      label={dispute.label}
                      size="small"
                      color={DISPUTE_COLOR[dispute.tone]}
                      variant="filled"
                    />
                  </Tooltip>
                ) : null}
              </Stack>
              {/*
                The deadline on the row itself, while the case is open — the
                one fact on this screen that expires.
               */}
              {dispute?.evidenceDaysLeft !== undefined ? (
                <Typography
                  variant="caption"
                  component="div"
                  color={dispute.evidenceDaysLeft < 0 ? 'error' : 'warning.main'}
                >
                  {dispute.evidenceDaysLeft < 0
                    ? 'Evidence deadline passed'
                    : `Evidence due in ${dispute.evidenceDaysLeft} day${
                        dispute.evidenceDaysLeft === 1 ? '' : 's'
                      }`}
                </Typography>
              ) : null}
            </Stack>
          )
        },
      },
      {
        field: 'createdAtMs',
        headerName: 'Date',
        width: 130,
        renderCell: ({ row }: any) => {
          const createdAt =
            row.createdAt?.toDate?.() ??
            (row.createdAtMs ? new Date(row.createdAtMs) : null)
          return (
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {createdAt ? createdAt.toLocaleDateString() : '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {createdAt ? createdAt.toLocaleTimeString() : ''}
              </Typography>
            </Stack>
          )
        },
      },
    ],
    [],
  )

  return (
    <CardDisplay
      header={'Orders'}
      help={pluginDocsHelp('commerce', {
        anchor: '#orders-screen',
        excerpt:
          'Every order with its channel, status and net total. A refunded ' +
          'order shows what is left, with the gross beneath it.',
      })}
      contentGutterX
      contentGutterY
    >
      {orders.length === 0 ? (
        /*
         * An invitation, not a report (AGL-1805). The "Draft order" button
         * used to live in the other arm of this ternary, so the one state a
         * draft order exists for — no sales yet, invoice the customer you
         * already have — was the only state that could not reach it, and
         * every other route into the dialog needs an order to exist first.
         *
         * The filters stay behind deliberately: they belong to a list with
         * rows in it. Export CSV likewise — a header-only file is not
         * something a merchant on day one is looking for.
         */
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {
              'No orders yet. Storefront sales, POS sales and draft orders ' +
              'all appear here as they come in.'
            }
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {
              'Selling to someone directly? Draft their order and send them ' +
              'a payment link.'
            }
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={openDraft}
          >
            {'Draft order'}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1}>
          {showStats ? (
            <Stack
              direction="row"
              spacing={3}
              sx={{ flexWrap: 'wrap', rowGap: 1 }}
            >
              <CommerceStatTile
                label="Revenue · 30d"
                value={`$${(summary.revenueCents / 100).toFixed(2)}`}
                deltaPct={summary.revenueDeltaPct}
                deltaCaption="vs the previous 30 days"
              />
              <CommerceStatTile
                label="Orders · 30d"
                value={String(summary.orders)}
                deltaPct={summary.ordersDeltaPct}
                deltaCaption="vs the previous 30 days"
              />
              <CommerceStatTile
                label="Avg order value"
                value={`$${(summary.aovCents / 100).toFixed(2)}`}
                deltaPct={summary.aovDeltaPct}
                deltaCaption="vs the previous 30 days"
              />
            </Stack>
          ) : null}
          {openDisputes.count > 0 ? (
            <Alert
              severity={openDisputes.overdue ? 'error' : 'warning'}
              action={
                showingOpenDisputes ? undefined : (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() =>
                      setClauses(
                        upsertListFilterClause(
                          clauses,
                          OPEN_DISPUTE_CLAUSE.field,
                          OPEN_DISPUTE_CLAUSE,
                        ),
                      )
                    }
                  >
                    {'Show them'}
                  </Button>
                )
              }
            >
              <AlertTitle>
                {openDisputes.count === 1
                  ? 'A shopper has disputed a charge with their bank'
                  : `${openDisputes.count} charges are disputed with the shopper’s bank`}
              </AlertTitle>
              {openDisputes.soonestDaysLeft === undefined
                ? 'Answer in the Stripe dashboard while the case is open — an unanswered dispute is decided for the shopper.'
                : openDisputes.soonestDaysLeft < 0
                  ? 'The evidence deadline has passed on at least one of these. Stripe decides an unanswered dispute for the shopper.'
                  : `Evidence is due to Stripe in ${openDisputes.soonestDaysLeft} day${
                      openDisputes.soonestDaysLeft === 1 ? '' : 's'
                    } on the tightest of these. An unanswered dispute is decided for the shopper.`}
            </Alert>
          ) : null}
          {/*
            The buttons stay beside the grid: Export CSV writes the model's
            own order columns (`buildOrdersCsv`) for the rows the filters
            leave, which the grid's own export cannot.
           */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
          >
            <Button size="small" onClick={handleExportCsv}>
              {'Export CSV'}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={openDraft}
            >
              {'Draft order'}
            </Button>
          </Stack>
          <ListFilterChips {...listFilter.chipsProps} />
          <ListTable
            aria-label="Orders"
            rows={visibleOrders}
            columns={listFilter.filterColumns(orderColumns)}
            onOpen={(id) => setSelectedId(id)}
            {...listFilter.gridProps}
            initialState={{
              columns: { columnVisibilityModel: ORDER_HIDDEN_COLUMNS },
            }}
            noRowsLabel="No orders match these filters"
          />
          {orderWindow.truncated ? (
            /*
             * Where the filters, the search and the export stop. All run over
             * what was read, so a store past this window would otherwise see
             * a status filter return nothing and read it as having no such
             * orders.
             */
            <Typography variant="caption" color="text.secondary">
              {`Showing the ${ORDERS_WINDOW} most recent orders. Filters and Export CSV cover these.`}
            </Typography>
          ) : null}
        </Stack>
      )}
      {selectedOrder ? (
        <OrderDetailDialog
          hostId={hostId}
          order={selectedOrder}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Draft order'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Product"
            value={draft?.productId ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, productId: event.target.value, variantId: '' }
                  : prev,
              )
            }
            size="small"
            select
            sx={{ mt: 1 }}
            /*
             * The second dead end behind the first (AGL-1805): a store with
             * no orders may have no products either, and a draft order is
             * composed from one — so "Create & copy link" stays disabled. Say
             * why, rather than opening an empty menu onto nothing.
             */
            helperText={
              selectableProducts.length === 0
                ? 'Add a product to this store first — a draft order is built from one.'
                : undefined
            }
          >
            {selectableProducts.map((product: any) => (
              <MenuItem key={product.$id} value={product.$id}>
                {product.name ?? product.$id}
              </MenuItem>
            ))}
          </TextField>
          {(() => {
            const product = productWindow.rows.find(
              (item: any) => item.$id === draft?.productId,
            )
            const variants = product
              ? CommerceModel.liftLegacyProduct(product).variants
              : []
            return variants.length > 1 ? (
              <TextField
                label="Variant"
                value={draft?.variantId ?? ''}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev ? { ...prev, variantId: event.target.value } : prev,
                  )
                }
                size="small"
                select
              >
                {variants.map((variant) => (
                  <MenuItem key={variant.id} value={variant.id}>
                    {`${Object.values(variant.options ?? {}).join(' / ') || 'Default'} — $${variant.priceUsd}`}
                  </MenuItem>
                ))}
              </TextField>
            ) : null
          })()}
          <TextField
            label="Quantity"
            value={draft?.quantity ?? '1'}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      quantity: event.target.value.replace(/[^0-9]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <TextField
            label="Buyer email (optional)"
            value={draft?.email ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, email: event.target.value } : prev,
              )
            }
            size="small"
          />
          {draft?.shipCountries?.length ? (
            <TextField
              label="Ships to"
              value={draft?.shipTo ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, shipTo: event.target.value } : prev,
                )
              }
              size="small"
              select
              helperText={
                'This store’s shipping rates differ by destination, so the ' +
                'payment link has to be priced for one.'
              }
            >
              {draft.shipCountries.map((code) => (
                <MenuItem key={code} value={code}>
                  {CommerceModel.CHECKOUT_SHIPPING_COUNTRY_NAMES[code] ?? code}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !draft?.productId ||
              draft?.busy ||
              // Once asked, the answer is required: retrying without one is
              // refused again, so the button would only look broken.
              Boolean(draft?.shipCountries?.length && !draft?.shipTo)
            }
            onClick={handleDraftCreate}
          >
            {'Create & copy link'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostOrdersCard.displayName = 'HostOrdersCard'

export default HostOrdersCard
