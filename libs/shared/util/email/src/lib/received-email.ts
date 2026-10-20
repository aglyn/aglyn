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
 * A provider that receives mail announces each message with a notification
 * that carries its metadata, and the message itself is read afterwards by
 * the id the notification named. Both halves are the provider's to read —
 * its `inboundEvent` and `reads.received` (see `mail-provider.ts`) — and
 * both answer in the neutral {@link ReceivedEmail} everything downstream
 * works with, so a route that files received mail never reads a vendor's
 * payload.
 */

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
  /**
   * Whether its headers say a machine sent it — an out-of-office, a vacation
   * responder ({@link isAutoSubmittedMail}). Absent from a reader that sees
   * no headers, which reads as a person.
   */
  autoSubmitted?: boolean
}

/**
 * Whether a message's headers say a machine sent it rather than a person
 * (RFC 3834, AGL-3997): an `Auto-Submitted` other than `no`, the
 * `X-Autoreply` or `X-Autorespond` older responders stamp instead, or
 * `Precedence: auto_reply`. A route that files received mail skips these,
 * so an out-of-office answering an email never becomes a request.
 *
 * `Precedence: list` and `bulk` are deliberately not read: a mailbox that
 * delivers a group's mail onward stamps them on every message a person
 * wrote. `header` answers a header's value by name, `''` when it is absent.
 */
export function isAutoSubmittedMail(header: (name: string) => string): boolean {
  const submitted = header('auto-submitted').split(';')[0].trim().toLowerCase()
  if (submitted && submitted !== 'no') return true
  for (const name of ['x-autoreply', 'x-autorespond']) {
    const value = header(name).trim().toLowerCase()
    if (value && value !== 'no') return true
  }
  return header('precedence').trim().toLowerCase() === 'auto_reply'
}

/** Reads one received message by the provider's id; `null` when it has none. */
export type ReceivedEmailSource = (id: string) => Promise<ReceivedEmail | null>
