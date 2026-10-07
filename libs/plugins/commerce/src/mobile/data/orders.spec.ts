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

import { ORDER_LIST_QUERY } from '../../lib/constants/orders-list-query'
import { createApiDouble, firestoreDouble as double } from '../testing/firestore-double'
import { planList } from './list-page'
import {
  checkFulfillLines,
  checkRefundAmount,
  fulfillOrder,
  ORDER_FILTERS,
  orderActions,
  orderDetail,
  orderQuery,
  orderRow,
  ordersListQuery,
  ordersListRequest,
  proposedRefundCents,
  refundOrder,
} from './orders'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

const paidOrder = {
  number: 1042,
  status: 'paid',
  channel: 'online',
  customerEmail: 'ada@example.com',
  lineItems: [
    { productId: 'p1', name: 'Mug', quantity: 2, unitAmountCents: 1500, productType: 'physical' },
    { productId: 'p2', name: 'E-book', quantity: 1, unitAmountCents: 1000, productType: 'digital' },
  ],
  totals: { itemsCents: 4000, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 4500, feeCents: 0 },
  createdAtMs: 1_700_000_000_000,
}

describe('the orders list', () => {
  it.each(ORDER_FILTERS.map((filter) => [filter.id]))('puts the %s chip on the query, refusing nothing', (id) => {
    const plan = planList(ORDER_LIST_QUERY, ordersListRequest({ filter: id as never, search: '1042' }))
    expect(plan.refused).toEqual([])
    expect(plan.orderBy).toEqual({ path: 'createdAtMs', direction: 'desc', column: 'createdAtMs' })
  })

  it('asks Firestore for the chip, newest first, one row past the page', async () => {
    double.setCollection(
      'hosts/h1/orders',
      Array.from({ length: 30 }, (_, index) => ({ id: `o${index}`, data: { ...paidOrder, number: index } })),
    )
    const api = createApiDouble()
    const options = ordersListQuery({ firestore: double.db, hostId: 'h1', api: api.client }, { filter: 'unfulfilled' })
    const page = await options.queryFn({ pageParam: null })
    const asked = double.queries.at(-1)!
    expect(asked.path).toBe('hosts/h1/orders')
    expect(asked.constraints).toEqual([
      { type: 'where', path: 'status', op: 'in', value: ['paid', 'partially_fulfilled'] },
      { type: 'orderBy', path: 'createdAtMs', direction: 'desc' },
      { type: 'limit', count: 26 },
    ])
    expect(page.rows).toHaveLength(25)
    expect(page.next).not.toBeNull()
    const second = await options.queryFn({ pageParam: page.next })
    expect(second.rows.map((row) => row.id)).toEqual(['o25', 'o26', 'o27', 'o28', 'o29'])
    expect(second.next).toBeNull()
    expect(options.getNextPageParam(second)).toBeUndefined()
  })

  it('narrows to one buyer by whole address', () => {
    expect(ordersListRequest({ filter: 'all', customer: 'ada@example.com' }).clauses).toEqual([
      { field: 'customerEmail', op: 'equals', value: 'ada@example.com' },
    ])
  })

  it('reads a row once', () => {
    const row = orderRow('cs_test_abc', paidOrder)
    expect(row).toMatchObject({
      label: '#1042',
      statusLabel: expect.any(String),
      customer: 'ada@example.com',
      itemCount: 3,
      netCents: 4500,
      testMode: true,
    })
  })
})

