/**
 * @jest-environment node
 *
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

import { createGmailClient, GMAIL_API_BASE } from './gmail-client'
import { GmailTransportError, isReconnectRequired, type GmailTransportErrorCode } from './gmail-errors'
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  GOOGLE_OAUTH_ENDPOINTS,
  grantedScopesInclude,
  OUTREACH_GOOGLE_SCOPES,
  OUTREACH_REQUIRED_GRANTED_SCOPES,
  pkceChallenge,
  readGoogleIdToken,
  revokeGoogleToken,
} from './google-oauth'
import { composeOutreachEmail } from '../engine/compose'
import { outreachThreadMessageFromGmail } from '../engine/thread-message'
import { backoffDelayMs, retryAfterMs } from './http'
import { LIST_UNSUBSCRIBE_ONE_CLICK } from './rfc5322'
import { sendComposedOutreachEmail, sendOutreachMessage } from './send-message'

/**
 * The Gmail REST transport against a fake network (AGL-2978).
 *
 * No request here leaves the process: every call goes to a scripted `fetch`
 * that answers from a queue per endpoint and records what it was asked. What
 * is pinned is the transport's CONTRACT — the token minted once and reused,
 * the exact requests made, and above all the error mapping, because that is
 * what the send cron acts on: a dead grant must say `reconnectRequired`, a
 * rate limit must back off and then say `retryable`, and a malformed request
 * must say neither.
 */

interface Scripted {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

/** A fake fetch: per URL prefix, a queue of answers (the last one repeats). */
function fakeNetwork(script: Record<string, Array<Scripted | 'network-error'>>) {
  const calls: Recorded[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? init.body : null,
    })
    const key = Object.keys(script)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0]
    if (!key) throw new Error(`unscripted request to ${url}`)
    const queue = script[key]
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next === 'network-error') throw new TypeError('fetch failed')
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const TOKEN_OK: Scripted = { status: 200, body: { access_token: 'access-1', expires_in: 3600, token_type: 'Bearer' } }

async function codeOf(run: () => Promise<unknown>): Promise<GmailTransportErrorCode | 'no-throw' | 'other'> {
  try {
    await run()
    return 'no-throw'
  } catch (error) {
    return error instanceof GmailTransportError ? error.code : 'other'
  }
}

function client(network: ReturnType<typeof fakeNetwork>, extra: { now?: () => number; sleeps?: number[] } = {}) {
  return createGmailClient({
    clientId: 'client-id.apps.googleusercontent.com',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-1',
    fetch: network.fetchImpl,
    sleep: async (ms) => {
      extra.sleeps?.push(ms)
    },
    random: () => 0.5,
    now: extra.now,
  })
}

