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

import { liftLegacyOrder, orderIsTestMode } from './commerce-orders'

/**
 * Which orders are money, and how much each is (AGL-327, AGL-2915).
 *
 * The rules the Analytics tab's card and the insight readers both sum by, in
 * one place: a pending or canceled order is not money, a rehearsal checkout is
 * not revenue, and a refund comes off what an order brought in.
 */

/** An order as a figure reads it: the stored document with its id. */
export type OrderFigureSource = Record<string, unknown> & { $id?: string; createdAtMs?: number }

/** Whether an order counts toward sales figures at all. */
export function orderCountsAsSale(order: OrderFigureSource): boolean {
  const lifted = liftLegacyOrder(order as never) as unknown as Record<string, unknown>
  return (
    !['pending', 'cancelled'].includes(String(lifted['status'] ?? '')) &&
    !orderIsTestMode({ ...lifted, $id: order.$id } as never)
  )
}

/** What an order brought in, in cents: its total less what was refunded. */
export function orderPaidCents(order: OrderFigureSource): number {
  const lifted = liftLegacyOrder(order as never) as unknown as {
    totals?: { totalCents?: number }
    amountCents?: number
    refundedCents?: number
  }
  return (lifted.totals?.totalCents ?? lifted.amountCents ?? 0) - (lifted.refundedCents ?? 0)
}

export interface OrderWindowFigures {
  orders: number
  revenueCents: number
  /** Revenue over orders, rounded to the cent; 0 with no orders. */
  averageCents: number
}

/** The sales figures of the orders placed in `[startMs, endMs)`. */
export function orderWindowFigures(
  orders: readonly OrderFigureSource[],
  startMs: number,
  endMs: number,
): OrderWindowFigures {
  const counted = orders.filter((order) => {
    const at = Number(order.createdAtMs)
    return Number.isFinite(at) && at >= startMs && at < endMs && orderCountsAsSale(order)
  })
  const revenueCents = counted.reduce((sum, order) => sum + orderPaidCents(order), 0)
  return {
    orders: counted.length,
    revenueCents,
    averageCents: counted.length ? Math.round(revenueCents / counted.length) : 0,
  }
}

export interface ProductSales {
  productId: string
  name: string
  units: number
  cents: number
}

/** Each product's units and line revenue across counted orders, largest revenue first. */
export function productSales(orders: readonly OrderFigureSource[]): ProductSales[] {
  const byProduct = new Map<string, ProductSales>()
  for (const order of orders) {
    if (!orderCountsAsSale(order)) continue
    const lines = (order['lineItems'] ?? []) as Array<Record<string, unknown>>
    for (const line of lines) {
      const productId = String(line['productId'] ?? '')
      if (!productId) continue
      const quantity = Number(line['quantity'] ?? 0)
      const unit = Number(line['unitAmountCents'] ?? 0)
      const entry = byProduct.get(productId) ?? {
        productId,
        name: String(line['name'] ?? productId),
        units: 0,
        cents: 0,
      }
      entry.units += Number.isFinite(quantity) ? quantity : 0
      entry.cents += Number.isFinite(unit) && Number.isFinite(quantity) ? unit * quantity : 0
      byProduct.set(productId, entry)
    }
  }
  return [...byProduct.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
}
