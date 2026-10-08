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
import {
  CONSTANT_CONTACT_CALL_SPACING_MS,
  CONSTANT_CONTACT_FIELDS,
  createConstantContactProvider,
  readConstantContactCursor,
} from '../providers/constant-contact'
import type { ProviderHttp } from '../providers/http'
import type { ProviderContact } from '../providers/provider'
import { createMarketingProvider } from '../providers/registry'
import { createMemoryStore, mockFetch } from '../testing/memory-store'
import { openCredential, providerAvailability, readMarketingPlatformsConfig, sealCredential, type MarketingPlatformsConfig } from './config'
import { createCredentialOpener } from './credentials'
import { readOAuthState } from './oauth'
import { createMarketingRoutes, type MarketingRouteDeps } from './routes'
import { emptyConnection, type StoredConnection } from './store'
import { runConnectionSync, type SyncRunDeps } from './sync-engine'

/**
 * Constant Contact (AGL-3696), every call against mocked HTTP: the adapter,
 * the OAuth connect and its rotating refresh, and a run whose grant is gone.
 */

const HOST = 'host-1'
const ID = `${HOST}_constant-contact`
const NOW = Date.UTC(2026, 9, 8, 12)
const API = 'https://api.cc.email/v3'
const TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token'
const key = createSecretBoxKey(randomBytes(32))
const keyring: SecretBoxKeyring = { current: key, keys: [key] }
const app = { clientId: 'cc-id', clientSecret: 'cc-secret' }
const bearer = { kind: 'oauth' as const, token: 'cc-access' }
const target = { listId: 'list-uuid-1', tag: 'Aglyn' }

const contact = (overrides: Partial<ProviderContact> = {}): ProviderContact => ({
  email: 'pat@example.com',
  status: 'subscribed',
  firstName: 'Pat',
  lastName: 'Lee',
  phone: '+15551234567',
  tags: ['vip', 'wholesale'],
  lifetimeValueCents: 12345,
  ordersCount: 3,
  ...overrides,
})

const path = (url: string) => url.slice(API.length)

/** A provider over a mocked fetch, whose sleeps are recorded rather than slept. */
function provider(handler: Parameters<typeof mockFetch>[0], now = NOW) {
  const mock = mockFetch(handler)
  const sleeps: number[] = []
  const http: ProviderHttp = { fetch: mock.fetch, sleep: async (ms) => void sleeps.push(ms) }
  return { cc: createConstantContactProvider(http, { now: () => now }), calls: mock.calls, sleeps }
}

const existingFields = {
  custom_fields: [
    { custom_field_id: 'f1', label: 'Aglyn tags', name: 'aglyn_tags', type: 'string' },
    { custom_field_id: 'f2', label: 'Aglyn source', name: 'aglyn_source', type: 'string' },
    { custom_field_id: 'f3', label: 'Aglyn lifetime value', name: 'aglyn_lifetime_value', type: 'number' },
    { custom_field_id: 'f4', label: 'Aglyn orders', name: 'aglyn_orders', type: 'number' },
  ],
}