describe('Gmail client — the access token (AGL-2978)', () => {
  it('mints one access token and reuses it across calls', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 200, body: { emailAddress: 'Avery@Rep.Example.com', messagesTotal: 3, threadsTotal: 2, historyId: '99' } }],
      [`${GMAIL_API_BASE}/settings/sendAs`]: [{ status: 200, body: { sendAs: [] } }],
    })
    const gmail = client(network)
    const profile = await gmail.getProfile()
    await gmail.listSendAs()
    expect(profile).toEqual({ emailAddress: 'avery@rep.example.com', messagesTotal: 3, threadsTotal: 2, historyId: '99' })
    const refreshes = network.calls.filter((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.token)
    expect(refreshes).toHaveLength(1)
    expect(new URLSearchParams(refreshes[0].body ?? '').get('grant_type')).toBe('refresh_token')
    expect(new URLSearchParams(refreshes[0].body ?? '').get('refresh_token')).toBe('refresh-1')
    for (const call of network.calls.filter((entry) => entry.url.startsWith(GMAIL_API_BASE))) {
      expect(call.headers['Authorization']).toBe('Bearer access-1')
    }
  })

  it('shares one refresh between concurrent calls, and mints again near expiry', async () => {
    let clock = 1_000_000
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK, { status: 200, body: { access_token: 'access-2', expires_in: 3600 } }],
    })
    const gmail = client(network, { now: () => clock })
    const [first, second] = await Promise.all([gmail.getAccessToken(), gmail.getAccessToken()])
    expect([first, second]).toEqual(['access-1', 'access-1'])
    clock += 3600_000 - 30_000
    await expect(gmail.getAccessToken()).resolves.toBe('access-2')
    expect(network.calls.filter((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.token)).toHaveLength(2)
  })

  it('maps a refused refresh to invalid_grant, reconnect required, without retrying it', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }],
    })
    const gmail = client(network)
    const error = await gmail.getProfile().catch((caught) => caught)
    expect(error).toBeInstanceOf(GmailTransportError)
    expect(error.code).toBe('invalid_grant')
    expect(error.reconnectRequired).toBe(true)
    expect(error.retryable).toBe(false)
    expect(isReconnectRequired(error)).toBe(true)
    expect(network.calls).toHaveLength(1)
  })

  it('maps a refused OAuth client to client_misconfigured', async () => {
    const network = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.token]: [{ status: 401, body: { error: 'invalid_client' } }] })
    expect(await codeOf(() => client(network).getProfile())).toBe('client_misconfigured')
  })

  it('refreshes once when Gmail refuses the access token, then gives up as unauthorized', async () => {
    const recovered = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK, { status: 200, body: { access_token: 'access-2', expires_in: 3600 } }],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED' } } }, { status: 200, body: { emailAddress: 'avery@rep.example.com' } }],
    })
    await expect(client(recovered).getProfile()).resolves.toEqual(expect.objectContaining({ emailAddress: 'avery@rep.example.com' }))
    expect(recovered.calls.filter((call) => call.url.startsWith(GMAIL_API_BASE)).map((call) => call.headers['Authorization'])).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ])

    const refused = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 401, body: { error: { code: 401 } } }],
    })
    expect(await codeOf(() => client(refused).getProfile())).toBe('unauthorized')
  })
})

