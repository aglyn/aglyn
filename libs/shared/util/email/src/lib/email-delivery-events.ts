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
 * be a question about one sending vendor. Two things follow from that, and
 * this module is both of them:
 *
 * 1. **The stored shape is ours.** Nothing downstream — the delivery log, the
 *    staff card, a future export — reads a provider's field names or its event
 *    strings. A provider turns its own wire format into these types (its
 *    `deliveryEvents` and `reads`, see `mail-provider.ts`), and swapping the
 *    sender changes that provider and nothing else in the tree.
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
 *    module (see THE READ SIDE OF THE SEAM below) is the vocabulary that
 *    history is imported through, once, into the same store.
 *
 * ## Pure on purpose
 *
 * No Firestore and no admin SDK. `system-email-catalog` is imported by console
 * CLIENT components through this library's barrel, so anything reachable from
 * it that touched `firebase-admin` would drag the admin SDK into a browser
 * bundle. Normalisation is a pure function of a payload; the writing lives in
 * `@aglyn/tenant-data-admin/server/email-delivery-log`, and the reading
 * of a provider's payloads in that provider.
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
  /** Slug of the sending provider — the `id` of the provider that carried it. */
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
  /**
   * The bare sender address, lowercased: the domain it names is the sending
   * domain a gateway's verdict is filed against (AGL-3328). Absent from
   * events normalized before it existed, and `null` when the provider sent
   * none.
   */
  from?: string | null
  /**
   * `bounced` only: the enhanced status code (`5.7.1`) and the receiving
   * server the provider's bounce message names, read by `readBounceText` —
   * what a Gmail DSN hands over as `Status` and `Remote-MTA` (AGL-3328).
   */
  bounceStatus?: string | null
  remoteMta?: string | null
}

/** The bare address of a `From:` value (`"Acme" <hi@acme.com>` → `hi@acme.com`), lowercased. */
export function bareSenderAddress(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  const angle = raw.match(/<([^>]+)>/)
  const address = (angle ? angle[1] : raw).trim().toLowerCase()
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null
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
 * vocabulary, read through the provider's `reads.history`.
 *
 * WHAT A SNAPSHOT DELIBERATELY DOES NOT CARRY
 *
 * Open and click COUNTS. A provider's list typically reports one latest
 * state per message and no engagement detail, so a snapshot can say "this
 * was opened at least once" and can never say "three times". The writer
 * therefore treats a snapshot as a floor, never as truth that overwrites
 * what the event feed recorded — see `recordEmailDeliverySnapshot`.
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
 * NOT filtered by recipient: a provider's list endpoint need not take one,
 * so filtering is the caller's job and the import is a sweep rather than a
 * per-person lookup. That is the right shape regardless — a staff page must
 * not fan out to a third party on render.
 */
export type EmailDeliveryHistorySource = (options: {
  cursor?: string | null
  limit?: number
}) => Promise<EmailDeliveryHistoryPage>

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
