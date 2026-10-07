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

import type { ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'
import { doc, type DocumentData, getDoc } from 'firebase/firestore'
import {
  OPEN_DISPUTE_CLAUSE,
  ORDER_LIST_QUERY,
  ordersCustomerClause,
} from '../../lib/constants/orders-list-query'
import { formatOrderMoney } from '../../lib/model/buyer-notifications'
import { orderDisputeBlocksRefund } from '../../lib/model/commerce-dispute'
import {
  canTransitionOrder,
  formatOrderNumber,
  type HostOrder,
  liftLegacyOrder,
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  orderCreatedAtMs,
  orderIsTestMode,
  orderLineRefundCents,
  orderNetCents,
  orderRefundState,
} from '../../lib/model/commerce-orders'
import {
  fulfillmentIsActive,
  orderFulfillmentsEditable,
  orderLineFulfillmentStates,
  remainingFulfillmentLines,
  resolveFulfillmentLines,
  describeFulfillmentLinesProblem,
  type OrderLineFulfillmentState,
} from '../../lib/model/order-fulfillment'
import { fulfillmentTrackingUrl } from '../../lib/model/tracking-url'
import { type CommerceMobileContext, newAttemptKey } from './context'
import { type ListCursor, type ListPage, planList, readListPage, searchWords } from './list-page'

/*
 * Orders on the phone (AGL-3621): the list, one order, and what can be done
 * to it — fulfill, mark delivered, refund, cancel, resend the receipt.
 *
 * The list is the console's list: `ORDER_LIST_QUERY` planned by the shared
 * planner over `hosts/{hostId}/orders`, so each status chip is a predicate on
 * the query, served by the composites `orders-list-query.spec.ts` pins. The
 * actions post to the same routes the order dialog posts to, which re-ask the
 * transition rule and the member's role under their own transaction; what
 * this file decides about an order (may it be fulfilled, what is left) is
 * only what to OFFER, from the same pure model the routes use.
 */

export const ORDERS_COLLECTION = (hostId: string) => `hosts/${hostId}/orders`

/** The status chips above the list, each a clause on the one query. */
export type OrderFilterId = 'all' | 'unfulfilled' | 'fulfilled' | 'pending' | 'returns' | 'disputes'

export interface OrderFilter {
  id: OrderFilterId
  label: string
  clauses: readonly ListFilterRequest[]
}

export const ORDER_FILTERS: readonly OrderFilter[] = [
  { id: 'all', label: 'All', clauses: [] },
  {
    id: 'unfulfilled',
    label: 'Unfulfilled',
    clauses: [{ field: 'statusKey', op: 'isAnyOf', value: 'paid,partially_fulfilled' }],
  },
  {
    id: 'fulfilled',
    label: 'Fulfilled',
    clauses: [{ field: 'statusKey', op: 'isAnyOf', value: 'fulfilled,delivered' }],
  },
  { id: 'pending', label: 'Unpaid', clauses: [{ field: 'statusKey', op: 'equals', value: 'pending' }] },
  {
    id: 'returns',
    label: 'Canceled & refunded',
    clauses: [{ field: 'statusKey', op: 'isAnyOf', value: 'cancelled,refunded' }],
  },
  { id: 'disputes', label: 'Disputes', clauses: [OPEN_DISPUTE_CLAUSE] },
]

export interface OrdersListArgs {
  filter: OrderFilterId
  /** The quick search's text: an order number or a word of the buyer's address. */
  search?: string
  /** Narrows to one buyer, as the CRM's "Orders" link does. */
  customer?: string
}

/** The request the list sends the planner. */
export function ordersListRequest(args: OrdersListArgs) {
  const filter = ORDER_FILTERS.find((entry) => entry.id === args.filter) ?? ORDER_FILTERS[0]
  const customer = args.customer ? ordersCustomerClause(args.customer) : null
  return {
    clauses: [...filter.clauses, ...(customer ? [customer] : [])],
    search: searchWords(args.search ?? ''),
  }
}

/** One row of the list, everything a row shows, worked out once. */
export interface OrderRow {
  id: string
  label: string
  status: HostOrder['status']
  statusLabel: string
  channelLabel: string
  customer: string
  itemCount: number
  netCents: number
  createdAtMs: number
  testMode: boolean
  disputeOpen: boolean
}

export function orderRow(id: string, data: DocumentData): OrderRow {
  const order = liftLegacyOrder(data as Partial<HostOrder>)
  const lines = order.lineItems ?? []
  return {
    id,
    label: formatOrderNumber(order, id),
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    channelLabel: ORDER_CHANNEL_LABELS[order.channel ?? 'online'] ?? 'Online',
    customer: order.customerName || order.customerEmail || order.customerPhone || 'Guest',
    itemCount: lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0), 0),
    netCents: orderNetCents(order),
    createdAtMs: orderCreatedAtMs(data as never),
    testMode: orderIsTestMode({ ...order, $id: id, livemode: (data as { livemode?: unknown }).livemode }),
    disputeOpen: (data as { disputeKey?: string }).disputeKey === 'open',
  }
}

