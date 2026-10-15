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

import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  toAmount,
  type MarketingEventName,
  type MarketingProvider,
  type ProviderCredential,
} from './provider'

/**
 * Attentive (AGL-3639), behind its partner app: built, and offered only once
 * `ATTENTIVE_CLIENT_ID` and `ATTENTIVE_CLIENT_SECRET` exist — Attentive's API
 * is reached through an approved partner application, and a merchant
 * connects through its OAuth install.
 *
 * - **Out:** a person the site may market to is subscribed to email
 *   marketing (`POST /subscriptions`) only when Attentive does not know them
 *   yet: `GET /subscriptions?email=` answers 404 for a stranger, and anyone
 *   it answers for is left exactly as Attentive has them. That is
 *   Mailchimp's `status_if_new` by other means (AGL-3810): Attentive cannot
 *   list who unsubscribed there, and its subscribe opts a person in again,
 *   so without the check a record edit on the site would subscribe someone
 *   who left in Attentive. One the site may not market to is unsubscribed
 *   (`POST /subscriptions/unsubscribe`). Only the email is sent: Attentive
 *   picks the channels from the identifiers in `user`, and a phone there
 *   would opt the person into text messages.
 * - **Back:** none. Attentive's API has no way to list who unsubscribed, so
 *   Attentive is one-way for consent, and the page says so.
 * - **Events:** a purchase through the e-commerce purchase event; the other
 *   facts as custom events, which Attentive journeys can trigger on.
 */

const PROVIDER = 'Attentive'
const BASE = 'https://api.attentivemobile.com/v1'
/** The event endpoints, spelled whole. */
const PURCHASE_EVENT_URL = 'https://api.attentivemobile.com/v1/events/ecommerce/purchase'
const CUSTOM_EVENT_URL = 'https://api.attentivemobile.com/v1/events/custom'

function headers(credential: ProviderCredential): Record<string, string> {
  return { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
}

export const ATTENTIVE_CUSTOM_EVENTS: Readonly<Record<Exclude<MarketingEventName, 'order.paid'>, string>> = {
  'checkout.started': 'Started Checkout',
  'order.fulfilled': 'Order Fulfilled',
  'order.refunded': 'Order Refunded',
  'order.cancelled': 'Order Canceled',
}

export function createAttentiveProvider(http: ProviderHttp): MarketingProvider {
  const call = (credential: ProviderCredential, method: 'GET' | 'POST', path: string, body?: unknown) =>
    providerRequest(http, {
      provider: PROVIDER,
      method,
      url: path.startsWith('https://') ? path : `${BASE}${path}`,
      headers: headers(credential),
      body,
    })

  /**
   * Whether Attentive already holds a subscriber for this address. Its
   * eligibility read answers 404 for an address it has never seen; any
   * answer at all, eligible or not, means the person is Attentive's to keep.
   */
  const knownToAttentive = async (credential: ProviderCredential, email: string): Promise<boolean> => {
    try {
      await call(credential, 'GET', `/subscriptions?email=${encodeURIComponent(email)}`)
      return true
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return false
      throw error
    }
  }

  return {
    id: 'attentive',

    async verify(credential) {
      const me = await call(credential, 'GET', '/me')
      const name = me?.companyName ?? me?.company?.name
      return { accountName: typeof name === 'string' ? name : null, lists: [], apiBase: null }
    },

    async pushContacts(credential, _target, contacts) {
      let pushed = 0
      for (const contact of contacts) {
        const user = { email: contact.email }
        if (contact.status === 'subscribed') {
          if (await knownToAttentive(credential, contact.email)) continue
          await call(credential, 'POST', '/subscriptions', { user, subscriptionType: 'MARKETING' })
        } else {
          await call(credential, 'POST', '/subscriptions/unsubscribe', {
            user,
            subscriptions: [{ type: 'MARKETING', channel: 'EMAIL' }],
          })
        }
        pushed += 1
      }
      return { pushed, skipped: [] }
    },

    async pullConsent() {
      return null
    },

    async sendEvent(credential, event) {
      const occurredAt = new Date(event.occurredAtMs).toISOString()
      const user = { email: event.email }
      if (event.name === 'order.paid') {
        await call(credential, 'POST', PURCHASE_EVENT_URL, {
          items: event.items.map((item) => ({
            productId: item.productId ?? item.name,
            productVariantId: item.variantId ?? item.productId ?? item.name,
            name: item.name,
            price: { value: toAmount(item.unitCents), currency: event.currency },
            quantity: item.quantity,
          })),
          occurredAt,
          user,
          externalEventId: event.id,
        })
        return
      }
      await call(credential, 'POST', CUSTOM_EVENT_URL, {
        type: ATTENTIVE_CUSTOM_EVENTS[event.name],
        properties: {
          orderId: event.orderId,
          orderNumber: event.orderNumber,
          value: toAmount(event.valueCents),
          currency: event.currency,
          ...(event.checkoutUrl ? { checkoutUrl: event.checkoutUrl } : {}),
          ...(event.tracking?.url ? { trackingUrl: event.tracking.url } : {}),
        },
        occurredAt,
        user,
        externalEventId: event.id,
      })
    },
  }
}
