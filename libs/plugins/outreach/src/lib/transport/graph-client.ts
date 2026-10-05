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
import { GmailTransportError } from './gmail-errors'
import { fetchWithBackoff, retryAfterMs, type TransportDeps } from './http'
import type {
  OutreachMailClient,
  OutreachMailHeader,
  OutreachMailSearch,
  OutreachMailStub,
} from './mail-client'
import { graphApiError } from './microsoft-errors'
import { refreshMicrosoftAccessToken } from './microsoft-oauth'
import { gmailApiMessageFromMime } from './mime-message'

/**
 * THE MICROSOFT GRAPH TRANSPORT (AGL-3489): one connected Microsoft 365
 * mailbox, behind the same seam as Gmail (`mail-client.ts`).
 *
 * ## Sending
 *
 * The message is the one the RFC 5322 writer built for Gmail, headers and
 * all — `List-Unsubscribe`, `In-Reply-To`, `References`, the `Message-ID`
 * the runtime minted. It is created as a draft from that MIME and the draft
 * is sent: creating it first is what answers the message's id and
 * `conversationId` (Graph's `sendMail` answers nothing), and the
 * conversation id is what a follow-up step and the sync know the thread by.
 * A follow-up threads by its own `In-Reply-To` and `References`, which is
 * how Exchange and every receiver group it, so `threadId` is not sent.
 *
 * Every call asks for immutable ids (`Prefer: IdType="ImmutableId"`), so the
 * draft's id is still the message's id once sending has moved it to Sent
 * Items.
 *
 * ## Reading
 *
 * A message read whole is its MIME (`/$value`) read into the Gmail API
 * shape the classifier takes. A search lists the window's messages across
 * every folder (`/me/messages`, junk and deleted included) with the few
 * properties a search needs, and filters them here: Graph's `$filter` cannot
 * combine a received-time range with a sender list or a recipient, and the
 * window a sync pass reads is short.
 *
 * ## Tokens
 *
 * As the Gmail client: minted on first use, reused until a minute before
 * expiry, one refresh in flight, a 401 retried once with a fresh token.
 * Microsoft rotates refresh tokens, so a refresh that answers a new one
 * hands it to `onRefreshTokenRotated` for the caller to store, and uses it
 * from then on.
 */

export const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'
const ME = `${GRAPH_API_BASE}/me`

export interface GraphClientOptions extends TransportDeps {
  clientId: string
  clientSecret: string
  tenant: string
  refreshToken: string
  /** The mailbox's own addresses: what a search's `notFromSelf` leaves out. */
  selfAddresses?: readonly string[]
  /** An access token already in hand — a connect's own — used until it expires. */
  accessToken?: { token: string; expiresInSeconds: number } | null
  /** Stores a refresh token Microsoft rotated in. Its failure is logged, not thrown. */
  onRefreshTokenRotated?: (refreshToken: string) => Promise<void> | void
}

/** `GET /me`: the account a grant is for. */
export interface GraphProfile {
  /** The directory object id — the ID token's `oid`. */
  id: string
  /** The mailbox's address: `mail`, or the sign-in name when it has none. */
  emailAddress: string
  displayName: string
}

export interface GraphClient extends OutreachMailClient {
  readonly provider: 'microsoft'
  getProfile(): Promise<GraphProfile>
  revoke(): Promise<'unsupported'>
}

/** Refresh this long before the stated expiry. */
const EXPIRY_MARGIN_MS = 60_000
/** Messages one search page lists; Graph allows up to 1000. */
const SEARCH_PAGE_SIZE = 250
/** Messages of one conversation read whole. */
const THREAD_MAX = 50

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** An OData string literal: single quotes doubled. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

/** A query string Graph reads: `%20`, never `+`, for a space. */
function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
}

const addressOf = (recipient: unknown): string =>
  text((recipient as { emailAddress?: { address?: unknown } } | null)?.emailAddress?.address)
    .trim()
    .toLowerCase()

const addressesOf = (list: unknown): string[] => (Array.isArray(list) ? list.map(addressOf).filter(Boolean) : [])

const receivedMs = (record: Record<string, unknown>): number | null => {
  const at = Date.parse(text(record['receivedDateTime']))
  return Number.isFinite(at) ? at : null
}

/** Whether an address answers a `from` term: a whole address, or a local part. */
function fromMatches(address: string, term: string): boolean {
  const wanted = term.trim().toLowerCase()
  if (!wanted || !address) return false
  if (wanted.includes('@')) return address === wanted
  return address.slice(0, address.indexOf('@')) === wanted
}

