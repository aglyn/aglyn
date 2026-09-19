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
import { GmailTransportError, gmailApiError } from './gmail-errors'
import {
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from './google-oauth'
import { fetchWithBackoff, retryAfterMs, type TransportDeps } from './http'

/**
 * THE GMAIL REST TRANSPORT (AGL-2978): one connected mailbox, as the calls
 * Outreach makes against it.
 *
 * Built per mailbox, per invocation, from the mailbox's refresh token. The
 * access token is minted on first use and reused until a minute before it
 * expires, so one cron pass over one mailbox — a send, a thread read, a
 * bounce search — refreshes once. Concurrent callers share the one refresh
 * in flight.
 *
 * A 401 from Gmail drops the cached token and retries the call once with a
 * fresh one: an access token can be refused before its stated expiry (a
 * password change, an admin action), and that is not yet a dead grant. If
 * the REFRESH is refused, it is — `invalid_grant`, `reconnectRequired`.
 *
 * Every failure is a `GmailTransportError`; see `gmail-errors.ts` for how a
 * caller decides between reconnecting, retrying later and giving up.
 */

export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailClientOptions extends TransportDeps {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** `users.getProfile`. */
export interface GmailProfile {
  emailAddress: string
  messagesTotal: number
  threadsTotal: number
  historyId: string
}

/** One entry of `users.settings.sendAs.list`. */
export interface GmailSendAs {
  sendAsEmail: string
  displayName: string
  replyToAddress: string | null
  isPrimary: boolean
  isDefault: boolean
  treatAsAlias: boolean
  /**
   * `accepted` once Gmail verified the address; absent on the primary
   * address, which needs no verification.
   */
  verificationStatus: string | null
}

export interface GmailMessageHeader {
  name: string
  value: string
}

/** A message in `format=metadata`: ids, labels, snippet and the headers asked for. */
export interface GmailMessageMetadata {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  internalDateMs: number | null
  headers: GmailMessageHeader[]
}

export interface GmailThread {
  id: string
  historyId: string | null
  messages: GmailMessageMetadata[]
}

/**
 * A thread in `format=full`: every message as Gmail returns it — headers,
 * MIME tree and base64url bodies — which is what the engine's
 * `outreachThreadMessageFromGmail` reads replies and bounces from.
 */
export interface GmailFullThread {
  id: string
  historyId: string | null
  messages: GmailApiMessage[]
}

export interface GmailMessageList {
  messages: Array<{ id: string; threadId: string }>
  nextPageToken: string | null
  resultSizeEstimate: number
}

export interface GmailSentMessage {
  id: string
  threadId: string
  labelIds: string[]
}

export interface GmailClient {
  /** A live access token, minted or reused. */
  getAccessToken(): Promise<string>
  getProfile(): Promise<GmailProfile>
  listSendAs(): Promise<GmailSendAs[]>
  /**
   * `messages.send`: `raw` is the base64url RFC 5322 message
   * (`encodeGmailRawMessage`), and `threadId` files a follow-up into the
   * thread its first step started.
   */
  sendMessage(input: { raw: string; threadId?: string | null }): Promise<GmailSentMessage>
  /** `threads.get` with `format=metadata` and only the headers named. */
  getThread(threadId: string, options?: { metadataHeaders?: readonly string[] }): Promise<GmailThread>
  /**
   * `threads.get` with `format=full`: every message whole, unflattened, for
   * the engine's classifier — a reply's text, a bounce's delivery report.
   */
  getFullThread(threadId: string): Promise<GmailFullThread>
  /** `messages.get` with `format=metadata` and only the headers named. */
  getMessage(messageId: string, options?: { metadataHeaders?: readonly string[] }): Promise<GmailMessageMetadata>
  /** `messages.get` with `format=full` — a message a search found, read whole. */
  getFullMessage(messageId: string): Promise<GmailApiMessage>
  /** `messages.list` with a Gmail search `q`. */
  listMessages(options: {
    q: string
    maxResults?: number
    pageToken?: string | null
    includeSpamTrash?: boolean
  }): Promise<GmailMessageList>
  /** Revokes the grant at Google. `already-invalid` when it was dead. */
  revoke(): Promise<'revoked' | 'already-invalid'>
}

/** Refresh this long before the stated expiry, so a slow call cannot cross it. */
const EXPIRY_MARGIN_MS = 60_000

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function readMessage(value: unknown): GmailMessageMetadata {
  const record = (value ?? {}) as Record<string, unknown>
  const payload = (record['payload'] ?? {}) as { headers?: unknown }
  const headers = Array.isArray(payload.headers) ? payload.headers : []
  const internalDate = Number(record['internalDate'])
  return {
    id: text(record['id']),
    threadId: text(record['threadId']),
    labelIds: Array.isArray(record['labelIds']) ? record['labelIds'].map(String) : [],
    snippet: text(record['snippet']),
    internalDateMs: Number.isFinite(internalDate) ? internalDate : null,
    headers: headers
      .map((header) => header as { name?: unknown; value?: unknown })
      .filter((header) => typeof header.name === 'string')
      .map((header) => ({ name: String(header.name), value: text(header.value) })),
  }
}

function readSendAs(value: unknown): GmailSendAs {
  const record = (value ?? {}) as Record<string, unknown>
  return {
    sendAsEmail: text(record['sendAsEmail']).trim().toLowerCase(),
    displayName: text(record['displayName']),
    replyToAddress: text(record['replyToAddress']) || null,
    isPrimary: record['isPrimary'] === true,
    isDefault: record['isDefault'] === true,
    treatAsAlias: record['treatAsAlias'] === true,
    verificationStatus: text(record['verificationStatus']) || null,
  }
}

/**
 * A `format=full` message, as Gmail sent it. Only the id is checked here: the
 * engine's reader decodes the rest defensively and never throws.
 */
function readFullMessage(value: unknown): GmailApiMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GmailTransportError('unexpected', 'Gmail answered with a message that is not an object.')
  }
  const record = value as Record<string, unknown>
  return { ...(record as unknown as GmailApiMessage), id: text(record['id']) }
}

