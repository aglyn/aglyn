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
  toAmount,
  type MarketingEventName,
  type MarketingProvider,
  type ProviderConsentChange,
  type ProviderCredential,
} from './provider'

/**
 * Omnisend (AGL-3639): contacts through its v3 API, events through v5.
 *
 * - **Out:** `POST /v3/contacts` creates or updates a contact by address,
 *   with its email channel `subscribed` or `unsubscribed`, name and tags.
 *   Omnisend has no lists to pick; a tag segments the site's contacts.
 * - **Back:** Omnisend's API lists contacts by status but cannot filter by
 *   when the status changed, so each run walks the unsubscribed contacts
 *   (bounded) and hands back those whose email status date is after the
 *   cursor. A return to subscribed is not read back: only an unsubscribe
 *   made in Omnisend reaches the site.
 * - **Events:** Omnisend's own event names for its automation triggers —
 *   started checkout, placed order, order fulfilled, order canceled, order
 *   refunded — with a stable `eventID`.
 */

const PROVIDER = 'Omnisend'
const BASE = 'https://api.omnisend.com'
const PAGE = 250
const MAX_PAGES = 20

function headers(credential: ProviderCredential): Record<string, string> {
  return { 'X-API-KEY': credential.token, 'Content-Type': 'application/json', Accept: 'application/json' }
}

export const OMNISEND_EVENTS: Readonly<Record<MarketingEventName, string>> = {
  'checkout.started': 'started checkout',
  'order.paid': 'placed order',
  'order.fulfilled': 'order fulfilled',
  'order.refunded': 'order refunded',
  'order.cancelled': 'order canceled',
}

interface OmnisendCursor {
  /** Status dates at or before this were handed back already. */
  sinceMs: number
  /** Where an unfinished walk resumes. */
  offset: number
  /** The latest status date an unfinished walk has seen. */
  seenMs: number
}

export function readOmnisendCursor(cursor: string | null): OmnisendCursor {
  const match = /^(\d{1,15})\|(\d{1,9})\|(\d{1,15})$/.exec(String(cursor ?? ''))
  return match
    ? { sinceMs: Number(match[1]), offset: Number(match[2]), seenMs: Number(match[3]) }
    : { sinceMs: 0, offset: 0, seenMs: 0 }
}

export const writeOmnisendCursor = (cursor: OmnisendCursor): string =>
  `${Math.trunc(cursor.sinceMs)}|${Math.trunc(cursor.offset)}|${Math.trunc(cursor.seenMs)}`

export function createOmnisendProvider(http: ProviderHttp): MarketingProvider {
  const call = (credential: ProviderCredential, method: 'GET' | 'POST', path: string, body?: unknown) =>
    providerRequest(http, { provider: PROVIDER, method, url: `${BASE}${path}`, headers: headers(credential), body })

  return {
    id: 'omnisend',

    async verify(credential) {
      await call(credential, 'GET', '/v3/contacts?limit=1')
      return { accountName: null, lists: [], apiBase: null }
    },

    async pushContacts(credential, target, contacts) {
      const statusDate = new Date().toISOString()
      for (const contact of contacts) {
        const tags = [...new Set([target.tag, ...contact.tags].map((tag) => String(tag ?? '').trim()).filter(Boolean))].slice(0, 20)
        await call(credential, 'POST', '/v3/contacts', {
          identifiers: [
            {
              type: 'email',
              id: contact.email,
              channels: { email: { status: contact.status, statusDate } },
            },
          ],
          ...(contact.firstName ? { firstName: contact.firstName } : {}),
          ...(contact.lastName ? { lastName: contact.lastName } : {}),
          ...(tags.length ? { tags } : {}),
          ...(contact.lifetimeValueCents !== null || contact.ordersCount !== null
            ? {
                customProperties: {
                  ...(contact.lifetimeValueCents !== null ? { aglynLifetimeValue: toAmount(contact.lifetimeValueCents) } : {}),
                  ...(contact.ordersCount !== null ? { aglynOrdersCount: contact.ordersCount } : {}),
                },
              }
            : {}),
        })
      }
      return { pushed: contacts.length, skipped: [] }
    },

    async pullConsent(credential, _target, cursor) {
      /*
       * Omnisend lists unsubscribed contacts in no order we can resume by
       * date, so a walk too long for one run resumes by OFFSET: the cursor
       * holds the date the walk filters on, where it stopped, and the latest
       * status date it has seen so far. Only a finished walk moves the date.
       */
      const state = readOmnisendCursor(cursor)
      const changes: ProviderConsentChange[] = []
      let seen = state.seenMs
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const offset = state.offset + page * PAGE
        const answer = await call(credential, 'GET', `/v3/contacts?status=unsubscribed&limit=${PAGE}&offset=${offset}`)
        const contacts: any[] = Array.isArray(answer?.contacts) ? answer.contacts : []
        for (const contact of contacts) {
          const identifier = (Array.isArray(contact?.identifiers) ? contact.identifiers : []).find(
            (entry: any) => entry?.type === 'email',
          )
          const email = String(identifier?.id ?? contact?.email ?? '').trim().toLowerCase()
          const at = Date.parse(String(identifier?.channels?.email?.statusDate ?? ''))
          if (!email || !Number.isFinite(at)) continue
          if (at > seen) seen = at
          if (at > state.sinceMs) changes.push({ email, status: 'unsubscribed' })
        }
        if (contacts.length < PAGE) {
          return { changes, cursor: writeOmnisendCursor({ sinceMs: Math.max(seen, state.sinceMs), offset: 0, seenMs: 0 }), more: false }
        }
      }
      return {
        changes,
        cursor: writeOmnisendCursor({ sinceMs: state.sinceMs, offset: state.offset + MAX_PAGES * PAGE, seenMs: seen }),
        more: true,
      }
    },

    async sendEvent(credential, event) {
      await call(credential, 'POST', '/v5/events', {
        eventName: OMNISEND_EVENTS[event.name],
        origin: 'api',
        eventID: event.id,
        eventTime: new Date(event.occurredAtMs).toISOString(),
        contact: { email: event.email },
        properties: {
          orderID: event.orderId,
          orderNumber: event.orderNumber,
          currency: event.currency,
          totalPrice: toAmount(event.valueCents),
          ...(event.checkoutUrl ? { abandonedCheckoutURL: event.checkoutUrl } : {}),
          ...(event.tracking ? { tracking: { courierTitle: event.tracking.carrier, code: event.tracking.number, courierURL: event.tracking.url } } : {}),
          lineItems: event.items.map((item) => ({
            productID: item.productId,
            productVariantID: item.variantId,
            productSKU: item.sku,
            productTitle: item.name,
            productQuantity: item.quantity,
            productPrice: toAmount(item.unitCents),
          })),
        },
      })
    },
  }
}
