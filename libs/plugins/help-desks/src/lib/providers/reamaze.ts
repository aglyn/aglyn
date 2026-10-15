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

import { orderItemsLine, orderOneLine, type HelpDeskOrder } from '../model/orders'
import { accountApiBase, basicAuthorization, isProviderError, ProviderError, providerRequest, type ProviderHttp } from './http'
import { e164OrNull, type HelpDeskCredential, type HelpDeskProvider } from './provider'

/**
 * Re:amaze, through its REST API (AGL-3824): HTTP Basic with the login
 * email and that user's API token, at `https://{brand}.reamaze.io/api/v1`,
 * JSON both ways. https://www.reamaze.com/api
 *
 * - **Contacts:** updated by email address, added when Re:amaze has none.
 * - **Orders:** the buyer's latest and recent orders as Customer Data
 *   Attributes, which Re:amaze keeps one level deep, so each is a line of
 *   text.
 * - **Conversations:** a contact form message starts a conversation from
 *   the contact in the channel the merchant picked.
 */

const PROVIDER = 'Re:amaze'
/** The REST API, served from the brand's own subdomain of this host. */
const REAMAZE_API = 'https://reamaze.io/api/v1'
/** The contacts resource, an API path segment. */
const CONTACTS = 'contacts'

function headers(credential: HelpDeskCredential): Record<string, string> {
  if (!credential.login) throw new ProviderError('auth', 'This Re:amaze connection has no login email. Connect again.')
  return {
    Authorization: basicAuthorization(credential.login, credential.token),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/** The recent orders as the contact's attributes: one line each, no nesting. */
export function reamazeOrderData(recent: readonly HelpDeskOrder[], source: string): Record<string, string> {
  const latest = recent[0]
  const data: Record<string, string> = { 'Orders from': source }
  if (!latest) return data
  data['Last order'] = orderOneLine(latest)
  data['Last order items'] = orderItemsLine(latest)
  if (latest.url) data['Last order link'] = latest.url
  data['Recent orders'] = recent.map(orderOneLine).join('\n')
  return data
}

export function createReamazeProvider(http: ProviderHttp): HelpDeskProvider {
  const call = (credential: HelpDeskCredential, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    providerRequest(http, {
      provider: PROVIDER,
      method,
      url: `${accountApiBase(REAMAZE_API, credential.account, PROVIDER)}${path}`,
      headers: headers(credential),
      body,
    })

  const contactPath = (email: string) => `/${CONTACTS}/${encodeURIComponent(email)}`

  /** Adds the contact; a 422 for an address Re:amaze already holds is the contact being there. */
  // https://www.reamaze.com/api/post_contacts
  const create = async (credential: HelpDeskCredential, contact: Record<string, unknown>) => {
    try {
      await call(credential, 'POST', `/${CONTACTS}`, { contact })
    } catch (error) {
      if (isProviderError(error) && error.status === 422 && /taken|exist|already/i.test(error.message)) return
      throw error
    }
  }

  return {
    id: 'reamaze',

    // https://www.reamaze.com/api/get_channels
    async verify(credential) {
      const answer = await call(credential, 'GET', '/channels')
      const channels: any[] = Array.isArray(answer?.channels) ? answer.channels : []
      const targets = channels
        .filter((channel) => typeof channel?.slug === 'string' && channel.slug)
        .map((channel) => ({ id: String(channel.slug), name: String(channel.name ?? channel.slug) }))
      const brand = channels.find((channel) => typeof channel?.brand?.name === 'string')?.brand?.name
      return { accountName: typeof brand === 'string' ? brand : credential.account, targets }
    },

    async upsertCustomer(credential, customer) {
      const mobile = e164OrNull(customer.phone)
      if (customer.name) {
        try {
          // https://www.reamaze.com/api/put_contacts
          await call(credential, 'PUT', contactPath(customer.email), { contact: { name: customer.name } })
          return { remoteId: customer.email }
        } catch (error) {
          if (!(isProviderError(error) && error.status === 404)) throw error
        }
      }
      await create(credential, {
        email: customer.email,
        ...(customer.name ? { name: customer.name } : {}),
        ...(mobile ? { mobile } : {}),
      })
      return { remoteId: customer.email }
    },

    async pushOrder(credential, input) {
      const data = reamazeOrderData(input.recent, input.source)
      try {
        // https://www.reamaze.com/api/put_contacts
        await call(credential, 'PUT', contactPath(input.customer.email), { contact: { data } })
      } catch (error) {
        if (!(isProviderError(error) && error.status === 404)) throw error
        await create(credential, {
          email: input.customer.email,
          ...(input.customer.name ? { name: input.customer.name } : {}),
          data,
        })
      }
    },

    // https://www.reamaze.com/api/post_conversations
    async createTicket(credential, input) {
      if (!input.targetId) throw new ProviderError('invalid', 'Choose the Re:amaze channel contact form messages go to')
      const { ticket } = input
      await call(credential, 'POST', '/conversations', {
        conversation: {
          subject: ticket.subject,
          category: input.targetId,
          message: { body: ticket.body },
          user: { email: ticket.email, ...(ticket.name ? { name: ticket.name } : {}) },
        },
      })
    },
  }
}
