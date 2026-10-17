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

import type { PluginFigureColumn, PluginFigureRow, PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { orderFigureReaders } from './order-figures'

function table(columns: PluginFigureColumn[], rows: PluginFigureRow[], extra: Partial<PluginFigureTable> = {}): PluginFigureTable {
  return {
    title: 'Figures',
    source: { label: 'Console', path: null },
    period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
    columns,
    rows,
    omitted: 0,
    notes: [],
    ...extra,
  }
}

describe('sales in the weekly summary (AGL-3867)', () => {
  const [sales, products] = orderFigureReaders(() => {
    throw new Error('not read')
  })

  it('tiles the week’s revenue, orders and average order, and offers orders to the totals', () => {
    const week = table(
      [
        { key: 'window', label: 'Window', kind: 'text' },
        { key: 'revenue', label: 'Revenue', kind: 'money', currency: 'USD' },
        { key: 'orders', label: 'Orders', kind: 'count' },
        { key: 'averageOrder', label: 'Average order', kind: 'money', currency: 'USD' },
        { key: 'revenueChange', label: 'Revenue change', kind: 'change' },
        { key: 'ordersChange', label: 'Orders change', kind: 'change' },
      ],
      [
        { window: 'this', revenue: 1_240, orders: 18, averageOrder: 68.89, revenueChange: 20, ordersChange: 20 },
        { window: 'before', revenue: 1_033, orders: 15, averageOrder: 68.87, revenueChange: null, ordersChange: null },
      ],
    )
    expect(sales.weeklySummary?.summarize(week)).toEqual({
      title: 'Sales',
      stats: [
        { label: 'Revenue', value: '$1,240.00', change: 20 },
        { label: 'Orders', value: '18', change: 20, total: { count: 18, one: 'order', many: 'orders' } },
        { label: 'Average order', value: '$68.89' },
      ],
    })
  })

  it('names the top products', () => {
    const top = table(
      [
        { key: 'product', label: 'Product', kind: 'text' },
        { key: 'units', label: 'Units', kind: 'count' },
      ],
      [
        { product: 'Mug', units: 12 },
        { product: 'Tee', units: 5 },
      ],
    )
    expect(products.weeklySummary?.summarize(top)).toEqual({
      title: 'Top products',
      rows: [
        { label: 'Mug', value: '12 sold' },
        { label: 'Tee', value: '5 sold' },
      ],
    })
  })
})
