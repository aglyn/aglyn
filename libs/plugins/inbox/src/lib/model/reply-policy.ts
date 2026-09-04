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
 * What may be replied to, and what the reply says on the envelope.
 *
 * Pure policy, no Firestore and no network, so the rules that decide whether
 * a message leaves the building can be asserted without a send path. The
 * handler in `../server.ts` is the only caller.
 *
 * ## A reply is transactional, and that is a consent decision
 *
 * Someone filled in a form and asked to be contacted. Answering them is the
 * transaction they initiated, so no marketing-consent record is required and
 * none is read here. The opposite direction does not follow: replying is not
 * permission to market to them, so nothing in this module enrolls anybody in
 * anything. Enrollment is a separate act with a separate basis and it is
 * deliberately not built — see `docs/specs/inbox-replies-and-list-assignment.md`.
 *
 * ## Suppression is not waived by that
 *
 * "Transactional" excuses the absence of consent, never a suppression. A hard
 * bounce means the mailbox does not exist, and a spam complaint means the
 * person asked this platform to stop; both answers are about the address
 * rather than the campaign that learned them, and both apply to a reply.
 * The suppression read itself needs Firestore, so it lives in the handler;
 * what lives here is the ordering it must follow.
 */

import type { AddressRefusal } from '@aglyn/aglyn/server'
import { submissionSender } from './submission-presenter'

/**
 * Why an address cannot be replied to. Each maps to one refusal message.
 *
 * The framework's `AddressRefusal` under a reply-shaped name, not a second
 * union that happens to match. These four are facts about the ADDRESS — no
 * email field, an unroutable value, and the two suppression lists — so the
 * enrollment policy refuses on exactly the same set, and two declarations
 * would drift the moment either side gained a fifth. A `type` import: erased
 * at compile time, so the client component that reads this file takes on
 * nothing from `@aglyn/aglyn/server`.
 */
export type ReplyRefusal = AddressRefusal

/** The longest reply the composer accepts, matching the campaign composer. */
export const REPLY_BODY_MAX = 20000

/** Subjects longer than this are truncated by most clients anyway. */
export const REPLY_SUBJECT_MAX = 150

/**
 * The address a reply to this submission would go to, or why there is none.
 *
 * Resolved from the submission's own `fields`, never from the request body.
 * The recipient of a message this platform sends must be a property of the
 * stored record, not an argument a caller supplies: a site editor who could
 * name the recipient would have a send surface pointed at any address, on a
 * verified domain, in the platform's own name.
 *
 * It resolves through `submissionSender`, which is what the Inbox row already
 * displays, so the address the merchant is shown is the address that is
 * mailed. A second resolver here would be a second answer to "who is this
 * from", and the two would disagree on some form eventually.
 */
export function replyRecipient(
  fields: Record<string, unknown> | undefined,
): { email: string } | { refusal: ReplyRefusal } {
  const email = submissionSender(fields).email
  if (!email) return { refusal: 'no-address' }
  const normalized = email.trim().toLowerCase()
  if (!isRoutableAddress(normalized)) return { refusal: 'unroutable-address' }
  return { email: normalized }
}

/**
 * A deliberately narrow shape test: one `@`, something either side, a dot in
 * the domain, and no whitespace.
 *
 * It is not RFC 5322 and does not try to be. The question being answered is
 * "would handing this to the provider produce a rejected send", and the
 * addresses that reach here came out of a public form's free-text field, so
 * the common failures are a stray comma, a pasted `mailto:` and a name in
 * angle brackets — all of which this refuses.
 *
 * The colon is in the excluded set for the `mailto:` case specifically: it is
 * not valid in an unquoted local part, and without it `mailto:priya@lumen.co`
 * matches with `mailto:priya` as the local part and is handed to the provider
 * whole.
 */
export function isRoutableAddress(value: string): boolean {
  return /^[^\s@,;:<>]+@[^\s@,;:<>]+\.[^\s@,;:<>]+$/.test(String(value ?? ''))
}

/**
 * The default subject, which the merchant may then edit.
 *
 * `Re:` is a small lie and it is the right one: the recipient never received
 * a message from us, because the submission arrived over HTTP, so there is
 * nothing to be `Re:` to. But the prefix is what a person scanning an inbox
 * reads as "this answers the thing I sent", and it is what every mail client
 * groups on when the recipient replies again. The alternative — a bare
 * subject — reads as an unsolicited message from a domain they do not know.
 *
 * The site name leads because that is what the recipient recognizes. They
 * filled in a form on a site; they do not know the form's internal name and
 * they have never heard of this platform.
 */
export function defaultReplySubject(
  siteName: string | undefined,
  formName: string | undefined,
): string {
  const site = String(siteName ?? '').trim()
  const form = String(formName ?? '').trim()
  const topic = site || form || 'your message'
  return `Re: your message to ${topic}`.slice(0, REPLY_SUBJECT_MAX)
}

/**
 * The reply body as it goes on the wire.
 *
 * Plain text only. `sendEmail` synthesizes the HTML part from it, which is
 * the one place that guarantee lives — a caller that built its own HTML here
 * would be a caller that can get it wrong, and an empty HTML part is a
 * message whose links cannot be clicked or counted.
 *
 * The quoted original is appended rather than left to the merchant, because
 * a recipient who wrote a week ago has no idea which of their messages this
 * answers, and the merchant retyping it is how a support thread loses the
 * question it was about.
 */
export function composeReplyBody(options: {
  message: string
  fields?: Record<string, unknown>
  siteName?: string
}): string {
  const message = String(options.message ?? '')
    .trim()
    .slice(0, REPLY_BODY_MAX)
  const quoted = quoteSubmission(options.fields)
  const site = String(options.siteName ?? '').trim()
  const attribution = site
    ? `This is a reply to the message you sent through ${site}.`
    : 'This is a reply to the message you sent through our website.'
  return quoted
    ? `${message}\n\n---\n${attribution}\n\n${quoted}`
    : `${message}\n\n---\n${attribution}`
}

/**
 * The original submission, rendered as `Label: value` lines.
 *
 * Field order is the author's, which is the order the visitor filled them in
 * and therefore the order they will recognize. Empty values are dropped: a
 * quote full of `Phone:` with nothing after it reads as a broken template.
 */
export function quoteSubmission(
  fields: Record<string, unknown> | undefined,
): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(fields ?? {})) {
    const text = String(value ?? '').trim()
    if (!text) continue
    lines.push(`> ${key}: ${text}`)
  }
  return lines.join('\n')
}
