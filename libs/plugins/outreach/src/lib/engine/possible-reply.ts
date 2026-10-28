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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { isPublicMailboxDomain } from '@aglyn/aglyn/app-utils/crm'
import { outreachEmailDomain } from './do-not-contact-domain'

/*==========================================
 * POSSIBLE REPLIES (AGL-4088).
 *
 * The sync job already treats mail from an enrolled address as that
 * enrollment's reply, in its thread or in one of its own. Two answers slip
 * past it, and this names them:
 *
 * - `other_inbox` — the person wrote to a different one of the
 *   organization's mailboxes than the one writing to them;
 * - `colleague` — somebody else at the person's company wrote, the way an
 *   owner hands a cold email to the marketing lead who answers it.
 *
 * Neither stops anything. A colleague's message can as easily be a vendor's
 * newsletter or an invoice, so a person reads it: the runtime files a task,
 * "Possible reply from …", on the enrollment's record, and the sequence
 * keeps its course until someone decides. A public mailbox domain (gmail.com
 * and the rest) is never a company, so it never matches as a colleague.
 *==========================================*/

export type OutreachPossibleReplyReason = 'other_inbox' | 'colleague'

/** What the matcher reads of an enrollment. */
export interface OutreachPossibleReplyCandidate {
  email: string
  mailboxId: string | null
  lastSentAtMs?: number | null
}

export interface OutreachPossibleReplyMatch<T extends OutreachPossibleReplyCandidate> {
  enrollment: T
  reason: OutreachPossibleReplyReason
}

/**
 * The enrollment a message from `sender`, received by `mailboxId`, may be
 * answering, or `null` — see the module note. The enrollment written to most
 * recently wins when several match.
 */
export function matchOutreachPossibleReply<T extends OutreachPossibleReplyCandidate>(
  sender: unknown,
  input: { mailboxId: string; enrollments: readonly T[] },
): OutreachPossibleReplyMatch<T> | null {
  const address = normalizeContactEmail(sender)
  if (!address) return null
  const latest = (list: T[]) =>
    list.reduce<T | null>((best, next) => (!best || (next.lastSentAtMs ?? 0) > (best.lastSentAtMs ?? 0) ? next : best), null)

  const same = input.enrollments.filter((enrollment) => normalizeContactEmail(enrollment.email) === address)
  // The receiving mailbox's own enrollment is the sync's step 4, not this.
  if (same.some((enrollment) => enrollment.mailboxId === input.mailboxId)) return null
  const elsewhere = latest(same)
  if (elsewhere) return { enrollment: elsewhere, reason: 'other_inbox' }

  const domain = outreachEmailDomain(address)
  if (!domain || isPublicMailboxDomain(domain)) return null
  const colleague = latest(input.enrollments.filter((enrollment) => outreachEmailDomain(enrollment.email) === domain))
  return colleague ? { enrollment: colleague, reason: 'colleague' } : null
}

/** The task's title: who wrote, and from which company domain. */
export function outreachPossibleReplyTitle(senderName: string, senderEmail: string): string {
  const domain = outreachEmailDomain(senderEmail)
  const who = senderName.trim() || senderEmail
  return domain ? `Possible reply from ${who} (${domain})` : `Possible reply from ${who}`
}

/** The task's note: what it is about, and that nothing was stopped. */
export function outreachPossibleReplyNote(input: {
  reason: OutreachPossibleReplyReason
  enrolledName: string
  receivedBy: string
  excerpt: string
}): string {
  const why =
    input.reason === 'other_inbox'
      ? `${input.enrolledName} wrote to ${input.receivedBy}, not the mailbox writing to them.`
      : `A colleague of ${input.enrolledName} wrote to ${input.receivedBy}.`
  return [why, 'The sequence keeps going until someone reads this and decides.', '', input.excerpt]
    .join('\n')
    .trim()
    .slice(0, 800)
}
