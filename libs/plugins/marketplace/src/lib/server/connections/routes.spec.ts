/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 */
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

import { randomBytes } from 'node:crypto'
import { parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { createMemoryFirestore, type MemoryFirestore } from '../../testing/memory-firestore'
import { registerMarketplaceDeclarations } from '../../declarations'
import { PLUGIN_CONNECTIONS_FEATURE } from '../../model/plugin-connections'
import { PLUGIN_CONNECTIONS_TOKEN_KEY_ENV } from './config'
import { connectionAccessToken, getConnection, openToken, readConnection, tokenContext } from './connection-store'
import { credentialsContext, openCredentials, saveCredentials, sealCredentials } from './credentials-store'
import { mintConnectState, readConnectState } from './oauth-state'
import { erasePluginConnectionCredentials, pluginConnectionsSiteEraser } from './erasure'
import { pluginConnectionRuntime } from './provider-http'
import {
  chooseRoute,
  connectCallbackRoute,
  connectCallbackSubject,
  connectStartRoute,
  credentialsRoute,
  disconnectRoute,
  resourcesRoute,
  statusRoute,
} from './routes'

/**
 * Declared connections' routes (AGL-4193): the platform's half of a
 * marketplace plugin's OAuth connection. A connect bound by a signed,
 * single-use state to one member of one site, one listing and one of its
 * connections; tokens and the publisher's OAuth app sealed and never read
 * back; the plan feature (Starter, Pro, Custom on; Free off); the two
 * permission keys, refused by name; and every request the platform makes
 * kept on the declared hosts.
 */

const HOST = 'host-acme'
const FREE_HOST = 'host-free'
const LISTING = 'listing_Reviews-1'
const PUBLISHER_ORG = 'org-publisher'
const CONSOLE = 'https://app.example.com'
const RETURN_TO = '/acme/sites/host-acme/plugins/listing_Reviews-1'
const NOW = Date.UTC(2026, 10, 5, 15)

const CONNECTION = {
  id: 'reviews',
  provider: 'google',
  label: 'Google Business Profile',
  authorizationUrl: 'https://accounts.example.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.example.com/token',
  revocationUrl: 'https://oauth2.example.com/revoke',
  scopes: ['business.manage'],
  authParams: { access_type: 'offline', prompt: 'consent' },
  apiHosts: ['mybusiness.example.com'],
  resources: [
    {
      id: 'accounts',
      label: 'Account',
      request: { method: 'GET', url: 'https://mybusiness.example.com/v1/accounts', itemsPath: 'accounts' },
      idPath: 'name',
      labelPath: 'accountName',
    },
    {
      id: 'locations',
      label: 'Location',
      request: {
        method: 'GET',
        url: 'https://mybusiness.example.com/v1/{{resource.accounts}}/locations',
        itemsPath: 'locations',
      },
      idPath: 'name',
      labelPath: 'title',
    },
  ],
}

let db: MemoryFirestore
let clock = NOW
let keyring = parseSecretBoxKeyring(randomBytes(32).toString('base64'))

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email_verified: true },
  'tok-staff': { uid: 'uid-staff', email_verified: true, staff: true },
  'tok-publisher': { uid: 'uid-publisher', email_verified: true },
  'tok-publisher-editor': { uid: 'uid-publisher-editor', email_verified: true },
  'tok-stranger': { uid: 'uid-stranger', email_verified: true },
}

const firebaseAdminFake = {
  app: () => ({
    firestore: () => db,
    auth: () => ({
      verifyIdToken: async (token: string) => {
        const decoded = TOKENS[token]
        if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' })
        return decoded
      },
    }),
  }),
}

