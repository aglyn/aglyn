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
  PLUGIN_FIGURE_MAX_ROWS,
  pluginFigureChange,
  pluginFigureWindows,
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  orderWindowFigures,
  productSales,
  type OrderFigureSource,
} from '../model/order-figures'

/**
 * The store's sales figures for another plugin to read (AGL-2915): what the
 * Analytics tab's card shows, as tables on the `plugin-figures` seam. The
 * insight job reads them by id and never reads an order.
 *
 * A table carries sums and counts and product names — never a buyer, an
 * address or an order. Sold under `commerceAnalytics`, the entitlement the
 * card is sold under.
 */

type Firestore = FirebaseFirestore.Firestore

/** Orders one window reads; a store past it is told its figures read low. */
export const ORDER_FIGURES_WINDOW_CEILING = 1_000

const WINDOWS: readonly number[] = [7, 14, 30, 90]

const SOURCE = { label: 'Store analytics', path: 'products/analytics' }

async function ordersBetween(
  firestore: Firestore,
  hostId: string,
  startMs: number,
  endMs: number,
): Promise<{ orders: OrderFigureSource[]; truncated: boolean }> {
  // `createdAtMs` is the field every order writer stamps and the one the
  // orders group is indexed on; range and order on it need no composite index.
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .where('createdAtMs', '>=', startMs)
    .where('createdAtMs', '<', endMs)
    .orderBy('createdAtMs', 'desc')
    .limit(ORDER_FIGURES_WINDOW_CEILING + 1)
    .get()
  const orders = snapshot.docs.map((doc) => ({ ...(doc.data() ?? {}), $id: doc.id }) as OrderFigureSource)
  return {
    orders: orders.slice(0, ORDER_FIGURES_WINDOW_CEILING),
    truncated: orders.length > ORDER_FIGURES_WINDOW_CEILING,
  }
}

const dollars = (cents: number): number => Math.round(cents) / 100

function ceilingNote(truncated: boolean): string[] {
  return truncated
    ? [
        `The store took more than ${ORDER_FIGURES_WINDOW_CEILING.toLocaleString('en-US')} orders in a window, so its figures are summed over the most recent ${ORDER_FIGURES_WINDOW_CEILING.toLocaleString('en-US')} and read low.`,
      ]
    : []
}

function refusal(request: PluginFigureRequest) {
  if (!request.hostId) return { ok: false as const, status: 400 as const, error: 'Open a site to read its sales' }
  if (!WINDOWS.includes(request.days)) {
    return { ok: false as const, status: 400 as const, error: 'That window is not one sales are read over' }
  }
  return null
}

export function orderFigureReaders(firestore: () => Firestore): PluginFigureReader[] {
  return [
    {
      id: 'commerce.sales',
      label: 'Sales',
      description:
        'The store’s revenue, orders and average order over the window and the window before it, with the change in revenue and in orders. Pending, canceled and test orders are left out, and refunds come off.',
      scope: 'site',
      windows: WINDOWS,
      feature: 'commerceAnalytics',
      read: async (request) => {
        const refused = refusal(request)
        if (refused) return refused
        const hostId = request.hostId as string
        const { current, previous } = pluginFigureWindows(request.now, request.days)
        const [now, before] = await Promise.all([
          ordersBetween(firestore(), hostId, current.startMs, current.endMs),
          ordersBetween(firestore(), hostId, previous.startMs, previous.endMs),
        ])
        const a = orderWindowFigures(now.orders, current.startMs, current.endMs)
        const b = orderWindowFigures(before.orders, previous.startMs, previous.endMs)
        return {
          ok: true,
          table: {
            title: 'Sales',
            source: SOURCE,
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'window', label: 'Window', kind: 'text' },
              { key: 'revenue', label: 'Revenue', kind: 'money', currency: 'USD' },
              { key: 'orders', label: 'Orders', kind: 'count' },
              { key: 'averageOrder', label: 'Average order', kind: 'money', currency: 'USD' },
              { key: 'revenueChange', label: 'Revenue change', kind: 'change' },
              { key: 'ordersChange', label: 'Orders change', kind: 'change' },
            ],
            rows: [
              {
                window: `${current.from} to ${current.to}`,
                revenue: dollars(a.revenueCents),
                orders: a.orders,
                averageOrder: dollars(a.averageCents),
                revenueChange: pluginFigureChange(a.revenueCents, b.revenueCents),
                ordersChange: pluginFigureChange(a.orders, b.orders),
              },
              {
                window: `${previous.from} to ${previous.to}`,
                revenue: dollars(b.revenueCents),
                orders: b.orders,
                averageOrder: dollars(b.averageCents),
                revenueChange: null,
                ordersChange: null,
              },
            ],
            omitted: 0,
            notes: ceilingNote(now.truncated || before.truncated),
          },
        }
      },
    },
    {
      id: 'commerce.products',
      label: 'Top products',
      description: 'The products that brought in the most over the window, with units sold and line revenue.',
      scope: 'site',
      windows: WINDOWS,
      feature: 'commerceAnalytics',
      read: async (request) => {
        const refused = refusal(request)
        if (refused) return refused
        const { current } = pluginFigureWindows(request.now, request.days)
        const window = await ordersBetween(firestore(), request.hostId as string, current.startMs, current.endMs)
        const sales = productSales(window.orders)
        return {
          ok: true,
          table: {
            title: 'Top products',
            source: SOURCE,
            period: { from: current.from, to: current.to, days: request.days },
            columns: [
              { key: 'product', label: 'Product', kind: 'text' },
              { key: 'units', label: 'Units', kind: 'count' },
              { key: 'revenue', label: 'Line revenue', kind: 'money', currency: 'USD' },
            ],
            rows: sales
              .slice(0, PLUGIN_FIGURE_MAX_ROWS)
              .map((entry) => ({ product: entry.name, units: entry.units, revenue: dollars(entry.cents) })),
            omitted: Math.max(0, sales.length - PLUGIN_FIGURE_MAX_ROWS),
            notes: [
              'Line revenue is each line’s price times its quantity, before discounts, shipping and tax.',
              ...ceilingNote(window.truncated),
            ],
          },
        }
      },
    },
  ]
}

/** Registers the sales readers from the console surface, where insight jobs run. */
export function registerOrderFigureReaders(firestore: () => Firestore): void {
  for (const reader of orderFigureReaders(firestore)) {
    registerPluginFigureReader(reader, { pluginId: BUNDLE_ID })
  }
}