describe('the Constant Contact adapter', () => {
  it('is in the registry under its own id', () => {
    expect(createMarketingProvider('constant-contact', mockFetch(() => ({})).http).id).toBe('constant-contact')
  })

  it('verifies a grant: the account’s name and every list, page by page, with the bearer token', async () => {
    const { cc, calls } = provider((url) => {
      if (url.endsWith('/account/summary')) return { body: { organization_name: 'Acme Coffee' } }
      if (url.includes('cursor=p2')) return { body: { lists: [{ list_id: 'L2', name: 'VIP' }] } }
      return { body: { lists: [{ list_id: 'L1', name: 'Newsletter' }], _links: { next: { href: '/v3/contact_lists?cursor=p2' } } } }
    })
    const verified = await cc.verify(bearer)
    expect(verified).toEqual({
      accountName: 'Acme Coffee',
      lists: [
        { id: 'L1', name: 'Newsletter' },
        { id: 'L2', name: 'VIP' },
      ],
      apiBase: null,
    })
    expect(calls.map((call) => path(call.url))).toEqual([
      '/account/summary',
      '/contact_lists?limit=1000&include_count=false',
      '/contact_lists?cursor=p2',
    ])
    expect(calls[0].headers['Authorization']).toBe('Bearer cc-access')
  })

  it('never follows a next link off its own API', async () => {
    const { cc, calls } = provider((url) =>
      url.endsWith('/account/summary')
        ? { body: {} }
        : { body: { lists: [], _links: { next: { href: 'https://evil.test/v3/contact_lists' } } } },
    )
    await cc.verify(bearer)
    expect(calls).toHaveLength(2)
  })

  it('imports the people the site may market to into the list, with their facts in its custom fields, created once', async () => {
    const { cc, calls, sleeps } = provider((url, init) => {
      if (url.includes('/contact_custom_fields') && init.method === 'GET') return { body: { custom_fields: [] } }
      if (url.endsWith('/contact_custom_fields')) {
        const body = JSON.parse(String(init.body))
        return { status: 201, body: { custom_field_id: body.label, label: body.label, name: body.label.toLowerCase().replace(/ /g, '_') } }
      }
      if (url.endsWith('/activities/contacts_json_import')) return { status: 201, body: { activity_id: 'a1', state: 'initialized' } }
      return { status: 404 }
    })
    const result = await cc.pushContacts(bearer, target, [contact(), contact({ email: 'sam@example.com', phone: '555', tags: [], lifetimeValueCents: null, ordersCount: null, firstName: null, lastName: null })])
    expect(result).toEqual({ pushed: 2, skipped: [] })
    const created = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/contact_custom_fields')).map((call) => call.body)
    expect(created).toEqual([
      { label: 'Aglyn tags', type: 'string' },
      { label: 'Aglyn source', type: 'string' },
      { label: 'Aglyn lifetime value', type: 'number', metadata: { decimal_places: 2 } },
      { label: 'Aglyn orders', type: 'number', metadata: { decimal_places: 0 } },
    ])
    const imported = calls.find((call) => call.url.endsWith('/activities/contacts_json_import'))!
    expect(imported.method).toBe('POST')
    expect(imported.body).toEqual({
      list_ids: ['list-uuid-1'],
      import_data: [
        {
          email: 'pat@example.com',
          first_name: 'Pat',
          last_name: 'Lee',
          phone: '+15551234567',
          'cf:aglyn_tags': 'vip, wholesale',
          'cf:aglyn_source': 'Aglyn',
          'cf:aglyn_lifetime_value': 123.45,
          'cf:aglyn_orders': 3,
        },
        // A phone that is not E.164 and empty facts are left out.
        { email: 'sam@example.com', 'cf:aglyn_source': 'Aglyn' },
      ],
    })
    // Spaced under the four-a-second limit.
    expect(sleeps.every((ms) => ms === CONSTANT_CONTACT_CALL_SPACING_MS)).toBe(true)
    expect(sleeps).toHaveLength(calls.length - 1)

    // The fields are read once per run, not once per page.
    await cc.pushContacts(bearer, target, [contact()])
    expect(calls.filter((call) => call.url.includes('/contact_custom_fields'))).toHaveLength(5)
  })

  it('reuses the fields an account already has, by label', async () => {
    const { cc, calls } = provider((url) =>
      url.includes('/contact_custom_fields') ? { body: existingFields } : { status: 201, body: { activity_id: 'a1' } },
    )
    await cc.pushContacts(bearer, target, [contact()])
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/contact_custom_fields'))).toHaveLength(0)
  })

  it('falls back to a text field where the account refuses a number field', async () => {
    const { cc, calls } = provider((url, init) => {
      if (url.includes('/contact_custom_fields') && init.method === 'GET') return { body: { custom_fields: existingFields.custom_fields.slice(0, 2) } }
      if (url.endsWith('/contact_custom_fields')) {
        const body = JSON.parse(String(init.body))
        if (body.type === 'number') return { status: 400, body: [{ error_key: 'contacts.api.validation.error', error_message: 'type is invalid' }] }
        return { status: 201, body: { name: body.label.toLowerCase().replace(/ /g, '_') } }
      }
      return { status: 201, body: {} }
    })
    await cc.pushContacts(bearer, target, [contact()])
    const fallbacks = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/contact_custom_fields')).map((call) => call.body.type)
    expect(fallbacks).toEqual(['number', 'string', 'number', 'string'])
    expect(calls[calls.length - 1].body.import_data[0]['cf:aglyn_lifetime_value']).toBe(123.45)
  })

  it('unsubscribes a person the site may not market to, keeping their other fields; leaves one it does not hold alone', async () => {
    const held = {
      contact_id: 'c-1',
      email_address: { address: 'Gone@Example.com', permission_to_send: 'implicit' },
      first_name: 'Gone',
      last_name: 'Person',
      company_name: 'Acme',
      job_title: null,
      create_source: 'Account',
    }
    const { cc, calls } = provider((url, init) => {
      if (url.includes('email=gone%40example.com')) return { body: { contacts: [held] } }
      if (url.includes('email=already%40example.com'))
        return { body: { contacts: [{ contact_id: 'c-2', email_address: { address: 'already@example.com', permission_to_send: 'unsubscribed' } }] } }
      if (url.includes('email=')) return { body: { contacts: [] } }
      if (init.method === 'PUT') return { body: {} }
      return { status: 404 }
    })
    const result = await cc.pushContacts(bearer, target, [
      contact({ email: 'gone@example.com', status: 'unsubscribed' }),
      contact({ email: 'already@example.com', status: 'unsubscribed' }),
      contact({ email: 'never@example.com', status: 'unsubscribed' }),
    ])
    expect(result).toEqual({ pushed: 1, skipped: [] })
    const puts = calls.filter((call) => call.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(path(puts[0].url)).toBe('/contacts/c-1')
    expect(puts[0].body).toEqual({
      email_address: { address: 'Gone@Example.com', permission_to_send: 'unsubscribed' },
      update_source: 'Account',
      first_name: 'Gone',
      last_name: 'Person',
      company_name: 'Acme',
    })
    // Nobody unsubscribed is imported: an import would add them.
    expect(calls.some((call) => call.url.includes('contacts_json_import'))).toBe(false)
    expect(calls.find((call) => call.url.includes('email='))!.url).toContain('status=all')
  })

  it('skips a person Constant Contact will not take, and goes on', async () => {
    const { cc } = provider((url, init) => {
      if (url.includes('email=')) return { body: { contacts: [{ contact_id: 'c-1', email_address: { address: 'x@example.com', permission_to_send: 'explicit' } }] } }
      if (init.method === 'PUT') return { status: 400, body: [{ error_key: 'x', error_message: 'email_address is not valid' }] }
      return { status: 404 }
    })
    // The shared door reads the first error's message from these shapes.
    const result = await cc.pushContacts(bearer, target, [contact({ email: 'x@example.com', status: 'unsubscribed' })])
    expect(result).toEqual({ pushed: 0, skipped: [{ email: 'x@example.com', reason: 'email_address is not valid' }] })
  })

  it('refuses to push without the list', async () => {
    const { cc } = provider(() => ({}))
    await expect(cc.pushContacts(bearer, { listId: null, tag: '' }, [contact()])).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('reads every opt-out on the first walk, and no returns, then moves the cursor to the window’s end', async () => {
    const { cc, calls } = provider(() => ({
      body: {
        contacts: [
          { email_address: { address: 'Left@Example.com', permission_to_send: 'unsubscribed' } },
          { email_address: { address: 'back@example.com', permission_to_send: 'explicit' } },
        ],
      },
    }))
    const page = await cc.pullConsent(bearer, target, null)
    expect(page).toEqual({ changes: [{ email: 'left@example.com', status: 'unsubscribed' }], cursor: new Date(NOW - 120_000).toISOString(), more: false })
    expect(calls).toHaveLength(1)
    const query = new URL(calls[0].url).searchParams
    expect(Object.fromEntries(query)).toEqual({
      status: 'all',
      optout_after: '2000-01-01T00:00:00.000Z',
      optout_before: new Date(NOW - 120_000).toISOString(),
      limit: '500',
      include_count: 'false',
    })
  })

  it('reads opt-outs then returns since the cursor, a return only when its opt-in is after it', async () => {
    const since = new Date(NOW - 3_600_000).toISOString()
    const { cc, calls } = provider((url) => {
      const query = new URL(url).searchParams
      if (query.get('status') === 'all') return { body: { contacts: [{ email_address: { address: 'left@example.com', permission_to_send: 'unsubscribed' } }] } }
      return {
        body: {
          contacts: [
            { email_address: { address: 'back@example.com', permission_to_send: 'explicit', opt_in_date: new Date(NOW - 60_000).toISOString() } },
            { email_address: { address: 'old@example.com', permission_to_send: 'explicit', opt_in_date: new Date(NOW - 7_200_000).toISOString() } },
            { email_address: { address: 'implicit@example.com', permission_to_send: 'implicit', opt_in_date: new Date(NOW - 60_000).toISOString() } },
          ],
        },
      }
    })
    const page = await cc.pullConsent(bearer, target, since)
    expect(page!.changes).toEqual([
      { email: 'left@example.com', status: 'unsubscribed' },
      { email: 'back@example.com', status: 'subscribed' },
    ])
    expect(page!.more).toBe(false)
    expect(new URL(calls[1].url).searchParams.get('updated_after')).toBe(since)
    expect(new URL(calls[1].url).searchParams.get('status')).toBe('active')
  })

  it('hands an unfinished walk on by its next link, and the cursor moves only when it is done', async () => {
    let served = 0
    const { cc } = provider(() => {
      served += 1
      return {
        body: {
          contacts: [{ email_address: { address: `p${served}@example.com`, permission_to_send: 'unsubscribed' } }],
          _links: { next: { href: `/v3/contacts?cursor=c${served}` } },
        },
      }
    })
    const first = await cc.pullConsent(bearer, target, null)
    expect(first!.more).toBe(true)
    expect(first!.changes).toHaveLength(5)
    const state = readConstantContactCursor(first!.cursor, NOW + 10 * 60_000)
    expect(state).toEqual({ since: null, until: new Date(NOW - 120_000).toISOString(), phase: 'optouts', next: '/v3/contacts?cursor=c5' })

    const resumed = provider(() => ({ body: { contacts: [] } }), NOW + 10 * 60_000)
    const last = await resumed.cc.pullConsent(bearer, target, first!.cursor)
    expect(resumed.calls[0].url).toBe(`${API}/contacts?cursor=c5`)
    // The window the walk started with, not the clock it finished on.
    expect(last).toEqual({ changes: [], cursor: new Date(NOW - 120_000).toISOString(), more: false })
  })

  it('reads a cursor it did not write as a fresh window, and never one that points off its API', () => {
    expect(readConstantContactCursor('{"since":null,"until":"x"}', NOW).phase).toBe('optouts')
    const forged = JSON.stringify({ since: null, until: new Date(NOW).toISOString(), phase: 'optouts', next: 'https://evil.test/' })
    expect(readConstantContactCursor(forged, NOW).next).toBeNull()
  })

  it('takes no events: its public API has none to send', () => {
    expect(createConstantContactProvider(mockFetch(() => ({})).http).sendEvent).toBeUndefined()
    expect(Object.keys(CONSTANT_CONTACT_FIELDS)).toEqual(['tags', 'source', 'lifetimeValue', 'ordersCount'])
  })
})

describe('Constant Contact stays hidden until its app is set', () => {
  const raw = Buffer.from(key.material).toString('base64')

  it('is offered only with both halves of its app, by sign-in, and the others are offered the same either way', () => {
    const without = providerAvailability(readMarketingPlatformsConfig({ MARKETING_PLATFORMS_TOKEN_KEY: raw }))
    expect(without.map((entry) => entry.id)).toEqual(['mailchimp', 'klaviyo', 'omnisend'])
    const half = providerAvailability(
      readMarketingPlatformsConfig({ MARKETING_PLATFORMS_TOKEN_KEY: raw, CONSTANT_CONTACT_CLIENT_ID: 'cc-id' }),
    )
    expect(half).toEqual(without)
    const withApp = providerAvailability(
      readMarketingPlatformsConfig({
        MARKETING_PLATFORMS_TOKEN_KEY: raw,
        CONSTANT_CONTACT_CLIENT_ID: 'cc-id',
        CONSTANT_CONTACT_CLIENT_SECRET: 'cc-secret',
      }),
    )
    expect(withApp.filter((entry) => entry.id !== 'constant-contact')).toEqual(without)
    expect(withApp.find((entry) => entry.id === 'constant-contact')).toEqual({ id: 'constant-contact', apiKey: false, oauth: true })
  })

  it('is not offered without the token key, even with its app', () => {
    expect(
      providerAvailability(readMarketingPlatformsConfig({ CONSTANT_CONTACT_CLIENT_ID: 'a', CONSTANT_CONTACT_CLIENT_SECRET: 'b' })),
    ).toEqual([])
  })
})

function routesSetup(config: MarketingPlatformsConfig, tokenAnswer: () => { status?: number; body?: unknown }) {
  const memory = createMemoryStore()
  const exchange = mockFetch((url) => {
    if (url.startsWith(TOKEN_URL)) return tokenAnswer()
    if (url.endsWith('/account/summary')) return { body: { organization_name: 'Acme Coffee' } }
    if (url.includes('/contact_lists')) return { body: { lists: [{ list_id: 'L1', name: 'Newsletter' }] } }
    return { status: 404 }
  })
  const deps: MarketingRouteDeps = {
    now: () => NOW,
    config: () => config,
    store: memory.store,
    provider: (id) => createMarketingProvider(id, exchange.http),
    http: exchange.http,
    gate: async (request) => {
      const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org-1', hostId: HOST, uid: 'u1', body }
    },
    redirectUri: () => 'https://app.test/api/marketing-platforms/oauth/callback',
    syncNow: async () => undefined,
    logActivity: async () => undefined,
  }
  return { routes: createMarketingRoutes(deps), memory, exchange }
}

const post = (body: unknown) => new Request('https://app.test/api/x', { method: 'POST', body: JSON.stringify({ hostId: HOST, ...(body as object) }) })

describe('connecting Constant Contact', () => {
  const config: MarketingPlatformsConfig = { keyring, oauth: { 'constant-contact': app } }

  it('refuses a key and a start without its app', async () => {
    const bare = routesSetup({ keyring, oauth: {} }, () => ({ status: 500 }))
    expect((await bare.routes.connect(post({ provider: 'constant-contact', apiKey: 'k' }))).status).toBe(404)
    expect((await bare.routes.oauthStart(post({ provider: 'constant-contact' }))).status).toBe(404)
    const listed = await (await bare.routes.list(new Request(`https://app.test/api/x?hostId=${HOST}`))).json()
    expect(listed.available.some((entry: any) => entry.id === 'constant-contact')).toBe(false)
  })

  it('sends the merchant to the consent page with its scopes, exchanges the code with Basic and the grant in the query, and seals both tokens', async () => {
    const { routes, memory, exchange } = routesSetup(config, () => ({
      body: { access_token: 'cc-access', refresh_token: 'cc-refresh-1', expires_in: 86400, token_type: 'Bearer' },
    }))
    const start = await (await routes.oauthStart(post({ provider: 'constant-contact', returnTo: '/acme/hosts/h/setup' }))).json()
    const url = new URL(start.url)
    expect(url.origin + url.pathname).toBe('https://authz.constantcontact.com/oauth2/default/v1/authorize')
    expect(url.searchParams.get('scope')).toBe('account_read contact_data offline_access')
    expect(url.searchParams.get('client_id')).toBe('cc-id')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge')).toBeNull()
    expect(readOAuthState(url.searchParams.get('state'))!.connectionId).toBe(ID)

    const back = await routes.oauthCallback(new Request(`https://app.test/cb?code=the-code&state=${url.searchParams.get('state')}`))
    expect(back.headers.get('location')).toBe('https://app.test/acme/hosts/h/setup?marketingPlatform=connected')

    const token = exchange.calls[0]
    expect(token.url.startsWith(TOKEN_URL)).toBe(true)
    expect(Object.fromEntries(new URL(token.url).searchParams)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://app.test/api/marketing-platforms/oauth/callback',
    })
    expect(token.headers['Authorization']).toBe(`Basic ${Buffer.from('cc-id:cc-secret').toString('base64')}`)
    expect(token.url).not.toContain('cc-secret')

    const stored = memory.connections.get(ID)!
    expect(stored).toMatchObject({ status: 'active', authKind: 'oauth', accountName: 'Acme Coffee', listId: 'L1', tokenExpiresAtMs: NOW + 86_400_000 })
    expect(openCredential(stored.sealedToken!, ID, 'token', keyring).value).toBe('cc-access')
    expect(openCredential(stored.sealedRefreshToken!, ID, 'refresh', keyring).value).toBe('cc-refresh-1')
    expect(JSON.stringify(stored)).not.toContain('cc-refresh-1')
    const listed = await (await routes.list(new Request(`https://app.test/api/x?hostId=${HOST}`))).text()
    expect(listed).not.toContain('cc-access')
    expect(listed).not.toContain('sealed')
  })

  it('sends the merchant back saying it failed when the code is refused', async () => {
    const { routes, memory } = routesSetup(config, () => ({ status: 400, body: { error: 'invalid_grant' } }))
    const start = await (await routes.oauthStart(post({ provider: 'constant-contact', returnTo: '/x' }))).json()
    const state = new URL(start.url).searchParams.get('state')
    const back = await routes.oauthCallback(new Request(`https://app.test/cb?code=bad&state=${state}`))
    expect(back.headers.get('location')).toBe('https://app.test/x?marketingPlatform=failed')
    expect(memory.connections.get(ID)!.sealedToken).toBeNull()
  })
})

function oauthConnection(overrides: Partial<StoredConnection> = {}): StoredConnection {
  return {
    ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'constant-contact', nowMs: NOW }),
    authKind: 'oauth',
    listId: 'L1',
    sealedToken: sealCredential('access-old', ID, 'token', keyring),
    sealedRefreshToken: sealCredential('refresh-1', ID, 'refresh', keyring),
    tokenExpiresAtMs: NOW + 60_000,
    tokenKeyId: key.id,
    ...overrides,
  }
}

