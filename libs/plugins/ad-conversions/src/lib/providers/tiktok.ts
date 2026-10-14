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
 * TikTok Events API (AGL-3694): one web event to the merchant's own pixel,
 * `POST business-api.tiktok.com/open_api/v1.3/event/track/`, the token in the
 * `Access-Token` header.
 *
 * - `event_id` is the id the browser's `ttq.track(…, { event_id })` used.
 * - `user.email` / `user.phone` are SHA-256 digests; TikTok takes the phone in
 *   E.164 form, with the `+`, before hashing. `ip`, `user_agent`, `ttp` (the
 *   `_ttp` cookie) and `ttclid` are sent as they are.
 * - TikTok answers HTTP 200 for a refusal too, with a non-zero `code`; that is
 *   read as the refusal it is, a token problem as "connect again".
 */

export const TIKTOK_EVENTS_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/'

const EVENT_NAMES: Readonly<Record<ConversionEvent['name'], string>> = {
  purchase: 'CompletePayment',
  lead: 'SubmitForm',
}

export function tiktokEventBody(target: ConversionTarget, event: ConversionEvent): Record<string, unknown> {
  return compact({
    event_source: 'web',
    event_source_id: target.pixelId ?? undefined,
    test_event_code: typeof target.test === 'string' ? target.test : undefined,
    data: [
      compact({
        event: EVENT_NAMES[event.name],
        event_time: seconds(event.occurredAtMs),
        event_id: event.id,
        user: compact({
          email: event.user.em,
          phone: event.user.phE164,
          ip: event.browser.ip ?? undefined,
          user_agent: event.browser.userAgent ?? undefined,
          ttp: event.browser.ttp,
          ttclid: event.browser.ttclid,
        }),
        page: event.url ? { url: event.url } : undefined,
        properties:
          event.name === 'purchase'
            ? compact({
                currency: event.currency ?? undefined,
                value: amount(event.valueCents),
                order_id: event.orderId ?? undefined,
                content_type: 'product',
                contents: event.items.map((item) =>
                  compact({
                    content_id: item.id,
                    content_name: item.name ?? undefined,
                    quantity: item.quantity,
                    price: amount(item.unitCents),
                  }),
                ),
              })
            : undefined,
      }),
    ],
  })
}

export async function sendTikTokEvent(http: ProviderHttp, target: ConversionTarget, event: ConversionEvent): Promise<void> {
  if (!target.pixelId) throw new ProviderError('invalid', 'Set the TikTok pixel ID on Setup → Tracking first')
  if (target.test === true) throw new ProviderError('invalid', 'Add a test event code to send TikTok a test event')
  const answer = await providerRequest(http, {
    provider: 'TikTok',
    method: 'POST',
    url: TIKTOK_EVENTS_URL,
    headers: { 'Content-Type': 'application/json', 'Access-Token': target.token },
    body: tiktokEventBody(target, event),
  })
  const code = Number(answer?.code ?? 0)
  if (code === 0) return
  const message = String(answer?.message ?? `TikTok refused the event (${code})`).slice(0, 300)
  if (/token|auth|permission/i.test(message)) {
    throw new ProviderError('auth', `TikTok refused the connection: ${message}`)
  }
  if (/too many|frequen|rate limit/i.test(message)) {
    throw new ProviderError('rate-limit', 'TikTok asked us to slow down', { retryAfterMs: 60_000 })
  }
  throw new ProviderError('invalid', message)
}