export const commerceKeys = {
  all: (hostId: string) => ['commerce', hostId] as const,
  orders: (hostId: string) => ['commerce', hostId, 'orders'] as const,
  ordersList: (hostId: string, args: OrdersListArgs) =>
    ['commerce', hostId, 'orders', 'list', args.filter, args.search ?? '', args.customer ?? ''] as const,
  order: (hostId: string, orderId: string) => ['commerce', hostId, 'orders', 'one', orderId] as const,
  store: (hostId: string) => ['commerce', hostId, 'store'] as const,
  products: (hostId: string) => ['commerce', hostId, 'products'] as const,
  sales: (hostId: string) => ['commerce', hostId, 'sales'] as const,
}

/** The list as an infinite query: `useInfiniteQuery(ordersListQuery(context, args))`. */
export function ordersListQuery(context: CommerceMobileContext, args: OrdersListArgs) {
  const plan = planList(ORDER_LIST_QUERY, ordersListRequest(args))
  return {
    queryKey: commerceKeys.ordersList(context.hostId, args),
    initialPageParam: null as ListCursor,
    queryFn: ({ pageParam }: { pageParam: ListCursor }): Promise<ListPage<OrderRow>> =>
      readListPage({
        firestore: context.firestore,
        path: ORDERS_COLLECTION(context.hostId),
        plan,
        cursor: pageParam,
        map: orderRow,
      }),
    getNextPageParam: (page: ListPage<OrderRow>): ListCursor | undefined => page.next ?? undefined,
  }
}

/** The store's own settings a screen needs: its currency. */
export interface StoreSettings {
  currency: string
}

export function storeSettingsQuery(context: CommerceMobileContext) {
  return {
    queryKey: commerceKeys.store(context.hostId),
    queryFn: async (): Promise<StoreSettings> => {
      const snapshot = await getDoc(doc(context.firestore, `hosts/${context.hostId}/settings/store`))
      const currency = String(snapshot.data()?.['currency'] ?? '') || 'USD'
      return { currency }
    },
    staleTime: 5 * 60_000,
  }
}

export const money = (cents: number, settings?: StoreSettings | null): string =>
  formatOrderMoney(cents, settings?.currency ?? 'USD')

/** One order, with what its screen may offer. */
export interface OrderDetail {
  id: string
  label: string
  order: HostOrder
  testMode: boolean
  lines: OrderLineFulfillmentState[]
  /** Shipments still on the order, newest first, each with its tracking link. */
  shipments: Array<{
    id: string
    carrier: string
    trackingNumber: string
    trackingUrl: string | null
    labelUrl: string | null
    atMs: number
    summary: string
    editable: boolean
  }>
  refundState: 'none' | 'partial' | 'full'
  refundableCents: number
  actions: OrderActions
}

export interface OrderActions {
  fulfill: boolean
  markDelivered: boolean
  refund: boolean
  cancel: boolean
  resendReceipt: boolean
}

