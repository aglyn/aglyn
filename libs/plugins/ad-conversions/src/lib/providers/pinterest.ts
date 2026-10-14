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

import type { ConversionEvent } from './event'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import type { ConversionTarget } from './provider'
import { amount, compact, seconds } from './shape'

/**
 * Pinterest Conversions API (AGL-3694): one web event to the merchant's own
 * ad account, `POST api.pinterest.com/v5/ad_accounts/{id}/events`, the token
 * as a bearer.
 *
 * - `event_id` is the id the browser's `pintrk('track', …, { event_id })`
 *   used.
 * - `user_data` fields are arrays of SHA-256 digests; `client_ip_address`,
 *   `client_user_agent` and `click_id` (the `_epik` cookie) are sent as they
 *   are.
 * - Money is a decimal STRING, as Pinterest's schema asks.
 * - A test goes with `?test=true`, which Pinterest validates and does not
 *   record — Pinterest's own test marker, so a test is never live.
 */

export const PINTEREST_API = 'https://api.pinterest.com/v5'

const EVENT_NAMES: Readonly<Record<ConversionEvent['name'], string>> = {
  purchase: 'checkout',
  lead: 'lead',
}

const money = (cents: number | null): string | undefined => {
  const value = amount(cents)
  return value === undefined ? undefined : value.toFixed(2)
}

export function pinterestEventBody(event: ConversionEvent): Record<string, unknown> {
  const user = event.user
  const list = (value: string | undefined) => (value ? [value] : undefined)
  return {
    data: [
      compact({
        event_name: EVENT_NAMES[event.name],
        action_source: 'web',
        event_time: seconds(event.occurredAtMs),
        event_id: event.id,
        event_source_url: event.url ?? undefined,
        user_data: compact({
          em: list(user.em),
          ph: list(user.ph),
          fn: list(user.fn),
          ln: list(user.ln),
          ct: list(user.ct),
          st: list(user.st),
          zp: list(user.zp),
          country: list(user.country),
          client_ip_address: event.browser.ip ?? undefined,
          client_user_agent: event.browser.userAgent ?? undefined,
          click_id: event.browser.epik,
        }),
        custom_data:
          event.name === 'purchase'
            ? compact({
                currency: event.currency ?? undefined,
                value: money(event.valueCents),
                order_id: event.orderId ?? undefined,
                content_ids: event.items.map((item) => item.id),
                contents: event.items.map((item) =>
                  compact({ id: item.id, item_name: item.name ?? undefined, quantity: item.quantity, item_price: money(item.unitCents) }),
                ),
                num_items: event.items.reduce((sum, item) => sum + item.quantity, 0) || undefined,
              })
            : undefined,
      }),
    ],
  }
}

export async function sendPinterestEvent(http: ProviderHttp, target: ConversionTarget, event: ConversionEvent): Promise<void> {
  if (!target.adAccountId) throw new ProviderError('invalid', 'Add the Pinterest ad account ID first')
  const answer = await providerRequest(http, {
    provider: 'Pinterest',
    method: 'POST',
    url: `${PINTEREST_API}/ad_accounts/${encodeURIComponent(target.adAccountId)}/events${target.test ? '?test=true' : ''}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.token}` },
    body: pinterestEventBody(event),
  })
  const result = Array.isArray(answer?.events) ? answer.events[0] : null
  if (result && result.status && result.status !== 'processed') {
    throw new ProviderError('invalid', String(result.error_message ?? 'Pinterest did not accept the event').slice(0, 300))
  }
}
