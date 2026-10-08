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

'use strict'

const { apiUrl, decimalAmount, rowsOf, seg } = require('../lib/api')
const { hookTrigger } = require('../lib/hook-trigger')

/**
 * Order triggers (AGL-3643), on commerce's order events. Each row is the
 * order as `GET /v1/sites/{siteId}/orders/{orderId}` returns it, with the
 * total and refund as decimal money beside the cents, and what happened.
 * Needs `orders:read` and commerce on the plan.
 */

const UPDATE_CHOICES = {
  'order.fulfilled': 'Shipped (each shipment)',
  'order.delivered': 'Delivered',
  'order.refunded': 'Refunded (each refund)',
  'order.cancelled': 'Canceled',
}

const EVENT_BY_STATUS = {
  fulfilled: 'order.fulfilled',
  partially_fulfilled: 'order.fulfilled',
  delivered: 'order.delivered',
  refunded: 'order.refunded',
  cancelled: 'order.cancelled',
}

/** One order as a row: the API's order, money as decimals, and the event. */
function orderRecord(order, extra) {
  const totals = order.totals || {}
  return {
    ...order,
    totalAmount: decimalAmount(totals.totalCents, order.currency),
    refundedAmount: decimalAmount(order.refundedCents, order.currency),
    ...extra,
  }
}

async function listOrders(z, bundle, params) {
  const response = await z.request({
    url: apiUrl(`/v1/sites/${seg(bundle.inputData.siteId)}/orders`),
    params: { limit: 3, ...params },
  })
  return rowsOf(response)
}

const ORDER_SAMPLE = {
  id: '8Kd0zX2mQ1',
  object: 'order',
  number: 1042,
  status: 'paid',
  channel: 'online',
  currency: 'usd',
  customerEmail: 'shopper@example.com',
  customerName: 'Avery Chen',
  lineItems: [
    { productId: 'p_sourdough', variantId: 'v_large', name: 'Sourdough', variantLabel: 'Large', sku: 'SD-L', quantity: 2, unitAmountCents: 900 },
  ],
  totals: { itemsCents: 1800, shippingCents: 500, taxCents: 190, discountCents: 200, totalCents: 2290, feeCents: 45 },
  refundedCents: 0,
  shippingAddress: { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  created: '2026-10-07T18:22:10.000Z',
  totalAmount: '22.90',
  refundedAmount: '0.00',
  event: 'order.paid',
  eventId: 'evt_sample',
}

const ORDER_OUTPUT_FIELDS = [
  { key: 'id', label: 'Order ID' },
  { key: 'number', label: 'Order Number', type: 'integer' },
  { key: 'status', label: 'Status' },
  { key: 'customerEmail', label: 'Customer Email' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'currency', label: 'Currency' },
  { key: 'totalAmount', label: 'Total' },
  { key: 'totals__totalCents', label: 'Total (cents)', type: 'integer' },
  { key: 'refundedAmount', label: 'Refunded' },
  { key: 'event', label: 'Event' },
]

const newPaidOrder = hookTrigger({
  key: 'new_paid_order',
  noun: 'Order',
  label: 'New Paid Order',
  description:
    'Triggers when an order is paid: a storefront checkout, a buy-now, a payment link, a sale at the register, or a subscription renewal.',
  important: true,
  events: ['order.paid'],
  toRecords: async (z, bundle, body) => [orderRecord(body.data.order, { event: body.type, eventId: body.id })],
  list: async (z, bundle) =>
    (await listOrders(z, bundle, { status: 'paid' })).map((order) => orderRecord(order, { event: 'order.paid', eventId: null })),
  sample: ORDER_SAMPLE,
  outputFields: ORDER_OUTPUT_FIELDS,
})

const updatedOrder = hookTrigger({
  key: 'updated_order',
  noun: 'Order',
  label: 'Updated Order',
  description: 'Triggers when an order is shipped, delivered, refunded or canceled.',
  events: Object.keys(UPDATE_CHOICES),
  choices: UPDATE_CHOICES,
  toRecords: async (z, bundle, body) => [
    orderRecord(body.data.order, {
      event: body.type,
      eventId: body.id,
      fulfillment: body.data.fulfillment || null,
      refund: body.data.refund || null,
    }),
  ],
  list: async (z, bundle) =>
    (await listOrders(z, bundle, {})).map((order) =>
      orderRecord(order, {
        event: EVENT_BY_STATUS[order.status] || 'order.fulfilled',
        eventId: null,
        fulfillment: null,
        refund: null,
      }),
    ),
  sample: {
    ...ORDER_SAMPLE,
    status: 'fulfilled',
    event: 'order.fulfilled',
    fulfillment: {
      id: 'ful_1',
      lines: [{ lineItemId: 0, quantity: 2 }],
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      trackingUrl: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
      labelUrl: null,
      at: '2026-10-08T15:00:00.000Z',
    },
    refund: null,
  },
  outputFields: [
    ...ORDER_OUTPUT_FIELDS,
    { key: 'fulfillment__carrier', label: 'Shipment Carrier' },
    { key: 'fulfillment__trackingNumber', label: 'Shipment Tracking Number' },
    { key: 'fulfillment__trackingUrl', label: 'Shipment Tracking Link' },
    { key: 'refund__amountCents', label: 'Refund (cents)', type: 'integer' },
  ],
})

module.exports = { newPaidOrder, updatedOrder, orderRecord }
