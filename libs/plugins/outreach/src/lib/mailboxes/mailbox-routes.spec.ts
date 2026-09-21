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

import {
  createSecretBoxKey,
  openSecret,
  parseSecretBoxKeyring,
} from '@aglyn/shared-util-tools/secret-box'
import type { DecodedIdToken } from 'firebase-admin/auth'
import {
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  GOOGLE_OAUTH_ENDPOINTS,
} from '../transport/google-oauth'
import { GMAIL_API_BASE } from '../transport/gmail-client'
import { parseConnectReturnFragment } from './mailbox-api'
import { refreshTokenSealContext } from './mailbox-credentials'
import {
  createOutreachMailboxRoutes,
  OUTREACH_TEST_SENDS_PER_HOUR,
  type OutreachMailboxRouteDeps,
} from './mailbox-routes'
import { OUTREACH_MAX_MAILBOXES_PER_MEMBER } from './mailbox-settings'
import {
  mintOutreachOAuthState,
  OUTREACH_OAUTH_STATE_TTL_MS,
  outreachOAuthStateDocId,
} from './oauth-state'
import { outreachOAuthCallbackSubject, outreachOrgSubject } from './register-mailbox-routes'

/**
 * The mailbox routes (AGL-2978), against an in-memory Firestore and a fake
 * Google.
 *
 * Every route runs for real — the state is really signed and consumed, the
 * refresh token really sealed, the RFC 5322 test message really built — and
 * only the edges are stubbed: the token verifier, the permission resolver,
 * the rate limiter, the activity log, and the network. No request leaves the
 * process.
 *
 * The connect is driven the way a browser drives it: `connect` answers
 * Google's address, the fake consent screen issues a code for the state in
 * it, the callback redirects to the Mailboxes page, the fragment is read back
 * off the `Location`, and `connect/complete` finishes it. Each refusal is
 * forced red against that same composition.
 */

// ── In-memory Firestore ─────────────────────────────────────────────────────

type Docs = Map<string, Record<string, unknown>>

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (isObject(value) && isObject(target[key])) mergeDeep(target[key] as Record<string, unknown>, value)
    else target[key] = structuredClone(value)
  }
}

const fieldOf = (data: Record<string, unknown> | undefined, field: string) =>
  field.split('.').reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), data)

function fakeFirestore(docs: Docs) {
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : structuredClone(data)),
      get: (field: string) => fieldOf(data, field),
    }
  }
  const apply = {
    set: (path: string, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (options?.merge && docs.has(path)) {
        const next = structuredClone(docs.get(path) as Record<string, unknown>)
        mergeDeep(next, data)
        docs.set(path, next)
      } else docs.set(path, structuredClone(data))
    },
    update: (path: string, data: Record<string, unknown>) => {
      const current = docs.get(path)
      if (!current) throw new Error(`NOT_FOUND ${path}`)
      const next = structuredClone(current)
      for (const [dotted, value] of Object.entries(data)) {
        const parts = dotted.split('.')
        let node = next
        for (const part of parts.slice(0, -1)) {
          if (!isObject(node[part])) node[part] = {}
          node = node[part] as Record<string, unknown>
        }
        node[parts[parts.length - 1]] = structuredClone(value)
      }
      docs.set(path, next)
    },
    delete: (path: string) => void docs.delete(path),
  }
  const query = (path: string, filters: Array<[string, unknown]>, limit: number): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      return query(path, [...filters, [field, value]], limit)
    },
    limit: (count: number) => query(path, filters, count),
    get: async () => {
      const found = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) => filters.every(([field, value]) => fieldOf(docs.get(key), field) === value))
        .sort()
        .slice(0, limit)
        .map(snapshot)
      return { docs: found, size: found.length, empty: !found.length }
    },
  })
  const doc = (path: string): any => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => apply.set(path, data, options),
    update: async (data: Record<string, unknown>) => apply.update(path, data),
    delete: async () => apply.delete(path),
  })
  const collection = (path: string): any => ({ ...query(path, [], Infinity), doc: (id: string) => doc(`${path}/${id}`) })
  const queued = () => {
    const writes: Array<() => void> = []
    return {
      writes,
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) =>
        void writes.push(() => apply.set(ref.path, data, options)),
      update: (ref: { path: string }, data: Record<string, unknown>) => void writes.push(() => apply.update(ref.path, data)),
      delete: (ref: { path: string }) => void writes.push(() => apply.delete(ref.path)),
    }
  }
  return {
    collection,
    batch: () => {
      const batch = queued()
      return { ...batch, commit: async () => batch.writes.forEach((write) => write()) }
    },
    runTransaction: async (body: (tx: any) => Promise<unknown>) => {
      const tx = queued()
      const result = await body({ ...tx, get: async (ref: { path: string }) => snapshot(ref.path) })
      tx.writes.forEach((write) => write())
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

// ── Fake Google ─────────────────────────────────────────────────────────────

const CLIENT_ID = 'outreach-client.apps.googleusercontent.com'
const REFRESH_TOKEN = '1//refresh-token-for-the-rep'
const ACCOUNT_SUB = '109876543210987654321'
const GRANTED = `openid ${GMAIL_SEND_SCOPE} ${GMAIL_READONLY_SCOPE} https://www.googleapis.com/auth/userinfo.email`

interface GoogleScript {
  tokenStatus: number
  tokenBody: (form: URLSearchParams) => unknown
  profileEmail: string
  sendAs: unknown[]
  sendStatus: number
  sendBody: unknown
  revokeStatus: number
}

let google: GoogleScript
let googleCalls: Array<{ url: string; body: string | null }>
/** The nonce Google echoes: the one the last consent URL asked for. */
let consentNonce = ''

const idTokenFor = (claims: Record<string, unknown>) =>
  ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.')

const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input)
  const body = typeof init?.body === 'string' ? init.body : null
  googleCalls.push({ url, body })
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  if (url === GOOGLE_OAUTH_ENDPOINTS.token) {
    return json(google.tokenStatus, google.tokenBody(new URLSearchParams(body ?? '')))
  }
  if (url === GOOGLE_OAUTH_ENDPOINTS.revoke) return json(google.revokeStatus, google.revokeStatus === 200 ? {} : { error: 'server_error' })
  if (url === `${GMAIL_API_BASE}/profile`) return json(200, { emailAddress: google.profileEmail, historyId: '1' })
  if (url === `${GMAIL_API_BASE}/settings/sendAs`) return json(200, { sendAs: google.sendAs })
  if (url === `${GMAIL_API_BASE}/messages/send`) return json(google.sendStatus, google.sendBody)
  throw new Error(`unscripted request to ${url}`)
}) as typeof fetch

