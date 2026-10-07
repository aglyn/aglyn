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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  e164OrNull,
  toAmount,
  type MarketingEvent,
  type MarketingEventName,
  type MarketingProvider,
  type ProviderConsentChange,
  type ProviderContact,
  type ProviderCredential,
} from './provider'

/**
 * Klaviyo, through its JSON:API (AGL-3639), at a pinned revision.
 *
 * - **Out:** profiles through a bulk import job (name, phone, and the
 *   site's facts as custom properties: tags, lifetime value, orders), added
 *   to the chosen list; then the people the site may market to subscribed to
 *   email marketing on that list, and the people it may not unsubscribed.
 *   Klaviyo applies both jobs asynchronously.
 * - **Back:** profiles updated since the cursor, oldest first, with their
 *   email marketing consent: `UNSUBSCRIBED` comes back as an unsubscribe,
 *   `SUBSCRIBED` with no suppression as a return.
 * - **Events:** the metrics Klaviyo's own flow templates trigger on —
 *   Started Checkout (abandoned cart), Placed Order and Ordered Product
 *   (post-purchase), Fulfilled Order, Cancelled Order and Refunded Order —
 *   each with a `unique_id`, so a retried delivery is one event in Klaviyo.
 */

const PROVIDER = 'Klaviyo'
const BASE = 'https://a.klaviyo.com/api'
export const KLAVIYO_REVISION = '2024-10-15'
/** Full URL rather than a path: the events endpoint, spelled whole. */
const KLAVIYO_EVENTS_URL = 'https://a.klaviyo.com/api/events/'
const JOB_MAX = 1000
const PROFILE_PAGE = 100
const MAX_PAGES = 20

function headers(credential: ProviderCredential): Record<string, string> {
  return {
    Authorization: credential.kind === 'oauth' ? `Bearer ${credential.token}` : `Klaviyo-API-Key ${credential.token}`,
    revision: KLAVIYO_REVISION,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  }
}

/** Klaviyo's metric names for each commerce fact — the ones its flow templates listen for. */
export const KLAVIYO_METRICS: Readonly<Record<MarketingEventName, string>> = {
  'checkout.started': 'Started Checkout',
  'order.paid': 'Placed Order',
  'order.fulfilled': 'Fulfilled Order',
  'order.refunded': 'Refunded Order',
  'order.cancelled': 'Cancelled Order',
}

