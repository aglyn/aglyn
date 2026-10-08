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
 * RESEND, as one {@link MailProvider} — the only module in the platform that
 * knows Resend's endpoints, payloads, event names and error names.
 *
 * It is the provider a deployment gets when it names none, which is how
 * every deployment that set `RESEND_API_KEY` before the contract existed
 * keeps sending exactly as it did. Two credentials, on purpose:
 *
 * - `RESEND_API_KEY` sends. It is provisioned sending-scoped, so a leaked
 *   copy cannot enumerate everyone the platform ever wrote to.
 * - `RESEND_READ_API_KEY` is full-access and only ever reads: history, one
 *   message's body, received mail and the account's sending domains. A
 *   sending-scoped key answers every such read `401 restricted_api_key`.
 *
 * Pure but for the `fetch` calls, each inside a function that must be called
 * to do anything, so a client component that reaches this module through the
 * library's barrel executes nothing on load.
 */

import {
  bareSenderAddress,
  normalizeEventTags,
  type EmailDeliveryEvent,
  type EmailDeliveryEventType,
  type EmailDeliveryHistorySource,
  type EmailDeliveryMessage,
  type EmailDeliveryMessageSource,
  type EmailDeliverySnapshot,
} from './email-delivery-events'
import type { EmailCredentialReport } from './email-health'
import { readBounceText } from './mail-bounce'
import {
  providerRetryAtMs,
  type MailInboundEvent,
  type MailProvider,
  type MailProviderMessage,
  type MailProviderReads,
  type MailProviderSendResult,
  type MailSendingDomain,
} from './mail-provider'
import type { ReceivedEmail, ReceivedEmailSource } from './received-email'

/** The slug stored on every delivery record this provider produces. */
export const RESEND_PROVIDER_ID = 'resend'

/** The sending key's environment variable. */
export const RESEND_SEND_KEY_SETTING = 'RESEND_API_KEY'

/** The full-access read key's environment variable. */
export const RESEND_READ_KEY_SETTING = 'RESEND_READ_API_KEY'

type Env = Record<string, string | undefined>

function setting(env: Env, name: string): string {
  return String(env[name] ?? '').trim()
}

/*==========================================
 * SENDING.
 *=========================================*/

/** The send endpoint. */
export const RESEND_SEND_ENDPOINT = 'https://api.resend.com/emails'

/** A Resend send payload in the provider's own wire shape. */
export interface ResendSendPayload {
  to?: unknown
  from?: unknown
  subject?: unknown
  [field: string]: unknown
}

/**
 * The one place that POSTs to Resend's send endpoint, and the last thing
 * standing between a payload and the network.
 *
 * A payload carrying no recipient cannot become a message. Resend answers it
 * `422 missing_required_field`, which costs an API call and then shows up in
 * the vendor dashboard as a red line indistinguishable from mail that
 * genuinely failed to deliver — carrying no subject, no recipient and nothing
 * naming the code that produced it. Diagnosing that means reading a log
 * outside the deployment and guessing. So the refusal happens here, before
 * the fetch, and names the caller's `context`.
 *
 * It throws rather than returning a result: this is a programming error,
 * not a delivery outcome. `sendEmail` filters recipients well before it
 * reaches this call, so nothing on the ordinary path can trip it. The guard
 * exists because `RESEND_SEND_ENDPOINT` is exported and any module can
 * therefore reach the send endpoint on its own, bypassing every check
 * `sendEmail` owns.
 */
export async function postResendEmail(
  apiKey: string,
  payload: ResendSendPayload,
  context?: string,
): Promise<Response> {
  const raw = payload?.to
  const recipients = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .map((address) => String(address ?? '').trim())
    .filter(Boolean)
  if (!recipients.length) {
    throw new Error(
      `${context ? `${context} ` : ''}send refused before the network — a ` +
        'Resend payload with no `to` field cannot become a message, and the ' +
        'attempt would surface only as a 422 in the Resend dashboard',
    )
  }

  return fetch(RESEND_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** One message as Resend's send endpoint takes it. */
export function resendSendPayload(message: MailProviderMessage): ResendSendPayload {
  return {
    from: message.from,
    to: message.to,
    subject: message.subject,
    ...(message.text ? { text: message.text } : {}),
    ...(message.html ? { html: message.html } : {}),
    ...(message.headers && Object.keys(message.headers).length
      ? { headers: message.headers }
      : {}),
    ...(message.tags?.length ? { tags: message.tags } : {}),
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    ...(message.bcc?.length ? { bcc: message.bcc } : {}),
  }
}

/**
 * Sends one message and reads the answer.
 *
 * A 429 is a request to slow down, not a statement about the recipient, so
 * it comes back `rateLimited` with the wait Resend asked for. Its quota
 * errors — `daily_quota_exceeded`, `monthly_quota_exceeded` — are 429s as
 * well, and clear with time the same way.
 */
async function sendThroughResend(
  apiKey: string,
  message: MailProviderMessage,
  context?: string,
): Promise<MailProviderSendResult> {
  const response = await postResendEmail(apiKey, resendSendPayload(message), context)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 429) {
      return {
        accepted: false,
        rateLimited: true,
        retryAtMs: providerRetryAtMs(response.headers),
        status: response.status,
        detail,
      }
    }
    return { accepted: false, rateLimited: false, status: response.status, detail }
  }
  const body = (await response.json().catch(() => null)) as { id?: string } | null
  return { accepted: true, id: body?.id ?? null }
}