describe('one order', () => {
  it('offers fulfill, refund and cancel on a paid order', () => {
    expect(orderActions(paidOrder as never)).toEqual({
      fulfill: true,
      markDelivered: false,
      refund: true,
      cancel: true,
      resendReceipt: true,
    })
  })

  it('offers nothing to fulfill once every shippable unit has shipped', () => {
    const shipped = {
      ...paidOrder,
      status: 'fulfilled',
      fulfillments: [{ id: 'f1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], atMs: 1, carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }],
    }
    const detail = orderDetail('o1', shipped)
    expect(detail.actions).toMatchObject({ fulfill: false, markDelivered: true, cancel: false })
    expect(detail.shipments[0]).toMatchObject({
      summary: '2× Mug',
      trackingUrl: expect.stringContaining('1Z999AA10123456784'),
    })
  })

  it('offers neither refund nor receipt on an unpaid order', () => {
    expect(orderActions({ ...paidOrder, status: 'pending' } as never)).toMatchObject({ refund: false, resendReceipt: false })
  })

  it('reads the order document', async () => {
    double.setDoc('hosts/h1/orders/o9', paidOrder)
    const api = createApiDouble()
    const detail = await orderQuery({ firestore: double.db, hostId: 'h1', api: api.client }, 'o9').queryFn()
    expect(detail?.label).toBe('#1042')
    expect(await orderQuery({ firestore: double.db, hostId: 'h1', api: api.client }, 'nope').queryFn()).toBeNull()
  })
})

describe('fulfilling', () => {
  it('checks the units against what is left, as the route does', () => {
    expect(checkFulfillLines(paidOrder as never, [{ lineItemId: 0, quantity: 2 }])).toBeNull()
    expect(checkFulfillLines(paidOrder as never, [{ lineItemId: 0, quantity: 3 }])).toMatch(/only 2 left/)
    expect(checkFulfillLines(paidOrder as never, [{ lineItemId: 0, quantity: 0 }])).toMatch(/at least one/)
  })

  it('posts to the fulfill route with the attempt key', async () => {
    const api = createApiDouble()
    await fulfillOrder(
      { firestore: double.db, hostId: 'h1', api: api.client },
      {
        orderId: 'o1',
        lines: [{ lineItemId: 0, quantity: 1 }, { lineItemId: 1, quantity: 0 }],
        carrier: 'UPS',
        trackingNumber: '1Z999AA10123456784',
        notify: false,
        attemptKey: 'fulfill:1',
      },
    )
    expect(api.calls).toEqual([
      {
        path: 'commerce/fulfill-order',
        init: {
          method: 'POST',
          idempotencyKey: 'fulfill:1',
          body: {
            hostId: 'h1',
            orderId: 'o1',
            to: 'fulfilled',
            lineItems: [{ lineItemId: 0, quantity: 1 }],
            carrier: 'UPS',
            trackingNumber: '1Z999AA10123456784',
            notify: false,
          },
        },
      },
    ])
  })
})

describe('refunding', () => {
  const detail = orderDetail('o1', { ...paidOrder, refundedCents: 1000 })

  it('proposes the chosen lines, capped at what is left', () => {
    expect(detail.refundableCents).toBe(3500)
    expect(proposedRefundCents(detail, [])).toBe(3500)
    expect(proposedRefundCents(detail, [1])).toBe(1000)
    expect(proposedRefundCents(detail, [0, 1])).toBe(3500)
  })

  it('refuses an amount past the balance or below a cent', () => {
    expect(checkRefundAmount(3600, 3500)).toMatch(/more than/)
    expect(checkRefundAmount(0, 3500)).toMatch(/above zero/)
    expect(checkRefundAmount(10.5, 3500)).toMatch(/above zero/)
    expect(checkRefundAmount(3500, 3500)).toBeNull()
  })

  it('posts integer cents and the lines with the attempt key', async () => {
    const api = createApiDouble()
    await refundOrder(
      { firestore: double.db, hostId: 'h1', api: api.client },
      { orderId: 'o1', amountCents: 1000, lineItemIds: [1], attemptKey: 'refund:1' },
    )
    expect(api.calls[0]).toEqual({
      path: 'commerce/refund',
      init: {
        method: 'POST',
        idempotencyKey: 'refund:1',
        body: { hostId: 'h1', orderId: 'o1', amountCents: 1000, lineItemIds: [1] },
      },
    })
  })
})
