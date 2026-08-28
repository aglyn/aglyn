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
 * WHAT HAPPENED TO A MESSAGE, IN OUR OWN VOCABULARY.
 *
 * ## The seam
 *
 * A staff answer to "did they get the invite, and did they open it?" must not
 * be a question about Resend. Two things follow from that, and this module is
 * both of them:
 *
 * 1. **The stored shape is ours.** Nothing downstream — the delivery log, the
 *    staff card, a future export — reads a provider's field names or its event
 *    strings. Swapping the sender changes exactly one function in this file
 *    and nothing else in the tree.
 * 2. **The history is ours.** The log is written into our own Firestore and
 *    read from there, never from the provider on render. A provider's list
 *    endpoint is a different shape per vendor, has its own retention window,
 *    and disappears entirely with the account; a record we keep survives the
 *    migration that the seam exists to make possible.
 *
 *    That is a rule about the READ PATH, not a rule against ever reading the
 *    provider. The event feed only knows mail sent after it was connected, so
 *    a log fed by events alone is empty for all existing history — which is
 *    precisely the mail a support question is about. The second half of this
 *    module (see THE READ SIDE OF THE SEAM below) imports that history
 *    through the same neutral vocabulary, once, into the same store.
 *
 * ## Pure on purpose
 *
 * No Firestore and no admin SDK. `system-email-catalog` is imported by console
 * CLIENT components through this library's barrel, so anything reachable from
 * it that touched `firebase-admin` would drag the admin SDK into a browser
 * bundle. Normalisation is a pure function of a payload; the writing lives in
 * `@aglyn/tenant-data-admin/server/email-delivery-log`.
 *
 * The one `fetch` is `resendDeliveryHistorySource`, which is a function that
 * must be CALLED with a key to do anything — it holds no module state and is
 * unreachable from a client component, unlike an admin-SDK import, which
 * executes on load.
 */

/**
 * The lifecycle of one message, in the order it normally happens.
 *
 * Chosen to be the intersection every ESP can report rather than the union of
 * what any one of them does: a vendor with no equivalent for a state simply
 * never produces it, and a vendor with a richer taxonomy folds into the
 * nearest of these rather than widening the type. `delayed` is retryable and
 * `failed` is not, which is the distinction a staffer actually needs.
 */
export type EmailDeliveryEventType =
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'failed'

/** Lifecycle states ordered worst-last, for {@link worstDeliveryStatus}. */
const STATUS_SEVERITY: Record<EmailDeliveryEventType, number> = {
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  delayed: 5,
  complained: 6,
  bounced: 7,
  failed: 8,
}

/**
 * One normalized delivery event.
 *
 * `at` is epoch milliseconds rather than a Firestore timestamp so this type
 * stays usable in a browser, in a test, and in whatever writes it next.
 */
export interface EmailDeliveryEvent {
  type: EmailDeliveryEventType
  /** When the PROVIDER says it happened, falling back to receipt time. */
  at: number
  /** Slug of the sending provider, e.g. `'resend'`. */
  provider: string
  /** The provider's id for the message. Our per-message document key. */
  providerMessageId: string
  /** Recipient, lowercased. One address per record even on a multi-recipient send. */
  to: string
  subject: string | null
  /**
   * The sender label `sendEmail` stamps on every message (`'invite'`,
   * `'password-reset'`, `'campaign'`, …). This is what makes the staff view
   * legible: without it a row says only that *an* email was sent.
   */
  context: string | null
  /** Everything else the send was tagged with, e.g. `hostId`, `campaignId`. */
  tags: Record<string, string>
  /** `clicked` only: the destination the recipient followed. */
  link: string | null
  /**
   * `bounced` only: whether the mailbox is gone (`permanent`) or the failure
   * was temporary. Lowercased, because providers disagree on capitalisation
   * and a staff filter must not depend on which one is in use.
   */
  bounceType: 'permanent' | 'transient' | 'undetermined' | null
  /** Provider-supplied explanation, for the states that carry one. */
  detail: string | null
}

/** The later of two statuses on the lifecycle, worst winning a tie. */
export function worstDeliveryStatus(
  current: EmailDeliveryEventType | null | undefined,
  next: EmailDeliveryEventType,
): EmailDeliveryEventType {
  if (!current) return next
  return STATUS_SEVERITY[next] >= STATUS_SEVERITY[current] ? next : current
}

/** Tags arrive as an array of `{name, value}` or a plain map — accept both. */
export function normalizeEventTags(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const map: Record<string, string> = {}
    for (const tag of raw) {
      if (tag?.name) map[String(tag.name)] = String(tag.value ?? '')
    }
    return map
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    )
  }
  return {}
}

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
 * Turns one Resend webhook payload into zero or more of our events — **the
 * only function in the tree that knows Resend's wire format.**
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

  return recipients.map((to: string) => ({
    type,
    at,
    provider: 'resend',
    providerMessageId,
    to,
    subject,
    context: tags['context'] || null,
    tags,
    link: type === 'clicked' ? String(data.click?.link ?? '') || null : null,
    bounceType: type === 'bounced' ? normalizeBounceType(data.bounce?.type) : null,
    detail:
      String(data.bounce?.message ?? data.failed?.reason ?? '').trim() || null,
  }))
}