/** Whether a listed message answers a search. */
export function graphMessageMatches(
  record: Record<string, unknown>,
  search: OutreachMailSearch,
  self: ReadonlySet<string>,
): boolean {
  const at = receivedMs(record)
  if (at !== null && at < search.afterMs) return false
  const from = addressOf(record['from'])
  if (search.notFromSelf && self.has(from)) return false
  if (search.from?.length && !search.from.some((term) => fromMatches(from, term))) return false
  if (search.to) {
    const to = search.to.trim().toLowerCase()
    const recipients = [...addressesOf(record['toRecipients']), ...addressesOf(record['ccRecipients'])]
    if (!recipients.includes(to)) return false
  }
  return true
}

/** The header list a metadata read answers, the named ones only. */
function metadataHeaders(record: Record<string, unknown>, wanted: readonly string[] | undefined): OutreachMailHeader[] {
  const listed = (Array.isArray(record['internetMessageHeaders']) ? record['internetMessageHeaders'] : [])
    .map((entry) => entry as { name?: unknown; value?: unknown })
    .filter((entry) => typeof entry.name === 'string')
    .map((entry) => ({ name: String(entry.name), value: text(entry.value) }))
  const has = (name: string) => listed.some((header) => header.name.toLowerCase() === name.toLowerCase())
  const from = record['from'] as { emailAddress?: { name?: unknown; address?: unknown } } | undefined
  const fromName = text(from?.emailAddress?.name)
  const fromAddress = text(from?.emailAddress?.address)
  // A sent message carries no internet headers in Graph; its properties say the same.
  const synthesized: OutreachMailHeader[] = [
    { name: 'Subject', value: text(record['subject']) },
    { name: 'From', value: fromName && fromAddress ? `${fromName} <${fromAddress}>` : fromAddress },
    { name: 'To', value: addressesOf(record['toRecipients']).join(', ') },
    { name: 'Message-ID', value: text(record['internetMessageId']) },
  ].filter((header) => header.value && !has(header.name))
  const all = [...listed, ...synthesized]
  if (!wanted?.length) return all
  const names = new Set(wanted.map((name) => name.toLowerCase()))
  return all.filter((header) => names.has(header.name.toLowerCase()))
}

