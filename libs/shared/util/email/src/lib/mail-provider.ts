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
 * WHO CARRIES THE MAIL — the one seam a sending vendor lives behind.
 *
 * `sendEmail` decides whether a message may leave, as whom and to whom; a
 * provider only carries what it is handed. The same split holds for every
 * other question the platform asks about mail — whether the credential
 * works, what a delivery webhook said, what a received message contained,
 * what the account already sent — so a provider answers them all in the
 * platform's own vocabulary, and nothing outside the provider reads a
 * vendor's wire format.
 *
 * ## The contract every provider owes
 *
 * 1. **`send` never refuses on policy.** Suppression, the send-rate
 *    governor, the phishing screen and the sending identity are decided
 *    before a provider is asked. A provider answers only "accepted", "not
 *    accepted", or "not now" (`rateLimited`), and throws only when it could
 *    not ask at all — which `sendEmail` reports as a network failure.
 * 2. **`missingSettings` names what an operator sets.** An empty list means
 *    the provider can send. The names are what an operator types into their
 *    environment, because they are printed in a skipped send's log line and
 *    on the staff email-health screen.
 * 3. **Everything past sending is optional.** A provider with no credential
 *    probe, no delivery feed or no read API leaves the member out, and the
 *    platform answers "this provider cannot tell us" rather than guessing.
 *
 * The providers themselves, and which one a deployment uses, are in
 * `mail-providers.ts`.
 */

import type { EmailCredentialReport } from './email-health'
import type {
  EmailDeliveryEvent,
  EmailDeliveryHistorySource,
  EmailDeliveryMessageSource,
} from './email-delivery-events'
import type { ReceivedEmailSource } from './received-email'
import type { EmailTag } from './send-email'

/** One message, fully decided, in the shape every provider is handed. */
export interface MailProviderMessage {
  /** The `From:` header value — a verified address, perhaps with a display name. */
  from: string
  /** At least one address; `sendEmail` never hands over an empty list. */
  to: string[]
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
  /** Attribution the delivery feed hands back, e.g. `context`, `campaignId`. */
  tags?: EmailTag[]
  replyTo?: string | string[]
}

/** What the provider said about one message. */
export type MailProviderSendResult =
  | { accepted: true; id: string | null }
  | {
      accepted: false
      /**
       * The provider asked for a slower pace, so the message is intact and a
       * later attempt sends it. Distinct from a refusal of the message
       * itself, which a batch settles and never retries.
       */
      rateLimited: boolean
      /** `rateLimited` only: the earliest instant a retry is welcome. */
      retryAtMs?: number
      /** HTTP status, when the provider answered over HTTP. */
      status?: number
      /** The provider's own words, untrimmed; the caller trims for storage. */
      detail: string
    }

/** A sending domain as the provider's account reports it. */
export interface MailSendingDomain {
  /** The domain name, lowercased. */
  name: string
  /** `verified` when the provider will accept mail on it. */
  status: string
  /** Whether links on it are rewritten to count clicks; `null` when unreported. */
  clickTracking: boolean | null
  /** The same, for the open pixel. */
  openTracking: boolean | null
}

/**
 * The provider's reads of its own account: history, one message, received
 * mail and sending domains. Kept apart from sending because a read usually
 * takes a wider credential than a send — a sending key that could enumerate
 * everyone the platform ever wrote to is a worse key to leak.
 */
export interface MailProviderReads {
  /**
   * Why reads cannot be made on this deployment — naming the setting to
   * add — or `null` when they can. The functions below throw while it is
   * non-null.
   */
  unmet(): string | null
  history: EmailDeliveryHistorySource
  message: EmailDeliveryMessageSource
  received: ReceivedEmailSource
  /** Every sending domain on the account. Throws when the read fails. */
  sendingDomains(): Promise<MailSendingDomain[]>
}

/** A received-mail notification, reduced to what a route needs before reading the body. */
export interface MailInboundEvent {
  /** The provider's id of the received message — what its reader takes. */
  id: string
  /** Every address the message was for: To, Cc, Bcc and any forwarded target. */
  recipients: string[]
}

export interface MailProvider {
  /** Stable slug, stored on delivery records and printed in logs. Never a display name. */
  readonly id: string
  /** Settings sending still needs, as an operator names them; empty when it can send. */
  missingSettings(): string[]
  /**
   * Hands one message to the provider. `context` names the sender for the
   * provider's own error text; it is already on the message as a tag.
   */
  send(
    message: MailProviderMessage,
    context?: string,
  ): Promise<MailProviderSendResult>
  /** Whether the credential is accepted, asked without sending anything. */
  checkCredentials?(): Promise<EmailCredentialReport>
  /** One delivery-webhook payload as zero or more events — one per recipient. */
  deliveryEvents?(payload: unknown, receivedAtMs: number): EmailDeliveryEvent[]
  /** A received-mail notification, or `null` for any other payload. */
  inboundEvent?(payload: unknown): MailInboundEvent | null
  reads?: MailProviderReads
}

/*==========================================
 * PACING ANSWERS OVER HTTP.
 *=========================================*/

/**
 * How long to wait when the provider names no interval of its own.
 *
 * One second, because a provider's rate limit is counted per second — so a
 * wait of a whole window is the shortest one that is certain to have
 * cleared it.
 */
const PROVIDER_RETRY_FALLBACK_MS = 1_000

/**
 * The longest wait a provider header may ask for.
 *
 * A `retry-after` is read off the network and reaches a scheduler, so it is
 * clamped rather than trusted: a header of `86400` would park a campaign for
 * a day on one response nobody saw. An hour is past every documented window
 * and short enough that a wrong one costs a run rather than a day.
 */
const PROVIDER_RETRY_MAX_MS = 3_600_000

/** One header as whole seconds, or null when it is absent or unreadable. */
function headerSeconds(
  headers: { get?: (name: string) => string | null } | null | undefined,
  name: string,
): number | null {
  const raw = headers?.get?.(name)
  // `Number(null)` and `Number('')` are both 0, which would read as "retry
  // immediately" for a header that is not there at all.
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

/**
 * When an HTTP provider says a refused request may be repeated.
 *
 * Read from the two headers HTTP APIs put beside a 429, both in whole
 * seconds: `retry-after` first because it is the direct answer to this
 * question, then `ratelimit-reset`, which names when the window rolls. A
 * response carrying neither falls back to one window.
 */
export function providerRetryAtMs(
  headers: { get?: (name: string) => string | null } | null | undefined,
  nowMs: number = Date.now(),
): number {
  const seconds =
    headerSeconds(headers, 'retry-after') ??
    headerSeconds(headers, 'ratelimit-reset')
  const waitMs =
    seconds === null
      ? PROVIDER_RETRY_FALLBACK_MS
      : Math.min(seconds * 1_000, PROVIDER_RETRY_MAX_MS)
  return nowMs + waitMs
}