/*==========================================
 * THE CREDENTIAL PROBE.
 *=========================================*/

/**
 * Where the credential probe and the domain read ask their questions.
 *
 * Deliberately NOT the send endpoint. A probe aimed at `/emails` is a send
 * attempt however empty its body is: it consumes an API call, and Resend
 * records it in the account's logs as a `422` on `POST /emails` with no
 * recipient, no subject and nothing identifying the caller — a line an
 * operator reading that dashboard has to treat as failed mail. A domain read
 * cannot create a message and cannot be mistaken for one.
 */
export const RESEND_DOMAINS_ENDPOINT = 'https://api.resend.com/domains'

/**
 * Error names that mean the key itself was not accepted, as opposed to a key
 * that authenticated and merely lacks read scope. Matched by NAME, not
 * status: `401` and `403` each cover both meanings.
 */
const REFUSED_KEY_ERRORS = new Set([
  'missing_api_key',
  'validation_error',
  'suspended_api_key',
])

/**
 * Error names that mean the key authenticated and was then denied this
 * particular read. A sending-scoped key — the shape Aglyn provisions — always
 * lands here, and reaching this answer at all required Resend to recognize
 * the credential, which is exactly what the probe is asking.
 */
const AUTHENTICATED_BUT_UNSCOPED_ERRORS = new Set([
  'restricted_api_key',
  'invalid_permission',
])

/** The `name` Resend puts on an error body, or `''` for anything else. */
function resendErrorName(body: string): string {
  try {
    const parsed = JSON.parse(body) as { name?: unknown }
    return typeof parsed?.name === 'string' ? parsed.name : ''
  } catch {
    return ''
  }
}

/**
 * Whether the sending key is accepted — without sending anything to anybody,
 * and without leaving anything behind that reads as failed mail.
 *
 * How: a `GET` of the domains collection. The question is only ever "does
 * Resend recognize this credential", so the probe reads the ERROR NAME rather
 * than the status, because `401` and `403` each carry both meanings:
 *
 * - `2xx` — the key is accepted and has read scope → `ok`
 * - `restricted_api_key` / `invalid_permission` — Resend authenticated the
 *   key and then denied it this read. A sending-scoped key always answers
 *   this way, and getting the answer proves the credential works → `ok`
 * - `missing_api_key` / `validation_error` / `suspended_api_key` — the key
 *   itself was refused → `invalid-key`
 * - anything else → `unknown`
 *
 * An unrecognized rejection is `unknown`, never `invalid-key`: this feeds a
 * staff diagnostics screen whose whole value is that a red line means
 * something, and a shape we have not seen before is not evidence that a
 * working key is broken.
 */
