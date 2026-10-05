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
 *
 * @jest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyOutreachMessage } from '../engine/thread-classification'
import { outreachThreadMessageFromGmail } from '../engine/thread-message'
import { GmailTransportError } from './gmail-errors'
import { createGraphClient, GRAPH_API_BASE } from './graph-client'
import { gmailSearchQuery } from './mail-client'
import {
  microsoftOAuthEndpoints,
  microsoftScopesInclude,
  readMicrosoftIdToken,
} from './microsoft-oauth'
import { decodeMimeHeaderValue, gmailApiMessageFromMime } from './mime-message'

/**
 * The Microsoft Graph side of the provider seam (AGL-3489), against a fake
 * Graph: what a Microsoft 365 mailbox answers the runtime, read back through
 * the same classifier Gmail's messages go through.
 *
 * The fixtures are the engine's own (`../engine/fixtures`), served as a
 * message's `$value` with CRLF line endings, the way Exchange exports MIME.
 */

const FIXTURES = join(__dirname, '..', 'engine', 'fixtures')
const SELF = ['avery@example.org']
const NOW = Date.UTC(2026, 8, 16, 16, 0, 0)
const TOKEN_URL = microsoftOAuthEndpoints('common').token

const eml = (name: string) => readFileSync(join(FIXTURES, name), 'utf8').replace(/\r?\n/g, '\r\n')

const fromMime = (name: string) =>
  outreachThreadMessageFromGmail(gmailApiMessageFromMime(Buffer.from(eml(name), 'utf8'), { id: name, threadId: 'conv-1' }))

describe('a raw MIME message, read as the Gmail API resource the classifier takes', () => {
  it('reads a Microsoft 365 non-delivery report as the hard bounce it is', () => {
    const ndr = fromMime('exchange-ndr-recipient-not-found.eml')
    expect(ndr).toMatchObject({ id: 'exchange-ndr-recipient-not-found.eml', threadId: 'conv-1', from: 'postmaster@example.net' })
    expect(classifyOutreachMessage(ndr, { selfAddresses: SELF })).toMatchObject({
      kind: 'hard_bounce',
      bounce: { recipients: ['riley@example.net'], status: '5.1.10' },
    })
  })

  it('reads a Gmail delivery report, its parts nested as Gmail nests them', () => {
    const bounce = fromMime('gmail-hard-bounce-no-such-user.eml')
    expect(bounce.parts?.map((part) => part.mimeType)).toEqual([
      'multipart/report',
      'multipart/related',
      'multipart/alternative',
      'text/plain',
      'text/html',
      'image/png',
      'message/delivery-status',
      'message/rfc822',
      expect.any(String),
    ])
    expect(classifyOutreachMessage(bounce, { selfAddresses: SELF })).toMatchObject({
      kind: 'hard_bounce',
      bounce: { recipients: ['casey@example.com'], status: '5.1.1' },
    })
  })

  it('reads a reply, an opt-out and an automatic answer as the Gmail adapter does', () => {
    expect(classifyOutreachMessage(fromMime('gmail-real-reply.eml'), { selfAddresses: SELF })).toMatchObject({
      kind: 'reply',
      from: 'casey@example.com',
    })
    expect(fromMime('gmail-real-reply.eml').textBody).toContain('We run 14 client sites today — what would that land at?')
    expect(classifyOutreachMessage(fromMime('gmail-opt-out-reply.eml'), { selfAddresses: SELF }).kind).toBe('opt_out')
    expect(classifyOutreachMessage(fromMime('outlook-automatic-reply.eml'), { selfAddresses: SELF }).kind).toBe('auto_reply')
  })

  it('decodes encoded-word headers, and never throws on what is not a message', () => {
    expect(decodeMimeHeaderValue('=?utf-8?B?Q2Fmw6k=?= =?utf-8?Q?_ol=C3=A9?=')).toBe('Café olé')
    const junk = outreachThreadMessageFromGmail(gmailApiMessageFromMime('not a message at all', { id: 'x' }))
    expect(junk).toMatchObject({ id: 'x', subject: '' })
  })
})

