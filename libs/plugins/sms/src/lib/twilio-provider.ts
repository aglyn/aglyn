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

import { createHmac, timingSafeEqual } from 'crypto'
import { TWILIO_ENV } from './constants'
import {
  smsSegmentCount,
  type SmsProvider,
  type SmsProviderSendInput,
  type SmsProviderSendResult,
} from './sms-provider'

/**
 * The Twilio adapter (AGL-3610): the Messages REST API over `fetch`, no SDK.
 *
 * Sends through a Messaging Service (`TWILIO_MESSAGING_SERVICE_SID`) rather
 * than a bare From number, so the sender pool, its A2P 10DLC registration and
 * Twilio's own opt-out handling live in the Twilio console where they are
 * configured, not in our env. Unconfigured — any of the three variables
 * missing — it reports so and sends nothing; every caller then offers email
 * only.
 */
const TWILIO_API_ORIGIN = 'https://api.twilio.com'

/** Twilio's "this number cannot receive" codes: bad number, landline, opted out. */
const TWILIO_INVALID_NUMBER_CODES = new Set([21211, 21214, 21614, 21610])

type FetchLike = typeof fetch

function env(name: string): string {
  return String(process.env[name] ?? '').trim()
}

export function createTwilioSmsProvider(
  deps: { fetch?: FetchLike } = {},
): SmsProvider {
  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  return {
    id: 'twilio',
    isConfigured: () =>
      Boolean(
        env(TWILIO_ENV.accountSid) &&
          env(TWILIO_ENV.authToken) &&
          env(TWILIO_ENV.messagingServiceSid),
      ),
    async send(input: SmsProviderSendInput): Promise<SmsProviderSendResult> {
      const accountSid = env(TWILIO_ENV.accountSid)
      const authToken = env(TWILIO_ENV.authToken)
      const messagingServiceSid = env(TWILIO_ENV.messagingServiceSid)
      if (!accountSid || !authToken || !messagingServiceSid) {
        return { ok: false, error: 'Twilio is not configured' }
      }
      const form = new URLSearchParams({ To: input.to, Body: input.body })
      if (input.from) form.set('From', input.from)
      else form.set('MessagingServiceSid', messagingServiceSid)
      let response: Response
      try {
        response = await doFetch(
          `${TWILIO_API_ORIGIN}/2010-04-01/Accounts/${encodeURIComponent(
            accountSid,
          )}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(
                `${accountSid}:${authToken}`,
              ).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
          },
        )
      } catch (error) {
        return {
          ok: false,
          error: `Twilio unreachable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      }
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      if (!response.ok) {
        const code = Number(payload['code'])
        return {
          ok: false,
          error: String(payload['message'] ?? `Twilio answered ${response.status}`),
          ...(TWILIO_INVALID_NUMBER_CODES.has(code) ? { invalidNumber: true } : {}),
        }
      }
      const reported = Number(payload['num_segments'])
      return {
        ok: true,
        id: String(payload['sid'] ?? ''),
        segments:
          Number.isFinite(reported) && reported > 0
            ? reported
            : smsSegmentCount(input.body),
      }
    },
  }
}

/**
 * Verifies `X-Twilio-Signature` on an inbound webhook: base64 HMAC-SHA1, keyed
 * by the auth token, over the full URL Twilio posted to followed by every POST
 * parameter's name and value, sorted by name. Constant-time; false when the
 * token is unset, so an unconfigured install accepts nothing.
 */
export function verifyTwilioSignature(input: {
  url: string
  params: Record<string, string>
  signature: string
  authToken?: string
}): boolean {
  const authToken = input.authToken ?? env(TWILIO_ENV.authToken)
  if (!authToken || !input.signature || !input.url) return false
  const payload =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((key) => `${key}${input.params[key]}`)
      .join('')
  const expected = createHmac('sha1', authToken).update(payload).digest('base64')
  const a = Buffer.from(input.signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}