export async function checkResendCredentials(
  apiKey: string,
): Promise<EmailCredentialReport> {
  if (!apiKey) return { status: 'unconfigured' }
  try {
    const response = await fetch(RESEND_DOMAINS_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const detail = (await response.text().catch(() => '')).slice(0, 300)

    if (response.status >= 200 && response.status < 300) {
      return { status: 'ok', probeStatus: response.status }
    }
    if (response.status === 401 || response.status === 403) {
      const name = resendErrorName(detail)
      if (AUTHENTICATED_BUT_UNSCOPED_ERRORS.has(name)) {
        return { status: 'ok', probeStatus: response.status }
      }
      if (REFUSED_KEY_ERRORS.has(name)) {
        return { status: 'invalid-key', probeStatus: response.status, detail }
      }
    }
    return { status: 'unknown', probeStatus: response.status, detail }
  } catch (error) {
    return {
      status: 'unknown',
      detail: String((error as Error)?.message ?? error).slice(0, 300),
    }
  }
}

/**
 * Every sending domain on the account, with its verification and tracking
 * state. Throws with the status when Resend does not answer 2xx, so a caller
 * never reads "I could not look" as "there is nothing there".
 */
export async function readResendSendingDomains(
  apiKey: string,
  endpoint: string = RESEND_DOMAINS_ENDPOINT,
): Promise<MailSendingDomain[]> {
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The provider answered ${response.status} to the domain read.`)
  }
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: Array<{
          name?: unknown
          status?: unknown
          click_tracking?: unknown
          open_tracking?: unknown
        }>
      }
    | null
  /**
   * A tri-state, and the third state matters: a listing that does not carry
   * the field must not be reported as the field being false. Off is a fault
   * somebody should fix; unknown is a question this read could not ask.
   */
  const flag = (value: unknown): boolean | null =>
    typeof value === 'boolean' ? value : null
  const domains: MailSendingDomain[] = []
  for (const row of payload?.data ?? []) {
    const name = String(row?.name ?? '').toLowerCase()
    if (!name) continue
    domains.push({
      name,
      status: String(row?.status ?? 'unknown'),
      clickTracking: flag(row?.click_tracking),
      openTracking: flag(row?.open_tracking),
    })
  }
  return domains
}

/*==========================================
 * THE DELIVERY FEED.
 *=========================================*/

/** Epoch ms from an ISO string or a number, or `null` when unreadable. */
function eventTimeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBounceType(
  value: unknown,
): EmailDeliveryEvent['bounceType'] {
  const lowered = String(value ?? '')
    .trim()
    .toLowerCase()
  if (lowered === 'permanent') return 'permanent'
  if (lowered === 'transient') return 'transient'
  return lowered ? 'undetermined' : null
}

/** The Resend event names we understand, mapped onto ours. */
const RESEND_EVENT_TYPES: Record<string, EmailDeliveryEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
}

/**
 * Turns one Resend webhook payload into zero or more of our events.
 *
 * One event per recipient, not per message: a send addressed to three people
 * produces one webhook, and a staff view keyed on a person has to be able to
 * find it under each of them.
 *
 * Returns an empty array for anything unrecognised — a contact or domain
 * event, an inbound `email.received`, a type added after this was written.
 * Silence rather than a throw, because a webhook handler that 500s on an
 * unfamiliar event teaches the provider to retry it forever.
 *
 * @param payload The parsed webhook body.
 * @param receivedAtMs Fallback timestamp for a payload that carries none.
 */
export function normalizeResendDeliveryEvents(
  payload: unknown,
  receivedAtMs: number,
): EmailDeliveryEvent[] {
  const event = (payload ?? {}) as Record<string, any>
  const type = RESEND_EVENT_TYPES[String(event.type ?? '')]
  if (!type) return []

  const data = (event.data ?? {}) as Record<string, any>
  const providerMessageId = String(data.email_id ?? data.id ?? '').trim()
  if (!providerMessageId) return []

  const recipients = (Array.isArray(data.to) ? data.to : [data.to])
    .map((address: unknown) => String(address ?? '').trim().toLowerCase())
    .filter((address: string) => address.includes('@'))
  if (!recipients.length) return []

  // The per-state timestamp when the provider gives one, because an open
  // three days after the send is the whole point of recording an open.
  const at =
    eventTimeMs(data.click?.timestamp) ??
    eventTimeMs(data.open?.timestamp) ??
    eventTimeMs(event.created_at) ??
    eventTimeMs(data.created_at) ??
    receivedAtMs

  const subject = String(data.subject ?? '').trim() || null
  const tags = normalizeEventTags(data.tags)
  const from = bareSenderAddress(data.from)
  // The provider folds a DSN's fields into one sentence; the structured
  // ones are read first where a payload carries them.
  const bounceText =
    type === 'bounced'
      ? readBounceText(
          [data.bounce?.diagnosticCode, data.bounce?.diagnostic_code, data.bounce?.remoteMta, data.bounce?.remote_mta, data.bounce?.message]
            .filter((part: unknown) => typeof part === 'string' && part.trim())
            .join(' '),
        )
      : null

  return recipients.map((to: string) => ({
    type,
    at,
    provider: RESEND_PROVIDER_ID,
    providerMessageId,
    to,
    subject,
    context: tags['context'] || null,
    tags,
    link: type === 'clicked' ? String(data.click?.link ?? '') || null : null,
    bounceType: type === 'bounced' ? normalizeBounceType(data.bounce?.type) : null,
    detail:
      String(data.bounce?.message ?? data.failed?.reason ?? '').trim() || null,
    ...(from ? { from } : {}),
    ...(bounceText?.status ? { bounceStatus: bounceText.status } : {}),
    ...(bounceText?.remoteMta ? { remoteMta: bounceText.remoteMta } : {}),
  }))
}

/*==========================================
 * THE ACCOUNT'S HISTORY.
 *
 * Resend's list endpoint reports a single `last_event` per message and no
 * engagement detail, so a snapshot can say "this was opened at least once"
 * and can never say "three times" — see `EmailDeliverySnapshot`.
 *=========================================*/

/**
 * A `last_event` string, mapped onto our lifecycle.
 *
 * Deliberately the bare state names rather than the `email.*` event names:
 * the list endpoint reports `"delivered"`, the webhook reports
 * `"email.delivered"`, and they are two different vocabularies for one
 * concept.
 */
const RESEND_LAST_EVENTS: Record<string, EmailDeliveryEventType> = {
  sent: 'sent',
  delivered: 'delivered',
  delivery_delayed: 'delayed',
  opened: 'opened',
  clicked: 'clicked',
  bounced: 'bounced',
  complained: 'complained',
  failed: 'failed',
  canceled: 'failed',
  queued: 'sent',
  scheduled: 'sent',
}

/**
 * Turns one entry from Resend's `GET /emails` list into zero or more
 * snapshots — one per recipient, for the same reason the event adapter fans
 * out: the staff view is keyed on a person.
 *
 * An unrecognised `last_event` falls back to `sent` rather than being
 * dropped. The message demonstrably exists and was addressed to somebody, and
 * "we sent this and cannot characterise what happened next" is a far more
 * useful row than no row — which is the state that sent a staffer to the
 * vendor dashboard in the first place.
 */
export function normalizeResendSentEmails(
  raw: unknown,
): EmailDeliverySnapshot[] {
  const record = (raw ?? {}) as Record<string, any>
  const providerMessageId = String(record.id ?? '').trim()
  if (!providerMessageId) return []

  const recipients = (Array.isArray(record.to) ? record.to : [record.to])
    .map((address: unknown) => String(address ?? '').trim().toLowerCase())
    .filter((address: string) => address.includes('@'))
  if (!recipients.length) return []

  const parsed = Date.parse(String(record.created_at ?? ''))
  const sentAt = Number.isFinite(parsed) ? parsed : 0
  // A snapshot with no timestamp cannot be ordered, and the log's read drops
  // any document missing its sort key — so it is refused rather than written
  // somewhere nothing will look for it.
  if (!sentAt) return []

  const status =
    RESEND_LAST_EVENTS[
      String(record.last_event ?? '')
        .trim()
        .toLowerCase()
    ] ?? 'sent'

  return recipients.map((to: string) => ({
    provider: RESEND_PROVIDER_ID,
    providerMessageId,
    to,
    subject: String(record.subject ?? '').trim() || null,
    sentAt,
    status,
  }))
}

/** The list endpoint. Paginates with `after=<id>`; caps at 100. */
export const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails'

/**
 * {@link EmailDeliveryHistorySource} for Resend. Needs the full-access key.
 *
 * The list endpoint takes `limit`, `after` and `before` and no recipient
 * filter, which is why the source is a cursor-paged sweep.
 */
export function resendDeliveryHistorySource(
  apiKey: string,
): EmailDeliveryHistorySource {
  return async ({ cursor, limit } = {}) => {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(1, limit ?? 100), 100)),
    })
    if (cursor) params.set('after', cursor)
    const response = await fetch(`${RESEND_EMAILS_ENDPOINT}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `email history read failed: HTTP ${response.status} ${detail.slice(0, 200)}`,
      )
    }
    const body = (await response.json()) as {
      data?: unknown[]
      has_more?: boolean
    }
    const entries = Array.isArray(body?.data) ? body.data : []
    const snapshots = entries.flatMap((entry) => normalizeResendSentEmails(entry))
    // The cursor is the LAST RAW entry's id, not the last snapshot's: a page
    // whose final entry fanned out to zero snapshots (no recipient, no
    // timestamp) would otherwise rewind the cursor to an earlier message and
    // loop over the same page forever.
    const lastId = String(
      (entries[entries.length - 1] as { id?: unknown })?.id ?? '',
    ).trim()
    return {
      snapshots,
      nextCursor: body?.has_more && lastId ? lastId : null,
    }
  }
}

