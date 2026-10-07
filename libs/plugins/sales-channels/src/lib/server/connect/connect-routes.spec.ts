/**
 * @jest-environment node
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
import { createMemoryFirestore, type MemoryFirestore } from '../../testing/memory-firestore'
import { makeOffer, makeStore } from '../../testing/catalog-fixtures'
import { createProviderFake, GOOGLE_REFRESH_TOKEN } from '../../testing/provider-fake'
import { readProviderConfig, SALES_CHANNELS_ENV } from './config'
import {
  connectCallbackRoute,
  connectCallbackSubject,
  connectSelectRoute,
  connectStartRoute,
  disconnectRoute,
  syncRoute,
} from './connect-routes'
import { connectState } from './connect-state'
import { getConnection, openConnectionToken } from './connection-store'
import { connectRuntime } from './http'
import { mintConnectState, recordConnectState } from './oauth-state'

/**
 * The channel connections' routes (AGL-3637, phase 2): absent until the
 * deployment configures a provider; a connect bound by a signed, single-use
 * state to one member of one site and one console page; the token sealed;
 * a sync that runs once at a time; and the roles each route needs.
 */

const HOST = 'host-candles'
const OTHER_HOST = 'host-other'
const CONSOLE = 'https://app.example.com'
const RETURN_TO = '/candles/sites/host-candles/commerce/settings?tab=channels'
const NOW = Date.UTC(2026, 9, 7, 15)

let db: MemoryFirestore
let fake: ReturnType<typeof createProviderFake>
let clock = NOW

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email_verified: true },
}

const firebaseAdminFake = {
  app: () => ({
    firestore: () => db,
    auth: () => ({
      verifyIdToken: async (token: string) => {
        const decoded = TOKENS[token]
        if (!decoded) throw new Error('auth/argument-error')
        return decoded
      },
      getUser: async (uid: string) => ({ uid, customClaims: {} }),
    }),
  }),
}

const activity: Array<{ hostId: string; action: string }> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' || hostId === 'host-other'
      ? { orgId: 'org-candles', org: { plan: 'pro' } }
      : null,
  logHostActivity: async (hostId: string, _actor: unknown, action: string) => {
    activity.push({ hostId, action })
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  get firebaseAdmin() {
    return firebaseAdminFake
  },
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({ checkEntitlement: () => true }))

const offers = [makeOffer({ id: 'prod-1', gtin: '036000291452' }), makeOffer({ id: 'prod-2', groupId: 'prod-2', productId: 'prod-2' })]

jest.mock('../catalog-source', () => ({
  readStore: async () => makeStore({ hostId: 'host-candles' }),
  readOffers: async () => ({ offers, partial: false }),
}))

const ENV_KEYS = [...Object.values(SALES_CHANNELS_ENV), 'TOKEN_SIGNING_SECRET', 'NEXT_PUBLIC_CONSOLE_URL']
const savedEnv: Record<string, string | undefined> = {}
const savedRuntime = { ...connectRuntime }

function configure(providers: Array<'google' | 'meta'>) {
  for (const key of Object.values(SALES_CHANNELS_ENV)) delete process.env[key]
  process.env[SALES_CHANNELS_ENV.tokenKey] = randomBytes(32).toString('base64')
  if (providers.includes('google')) {
    process.env[SALES_CHANNELS_ENV.googleClientId] = 'google-client'
    process.env[SALES_CHANNELS_ENV.googleClientSecret] = 'google-secret'
  }
  if (providers.includes('meta')) {
    process.env[SALES_CHANNELS_ENV.metaAppId] = 'meta-app'
    process.env[SALES_CHANNELS_ENV.metaAppSecret] = 'meta-secret'
  }
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  Object.assign(connectRuntime, savedRuntime)
})