const exchangeAnswer = (overrides: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) =>
  (form: URLSearchParams) =>
    form.get('grant_type') === 'refresh_token'
      ? { access_token: 'access-refreshed', expires_in: 3600 }
      : {
          access_token: 'access-1',
          expires_in: 3599,
          refresh_token: REFRESH_TOKEN,
          scope: GRANTED,
          id_token: idTokenFor({
            iss: 'https://accounts.google.com',
            aud: CLIENT_ID,
            sub: ACCOUNT_SUB,
            email: 'avery@rep.example.com',
            email_verified: true,
            nonce: consentNonce,
            exp: Math.floor(NOW / 1000) + 3600,
            ...claims,
          }),
          ...overrides,
        }

// ── The world ───────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 8, 14, 18, 0, 0)
const ORG = 'org-acme'
const OTHER_ORG = 'org-other'
const REP = 'uid-rep'
const TEAMMATE = 'uid-teammate'
const ADMIN = 'uid-admin'
const OUTSIDER = 'uid-outsider'

const KEY = createSecretBoxKey(Buffer.alloc(32, 9))
const KEYRING = parseSecretBoxKeyring(Buffer.from(KEY.material).toString('base64'))

let docs: Docs
let clock: number
let configured: boolean
let rateAllowed: boolean
let activity: Array<{ orgId: string; action: string; target: { id: string } }>
let aliasCalls: Array<{ orgId: string; uid: string; addresses: readonly string[] }>

const members: Record<
  string,
  { orgId: string; role: string; isOwner: boolean; orgWide: boolean; permissions: Record<string, boolean> }
> = {
  [REP]: { orgId: ORG, role: 'editor', isOwner: false, orgWide: true, permissions: { 'outreach.use': true } },
  [TEAMMATE]: { orgId: ORG, role: 'editor', isOwner: false, orgWide: true, permissions: { 'outreach.use': true } },
  [ADMIN]: { orgId: ORG, role: 'admin', isOwner: true, orgWide: true, permissions: { 'outreach.use': true } },
}

const tokens: Record<string, Partial<DecodedIdToken>> = {
  'token-rep': { uid: REP, email: 'avery@rep.example.com', email_verified: true, name: 'Avery Rep' },
  'token-teammate': { uid: TEAMMATE, email: 'kim@rep.example.com', email_verified: true },
  'token-admin': { uid: ADMIN, email: 'morgan@rep.example.com', email_verified: true },
  'token-outsider': { uid: OUTSIDER, email: 'lee@elsewhere.example.org', email_verified: true },
  'token-unverified': { uid: REP, email: 'avery@rep.example.com', email_verified: false },
}