function addressList(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .map((address) => String(address ?? '').trim())
    .filter(Boolean)
}

/** Resend's `GET /emails/:id` payload, in our vocabulary. */
export function normalizeResendMessage(raw: unknown): EmailDeliveryMessage | null {
  const record = (raw ?? {}) as Record<string, any>
  const providerMessageId = String(record.id ?? '').trim()
  if (!providerMessageId) return null
  const parsed = Date.parse(String(record.created_at ?? ''))
  return {
    provider: RESEND_PROVIDER_ID,
    providerMessageId,
    to: addressList(record.to),
    cc: addressList(record.cc),
    bcc: addressList(record.bcc),
    from: String(record.from ?? '').trim() || null,
    replyTo: addressList(record.reply_to).length
      ? addressList(record.reply_to)
      : null,
    subject: String(record.subject ?? '').trim() || null,
    // Empty string is NOT null here, and the difference is the point: a
    // message that went out text-only really does have an empty HTML part,
    // and a reader has to be able to tell that from "we could not fetch it".
    html: typeof record.html === 'string' ? record.html : null,
    text: typeof record.text === 'string' ? record.text : null,
    sentAt: Number.isFinite(parsed) ? parsed : null,
    status:
      RESEND_LAST_EVENTS[
        String(record.last_event ?? '')
          .trim()
          .toLowerCase()
      ] ?? null,
  }
}