describe('Gmail client — the calls (AGL-2978)', () => {
  it('sends a raw message into a thread and answers its ids', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/messages/send`]: [{ status: 200, body: { id: 'msg-1', threadId: 'thread-1', labelIds: ['SENT'] } }],
    })
    const sent = await client(network).sendMessage({ raw: 'cmF3', threadId: 'thread-1' })
    expect(sent).toEqual({ id: 'msg-1', threadId: 'thread-1', labelIds: ['SENT'] })
    const request = network.calls.find((call) => call.url.endsWith('/messages/send'))
    expect(request?.method).toBe('POST')
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ raw: 'cmF3', threadId: 'thread-1' })
  })

  it('builds and sends a composed message through the one door', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/messages/send`]: [{ status: 200, body: { id: 'msg-2', threadId: 'thread-2' } }],
    })
    const sent = await sendOutreachMessage(client(network), {
      from: { address: 'avery@rep.example.com', name: 'Avery Rep' },
      to: 'jordan@prospect.example.org',
      subject: 'Following up',
      text: 'Hi again',
    })
    expect(sent.gmailMessageId).toBe('msg-2')
    expect(sent.threadId).toBe('thread-2')
    expect(sent.messageId).toMatch(/@rep\.example\.com>$/)
    expect(sent.subject).toBe('Following up')
    const request = network.calls.find((call) => call.url.endsWith('/messages/send'))
    const raw = Buffer.from(JSON.parse(request?.body ?? '{}').raw, 'base64url').toString('utf8')
    expect(raw).toContain('To: jordan@prospect.example.org\r\n')
    expect(raw).toContain(`Message-ID: ${sent.messageId}\r\n`)
    expect(JSON.parse(request?.body ?? '{}').threadId).toBeUndefined()
  })

  it('reads a thread and a message in metadata form with only the headers asked for', async () => {
    const message = {
      id: 'msg-1',
      threadId: 'thread-1',
      labelIds: ['INBOX'],
      snippet: 'Thanks',
      internalDate: '1789000000000',
      payload: { headers: [{ name: 'From', value: 'jordan@prospect.example.org' }, { name: 'Message-ID', value: '<r@prospect.example.org>' }] },
    }
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/threads/`]: [{ status: 200, body: { id: 'thread-1', historyId: '7', messages: [message] } }],
      [`${GMAIL_API_BASE}/messages/msg-1`]: [{ status: 200, body: message }],
    })
    const gmail = client(network)
    const thread = await gmail.getThread('thread-1', { metadataHeaders: ['From', 'Message-ID'] })
    expect(thread.messages[0]).toEqual({
      id: 'msg-1',
      threadId: 'thread-1',
      labelIds: ['INBOX'],
      snippet: 'Thanks',
      internalDateMs: 1789000000000,
      headers: [
        { name: 'From', value: 'jordan@prospect.example.org' },
        { name: 'Message-ID', value: '<r@prospect.example.org>' },
      ],
    })
    const threadUrl = new URL(network.calls.find((call) => call.url.includes('/threads/'))?.url ?? '')
    expect(threadUrl.pathname).toBe('/gmail/v1/users/me/threads/thread-1')
    expect(threadUrl.searchParams.get('format')).toBe('metadata')
    expect(threadUrl.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Message-ID'])
    await expect(gmail.getMessage('msg-1', { metadataHeaders: ['From'] })).resolves.toEqual(thread.messages[0])
  })

  it('reads a thread and a message in full form, unflattened, for the engine’s classifier', async () => {
    const reply = {
      id: 'msg-2',
      threadId: 'thread-1',
      labelIds: ['INBOX'],
      snippet: 'Sounds good &amp; thanks',
      internalDate: '1789000000000',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Jordan Lee <jordan@prospect.example.org>' },
          { name: 'Subject', value: 'Re: A note on your pipeline' },
          { name: 'In-Reply-To', value: '<first@rep.example.com>' },
        ],
        parts: [
          {
            mimeType: 'text/plain',
            headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
            body: { data: Buffer.from('Sounds good, thanks.\r\n', 'utf8').toString('base64url') },
          },
        ],
      },
    }
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/threads/`]: [
        { status: 200, body: { id: 'thread-1', historyId: '9', messages: [reply, 'not-a-message'] } },
      ],
      [`${GMAIL_API_BASE}/messages/msg-2`]: [{ status: 200, body: reply }],
    })
    const gmail = client(network)
    const thread = await gmail.getFullThread('thread-1')
    expect(thread).toEqual({ id: 'thread-1', historyId: '9', messages: [reply] })
    const threadUrl = new URL(network.calls.find((call) => call.url.includes('/threads/'))?.url ?? '')
    expect(threadUrl.pathname).toBe('/gmail/v1/users/me/threads/thread-1')
    expect([...threadUrl.searchParams.entries()]).toEqual([['format', 'full']])
    // What the runtime hands the engine reads as the reply it is.
    const read = outreachThreadMessageFromGmail(thread.messages[0])
    expect(read).toMatchObject({
      id: 'msg-2',
      threadId: 'thread-1',
      from: 'Jordan Lee <jordan@prospect.example.org>',
      subject: 'Re: A note on your pipeline',
      textBody: 'Sounds good, thanks.\r\n',
      snippet: 'Sounds good & thanks',
    })
    await expect(gmail.getFullMessage('msg-2')).resolves.toEqual(reply)
    const messageUrl = new URL(network.calls.find((call) => call.url.includes('/messages/msg-2'))?.url ?? '')
    expect(messageUrl.searchParams.get('format')).toBe('full')
  })

  it('searches messages with q, a page size and a page token', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/messages?`]: [{ status: 200, body: { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'p2', resultSizeEstimate: 5 } }],
    })
    const listed = await client(network).listMessages({ q: 'from:mailer-daemon newer_than:2d', maxResults: 50, pageToken: 'p1' })
    expect(listed).toEqual({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'p2', resultSizeEstimate: 5 })
    const url = new URL(network.calls[1].url)
    expect(url.searchParams.get('q')).toBe('from:mailer-daemon newer_than:2d')
    expect(url.searchParams.get('maxResults')).toBe('50')
    expect(url.searchParams.get('pageToken')).toBe('p1')
  })

  it('lists send-as addresses with their verification', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/settings/sendAs`]: [
        {
          status: 200,
          body: {
            sendAs: [
              { sendAsEmail: 'avery@rep.example.com', displayName: 'Avery Rep', isPrimary: true, isDefault: true },
              { sendAsEmail: 'Sales@Rep.Example.com', displayName: 'Sales', treatAsAlias: true, verificationStatus: 'accepted' },
              { sendAsEmail: 'pending@rep.example.com', verificationStatus: 'pending' },
            ],
          },
        },
      ],
    })
    const sendAs = await client(network).listSendAs()
    expect(sendAs.map((entry) => [entry.sendAsEmail, entry.isPrimary, entry.verificationStatus])).toEqual([
      ['avery@rep.example.com', true, null],
      ['sales@rep.example.com', false, 'accepted'],
      ['pending@rep.example.com', false, 'pending'],
    ])
  })
})