function deps(): OutreachMailboxRouteDeps {
  return {
    firestore: () => fakeFirestore(docs),
    gate: {
      verifyIdToken: async (token) => {
        const decoded = tokens[token]
        if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
        return decoded as DecodedIdToken
      },
      // The real resolver's answer for an org the account is not on: that
      // org's id, no role, no reach.
      resolveOrgPermissions: async (uid, { orgId }) => {
        const member = members[uid]
        return member && member.orgId === orgId
          ? member
          : { orgId, role: null, isOwner: false, orgWide: false, permissions: {} }
      },
      readOrg: async (orgId) => docs.get(`orgs/${orgId}`) ?? null,
      lockdownRefusal: async () => null,
    },
    readConfig: () =>
      configured
        ? { configured: true, config: { clientId: CLIENT_ID, clientSecret: 'client-secret', keyring: KEYRING } }
        : { configured: false, missing: ['OUTREACH_TOKEN_KEY'] },
    stateSigningConfigured: () => true,
    redirectUri: () => 'https://app.example.com/api/outreach/mailboxes/oauth/callback',
    now: () => clock,
    transport: { fetch: fakeFetch, sleep: async () => undefined, now: () => clock },
    consumeRateLimit: async () => ({ allowed: rateAllowed }),
    logOrgActivity: async (orgId, _actor, action, target) => void activity.push({ orgId, action, target }),
    confirmAliasesByProvider: async (_firestore, input) => {
      aliasCalls.push(input)
      return { ok: true, confirmed: ['sales@rep.example.com'] }
    },
  }
}

const routes = () => createOutreachMailboxRoutes(deps())

const post = (path: string, body: unknown, token: string | null = 'token-rep') =>
  new Request(`https://app.example.com/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

const get = (path: string, token: string | null = 'token-rep') =>
  new Request(`https://app.example.com/api/${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

async function reply(response: Response | Promise<Response>) {
  const settled = await response
  const text = await settled.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // plain text
  }
  return { status: settled.status, body, headers: settled.headers }
}

const run = (handler: keyof ReturnType<typeof routes>, request: Request) =>
  reply(routes()[handler](request, { params: {} }))

/** `connect` → Google → callback → the page: the code and state as the page reads them. */
async function consent(token = 'token-rep') {
  const connected = await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, token))
  expect(connected.status).toBe(200)
  const url = new URL(connected.body.url)
  consentNonce = url.searchParams.get('nonce') ?? ''
  const state = url.searchParams.get('state') ?? ''
  const back = await run('oauthCallback', get(`outreach/mailboxes/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`, null))
  expect(back.status).toBe(303)
  const location = back.headers.get('location') ?? ''
  const fragment = parseConnectReturnFragment(location.slice(location.indexOf('#')))
  if (!fragment || fragment.kind !== 'code') throw new Error(`no code in ${location}`)
  return { state: fragment.state, code: fragment.code, location, url }
}

const complete = (body: { code: string; state: string }, token = 'token-rep', extra: Record<string, unknown> = {}) =>
  run('connectComplete', post('outreach/mailboxes/connect/complete', { orgId: ORG, ...body, ...extra }, token))

const mailboxPath = (id: string) => `orgs/${ORG}/outreachMailboxes/${id}`
const credentialPath = (id: string) => `outreachMailboxCredentials/${id}`

async function connectMailbox(token = 'token-rep') {
  const { code, state } = await consent(token)
  const done = await complete({ code, state }, token, { timezone: 'America/Chicago' })
  expect(done.status).toBe(200)
  return done.body.mailbox as { id: string } & Record<string, any>
}

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'outreach-mailbox-routes-spec-secret'
  docs = new Map()
  docs.set(`orgs/${ORG}`, { slug: 'acme', name: 'Acme', entitlements: { features: { outreach: true } } })
  docs.set(`orgs/${OTHER_ORG}`, { slug: 'other', name: 'Other' })
  clock = NOW
  configured = true
  rateAllowed = true
  activity = []
  aliasCalls = []
  googleCalls = []
  consentNonce = ''
  google = {
    tokenStatus: 200,
    tokenBody: exchangeAnswer(),
    profileEmail: 'avery@rep.example.com',
    sendAs: [
      { sendAsEmail: 'avery@rep.example.com', displayName: 'Avery Rep', isPrimary: true, isDefault: true },
      { sendAsEmail: 'sales@rep.example.com', displayName: 'Acme Sales', verificationStatus: 'accepted' },
      { sendAsEmail: 'unconfirmed@rep.example.com', verificationStatus: 'pending' },
    ],
    sendStatus: 200,
    sendBody: { id: 'gmail-msg-1', threadId: 'gmail-thread-1' },
    revokeStatus: 200,
  }
})

// ── The gate ────────────────────────────────────────────────────────────────

