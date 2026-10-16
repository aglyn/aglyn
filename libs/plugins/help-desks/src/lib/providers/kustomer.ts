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
  formatMoney,
  orderItemsLine,
  orderOneLine,
  orderStatusLabel,
  type HelpDeskOrder,
} from '../model/orders'
import { isProviderError, ProviderError, providerRequest, type ProviderHttp } from './http'
import { e164OrNull, toAmount, type HelpDeskCredential, type HelpDeskProvider } from './provider'

/**
 * Kustomer, through its REST API with an API key an admin creates under
 * Settings → Security → API Keys, as a Bearer token at
 * `https://api.kustomerapp.com/v1` (AGL-3824).
 * https://developer.kustomer.com/kustomer-api-docs/reference/getting-started-with-kustomer-api
 *
 * - **Customers:** found by email, added when Kustomer has none. A
 *   customer Kustomer already holds is left as it is: its update replaces
 *   the company link unless it is sent again, and the site does not know it.
 * - **Orders:** one custom object (KObject) per order, of the Klass the
 *   merchant picked, linked to the customer and keyed by the order's id, so
 *   a later state of the order updates the same object.
 * - **Conversations:** a contact form message is recorded as an inbound
 *   email message on the customer, which opens a new conversation.
 */

const PROVIDER = 'Kustomer'
const KUSTOMER_API = 'https://api.kustomerapp.com/v1'

function headers(credential: HelpDeskCredential): Record<string, string> {
  return {
    Authorization: `Bearer ${credential.token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/** The platform's name as the `app` a message is recorded from: plain lower-case letters. */
export const kustomerAppName = (source: string): string =>
  source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'website'

/** One order as its custom object carries it. */
function orderObject(order: HelpDeskOrder) {
  return {
    externalId: order.id.slice(0, 256),
    title: `Order ${order.number ?? order.id}`.slice(0, 256),
    description: `${orderOneLine(order)}\n${orderItemsLine(order, 20)}`.slice(0, 10240),
    data: {
      number: order.number ?? order.id,
      status: orderStatusLabel(order.status),
      total: formatMoney(order.totalCents, order.currency),
      totalAmount: toAmount(order.totalCents),
      currency: order.currency,
      refundedAmount: toAmount(order.refundedCents),
      items: order.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        price: toAmount(item.unitCents),
      })),
      url: order.url,
    },
    createdAt: new Date(order.createdAtMs).toISOString(),
  }
}

export function createKustomerProvider(http: ProviderHttp): HelpDeskProvider {
  const call = (credential: HelpDeskCredential, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    providerRequest(http, { provider: PROVIDER, method, url: `${KUSTOMER_API}${path}`, headers: headers(credential), body })

  const notFound = (error: unknown) => isProviderError(error) && error.status === 404

  return {
    id: 'kustomer',

    // https://developer.kustomer.com/kustomer-api-docs/reference/getklasses
    async verify(credential) {
      const answer = await call(credential, 'GET', '/klasses?pageSize=100')
      const rows: any[] = Array.isArray(answer?.data) ? answer.data : []
      const targets = rows
        .map((row) => row?.attributes ?? {})
        .filter((attributes) => typeof attributes.name === 'string' && attributes.name)
        .map((attributes) => ({
          id: String(attributes.name),
          name: String(attributes.displayName ?? attributes.displayname ?? attributes.name),
        }))
      return { accountName: null, targets }
    },

    async upsertCustomer(credential, customer, known) {
      if (known) return { remoteId: known }
      try {
        // https://developer.kustomer.com/kustomer-api-docs/reference/getcustomerbyemail
        const found = await call(credential, 'GET', `/customers/email=${encodeURIComponent(customer.email)}`)
        if (typeof found?.data?.id === 'string') return { remoteId: found.data.id }
      } catch (error) {
        if (!notFound(error)) throw error
      }
      const phone = e164OrNull(customer.phone)
      // https://developer.kustomer.com/kustomer-api-docs/reference/createacustomer
      const created = await call(credential, 'POST', '/customers', {
        ...(customer.name ? { name: customer.name.slice(0, 256) } : {}),
        emails: [{ type: 'home', email: customer.email }],
        ...(phone ? { phones: [{ type: 'mobile', phone }] } : {}),
      })
      if (typeof created?.data?.id !== 'string') throw new ProviderError('invalid', 'Kustomer did not return the new customer')
      return { remoteId: created.data.id }
    },

    async pushOrder(credential, input) {
      if (!input.targetId) throw new ProviderError('invalid', 'Choose the Kustomer custom object orders go into')
      const klass = encodeURIComponent(input.targetId)
      const body = orderObject(input.order)
      let existing: string | null = null
      try {
        // https://developer.kustomer.com/kustomer-api-docs/reference/getkobjectbyexternalid
        const found = await call(credential, 'GET', `/klasses/${klass}/externalId=${encodeURIComponent(body.externalId)}`)
        existing = typeof found?.data?.id === 'string' ? found.data.id : null
      } catch (error) {
        if (!notFound(error)) throw error
      }
      if (existing) {
        // https://developer.kustomer.com/kustomer-api-docs/reference/updatekobject
        await call(credential, 'PUT', `/klasses/${klass}/${encodeURIComponent(existing)}`, body)
        return
      }
      // https://developer.kustomer.com/kustomer-api-docs/reference/createcustomerkobject
      await call(credential, 'POST', `/customers/${encodeURIComponent(input.remoteId)}/klasses/${klass}`, body)
    },

    // https://developer.kustomer.com/kustomer-api-docs/reference/createamessagebycustomer
    async createTicket(credential, input) {
      const { ticket } = input
      await call(credential, 'POST', `/customers/${encodeURIComponent(input.remoteId)}/messages`, {
        channel: 'email',
        app: kustomerAppName(input.source),
        direction: 'in',
        status: 'received',
        subject: ticket.subject.slice(0, 256),
        preview: ticket.body.slice(0, 10240),
        externalId: ticket.id.slice(0, 256),
      })
    },
  }
}