function metadataQuery(headers: readonly string[] | undefined): string {
  const query = new URLSearchParams({ format: 'metadata' })
  for (const header of headers ?? []) query.append('metadataHeaders', header)
  return query.toString()
}

/** A Gmail client for one mailbox. See the module comment. */
export function createGmailClient(options: GmailClientOptions): GmailClient {
  const deps: TransportDeps = options
  const now = options.now ?? Date.now
  let cached: { token: string; expiresAtMs: number } | null = null
  let refreshing: Promise<string> | null = null

  const mint = (): Promise<string> => {
    refreshing ??= refreshGoogleAccessToken(
      {
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        refreshToken: options.refreshToken,
      },
      deps,
    )
      .then((minted) => {
        cached = {
          token: minted.accessToken,
          expiresAtMs: now() + minted.expiresInSeconds * 1000,
        }
        return minted.accessToken
      })
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  const getAccessToken = async (): Promise<string> => {
    if (cached && cached.expiresAtMs - EXPIRY_MARGIN_MS > now()) return cached.token
    return mint()
  }

  /** One Gmail API call: authorized, retried per policy, 401 once refreshed. */
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    for (let tries = 0; ; tries += 1) {
      const token = await getAccessToken()
      const response = await fetchWithBackoff(
        `${GMAIL_API_BASE}${path}`,
        {
          ...init,
          headers: {
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        },
        deps,
      )
      if (response.status === 401 && tries === 0) {
        cached = null
        continue
      }
      const body = await response.json().catch(() => null)
      if (response.ok) {
        if (body === null) {
          throw new GmailTransportError('unexpected', 'Gmail answered with a body that is not JSON.', {
            status: response.status,
          })
        }
        return body as T
      }
      throw gmailApiError(response.status, body, { retryAfterMs: retryAfterMs(response, now()) })
    }
  }

  return {
    getAccessToken,

    async getProfile() {
      const body = await call<Record<string, unknown>>('/profile')
      return {
        emailAddress: text(body['emailAddress']).trim().toLowerCase(),
        messagesTotal: Number(body['messagesTotal']) || 0,
        threadsTotal: Number(body['threadsTotal']) || 0,
        historyId: text(body['historyId']),
      }
    },

    async listSendAs() {
      const body = await call<{ sendAs?: unknown }>('/settings/sendAs')
      return (Array.isArray(body.sendAs) ? body.sendAs : []).map(readSendAs)
    },

    async sendMessage(input) {
      if (!input?.raw) {
        throw new GmailTransportError('invalid_request', 'A message to send needs its raw content.')
      }
      const body = await call<Record<string, unknown>>('/messages/send', {
        method: 'POST',
        body: JSON.stringify({ raw: input.raw, ...(input.threadId ? { threadId: input.threadId } : {}) }),
      })
      return {
        id: text(body['id']),
        threadId: text(body['threadId']),
        labelIds: Array.isArray(body['labelIds']) ? body['labelIds'].map(String) : [],
      }
    },

    async getThread(threadId, threadOptions) {
      const body = await call<Record<string, unknown>>(
        `/threads/${encodeURIComponent(threadId)}?${metadataQuery(threadOptions?.metadataHeaders)}`,
      )
      return {
        id: text(body['id']),
        historyId: text(body['historyId']) || null,
        messages: (Array.isArray(body['messages']) ? body['messages'] : []).map(readMessage),
      }
    },

    async getFullThread(threadId) {
      const body = await call<Record<string, unknown>>(
        `/threads/${encodeURIComponent(threadId)}?format=full`,
      )
      return {
        id: text(body['id']),
        historyId: text(body['historyId']) || null,
        // An entry that is not a message object is not one to classify.
        messages: (Array.isArray(body['messages']) ? body['messages'] : [])
          .filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
          .map(readFullMessage),
      }
    },

    async getMessage(messageId, messageOptions) {
      const body = await call<unknown>(
        `/messages/${encodeURIComponent(messageId)}?${metadataQuery(messageOptions?.metadataHeaders)}`,
      )
      return readMessage(body)
    },

    async getFullMessage(messageId) {
      return readFullMessage(await call<unknown>(`/messages/${encodeURIComponent(messageId)}?format=full`))
    },

    async listMessages(listOptions) {
      const query = new URLSearchParams({ q: listOptions.q })
      if (listOptions.maxResults) query.set('maxResults', String(listOptions.maxResults))
      if (listOptions.pageToken) query.set('pageToken', listOptions.pageToken)
      if (listOptions.includeSpamTrash) query.set('includeSpamTrash', 'true')
      const body = await call<Record<string, unknown>>(`/messages?${query.toString()}`)
      const messages = Array.isArray(body['messages']) ? body['messages'] : []
      return {
        messages: messages.map((entry) => {
          const record = (entry ?? {}) as Record<string, unknown>
          return { id: text(record['id']), threadId: text(record['threadId']) }
        }),
        nextPageToken: text(body['nextPageToken']) || null,
        resultSizeEstimate: Number(body['resultSizeEstimate']) || 0,
      }
    },

    revoke() {
      return revokeGoogleToken(options.refreshToken, deps)
    },
  }
}
