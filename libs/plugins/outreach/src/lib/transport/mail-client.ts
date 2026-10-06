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

import type { GmailApiMessage } from '../engine/thread-message'
import type { OutreachMailboxProvider } from '../model/outreach.types'

/**
 * THE PROVIDER SEAM (AGL-3489): what the sending runtime, the sync and the
 * panel's test send ask of a connected mailbox, whichever provider runs it.
 *
 * Google's Gmail REST API (`gmail-client.ts`) and Microsoft Graph
 * (`graph-client.ts`) each implement it. Two things keep the engine
 * provider-blind:
 *
 * - A message read whole is handed over as a Gmail API `format=full`
 *   resource. Gmail returns that shape itself; the Graph client reads a
 *   message's MIME and builds the same tree (`mime-message.ts`), so the
 *   classifier reads a reply, an automatic answer or a delivery report the
 *   same way from either.
 * - A search is a structured {@link OutreachMailSearch}, not a provider's
 *   query language. Gmail turns it into a `q` ({@link gmailSearchQuery});
 *   Graph lists the window and filters it.
 *
 * A "thread" is the provider's conversation: Gmail's thread id, or Graph's
 * `conversationId`. Every failure is a `GmailTransportError`, the transport's
 * one error type, whose `reconnectRequired` and `retryable` mean the same for
 * either provider.
 */

/** The messages a sync pass looks for, received after `afterMs`. */
export interface OutreachMailSearch {
  /** Received at or after this moment, epoch ms. */
  afterMs: number
  /** Leave out what the mailbox sent itself. */
  notFromSelf?: boolean
  /**
   * From any of these. An entry with an `@` is a whole address; one without
   * names a sender's local part, as `mailer-daemon` names a bounce's.
   */
  from?: readonly string[]
  /** Addressed to this address. */
  to?: string
}

/** A message a search found: its id and the conversation it is in. */
export interface OutreachMailStub {
  id: string
  threadId: string
}

export interface OutreachMailSearchPage {
  messages: OutreachMailStub[]
  nextPageToken: string | null
}

/** One header of a message read without its body. */
export interface OutreachMailHeader {
  name: string
  value: string
}

/** A message read for its headers alone. */
export interface OutreachMailMetadata {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  internalDateMs: number | null
  headers: OutreachMailHeader[]
}

/** A conversation, every message read whole. */
export interface OutreachMailFullThread {
  id: string
  historyId: string | null
  messages: GmailApiMessage[]
}

/** What a send answers. */
export interface OutreachMailSent {
  /** The provider's id for the sent message. */
  id: string
  /** The conversation it went into. */
  threadId: string
  /**
   * The `Message-ID` the provider sent it under, when it says. A provider
   * that kept the one the message was written with answers that one.
   */
  internetMessageId?: string | null
  labelIds?: string[]
}

/** What became of a grant at the provider when it was asked to end it. */
export type OutreachMailRevocation = 'revoked' | 'already-invalid' | 'unsupported'

export interface OutreachMailClient {
  readonly provider: OutreachMailboxProvider
  /** A live access token, minted or reused. */
  getAccessToken(): Promise<string>
  /**
   * Sends a base64url RFC 5322 message (`encodeGmailRawMessage`). `threadId`
   * files a follow-up into the conversation its first step started where
   * the provider files by id; a provider that threads by the message's own
   * `In-Reply-To` and `References` ignores it.
   */
  sendMessage(input: { raw: string; threadId?: string | null }): Promise<OutreachMailSent>
  /** Every message of a conversation, whole, for the classifier. */
  getFullThread(threadId: string): Promise<OutreachMailFullThread>
  /** One message, whole. */
  getFullMessage(messageId: string): Promise<GmailApiMessage>
  /** One message's headers, only the ones named. */
  getMessage(messageId: string, options?: { metadataHeaders?: readonly string[] }): Promise<OutreachMailMetadata>
  /** One page of the messages a search finds, spam and deleted mail included. */
  searchMessages(
    search: OutreachMailSearch,
    page?: { pageToken?: string | null; maxResults?: number },
  ): Promise<OutreachMailSearchPage>
  /** The message this mailbox holds under a `Message-ID`, or `null`. */
  findMessageByMessageId(messageId: string): Promise<OutreachMailStub | null>
  /** Ends the grant at the provider, where the provider has a way to. */
  revoke(): Promise<OutreachMailRevocation>
}

/**
 * A structured search as a Gmail `q`. `after:` takes whole seconds, and a
 * `from:` list is always parenthesized, so one address and several read the
 * same.
 */
export function gmailSearchQuery(search: OutreachMailSearch): string {
  const terms = [`after:${Math.floor(search.afterMs / 1000)}`]
  if (search.notFromSelf) terms.push('-from:me')
  if (search.from?.length) terms.push(`from:(${search.from.join(' OR ')})`)
  if (search.to) terms.push(`to:${search.to}`)
  return terms.join(' ')
}

/** A `Message-ID` without its angle brackets, as Gmail's `rfc822msgid:` takes it. */
export function bareMessageId(messageId: string): string {
  return String(messageId ?? '').trim().replace(/^<|>$/g, '')
}