/** What the order's screen offers. The routes re-ask every one of these. */
export function orderActions(order: HostOrder): OrderActions {
  const remaining = remainingFulfillmentLines(order).length > 0
  const refundable = Math.max(0, orderNetCents(order)) > 0 && order.status !== 'pending'
  return {
    fulfill:
      remaining &&
      (canTransitionOrder(order.status, 'fulfilled') ||
        canTransitionOrder(order.status, 'partially_fulfilled')),
    markDelivered: canTransitionOrder(order.status, 'delivered'),
    refund: refundable && canTransitionOrder(order.status, 'refunded') && !orderDisputeBlocksRefund(order),
    cancel: canTransitionOrder(order.status, 'cancelled'),
    resendReceipt: order.status !== 'pending' && Boolean(order.customerEmail || order.customerPhone),
  }
}

export function orderDetail(id: string, data: DocumentData): OrderDetail {
  const order = liftLegacyOrder(data as Partial<HostOrder>)
  const editable = orderFulfillmentsEditable(order)
  const shipments = (order.fulfillments ?? [])
    .filter(fulfillmentIsActive)
    .map((fulfillment) => ({
      id: fulfillment.id,
      carrier: fulfillment.carrier ?? '',
      trackingNumber: fulfillment.trackingNumber ?? '',
      trackingUrl: fulfillmentTrackingUrl(fulfillment),
      labelUrl: fulfillment.labelUrl?.startsWith('https://') ? fulfillment.labelUrl : null,
      atMs: fulfillment.atMs,
      summary: (fulfillment.lines?.length
        ? fulfillment.lines
        : fulfillment.lineItemIds.map((lineItemId) => ({
            lineItemId,
            quantity: order.lineItems?.[lineItemId]?.quantity ?? 1,
          }))
      )
        .map((line) => `${line.quantity}× ${order.lineItems?.[line.lineItemId]?.name ?? 'Item'}`)
        .join(', '),
      editable,
    }))
    .sort((a, b) => b.atMs - a.atMs)
  return {
    id,
    label: formatOrderNumber(order, id),
    order,
    testMode: orderIsTestMode({ ...order, $id: id, livemode: (data as { livemode?: unknown }).livemode }),
    lines: orderLineFulfillmentStates(order),
    shipments,
    refundState: orderRefundState(order),
    refundableCents: Math.max(0, orderNetCents(order)),
    actions: orderActions(order),
  }
}

