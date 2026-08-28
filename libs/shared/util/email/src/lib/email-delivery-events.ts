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
 * 2. **The history is ours.** The log is written into our own Firestore from
 *    these events, not fetched from the provider on demand. A provider's list
 *    endpoint is a different shape per vendor, has its own retention window,
 *    and disappears entirely with the account; a record we keep survives the
 *    migration that the seam exists to make possible.
 *
 * ## Pure on purpose
 *
 * No Firestore, no admin SDK, no `fetch`. `system-email-catalog` is imported
 * by console CLIENT components through this library's barrel, so anything
 * reachable from it that touched `firebase-admin` would drag the admin SDK
 * into a browser bundle. Normalisation is a pure function of a payload; the
 * writing lives in `@aglyn/tenant-data-admin/server/email-delivery-log`.
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
