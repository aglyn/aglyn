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

import { firestoreDouble as double, createApiDouble } from '../testing/firestore-double'
import { salesReport, startOfLocalDay, todaySalesQuery } from './sales'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const order = (createdAtMs: number, totalCents: number, extra: Record<string, unknown> = {}) => ({
  status: 'paid',
  channel: 'online',
  createdAtMs,
  totals: { totalCents },
  lineItems: [{ productId: 'p1', name: 'Mug', quantity: 1, unitAmountCents: totalCents }],
  ...extra,
})

describe('salesReport', () => {
  const now = at(2026, 10, 6, 15)

  it('buckets whole local days and compares with the window before', () => {
    const orders = [
      order(at(2026, 10, 6, 9), 1000),
      order(at(2026, 10, 6, 1), 500, { channel: 'pos' }),
      order(at(2026, 10, 1), 2000, { refundedCents: 500 }),
      order(at(2026, 9, 28), 3000),
      order(at(2026, 10, 5), 9999, { status: 'cancelled' }),
      order(at(2026, 10, 5), 9999, { livemode: false }),
    ]
    const report = salesReport(orders, 7, now)
    expect(report.days).toHaveLength(7)
    expect(report.days[0].startMs).toBe(startOfLocalDay(at(2026, 9, 30)))
    expect(report.days[6]).toMatchObject({ orders: 2, revenueCents: 1500 })
    expect(report.current).toEqual({ orders: 3, revenueCents: 3000, averageCents: 1000 })
    expect(report.previous).toEqual({ orders: 1, revenueCents: 3000, averageCents: 3000 })
    expect(report.revenueDeltaPct).toBe(0)
    expect(report.ordersDeltaPct).toBe(200)
    expect(report.channels).toEqual([
      { channel: 'online', label: expect.any(String), revenueCents: 2500 },
      { channel: 'pos', label: expect.any(String), revenueCents: 500 },
    ])
    expect(report.topProducts[0]).toMatchObject({ productId: 'p1', units: 3 })
  })

  it('says nothing about growth from a capped read', () => {
    const report = salesReport([order(at(2026, 10, 6), 100), order(at(2026, 9, 25), 100)], 7, now, true)
    expect(report.revenueDeltaPct).toBeNull()
    expect(report.capped).toBe(true)
  })
})

describe('todaySalesQuery', () => {
  it('reads the orders since local midnight and counts what is left to ship', async () => {
    const now = at(2026, 10, 6, 15)
    double.setCollection('hosts/h1/orders', [
      { id: 'a', data: order(at(2026, 10, 6, 10), 1200) },
      { id: 'b', data: order(at(2026, 10, 6, 11), 800, { status: 'fulfilled' }) },
    ])
    const api = createApiDouble()
    const today = await todaySalesQuery({ firestore: double.db, hostId: 'h1', api: api.client, now: () => now }).queryFn()
    expect(today).toEqual({ orders: 2, revenueCents: 2000, averageCents: 1000, toFulfill: 1, capped: false })
    expect(double.queries.at(-1)!.constraints).toEqual([
      { type: 'where', path: 'createdAtMs', op: '>=', value: startOfLocalDay(now) },
      { type: 'orderBy', path: 'createdAtMs', direction: 'desc' },
      { type: 'limit', count: 501 },
    ])
  })
})
