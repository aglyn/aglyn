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
import { createSecretBoxKey, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { ProviderError } from '../providers/http'
import type { MarketingProvider } from '../providers/provider'
import { createMemoryStore, mockFetch } from '../testing/memory-store'
import { openCredential, readMarketingPlatformsConfig, type MarketingPlatformsConfig } from './config'
import { createCredentialOpener } from './credentials'
import { readOAuthState, sha256 } from './oauth'
import { createMarketingRoutes, fail, type MarketingRole, type MarketingRouteDeps } from './routes'
import { emptyConnection } from './store'

const HOST = 'host-1'
const NOW = Date.UTC(2026, 9, 7, 12)
const key = createSecretBoxKey(randomBytes(32))
const keyring: SecretBoxKeyring = { current: key, keys: [key] }

function setup(options: { config?: Partial<MarketingPlatformsConfig>; role?: MarketingRole | null; verify?: MarketingProvider['verify'] } = {}) {
  const memory = createMemoryStore()
  const activity: string[] = []
  const syncs: string[] = []
  const exchange = mockFetch((url) => {
    if (url.includes('oauth2/token')) return { body: { access_token: 'mc-token' } }
    if (url.includes('oauth2/metadata')) return { body: { api_endpoint: 'https://us21.api.mailchimp.com', accountname: 'Acme' } }
    if (url.includes('klaviyo.com/oauth/token')) return { body: { access_token: 'kl-token', refresh_token: 'kl-refresh', expires_in: 3600 } }
    return { status: 404 }
  })
  const config: MarketingPlatformsConfig = { keyring, oauth: {}, ...options.config }
  const deps: MarketingRouteDeps = {
    now: () => NOW,
    config: () => config,
    store: memory.store,
    provider: (id) => ({
      id,
      verify:
        options.verify ??
        (async () => ({ accountName: 'Acme', lists: [{ id: 'L1', name: 'Main' }], apiBase: id === 'mailchimp' ? 'https://us21.api.mailchimp.com/3.0' : null })),
      pushContacts: async () => ({ pushed: 0, skipped: [] }),
      pullConsent: async () => null,
    }),
    http: exchange.http,
    gate: async (request, role) => {
      const granted = options.role === undefined ? 'admin' : options.role
      if (!granted) return fail(401, 'Unauthenticated')
      if (granted === 'editor' && role === 'admin') return fail(403, 'Not permitted')
      const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org-1', hostId: HOST, uid: 'u1', body }
    },
    redirectUri: () => 'https://app.test/api/marketing-platforms/oauth/callback',
    syncNow: async (id) => void syncs.push(id),
    logActivity: async (input) => void activity.push(`${input.action}:${input.provider}`),
  }
  return { routes: createMarketingRoutes(deps), memory, activity, syncs, exchange }
}

const post = (body: unknown, method = 'POST') =>
  new Request('https://app.test/api/x', { method, body: JSON.stringify({ hostId: HOST, ...(body as object) }) })
const get = (query = '') => new Request(`https://app.test/api/x?hostId=${HOST}${query}`)

describe('listing', () => {
  it('offers the key-connected providers once the token key exists, and Attentive only with its app', async () => {
    const { routes } = setup()
    const answer = await (await routes.list(get())).json()
    expect(answer.available.map((entry: any) => entry.id)).toEqual(['mailchimp', 'klaviyo', 'omnisend'])
    const withApp = setup({ config: { oauth: { attentive: { clientId: 'a', clientSecret: 'b' } } } })
    const offered = (await (await withApp.routes.list(get())).json()).available
    expect(offered.find((entry: any) => entry.id === 'attentive')).toEqual({ id: 'attentive', apiKey: false, oauth: true })
  })

  it('offers nothing without the token key, so the card draws nothing', async () => {
    const { routes } = setup({ config: { keyring: null } })
    expect((await (await routes.list(get())).json()).available).toEqual([])
  })

  it('answers the gate’s refusal as is', async () => {
    const { routes } = setup({ role: null })
    expect((await routes.list(get())).status).toBe(401)
  })
})

describe('connecting with a key', () => {
  it('verifies the key, seals it, picks the only list, and never answers the key back', async () => {
    const { routes, memory, activity } = setup()
    const response = await routes.connect(post({ provider: 'klaviyo', apiKey: 'pk_live_123' }))
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain('pk_live_123')
    const view = JSON.parse(body).connection
    expect(view).toMatchObject({ provider: 'klaviyo', status: 'active', listId: 'L1', accountName: 'Acme', authKind: 'api-key' })
    const stored = memory.connections.get(`${HOST}_klaviyo`)!
    expect(stored.sealedToken).not.toContain('pk_live_123')
    expect(openCredential(stored.sealedToken!, `${HOST}_klaviyo`, 'token', keyring).value).toBe('pk_live_123')
    expect(activity).toEqual(['connected:klaviyo'])
  })

  it('says what the provider said when it refuses the key, and stores nothing', async () => {
    const { routes, memory } = setup({
      verify: async () => {
        throw new ProviderError('auth', 'nope')
      },
    })
    const response = await routes.connect(post({ provider: 'mailchimp', apiKey: 'bad-us1' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Mailchimp did not accept that key. Check it and try again.')
    expect(memory.connections.size).toBe(0)
  })

  it('refuses Attentive by key, a blank key, and an editor', async () => {
    const { routes } = setup()
    expect((await routes.connect(post({ provider: 'attentive', apiKey: 'x' }))).status).toBe(404)
    expect((await routes.connect(post({ provider: 'omnisend', apiKey: ' ' }))).status).toBe(400)
    const editor = setup({ role: 'editor' })
    expect((await editor.routes.connect(post({ provider: 'omnisend', apiKey: 'k' }))).status).toBe(403)
  })
})

describe('changing a connection', () => {
  const connected = async () => {
    const run = setup()
    await run.routes.connect(post({ provider: 'mailchimp', apiKey: 'k-us21' }))
    const id = `${HOST}_mailchimp`
    run.memory.connections.get(id)!.cursors = { contacts: 'c', suppressions: 's', provider: 'p' }
    run.memory.connections.get(id)!.backfillDone = true
    run.memory.connections.get(id)!.lists = [
      { id: 'L1', name: 'Main' },
      { id: 'L2', name: 'Other' },
    ]
    return { ...run, id }
  }

  it('copies everyone again into a different list', async () => {
    const { routes, memory, id } = await connected()
    const response = await routes.connection(post({ provider: 'mailchimp', listId: 'L2' }, 'PATCH'))
    expect(response.status).toBe(200)
    expect(memory.connections.get(id)).toMatchObject({
      listId: 'L2',
      backfillDone: false,
      cursors: { contacts: null, suppressions: null, provider: null },
    })
  })

  it('refuses a list the account does not have', async () => {
    const { routes } = await connected()
    expect((await routes.connection(post({ provider: 'mailchimp', listId: 'L9' }, 'PATCH'))).status).toBe(400)
  })

  it('pauses and resumes', async () => {
    const { routes, memory, id } = await connected()
    await routes.connection(post({ provider: 'mailchimp', paused: true }, 'PATCH'))
    expect(memory.connections.get(id)!.status).toBe('paused')
    await routes.connection(post({ provider: 'mailchimp', paused: false }, 'PATCH'))
    expect(memory.connections.get(id)).toMatchObject({ status: 'active', nextRunAtMs: NOW })
  })

  it('disconnects: the connection, its log and its owed events go', async () => {
    const { routes, memory, id, activity } = await connected()
    await memory.store.enqueueEvent(id, { orgId: 'org-1', hostId: HOST }, { id: 'e' } as never, NOW)
    expect((await routes.connection(post({ provider: 'mailchimp' }, 'DELETE'))).status).toBe(200)
    expect(memory.connections.has(id)).toBe(false)
    expect(memory.events.size).toBe(0)
    expect(activity).toEqual(['connected:mailchimp', 'disconnected:mailchimp'])
  })

  it('runs Sync now, resuming one stopped by failures but not one waiting to be connected again', async () => {
    const { routes, memory, id, syncs } = await connected()
    memory.connections.get(id)!.status = 'error'
    memory.connections.get(id)!.consecutiveFailures = 12
    expect((await routes.syncNow(post({ provider: 'mailchimp' }))).status).toBe(200)
    expect(syncs).toEqual([id])
    expect(memory.connections.get(id)).toMatchObject({ status: 'active', consecutiveFailures: 0 })
    memory.connections.get(id)!.status = 'reconnect'
    expect((await routes.syncNow(post({ provider: 'mailchimp' }))).status).toBe(409)
  })

  it('pages the log behind a cursor', async () => {
    const { routes, memory, id } = await connected()
    for (let n = 0; n < 60; n += 1) await memory.store.appendLog(id, { atMs: NOW + n, kind: 'run', message: `run ${n}` })
    const first = await (await routes.log(get('&provider=mailchimp'))).json()
    expect(first.entries).toHaveLength(50)
    expect(first.entries[0].message).toBe('run 59')
    const second = await (await routes.log(get(`&provider=mailchimp&before=${first.nextBefore}`))).json()
    expect(second.entries.map((entry: any) => entry.message)).toContain('Connected')
    expect(second.nextBefore).toBeNull()
  })
})

describe('OAuth connect', () => {
  const withApps = () =>
    setup({
      config: {
        oauth: {
          mailchimp: { clientId: 'mc-id', clientSecret: 'mc-secret' },
          klaviyo: { clientId: 'kl-id', clientSecret: 'kl-secret' },
        },
      },
    })

  it('is not offered for a provider without its app', async () => {
    const { routes } = setup()
    expect((await routes.oauthStart(post({ provider: 'mailchimp' }))).status).toBe(404)
  })

  it('starts with a single-use state, finishes with a sealed grant, and sends the member back', async () => {
    const { routes, memory, exchange } = withApps()
    const start = await (await routes.oauthStart(post({ provider: 'mailchimp', returnTo: '/acme/hosts/h/setup' }))).json()
    const url = new URL(start.url)
    expect(url.origin + url.pathname).toBe('https://login.mailchimp.com/oauth2/authorize')
    const state = readOAuthState(url.searchParams.get('state'))!
    const id = `${HOST}_mailchimp`
    expect(memory.connections.get(id)!.pendingOAuth!.nonceHash).toBe(sha256(state.nonce))

    const callback = await routes.oauthCallback(
      new Request(`https://app.test/api/marketing-platforms/oauth/callback?code=abc&state=${url.searchParams.get('state')}`),
    )
    expect(callback.status).toBe(303)
    expect(callback.headers.get('location')).toBe('https://app.test/acme/hosts/h/setup?marketingPlatform=connected')
    const stored = memory.connections.get(id)!
    expect(stored).toMatchObject({ status: 'active', authKind: 'oauth', apiBase: 'https://us21.api.mailchimp.com/3.0', pendingOAuth: null })
    expect(openCredential(stored.sealedToken!, id, 'token', keyring).value).toBe('mc-token')
    expect(exchange.calls[0].body).toContain('client_secret=mc-secret')

    // Good once.
    const replay = await routes.oauthCallback(
      new Request(`https://app.test/api/marketing-platforms/oauth/callback?code=abc&state=${url.searchParams.get('state')}`),
    )
    expect(replay.status).toBe(400)
  })

  it('sends Klaviyo a PKCE challenge and its verifier back at the exchange', async () => {
    const { routes, exchange, memory } = withApps()
    const start = await (await routes.oauthStart(post({ provider: 'klaviyo', returnTo: '/x' }))).json()
    const url = new URL(start.url)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const verifier = memory.connections.get(`${HOST}_klaviyo`)!.pendingOAuth!.verifier
    await routes.oauthCallback(new Request(`https://app.test/cb?code=abc&state=${url.searchParams.get('state')}`))
    expect(exchange.calls[0].body).toContain(`code_verifier=${verifier}`)
    expect(exchange.calls[0].headers['Authorization']).toBe(`Basic ${Buffer.from('kl-id:kl-secret').toString('base64')}`)
    expect(memory.connections.get(`${HOST}_klaviyo`)).toMatchObject({ tokenExpiresAtMs: NOW + 3600_000, status: 'active' })
  })

  it('refuses a forged state, and an expired one sends the member back saying so', async () => {
    const { routes, memory } = withApps()
    expect((await routes.oauthCallback(new Request('https://app.test/cb?code=a&state=host-1_mailchimp.AAAAAAAAAAAAAAAAAAAA'))).status).toBe(400)
    const start = await (await routes.oauthStart(post({ provider: 'mailchimp', returnTo: '//evil.test' }))).json()
    const state = new URL(start.url).searchParams.get('state')
    memory.connections.get(`${HOST}_mailchimp`)!.pendingOAuth!.expMs = NOW - 1
    const late = await routes.oauthCallback(new Request(`https://app.test/cb?code=a&state=${state}`))
    // An off-site returnTo was reduced to the console's root.
    expect(late.headers.get('location')).toBe('https://app.test/?marketingPlatform=expired')
  })
})

describe('opening a stored credential', () => {
  it('refreshes an expiring OAuth token first and stores the new grant sealed', async () => {
    const memory = createMemoryStore()
    const id = `${HOST}_klaviyo`
    const { sealCredential } = await import('./config')
    memory.connections.set(id, {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'klaviyo', nowMs: NOW }),
      authKind: 'oauth',
      sealedToken: sealCredential('old', id, 'token', keyring),
      sealedRefreshToken: sealCredential('refresh-1', id, 'refresh', keyring),
      tokenExpiresAtMs: NOW + 60_000,
    })
    const { http, calls } = mockFetch(() => ({ body: { access_token: 'new', refresh_token: 'refresh-2', expires_in: 3600 } }))
    const open = createCredentialOpener({
      store: memory.store,
      config: () => ({ keyring, oauth: { klaviyo: { clientId: 'kl', clientSecret: 's' } } }),
      http,
      now: () => NOW,
    })
    const credential = await open(id, (await memory.store.get(id))!)
    expect(credential).toEqual({ kind: 'oauth', token: 'new', apiBase: null })
    expect(calls[0].body).toContain('grant_type=refresh_token')
    const stored = memory.connections.get(id)!
    expect(openCredential(stored.sealedRefreshToken!, id, 'refresh', keyring).value).toBe('refresh-2')
    expect(stored.tokenExpiresAtMs).toBe(NOW + 3600_000)
  })

  it('turns a revoked refresh into "connect again"', async () => {
    const memory = createMemoryStore()
    const id = `${HOST}_klaviyo`
    const { sealCredential } = await import('./config')
    const connection = {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'klaviyo' as const, nowMs: NOW }),
      authKind: 'oauth' as const,
      sealedToken: sealCredential('old', id, 'token', keyring),
      sealedRefreshToken: sealCredential('r', id, 'refresh', keyring),
      tokenExpiresAtMs: NOW - 1,
    }
    const { http } = mockFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }))
    const open = createCredentialOpener({
      store: memory.store,
      config: () => ({ keyring, oauth: { klaviyo: { clientId: 'kl', clientSecret: 's' } } }),
      http,
      now: () => NOW,
    })
    await expect(open(id, connection)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('refuses a credential sealed for another connection', async () => {
    const memory = createMemoryStore()
    const { sealCredential } = await import('./config')
    const connection = {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'omnisend' as const, nowMs: NOW }),
      sealedToken: sealCredential('k', 'other_omnisend', 'token', keyring),
    }
    const open = createCredentialOpener({ store: memory.store, config: () => ({ keyring, oauth: {} }), http: mockFetch(() => ({})).http, now: () => NOW })
    await expect(open(`${HOST}_omnisend`, connection)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('the deployment’s config', () => {
  it('reads the token key and each app only when both halves are set', () => {
    const raw = Buffer.from(key.material).toString('base64')
    const config = readMarketingPlatformsConfig({
      MARKETING_PLATFORMS_TOKEN_KEY: raw,
      MAILCHIMP_CLIENT_ID: 'id',
      MAILCHIMP_CLIENT_SECRET: 'secret',
      KLAVIYO_CLIENT_ID: 'only-half',
    })
    expect(config.keyring?.current.id).toBe(key.id)
    expect(Object.keys(config.oauth)).toEqual(['mailchimp'])
    expect(readMarketingPlatformsConfig({ MARKETING_PLATFORMS_TOKEN_KEY: 'not-a-key' }).keyring).toBeNull()
  })
})