function profileAttributes(contact: ProviderContact): Record<string, unknown> {
  const attributes: Record<string, unknown> = { email: contact.email }
  if (contact.firstName) attributes['first_name'] = contact.firstName
  if (contact.lastName) attributes['last_name'] = contact.lastName
  const phone = e164OrNull(contact.phone)
  if (phone) attributes['phone_number'] = phone
  const properties: Record<string, unknown> = {}
  if (contact.tags.length) properties['aglyn_tags'] = contact.tags.slice(0, 50)
  if (contact.lifetimeValueCents !== null) properties['aglyn_lifetime_value'] = toAmount(contact.lifetimeValueCents)
  if (contact.ordersCount !== null) properties['aglyn_orders_count'] = contact.ordersCount
  if (Object.keys(properties).length) attributes['properties'] = properties
  return attributes
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

export function createKlaviyoProvider(http: ProviderHttp): MarketingProvider {
  const call = (credential: ProviderCredential, method: 'GET' | 'POST', pathOrUrl: string, body?: unknown) =>
    providerRequest(http, {
      provider: PROVIDER,
      method,
      url: pathOrUrl.startsWith('https://') ? pathOrUrl : `${BASE}${pathOrUrl}`,
      headers: headers(credential),
      body,
    })

  const subscriptionJob = (
    credential: ProviderCredential,
    listId: string,
    consent: 'SUBSCRIBED' | 'UNSUBSCRIBED',
    emails: readonly string[],
  ) =>
    call(credential, 'POST', consent === 'SUBSCRIBED' ? '/profile-subscription-bulk-create-jobs/' : '/profile-subscription-bulk-delete-jobs/', {
      data: {
        type: consent === 'SUBSCRIBED' ? 'profile-subscription-bulk-create-job' : 'profile-subscription-bulk-delete-job',
        attributes: {
          ...(consent === 'SUBSCRIBED' ? { custom_source: PLATFORM_BRAND_NAME } : {}),
          profiles: {
            data: emails.map((email) => ({
              type: 'profile',
              attributes: { email, subscriptions: { email: { marketing: { consent } } } },
            })),
          },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    })

  return {
    id: 'klaviyo',

    async verify(credential) {
      const account = await call(credential, 'GET', '/accounts/')
      const lists: { id: string; name: string }[] = []
      let next: string | null = '/lists/?fields[list]=name'
      for (let page = 0; next && page < 5; page += 1) {
        const answer = await call(credential, 'GET', next)
        for (const list of Array.isArray(answer?.data) ? answer.data : []) {
          if (typeof list?.id === 'string') lists.push({ id: list.id, name: String(list?.attributes?.name ?? list.id) })
        }
        next = typeof answer?.links?.next === 'string' && answer.links.next.startsWith(BASE) ? answer.links.next : null
      }
      const organization = account?.data?.[0]?.attributes?.contact_information?.organization_name
      return { accountName: typeof organization === 'string' ? organization : null, lists, apiBase: null }
    },

    async pushContacts(credential, target, contacts) {
      if (!target.listId) throw new ProviderError('invalid', 'Choose the Klaviyo list contacts go into')
      for (const batch of chunks(contacts, JOB_MAX)) {
        await call(credential, 'POST', '/profile-bulk-import-jobs/', {
          data: {
            type: 'profile-bulk-import-job',
            attributes: {
              profiles: {
                data: batch.map((contact) => {
                  const attributes = profileAttributes(contact)
                  if (target.tag) {
                    const properties = (attributes['properties'] as Record<string, unknown> | undefined) ?? {}
                    properties['aglyn_source'] = target.tag
                    attributes['properties'] = properties
                  }
                  return { type: 'profile', attributes }
                }),
              },
            },
            relationships: { lists: { data: [{ type: 'list', id: target.listId }] } },
          },
        })
        const subscribed = batch.filter((contact) => contact.status === 'subscribed').map((contact) => contact.email)
        const unsubscribed = batch.filter((contact) => contact.status === 'unsubscribed').map((contact) => contact.email)
        if (subscribed.length) await subscriptionJob(credential, target.listId, 'SUBSCRIBED', subscribed)
        if (unsubscribed.length) await subscriptionJob(credential, target.listId, 'UNSUBSCRIBED', unsubscribed)
      }
      return { pushed: contacts.length, skipped: [] }
    },

    async pullConsent(credential, _target, cursor) {
      const since = cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : '2000-01-01T00:00:00Z'
      const changes: ProviderConsentChange[] = []
      let latest: string | null = cursor
      const params = new URLSearchParams({
        filter: `greater-than(updated,${since})`,
        sort: 'updated',
        'page[size]': String(PROFILE_PAGE),
        'additional-fields[profile]': 'subscriptions',
        'fields[profile]': 'email,updated,subscriptions',
      })
      let next: string | null = `/profiles/?${params.toString()}`
      let pages = 0
      while (next && pages < MAX_PAGES) {
        const answer = await call(credential, 'GET', next)
        pages += 1
        for (const profile of Array.isArray(answer?.data) ? answer.data : []) {
          const attributes = profile?.attributes ?? {}
          const email = String(attributes.email ?? '').trim().toLowerCase()
          const updated = String(attributes.updated ?? '')
          if (updated && !Number.isNaN(Date.parse(updated))) latest = updated
          if (!email) continue
          const marketing = attributes.subscriptions?.email?.marketing ?? {}
          const suppressed = Array.isArray(marketing.suppression) && marketing.suppression.length > 0
          if (marketing.consent === 'UNSUBSCRIBED') changes.push({ email, status: 'unsubscribed' })
          else if (marketing.consent === 'SUBSCRIBED' && !suppressed) changes.push({ email, status: 'subscribed' })
        }
        next = typeof answer?.links?.next === 'string' && answer.links.next.startsWith(BASE) ? answer.links.next : null
      }
      return { changes, cursor: latest, more: Boolean(next) }
    },

    async sendEvent(credential, event) {
      const metric = KLAVIYO_METRICS[event.name]
      const properties: Record<string, unknown> = {
        OrderId: event.orderId,
        OrderNumber: event.orderNumber,
        ItemNames: event.items.map((item) => item.name),
        Items: event.items.map((item) => ({
          ProductID: item.productId,
          VariantID: item.variantId,
          SKU: item.sku,
          ProductName: item.name,
          Quantity: item.quantity,
          ItemPrice: toAmount(item.unitCents),
          RowTotal: toAmount(item.unitCents * item.quantity),
        })),
      }
      if (event.checkoutUrl) properties['CheckoutURL'] = event.checkoutUrl
      if (event.tracking) {
        properties['Carrier'] = event.tracking.carrier
        properties['TrackingNumber'] = event.tracking.number
        properties['TrackingURL'] = event.tracking.url
      }
      const send = (name: string, uniqueId: string, value: number, extra: Record<string, unknown>) =>
        call(credential, 'POST', KLAVIYO_EVENTS_URL, {
          data: {
            type: 'event',
            attributes: {
              properties: extra,
              time: new Date(event.occurredAtMs).toISOString(),
              value,
              value_currency: event.currency,
              unique_id: uniqueId,
              metric: { data: { type: 'metric', attributes: { name } } },
              profile: { data: { type: 'profile', attributes: { email: event.email } } },
            },
          },
        })
      await send(metric, event.id, toAmount(event.valueCents), properties)
      // Ordered Product, one per line: what Klaviyo's product-level flows and
      // cross-sell recommendations read.
      if (event.name === 'order.paid') {
        for (const [index, item] of event.items.entries()) {
          await send('Ordered Product', `${event.id}:${index}`, toAmount(item.unitCents * item.quantity), {
            OrderId: event.orderId,
            ProductID: item.productId,
            VariantID: item.variantId,
            SKU: item.sku,
            ProductName: item.name,
            Quantity: item.quantity,
          })
        }
      }
    },
  }
}
