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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { hiddenFilterVisibility } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type ListFilterClause,
  listFilterGridColumns,
  upsertListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { checkEntitlement, pluginDocsHelp } from '@aglyn/aglyn'
import { ORDERS_CUSTOMER_PARAM, ORDERS_ORDER_PARAM } from '../../model/commerce-record-routes'
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
import {
  collection,
  doc,
  getDoc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
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
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { useTransferLauncher } from '@aglyn/aglyn/app-utils/transfer-launcher-context'
import { commerceListFilter } from '../../transfer/list-filter'
import { COMMERCE_ORDERS_TRANSFER } from '../../transfer/transfer-keys'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

import {
  OPEN_DISPUTE_CLAUSE,
  ORDER_CHANNEL_OPTIONS,
  ORDER_DISPUTE_OPTIONS,
  ORDER_LIST_FIELDS,
  ORDER_LIST_HEADERS,
  ORDER_LIST_QUERY,
  ORDER_LIST_SELECT_FIELDS,
  ORDER_STATUS_OPTIONS,
  ordersCustomerClause,
} from '../../constants/orders-list-query'
import CommerceStatTile from './commerce-stat-tile.component'
import { bulkFulfillOrders, BULK_FULFILLABLE_STATUSES, describeBulkFulfill } from './bulk-fulfill'
import OrderDetailDialog, {
  DISPUTE_COLOR,
} from './order-detail-dialog.component'

/**
 * The products the card reads to NAME a legacy row and the CSV, to offer the
 * Product filter's choices and to fill the draft dialog's picker. A picker's
 * reach, not the list's: the orders themselves are paged by their query and
 * the Product filter asks it for any product id, named here or not.
 */
const PRODUCT_NAME_WINDOW = 100

/**
 * How many open disputes the banner reads. Its own query, `disputeKey ==
 * 'open'`, so a deadline is raised whatever the list is filtered to and
 * however deep in the store the order sits; a store past this many open
 * cases is told "more than".
 */
const OPEN_DISPUTE_CEILING = 50

/**
 * The money tiles read the last sixty days (thirty, and the thirty before it)
 * on their own bounded query. They are analytics over a period, not a filter
 * over the list, and share the analytics card's bound.
 */
const STATS_WINDOW_MS = 60 * 24 * 60 * 60 * 1000
const STATS_ORDER_CEILING = 500

/** The columns the grid draws; every other declared field is a hidden filter column. */
const ORDER_VISIBLE_COLUMNS = [
  'orderLabel',
  'customerEmail',
  'channelKey',
  'statusKey',
  'createdAtMs',
]
const ORDER_HIDDEN_COLUMNS = hiddenFilterVisibility(
  ORDER_LIST_FIELDS,
  ORDER_VISIBLE_COLUMNS,
)

export interface HostOrdersCardProps {
  hostId: string
}

/**
 * Orders console (AGL-287): filterable list over webhook-written order
 * docs with a detail dialog (timeline, fulfill, refund, cancel, notes,
 * packing slip) and draft orders that send the buyer a payment link.
 *
 * ## Every filter and the search are on the query (AGL-3321)
 *
 * The list used to read the newest two hundred orders and match its Filters
 * panel and search over them, so a Status filter on a busy store answered
 * "none" about every order past the two hundredth. Now each clause and the
 * search word are predicates on ONE Firestore query (`ORDER_LIST_QUERY`),
 * over the fields every writer stamps (`orderListFields`), and the footer
 * pages that query's answer. A combination one query cannot hold is refused
 * by name above the grid and never applied to some rows only.
 */
export function HostOrdersCard(props: HostOrdersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const ordersRef = useMemo(
    () => collection(firestore, 'hosts', hostId, 'orders'),
    [firestore, hostId],
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

  /*
   * The grid's clauses (AGL-96, AGL-3317), held here so two things outside
   * the grid can set one: the CRM's contact page links with the buyer's
   * address to answer "what has this customer ordered" (AGL-2622) — a whole
   * address is that buyer, a domain every buyer at a company
   * (`ordersCustomerClause`) — and the dispute banner's "Show them".
   */
  const searchParams = useSearchParams()
  const [clauses, setClauses] = useState<ListFilterClause[]>(() => {
    const customer = ordersCustomerClause(
      searchParams?.get(ORDERS_CUSTOMER_PARAM) ?? '',
    )
    return customer ? [customer] : []
  })
  const gridFilter = useListGridFilter({
    clauses,
    onChange: setClauses,
    selectFields: ORDER_LIST_SELECT_FIELDS,
  })
  const filtering =
    clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())

  /*
   * The open disputes, on their OWN query (AGL-1796). Raised whatever the
   * list is filtered to — a merchant filtered to "delivered" still has a
   * deadline running on a `paid` order, and the evidence window is days —
   * and however far back the order is. Asked before the list so the list's
   * plan is the one a spec reads last.
   */
  const {
    rows: disputedRows,
    hasMore: moreDisputes,
  } = useListQuery<any>({
    collection: ordersRef,
    declaration: ORDER_LIST_QUERY,
    request: { clauses: [OPEN_DISPUTE_CLAUSE] },
    deps: [firestore, hostId],
    idField: '$id',
    pageSize: OPEN_DISPUTE_CEILING,
    // A dispute that closes leaves this query; confirm it before believing it.
    confirmDisappearances: true,
  })

  /*
   * THE LIST: every clause and the search word on one query, newest first,
   * paged by the footer. A status, a dispute or a paid draft's address can
   * move an order out of the filtered query mid-session, so a disappearance
   * is confirmed against the server before it is believed (AGL-1196).
   */
  const {
    rows: orders,
    data: loadedOrders,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
    status: listStatus,
  } = useListQuery<any>({
    collection: ordersRef,
    declaration: ORDER_LIST_QUERY,
    request: { clauses, search: gridFilter.searchWords },
    deps: [firestore, hostId],
    idField: '$id',
    confirmDisappearances: true,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Rows ticked for a bulk act (AGL-3611); the row click still opens one.
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  /*
   * An order named in the URL opens in its dialog on arrival (AGL-2622). A
   * contact's timeline names the order that made the person a customer,
   * and the address it links to is this list with `?order={id}`. The list
   * shows one page, and an order from last year is not on it, so the
   * document is read once by id and held beside the page for the dialog; an
   * order that IS loaded is found there first and the read is skipped. Once
   * per id — the ref keeps a re-render from reopening a dialog the merchant
   * has since closed — and the landing read is judged against the ref
   * rather than an effect cleanup, because the `setSelectedId` above
   * re-renders before the read lands and a cleanup keyed on any dep would
   * cancel the answer to the question just asked.
   */
  const seededOrderId = searchParams?.get(ORDERS_ORDER_PARAM) ?? null
  const [seededOrder, setSeededOrder] = useState<any | null>(null)
  const seededOpened = useRef<string | null>(null)
  useEffect(() => {
    if (!seededOrderId || seededOpened.current === seededOrderId) return
    if (listStatus === 'loading') return
    seededOpened.current = seededOrderId
    setSelectedId(seededOrderId)
    if (loadedOrders.some((order: any) => order.$id === seededOrderId)) return
    void getDoc(doc(firestore, 'hosts', hostId, 'orders', seededOrderId))
      .then((snapshot) => {
        if (seededOpened.current !== snapshot.id || !snapshot.exists()) return
        setSeededOrder({ ...snapshot.data(), $id: snapshot.id })
      })
      .catch(() => undefined)
  }, [seededOrderId, loadedOrders, listStatus, firestore, hostId])
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
   * Each order on the page with the values the grid DRAWS. What it filters
   * by is on the query; this is presentation only. `liftLegacyOrder` names
   * a status and channel on a row that predates them, and the item name
   * reads the line items first (AGL-1747): the flat `productId` is written
   * only by the two buy-now Stripe paths.
   */
  const orderRows = useMemo(
    () =>
      orders.map((order: any) => {
        const lifted = CommerceModel.liftLegacyOrder(order)
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
          disputeBadge: CommerceModel.describeOrderDispute(lifted),
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
  const refused = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: ORDER_LIST_FIELDS,
        headers: ORDER_LIST_HEADERS,
        options: filterOptions,
      }),
    [plan, filterOptions],
  )
  const showingOpenDisputes = clauses.some(
    (clause) =>
      clause.field === OPEN_DISPUTE_CLAUSE.field &&
      clause.op === OPEN_DISPUTE_CLAUSE.op &&
      clause.value === OPEN_DISPUTE_CLAUSE.value,
  )

  const openDisputes = useMemo(
    () =>
      CommerceModel.summariseOpenDisputes(
        disputedRows.map((order: any) => CommerceModel.liftLegacyOrder(order)),
      ),
    [disputedRows],
  )

  /*
   * 30-day money summary with the prior 30 days behind it (AGL-2136).
   * ANALYTICS, NOT A FILTER: the tiles describe a period, not the list, so
   * they keep their own bounded read — sixty days by `createdAtMs`, the
   * newest `STATS_ORDER_CEILING` of them, read only when the tiles show.
   * Range and order are the same field, so it needs no composite.
   */
  const statsSince = useMemo(() => Date.now() - STATS_WINDOW_MS, [])
  const { data: statsDocs } = useFirestoreCollection<any>(
    () =>
      showStats
        ? query(
            ordersRef,
            where('createdAtMs', '>=', statsSince),
            orderBy('createdAtMs', 'desc'),
            limit(STATS_ORDER_CEILING + 1),
          )
        : null,
    [firestore, hostId, showStats, statsSince],
    { idField: '$id' },
  )
  const statsWindow = useMemo(
    () => ceilingedWindow<any>(statsDocs ?? undefined, STATS_ORDER_CEILING),
    [statsDocs],
  )
  const summary = useMemo(
    () =>
      CommerceModel.summarizeOrderWindow(statsWindow.rows, { nowMs: Date.now() }),
    [statsWindow],
  )

  /**
   * Export (AGL-3531) opens the console's export dialog on the
   * `commerce.orders` resource: the fields the person picks, for what the
   * QUERY matches — every clause and the search the grid is showing, not the
   * page on screen — read and streamed on the server however many orders
   * match. Orders are exported only; there is no Import.
   */
  const transfer = useTransferLauncher()
  const openExport = useCallback(() => {
    transfer?.openExport({
      resource: COMMERCE_ORDERS_TRANSFER,
      scope: 'host',
      hostId,
      ...(filtering
        ? {
            filter: {
              label: 'the orders the list’s filters and search find',
              value: commerceListFilter(plan),
            },
          }
        : {}),
    })
  }, [transfer, hostId, filtering, plan])

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

  /*
   * Bulk "Mark as fulfilled" (AGL-3611): one route call per ticked order, so
   * each gets its own transition check. Only paid and partially fulfilled
   * rows count; the button says how many.
   */
  const checkedOrders = useMemo(
    () => orderRows.filter((row: any) => checkedIds.includes(String(row.$id))),
    [orderRows, checkedIds],
  )
  const fulfillableCount = checkedOrders.filter((row: any) =>
    BULK_FULFILLABLE_STATUSES.includes(String(row.status)),
  ).length
  const handleBulkFulfill = useCallback(async () => {
    if (!checkedOrders.length) return
    setBulkBusy(true)
    try {
      const batchKey =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const result = await bulkFulfillOrders(user, hostId, checkedOrders as any[], batchKey)
      enqueueSnackbar(describeBulkFulfill(result), {
        variant: result.unknown.length ? 'error' : result.refused.length ? 'warning' : 'success',
        allowDuplicate: true,
      })
      if (!result.unknown.length) setCheckedIds([])
    } finally {
      setBulkBusy(false)
    }
  }, [checkedOrders, user, hostId, enqueueSnackbar])

  const selectedOrder =
    loadedOrders.find((order: any) => order.$id === selectedId) ??
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


  const columns = useMemo(
    () =>
      listFilterGridColumns(
        orderColumns,
        ORDER_LIST_FIELDS,
        filterOptions,
        ORDER_LIST_HEADERS,
      ),
    [orderColumns, filterOptions],
  )

  /*
   * The store is empty only when an UNFILTERED first page came back empty; a
   * filter or search that matches nothing keeps the grid, its chips and its
   * panel, so the reader can take the filter back off.
   */
  const empty =
    listStatus === 'success' && !filtering && page === 0 && orders.length === 0

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
      {empty ? (
        /*
         * An invitation, not a report (AGL-1805). The "Draft order" button
         * used to live in the other arm of this ternary, so the one state a
         * draft order exists for — no sales yet, invoice the customer you
         * already have — was the only state that could not reach it, and
         * every other route into the dialog needs an order to exist first.
         *
         * The filters stay behind deliberately: they belong to a list with
         * rows in it. Export orders likewise — a header-only file is not
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
          {showStats && statsWindow.truncated ? (
            <Typography variant="caption" color="text.secondary">
              {`Figures count the ${STATS_ORDER_CEILING} most recent orders of the last 60 days.`}
            </Typography>
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
                {moreDisputes
                  ? `More than ${OPEN_DISPUTE_CEILING} charges are disputed with the shopper’s bank`
                  : openDisputes.count === 1
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
            The buttons stay beside the grid: Export orders writes every order
            the query matches, with the fields the person picks, which the grid's
            own export — one page — cannot.
           */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
          >
            {checkedIds.length ? (
              <Button
                size="small"
                variant="outlined"
                disabled={bulkBusy || fulfillableCount === 0}
                onClick={handleBulkFulfill}
              >
                {`Mark as fulfilled (${fulfillableCount})`}
              </Button>
            ) : null}
            {/* Only for whom the route takes it (AGL-3554). */}
            {transfer?.can('export', { resource: COMMERCE_ORDERS_TRANSFER, scope: 'host', hostId }) ? (
              <Button size="small" onClick={openExport}>
                {'Export orders'}
              </Button>
            ) : null}
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={openDraft}
            >
              {'Draft order'}
            </Button>
          </Stack>
          <ListFilterChips
            fields={ORDER_LIST_FIELDS}
            headers={ORDER_LIST_HEADERS}
            clauses={clauses}
            onChange={setClauses}
            options={filterOptions}
          />
          <ListQueryNotices refused={refused} notices={plan.notices} />
          <ListTable
            aria-label="Orders"
            rows={orderRows}
            columns={columns}
            onOpen={(id) => setSelectedId(id)}
            selectable={{ selected: checkedIds, onChange: setCheckedIds }}
            loading={listStatus === 'loading'}
            /*
             * The grid must NOT also filter, search or sort: the query
             * answers all three, and the list has one order — newest first —
             * which the query already holds.
             */
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            quickFilter
            sortingMode="server"
            disableColumnSorting
            // `ListPagination` below pages the query.
            hideFooter
            initialState={{
              columns: { columnVisibilityModel: ORDER_HIDDEN_COLUMNS },
            }}
            noRowsLabel="No orders match these filters"
          />
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={orderRows.length}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
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
