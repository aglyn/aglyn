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

import { providerRequest, type ProviderHttp } from './http'
import {
  e164OrNull,
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
 *   marketing (`POST /subscriptions`); one it may not is unsubscribed
 *   (`POST /subscriptions/unsubscribe`).
 * - **Back:** none. Attentive's API has no way to list who unsubscribed, so
 *   Attentive is one-way for consent, and the page says so.
 * - **Events:** a purchase through the e-commerce purchase event; the other
 *   facts as custom events, which Attentive journeys can trigger on.
 */

const PROVIDER = 'Attentive'
const BASE = 'https://api.attentivemobile.com/v1'

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
    providerRequest(http, { provider: PROVIDER, method, url: `${BASE}${path}`, headers: headers(credential), body })

  return {
    id: 'attentive',

    async verify(credential) {
      const me = await call(credential, 'GET', '/me')
      const name = me?.companyName ?? me?.company?.name
      return { accountName: typeof name === 'string' ? name : null, lists: [], apiBase: null }
    },

    async pushContacts(credential, _target, contacts) {
      for (const contact of contacts) {
        const phone = e164OrNull(contact.phone)
        const user = { email: contact.email, ...(phone ? { phone } : {}) }
        if (contact.status === 'subscribed') {
          await call(credential, 'POST', '/subscriptions', { user, subscriptionType: 'MARKETING', channel: 'EMAIL' })
        } else {
          await call(credential, 'POST', '/subscriptions/unsubscribe', {
            user: { email: contact.email },
            subscriptions: [{ type: 'MARKETING', channel: 'EMAIL' }],
          })
        }
      }
      return { pushed: contacts.length, skipped: [] }
    },

    async pullConsent() {
      return null
    },

    async sendEvent(credential, event) {
      const occurredAt = new Date(event.occurredAtMs).toISOString()
      const user = { email: event.email }
      if (event.name === 'order.paid') {
        await call(credential, 'POST', '/events/ecommerce/purchase', {
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
      await call(credential, 'POST', '/events/custom', {
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