describe('the member gate every authenticated mailbox route climbs (AGL-2978)', () => {
  it('refuses no token, an unverified address, no org, a non-member, a missing permission and no entitlement', async () => {
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, null))).status).toBe(401)
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, 'token-forged'))).status).toBe(401)
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, 'token-unverified'))).body.reason).toBe('email-unverified')
    expect((await run('connect', post('outreach/mailboxes/connect', {}))).body.reason).toBe('org-required')
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, 'token-outsider'))).body.reason).toBe('not-a-member')

    members[TEAMMATE].permissions = {}
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, 'token-teammate'))).body.reason).toBe('permission')
    members[TEAMMATE].permissions = { 'outreach.use': true }

    members[TEAMMATE].orgWide = false
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }, 'token-teammate'))).body.reason).toBe('not-org-wide')
    members[TEAMMATE].orgWide = true

    docs.set(`orgs/${ORG}`, { slug: 'acme' })
    expect((await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }))).body).toEqual({
      error: "Sequences isn't available to this workspace yet.",
      reason: 'entitlement',
    })
  })

  it('answers whether the deployment is configured and whether the viewer manages every mailbox', async () => {
    expect((await run('availability', get(`outreach/mailboxes/availability?orgId=${ORG}`))).body).toEqual({
      configured: true,
      canManageAll: false,
    })
    expect((await run('availability', get(`outreach/mailboxes/availability?orgId=${ORG}`, 'token-admin'))).body).toEqual({
      configured: true,
      canManageAll: true,
    })
    configured = false
    // Not configured names the gate, with the variables the Google gate wants.
    expect((await run('availability', get(`outreach/mailboxes/availability?orgId=${ORG}`))).body).toEqual({
      configured: false,
      canManageAll: false,
      missing: [{ gate: 'google', missing: ['OUTREACH_TOKEN_KEY'] }],
    })
    const refused = await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }))
    expect(refused.status).toBe(503)
    expect(refused.body).toEqual({
      error: 'Connecting a Google mailbox is not configured on this deployment.',
      reason: 'not-configured',
    })
  })

  it('answers each route only its own method', async () => {
    expect((await run('connect', get('outreach/mailboxes/connect'))).status).toBe(405)
    expect((await run('availability', post('outreach/mailboxes/availability', { orgId: ORG }))).status).toBe(405)
    expect((await run('oauthCallback', post('outreach/mailboxes/oauth/callback', {}))).status).toBe(405)
  })
})

// ── Connect ─────────────────────────────────────────────────────────────────

describe('connect → Google → callback (AGL-2978)', () => {
  it('asks Google for offline access to the four scopes, for a state bound to the member, recorded once', async () => {
    const { url } = await consent()
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('login_hint')).toBe('avery@rep.example.com')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/outreach/mailboxes/oauth/callback')
    const pending = docs.get(`orgs/${ORG}/outreachOAuthStates/${outreachOAuthStateDocId(ORG, REP)}`)
    expect(pending).toEqual({
      orgId: ORG,
      uid: REP,
      nonceDigest: expect.any(String),
      redirectUri: 'https://app.example.com/api/outreach/mailboxes/oauth/callback',
      expiresAtMs: NOW + OUTREACH_OAUTH_STATE_TTL_MS,
      createdAtMs: NOW,
    })
    expect(JSON.stringify(pending)).not.toContain(url.searchParams.get('state'))
  })

  it('hands the code to the Mailboxes page in a fragment, acting on nothing itself', async () => {
    const { location, code } = await consent()
    expect(location.startsWith('/acme/outreach/mailboxes#')).toBe(true)
    expect(code).toBe('code-1')
    // The callback exchanged nothing and consumed nothing.
    expect(googleCalls).toEqual([])
    expect(docs.has(`orgs/${ORG}/outreachOAuthStates/${outreachOAuthStateDocId(ORG, REP)}`)).toBe(true)
  })

  it('carries a refusal on the consent screen, an expired state and a forged one', async () => {
    const connected = await run('connect', post('outreach/mailboxes/connect', { orgId: ORG }))
    const state = new URL(connected.body.url).searchParams.get('state') ?? ''
    const denied = await run('oauthCallback', get(`outreach/mailboxes/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`, null))
    expect(parseConnectReturnFragment((denied.headers.get('location') ?? '').split('#')[1])).toEqual({ kind: 'error', reason: 'access_denied' })

    clock = NOW + OUTREACH_OAUTH_STATE_TTL_MS + 1
    const late = await run('oauthCallback', get(`outreach/mailboxes/oauth/callback?code=c&state=${encodeURIComponent(state)}`, null))
    expect(late.headers.get('location')).toMatch(/^\/acme\/outreach\/mailboxes#/)
    expect(parseConnectReturnFragment((late.headers.get('location') ?? '').split('#')[1])).toEqual({ kind: 'error', reason: 'expired' })

    const forged = await run('oauthCallback', get(`outreach/mailboxes/oauth/callback?code=c&state=${encodeURIComponent(`${state}x`)}`, null))
    expect(forged.status).toBe(400)
    expect(forged.headers.get('location')).toBeNull()
  })

  it('names the org and member of a signed state to the release gate, and nobody for a forged one', async () => {
    const { state } = mintOutreachOAuthState({ orgId: ORG, uid: REP, nowMs: Date.now() })
    expect(outreachOAuthCallbackSubject(new Request(`https://app.example.com/cb?state=${encodeURIComponent(state)}`))).toEqual({ orgId: ORG, uid: REP })
    expect(outreachOAuthCallbackSubject(new Request('https://app.example.com/cb?state=os1.e30.nope'))).toBeNull()
    expect(await outreachOrgSubject(get(`outreach/mailboxes/availability?orgId=${ORG}`))).toEqual({ orgId: ORG })
    expect(await outreachOrgSubject(post('outreach/mailboxes/connect', { orgId: ORG }))).toEqual({ orgId: ORG })
    expect(await outreachOrgSubject(post('outreach/mailboxes/connect', { orgId: 'orgs/x' }))).toBeNull()
  })
})