describe('Gmail client — error mapping and backoff (AGL-2978)', () => {
  it('backs off on a 429 and succeeds when Gmail recovers', async () => {
    const sleeps: number[] = []
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 429, body: { error: { code: 429 } } }, { status: 200, body: { emailAddress: 'avery@rep.example.com' } }],
    })
    await expect(client(network, { sleeps }).getProfile()).resolves.toEqual(expect.objectContaining({ emailAddress: 'avery@rep.example.com' }))
    expect(sleeps).toEqual([backoffDelayMs(1, () => 0.5)])
  })

  it('says rate_limited and retryable after the last attempt, with Google’s delay', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 429, body: { error: { code: 429 } }, headers: { 'retry-after': '2' } }],
    })
    const error = await client(network).getProfile().catch((caught) => caught)
    expect(error.code).toBe('rate_limited')
    expect(error.retryable).toBe(true)
    expect(error.reconnectRequired).toBe(false)
    expect(error.retryAfterMs).toBe(2000)
    expect(network.calls.filter((call) => call.url.endsWith('/profile'))).toHaveLength(3)
  })

  it('does not sit out a Retry-After longer than the invocation will wait', async () => {
    const sleeps: number[] = []
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 503, body: {}, headers: { 'retry-after': '120' } }],
    })
    const error = await client(network, { sleeps }).getProfile().catch((caught) => caught)
    expect(error.code).toBe('unavailable')
    expect(error.retryAfterMs).toBe(120_000)
    expect(sleeps).toEqual([])
    expect(network.calls.filter((call) => call.url.endsWith('/profile'))).toHaveLength(1)
  })

  it('treats a rate-limit 403 like a 429, and a scope 403 as reconnect required', async () => {
    const limited = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 403, body: { error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } } }],
    })
    expect(await codeOf(() => client(limited).getProfile())).toBe('rate_limited')
    expect(limited.calls.filter((call) => call.url.endsWith('/profile'))).toHaveLength(3)

    const scope = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/messages/send`]: [
        { status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } } },
      ],
    })
    const error = await client(scope).sendMessage({ raw: 'cmF3' }).catch((caught) => caught)
    expect(error.code).toBe('insufficient_scope')
    expect(error.reconnectRequired).toBe(true)
    expect(scope.calls.filter((call) => call.url.endsWith('/messages/send'))).toHaveLength(1)
  })

  it('maps quota, not found, malformed and no-Gmail answers without retrying them', async () => {
    const cases: Array<[Scripted, GmailTransportErrorCode]> = [
      [{ status: 403, body: { error: { errors: [{ reason: 'dailyLimitExceeded' }] } } }, 'quota_exceeded'],
      [{ status: 404, body: { error: { code: 404, message: 'Requested entity was not found.' } } }, 'not_found'],
      [{ status: 400, body: { error: { code: 400, errors: [{ reason: 'invalidArgument' }], message: 'Invalid To header' } } }, 'invalid_request'],
      [{ status: 400, body: { error: { code: 400, errors: [{ reason: 'failedPrecondition' }], message: 'Mail service not enabled' } } }, 'mail_service_unavailable'],
      [{ status: 403, body: { error: { code: 403, errors: [{ reason: 'forbidden' }] } } }, 'forbidden'],
    ]
    for (const [answer, expected] of cases) {
      const network = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK], [`${GMAIL_API_BASE}/threads/`]: [answer] })
      const error = await client(network).getThread('t1').catch((caught) => caught)
      expect([expected, error.code, error.retryable]).toEqual([expected, expected, false])
      expect(network.calls.filter((call) => call.url.includes('/threads/'))).toHaveLength(1)
    }
  })

  it('retries a dropped connection, then says network', async () => {
    const recovered = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: ['network-error', TOKEN_OK],
      [`${GMAIL_API_BASE}/profile`]: [{ status: 200, body: { emailAddress: 'avery@rep.example.com' } }],
    })
    await expect(client(recovered).getProfile()).resolves.toBeTruthy()

    const dead = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.token]: ['network-error'] })
    const error = await client(dead).getProfile().catch((caught) => caught)
    expect(error.code).toBe('network')
    expect(error.retryable).toBe(true)
    expect(dead.calls).toHaveLength(3)
  })

  it('reads Retry-After as seconds or a date, and keeps backoff bounded', () => {
    const at = Date.UTC(2026, 8, 14, 12, 0, 0)
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': '3' } }), at)).toBe(3000)
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': new Date(at + 5000).toUTCString() } }), at)).toBe(5000)
    expect(retryAfterMs(new Response(null), at)).toBeNull()
    expect(backoffDelayMs(1, () => 0)).toBe(250)
    expect(backoffDelayMs(1, () => 0.999)).toBeLessThanOrEqual(500)
    expect(backoffDelayMs(20, () => 0.999)).toBeLessThanOrEqual(8000)
  })
})

describe('Google OAuth — connect, exchange, revoke (AGL-2978)', () => {
  it('asks for offline access, the consent prompt, the four scopes and a PKCE challenge', () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: 'client-id.apps.googleusercontent.com',
        redirectUri: 'https://app.example.com/api/outreach/mailboxes/oauth/callback',
        state: 'signed-state',
        codeChallenge: pkceChallenge('verifier-value'),
        nonce: 'nonce-value',
        loginHint: 'avery@rep.example.com',
      }),
    )
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_OAUTH_ENDPOINTS.authorize)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id.apps.googleusercontent.com',
      redirect_uri: 'https://app.example.com/api/outreach/mailboxes/oauth/callback',
      response_type: 'code',
      scope: OUTREACH_GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state: 'signed-state',
      nonce: 'nonce-value',
      code_challenge: pkceChallenge('verifier-value'),
      code_challenge_method: 'S256',
      login_hint: 'avery@rep.example.com',
    })
    expect(OUTREACH_GOOGLE_SCOPES).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ])
  })

  it('computes the RFC 7636 S256 challenge', () => {
    // The worked example in RFC 7636 Appendix B.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('exchanges a code once, with its verifier, and reads the grant', async () => {
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [
        { status: 200, body: { access_token: 'access-1', expires_in: 3599, refresh_token: 'refresh-1', scope: 'openid email', id_token: 'a.b.c' } },
      ],
    })
    const grant = await exchangeGoogleAuthorizationCode(
      { clientId: 'cid', clientSecret: 'secret', code: 'code-1', redirectUri: 'https://app.example.com/cb', codeVerifier: 'verifier' },
      { fetch: network.fetchImpl },
    )
    expect(grant).toEqual({ accessToken: 'access-1', expiresInSeconds: 3599, refreshToken: 'refresh-1', scope: 'openid email', idToken: 'a.b.c' })
    expect(Object.fromEntries(new URLSearchParams(network.calls[0].body ?? ''))).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      client_id: 'cid',
      client_secret: 'secret',
      redirect_uri: 'https://app.example.com/cb',
      code_verifier: 'verifier',
    })
  })

  it('never retries a code exchange, whatever Google answered', async () => {
    const network = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.token]: [{ status: 503, body: {} }] })
    expect(
      await codeOf(() =>
        exchangeGoogleAuthorizationCode(
          { clientId: 'cid', clientSecret: 's', code: 'c', redirectUri: 'https://app.example.com/cb', codeVerifier: 'v' },
          { fetch: network.fetchImpl, sleep: async () => undefined },
        ),
      ),
    ).toBe('unavailable')
    expect(network.calls).toHaveLength(1)
  })

  it('revokes a token, and reads an already-dead one as done', async () => {
    const ok = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.revoke]: [{ status: 200, body: {} }] })
    await expect(revokeGoogleToken('refresh-1', { fetch: ok.fetchImpl })).resolves.toBe('revoked')
    expect(new URLSearchParams(ok.calls[0].body ?? '').get('token')).toBe('refresh-1')

    const dead = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.revoke]: [{ status: 400, body: { error: 'invalid_token' } }] })
    await expect(revokeGoogleToken('refresh-1', { fetch: dead.fetchImpl })).resolves.toBe('already-invalid')

    const down = fakeNetwork({ [GOOGLE_OAUTH_ENDPOINTS.revoke]: [{ status: 503, body: {} }] })
    expect(await codeOf(() => revokeGoogleToken('refresh-1', { fetch: down.fetchImpl, sleep: async () => undefined }))).toBe('unavailable')
  })

  it('checks the granted scopes, which a person may have narrowed on the consent screen', () => {
    expect(grantedScopesInclude(`openid ${OUTREACH_REQUIRED_GRANTED_SCOPES.join(' ')} https://www.googleapis.com/auth/userinfo.email`, OUTREACH_REQUIRED_GRANTED_SCOPES)).toBe(true)
    expect(grantedScopesInclude('openid https://www.googleapis.com/auth/gmail.send', OUTREACH_REQUIRED_GRANTED_SCOPES)).toBe(false)
    expect(grantedScopesInclude('', OUTREACH_REQUIRED_GRANTED_SCOPES)).toBe(false)
  })
})