const activity: Array<{ hostId: string; action: string }> = []
const PUBLISHER_ROLES: Record<string, string> = { 'uid-publisher': 'admin', 'uid-publisher-editor': 'editor' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  getOrgForHost: async (hostId: string) => {
    if (hostId === 'host-acme') return { orgId: 'org-acme', org: { plan: 'starter', subscription: { status: 'active' } } }
    if (hostId === 'host-free') return { orgId: 'org-free', org: { plan: 'free' } }
    return null
  },
  logHostActivity: async (hostId: string, _actor: unknown, action: string) => {
    activity.push({ hostId, action })
  },
  resolveOrgMembership: async (uid: string, orgId: string) =>
    orgId === 'org-publisher' && PUBLISHER_ROLES[uid] ? { member: { role: PUBLISHER_ROLES[uid] } } : null,
  memberHasOrgPermission: async (_orgId: string, member: { role: string }) => member.role === 'admin' || member.role === 'owner',
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

/** Every request the platform made, by URL. */
let calls: Array<{ url: string; init: RequestInit }> = []
let tokenAnswer: { status: number; body: Record<string, unknown> } = {
  status: 200,
  body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'business.manage' },
}

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  calls.push({ url, init })
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  if (url === 'https://oauth2.example.com/token') return json(tokenAnswer.status, tokenAnswer.body)
  if (url === 'https://oauth2.example.com/revoke') return json(200, {})
  if (url === 'https://mybusiness.example.com/v1/accounts') {
    return json(200, { accounts: [{ name: 'accounts/1', accountName: 'Acme Bakery' }, { name: 'accounts/2', accountName: 'Acme Two' }] })
  }
  if (url === 'https://mybusiness.example.com/v1/accounts/1/locations') {
    return json(200, { locations: [{ name: 'locations/9', title: 'Main Street' }] })
  }
  return json(404, { error: { message: 'not found' } })
}

const ENV_KEYS = [PLUGIN_CONNECTIONS_TOKEN_KEY_ENV, 'TOKEN_SIGNING_SECRET', 'NEXT_PUBLIC_CONSOLE_URL']
const savedEnv: Record<string, string | undefined> = {}
const savedRuntime = { ...pluginConnectionRuntime }

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  registerMarketplaceDeclarations()
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  Object.assign(pluginConnectionRuntime, savedRuntime)
})

