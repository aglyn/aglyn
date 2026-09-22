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

/*==========================================
 * WHAT THE MAILBOX'S OWNER IS TOLD (AGL-3244).
 *
 * A mailbox that pauses itself, or that Google stops accepting, holds every
 * enrollment on it until a person acts — and the person is the member whose
 * mailbox it is, who is not watching the Mailboxes page. So the moment the
 * runtime judges it, they are emailed: the engine's own sentence for the
 * pause, the mailbox by name, how many enrollments are waiting on it, and
 * the link to the page where Resume and Reconnect live.
 *
 * Plain text, one screen long, and the reason in the first line: it is read
 * on a phone between meetings.
 *==========================================*/

export type OutreachMailboxNoticeKind = 'auto_pause' | 'reconnect_required'

export interface OutreachMailboxNotice {
  kind: OutreachMailboxNoticeKind
  mailbox: {
    /** The account's own address. */
    email: string
    /** The address mail goes out as, when it is not the account's. */
    sendAs: string
    displayName: string
  }
  /**
   * For a pause, the engine's own sentence — `autoPause.message`; for a
   * reconnect, {@link outreachReconnectRequiredSentence}.
   */
  message: string
  /** Enrollments active on the mailbox, waiting for it to send again. */
  waiting: number
}

export interface OutreachMailboxNoticeEmail {
  subject: string
  text: string
}

/** The mailbox as the notice names it: `Avery Quinn <avery@example.com>`, the send-as beside it when it differs. */
export function outreachMailboxNoticeName(mailbox: OutreachMailboxNotice['mailbox']): string {
  const name = String(mailbox.displayName ?? '').trim()
  const own = name ? `${name} <${mailbox.email}>` : mailbox.email
  const sendAs = String(mailbox.sendAs ?? '')
    .trim()
    .toLowerCase()
  return sendAs && sendAs !== String(mailbox.email).trim().toLowerCase() ? `${own}, sending as ${sendAs}` : own
}

/** What the notice says when Google stopped accepting the mailbox's connection. */
export function outreachReconnectRequiredSentence(errorCode: string | null | undefined): string {
  const code = String(errorCode ?? '').trim()
  return (
    'Google stopped accepting this mailbox’s connection' +
    (code ? ` (${code})` : '') +
    ' — the password changed, access was removed from the Google account, or an administrator revoked it. ' +
    'Nothing sends from it until it is connected again.'
  )
}

function waitingSentence(waiting: number): string {
  const count = Math.max(0, Math.floor(Number(waiting) || 0))
  if (count === 0) return 'No enrollment is waiting on it right now.'
  return count === 1
    ? '1 enrollment is active on it and waiting; its next email goes out once the mailbox sends again.'
    : `${count} enrollments are active on it and waiting; their next emails go out once the mailbox sends again.`
}

/** The email, composed — see the module note. */
export function composeOutreachMailboxNotice(
  notice: OutreachMailboxNotice,
  options: { mailboxesUrl: string | null },
): OutreachMailboxNoticeEmail {
  const name = outreachMailboxNoticeName(notice.mailbox)
  const paused = notice.kind === 'auto_pause'
  const subject = paused
    ? `Sequences paused your mailbox ${notice.mailbox.email}`
    : `Your mailbox ${notice.mailbox.email} needs reconnecting`
  const action = paused
    ? 'Re-check the addresses in the sequences it sends, then open Mailboxes and select Resume.'
    : 'Open Mailboxes and select Reconnect to connect it again.'
  const where = options.mailboxesUrl
    ? `${action}\n\n${options.mailboxesUrl}`
    : `${action} Mailboxes is under Sequences in your workspace’s console.`
  const text = [
    paused ? `Sequences paused the mailbox ${name}.` : `The mailbox ${name} needs reconnecting.`,
    String(notice.message ?? '').trim(),
    waitingSentence(notice.waiting),
    where,
    'You are getting this because the mailbox is yours, or you manage the organization it belongs to.',
  ]
    .filter(Boolean)
    .join('\n\n')
  return { subject, text }
}