/** A Graph client for one mailbox. See the module comment. */
export function createGraphClient(options: GraphClientOptions): GraphClient {
  const deps: TransportDeps = options
  const now = options.now ?? Date.now
  const self = new Set((options.selfAddresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean))
  let refreshToken = options.refreshToken
  let cached: { token: string; expiresAtMs: number } | null = options.accessToken?.token
    ? { token: options.accessToken.token, expiresAtMs: now() + options.accessToken.expiresInSeconds * 1000 }
    : null
  let refreshing: Promise<string> | null = null

  const mint = (): Promise<string> => {
    refreshing ??= refreshMicrosoftAccessToken(
      { clientId: options.clientId, clientSecret: options.clientSecret, tenant: options.tenant, refreshToken },
      deps,
    )
      .then(async (minted) => {
        cached = { token: minted.accessToken, expiresAtMs: now() + minted.expiresInSeconds * 1000 }
        if (minted.refreshToken && minted.refreshToken !== refreshToken) {
          refreshToken = minted.refreshToken
          try {
            await options.onRefreshTokenRotated?.(minted.refreshToken)
          } catch (error) {
            console.error('[outreach] storing a rotated Microsoft refresh token failed', error)
          }
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

  /**
   * One Graph call: authorized, retried per policy, a 401 once refreshed.
   * Answers the response, already judged ok.
   */
  const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
    for (let tries = 0; ; tries += 1) {
      const token = await getAccessToken()
      const response = await fetchWithBackoff(
        url,
        {
          ...init,
          headers: {
            Accept: 'application/json',
            Prefer: 'IdType="ImmutableId"',
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
      if (response.ok) return response
      const body = await response.json().catch(() => null)
      throw graphApiError(response.status, body, { retryAfterMs: retryAfterMs(response, now()) })
    }
  }

  const json = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await send(url, init)
    const body = await response.json().catch(() => null)
    if (body === null || typeof body !== 'object') {
      throw new GmailTransportError('unexpected', 'Microsoft Graph answered with a body that is not JSON.', {
        status: response.status,
      })
    }
    return body as T
  }

  const messagePath = (id: string) => {
    if (!id) throw new GmailTransportError('invalid_request', 'A message to read needs its id.')
    return `${ME}/messages/${encodeURIComponent(id)}`
  }

  const getFullMessage = async (messageId: string): Promise<GmailApiMessage> => {
    const path = messagePath(messageId)
    const [record, raw] = await Promise.all([
      json<Record<string, unknown>>(`${path}?${query({ $select: 'id,conversationId,receivedDateTime' })}`),
      send(`${path}/$value`, { headers: { Accept: 'message/rfc822, text/plain, */*' } }).then((response) =>
        response.arrayBuffer(),
      ),
    ])
    return gmailApiMessageFromMime(new Uint8Array(raw), {
      id: text(record['id']) || messageId,
      threadId: text(record['conversationId']),
      internalDateMs: receivedMs(record),
    })
  }

  return {
    provider: 'microsoft',
    getAccessToken,

    async getProfile() {
      const body = await json<Record<string, unknown>>(`${ME}?${query({ $select: 'id,mail,userPrincipalName,displayName' })}`)
      return {
        id: text(body['id']).toLowerCase(),
        emailAddress: (text(body['mail']) || text(body['userPrincipalName'])).trim().toLowerCase(),
        displayName: text(body['displayName']).trim(),
      }
    },

    async sendMessage(input) {
      if (!input?.raw) {
        throw new GmailTransportError('invalid_request', 'A message to send needs its raw content.')
      }
      // Graph takes MIME as standard base64 in a text/plain body.
      const mime = Buffer.from(input.raw, 'base64url').toString('base64')
      const draft = await json<Record<string, unknown>>(`${ME}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: mime,
      })
      const id = text(draft['id'])
      if (!id) throw new GmailTransportError('unexpected', 'Microsoft Graph created the message without an id.')
      try {
        await send(`${messagePath(id)}/send`, { method: 'POST' })
      } catch (error) {
        // The draft would otherwise sit in Drafts, unsent, looking like work.
        await send(messagePath(id), { method: 'DELETE' }).catch(() => undefined)
        throw error
      }
      return {
        id,
        threadId: text(draft['conversationId']),
        internetMessageId: text(draft['internetMessageId']) || null,
      }
    },

    async getFullThread(threadId) {
      const list = await json<{ value?: unknown }>(
        `${ME}/messages?${query({
          $filter: `conversationId eq ${literal(threadId)}`,
          $select: 'id,conversationId,receivedDateTime',
          $top: String(THREAD_MAX),
        })}`,
      )
      const records = (Array.isArray(list.value) ? list.value : [])
        .map((entry) => (entry ?? {}) as Record<string, unknown>)
        .filter((record) => text(record['id']))
        .sort((a, b) => (receivedMs(a) ?? 0) - (receivedMs(b) ?? 0))
      const messages: GmailApiMessage[] = []
      for (const record of records) messages.push(await getFullMessage(text(record['id'])))
      return { id: threadId, historyId: null, messages }
    },

    getFullMessage,

    async getMessage(messageId, messageOptions) {
      const record = await json<Record<string, unknown>>(
        `${messagePath(messageId)}?${query({
          $select:
            'id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,internetMessageId,internetMessageHeaders',
        })}`,
      )
      return {
        id: text(record['id']) || messageId,
        threadId: text(record['conversationId']),
        labelIds: [],
        snippet: text(record['bodyPreview']),
        internalDateMs: receivedMs(record),
        headers: metadataHeaders(record, messageOptions?.metadataHeaders),
      }
    },

    async searchMessages(search, page) {
      let url: string
      if (page?.pageToken) {
        // A next link is Graph's own address; anything else is not followed
        // with this mailbox's token.
        if (!page.pageToken.startsWith(`${ME}/messages?`)) {
          throw new GmailTransportError('invalid_request', 'That page token is not a Microsoft Graph page.')
        }
        url = page.pageToken
      } else {
        url = `${ME}/messages?${query({
          $filter: `receivedDateTime ge ${new Date(Math.max(0, search.afterMs)).toISOString()}`,
          $select: 'id,conversationId,from,toRecipients,ccRecipients,receivedDateTime',
          $top: String(Math.max(page?.maxResults ?? 0, SEARCH_PAGE_SIZE)),
        })}`
      }
      const body = await json<Record<string, unknown>>(url)
      const messages: OutreachMailStub[] = (Array.isArray(body['value']) ? body['value'] : [])
        .map((entry) => (entry ?? {}) as Record<string, unknown>)
        .filter((record) => text(record['id']) && graphMessageMatches(record, search, self))
        .map((record) => ({ id: text(record['id']), threadId: text(record['conversationId']) }))
      return { messages, nextPageToken: text(body['@odata.nextLink']) || null }
    },

    async findMessageByMessageId(messageId) {
      const wanted = String(messageId ?? '').trim()
      if (!wanted) return null
      const id = wanted.startsWith('<') ? wanted : `<${wanted}>`
      const body = await json<{ value?: unknown }>(
        `${ME}/messages?${query({
          $filter: `internetMessageId eq ${literal(id)}`,
          $select: 'id,conversationId',
          $top: '1',
        })}`,
      )
      const record = (Array.isArray(body.value) ? body.value[0] : null) as Record<string, unknown> | null
      return record && text(record['id']) ? { id: text(record['id']), threadId: text(record['conversationId']) } : null
    },

    async revoke() {
      return 'unsupported' as const
    },
  }
}