beforeEach(async () => {
  db = createMemoryFirestore()
  clock = NOW
  calls = []
  activity.length = 0
  tokenAnswer = {
    status: 200,
    body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'business.manage' },
  }
  const key = randomBytes(32).toString('base64')
  keyring = parseSecretBoxKeyring(key)
  process.env[PLUGIN_CONNECTIONS_TOKEN_KEY_ENV] = key
  process.env['TOKEN_SIGNING_SECRET'] = randomBytes(32).toString('hex')
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = CONSOLE
  Object.assign(pluginConnectionRuntime, { fetch: fakeFetch, now: () => clock, sleep: async () => undefined })
  for (const hostId of [HOST, FREE_HOST]) {
    db.docs.set(`hosts/${hostId}`, { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor' } })
    db.docs.set(`hosts/${hostId}/installs/${LISTING}`, {
      listingId: LISTING,
      displayName: 'Reviews widget',
      version: '1.0.0',
      manifest: { id: 'reviews-widget', name: 'Reviews widget', version: '1.0.0', connections: [CONNECTION] },
    })
  }
  db.docs.set(`marketplaceListings/${LISTING}`, { profileId: PUBLISHER_ORG, latestVersion: '1.0.0' })
  db.docs.set(`marketplaceListings/${LISTING}/pluginVersions/1.0.0`, {
    version: '1.0.0',
    manifest: { id: 'reviews-widget', connections: [CONNECTION] },
  })
  await saveCredentials(
    db as never,
    sealCredentials(keyring, {
      orgId: PUBLISHER_ORG,
      listingId: LISTING,
      connectionId: 'reviews',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      uid: 'uid-publisher',
      nowMs: NOW,
    }),
  )
})

const get = (path: string, query: Record<string, string>, token?: string) =>
  new Request(`${CONSOLE}/api/${path}?${new URLSearchParams(query)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

const post = (path: string, body: Record<string, unknown>, token?: string) =>
  new Request(`${CONSOLE}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

const SITE = { hostId: HOST, listingId: LISTING, connectionId: 'reviews' }

/** Starts a connect as the site admin and answers the state the provider would hand back. */
async function startConnect(): Promise<string> {
  const response = await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-admin'))
  expect(response.status).toBe(200)
  const { authorizeUrl } = (await response.json()) as { authorizeUrl: string }
  return new URL(authorizeUrl).searchParams.get('state') ?? ''
}

async function connect(): Promise<void> {
  const state = await startConnect()
  const response = await connectCallbackRoute(get('plugin-connections/connect/callback', { state, code: 'code-1' }))
  expect(response.headers.get('location')).toContain('pluginConnectionResult=connected')
}

const docsUnder = (prefix: string) => [...db.docs.keys()].filter((path) => path.startsWith(prefix))

describe('the plan feature (AGL-4193)', () => {
  it('is on for Starter, Pro and Custom, off for Free, and an override grants it', () => {
    const active = { subscription: { status: 'active' } }
    expect(checkEntitlement({ plan: 'free' } as never, PLUGIN_CONNECTIONS_FEATURE)).toBe(false)
    expect(checkEntitlement({ plan: 'starter', ...active } as never, PLUGIN_CONNECTIONS_FEATURE)).toBe(true)
    expect(checkEntitlement({ plan: 'pro', ...active } as never, PLUGIN_CONNECTIONS_FEATURE)).toBe(true)
    expect(checkEntitlement({ plan: 'enterprise', ...active } as never, PLUGIN_CONNECTIONS_FEATURE)).toBe(true)
    expect(
      checkEntitlement({ plan: 'free', entitlements: { features: { [PLUGIN_CONNECTIONS_FEATURE]: true } } } as never, PLUGIN_CONNECTIONS_FEATURE),
    ).toBe(true)
  })
})

describe('connect/start (AGL-4193)', () => {
  it('sends the admin to the declared provider with the publisher’s client id and a signed state', async () => {
    const response = await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-admin'))
    expect(response.status).toBe(200)
    const url = new URL(((await response.json()) as { authorizeUrl: string }).authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://accounts.example.com/o/oauth2/auth')
    expect(url.searchParams.get('client_id')).toBe('client-abc')
    expect(url.searchParams.get('redirect_uri')).toBe(`${CONSOLE}/api/plugin-connections/connect/callback`)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('state')).toMatch(/^pc1\./)
    expect(docsUnder(`hosts/${HOST}/pluginConnections/oauth-`)).toHaveLength(1)
  })

  it('refuses a member without "Manage a site’s plugin connections", by the permission’s name', async () => {
    const response = await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-editor'))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string; permission: string }
    expect(body.error).toBe('Your role does not include "Manage a site’s plugin connections" — ask an organization admin')
    expect(body.permission).toBe('marketplace.siteConnections')
    expect(body.error).not.toMatch(/\badmin role\b|\beditor\b/i)
    expect(docsUnder(`hosts/${HOST}/pluginConnections/`)).toHaveLength(0)
  })

  it('refuses staff who do not hold the key on the site: the grant is the business’s own account', async () => {
    const response = await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-staff'))
    expect(response.status).toBe(403)
  })

  it('refuses a Free plan with the plans that include it, never a price', async () => {
    const response = await connectStartRoute(
      get('plugin-connections/connect/start', { ...SITE, hostId: FREE_HOST, returnTo: RETURN_TO }, 'tok-admin'),
    )
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string; reason: string }
    expect(body.reason).toBe('plan')
    expect(body.error).toMatch(/Starter, Pro and Custom/)
    expect(body.error).not.toMatch(/\$/)
  })

  it('answers 401 without a sign-in, 409 before the publisher sets credentials, 503 without the sealing key', async () => {
    expect((await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }))).status).toBe(401)
    db.docs.delete(`pluginConnectionCredentials/${LISTING}__reviews`)
    expect((await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-admin'))).status).toBe(409)
    delete process.env[PLUGIN_CONNECTIONS_TOKEN_KEY_ENV]
    expect((await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-admin'))).status).toBe(503)
  })

  it('refuses a connection the site’s pinned version does not declare, and a revoked version', async () => {
    const other = await connectStartRoute(
      get('plugin-connections/connect/start', { ...SITE, connectionId: 'other', returnTo: RETURN_TO }, 'tok-admin'),
    )
    expect(other.status).toBe(404)
    db.docs.set(`revocations/${LISTING}`, { versions: ['1.0.0'] })
    expect((await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo: RETURN_TO }, 'tok-admin'))).status).toBe(404)
  })

  it('refuses to come back anywhere but the console', async () => {
    for (const returnTo of ['https://evil.example.org/x', '//evil.example.org/x', 'javascript:alert(1)', '/api/plugin-connections/connect/callback']) {
      const response = await connectStartRoute(get('plugin-connections/connect/start', { ...SITE, returnTo }, 'tok-admin'))
      expect([returnTo, response.status]).toEqual([returnTo, 400])
    }
  })
})