export function orderQuery(context: CommerceMobileContext, orderId: string) {
  return {
    queryKey: commerceKeys.order(context.hostId, orderId),
    queryFn: async (): Promise<OrderDetail | null> => {
      const snapshot = await getDoc(doc(context.firestore, ORDERS_COLLECTION(context.hostId), orderId))
      return snapshot.exists() ? orderDetail(snapshot.id, snapshot.data()) : null
    },
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export interface FulfillInput {
  orderId: string
  /** Units per line; absent ships everything still to ship. */
  lines?: ReadonlyArray<{ lineItemId: number; quantity: number }>
  carrier?: string
  trackingNumber?: string
  /** A label the shipping plugin bought for this parcel. */
  labelUrl?: string
  trackingUrl?: string
  /** Tell the buyer. Default on, as in the console. */
  notify?: boolean
  /** One attempt's key; a retry of the same sheet sends it again. */
  attemptKey: string
}

export interface FulfillResult {
  ok: true
  already?: boolean
  status?: HostOrder['status']
}

/**
 * Checks a shipment against the order before it is sent, with the same rule
 * the route applies, so the sheet can say what is wrong without a round trip.
 */
export function checkFulfillLines(
  order: HostOrder,
  lines: ReadonlyArray<{ lineItemId: number; quantity: number }>,
): string | null {
  const resolved = resolveFulfillmentLines(order, lines.filter((line) => line.quantity > 0))
  return 'lines' in resolved ? null : describeFulfillmentLinesProblem(resolved)
}

export function fulfillOrder(context: CommerceMobileContext, input: FulfillInput): Promise<FulfillResult> {
  return context.api.request<FulfillResult>('commerce/fulfill-order', {
    method: 'POST',
    idempotencyKey: input.attemptKey,
    body: {
      hostId: context.hostId,
      orderId: input.orderId,
      to: 'fulfilled',
      ...(input.lines ? { lineItems: input.lines.filter((line) => line.quantity > 0) } : {}),
      ...(input.carrier ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
      ...(input.trackingUrl ? { trackingUrl: input.trackingUrl } : {}),
      ...(input.labelUrl ? { labelUrl: input.labelUrl } : {}),
      ...(input.notify === false ? { notify: false } : {}),
    },
  })
}

export function markOrderDelivered(context: CommerceMobileContext, orderId: string): Promise<FulfillResult> {
  return context.api.request<FulfillResult>('commerce/fulfill-order', {
    method: 'POST',
    body: { hostId: context.hostId, orderId, to: 'delivered' },
  })
}

export function updateShipmentTracking(
  context: CommerceMobileContext,
  input: { orderId: string; fulfillmentId: string; carrier: string; trackingNumber: string },
): Promise<FulfillResult> {
  return context.api.request<FulfillResult>('commerce/fulfill-order', {
    method: 'POST',
    body: {
      hostId: context.hostId,
      orderId: input.orderId,
      action: 'update-tracking',
      fulfillmentId: input.fulfillmentId,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
    },
  })
}

export function cancelShipment(
  context: CommerceMobileContext,
  input: { orderId: string; fulfillmentId: string },
): Promise<FulfillResult> {
  return context.api.request<FulfillResult>('commerce/fulfill-order', {
    method: 'POST',
    body: {
      hostId: context.hostId,
      orderId: input.orderId,
      action: 'cancel-fulfillment',
      fulfillmentId: input.fulfillmentId,
    },
  })
}

export interface RefundInput {
  orderId: string
  /** Null refunds everything still refundable. */
  amountCents: number | null
  /** Lines refunded by name, whose digital entitlements come back. */
  lineItemIds?: readonly number[]
  attemptKey: string
}

/**
 * The amount a refund sheet proposes for the chosen lines: what those goods
 * cost after their share of the discount, capped at what is left to refund.
 */
export function proposedRefundCents(detail: Pick<OrderDetail, 'order' | 'refundableCents'>, lineItemIds: readonly number[]): number {
  if (!lineItemIds.length) return detail.refundableCents
  return Math.min(detail.refundableCents, orderLineRefundCents(detail.order, lineItemIds))
}

/**
 * Why a refund amount cannot be sent, or null. Named lines set a floor: the
 * route refuses an amount below what those lines are worth.
 */
export function checkRefundAmount(
  amountCents: number,
  refundableCents: number,
  namedLines?: { order: HostOrder; lineItemIds: readonly number[] },
): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 'Enter an amount above zero'
  if (amountCents > refundableCents) return 'That is more than is left to refund'
  if (namedLines?.lineItemIds.length && amountCents < orderLineRefundCents(namedLines.order, namedLines.lineItemIds)) {
    return 'That is less than the items you picked are worth'
  }
  return null
}

export function refundOrder(context: CommerceMobileContext, input: RefundInput): Promise<{ ok: true }> {
  return context.api.request('commerce/refund', {
    method: 'POST',
    idempotencyKey: input.attemptKey,
    body: {
      hostId: context.hostId,
      orderId: input.orderId,
      ...(input.amountCents == null ? {} : { amountCents: input.amountCents }),
      ...(input.lineItemIds?.length ? { lineItemIds: [...input.lineItemIds] } : {}),
    },
  })
}

export function cancelOrder(context: CommerceMobileContext, orderId: string): Promise<{ ok: true }> {
  return context.api.request('commerce/cancel-order', {
    method: 'POST',
    body: { hostId: context.hostId, orderId },
  })
}

export { newAttemptKey }
