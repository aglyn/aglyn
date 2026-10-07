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

import {
  collection,
  type DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import {
  type OrderFigureSource,
  orderCountsAsSale,
  orderPaidCents,
  orderWindowFigures,
  type OrderWindowFigures,
  productSales,
  type ProductSales,
} from '../../lib/model/order-figures'
import { ORDER_CHANNEL_LABELS, type OrderChannel } from '../../lib/model/commerce-orders'
import { type CommerceMobileContext, nowOf } from './context'
import { commerceKeys, ORDERS_COLLECTION } from './orders'

/*
 * The store's sales, for the dashboard widget and the Sales screen (AGL-3621).
 *
 * Read the way the console's analytics card reads them: the orders placed
 * since a moment, by `createdAtMs` — one range, ordered by the same field, so
 * the `createdAtMs` override serves it with no composite — and summed by the
 * model's own rules (`order-figures.ts`): a pending or canceled order is not
 * money, a rehearsal checkout is not revenue, and a refund comes off.
 *
 * A window is read up to a ceiling. Past it the figures would be a sample
 * presented as a total, so the result says it was capped and the screen says
 * so rather than printing a number that is quietly short.
 */

export const SALES_ORDER_CEILING = 500

const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight of the day `atMs` falls on: the merchant's day, on their phone. */
export function startOfLocalDay(atMs: number): number {
  const day = new Date(atMs)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

async function ordersSince(
  context: CommerceMobileContext,
  sinceMs: number,
): Promise<{ orders: OrderFigureSource[]; capped: boolean }> {
  const snapshot = await getDocs(
    query(
      collection(context.firestore, ORDERS_COLLECTION(context.hostId)),
      where('createdAtMs', '>=', sinceMs),
      orderBy('createdAtMs', 'desc'),
      limit(SALES_ORDER_CEILING + 1),
    ),
  )
  const docs = snapshot.docs.slice(0, SALES_ORDER_CEILING)
  return {
    orders: docs.map((entry) => ({ ...(entry.data() as DocumentData), $id: entry.id })),
    capped: snapshot.docs.length > SALES_ORDER_CEILING,
  }
}

export interface TodaySales extends OrderWindowFigures {
  /** Orders still waiting to ship today: paid or partly shipped. */
  toFulfill: number
  capped: boolean
}

/** Today's sales and orders, for the dashboard widget. */
export function todaySalesQuery(context: CommerceMobileContext) {
  return {
    queryKey: [...commerceKeys.sales(context.hostId), 'today'] as const,
    queryFn: async (): Promise<TodaySales> => {
      const now = nowOf(context)
      const start = startOfLocalDay(now)
      const { orders, capped } = await ordersSince(context, start)
      return {
        ...orderWindowFigures(orders, start, now + 1),
        toFulfill: orders.filter((order) =>
          ['paid', 'partially_fulfilled'].includes(String(order['status'] ?? '')),
        ).length,
        capped,
      }
    },
    staleTime: 60_000,
  }
}

export type SalesRange = 7 | 30

export interface SalesDay {
  /** Local midnight. */
  startMs: number
  orders: number
  revenueCents: number
}

export interface SalesReport {
  range: SalesRange
  current: OrderWindowFigures
  previous: OrderWindowFigures
  /** Percent change against the window before; null with no baseline. */
  revenueDeltaPct: number | null
  ordersDeltaPct: number | null
  days: SalesDay[]
  channels: Array<{ channel: string; label: string; revenueCents: number }>
  topProducts: ProductSales[]
  capped: boolean
}

const deltaPct = (current: number, previous: number): number | null =>
  previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null

/** The figures for a window of whole local days ending today. Pure, for specs. */
export function salesReport(orders: readonly OrderFigureSource[], range: SalesRange, nowMs: number, capped = false): SalesReport {
  const todayStart = startOfLocalDay(nowMs)
  const days: SalesDay[] = []
  for (let index = range - 1; index >= 0; index -= 1) {
    // Step by calendar day, not by 24h, so a daylight-saving change does not skew a bucket.
    const date = new Date(todayStart)
    date.setDate(date.getDate() - index)
    days.push({ startMs: date.getTime(), orders: 0, revenueCents: 0 })
  }
  const windowStart = days[0].startMs
  const previousStartDate = new Date(windowStart)
  previousStartDate.setDate(previousStartDate.getDate() - range)
  const previousStart = previousStartDate.getTime()
  const current = orderWindowFigures(orders, windowStart, nowMs + 1)
  const previous = orderWindowFigures(orders, previousStart, windowStart)
  const inWindow = orders.filter((order) => Number(order.createdAtMs) >= windowStart && orderCountsAsSale(order))
  const channels = new Map<string, number>()
  for (const order of inWindow) {
    const at = Number(order.createdAtMs)
    let bucket: SalesDay | undefined
    for (const day of days) if (at >= day.startMs) bucket = day
    if (bucket) {
      bucket.orders += 1
      bucket.revenueCents += orderPaidCents(order)
    }
    const channel = String(order['channel'] ?? 'online')
    channels.set(channel, (channels.get(channel) ?? 0) + orderPaidCents(order))
  }
  return {
    range,
    current,
    previous,
    // A capped read drops the OLDEST orders first — the window before — so a
    // comparison against it would overstate the growth.
    revenueDeltaPct: capped ? null : deltaPct(current.revenueCents, previous.revenueCents),
    ordersDeltaPct: capped ? null : deltaPct(current.orders, previous.orders),
    days,
    channels: [...channels.entries()]
      .map(([channel, revenueCents]) => ({
        channel,
        label: ORDER_CHANNEL_LABELS[channel as OrderChannel] ?? channel,
        revenueCents,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    topProducts: productSales(inWindow).slice(0, 5),
    capped,
  }
}

/** The Sales screen: this window against the one before it. */
export function salesReportQuery(context: CommerceMobileContext, range: SalesRange) {
  return {
    queryKey: [...commerceKeys.sales(context.hostId), 'report', range] as const,
    queryFn: async (): Promise<SalesReport> => {
      const now = nowOf(context)
      const since = startOfLocalDay(now) - (range * 2 + 1) * DAY_MS
      const { orders, capped } = await ordersSince(context, since)
      return salesReport(orders, range, now, capped)
    },
    staleTime: 60_000,
  }
}