describe('the structured search, as Gmail reads it', () => {
  it('writes the same queries the sync has always made', () => {
    const afterMs = 1_789_000_000_123
    expect(gmailSearchQuery({ afterMs, notFromSelf: true })).toBe('after:1789000000 -from:me')
    expect(gmailSearchQuery({ afterMs, from: ['mailer-daemon', 'postmaster'] })).toBe(
      'after:1789000000 from:(mailer-daemon OR postmaster)',
    )
    expect(gmailSearchQuery({ afterMs, to: 'avery+unsubscribe@example.org' })).toBe(
      'after:1789000000 to:avery+unsubscribe@example.org',
    )
    expect(gmailSearchQuery({ afterMs, from: ['casey@example.com'] })).toBe('after:1789000000 from:(casey@example.com)')
  })
})

// ── A fake Graph ────────────────────────────────────────────────────────────

interface Listed {
  id: string
  conversationId: string
  receivedDateTime: string
  from: string
  to: string[]
  fixture?: string
  internetMessageId?: string
}

let calls: Array<{ url: string; method: string; body: string | null; headers: Record<string, string> }>
let listed: Listed[]
let tokenAnswers: Array<{ status: number; body: unknown }>
let unauthorizedOnce: boolean

const at = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString()
const recipient = (address: string) => ({ emailAddress: { address, name: '' } })
const asListed = (entry: Listed) => ({
  id: entry.id,
  conversationId: entry.conversationId,
  receivedDateTime: entry.receivedDateTime,
  from: recipient(entry.from),
  toRecipients: entry.to.map(recipient),
})

const fakeGraph = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const headers = (init?.headers ?? {}) as Record<string, string>
  calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null, headers })
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  if (url === TOKEN_URL) {
    const answer = tokenAnswers.shift() ?? { status: 200, body: { access_token: 'access-n', expires_in: 3600 } }
    return json(answer.status, answer.body)
  }
  if (unauthorizedOnce && url.startsWith(GRAPH_API_BASE)) {
    unauthorizedOnce = false
    return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'expired' } })
  }
  const parsed = new URL(url)
  const filter = parsed.searchParams.get('$filter') ?? ''
  if (parsed.pathname === '/v1.0/me/messages' && method === 'GET') {
    if (filter.startsWith('conversationId eq ')) {
      const id = filter.slice('conversationId eq '.length).replace(/^'|'$/g, '')
      return json(200, { value: listed.filter((entry) => entry.conversationId === id).reverse().map(asListed) })
    }
    if (filter.startsWith('internetMessageId eq ')) {
      const id = filter.slice('internetMessageId eq '.length).replace(/^'|'$/g, '').replace(/''/g, "'")
      return json(200, { value: listed.filter((entry) => entry.internetMessageId === id).map(asListed) })
    }
    if (filter.startsWith('receivedDateTime ge ')) {
      const since = Date.parse(filter.slice('receivedDateTime ge '.length))
      const page = parsed.searchParams.get('page')
      const all = listed.filter((entry) => Date.parse(entry.receivedDateTime) >= since).map(asListed)
      if (page === '2') return json(200, { value: all.slice(2) })
      return json(200, {
        value: all.slice(0, 2),
        ...(all.length > 2 ? { '@odata.nextLink': `${url}&page=2` } : {}),
      })
    }
  }
  const message = /^\/v1\.0\/me\/messages\/([^/]+)(\/\$value)?$/.exec(parsed.pathname)
  if (message) {
    const entry = listed.find((candidate) => candidate.id === decodeURIComponent(message[1]))
    if (!entry) return json(404, { error: { code: 'ErrorItemNotFound', message: 'not found' } })
    if (message[2]) return new Response(Buffer.from(eml(entry.fixture ?? 'gmail-real-reply.eml'), 'utf8'), { status: 200 })
    return json(200, { ...asListed(entry), subject: 'Re: hello', internetMessageId: entry.internetMessageId ?? '' })
  }
  throw new Error(`unscripted ${method} ${url}`)
}) as typeof fetch

const client = (overrides: Partial<Parameters<typeof createGraphClient>[0]> = {}) =>
  createGraphClient({
    clientId: 'client-1',
    clientSecret: 'secret-1',
    tenant: 'common',
    refreshToken: 'refresh-0',
    selfAddresses: SELF,
    fetch: fakeGraph,
    sleep: async () => undefined,
    now: () => NOW,
    ...overrides,
  })

