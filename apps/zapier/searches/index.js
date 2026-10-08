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

const { apiUrl, rowsOf, seg, throwAglynError } = require('../lib/api')
const { SITE_FIELD } = require('../lib/hook-trigger')
const { orderRecord } = require('../triggers/orders')

/**
 * Searches (AGL-3643): a contact by email (`GET /v1/contacts?email=`, which
 * normalizes the address as a capture does) and an order by id. Nothing
 * found is an empty answer, which Zapier shows as "not found" and a
 * find-or-create follows with Create Contact.
 */

const findContact = {
  key: 'find_contact',
  noun: 'Contact',
  display: {
    label: 'Find Contact',
    description: 'Finds a contact by email address.',
    important: true,
  },
  operation: {
    inputFields: [{ key: 'email', label: 'Email', required: true }],
    perform: async (z, bundle) => {
      const email = String(bundle.inputData.email || '').trim()
      if (!email) return []
      const response = await z.request({ url: apiUrl('/v1/contacts'), params: { email } })
      return rowsOf(response)
    },
    sample: {
      id: 'k7d2b9f104',
      object: 'contact',
      email: 'robin@example.com',
      name: 'Robin Wholesale',
      tags: ['b2b'],
      lifecycleStage: 'lead',
    },
  },
}

const findOrder = {
  key: 'find_order',
  noun: 'Order',
  display: {
    label: 'Find Order',
    description: 'Finds an order on a site by its id.',
  },
  operation: {
    inputFields: [{ ...SITE_FIELD, helpText: 'The site whose store took the order.' }, { key: 'orderId', label: 'Order ID', required: true }],
    perform: async (z, bundle) => {
      const response = await z.request({
        url: apiUrl(`/v1/sites/${seg(bundle.inputData.siteId)}/orders/${seg(bundle.inputData.orderId)}`),
        skipThrowForStatus: true,
      })
      if (response.status === 404) return []
      if (response.status >= 400) throwAglynError(response, z)
      return [orderRecord(response.data || {}, {})]
    },
    sample: {
      id: '8Kd0zX2mQ1',
      object: 'order',
      number: 1042,
      status: 'paid',
      currency: 'usd',
      customerEmail: 'shopper@example.com',
      totals: { totalCents: 2290 },
      totalAmount: '22.90',
      refundedAmount: '0.00',
    },
  },
}

module.exports = { findContact, findOrder }
