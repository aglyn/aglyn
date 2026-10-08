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

const { apiUrl, seg } = require('../lib/api')
const { SITE_FIELD } = require('../lib/hook-trigger')
const { orderRecord } = require('../triggers/orders')

/**
 * Mark Order Shipped (AGL-3643), on `PATCH /v1/sites/{siteId}/orders/{id}`
 * — the one order write the REST API makes, under `orders:write`. It records
 * a shipment of everything still to ship, or marks the order delivered; it
 * never cancels or refunds, which move money or stock and stay in Aglyn. A
 * retry lands the same state and answers the same order.
 */
module.exports = {
  key: 'fulfill_order',
  noun: 'Order',
  display: {
    label: 'Mark Order Shipped',
    description: 'Records a shipment on an order — shipped or delivered, with the carrier and tracking number — and tells the buyer.',
    important: true,
  },
  operation: {
    inputFields: [
      { ...SITE_FIELD, helpText: 'The site whose store took the order.' },
      { key: 'orderId', label: 'Order ID', required: true, search: 'find_order.id' },
      {
        key: 'status',
        label: 'Mark As',
        required: true,
        default: 'fulfilled',
        choices: { fulfilled: 'Shipped', delivered: 'Delivered' },
      },
      { key: 'carrier', label: 'Carrier', required: false, helpText: 'e.g. UPS, USPS, FedEx, DHL. Those get a tracking link.' },
      { key: 'trackingNumber', label: 'Tracking Number', required: false },
      { key: 'trackingUrl', label: 'Tracking Link', required: false, helpText: 'An https link, for a carrier Aglyn makes no link for.' },
      {
        key: 'notify',
        label: 'Tell the Buyer',
        type: 'boolean',
        required: false,
        default: 'true',
        helpText: 'Email the buyer about the shipment.',
      },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData
      const body = { status: input.status === 'delivered' ? 'delivered' : 'fulfilled' }
      for (const key of ['carrier', 'trackingNumber', 'trackingUrl']) {
        const value = input[key] === undefined || input[key] === null ? '' : String(input[key]).trim()
        if (value) body[key] = value
      }
      if (input.notify !== undefined && input.notify !== null && input.notify !== '') {
        body.notify = !(input.notify === false || input.notify === 'false' || input.notify === 'no')
      }
      const response = await z.request({
        url: apiUrl(`/v1/sites/${seg(input.siteId)}/orders/${seg(input.orderId)}`),
        method: 'PATCH',
        body,
      })
      return orderRecord(response.data || {}, {})
    },
    sample: {
      id: '8Kd0zX2mQ1',
      object: 'order',
      number: 1042,
      status: 'fulfilled',
      currency: 'usd',
      customerEmail: 'shopper@example.com',
      totals: { totalCents: 2290 },
      totalAmount: '22.90',
      refundedAmount: '0.00',
    },
  },
}
