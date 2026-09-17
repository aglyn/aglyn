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

import type { PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { orderCountsAsSale, orderPaidCents, orderWindowFigures } from '../model/order-figures'
import { ORDER_FIGURES_WINDOW_CEILING, orderFigureReaders } from './order-figures'

/**
 * The store's sales as figure tables (AGL-2915): the Analytics tab card's
 * rules — no pending, canceled or test order is money, and a refund comes
 * off — over the window and the one before it, and never a buyer.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')
const DAY = 86_400_000
const at = (daysAgo: number) => Date.UTC(2026, 8, 16) - daysAgo * DAY + 3_600_000

type Order = Record<string, unknown> & { $id: string }

/** The orders query a reader makes: a `createdAtMs` range, newest first, bounded. */
function firestoreOf(orders: Order[]) {
  const query = (filters: Array<[string, number]>, cap = Infinity): any => ({
    where: (_field: string, op: string, value: number) => query([...filters, [op, value]], cap),
    orderBy: () => query(filters, cap),
    limit: (n: number) => query(filters, n),
    get: async () => ({
      docs: orders
        .filter((order) =>
          filters.every(([op, value]) =>
            op === '>=' ? Number(order['createdAtMs']) >= value : Number(order['createdAtMs']) < value,
          ),
        )
        .sort((a, b) => Number(b['createdAtMs']) - Number(a['createdAtMs']))
        .slice(0, cap)
        .map(({ $id, ...data }) => ({ id: $id, data: () => data })),
    }),
  })
  return { collection: () => ({ doc: () => ({ collection: () => query([]) }) }) } as unknown as FirebaseFirestore.Firestore
}

const order = (id: string, daysAgo: number, patch: Record<string, unknown> = {}): Order => ({
  $id: id,
  createdAtMs: at(daysAgo),
  status: 'paid',
  totals: { totalCents: 5_000 },
  lineItems: [{ productId: 'mug', name: 'Ceramic mug', unitAmountCents: 2_500, quantity: 2 }],
  ...patch,
})

async function read(id: string, orders: Order[], days = 7): Promise<PluginFigureTable> {
  const reader = orderFigureReaders(() => firestoreOf(orders)).find((entry) => entry.id === id)
  const result = await reader?.read({ orgId: 'org-1', hostId: 'host-1', days, now: NOW, uid: null, params: {} })
  if (!result || result.ok === false) throw new Error('no table')
  return result.table
}

describe('which orders are money', () => {
  it('leaves out pending, canceled and test orders, and takes refunds off', () => {
    expect(orderCountsAsSale(order('a', 1))).toBe(true)
    expect(orderCountsAsSale(order('b', 1, { status: 'pending' }))).toBe(false)
    expect(orderCountsAsSale(order('c', 1, { status: 'cancelled' }))).toBe(false)
    expect(orderCountsAsSale(order('cs_test_a1b2c3d4e5', 1))).toBe(false)
    expect(orderCountsAsSale(order('d', 1, { livemode: false }))).toBe(false)
    expect(orderPaidCents(order('e', 1, { refundedCents: 1_200 }))).toBe(3_800)
    expect(orderWindowFigures([order('a', 1), order('f', 1, { totals: { totalCents: 2_000 } })], 0, Date.now() + DAY)).toEqual({
      orders: 2,
      revenueCents: 7_000,
      averageCents: 3_500,
    })
  })
})

describe('the sales tables', () => {
  const orders = [
    order('a', 0),
    order('b', 2, { refundedCents: 1_000 }),
    order('c', 3, { status: 'pending' }),
    order('cs_test_zzzzzzzzzz', 3),
    order('d', 9, { totals: { totalCents: 4_000 } }),
  ]

  it('sums the window and the one before it, with the change in revenue and orders', async () => {
    const table = await read('commerce.sales', orders)
    expect(table.period).toEqual({ from: '2026-09-10', to: '2026-09-16', days: 7 })
    expect(table.rows).toEqual([
      {
        window: '2026-09-10 to 2026-09-16',
        revenue: 90,
        orders: 2,
        averageOrder: 45,
        revenueChange: 125,
        ordersChange: 100,
      },
      { window: '2026-09-03 to 2026-09-09', revenue: 40, orders: 1, averageOrder: 40, revenueChange: null, ordersChange: null },
    ])
    expect(JSON.stringify(table)).not.toMatch(/email|address|customer/i)
  })

  it('ranks products by line revenue with units sold', async () => {
    const table = await read('commerce.products', [
      ...orders,
      order('g', 1, { lineItems: [{ productId: 'kit', name: 'Pour-over kit', unitAmountCents: 5_900, quantity: 1 }] }),
    ])
    expect(table.rows).toEqual([
      { product: 'Ceramic mug', units: 4, revenue: 100 },
      { product: 'Pour-over kit', units: 1, revenue: 59 },
    ])
  })

  it('says its figures read low when a window holds more orders than it reads', async () => {
    const many = Array.from({ length: ORDER_FIGURES_WINDOW_CEILING + 1 }, (_, index) => order(`o${index}`, 1))
    const table = await read('commerce.sales', many)
    expect(table.rows[0]['orders']).toBe(ORDER_FIGURES_WINDOW_CEILING)
    expect(table.notes.join(' ')).toMatch(/read low/)
  })
})