describe('connect/complete (AGL-2978)', () => {
  it('creates the member’s mailbox with its sealed grant, verified send-as addresses and defaults', async () => {
    const { code, state } = await consent()
    const done = await complete({ code, state }, 'token-rep', { timezone: 'America/Chicago' })
    expect(done.status).toBe(200)
    expect(done.body.created).toBe(true)
    expect(done.body.confirmedAliases).toEqual(['sales@rep.example.com'])
    const mailbox = done.body.mailbox
    expect(mailbox).toMatchObject({
      provider: 'google',
      email: 'avery@rep.example.com',
      sendAs: 'avery@rep.example.com',
      displayName: 'Avery Rep',
      status: 'connected',
      dailyCap: 20,
      window: { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 },
      timezone: 'America/Chicago',
      rampStartedAtMs: NOW,
      connectedByUid: REP,
      connectedAtMs: NOW,
    })
    expect(mailbox.sendAsOptions.map((option: { email: string }) => option.email)).toEqual([
      'avery@rep.example.com',
      'sales@rep.example.com',
    ])
    expect(docs.get(mailboxPath(mailbox.id))).toEqual(mailbox)

    const credential = docs.get(credentialPath(mailbox.id)) as Record<string, any>
    expect(credential).toMatchObject({
      orgId: ORG,
      mailboxId: mailbox.id,
      provider: 'google',
      connectedByUid: REP,
      providerAccountId: ACCOUNT_SUB,
      email: 'avery@rep.example.com',
      tokenKeyId: KEY.id,
    })
    expect(JSON.stringify(credential)).not.toContain(REFRESH_TOKEN)
    expect(openSecret(credential['sealedRefreshToken'], KEYRING, { context: refreshTokenSealContext(mailbox.id) }).plaintext).toBe(REFRESH_TOKEN)

    // The code went to Google with its PKCE verifier and the recorded redirect.
    const exchange = new URLSearchParams(googleCalls.find((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.token)?.body ?? '')
    expect(exchange.get('code')).toBe('code-1')
    expect(exchange.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(exchange.get('redirect_uri')).toBe('https://app.example.com/api/outreach/mailboxes/oauth/callback')

    expect(docs.has(`orgs/${ORG}/outreachOAuthStates/${outreachOAuthStateDocId(ORG, REP)}`)).toBe(false)
    expect(aliasCalls).toEqual([
      { orgId: ORG, uid: REP, addresses: ['avery@rep.example.com', 'sales@rep.example.com'], nowMs: NOW },
    ])
    expect(activity).toEqual([{ orgId: ORG, action: 'Connected a mailbox in Sequences', target: { type: 'outreach:mailbox', id: mailbox.id, name: 'avery@rep.example.com' } }])
  })

  it('refuses a replayed state, and writes no second mailbox', async () => {
    const { code, state } = await consent()
    expect((await complete({ code, state })).status).toBe(200)
    const again = await complete({ code, state })
    expect(again.status).toBe(409)
    expect(again.body.reason).toBe('state-replayed')
    expect([...docs.keys()].filter((key) => key.includes('/outreachMailboxes/'))).toHaveLength(1)
  })

  it('refuses a state completed by another member — the consent screen someone else was sent to', async () => {
    const { code, state } = await consent('token-rep')
    const stolen = await complete({ code, state }, 'token-teammate')
    expect(stolen.status).toBe(403)
    expect(stolen.body.reason).toBe('state-user-mismatch')
    // Refused before anything was consumed or exchanged.
    expect(googleCalls).toEqual([])
    expect(docs.has(`orgs/${ORG}/outreachOAuthStates/${outreachOAuthStateDocId(ORG, REP)}`)).toBe(true)
  })

  it('refuses a state minted for another organization', async () => {
    const { state } = mintOutreachOAuthState({ orgId: OTHER_ORG, uid: REP, nowMs: NOW })
    const refused = await complete({ code: 'code-1', state })
    expect(refused.body.reason).toBe('state-org-mismatch')
  })

  it('refuses an expired state and a tampered one', async () => {
    const { code, state } = await consent()
    clock = NOW + OUTREACH_OAUTH_STATE_TTL_MS + 1
    const late = await complete({ code, state })
    expect(late.status).toBe(410)
    expect(late.body.reason).toBe('state-expired')
    clock = NOW
    const tampered = `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`
    expect((await complete({ code, state: tampered })).body.reason).toBe('state-invalid')
  })

  it('refuses a state a newer connect superseded, leaving the newer one usable', async () => {
    const first = await consent()
    const second = await consent()
    expect((await complete(first)).body.reason).toBe('state-superseded')
    expect((await complete(second)).status).toBe(200)
  })

  it('refuses a code Google rejects, a grant with no refresh token and a grant missing a scope', async () => {
    google.tokenStatus = 400
    google.tokenBody = () => ({ error: 'invalid_grant' })
    expect((await complete(await consent())).body.reason).toBe('code-rejected')

    google.tokenStatus = 200
    google.tokenBody = exchangeAnswer({ refresh_token: undefined })
    const noRefresh = await complete(await consent())
    expect(noRefresh.status).toBe(422)
    expect(noRefresh.body.reason).toBe('refresh-token-missing')

    google.tokenBody = exchangeAnswer({ scope: `openid ${GMAIL_SEND_SCOPE}` })
    expect((await complete(await consent())).body.reason).toBe('scopes-missing')
    expect([...docs.keys()].some((key) => key.startsWith('outreachMailboxCredentials/'))).toBe(false)
  })

  it('refuses an ID token for another nonce, an unverified address and a mismatched Gmail account', async () => {
    google.tokenBody = exchangeAnswer({}, { nonce: 'another-connect' })
    expect((await complete(await consent())).body.reason).toBe('identity-unverified')

    google.tokenBody = exchangeAnswer({}, { email_verified: false })
    const unverified = await complete(await consent())
    expect(unverified.body).toEqual({ error: "Google has not verified this account's email address.", reason: 'identity-unverified' })

    google.tokenBody = exchangeAnswer()
    google.profileEmail = 'someone-else@rep.example.com'
    expect((await complete(await consent())).body.reason).toBe('account-mismatch')
    expect([...docs.keys()].some((key) => key.includes('/outreachMailboxes/'))).toBe(false)
    // A refused grant is dropped, not revoked: the account may be connected elsewhere.
    expect(googleCalls.some((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.revoke)).toBe(false)
  })

  it('refuses a new mailbox past the member’s limit, but not a reconnect of one they have', async () => {
    const mailbox = await connectMailbox()
    for (let index = 1; index < OUTREACH_MAX_MAILBOXES_PER_MEMBER; index += 1) {
      docs.set(mailboxPath(`gm_existing_${index}`), { connectedByUid: REP, email: `old${index}@rep.example.com` })
    }
    expect((await complete(await consent())).status).toBe(200)
    expect(docs.get(mailboxPath(mailbox.id))?.['connectedByUid']).toBe(REP)

    google.tokenBody = exchangeAnswer({}, { sub: 'another-google-account' })
    const refused = await complete(await consent())
    expect(refused.status).toBe(409)
    expect(refused.body.reason).toBe('mailbox-limit')
  })

  it('reconnects the same account in place: settings, health and a pause kept', async () => {
    const mailbox = await connectMailbox()
    docs.set(mailboxPath(mailbox.id), {
      ...docs.get(mailboxPath(mailbox.id)),
      status: 'paused',
      dailyCap: 35,
      displayName: 'Avery at Acme',
      health: { ...(mailbox.health as object), bounces: 2, lastErrorCode: 'invalid_grant' },
    })
    clock = NOW + 60_000
    const again = await complete(await consent())
    expect(again.status).toBe(200)
    expect(again.body.created).toBe(false)
    expect(docs.get(mailboxPath(mailbox.id))).toMatchObject({
      status: 'paused',
      dailyCap: 35,
      displayName: 'Avery at Acme',
      connectedAtMs: NOW + 60_000,
      health: { bounces: 2 },
    })
    expect(activity.map((entry) => entry.action)).toEqual(['Connected a mailbox in Sequences', 'Reconnected a mailbox in Sequences'])
  })

  it('returns a reconnect_required mailbox to active', async () => {
    const mailbox = await connectMailbox()
    docs.set(mailboxPath(mailbox.id), { ...docs.get(mailboxPath(mailbox.id)), status: 'reconnect_required' })
    await complete(await consent())
    expect(docs.get(mailboxPath(mailbox.id))?.['status']).toBe('connected')
  })
})

// ── Settings, pause, test, disconnect ───────────────────────────────────────

describe('settings and status (AGL-2978)', () => {
  it('saves the send-as, name, cap, window and timezone the member chose', async () => {
    const mailbox = await connectMailbox()
    const saved = await run(
      'settings',
      post('outreach/mailboxes/settings', {
        orgId: ORG,
        mailboxId: mailbox.id,
        sendAs: 'Sales@Rep.Example.com',
        displayName: 'Acme Sales',
        dailyCap: 50,
        window: { days: [5, 1, 1], startMinute: 480, endMinute: 960 },
        timezone: 'Europe/Berlin',
      }),
    )
    expect(saved.status).toBe(200)
    expect(docs.get(mailboxPath(mailbox.id))).toMatchObject({
      sendAs: 'sales@rep.example.com',
      displayName: 'Acme Sales',
      dailyCap: 50,
      window: { days: [1, 5], startMinute: 480, endMinute: 960 },
      timezone: 'Europe/Berlin',
    })
  })

  it('refuses an unverified send-as, a cap over 50, an empty window and an unknown timezone', async () => {
    const mailbox = await connectMailbox()
    const refuse = async (patch: Record<string, unknown>) =>
      (await run('settings', post('outreach/mailboxes/settings', { orgId: ORG, mailboxId: mailbox.id, ...patch }))).body
    expect((await refuse({ sendAs: 'unconfirmed@rep.example.com' })).reason).toBe('invalid-settings')
    expect((await refuse({ dailyCap: 51 })).error).toBe('The daily cap must be a whole number from 1 to 50.')
    expect((await refuse({ dailyCap: 2.5 })).reason).toBe('invalid-settings')
    expect((await refuse({ window: { days: [], startMinute: 0, endMinute: 60 } })).reason).toBe('invalid-settings')
    expect((await refuse({ window: { days: [1], startMinute: 600, endMinute: 600 } })).reason).toBe('invalid-settings')
    expect((await refuse({ timezone: 'Mars/Olympus' })).reason).toBe('invalid-settings')
    expect((await refuse({ displayName: 'Two\nlines' })).reason).toBe('invalid-settings')
    expect(docs.get(mailboxPath(mailbox.id))?.['dailyCap']).toBe(20)
  })

  it('lets the member and an org admin change a mailbox, and no other member', async () => {
    const mailbox = await connectMailbox()
    const body = { orgId: ORG, mailboxId: mailbox.id, dailyCap: 10 }
    expect((await run('settings', post('outreach/mailboxes/settings', body, 'token-teammate'))).body.reason).toBe('not-your-mailbox')
    expect((await run('settings', post('outreach/mailboxes/settings', body, 'token-admin'))).status).toBe(200)
    expect((await run('settings', post('outreach/mailboxes/settings', { ...body, mailboxId: 'gm_missing' }))).body.reason).toBe('mailbox-not-found')
  })

  it('pauses and resumes, logs both, and refuses either on a mailbox that needs reconnecting', async () => {
    const mailbox = await connectMailbox()
    const status = (paused: boolean, token = 'token-rep') =>
      run('status', post('outreach/mailboxes/status', { orgId: ORG, mailboxId: mailbox.id, paused }, token))
    expect((await status(true)).body.mailbox.status).toBe('paused')
    expect(docs.get(mailboxPath(mailbox.id))?.['status']).toBe('paused')
    expect((await status(false, 'token-admin')).body.mailbox.status).toBe('connected')
    expect(activity.map((entry) => entry.action).slice(-2)).toEqual(['Paused a mailbox in Sequences', 'Resumed a mailbox in Sequences'])

    docs.set(mailboxPath(mailbox.id), { ...docs.get(mailboxPath(mailbox.id)), status: 'reconnect_required' })
    expect((await status(true)).body.reason).toBe('reconnect-required')
  })

  it('clears the reason a mailbox paused itself when a member resumes it (AGL-2981)', async () => {
    const mailbox = await connectMailbox()
    docs.set(mailboxPath(mailbox.id), {
      ...docs.get(mailboxPath(mailbox.id)),
      status: 'paused',
      autoPause: { reason: 'bounces_today', message: 'Paused after 2 hard bounces today.', atMs: NOW, untilMs: null },
    })
    const resumed = await run(
      'status',
      post('outreach/mailboxes/status', { orgId: ORG, mailboxId: mailbox.id, paused: false }, 'token-rep'),
    )
    expect(resumed.body.mailbox).toMatchObject({ status: 'connected', autoPause: null })
    expect(docs.get(mailboxPath(mailbox.id))).toMatchObject({ status: 'connected', autoPause: null })
  })
})

describe('send a test to myself (AGL-2978)', () => {
  it('sends a plain-text message from the send-as to the account’s own address', async () => {
    const mailbox = await connectMailbox()
    googleCalls = []
    const sent = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id }))
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ ok: true, sentTo: 'avery@rep.example.com', gmailMessageId: 'gmail-msg-1', sentAtMs: NOW })
    const request = googleCalls.find((call) => call.url === `${GMAIL_API_BASE}/messages/send`)
    const raw = Buffer.from(JSON.parse(request?.body ?? '{}').raw, 'base64url').toString('utf8')
    expect(raw).toContain('From: "Avery Rep" <avery@rep.example.com>\r\n')
    expect(raw).toContain('To: avery@rep.example.com\r\n')
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8\r\n')
    // The refresh token minted an access token; it was never sent anywhere else.
    const refresh = new URLSearchParams(googleCalls.find((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.token)?.body ?? '')
    expect(refresh.get('refresh_token')).toBe(REFRESH_TOKEN)
  })

  it('goes to an address the member names, and refuses one that is not an address (AGL-3228)', async () => {
    const mailbox = await connectMailbox()
    googleCalls = []
    const sent = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id, to: ' Outside@Example.org ' }))
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ ok: true, sentTo: 'outside@example.org' })
    const request = googleCalls.find((call) => call.url === `${GMAIL_API_BASE}/messages/send`)
    const raw = Buffer.from(JSON.parse(request?.body ?? '{}').raw, 'base64url').toString('utf8')
    expect(raw).toContain('To: outside@example.org\r\n')
    // An outside receiver is told where to read the authentication results
    // (the body is quoted-printable, so unfold its soft line breaks first).
    expect(raw.replace(/=\r\n/g, '')).toContain('Authentication-Results')
    const refused = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id, to: 'not an address' }))
    expect(refused.status).toBe(400)
    expect(refused.body.reason).toBe('invalid-request')
    // Blank means oneself, as before.
    const own = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id, to: '  ' }))
    expect(own.body.sentTo).toBe('avery@rep.example.com')
  })

  it('is its member’s alone, even for an org admin, and rate-limited', async () => {
    const mailbox = await connectMailbox()
    expect((await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id }, 'token-admin'))).body.reason).toBe('not-your-mailbox')
    rateAllowed = false
    const limited = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id }))
    expect(limited.status).toBe(429)
    expect(limited.body.error).toContain(String(OUTREACH_TEST_SENDS_PER_HOUR))
  })

  it('marks the mailbox reconnect_required when Google refuses the grant', async () => {
    const mailbox = await connectMailbox()
    google.tokenStatus = 400
    google.tokenBody = () => ({ error: 'invalid_grant' })
    clock = NOW + 5_000
    const refused = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id }))
    expect(refused.status).toBe(409)
    expect(refused.body.reason).toBe('reconnect-required')
    expect(docs.get(mailboxPath(mailbox.id))).toMatchObject({
      status: 'reconnect_required',
      health: { lastErrorCode: 'invalid_grant', lastErrorAtMs: NOW + 5_000 },
    })
  })

  it('marks it reconnect_required when the stored token no longer opens with this deployment’s key', async () => {
    const mailbox = await connectMailbox()
    const credential = docs.get(credentialPath(mailbox.id)) as Record<string, unknown>
    // Sealed under a key this deployment no longer holds.
    const rotatedAway = createSecretBoxKey(Buffer.alloc(32, 3))
    docs.set(credentialPath(mailbox.id), {
      ...credential,
      sealedRefreshToken: String(credential['sealedRefreshToken']).replace(`sb1.${KEY.id}.`, `sb1.${rotatedAway.id}.`),
    })
    const refused = await run('test', post('outreach/mailboxes/test', { orgId: ORG, mailboxId: mailbox.id }))
    expect(refused.body.reason).toBe('reconnect-required')
    expect(docs.get(mailboxPath(mailbox.id))?.['status']).toBe('reconnect_required')
  })
})

