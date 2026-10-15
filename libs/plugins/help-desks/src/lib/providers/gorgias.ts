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
import { accountApiBase, basicAuthorization, isProviderError, ProviderError, providerRequest, type ProviderHttp } from './http'
import { e164OrNull, toAmount, type HelpDeskCredential, type HelpDeskProvider } from './provider'

/**
 * Gorgias, through its REST API with a private app's credential (AGL-3824):
 * HTTP Basic with the account's REST API username (an email address) and
 * API key, at `https://{domain}.gorgias.com/api`. An API key is held to 40
 * requests per 20 seconds, answered past that with a 429 and `Retry-after`,
 * which the one HTTP door honors.
 * https://developers.gorgias.com/reference/limitations
 *
 * - **Customers:** found by email, added with an email channel, renamed
 *   when the site's name for them changes.
 * - **Orders:** the buyer's recent orders as the customer's data, which
 *   Gorgias replaces whole on each write — so every write carries the recent
 *   orders, not only the newest.
 * - **Tickets:** a contact form message opens a ticket from the customer,
 *   on the API channel, its submission id as the ticket's external id.
 */

const PROVIDER = 'Gorgias'
/** The REST API, served from the account's own subdomain of this host. */
const GORGIAS_API = 'https://gorgias.com/api'
/** The customer data resource under a customer, an API path segment. */
const CUSTOMER_DATA = 'data'

function headers(credential: HelpDeskCredential): Record<string, string> {
  if (!credential.login) throw new ProviderError('auth', 'This Gorgias connection has no username. Connect again.')
  return {
    Authorization: basicAuthorization(credential.login, credential.token),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/** One order as the customer's data holds it. */
function orderData(order: HelpDeskOrder) {
  return {
    number: order.number ?? order.id,
    date: new Date(order.createdAtMs).toISOString(),
    status: orderStatusLabel(order.status),
    total: formatMoney(order.totalCents, order.currency),
    total_amount: toAmount(order.totalCents),
    currency: order.currency,
    refunded_amount: toAmount(order.refundedCents),
    items: orderItemsLine(order, 10),
    url: order.url,
  }
}

export function createGorgiasProvider(http: ProviderHttp): HelpDeskProvider {
  const call = (credential: HelpDeskCredential, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    providerRequest(http, {
      provider: PROVIDER,
      method,
      url: `${accountApiBase(GORGIAS_API, credential.account, PROVIDER)}${path}`,
      headers: headers(credential),
      body,
    })

  // https://developers.gorgias.com/reference/list-customers
  const findByEmail = async (credential: HelpDeskCredential, email: string): Promise<string | null> => {
    const answer = await call(credential, 'GET', `/customers?${new URLSearchParams({ email, limit: '1' }).toString()}`)
    const rows = Array.isArray(answer) ? answer : Array.isArray(answer?.data) ? answer.data : []
    const id = rows[0]?.id
    return id === undefined || id === null ? null : String(id)
  }

  // https://developers.gorgias.com/reference/update-customer
  const rename = (credential: HelpDeskCredential, id: string, name: string) =>
    call(credential, 'PUT', `/customers/${encodeURIComponent(id)}`, { name })

  return {
    id: 'gorgias',

    // https://developers.gorgias.com/reference/get-account
    async verify(credential) {
      const account = await call(credential, 'GET', '/account')
      return { accountName: typeof account?.domain === 'string' ? account.domain : credential.account, targets: [] }
    },

    async upsertCustomer(credential, customer, known) {
      if (known) {
        try {
          if (customer.name) await rename(credential, known, customer.name)
          return { remoteId: known }
        } catch (error) {
          // Merged or deleted there: find them again by address.
          if (!(isProviderError(error) && error.status === 404)) throw error
        }
      }
      const found = await findByEmail(credential, customer.email)
      if (found) {
        if (customer.name) await rename(credential, found, customer.name)
        return { remoteId: found }
      }
      const phone = e164OrNull(customer.phone)
      // https://developers.gorgias.com/reference/create-customer
      const created = await call(credential, 'POST', '/customers', {
        email: customer.email,
        name: customer.name,
        channels: [
          { type: 'email', address: customer.email, preferred: true },
          ...(phone ? [{ type: 'phone', address: phone, preferred: false }] : []),
        ],
      })
      if (created?.id === undefined || created?.id === null) {
        throw new ProviderError('invalid', 'Gorgias did not return the new customer')
      }
      return { remoteId: String(created.id) }
    },

    // https://developers.gorgias.com/reference/update-customer-data
    async pushOrder(credential, input) {
      const latest = input.recent[0] ?? input.order
      await call(credential, 'PUT', `/customers/${encodeURIComponent(input.remoteId)}/${CUSTOMER_DATA}`, {
        data: {
          source: input.source,
          last_order: orderOneLine(latest),
          last_order_url: latest.url,
          orders: input.recent.map(orderData),
        },
        version: new Date().toISOString(),
      })
    },

    // https://developers.gorgias.com/reference/create-ticket
    async createTicket(credential, input) {
      const { ticket } = input
      const numeric = /^\d+$/.test(input.remoteId) ? Number(input.remoteId) : null
      await call(credential, 'POST', '/tickets', {
        customer: numeric !== null ? { id: numeric } : { email: ticket.email, name: ticket.name },
        channel: 'api',
        via: 'api',
        subject: ticket.subject.slice(0, 998),
        external_id: ticket.id.slice(0, 255),
        messages: [
          {
            channel: 'api',
            via: 'api',
            from_agent: false,
            sender: { email: ticket.email, ...(ticket.name ? { name: ticket.name } : {}) },
            subject: ticket.subject.slice(0, 998),
            body_text: ticket.body,
            external_id: ticket.id.slice(0, 255),
          },
        ],
      })
    },
  }
}
