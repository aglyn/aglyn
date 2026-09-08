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
 * RECEIVED MAIL, in the platform's own vocabulary (AGL-2657).
 *
 * Resend announces a received message as an `email.received` webhook that
 * carries only its metadata — who it was from and to, its subject, its
 * `Message-ID` — and the message itself is read afterwards from the
 * receiving API by the id the event named. This module is the one place
 * that reads that wire format: the event's shape, the API's shape, and the
 * neutral {@link ReceivedEmail} everything downstream works with. A second
 * provider is a second normalizer here and nothing else, which is the
 * arrangement `email-delivery-events.ts` has for the sending side.
 *
 * Pure but for {@link resendReceivedEmailSource}, which is a function that
 * must be CALLED with a key to do anything, so a client component that
 * reached this module through the barrel would execute nothing on load.
 */

/** The webhook event type a received message arrives as. */
export const RESEND_RECEIVED_EVENT = 'email.received'

/** `GET {endpoint}/{id}` — one received message with its text and headers. */
export const RESEND_RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving'

/** One received message, provider-neutral. Addresses are as the headers spelled them. */
export interface ReceivedEmail {
  /** The provider's id for the message — what a redelivered event repeats. */
  id: string
  /** The `Message-ID` header, angle brackets included, or `''`. */
  messageId: string
  /** The `In-Reply-To` header, or `''`. */
  inReplyTo: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  /** The addresses the provider received the message FOR — a forwarded alias's real target. */
  receivedFor: string[]
  subject: string
  text: string
  html: string
  /** When the provider received it, epoch ms; the read's clock when it said nothing usable. */
  receivedAtMs: number
}

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter((entry) => entry !== '')
    : typeof value === 'string' && value.trim()
      ? [value.trim()]
      : []

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A header by name, case-insensitively, off whatever map the provider sent. */
function header(headers: unknown, name: string): string {
  if (!headers || typeof headers !== 'object') return ''
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted) {
      return Array.isArray(value) ? String(value[0] ?? '').trim() : String(value ?? '').trim()
    }
  }
  return ''
}

/**
 * The provider's id of the message an `email.received` event announces,
 * or `null` for any other event — including a malformed one, which is
 * acknowledged and dropped rather than retried forever.
 */
export function resendReceivedEventId(event: unknown): string | null {
  const record = event as { type?: unknown; data?: { email_id?: unknown } } | null
  if (!record || record.type !== RESEND_RECEIVED_EVENT) return null
  const id = String(record.data?.email_id ?? '').trim()
  return id || null
}

/**
 * Every recipient the event names — To, Cc, Bcc and the addresses the
 * message was received for — so a route can find the capture token in the
 * metadata before it spends a read on the body.
 */
export function resendReceivedEventRecipients(event: unknown): string[] {
  const data = (event as { data?: Record<string, unknown> } | null)?.data ?? {}
  return [
    ...list(data['to']),
    ...list(data['cc']),
    ...list(data['bcc']),
    ...list(data['received_for']),
  ]
}

/**
 * One received message as the receiving API answers it, in the neutral
 * shape. `null` for a payload with no id, which is not a message.
 */
export function normalizeResendReceivedEmail(
  raw: unknown,
  nowMs: number = Date.now(),
): ReceivedEmail | null {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = String(record['id'] ?? '').trim()
  if (!id) return null
  const headers = record['headers']
  const created = Date.parse(String(record['created_at'] ?? ''))
  return {
    id,
    messageId: String(record['message_id'] ?? '').trim() || header(headers, 'message-id'),
    inReplyTo: header(headers, 'in-reply-to'),
    from: String(record['from'] ?? '').trim(),
    to: list(record['to']),
    cc: list(record['cc']),
    bcc: list(record['bcc']),
    receivedFor: list(record['received_for']),
    subject: String(record['subject'] ?? '').trim(),
    text: text(record['text']),
    html: text(record['html']),
    receivedAtMs: Number.isFinite(created) && created > 0 ? created : nowMs,
  }
}

/** Reads one received message by the provider's id; `null` when it has none. */
export type ReceivedEmailSource = (id: string) => Promise<ReceivedEmail | null>

/**
 * {@link ReceivedEmailSource} for Resend.
 *
 * Needs a FULL-ACCESS key: the sending-scoped `RESEND_API_KEY` answers
 * every read with `401 restricted_api_key`, which is the right posture for
 * the key that sends mail and the reason the console carries a separate
 * read key. A `404` is `null` — the message expired or never existed — and
 * anything else throws with the status, so the caller decides whether the
 * provider should retry.
 */
export function resendReceivedEmailSource(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): ReceivedEmailSource {
  return async (id) => {
    const response = await fetchImpl(
      `${RESEND_RECEIVING_ENDPOINT}/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    )
    if (response.status === 404) return null
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `received email read failed: HTTP ${response.status} ${detail.slice(0, 200)}`,
      )
    }
    return normalizeResendReceivedEmail(await response.json())
  }
}