describe('disconnect (AGL-2978)', () => {
  it('revokes the grant at Google and deletes the mailbox and its credential', async () => {
    const mailbox = await connectMailbox()
    googleCalls = []
    const done = await run('disconnect', post('outreach/mailboxes/disconnect', { orgId: ORG, mailboxId: mailbox.id }))
    expect(done.body).toEqual({ ok: true, revocation: 'revoked' })
    expect(new URLSearchParams(googleCalls.find((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.revoke)?.body ?? '').get('token')).toBe(REFRESH_TOKEN)
    expect(docs.has(mailboxPath(mailbox.id))).toBe(false)
    expect(docs.has(credentialPath(mailbox.id))).toBe(false)
    expect(activity.at(-1)?.action).toBe('Disconnected a mailbox in Sequences')
  })

  it('keeps the grant while another mailbox still uses the same Google account', async () => {
    const mine = await connectMailbox('token-rep')
    // A teammate connected the same shared account.
    const shared = await connectMailbox('token-teammate')
    expect(shared.id).not.toBe(mine.id)
    googleCalls = []
    const done = await run('disconnect', post('outreach/mailboxes/disconnect', { orgId: ORG, mailboxId: mine.id }))
    expect(done.body.revocation).toBe('kept-for-other-mailbox')
    expect(googleCalls.some((call) => call.url === GOOGLE_OAUTH_ENDPOINTS.revoke)).toBe(false)
    expect(docs.has(credentialPath(shared.id))).toBe(true)
  })

  it('still deletes when Google cannot be told, and says so', async () => {
    const mailbox = await connectMailbox()
    google.revokeStatus = 503
    const done = await run('disconnect', post('outreach/mailboxes/disconnect', { orgId: ORG, mailboxId: mailbox.id }))
    expect(done.body.revocation).toBe('failed')
    expect(docs.has(credentialPath(mailbox.id))).toBe(false)
  })

  it('lets an org admin disconnect a member’s mailbox, and no other member', async () => {
    const mailbox = await connectMailbox()
    expect((await run('disconnect', post('outreach/mailboxes/disconnect', { orgId: ORG, mailboxId: mailbox.id }, 'token-teammate'))).body.reason).toBe('not-your-mailbox')
    expect((await run('disconnect', post('outreach/mailboxes/disconnect', { orgId: ORG, mailboxId: mailbox.id }, 'token-admin'))).status).toBe(200)
  })
})
