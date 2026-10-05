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

import type { ComposedOutreachEmail } from '../engine/compose'
import type { OutreachMailClient } from './mail-client'
import { listUnsubscribeHeaders } from '@aglyn/shared-util-email/list-unsubscribe'
import {
  buildRfc5322Message,
  encodeGmailRawMessage,
  type OutreachComposedMessage,
  type OutreachMailAddress,
} from './rfc5322'

/** What one sent message is known by afterwards. */
export interface OutreachSentMessage {
  /** The provider's id for the message in the sender's mailbox. */
  gmailMessageId: string
  /**
   * The provider's thread — Gmail's thread id, Graph's conversation id —
   * which the next step of the sequence replies into.
   */
  threadId: string
  /**
   * The RFC 5322 `Message-ID` it went out under, for `In-Reply-To` and
   * `References`: the one it was written with, unless the provider says it
   * sent it under another.
   */
  messageId: string
  /**
   * The subject as sent — the thread's own subject when this message started
   * the thread, which a later step answers with `Re:`.
   */
  subject: string
}

export interface SendOutreachMessageOptions {
  /** The provider thread to send into; a new thread when absent. */
  threadId?: string | null
  /** The `Date` header. Now when omitted. */
  date?: Date
  /** The Message-ID's domain. The From address's domain when omitted. */
  messageIdDomain?: string
  /**
   * The Message-ID's local part, minted by the caller so it knows the id
   * before the send answers (AGL-2981). A random one when omitted.
   */
  messageIdLocalPart?: string
}

/**
 * Builds a composed message and sends it through a mailbox's client
 * (AGL-2978). The one door a send goes through, so every Outreach message is
 * built by the same RFC 5322 writer and none can bypass its header checks.
 */
export async function sendOutreachMessage(
  client: Pick<OutreachMailClient, 'sendMessage'>,
  message: OutreachComposedMessage,
  options: SendOutreachMessageOptions = {},
): Promise<OutreachSentMessage> {
  const built = buildRfc5322Message(message, {
    date: options.date,
    messageIdDomain: options.messageIdDomain,
    messageIdLocalPart: options.messageIdLocalPart,
  })
  const sent = await client.sendMessage({
    raw: encodeGmailRawMessage(built.raw),
    threadId: options.threadId ?? null,
  })
  const reported = String(sent.internetMessageId ?? '').trim()
  return {
    gmailMessageId: sent.id,
    threadId: sent.threadId,
    messageId: reported || built.messageId,
    subject: built.subject,
  }
}

/**
 * Sends the email the engine composed (`composeOutreachEmail`) from a
 * mailbox, as the sending runtime does for a sequence step.
 *
 * The engine decides what is said and how it threads; this adds what the
 * engine leaves to the transport — the From line, from the mailbox's send-as
 * address and display name, and the MIME — and maps the rest onto headers:
 *
 * - a reply step goes into the engine's `threadId`, with its `In-Reply-To`
 *   and `References`;
 * - the unsubscribe URL and mailto become one `List-Unsubscribe`, and the
 *   URL adds `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058).
 *
 * Answers the provider's thread id, the `Message-ID` and the subject as sent,
 * which the runtime records on the enrollment for the next step to answer.
 */
export function sendComposedOutreachEmail(
  client: Pick<OutreachMailClient, 'sendMessage'>,
  email: ComposedOutreachEmail,
  sender: OutreachMailAddress,
  options: Omit<SendOutreachMessageOptions, 'threadId'> = {},
): Promise<OutreachSentMessage> {
  // The pair campaigns write too (AGL-3307): both URIs in one
  // `List-Unsubscribe`, and the one-click `Post` only beside the URL.
  const unsubscribe = listUnsubscribeHeaders({
    url: email.listUnsubscribeUrl,
    mailto: email.listUnsubscribeMailto,
  })
  return sendOutreachMessage(
    client,
    {
      from: sender,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html ?? null,
      headers: {
        'In-Reply-To': email.inReplyTo,
        References: email.references,
        'List-Unsubscribe': unsubscribe['List-Unsubscribe'] ?? null,
        'List-Unsubscribe-Post': unsubscribe['List-Unsubscribe-Post'] ?? null,
      },
    },
    { ...options, threadId: email.threadId ?? null },
  )
}
