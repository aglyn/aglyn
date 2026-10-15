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

import { isProviderError, ProviderError, providerRequest, type ProviderHttp } from './http'
import { e164OrNull, splitName, toAmount, type HelpDeskCredential, type HelpDeskProvider } from './provider'

/**
 * Richpanel, through its REST API (AGL-3824): the merchant's API key in the
 * `x-richpanel-key` header, at `https://api.richpanel.com/v1`, with the
 * store's app client id (Settings → Connected Apps) addressing its order API.
 * https://developer.richpanel.com/reference/authentication
 *
 * - **Customers:** created or updated by email in one call.
 * - **Orders:** each order into the customer's order history, keyed by the
 *   order's id, so a later state of the order replaces the earlier one.
 * - **Tickets:** a contact form message opens an email ticket from the
 *   customer to the merchant's support address.
 *
 * Richpanel documents no endpoint that answers "who am I", so a credential
 * is checked by reading a customer by address: a key Richpanel refuses is a
 * 401 or 403, and any other answer means the key was accepted.
 */

const PROVIDER = 'Richpanel'
const RICHPANEL_API = 'https://api.richpanel.com/v1'

/** The address the credential check reads; no such customer is expected. */
const PROBE_EMAIL = 'connection-check@example.com'

function headers(credential: HelpDeskCredential): Record<string, string> {
  return {
    'x-richpanel-key': credential.token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export function createRichpanelProvider(http: ProviderHttp): HelpDeskProvider {
  const call = (credential: HelpDeskCredential, method: 'GET' | 'POST', path: string, body?: unknown) =>
    providerRequest(http, { provider: PROVIDER, method, url: `${RICHPANEL_API}${path}`, headers: headers(credential), body })

  const appClientId = (credential: HelpDeskCredential): string => {
    if (!credential.appClientId) throw new ProviderError('auth', 'This Richpanel connection has no app client ID. Connect again.')
    return credential.appClientId
  }

  return {
    id: 'richpanel',

    // https://developer.richpanel.com/reference/fetch-a-customer-from-email-or-phone
    async verify(credential) {
      try {
        await call(credential, 'GET', `/customers/email/${encodeURIComponent(PROBE_EMAIL)}`)
      } catch (error) {
        if (!(isProviderError(error) && error.kind === 'invalid')) throw error
      }
      return { accountName: null, targets: [] }
    },

    // https://developer.richpanel.com/reference/create-a-customer
    async upsertCustomer(credential, customer) {
      const phone = e164OrNull(customer.phone)
      await call(credential, 'POST', '/customers', {
        customer: {
          appClientId: appClientId(credential),
          email: customer.email,
          ...(customer.name ? { name: customer.name } : {}),
          ...(phone ? { phone } : {}),
        },
      })
      return { remoteId: customer.email }
    },

    // https://developer.richpanel.com/reference/create-an-order
    // https://developer.richpanel.com/reference/the-order-object
    async pushOrder(credential, input) {
      const { order, customer } = input
      const { firstName, lastName } = splitName(customer.name)
      await call(credential, 'POST', `/order/${encodeURIComponent(appClientId(credential))}`, {
        orders: [
          {
            event: 'order',
            properties: {
              orderId: order.number ?? order.id,
              amount: toAmount(order.totalCents),
              currency: order.currency,
              status: order.status,
              createdAt: new Date(order.createdAtMs).toISOString(),
              items: order.items.map((item, index) => ({
                id: item.productId ?? item.sku ?? `${order.id}-${index + 1}`,
                name: item.name,
                sku: item.sku ?? '',
                price: toAmount(item.unitCents),
                quantity: item.quantity,
              })),
            },
            user_properties: {
              email: customer.email,
              ...(firstName ? { firstName } : {}),
              ...(lastName ? { lastName } : {}),
            },
            time: { sentAt: new Date().toISOString() },
          },
        ],
      })
    },

    // https://developer.richpanel.com/reference/use-cases-examples
    async createTicket(credential, input) {
      if (!credential.supportEmail) {
        throw new ProviderError('auth', 'This Richpanel connection has no support email address. Connect again.')
      }
      const { ticket } = input
      await call(credential, 'POST', '/tickets', {
        ticket: {
          status: 'OPEN',
          subject: ticket.subject,
          via: {
            channel: 'email',
            source: { from: { address: ticket.email }, to: { address: credential.supportEmail } },
          },
          comment: { body: ticket.body, sender_type: 'customer' },
        },
      })
    },
  }
}
