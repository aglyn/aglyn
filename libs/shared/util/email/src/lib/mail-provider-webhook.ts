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

/**
 * The webhook provider — the sender an operator supplies.
 *
 * Aglyn hands each fully decided message to one endpoint and takes its word
 * for the outcome. What is on the other side is the operator's business: a
 * relay into their own SMTP server, Amazon SES, Postmark, a queue, or twenty
 * lines behind `nc`. Every policy — suppression, the send-rate governor, the
 * phishing screen, the sending identity, the unsubscribe footer — has
 * already been applied by the time the endpoint sees the message.
 *
 * This is the extension point rather than a module path the app imports,
 * for the reason the domain provider's webhook is: both apps are bundled by
 * Next, so a path resolved at runtime is not in the bundle, and an operator
 * running the published image has no build step in which to add one. A
 * webhook needs no rebuild and works from the shipped image unchanged.
 *
 * ## The wire format
 *
 * `POST $AGLYN_MAIL_WEBHOOK_URL`, `Content-Type: application/json`, and
 * `Authorization: Bearer $AGLYN_MAIL_WEBHOOK_TOKEN` when that is set:
 *
 * ```json
 * { "type": "mail.send", "version": 1, "context": "invite",
 *   "message": { "from": "\"Acme\" <hi@acme.com>", "to": ["ada@example.com"],
 *                "subject": "…", "text": "…", "html": "…",
 *                "headers": { "List-Unsubscribe": "<…>" },
 *                "tags": [{ "name": "context", "value": "invite" }],
 *                "replyTo": "support@acme.com" } }
 * ```
 *
 * `bcc` — a list — is present only when the message carries blind copies
 * (AGL-3699), and is delivered without appearing on the message's headers.
 *
 * Answer `2xx` once the message is accepted — with `{ "id": "…" }` if the
 * relay has an id for it, which the delivery log keys on. Answer `429`, with
 * `Retry-After` in seconds, to ask for a slower pace: the message is kept
 * and retried rather than dropped. Any other status is a refusal of that one
 * message, and the response body is logged as the reason.
 *
 * ## What it does not do
 *
 * It sends and nothing more. It has no credential probe, no delivery feed
 * and no read API, so the staff screens that read those answer "this
 * provider cannot tell us" instead of guessing.
 *
 * ⚠️ Send this to a service on your own network. The request carries the
 * bearer token and every message's recipients and body.
 */

import {
  providerRetryAtMs,
  type MailProvider,
  type MailProviderMessage,
  type MailProviderSendResult,
} from './mail-provider'

export const WEBHOOK_MAIL_PROVIDER_ID = 'webhook'

/** Where messages are POSTed. */
export const MAIL_WEBHOOK_URL_SETTING = 'AGLYN_MAIL_WEBHOOK_URL'

/** The bearer token sent with each message, when set. */
export const MAIL_WEBHOOK_TOKEN_SETTING = 'AGLYN_MAIL_WEBHOOK_TOKEN'

/**
 * Ceiling on one hand-off. A relay that never answers must not hold a
 * request — a sign-up, a checkout — until the platform kills the function;
 * a timeout comes back to `sendEmail` as a network failure, which every
 * caller already handles.
 */
export const MAIL_WEBHOOK_TIMEOUT_MS = 10_000

type Env = Record<string, string | undefined>

/** The body POSTed for one message. */
export function mailWebhookBody(
  message: MailProviderMessage,
  context?: string,
): Record<string, unknown> {
  return {
    type: 'mail.send',
    version: 1,
    ...(context ? { context } : {}),
    message: {
      from: message.from,
      to: message.to,
      subject: message.subject,
      ...(message.text ? { text: message.text } : {}),
      ...(message.html ? { html: message.html } : {}),
      ...(message.headers && Object.keys(message.headers).length
        ? { headers: message.headers }
        : {}),
      ...(message.tags?.length ? { tags: message.tags } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.bcc?.length ? { bcc: message.bcc } : {}),
    },
  }
}

function deadline(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(MAIL_WEBHOOK_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/** The webhook provider, reading its two settings from `env` at each call. */
export function webhookMailProvider(env: Env = process.env as Env): MailProvider {
  const url = () => String(env[MAIL_WEBHOOK_URL_SETTING] ?? '').trim()
  const token = () => String(env[MAIL_WEBHOOK_TOKEN_SETTING] ?? '').trim()
  return {
    id: WEBHOOK_MAIL_PROVIDER_ID,
    missingSettings: () => (url() ? [] : [MAIL_WEBHOOK_URL_SETTING]),
    async send(message, context): Promise<MailProviderSendResult> {
      const bearer = token()
      const signal = deadline()
      const response = await fetch(url(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(mailWebhookBody(message, context)),
        ...(signal ? { signal } : {}),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        return response.status === 429
          ? {
              accepted: false,
              rateLimited: true,
              retryAtMs: providerRetryAtMs(response.headers),
              status: response.status,
              detail,
            }
          : { accepted: false, rateLimited: false, status: response.status, detail }
      }
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null
      const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : null
      return { accepted: true, id }
    },
  }
}