/** Resend's single-message endpoint. Needs the full-access key. */
export function resendDeliveryMessageSource(
  apiKey: string,
): EmailDeliveryMessageSource {
  return async (providerMessageId: string) => {
    const response = await fetch(
      `${RESEND_EMAILS_ENDPOINT}/${encodeURIComponent(providerMessageId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    )
    // A message the provider has aged out is a 404, and that is an ANSWER —
    // "we know this was sent and the body is gone" — not a failure to report
    // as an error the staffer must act on.
    if (response.status === 404) return null
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `message read failed: HTTP ${response.status} ${detail.slice(0, 200)}`,
      )
    }
    return normalizeResendMessage(await response.json())
  }
}

/*==========================================
 * RECEIVED MAIL.
 *
 * Resend announces a received message as an `email.received` webhook that
 * carries only its metadata — who it was from and to, its subject, its
 * `Message-ID` — and the message itself is read afterwards from the
 * receiving API by the id the event named.
 *=========================================*/

/** The webhook event type a received message arrives as. */
export const RESEND_RECEIVED_EVENT = 'email.received'

/** `GET {endpoint}/{id}` — one received message with its text and headers. */
export const RESEND_RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving'

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
 * message was received for — so a route can find what it is looking for in
 * the metadata before it spends a read on the body.
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

/**
 * {@link ReceivedEmailSource} for Resend. Needs the full-access key. A `404`
 * is `null` — the message expired or never existed — and anything else
 * throws with the status, so the caller decides whether the provider should
 * retry.
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

/** A received-mail notification, or `null` for any other event. */
export function resendInboundEvent(event: unknown): MailInboundEvent | null {
  const id = resendReceivedEventId(event)
  return id ? { id, recipients: resendReceivedEventRecipients(event) } : null
}

/*==========================================
 * THE PROVIDER.
 *=========================================*/

/**
 * Resend as a {@link MailProvider}, reading its two keys from `env` at each
 * call — never at module load, because these run in serverless handlers
 * whose module may be evaluated during a build, long before the runtime
 * environment exists.
 */
export function resendMailProvider(
  env: Env = process.env as Env,
): MailProvider {
  const sendKey = () => setting(env, RESEND_SEND_KEY_SETTING)
  const readKey = () => {
    const key = setting(env, RESEND_READ_KEY_SETTING)
    if (!key) throw new Error(`${RESEND_READ_KEY_SETTING} is not set`)
    return key
  }
  const reads: MailProviderReads = {
    unmet: () =>
      setting(env, RESEND_READ_KEY_SETTING)
        ? null
        : `Set ${RESEND_READ_KEY_SETTING} to a full-access key. The sending ` +
          'key cannot read mail.',
    // Async, so a missing key REJECTS like every other failed read rather
    // than throwing before the caller has a promise to catch.
    history: async (options) => resendDeliveryHistorySource(readKey())(options),
    message: async (id) => resendDeliveryMessageSource(readKey())(id),
    received: async (id) => resendReceivedEmailSource(readKey())(id),
    sendingDomains: async () => readResendSendingDomains(readKey()),
  }
  return {
    id: RESEND_PROVIDER_ID,
    missingSettings: () => (sendKey() ? [] : [RESEND_SEND_KEY_SETTING]),
    send: (message, context) => sendThroughResend(sendKey(), message, context),
    checkCredentials: () => checkResendCredentials(sendKey()),
    deliveryEvents: normalizeResendDeliveryEvents,
    inboundEvent: resendInboundEvent,
    reads,
  }
}
