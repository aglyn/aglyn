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
 * Meta Conversions API (AGL-3694): one event to the merchant's own pixel,
 * `POST graph.facebook.com/{version}/{pixel}/events`.
 *
 * - `event_id` is the id the browser's `fbq('track', …, { eventID })` used,
 *   which is how Meta keeps one of the pair.
 * - `user_data` carries the hashed fields as Meta names them, plus the
 *   unhashed `client_ip_address`, `client_user_agent`, `fbp` and `fbc` it
 *   requires as they are. `action_source: 'website'` needs the user agent.
 * - The token travels in the BODY, never in the query string, so it is in no
 *   access log of anything between here and Meta.
 * - A test carries `test_event_code`; with no code there is no test send.
 */

export const META_GRAPH_VERSION = 'v23.0'

const EVENT_NAMES: Readonly<Record<ConversionEvent['name'], string>> = {
  purchase: 'Purchase',
  lead: 'Lead',
}

export function metaEventBody(target: ConversionTarget, event: ConversionEvent): Record<string, unknown> {
  const user = event.user
  return compact({
    data: [
      compact({
        event_name: EVENT_NAMES[event.name],
        event_time: seconds(event.occurredAtMs),
        event_id: event.id,
        action_source: 'website',
        event_source_url: event.url ?? undefined,
        user_data: compact({
          em: user.em ? [user.em] : undefined,
          ph: user.ph ? [user.ph] : undefined,
          fn: user.fn ? [user.fn] : undefined,
          ln: user.ln ? [user.ln] : undefined,
          ct: user.ct ? [user.ct] : undefined,
          st: user.st ? [user.st] : undefined,
          zp: user.zp ? [user.zp] : undefined,
          country: user.country ? [user.country] : undefined,
          client_ip_address: event.browser.ip ?? undefined,
          client_user_agent: event.browser.userAgent ?? undefined,
          fbp: event.browser.fbp,
          fbc: event.browser.fbc,
        }),
        custom_data:
          event.name === 'purchase'
            ? compact({
                currency: event.currency ?? undefined,
                value: amount(event.valueCents),
                order_id: event.orderId ?? undefined,
                content_type: 'product',
                content_ids: event.items.map((item) => item.id),
                contents: event.items.map((item) => ({
                  id: item.id,
                  quantity: item.quantity,
                  item_price: amount(item.unitCents),
                })),
                num_items: event.items.reduce((sum, item) => sum + item.quantity, 0) || undefined,
              })
            : undefined,
      }),
    ],
    test_event_code: typeof target.test === 'string' ? target.test : undefined,
    access_token: target.token,
  })
}

export async function sendMetaEvent(http: ProviderHttp, target: ConversionTarget, event: ConversionEvent): Promise<void> {
  if (!target.pixelId) throw new ProviderError('invalid', 'Set the Meta pixel ID on Setup → Tracking first')
  if (target.test === true) throw new ProviderError('invalid', 'Add a test event code to send Meta a test event')
  const answer = await providerRequest(http, {
    provider: 'Meta',
    method: 'POST',
    url: `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(target.pixelId)}/events`,
    headers: { 'Content-Type': 'application/json' },
    body: metaEventBody(target, event),
  })
  if (Number(answer?.events_received ?? 0) < 1) {
    throw new ProviderError('invalid', 'Meta did not accept the event')
  }
}
