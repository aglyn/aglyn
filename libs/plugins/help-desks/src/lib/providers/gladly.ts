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

import { createHash } from 'node:crypto'
import { formatMoney, orderItemsLine, orderOneLine, orderStatusLabel } from '../model/orders'
import { accountApiBase, basicAuthorization, isProviderError, ProviderError, providerRequest, type ProviderHttp } from './http'
import { e164OrNull, escapeHtml, type HelpDeskCredential, type HelpDeskProvider } from './provider'

/**
 * Gladly, through its REST API (AGL-3824): HTTP Basic with the email of a
 * Gladly user who holds the API User permission and that user's API token,
 * at `https://{organization}.gladly.com/api/v1`. Every method is held to 10
 * requests a second per organization, answered past that with a 429.
 * https://developer.gladly.com/rest/
 *
 * - **Customers:** found by email, added with an id of our own making when
 *   Gladly has none, so a retried add is the same profile (a 409).
 * - **Orders:** each state of an order is a Customer Activity on the
 *   customer's timeline, its id made from the order and its state, so a
 *   retried send is the same item (a 409) and a new state is a new item.
 *   Gladly's Lookup Adaptor, which Gladly calls out to, is not used: it
 *   needs an endpoint registered in each merchant's Gladly by hand.
 * - **Tasks:** a contact form message becomes a task for the customer in
 *   the inbox the merchant picked, due a day after it arrives.
 */

const PROVIDER = 'Gladly'
/** The REST API, served from the organization's own subdomain of this host. */
const GLADLY_API = 'https://gladly.com/api/v1'

/** How long a task opened from a contact form message has before it is due. */
export const GLADLY_TASK_DUE_MS = 24 * 60 * 60 * 1000

/** Gladly places no item older than a year on a timeline. */
const ACTIVITY_MAX_AGE_MS = 360 * 24 * 60 * 60 * 1000

function headers(credential: HelpDeskCredential): Record<string, string> {
  if (!credential.login) throw new ProviderError('auth', 'This Gladly connection has no user email. Connect again.')
  return {
    Authorization: basicAuthorization(credential.login, credential.token),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/** A URL-safe id under Gladly's 50 characters, the same for the same input. */
export const gladlyId = (prefix: string, value: string): string =>
  `${prefix}${createHash('sha256').update(value).digest('base64url').slice(0, 40)}`

export function createGladlyProvider(http: ProviderHttp): HelpDeskProvider {
  const call = (credential: HelpDeskCredential, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
    providerRequest(http, {
      provider: PROVIDER,
      method,
      url: `${accountApiBase(GLADLY_API, credential.account, PROVIDER)}${path}`,
      headers: headers(credential),
      body,
    })

  const status = (error: unknown): number | null => (isProviderError(error) ? error.status : null)

  // https://developer.gladly.com/rest/#tag/Customers (Update customer)
  const rename = (credential: HelpDeskCredential, id: string, name: string) =>
    call(credential, 'PATCH', `/customer-profiles/${encodeURIComponent(id)}`, { name })

  return {
    id: 'gladly',

    async verify(credential) {
      // https://developer.gladly.com/rest/#tag/Organization
      const organization = await call(credential, 'GET', '/organization')
      // https://developer.gladly.com/rest/#tag/Inboxes
      const inboxes = await call(credential, 'GET', '/inboxes')
      const targets = (Array.isArray(inboxes) ? inboxes : [])
        .filter((inbox: any) => typeof inbox?.id === 'string' && inbox.disabled !== true)
        .map((inbox: any) => ({ id: String(inbox.id), name: String(inbox.name ?? inbox.id) }))
      return { accountName: typeof organization?.name === 'string' ? organization.name : credential.account, targets }
    },

    async upsertCustomer(credential, customer, known) {
      if (known) {
        try {
          if (customer.name) await rename(credential, known, customer.name)
          return { remoteId: known }
        } catch (error) {
          // Gone (404) or merged into another profile (410): find them again.
          if (status(error) !== 404 && status(error) !== 410) throw error
        }
      }
      // https://developer.gladly.com/rest/#tag/Customers (Find customers)
      const found = await call(credential, 'GET', `/customer-profiles?${new URLSearchParams({ email: customer.email }).toString()}`)
      const existing = Array.isArray(found) ? found.find((profile: any) => typeof profile?.id === 'string') : null
      if (existing) {
        if (customer.name) await rename(credential, existing.id, customer.name)
        return { remoteId: existing.id }
      }
      const id = gladlyId('agl', `customer:${customer.email}`)
      const phone = e164OrNull(customer.phone)
      try {
        // https://developer.gladly.com/rest/#tag/Customers (Create customer)
        await call(credential, 'POST', '/customer-profiles', {
          id,
          ...(customer.name ? { name: customer.name } : {}),
          emails: [{ original: customer.email, primary: true }],
          ...(phone ? { phones: [{ original: phone, primary: true }] } : {}),
        })
      } catch (error) {
        // Our own id taken: a profile this connection added already.
        if (status(error) !== 409) throw error
      }
      return { remoteId: id }
    },

    // https://developer.gladly.com/rest/#tag/Conversations (Create item for customer)
    async pushOrder(credential, input) {
      const { order } = input
      const label = orderStatusLabel(order.status)
      const lines = [
        escapeHtml(orderOneLine(order)),
        escapeHtml(orderItemsLine(order, 20)),
        ...(order.refundedCents > 0 ? [escapeHtml(`Refunded ${formatMoney(order.refundedCents, order.currency)}`)] : []),
      ]
      const recent = Date.now() - order.createdAtMs < ACTIVITY_MAX_AGE_MS
      try {
        await call(credential, 'POST', `/customers/${encodeURIComponent(input.remoteId)}/conversation-items`, {
          id: gladlyId('ord', `${order.id}|${order.status}|${order.refundedCents}`),
          content: {
            type: 'CUSTOMER_ACTIVITY',
            activityType: 'EMAIL',
            title: `Order ${order.number ?? order.id} · ${label}`.slice(0, 100),
            body: lines.map((line) => `<p>${line}</p>`).join('').slice(0, 25000),
            sourceName: input.source.slice(0, 50),
            ...(order.url ? { link: { url: order.url, text: 'View order' } } : {}),
            ...(recent ? { occurredAt: new Date(order.createdAtMs).toISOString() } : {}),
          },
        })
      } catch (error) {
        // The same order in the same state, sent before.
        if (status(error) === 409) return
        throw error
      }
    },

    // https://developer.gladly.com/rest/#tag/Tasks (Create task)
    async createTicket(credential, input) {
      if (!input.targetId) throw new ProviderError('invalid', 'Choose the Gladly inbox contact form messages go to')
      const { ticket } = input
      const body = `<p><strong>${escapeHtml(ticket.subject)}</strong></p><p>${escapeHtml(ticket.body)}</p>`
      await call(credential, 'POST', '/tasks', {
        customer: { emailAddress: ticket.email },
        assignee: { inboxId: input.targetId },
        body: body.slice(0, 10000),
        dueAt: new Date(input.nowMs + GLADLY_TASK_DUE_MS).toISOString(),
      })
    },
  }
}