/*==========================================
 * THE READ SIDE OF THE SEAM.
 *
 * The event feed above only ever knows about mail sent AFTER it was
 * connected. That is correct for the steady state and useless for the
 * question the staff card exists to answer, which is asked about mail that
 * has already gone out — so a delivery log fed only by events is empty
 * exactly when somebody needs it.
 *
 * A provider also holds the history, and reading it is not lock-in as long as
 * it happens through an interface. {@link EmailDeliverySnapshot} is that
 * interface: one message as the provider currently sees it, in our
 * vocabulary. `normalizeResendSentEmails` is the Resend implementation and
 * the second (and last) function in the tree that knows Resend's wire format.
 *
 * WHAT A SNAPSHOT DELIBERATELY DOES NOT CARRY
 *
 * Open and click COUNTS. Resend's list endpoint reports a single
 * `last_event` per message and no engagement detail, so a snapshot can say
 * "this was opened at least once" and can never say "three times". The
 * writer therefore treats a snapshot as a floor, never as truth that
 * overwrites what the event feed recorded — see `recordEmailDeliverySnapshot`.
 *=========================================*/

/** One message as the provider currently reports it, in our vocabulary. */
export interface EmailDeliverySnapshot {
  provider: string
  providerMessageId: string
  to: string
  subject: string | null
  /** Epoch ms the provider says the message was created. */
  sentAt: number
  /** Furthest state the provider reports. Never richer than the event feed. */
  status: EmailDeliveryEventType
}

/**
 * A provider's `last_event` string, mapped onto our lifecycle.
 *
 * Deliberately the bare state names rather than the `email.*` event names:
 * the list endpoint reports `"delivered"`, the webhook reports
 * `"email.delivered"`, and they are two different vocabularies for one
 * concept. Both are accepted here so a provider that unifies them later
 * needs no change.
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
    provider: 'resend',
    providerMessageId,
    to,
    subject: String(record.subject ?? '').trim() || null,
    sentAt,
    status,
  }))
}

/** One page of provider history, in our vocabulary. */
export interface EmailDeliveryHistoryPage {
  snapshots: EmailDeliverySnapshot[]
  /** Cursor for the next page, or null at the end. */
  nextCursor: string | null
}

/**
 * Reads one page of already-sent mail from a provider.
 *
 * The shape a second provider would implement. Cursor-based rather than
 * offset- or date-based because that is the lowest common denominator, and
 * NOT filtered by recipient: Resend's list endpoint has no recipient
 * parameter, so filtering is the caller's job and the import is a sweep
 * rather than a per-person lookup. That is the right shape regardless — a
 * staff page must not fan out to a third party on render.
 */
export type EmailDeliveryHistorySource = (options: {
  cursor?: string | null
  limit?: number
}) => Promise<EmailDeliveryHistoryPage>

/** Resend's list endpoint. Paginates with `after=<id>`; caps at 100. */
export const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails'

/**
 * {@link EmailDeliveryHistorySource} for Resend.
 *
 * Needs a FULL-ACCESS key: a sending-scoped key answers every read on this
 * endpoint with `401 restricted_api_key`, which is the correct posture for
 * the key that sends mail and the reason this takes its own.
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

/*==========================================
 * ONE MESSAGE, RENDERED.
 *
 * The log records what HAPPENED to a message; it does not keep the message.
 * Storing every body would put an unbounded copy of every email we have ever
 * sent — including reset links and receipts — into our own database, to
 * duplicate something the provider already holds.
 *
 * So a body is fetched when a staffer explicitly opens one row. That is a
 * deliberate single lookup, not the per-render fan-out the read path refuses:
 * one message, on one click, by id.
 *=========================================*/

/** One message's content and envelope, in our vocabulary. */
export interface EmailDeliveryMessage {
  provider: string
  providerMessageId: string
  to: string[]
  cc: string[]
  bcc: string[]
  from: string | null
  replyTo: string[] | null
  subject: string | null
  /** The HTML part, or null when the message was sent as text only. */
  html: string | null
  /** The plain-text part, or null. */
  text: string | null
  sentAt: number | null
  status: EmailDeliveryEventType | null
}

/** A single message by id. The shape a second provider would implement. */
export type EmailDeliveryMessageSource = (
  providerMessageId: string,
) => Promise<EmailDeliveryMessage | null>

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
    provider: 'resend',
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

/** Resend's single-message endpoint. Needs the same full-access key. */
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