beforeEach(() => {
  db = createMemoryFirestore()
  db.docs.set(`hosts/${HOST}`, { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor', 'uid-viewer': 'viewer' } })
  db.docs.set(`hosts/${OTHER_HOST}`, { memberRoles: { 'uid-editor': 'admin' } })
  fake = createProviderFake()
  clock = NOW
  connectRuntime.fetch = fake.fetch
  connectRuntime.sleep = async () => undefined
  connectRuntime.now = () => clock
  activity.length = 0
  process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = CONSOLE
  configure(['google', 'meta'])
})

const post = (path: string, body: Record<string, unknown>, token = 'tok-admin') =>
  new Request(`${CONSOLE}/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const callback = (query: Record<string, string>) =>
  new Request(`${CONSOLE}/api/sales-channels/connect/callback?${new URLSearchParams(query).toString()}`)

async function start(provider: 'google' | 'meta', token = 'tok-admin', hostId = HOST) {
  const response = await connectStartRoute(
    post('sales-channels/connect/start', { hostId, provider, returnTo: `${CONSOLE}${RETURN_TO}` }, token),
  )
  const body = (await response.json()) as { authorizeUrl?: string; error?: string }
  return { response, body, state: body.authorizeUrl ? new URL(body.authorizeUrl).searchParams.get('state') ?? '' : '' }
}

async function connect(provider: 'google' | 'meta') {
  const { state } = await start(provider)
  return connectCallbackRoute(callback({ code: 'auth-code', state }))
}

describe('a provider the deployment has not configured does not exist', () => {
  it('lists no connection in the state answer when nothing is configured', async () => {
    configure([])
    expect(await connectState({ uid: 'uid-admin', hostId: HOST, orgId: 'org-candles', host: {}, staff: false })).toEqual({})
  })

  it('lists only the configured provider', async () => {
    configure(['meta'])
    const state = (await connectState({ uid: 'uid-admin', hostId: HOST, orgId: 'org-candles', host: {}, staff: false })) as {
      connect: { providers: Array<{ provider: string }> }
    }
    expect(state.connect.providers.map((entry) => entry.provider)).toEqual(['meta'])
  })

  it('treats an unusable token key as unconfigured', () => {
    process.env[SALES_CHANNELS_ENV.tokenKey] = 'not-a-key'
    expect(readProviderConfig('google')).toEqual({ configured: false, missing: [SALES_CHANNELS_ENV.tokenKey] })
  })

  it.each([
    ['start', () => connectStartRoute(post('sales-channels/connect/start', { hostId: HOST, provider: 'google', returnTo: RETURN_TO }))],
    ['select', () => connectSelectRoute(post('sales-channels/connect/select', { hostId: HOST, provider: 'google', targetId: '111' }))],
    ['sync', () => syncRoute(post('sales-channels/sync', { hostId: HOST, provider: 'google' }))],
    ['disconnect', () => disconnectRoute(post('sales-channels/connect/disconnect', { hostId: HOST, provider: 'google' }))],
  ])('answers 404 from %s for an unconfigured provider', async (_name, call) => {
    configure(['meta'])
    expect((await call()).status).toBe(404)
  })

  it('answers 404 from the callback for a provider unconfigured since the connect started', async () => {
    const { state } = await start('google')
    configure(['meta'])
    expect((await connectCallbackRoute(callback({ code: 'c', state }))).status).toBe(404)
  })

  it('answers 404 for a provider that is not one', async () => {
    const response = await connectStartRoute(post('sales-channels/connect/start', { hostId: HOST, provider: 'tiktok', returnTo: RETURN_TO }))
    expect(response.status).toBe(404)
  })
})

describe('connect start', () => {
  it('hands an admin Google’s consent address for the content scope, offline', async () => {
    const { response, body } = await start('google')
    expect(response.status).toBe(200)
    const url = new URL(body.authorizeUrl as string)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/content')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('client_id')).toBe('google-client')
    expect(url.searchParams.get('redirect_uri')).toBe(`${CONSOLE}/api/sales-channels/connect/callback`)
  })

  it('hands Meta’s login dialog for the catalog scopes on the configured version', async () => {
    process.env[SALES_CHANNELS_ENV.metaGraphVersion] = 'v27.0'
    const url = new URL((await start('meta')).body.authorizeUrl as string)
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v27.0/dialog/oauth')
    expect(url.searchParams.get('scope')).toBe('catalog_management,business_management')
  })

  it.each([['tok-editor'], ['tok-viewer']])('refuses %s: connecting is an admin’s', async (token) => {
    expect((await start('google', token)).response.status).toBe(403)
  })

  it('refuses a caller with no session', async () => {
    const request = new Request(`${CONSOLE}/api/sales-channels/connect/start`, {
      method: 'POST',
      body: JSON.stringify({ hostId: HOST, provider: 'google', returnTo: RETURN_TO }),
    })
    expect((await connectStartRoute(request)).status).toBe(401)
  })

  it.each([
    ['another host', 'https://evil.example.com/steal'],
    ['a protocol-relative address', '//evil.example.com/steal'],
    ['a script', 'javascript:alert(1)'],
    ['nothing', ''],
  ])('refuses to come back to %s', async (_name, returnTo) => {
    const response = await connectStartRoute(
      post('sales-channels/connect/start', { hostId: HOST, provider: 'google', returnTo }),
    )
    expect(response.status).toBe(400)
  })
})

describe('connect callback', () => {
  it('names the organization and member the release gate asks about, from the signed state alone', async () => {
    const { state } = await start('google')
    expect(connectCallbackSubject(callback({ state }))).toEqual({ orgId: 'org-candles', uid: 'uid-admin' })
    expect(connectCallbackSubject(callback({ state: `${state}x` }))).toBeNull()
  })

  it('exchanges the code, seals the refresh token, lists the accounts and returns to the console page', async () => {
    const response = await connect('google')
    expect(response.status).toBe(303)
    const location = response.headers.get('location') as string
    expect(location.startsWith('/')).toBe(true)
    const back = new URL(location, CONSOLE)
    expect(back.pathname).toBe('/candles/sites/host-candles/commerce/settings')
    expect(back.searchParams.get('tab')).toBe('channels')
    expect(back.searchParams.get('salesChannelsConnect')).toBe('connected')
    expect(back.searchParams.get('salesChannelsProvider')).toBe('google')

    const stored = db.docs.get(`hosts/${HOST}/salesChannels/connection-google`) as Record<string, unknown>
    expect(JSON.stringify(stored)).not.toContain('PLAINTEXT')
    expect(stored['targets']).toEqual([
      { id: '111', name: 'Candle Co US' },
      { id: '222', name: 'Candle Co CA' },
    ])
    expect(stored['targetId']).toBe('111')
    const connection = await getConnection(HOST, 'google')
    const config = readProviderConfig('google')
    expect(config.configured && openConnectionToken(connection!, config.config.keyring, HOST)).toBe(GOOGLE_REFRESH_TOKEN)
    const exchange = fake.calls.find((call) => call.url.host === 'oauth2.googleapis.com')!
    expect(exchange.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: `${CONSOLE}/api/sales-channels/connect/callback`,
    })
    expect(activity).toEqual([{ hostId: HOST, action: 'Connected Google for product sync' }])
  })

  it('stores a sealed long-lived Meta token with its expiry and the catalogs it reaches', async () => {
    const response = await connect('meta')
    expect(new URL(response.headers.get('location') as string, CONSOLE).searchParams.get('salesChannelsConnect')).toBe('connected')
    const stored = db.docs.get(`hosts/${HOST}/salesChannels/connection-meta`) as Record<string, unknown>
    expect(JSON.stringify(stored)).not.toContain('PLAINTEXT')
    expect(stored['tokenExpiresAtMs']).toBe(NOW + 60 * 24 * 60 * 60 * 1000)
    expect(stored['targets']).toEqual([{ id: '88', name: 'Main catalog (Candle Biz)' }])
    const exchange = fake.calls.find((call) => call.url.searchParams.get('grant_type') === 'fb_exchange_token')
    expect(exchange?.url.searchParams.get('fb_exchange_token')).toBe('meta-short')
    const listed = fake.calls.find((call) => call.url.pathname.endsWith('/me/businesses'))!
    expect(listed.url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a tampered state outright, writing nothing', async () => {
    const { state } = await start('google')
    const [version, payload, signature] = state.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const forged = Buffer.from(JSON.stringify({ ...claims, h: OTHER_HOST }), 'utf8').toString('base64url')
    const response = await connectCallbackRoute(callback({ code: 'c', state: `${version}.${forged}.${signature}` }))
    expect(response.status).toBe(400)
    expect(db.docs.has(`hosts/${OTHER_HOST}/salesChannels/connection-google`)).toBe(false)
    expect(fake.calls).toHaveLength(0)
  })

  it('sends an expired state back to the console without exchanging the code', async () => {
    const { state } = await start('google')
    clock = NOW + 16 * 60 * 1000
    const response = await connectCallbackRoute(callback({ code: 'c', state }))
    expect(new URL(response.headers.get('location') as string, CONSOLE).searchParams.get('salesChannelsConnect')).toBe('expired')
    expect(fake.calls).toHaveLength(0)
  })

  it('takes a state once', async () => {
    const { state } = await start('google')
    await connectCallbackRoute(callback({ code: 'c', state }))
    const again = await connectCallbackRoute(callback({ code: 'c', state }))
    expect(new URL(again.headers.get('location') as string, CONSOLE).searchParams.get('salesChannelsConnect')).toBe('expired')
  })

  it('refuses a signed state for a site whose connect was never started there', async () => {
    // Started on one site; a state for another site, signed but with no pending record of its own.
    await start('google')
    const { state } = mintConnectState({
      hostId: OTHER_HOST,
      orgId: 'org-candles',
      uid: 'uid-admin',
      provider: 'google',
      returnTo: RETURN_TO,
      nowMs: NOW,
    })
    const response = await connectCallbackRoute(callback({ code: 'c', state }))
    expect(new URL(response.headers.get('location') as string, CONSOLE).searchParams.get('salesChannelsConnect')).toBe('expired')
    expect(db.docs.has(`hosts/${OTHER_HOST}/salesChannels/connection-google`)).toBe(false)
  })

  it('refuses a signed state whose page to return to is not on the console', async () => {
    const { state, claims } = mintConnectState({
      hostId: HOST,
      orgId: 'org-candles',
      uid: 'uid-admin',
      provider: 'google',
      returnTo: 'https://evil.example.com/x',
      nowMs: NOW,
    })
    await recordConnectState({ claims, redirectUri: `${CONSOLE}/api/sales-channels/connect/callback`, nowMs: NOW })
    const response = await connectCallbackRoute(callback({ code: 'c', state }))
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not finish a connect for a member who is no longer an admin', async () => {
    const { state } = await start('google')
    db.docs.set(`hosts/${HOST}`, { memberRoles: { 'uid-admin': 'editor' } })
    const response = await connectCallbackRoute(callback({ code: 'c', state }))
    expect(new URL(response.headers.get('location') as string, CONSOLE).searchParams.get('salesChannelsConnect')).toBe('not-permitted')
    expect(db.docs.has(`hosts/${HOST}/salesChannels/connection-google`)).toBe(false)
  })

  it('reports a denied consent without exchanging anything', async () => {
    const { state } = await start('meta')
    const response = await connectCallbackRoute(callback({ error: 'access_denied', state }))
    expect(new URL(response.headers.get('location') as string, CONSOLE).searchParams.get('salesChannelsConnect')).toBe('denied')
    expect(fake.calls).toHaveLength(0)
  })
})

describe('select, sync and disconnect', () => {
  it('chooses another account the grant reaches, and refuses one it does not', async () => {
    await connect('google')
    const refused = await connectSelectRoute(post('sales-channels/connect/select', { hostId: HOST, provider: 'google', targetId: '999' }))
    expect(refused.status).toBe(400)
    const chosen = await connectSelectRoute(post('sales-channels/connect/select', { hostId: HOST, provider: 'google', targetId: '222' }))
    expect(chosen.status).toBe(200)
    expect(((await chosen.json()) as { connection: { targetId: string } }).connection.targetId).toBe('222')
    const editor = await connectSelectRoute(
      post('sales-channels/connect/select', { hostId: HOST, provider: 'google', targetId: '111' }, 'tok-editor'),
    )
    expect(editor.status).toBe(403)
  })

  it('lets an editor sync and a viewer not', async () => {
    await connect('google')
    expect((await syncRoute(post('sales-channels/sync', { hostId: HOST, provider: 'google' }, 'tok-viewer'))).status).toBe(403)
    const response = await syncRoute(post('sales-channels/sync', { hostId: HOST, provider: 'google' }, 'tok-editor'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { sent: number; failed: number }; connection: { lastSyncResult: unknown } }
    expect(body.result).toMatchObject({ sent: 2, failed: 0 })
    expect(body.connection.lastSyncResult).toMatchObject({ sent: 2, failed: 0 })
    expect(JSON.stringify(body)).not.toContain('PLAINTEXT')
  })

  it('refuses a second sync while one holds the lease', async () => {
    await connect('meta')
    db.docs.set(`hosts/${HOST}/salesChannels/sync-meta`, { leaseUntilMs: NOW + 60_000 })
    const response = await syncRoute(post('sales-channels/sync', { hostId: HOST, provider: 'meta' }, 'tok-editor'))
    expect(response.status).toBe(409)
    expect(fake.calls.some((call) => call.url.pathname.endsWith('/items_batch'))).toBe(false)
  })

  it('refuses to sync a provider that is not connected', async () => {
    expect((await syncRoute(post('sales-channels/sync', { hostId: HOST, provider: 'google' }, 'tok-editor'))).status).toBe(409)
  })

  it('refuses to sync an expired Meta grant, asking for a reconnect', async () => {
    await connect('meta')
    clock = NOW + 61 * 24 * 60 * 60 * 1000
    const response = await syncRoute(post('sales-channels/sync', { hostId: HOST, provider: 'meta' }, 'tok-editor'))
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toMatch(/Reconnect Meta/)
  })

  it('disconnects for an admin only, revoking the grant and forgetting it', async () => {
    await connect('google')
    expect(
      (await disconnectRoute(post('sales-channels/connect/disconnect', { hostId: HOST, provider: 'google' }, 'tok-editor'))).status,
    ).toBe(403)
    const response = await disconnectRoute(post('sales-channels/connect/disconnect', { hostId: HOST, provider: 'google' }))
    expect(response.status).toBe(200)
    expect(db.docs.has(`hosts/${HOST}/salesChannels/connection-google`)).toBe(false)
    const revoke = fake.calls.find((call) => call.url.pathname === '/revoke')
    expect(revoke?.body).toEqual({ token: GOOGLE_REFRESH_TOKEN })
    expect(activity.map((entry) => entry.action)).toContain('Disconnected Google product sync')
  })

  it('forgets a Meta grant even when the revoke fails', async () => {
    await connect('meta')
    connectRuntime.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    const response = await disconnectRoute(post('sales-channels/connect/disconnect', { hostId: HOST, provider: 'meta' }))
    expect(response.status).toBe(200)
    expect(db.docs.has(`hosts/${HOST}/salesChannels/connection-meta`)).toBe(false)
  })
})