describe('Constant Contact’s rotating refresh', () => {
  const opener = (memory: ReturnType<typeof createMemoryStore>, http: ProviderHttp) =>
    createCredentialOpener({ store: memory.store, config: () => ({ keyring, oauth: { 'constant-contact': app } }), http, now: () => NOW })

  it('refreshes a token about to expire, with Basic and the grant in the query, and seals the rotated refresh token', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection())
    const { http, calls } = mockFetch(() => ({ body: { access_token: 'access-new', refresh_token: 'refresh-2', expires_in: 86400 } }))
    const credential = await opener(memory, http)(ID, (await memory.store.get(ID))!)
    expect(credential).toEqual({ kind: 'oauth', token: 'access-new', apiBase: null })
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-1' })
    expect(calls[0].headers['Authorization']).toBe(`Basic ${Buffer.from('cc-id:cc-secret').toString('base64')}`)
    const stored = memory.connections.get(ID)!
    expect(openCredential(stored.sealedRefreshToken!, ID, 'refresh', keyring).value).toBe('refresh-2')
    expect(openCredential(stored.sealedToken!, ID, 'token', keyring).value).toBe('access-new')
    expect(stored.tokenExpiresAtMs).toBe(NOW + 86_400_000)
  })

  it('leaves a token with time left alone: the token endpoint is rate limited', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection({ tokenExpiresAtMs: NOW + 3_600_000 }))
    const { http, calls } = mockFetch(() => ({ status: 500 }))
    expect(await opener(memory, http)(ID, (await memory.store.get(ID))!)).toEqual({ kind: 'oauth', token: 'access-old', apiBase: null })
    expect(calls).toHaveLength(0)
  })

  it('uses the grant another run just rotated, rather than calling a live connection revoked', async () => {
    const memory = createMemoryStore()
    const read = oauthConnection()
    // Another run spent refresh-1 after this one read the connection.
    memory.connections.set(
      ID,
      oauthConnection({
        sealedToken: sealCredential('access-other-run', ID, 'token', keyring),
        sealedRefreshToken: sealCredential('refresh-2', ID, 'refresh', keyring),
        tokenExpiresAtMs: NOW + 86_400_000,
      }),
    )
    const { http } = mockFetch(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'The refresh token is invalid or expired.' } }))
    expect(await opener(memory, http)(ID, read)).toEqual({ kind: 'oauth', token: 'access-other-run', apiBase: null })
  })

  it('turns a revoked refresh token into "connect again"', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection({ tokenExpiresAtMs: NOW - 1 }))
    const { http } = mockFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }))
    await expect(opener(memory, http)(ID, (await memory.store.get(ID))!)).rejects.toMatchObject({
      kind: 'auth',
      message: 'The connection was revoked or expired. Connect again.',
    })
  })

  it('retries a token endpoint that is down instead of asking to connect again', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection({ tokenExpiresAtMs: NOW - 1 }))
    const { http } = mockFetch(() => ({ status: 503 }))
    await expect(opener(memory, http)(ID, (await memory.store.get(ID))!)).rejects.toMatchObject({ kind: 'transient' })
  })
})