describe('connect/callback (AGL-4193)', () => {
  it('exchanges the code at the declared token URL with the publisher’s app, and seals both tokens', async () => {
    const state = await startConnect()
    const response = await connectCallbackRoute(get('plugin-connections/connect/callback', { state, code: 'code-1' }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      `${RETURN_TO}?pluginConnectionListing=${LISTING}&pluginConnection=reviews&pluginConnectionResult=connected`,
    )
    const exchange = calls.find((call) => call.url === 'https://oauth2.example.com/token')
    const form = new URLSearchParams(String(exchange?.init.body))
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: `${CONSOLE}/api/plugin-connections/connect/callback`,
      client_id: 'client-abc',
      client_secret: 'secret-xyz',
    })
    expect(exchange?.init.redirect).toBe('manual')
    const stored = db.docs.get(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`) ?? {}
    expect(JSON.stringify(stored)).not.toContain('access-1')
    expect(JSON.stringify(stored)).not.toContain('refresh-1')
    const record = readConnection(stored)
    expect(record).toMatchObject({ status: 'connected', provider: 'google', scopes: ['business.manage'], orgId: 'org-acme' })
    expect(openToken(keyring, record as never, 'refresh').token).toBe('refresh-1')
    expect(openToken(keyring, record as never, 'access').token).toBe('access-1')
    expect(activity).toEqual([{ hostId: HOST, action: 'Connected Google Business Profile for Reviews widget' }])
  })

  it('spends a state once: a replay comes back expired and exchanges nothing', async () => {
    const state = await startConnect()
    await connectCallbackRoute(get('plugin-connections/connect/callback', { state, code: 'code-1' }))
    calls = []
    const replay = await connectCallbackRoute(get('plugin-connections/connect/callback', { state, code: 'code-2' }))
    expect(replay.headers.get('location')).toContain('pluginConnectionResult=expired')
    expect(calls).toHaveLength(0)
  })

  it('refuses a tampered state outright: another listing, another site, a forged signature', async () => {
    const state = await startConnect()
    const [version, payload, signature] = state.split('.')
    const wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    for (const change of [{ l: 'listing-other' }, { h: 'host-other' }, { u: 'uid-editor' }, { c: 'other' }]) {
      const forged = Buffer.from(JSON.stringify({ ...wire, ...change }), 'utf8').toString('base64url')
      const response = await connectCallbackRoute(
        get('plugin-connections/connect/callback', { state: `${version}.${forged}.${signature}`, code: 'code-1' }),
      )
      expect([change, response.status]).toEqual([change, 400])
    }
    const flipped = `${version}.${payload}.${signature.slice(0, -2)}xx`
    expect((await connectCallbackRoute(get('plugin-connections/connect/callback', { state: flipped, code: 'c' }))).status).toBe(400)
    expect((await connectCallbackRoute(get('plugin-connections/connect/callback', { state: `sc1.${payload}.${signature}`, code: 'c' }))).status).toBe(400)
    expect(calls.filter((call) => call.url.includes('/token'))).toHaveLength(0)
    expect(readConnectState(state, NOW).ok).toBe(true)
  })

  it('reads an expired state as expired, and its subject as the member who started it', async () => {
    const state = await startConnect()
    clock = NOW + 16 * 60 * 1000
    expect(connectCallbackSubject(get('plugin-connections/connect/callback', { state }))).toEqual({ orgId: 'org-acme', uid: 'uid-admin' })
    const response = await connectCallbackRoute(get('plugin-connections/connect/callback', { state, code: 'code-1' }))
    expect(response.headers.get('location')).toContain('pluginConnectionResult=expired')
    expect(connectCallbackSubject(get('plugin-connections/connect/callback', { state: 'nope' }))).toBeNull()
  })

  it('does not finish for a member who lost the key while at the provider', async () => {
    const state = await startConnect()
    db.docs.set(`hosts/${HOST}`, {
      memberRoles: { 'uid-admin': 'admin' },
      memberPermissions: { 'uid-admin': { 'marketplace.siteConnections': false } },
    })
    const response = await connectCallbackRoute(get('plugin-connections/connect/callback', { state, code: 'code-1' }))
    expect(response.headers.get('location')).toContain('pluginConnectionResult=not-permitted')
    expect(db.docs.has(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`)).toBe(false)
  })

  it('comes back denied when the owner declined at the provider', async () => {
    const state = await startConnect()
    const response = await connectCallbackRoute(get('plugin-connections/connect/callback', { state, error: 'access_denied' }))
    expect(response.headers.get('location')).toContain('pluginConnectionResult=denied')
  })
})

