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

import type { GmailClient } from './gmail-client'
import {
  buildRfc5322Message,
  encodeGmailRawMessage,
  type OutreachComposedMessage,
} from './rfc5322'

/** What one sent message is known by afterwards. */
export interface OutreachSentMessage {
  /** Gmail's id for the message in the sender's mailbox. */
  gmailMessageId: string
  /** Gmail's thread id — what the next step of the sequence replies into. */
  threadId: string
  /** The RFC 5322 `Message-ID` it carried, for `In-Reply-To`/`References`. */
  messageId: string
}

/**
 * Builds a composed message and sends it through a mailbox's client
 * (AGL-2978). The one door a send goes through, so every Outreach message is
 * built by the same RFC 5322 writer and none can bypass its header checks.
 */
export async function sendOutreachMessage(
  client: Pick<GmailClient, 'sendMessage'>,
  message: OutreachComposedMessage,
  options: { threadId?: string | null; date?: Date; messageIdDomain?: string } = {},
): Promise<OutreachSentMessage> {
  const built = buildRfc5322Message(message, {
    date: options.date,
    messageIdDomain: options.messageIdDomain,
  })
  const sent = await client.sendMessage({
    raw: encodeGmailRawMessage(built.raw),
    threadId: options.threadId ?? null,
  })
  return { gmailMessageId: sent.id, threadId: sent.threadId, messageId: built.messageId }
}