describe('a Constant Contact run whose grant is gone', () => {
  function runDeps(memory: ReturnType<typeof createMemoryStore>, handler: Parameters<typeof mockFetch>[0]): SyncRunDeps {
    const mock = mockFetch(handler)
    const http: ProviderHttp = { fetch: mock.fetch, sleep: async () => undefined }
    return {
      now: () => NOW,
      store: memory.store,
      provider: (id) => createMarketingProvider(id, http),
      credential: createCredentialOpener({ store: memory.store, config: () => ({ keyring, oauth: { 'constant-contact': app } }), http, now: () => NOW }),
      isLocked: async () => false,
      org: async () => ({ orgId: 'org-1', org: {}, entitled: true }),
      peopleChangedSince: async () => ({ people: [], next: null }),
      readStatuses: async () => [],
      currentStatuses: async (input) => new Map(input.emails.map((email) => [email, null])),
      suppressionChanges: async () => ({ rows: [], next: null }),
      recordUnsubscribes: async (input) => input.emails.length,
      releaseUnsubscribes: async (input) => input.emails.length,
    }
  }

  it('stops at "connect again" when Constant Contact refuses the access token (revoked in the account)', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection({ tokenExpiresAtMs: NOW + 3_600_000 }))
    const report = await runConnectionSync(
      runDeps(memory, () => ({ status: 401, body: [{ error_key: 'unauthorized', error_message: 'Unauthorized' }] })),
      ID,
    )
    expect(report.outcome).toBe('failed')
    expect(memory.connections.get(ID)).toMatchObject({ status: 'reconnect', leaseUntilMs: 0 })
    expect(memory.logs.get(ID)?.[0]).toMatchObject({ kind: 'error' })
  })

  it('stops at "connect again" when its expired token cannot be refreshed', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection({ tokenExpiresAtMs: NOW - 1 }))
    await runConnectionSync(runDeps(memory, (url) => (url.startsWith(TOKEN_URL) ? { status: 400, body: { error: 'invalid_grant' } } : { status: 500 })), ID)
    expect(memory.connections.get(ID)).toMatchObject({
      status: 'reconnect',
      lastError: 'The connection was revoked or expired. Connect again.',
    })
  })

  it('refreshes and syncs when the grant is only expired, filing an opt-out read back', async () => {
    const memory = createMemoryStore()
    memory.connections.set(ID, oauthConnection({ tokenExpiresAtMs: NOW - 1 }))
    const filed: string[] = []
    const deps = runDeps(memory, (url) => {
      if (url.startsWith(TOKEN_URL)) return { body: { access_token: 'access-new', refresh_token: 'refresh-2', expires_in: 86400 } }
      if (url.includes('/contacts?')) return { body: { contacts: [{ email_address: { address: 'left@example.com', permission_to_send: 'unsubscribed' } }] } }
      return { status: 404 }
    })
    deps.recordUnsubscribes = async (input) => {
      filed.push(...input.emails.map((email) => `${email}:${input.via}:${input.detail}`))
      return input.emails.length
    }
    const report = await runConnectionSync(deps, ID)
    expect(report).toMatchObject({ outcome: 'ok', consentPulled: 1 })
    expect(filed).toEqual(['left@example.com:marketing-platforms:constant-contact:Unsubscribed in Constant Contact.'])
    expect(memory.connections.get(ID)).toMatchObject({ status: 'active', tokenExpiresAtMs: NOW + 86_400_000 })
  })
})