describe('sealing (AGL-4193)', () => {
  it('binds a site’s token to its own document: copied to another site, it does not open', async () => {
    await connect()
    const record = readConnection(db.docs.get(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`))
    expect(() => openToken(keyring, { ...(record as object), hostId: 'host-other' } as never, 'access')).toThrow()
    expect(tokenContext({ hostId: HOST, listingId: LISTING, connectionId: 'reviews' }, 'access')).not.toBe(
      tokenContext({ hostId: HOST, listingId: LISTING, connectionId: 'reviews' }, 'refresh'),
    )
  })

  it('binds a listing’s credentials to the listing, and stores neither value in the clear', async () => {
    const stored = db.docs.get(`pluginConnectionCredentials/${LISTING}__reviews`) ?? {}
    expect(JSON.stringify(stored)).not.toContain('client-abc')
    expect(JSON.stringify(stored)).not.toContain('secret-xyz')
    expect(await openCredentials(db as never, keyring, LISTING, 'reviews')).toEqual({ clientId: 'client-abc', clientSecret: 'secret-xyz' })
    db.docs.set(`pluginConnectionCredentials/listing-2__reviews`, { ...stored, listingId: 'listing-2' })
    await expect(openCredentials(db as never, keyring, 'listing-2', 'reviews')).rejects.toThrow()
    expect(credentialsContext(LISTING, 'reviews', 'client-id')).not.toBe(credentialsContext(LISTING, 'reviews', 'client-secret'))
  })
})

describe('resources and choose (AGL-4193)', () => {
  it('lists what the grant reaches, chains the next resource from the choice, and is ready once all are chosen', async () => {
    await connect()
    const accounts = await resourcesRoute(get('plugin-connections/resources', { ...SITE, resource: 'accounts' }, 'tok-admin'))
    expect(await accounts.json()).toEqual({
      items: [
        { id: 'accounts/1', label: 'Acme Bakery' },
        { id: 'accounts/2', label: 'Acme Two' },
      ],
    })
    const early = await resourcesRoute(get('plugin-connections/resources', { ...SITE, resource: 'locations' }, 'tok-admin'))
    expect(early.status).toBe(409)
    const chosen = await chooseRoute(post('plugin-connections/choose', { ...SITE, resource: 'accounts', id: 'accounts/1' }, 'tok-admin'))
    expect(((await chosen.json()) as { connection: { ready: boolean } }).connection.ready).toBe(false)
    const locations = await resourcesRoute(get('plugin-connections/resources', { ...SITE, resource: 'locations' }, 'tok-admin'))
    expect(await locations.json()).toEqual({ items: [{ id: 'locations/9', label: 'Main Street' }] })
    expect(calls.some((call) => call.url === 'https://mybusiness.example.com/v1/accounts/1/locations')).toBe(true)
    const done = await chooseRoute(post('plugin-connections/choose', { ...SITE, resource: 'locations', id: 'locations/9' }, 'tok-admin'))
    const view = ((await done.json()) as { connection: Record<string, unknown> }).connection
    expect(view).toMatchObject({
      ready: true,
      status: 'connected',
      choices: { accounts: { id: 'accounts/1', label: 'Acme Bakery' }, locations: { id: 'locations/9', label: 'Main Street' } },
    })
    expect(JSON.stringify(view)).not.toMatch(/sealed|access-1|refresh-1|Lease/)
    expect((await getConnection(db as never, HOST, LISTING, 'reviews'))?.nextSyncAtMs).toBe(NOW)
  })

  it('clears a later choice when an earlier one changes', async () => {
    await connect()
    await chooseRoute(post('plugin-connections/choose', { ...SITE, resource: 'accounts', id: 'accounts/1' }, 'tok-admin'))
    await chooseRoute(post('plugin-connections/choose', { ...SITE, resource: 'locations', id: 'locations/9' }, 'tok-admin'))
    await chooseRoute(post('plugin-connections/choose', { ...SITE, resource: 'accounts', id: 'accounts/2' }, 'tok-admin'))
    const record = await getConnection(db as never, HOST, LISTING, 'reviews')
    expect(Object.keys(record?.choices ?? {})).toEqual(['accounts'])
    expect(record?.nextSyncAtMs).toBeNull()
  })

  it('refuses a choice the provider did not list, or one that could leave the URL path', async () => {
    await connect()
    for (const id of ['accounts/3', '../../admin', 'accounts/1?x=1']) {
      const response = await chooseRoute(post('plugin-connections/choose', { ...SITE, resource: 'accounts', id }, 'tok-admin'))
      expect([id, response.status]).toEqual([id, 400])
    }
  })

  it('refuses the picker to a member without the key, and before a connection exists', async () => {
    expect((await resourcesRoute(get('plugin-connections/resources', { ...SITE, resource: 'accounts' }, 'tok-admin'))).status).toBe(409)
    await connect()
    expect((await resourcesRoute(get('plugin-connections/resources', { ...SITE, resource: 'accounts' }, 'tok-editor'))).status).toBe(403)
  })
})

describe('the refresh lease and reconnect-required (AGL-4193)', () => {
  const deps = () => ({
    firestore: db as never,
    keyring,
    connection: CONNECTION as never,
    client: { clientId: 'client-abc', clientSecret: 'secret-xyz' },
    now: () => clock,
    sleep: async () => undefined,
  })

  it('refreshes a stale token once, keeps the refresh token the provider did not rotate, and stores it sealed', async () => {
    await connect()
    clock = NOW + 2 * 60 * 60 * 1000
    tokenAnswer = { status: 200, body: { access_token: 'access-2', expires_in: 3600 } }
    const record = await getConnection(db as never, HOST, LISTING, 'reviews')
    expect(await connectionAccessToken(deps(), record as never)).toBe('access-2')
    const after = await getConnection(db as never, HOST, LISTING, 'reviews')
    expect(openToken(keyring, after as never, 'access').token).toBe('access-2')
    expect(openToken(keyring, after as never, 'refresh').token).toBe('refresh-1')
    expect(after?.refreshLeaseUntilMs).toBe(0)
  })

  it('moves a refused grant to reconnect_required, which the picker then names', async () => {
    await connect()
    clock = NOW + 2 * 60 * 60 * 1000
    tokenAnswer = { status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
    const record = await getConnection(db as never, HOST, LISTING, 'reviews')
    await expect(connectionAccessToken(deps(), record as never)).rejects.toThrow('Token has been expired or revoked.')
    expect((await getConnection(db as never, HOST, LISTING, 'reviews'))?.status).toBe('reconnect_required')
    const picker = await resourcesRoute(get('plugin-connections/resources', { ...SITE, resource: 'accounts' }, 'tok-admin'))
    expect(picker.status).toBe(409)
    expect(((await picker.json()) as { reason: string }).reason).toBe('reconnect')
  })
})

describe('status and disconnect (AGL-4193)', () => {
  it('lists each declared connection with where it stands, and no secret', async () => {
    await connect()
    const response = await statusRoute(get('plugin-connections/status', { hostId: HOST }, 'tok-admin'))
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      configured: true,
      planAllows: true,
      connections: [
        {
          listingId: LISTING,
          connectionId: 'reviews',
          provider: 'google',
          label: 'Google Business Profile',
          resources: [
            { id: 'accounts', label: 'Account' },
            { id: 'locations', label: 'Location' },
          ],
          credentialsSet: true,
          planAllows: true,
          connection: { status: 'connected', ready: false },
        },
      ],
    })
    expect(JSON.stringify(body)).not.toMatch(/sealed|access-1|refresh-1|client-abc|secret-xyz|uid-admin/)
  })

  it('tells a Free workspace its plan does not include connections, without refusing the read', async () => {
    const response = await statusRoute(get('plugin-connections/status', { hostId: FREE_HOST }, 'tok-admin'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ planAllows: false, connections: [{ planAllows: false, connection: null }] })
  })

  it('asks the key for status too', async () => {
    expect((await statusRoute(get('plugin-connections/status', { hostId: HOST }, 'tok-editor'))).status).toBe(403)
  })

  it('revokes at the declared revocation URL and forgets the grant, on any plan', async () => {
    await connect()
    const response = await disconnectRoute(post('plugin-connections/disconnect', SITE, 'tok-admin'))
    expect(await response.json()).toEqual({ connection: null, revoked: true })
    const revoke = calls.find((call) => call.url === 'https://oauth2.example.com/revoke')
    expect(new URLSearchParams(String(revoke?.init.body)).get('token')).toBe('refresh-1')
    expect(db.docs.has(`hosts/${HOST}/pluginConnections/${LISTING}__reviews`)).toBe(false)
    expect((await disconnectRoute(post('plugin-connections/disconnect', { ...SITE, hostId: FREE_HOST }, 'tok-admin'))).status).toBe(200)
    expect((await disconnectRoute(post('plugin-connections/disconnect', SITE, 'tok-editor'))).status).toBe(403)
  })
})

describe('the publisher’s OAuth app credentials (AGL-4193)', () => {
  const route = 'plugin-connections/credentials'

  it('says only whether each declared connection’s app is set', async () => {
    const response = await credentialsRoute(get(route, { listingId: LISTING }, 'tok-publisher'))
    expect(await response.json()).toEqual({
      configured: true,
      credentials: [{ connectionId: 'reviews', label: 'Google Business Profile', set: true, updatedAtMs: NOW }],
    })
  })

  it('replaces the pair sealed, and never answers either value', async () => {
    const response = await credentialsRoute(
      post(route, { listingId: LISTING, connectionId: 'reviews', clientId: 'client-new', clientSecret: 'secret-new' }, 'tok-publisher'),
    )
    expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).not.toMatch(/client-new|secret-new/)
    expect(JSON.stringify(db.docs.get(`pluginConnectionCredentials/${LISTING}__reviews`))).not.toMatch(/client-new|secret-new/)
    expect(db.docs.get(`pluginConnectionCredentials/${LISTING}__reviews`)?.['orgId']).toBe(PUBLISHER_ORG)
    expect(await openCredentials(db as never, keyring, LISTING, 'reviews')).toEqual({ clientId: 'client-new', clientSecret: 'secret-new' })
  })

  it('clears the pair', async () => {
    await credentialsRoute(post(route, { listingId: LISTING, connectionId: 'reviews', clear: true }, 'tok-publisher'))
    expect(db.docs.has(`pluginConnectionCredentials/${LISTING}__reviews`)).toBe(false)
  })

  it('refuses a publisher member without the key by its name, and anyone outside the workspace', async () => {
    const refused = await credentialsRoute(get(route, { listingId: LISTING }, 'tok-publisher-editor'))
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: string }).error).toBe(
      'Your role does not include "Set a listing’s connection credentials" — ask an organization admin',
    )
    const stranger = await credentialsRoute(get(route, { listingId: LISTING }, 'tok-stranger'))
    expect(stranger.status).toBe(403)
    expect(((await stranger.json()) as { error: string }).error).toBe('Not your listing')
    // Staff included: the OAuth app is the publisher's.
    expect((await credentialsRoute(get(route, { listingId: LISTING }, 'tok-staff'))).status).toBe(403)
  })

  it('refuses a connection the latest version does not declare, and an empty pair', async () => {
    const unknown = await credentialsRoute(
      post(route, { listingId: LISTING, connectionId: 'other', clientId: 'a', clientSecret: 'b' }, 'tok-publisher'),
    )
    expect(unknown.status).toBe(404)
    const empty = await credentialsRoute(post(route, { listingId: LISTING, connectionId: 'reviews', clientId: '', clientSecret: '' }, 'tok-publisher'))
    expect(empty.status).toBe(400)
  })
})

describe('the state (AGL-4193)', () => {
  it('binds member, site, listing and connection, and expires in fifteen minutes', () => {
    const { state, claims } = mintConnectState({
      hostId: HOST,
      orgId: 'org-acme',
      uid: 'uid-admin',
      listingId: LISTING,
      connectionId: 'reviews',
      returnTo: RETURN_TO,
      nowMs: NOW,
    })
    expect(readConnectState(state, NOW)).toEqual({ ok: true, claims })
    expect(readConnectState(state, NOW + 15 * 60 * 1000)).toMatchObject({ ok: false, refusal: 'state-expired' })
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(readConnectState(state, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
  })
})

describe('the erasers (AGL-4193)', () => {
  it('revokes a deleted site’s grants at the provider and removes its connections, listing nothing on the card', async () => {
    await connect()
    await startConnect()
    expect(await pluginConnectionsSiteEraser.preview()).toMatchObject({ going: [], staying: 0 })
    calls = []
    expect(await pluginConnectionsSiteEraser.erase({ orgId: 'org-acme', hostId: HOST })).toBe(1)
    expect(calls.map((call) => call.url)).toEqual(['https://oauth2.example.com/revoke'])
    expect(docsUnder(`hosts/${HOST}/pluginConnections/`)).toHaveLength(0)
  })

  it('counts a workspace’s listing credentials on a dry run, and deletes them on the real one', async () => {
    expect(await erasePluginConnectionCredentials({ orgId: PUBLISHER_ORG, dryRun: true })).toEqual({ connectionCredentials: 1 })
    expect(db.docs.has(`pluginConnectionCredentials/${LISTING}__reviews`)).toBe(true)
    expect(await erasePluginConnectionCredentials({ orgId: 'org-acme', dryRun: false })).toEqual({ connectionCredentials: 0 })
    expect(await erasePluginConnectionCredentials({ orgId: PUBLISHER_ORG, dryRun: false })).toEqual({ connectionCredentials: 1 })
    expect(db.docs.has(`pluginConnectionCredentials/${LISTING}__reviews`)).toBe(false)
  })
})