describe('Google OAuth — the ID token (AGL-2978)', () => {
  const NOW = Date.UTC(2026, 8, 14, 12, 0, 0)
  const token = (claims: Record<string, unknown>) =>
    ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.')
  const valid = {
    iss: 'https://accounts.google.com',
    aud: 'cid',
    sub: '1234567890',
    email: 'Avery@Rep.Example.com',
    email_verified: true,
    nonce: 'nonce-1',
    exp: NOW / 1000 + 600,
  }
  const read = (claims: Record<string, unknown>) => readGoogleIdToken(token(claims), { clientId: 'cid', nonce: 'nonce-1', nowMs: NOW })

  it('reads the identity from a token that is about this exchange', () => {
    expect(read(valid)).toEqual({ ok: true, identity: { sub: '1234567890', email: 'avery@rep.example.com' } })
    expect(read({ ...valid, iss: 'accounts.google.com', email_verified: 'true' }).ok).toBe(true)
    expect(read({ ...valid, aud: ['cid', 'other'], azp: 'cid' }).ok).toBe(true)
  })

  it('refuses another issuer, audience, an expired token, a wrong nonce and an unverified address', () => {
    expect(read({ ...valid, iss: 'https://evil.example.com' })).toEqual({ ok: false, refusal: 'issuer' })
    expect(read({ ...valid, aud: 'another-client' })).toEqual({ ok: false, refusal: 'audience' })
    expect(read({ ...valid, aud: ['cid', 'other'], azp: 'other' })).toEqual({ ok: false, refusal: 'audience' })
    expect(read({ ...valid, exp: NOW / 1000 - 1 })).toEqual({ ok: false, refusal: 'expired' })
    expect(read({ ...valid, nonce: 'replayed' })).toEqual({ ok: false, refusal: 'nonce' })
    expect(read({ ...valid, nonce: undefined })).toEqual({ ok: false, refusal: 'nonce' })
    expect(read({ ...valid, email_verified: false })).toEqual({ ok: false, refusal: 'email-unverified' })
    expect(read({ ...valid, sub: '' })).toEqual({ ok: false, refusal: 'malformed' })
    expect(readGoogleIdToken('not-a-jwt', { clientId: 'cid', nonce: 'nonce-1', nowMs: NOW })).toEqual({ ok: false, refusal: 'malformed' })
    expect(readGoogleIdToken(null, { clientId: 'cid', nonce: 'nonce-1', nowMs: NOW })).toEqual({ ok: false, refusal: 'malformed' })
  })
})