beforeEach(() => {
  calls = []
  unauthorizedOnce = false
  tokenAnswers = []
  listed = [
    { id: 'm-sent', conversationId: 'conv-1', receivedDateTime: at(-60), from: 'avery@example.org', to: ['casey@example.com'], internetMessageId: '<step-1@example.org>' },
    { id: 'm-reply', conversationId: 'conv-1', receivedDateTime: at(-30), from: 'casey@example.com', to: ['avery@example.org'], fixture: 'gmail-real-reply.eml' },
    { id: 'm-ndr', conversationId: 'conv-2', receivedDateTime: at(-20), from: 'postmaster@example.net', to: ['avery@example.org'], fixture: 'exchange-ndr-recipient-not-found.eml' },
    { id: 'm-unsub', conversationId: 'conv-3', receivedDateTime: at(-10), from: 'riley@example.net', to: ['avery+unsubscribe@example.org'] },
    { id: 'm-old', conversationId: 'conv-4', receivedDateTime: at(-6000), from: 'casey@example.com', to: ['avery@example.org'] },
  ]
})

describe('the Graph client (AGL-3489)', () => {
  it('lists the window once per page and filters it as each sync search asks, following only Graph’s own next link', async () => {
    const graph = client()
    const all = async (search: Parameters<typeof graph.searchMessages>[0]) => {
      const found: string[] = []
      let pageToken: string | null = null
      do {
        const page = await graph.searchMessages(search, { pageToken })
        found.push(...page.messages.map((message) => message.id))
        pageToken = page.nextPageToken
      } while (pageToken)
      return found
    }
    const afterMs = NOW - 120 * 60_000
    expect(await all({ afterMs, notFromSelf: true })).toEqual(['m-reply', 'm-ndr', 'm-unsub'])
    expect(await all({ afterMs, from: ['mailer-daemon', 'postmaster'] })).toEqual(['m-ndr'])
    expect(await all({ afterMs, to: 'avery+unsubscribe@example.org' })).toEqual(['m-unsub'])
    expect(await all({ afterMs, from: ['casey@example.com', 'riley@example.net'] })).toEqual(['m-reply', 'm-unsub'])

    const listing = calls.find((call) => call.url.includes('receivedDateTime'))
    expect(listing?.url).toContain(`receivedDateTime%20ge%20${encodeURIComponent(new Date(afterMs).toISOString())}`)
    expect(listing?.url).not.toContain('+')
    expect(listing?.headers['Prefer']).toBe('IdType="ImmutableId"')
    await expect(graph.searchMessages({ afterMs }, { pageToken: 'https://evil.example/steal' })).rejects.toThrow(
      GmailTransportError,
    )
  })

  it('reads a conversation whole, oldest first, so a reply and an NDR classify as they would from Gmail', async () => {
    const graph = client()
    const thread = await graph.getFullThread('conv-1')
    expect(thread.messages.map((message) => message.id)).toEqual(['m-sent', 'm-reply'])
    const reply = outreachThreadMessageFromGmail(thread.messages[1])
    expect(reply).toMatchObject({ threadId: 'conv-1', internalDateMs: Date.parse(at(-30)) })
    expect(classifyOutreachMessage(reply, { selfAddresses: SELF }).kind).toBe('reply')

    const ndr = outreachThreadMessageFromGmail(await graph.getFullMessage('m-ndr'))
    expect(classifyOutreachMessage(ndr, { selfAddresses: SELF })).toMatchObject({
      kind: 'hard_bounce',
      bounce: { recipients: ['riley@example.net'] },
    })
  })

  it('finds a sent message by its Message-ID, and reads its headers from its properties', async () => {
    const graph = client()
    expect(await graph.findMessageByMessageId('<step-1@example.org>')).toEqual({ id: 'm-sent', threadId: 'conv-1' })
    expect(await graph.findMessageByMessageId('step-1@example.org')).toEqual({ id: 'm-sent', threadId: 'conv-1' })
    expect(await graph.findMessageByMessageId('<nothing@example.org>')).toBeNull()
    const metadata = await graph.getMessage('m-sent', { metadataHeaders: ['Subject'] })
    expect(metadata.headers).toEqual([{ name: 'Subject', value: 'Re: hello' }])
  })

  it('sends a draft created from the message’s MIME, and answers its conversation and Message-ID', async () => {
    const fetchSend = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null, headers: (init?.headers ?? {}) as Record<string, string> })
      if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 })
      if (url === `${GRAPH_API_BASE}/me/messages`) {
        return new Response(
          JSON.stringify({ id: 'draft-1', conversationId: 'conv-9', internetMessageId: '<minted@example.org>' }),
          { status: 201 },
        )
      }
      if (url === `${GRAPH_API_BASE}/me/messages/draft-1/send`) return new Response(null, { status: 202 })
      throw new Error(`unscripted ${url}`)
    }) as typeof fetch
    const raw = Buffer.from('From: avery@example.org\r\nTo: casey@example.com\r\nSubject: Hi\r\n\r\nHello').toString('base64url')
    const sent = await client({ fetch: fetchSend }).sendMessage({ raw, threadId: 'conv-1' })
    expect(sent).toEqual({ id: 'draft-1', threadId: 'conv-9', internetMessageId: '<minted@example.org>' })
    const draft = calls.find((call) => call.url === `${GRAPH_API_BASE}/me/messages`)
    expect(draft?.headers['Content-Type']).toBe('text/plain')
    expect(Buffer.from(draft?.body ?? '', 'base64').toString('utf8')).toContain('Subject: Hi')
  })

  it('refreshes once, retries a 401 once with a fresh token, and hands a rotated refresh token back to be stored', async () => {
    tokenAnswers = [
      { status: 200, body: { access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' } },
      { status: 200, body: { access_token: 'access-2', expires_in: 3600, refresh_token: 'refresh-1' } },
    ]
    const rotated: string[] = []
    const graph = client({ onRefreshTokenRotated: (token) => void rotated.push(token) })
    await graph.getMessage('m-sent')
    await graph.getMessage('m-reply')
    expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1)
    unauthorizedOnce = true
    await graph.getMessage('m-ndr')
    const refreshes = calls.filter((call) => call.url === TOKEN_URL)
    expect(refreshes).toHaveLength(2)
    expect(new URLSearchParams(refreshes[1].body ?? '').get('refresh_token')).toBe('refresh-1')
    expect(rotated).toEqual(['refresh-1'])
  })

  it('reads a refused refresh as a grant to reconnect, and a missing mailbox as no mail service', async () => {
    tokenAnswers = [{ status: 400, body: { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired.' } }]
    const refused = await client().getMessage('m-sent').catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(GmailTransportError)
    expect(refused).toMatchObject({ code: 'invalid_grant', reconnectRequired: true, providerReason: 'AADSTS700082' })
    expect(JSON.stringify(refused)).not.toContain('refresh token has expired')
  })
})

describe('Microsoft’s identity platform', () => {
  const idToken = (claims: Record<string, unknown>) =>
    ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.')
  const tid = '9f8e7d6c-5b4a-4321-8765-0123456789ab'
  const valid = {
    iss: `https://login.microsoftonline.com/${tid}/v2.0`,
    aud: 'client-1',
    tid,
    oid: 'AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee',
    preferred_username: 'Avery@Example.org',
    nonce: 'n-1',
    exp: Math.floor(NOW / 1000) + 600,
  }
  const read = (claims: Record<string, unknown>) =>
    readMicrosoftIdToken(idToken(claims), { clientId: 'client-1', nonce: 'n-1', nowMs: NOW })

  it('names the account by tenant and object id, after checking issuer, audience, expiry and nonce', () => {
    expect(read(valid)).toEqual({
      ok: true,
      identity: {
        sub: `${tid}:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
        oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tid,
        username: 'avery@example.org',
      },
    })
    expect(read({ ...valid, iss: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0' })).toEqual({
      ok: false,
      refusal: 'issuer',
    })
    expect(read({ ...valid, iss: 'https://evil.example/v2.0' })).toEqual({ ok: false, refusal: 'issuer' })
    expect(read({ ...valid, aud: 'someone-else' })).toEqual({ ok: false, refusal: 'audience' })
    expect(read({ ...valid, exp: Math.floor(NOW / 1000) - 1 })).toEqual({ ok: false, refusal: 'expired' })
    expect(read({ ...valid, nonce: 'n-2' })).toEqual({ ok: false, refusal: 'nonce' })
    expect(readMicrosoftIdToken('not-a-token', { clientId: 'client-1', nonce: 'n-1', nowMs: NOW })).toEqual({
      ok: false,
      refusal: 'malformed',
    })
  })

  it('counts Mail.Send and Mail.ReadWrite whether Microsoft lists them short or in full', () => {
    expect(microsoftScopesInclude('Mail.ReadWrite Mail.Send User.Read openid')).toBe(true)
    expect(
      microsoftScopesInclude('https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite'),
    ).toBe(true)
    expect(microsoftScopesInclude('https://graph.microsoft.com/Mail.Send openid')).toBe(false)
  })
})