describe('sending the engine’s composed email (AGL-2978)', () => {
  const ORG_SETTINGS = { legalName: 'Example Co LLC', brandName: '', postalAddress: '1 Main St\nSpringfield, IL 62701' }
  const SENDER = { address: 'avery@rep.example.com', name: 'Avery Rep' }
  const firstStep = { id: 's1', kind: 'email' as const, delayBusinessDays: 0, subject: 'A note on your pipeline', replyInThread: false, body: 'Hi Jordan,\n\nA quick note.', templateId: null }
  const secondStep = { id: 's2', kind: 'email' as const, delayBusinessDays: 2, subject: '', replyInThread: true, body: 'Following up on my note.', templateId: null }

  function sentRaw(network: ReturnType<typeof fakeNetwork>) {
    const request = network.calls.find((call) => call.url.endsWith('/messages/send'))
    const body = JSON.parse(request?.body ?? '{}') as { raw: string; threadId?: string }
    return { raw: Buffer.from(body.raw, 'base64url').toString('utf8'), threadId: body.threadId }
  }

  it('starts a thread from the send-as address, with both unsubscribe headers, and answers what the next step needs', async () => {
    const composed = composeOutreachEmail({
      sequence: { steps: [firstStep, secondStep] },
      enrollment: { email: 'jordan@prospect.example.org', stepIndex: 0, personalLine: '', threadSubject: null, messageIds: [], gmailThreadId: null },
      orgSettings: ORG_SETTINGS,
      merge: null,
      listUnsubscribeUrl: 'https://console.example.com/u/abc',
      listUnsubscribeMailto: 'unsubscribe@rep.example.com',
    })
    if (!composed.email) throw new Error(composed.error?.message)
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/messages/send`]: [{ status: 200, body: { id: 'msg-1', threadId: 'thread-new' } }],
    })
    const sent = await sendComposedOutreachEmail(client(network), composed.email, SENDER)
    expect(sent).toEqual({
      gmailMessageId: 'msg-1',
      threadId: 'thread-new',
      messageId: expect.stringMatching(/^<[^@]+@rep\.example\.com>$/),
      subject: 'A note on your pipeline',
    })
    const { raw, threadId } = sentRaw(network)
    expect(threadId).toBeUndefined()
    expect(raw).toContain('From: "Avery Rep" <avery@rep.example.com>\r\n')
    expect(raw).toContain('To: jordan@prospect.example.org\r\n')
    expect(raw).toContain('Subject: A note on your pipeline\r\n')
    expect(raw).toContain(
      'List-Unsubscribe: <https://console.example.com/u/abc>,\r\n <mailto:unsubscribe@rep.example.com?subject=unsubscribe>\r\n',
    )
    expect(raw).toContain(`List-Unsubscribe-Post: ${LIST_UNSUBSCRIBE_ONE_CLICK}\r\n`)
    expect(raw).not.toMatch(/^In-Reply-To:/m)
    expect(raw).toContain('This is a sales email from Example Co LLC.')
  })

  it('sends a reply step into the engine’s thread, answering the last message and naming them all', async () => {
    const composed = composeOutreachEmail({
      sequence: { steps: [firstStep, secondStep] },
      enrollment: {
        email: 'jordan@prospect.example.org',
        stepIndex: 1,
        personalLine: '',
        threadSubject: 'A note on your pipeline',
        messageIds: ['<first@rep.example.com>'],
        gmailThreadId: 'thread-new',
      },
      orgSettings: ORG_SETTINGS,
      merge: null,
    })
    if (!composed.email) throw new Error(composed.error?.message)
    const network = fakeNetwork({
      [GOOGLE_OAUTH_ENDPOINTS.token]: [TOKEN_OK],
      [`${GMAIL_API_BASE}/messages/send`]: [{ status: 200, body: { id: 'msg-2', threadId: 'thread-new' } }],
    })
    const sent = await sendComposedOutreachEmail(client(network), composed.email, SENDER)
    expect(sent.threadId).toBe('thread-new')
    expect(sent.subject).toBe('Re: A note on your pipeline')
    const { raw, threadId } = sentRaw(network)
    expect(threadId).toBe('thread-new')
    expect(raw).toContain('In-Reply-To: <first@rep.example.com>\r\n')
    expect(raw).toContain('References: <first@rep.example.com>\r\n')
    // No unsubscribe address was composed, so no unsubscribe header is sent.
    expect(raw).not.toMatch(/^List-Unsubscribe/m)
  })
})
