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

/**
 * The connector sign-in routes (AGL-4225), as HTTP: the discovery documents,
 * registration, the token and revocation endpoints, the consent route the
 * `/oauth/authorize` page calls, and Settings' Connected apps.
 *
 * The pure rules (allowlist, PKCE, request validation) and the store run for
 * real where they are pure; the store's Firestore half is stood in, because
 * its own specs prove it. What these pin is each route's contract: the
 * checks it makes, in order, the status and error shape it answers with, the
 * CORS and caching it sends, and that nothing secret comes back in an error.
 */

const mockStore = {
  registerConnectorClient: jest.fn(),
  readConnectorClient: jest.fn(),
  exchangeConnectorCode: jest.fn(),
  refreshConnectorTokens: jest.fn(),
  revokeConnectorToken: jest.fn(),
  mintConnectorCode: jest.fn(),
  listConnectableWorkspaces: jest.fn(),
  listConnectorGrants: jest.fn(),
  disconnectConnectorGrant: jest.fn(),
}
const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockMemberHasOrgPermission = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockLogOrgActivity = jest.fn()
let mockOrg: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => {
  const pure = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/connector-oauth')
  const http = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/api-http')
  return {
    __esModule: true,
    ...http,
    ...pure,
    ...Object.fromEntries(
      [
        'registerConnectorClient',
        'readConnectorClient',
        'exchangeConnectorCode',
        'refreshConnectorTokens',
        'revokeConnectorToken',
        'mintConnectorCode',
        'listConnectableWorkspaces',
        'listConnectorGrants',
        'disconnectConnectorGrant',
      ].map((name) => [
        name,
        (...args: unknown[]) => (mockStore as Record<string, jest.Mock>)[name](...args),
      ]),
    ),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
        firestore: () => ({
          collection: () => ({ doc: () => ({ get: async () => ({ data: () => mockOrg }) }) }),
        }),
      }),
    },
    isImpersonationSession: (decoded: Record<string, unknown>) => typeof decoded.impersonatedBy === 'string',
    emailUnverifiedResponse: () => Response.json({ reason: 'email-unverified' }, { status: 403 }),
    resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
    memberHasOrgPermission: (...args: unknown[]) => mockMemberHasOrgPermission(...args),
    lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
    logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: (org: Record<string, unknown>) => org.plan !== 'free',
  isOrgWideMember: (member: { role?: string } | null) => Boolean(member && member.role !== 'collaborator'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body: request.method === 'GET' ? {} : await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { GET as authorizationServer } from '../app/api/oauth/metadata/authorization-server/route'
import { GET as protectedResource, OPTIONS as protectedResourcePreflight } from '../app/api/oauth/metadata/protected-resource/route'
import { POST as register } from '../app/api/oauth/register/route'
import { POST as token } from '../app/api/oauth/token/route'
import { POST as revoke } from '../app/api/oauth/revoke/route'
import { POST as consent } from '../app/api/oauth/consent/route'
import { GET as listApps, POST as appsAction } from '../app/api/orgs/connected-apps/route'
import { connectorOrigin } from '../app/api/_lib/connector-oauth-http'

const ORIGIN = 'https://app.aglyn.com'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const CLIENT_ID = `aglyn_client_${'A'.repeat(22)}`
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const CLIENT = { clientId: CLIENT_ID, clientName: 'Claude', redirectUris: [CLAUDE] }

let ipSeed = 0
/** A fresh address per test, so the per-address budgets never leak between them. */
let ip = '198.51.100.1'

const form = (body: Record<string, string>, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip, ...extra },
    body: new URLSearchParams(body).toString(),
  })

const authorizeQuery = (overrides: Record<string, string | null> = {}) => {
  const params: Record<string, string | null> = {
    client_id: CLIENT_ID,
    redirect_uri: CLAUDE,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'state-from-claude',
    ...overrides,
  }
  return new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== null) as [string, string][],
  ).toString()
}

const consentCall = (body: Record<string, unknown>, idToken: string | null = 'id-token') =>
  consent(
    new Request(`${ORIGIN}/api/oauth/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  ipSeed += 1
  ip = `198.51.100.${ipSeed}`
  mockOrg = { plan: 'pro' }
  mockStore.readConnectorClient.mockResolvedValue(CLIENT)
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'owner@example.com', email_verified: true })
  mockResolveOrgMembership.mockResolvedValue({ orgId: 'org-1', member: { role: 'admin' } })
  mockMemberHasOrgPermission.mockResolvedValue(true)
  mockLockdownRefusal.mockResolvedValue(null)
})

describe('discovery documents', () => {
  it('serves both documents from the request origin, readable cross-origin', async () => {
    const resource = await protectedResource(new Request(`${ORIGIN}/api/oauth/metadata/protected-resource`))
    expect(await resource.json()).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] })
    expect(resource.headers.get('access-control-allow-origin')).toBe('*')
    expect(resource.headers.get('access-control-allow-credentials')).toBeNull()

    const server = await authorizationServer(new Request('http://localhost:4200/api/oauth/metadata/authorization-server'))
    expect(await server.json()).toMatchObject({
      issuer: 'http://localhost:4200',
      token_endpoint: 'http://localhost:4200/api/oauth/token',
    })
  })

  it('answers a preflight', () => {
    const preflight = protectedResourcePreflight()
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
  })
})

describe('POST /api/oauth/register', () => {
  const call = (body: unknown, type = 'application/json') =>
    register(
      new Request(`${ORIGIN}/api/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': type, 'x-forwarded-for': ip },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )

  it('registers a public client and says what it actually got', async () => {
    mockStore.registerConnectorClient.mockResolvedValue({ ...CLIENT, issuedAtMs: 1_700_000_000_000 })
    const response = await call({ client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'client_secret_post' })
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({
      client_id: CLIENT_ID,
      client_id_issued_at: 1_700_000_000,
      client_name: 'Claude',
      redirect_uris: [CLAUDE],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    expect(body).not.toHaveProperty('client_secret')
  })

  it('refuses an address off the allowlist, and stores nothing', async () => {
    const response = await call({ redirect_uris: ['https://evil.example/callback'] })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' })
    expect(mockStore.registerConnectorClient).not.toHaveBeenCalled()
  })

  it('refuses the wrong media type, bad JSON and an oversized body', async () => {
    expect((await call({ redirect_uris: [CLAUDE] }, 'text/plain')).status).toBe(400)
    expect((await call('{nope')).status).toBe(400)
    expect((await call({ redirect_uris: [CLAUDE], client_name: 'x'.repeat(9000) })).status).toBe(413)
  })

  it('limits registrations per address', async () => {
    mockStore.registerConnectorClient.mockResolvedValue({ ...CLIENT, issuedAtMs: 0 })
    for (let i = 0; i < 20; i += 1) expect((await call({ redirect_uris: [CLAUDE] })).status).toBe(201)
    const refused = await call({ redirect_uris: [CLAUDE] })
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

describe('POST /api/oauth/token', () => {
  const tokens = {
    access_token: `aglyn_at_${'a'.repeat(43)}`,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: `aglyn_rt_${'r'.repeat(43)}`,
    scope: 'contacts:read',
  }

  it('exchanges a code, answers no-store, and logs the new connection', async () => {
    mockStore.exchangeConnectorCode.mockResolvedValue({
      ok: true,
      tokens,
      connected: { grantId: 'grant_x', orgId: 'org-1', uid: 'user-1', email: 'owner@example.com', clientName: 'Claude' },
    })
    const response = await token(
      form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'aglyn_ac_x', redirect_uri: CLAUDE, code_verifier: 'v'.repeat(43), resource: `${ORIGIN}/api/mcp` }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(tokens)
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      'org-1',
      { uid: 'user-1', email: 'owner@example.com' },
      'Connected an app',
      { type: 'org', id: 'grant_x', name: 'Claude' },
    )
  })

  it('rotates on refresh', async () => {
    mockStore.refreshConnectorTokens.mockResolvedValue({ ok: true, tokens })
    const response = await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: tokens.refresh_token }))
    expect(response.status).toBe(200)
    expect(mockStore.refreshConnectorTokens).toHaveBeenCalledWith({
      refreshToken: tokens.refresh_token,
      clientId: CLIENT_ID,
      scope: undefined,
    })
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it.each([
    ['a JSON body', () => token(new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })), 400, 'invalid_request'],
    ['no client_id', () => token(form({ grant_type: 'refresh_token', refresh_token: 'x' })), 400, 'invalid_request'],
    ['a parameter twice', () => token(new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `client_id=${CLIENT_ID}&code=a&code=b` })), 400, 'invalid_request'],
    ['another resource', () => token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x', resource: 'https://evil.example/api/mcp' })), 400, 'invalid_target'],
    ['an unknown grant type', () => token(form({ grant_type: 'client_credentials', client_id: CLIENT_ID })), 400, 'unsupported_grant_type'],
    ['a code exchange missing the verifier', () => token(form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'c', redirect_uri: CLAUDE })), 400, 'invalid_request'],
  ])('refuses %s', async (_label, send, status, error) => {
    const response = await send()
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('answers an unknown client with invalid_client', async () => {
    mockStore.readConnectorClient.mockResolvedValue(null)
    const response = await token(form({ grant_type: 'refresh_token', client_id: 'aglyn_client_nope', refresh_token: 'x' }))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'invalid_client' })
  })

  it('never echoes what it was given in an error', async () => {
    mockStore.exchangeConnectorCode.mockResolvedValue({ ok: false, error: 'invalid_grant', description: 'The code has already been used' })
    const code = `aglyn_ac_${'s'.repeat(43)}`
    const verifier = 'q'.repeat(43)
    const response = await token(form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, redirect_uri: CLAUDE, code_verifier: verifier }))
    const text = await response.text()
    expect(response.status).toBe(400)
    expect(text).not.toContain(code)
    expect(text).not.toContain(verifier)
  })

  it('stops an address that keeps failing, and never one that keeps succeeding', async () => {
    mockStore.refreshConnectorTokens.mockResolvedValue({ ok: true, tokens })
    for (let i = 0; i < 40; i += 1) {
      expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x' }))).status).toBe(200)
    }
    mockStore.refreshConnectorTokens.mockResolvedValue({ ok: false, error: 'invalid_grant', description: 'no' })
    for (let i = 0; i < 30; i += 1) {
      expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x' }))).status).toBe(400)
    }
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x' }))).status).toBe(429)
  })
})

describe('POST /api/oauth/revoke', () => {
  const call = (body: Record<string, string>) =>
    revoke(
      new Request(`${ORIGIN}/api/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
        body: new URLSearchParams(body).toString(),
      }),
    )

  it('answers 200 whatever the token was, and passes the client along', async () => {
    const response = await call({ token: 'whatever', client_id: CLIENT_ID })
    expect(response.status).toBe(200)
    expect(mockStore.revokeConnectorToken).toHaveBeenCalledWith({ token: 'whatever', clientId: CLIENT_ID })
  })

  it('needs a registered client and a token', async () => {
    expect((await call({ client_id: CLIENT_ID })).status).toBe(400)
    mockStore.readConnectorClient.mockResolvedValue(null)
    expect((await call({ token: 'x', client_id: 'nope' })).status).toBe(401)
    expect(mockStore.revokeConnectorToken).not.toHaveBeenCalled()
  })
})

describe('POST /api/oauth/consent', () => {
  it('needs a Firebase session, and refuses an impersonation or an unverified email', async () => {
    expect((await consentCall({ action: 'describe', query: authorizeQuery() }, null)).status).toBe(401)
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u', email_verified: true, impersonatedBy: 'staff-1' })
    const impersonated = await consentCall({ action: 'allow', query: authorizeQuery(), orgId: 'org-1', access: 'view' })
    expect(impersonated.status).toBe(403)
    expect(await impersonated.json()).toMatchObject({ reason: 'impersonation' })
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'u', email_verified: false })
    expect((await consentCall({ action: 'describe', query: authorizeQuery() })).status).toBe(403)
    expect(mockStore.mintConnectorCode).not.toHaveBeenCalled()
  })

  it('shows, never follows, an unknown client or an unregistered address', async () => {
    mockStore.readConnectorClient.mockResolvedValueOnce(null)
    const unknown = await consentCall({ action: 'describe', query: authorizeQuery() })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'unknown_client', reason: 'unknown_client' })

    const elsewhere = await consentCall({ action: 'deny', query: authorizeQuery({ redirect_uri: 'https://evil.example/cb' }) })
    const body = await elsewhere.json()
    expect(elsewhere.status).toBe(400)
    expect(body).not.toHaveProperty('redirectTo')
  })

  it('sends any other problem back to the app with the state untouched', async () => {
    const response = await consentCall({ action: 'describe', query: authorizeQuery({ code_challenge_method: 'plain' }) })
    const { redirectTo } = await response.json()
    const url = new URL(redirectTo)
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE)
    expect(url.searchParams.get('error')).toBe('invalid_request')
    expect(url.searchParams.get('state')).toBe('state-from-claude')
    expect(url.searchParams.get('iss')).toBe(ORIGIN)
  })

  it('describes the app, the workspaces and both access choices in plain words', async () => {
    mockStore.listConnectableWorkspaces.mockResolvedValue([{ orgId: 'org-1', name: 'Acme', slug: 'acme', entitled: true }])
    const response = await consentCall({ action: 'describe', query: authorizeQuery() })
    const body = await response.json()
    expect(body.app).toEqual({ name: 'Claude', returnsTo: 'claude.ai', local: false })
    expect(body.workspaces).toHaveLength(1)
    expect(body.access.map((choice: { level: string }) => choice.level)).toEqual(['view', 'change'])
    expect(JSON.stringify(body)).not.toMatch(/oauth|scope|token|grant/i)
    expect(mockStore.listConnectableWorkspaces).toHaveBeenCalledWith('user-1')
  })

  it('mints a code on Allow, bound to everything, and sends it to the app', async () => {
    mockStore.mintConnectorCode.mockResolvedValue('aglyn_ac_minted')
    const response = await consentCall({ action: 'allow', query: authorizeQuery({ scope: 'contacts:read contacts:write' }), orgId: 'org-1', access: 'view' })
    const { redirectTo } = await response.json()
    const url = new URL(redirectTo)
    expect(url.searchParams.get('code')).toBe('aglyn_ac_minted')
    expect(url.searchParams.get('state')).toBe('state-from-claude')
    expect(mockStore.mintConnectorCode).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      redirectUri: CLAUDE,
      codeChallenge: CHALLENGE,
      orgId: 'org-1',
      uid: 'user-1',
      email: 'owner@example.com',
      // "View only", narrowed to what Claude asked for.
      scopes: ['contacts:read'],
      resource: null,
    })
    expect(mockLockdownRefusal).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1', org: mockOrg }))
  })

  it.each([
    ['a non-member', () => mockResolveOrgMembership.mockResolvedValue(null), 403],
    ['a site collaborator', () => mockResolveOrgMembership.mockResolvedValue({ orgId: 'org-1', member: { role: 'collaborator' } }), 403],
    ['a member without "Manage API keys"', () => mockMemberHasOrgPermission.mockResolvedValue(false), 403],
    ['a workspace without the plan', () => void (mockOrg = { plan: 'free' }), 403],
    ['a locked workspace', () => mockLockdownRefusal.mockResolvedValue(Response.json({ error: 'locked' }, { status: 423 })), 423],
  ])('refuses Allow for %s, and mints nothing', async (_label, arrange, status) => {
    arrange()
    const response = await consentCall({ action: 'allow', query: authorizeQuery(), orgId: 'org-1', access: 'change' })
    expect(response.status).toBe(status)
    expect(mockStore.mintConnectorCode).not.toHaveBeenCalled()
  })

  it('refuses an access level that was not offered', async () => {
    const response = await consentCall({ action: 'allow', query: authorizeQuery({ scope: 'contacts:read' }), orgId: 'org-1', access: 'change' })
    expect(response.status).toBe(400)
    expect(mockStore.mintConnectorCode).not.toHaveBeenCalled()
  })

  it('sends Cancel back as access_denied', async () => {
    const response = await consentCall({ action: 'deny', query: authorizeQuery() })
    const url = new URL((await response.json()).redirectTo)
    expect(url.searchParams.get('error')).toBe('access_denied')
    expect(url.searchParams.get('state')).toBe('state-from-claude')
  })
})

describe('/api/orgs/connected-apps', () => {
  const list = () =>
    listApps(new Request(`${ORIGIN}/api/orgs/connected-apps?orgId=org-1`, { headers: { authorization: 'Bearer id-token' } }))
  const disconnect = () =>
    appsAction(
      new Request(`${ORIGIN}/api/orgs/connected-apps`, {
        method: 'POST',
        headers: { authorization: 'Bearer id-token', 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: 'org-1', action: 'disconnect', grantId: 'grant_x' }),
      }),
    )

  it('lists for a manager, even on a plan without API access', async () => {
    mockOrg = { plan: 'free' }
    mockStore.listConnectorGrants.mockResolvedValue([{ grantId: 'grant_x', appName: 'Claude' }])
    const response = await list()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ apps: [{ grantId: 'grant_x', appName: 'Claude' }] })
  })

  it('refuses a member without "Manage API keys"', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)
    expect((await list()).status).toBe(403)
    expect((await disconnect()).status).toBe(403)
    expect(mockStore.disconnectConnectorGrant).not.toHaveBeenCalled()
  })

  it('disconnects and logs it', async () => {
    mockStore.disconnectConnectorGrant.mockResolvedValue({ disconnected: true, appName: 'Claude' })
    const response = await disconnect()
    expect(await response.json()).toEqual({ disconnected: true })
    expect(mockStore.disconnectConnectorGrant).toHaveBeenCalledWith('org-1', 'grant_x')
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      'org-1',
      { uid: 'user-1', email: 'owner@example.com' },
      'Disconnected an app',
      { type: 'org', id: 'grant_x', name: 'Claude' },
    )
  })
})

describe('fixes from review (AGL-4225)', () => {
  const tokens = {
    access_token: `aglyn_at_${'a'.repeat(43)}`,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: `aglyn_rt_${'r'.repeat(43)}`,
    scope: 'contacts:read',
  }

  it('1 · a failing activity log after a committed exchange still hands the tokens over', async () => {
    mockStore.exchangeConnectorCode.mockResolvedValue({
      ok: true,
      tokens,
      connected: { grantId: 'grant_x', orgId: 'org-1', uid: 'user-1', email: null, clientName: 'Claude' },
    })
    mockLogOrgActivity.mockImplementationOnce(() => {
      throw new Error('firestore down')
    })
    const response = await token(
      form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'aglyn_ac_x', redirect_uri: CLAUDE, code_verifier: 'v'.repeat(43) }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(tokens)

    mockLogOrgActivity.mockRejectedValueOnce(new Error('firestore down'))
    expect((await token(form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: 'aglyn_ac_y', redirect_uri: CLAUDE, code_verifier: 'v'.repeat(43) }))).status).toBe(200)
  })

  it('1 · a failing activity log after a Disconnect still reports the disconnect', async () => {
    mockStore.disconnectConnectorGrant.mockResolvedValue({ disconnected: true, appName: 'Claude' })
    mockLogOrgActivity.mockRejectedValueOnce(new Error('firestore down'))
    const response = await appsAction(
      new Request(`${ORIGIN}/api/orgs/connected-apps`, {
        method: 'POST',
        headers: { authorization: 'Bearer id-token', 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: 'org-1', action: 'disconnect', grantId: 'grant_x' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ disconnected: true })
  })

  it('8 · every connector route refuses on the auth origin', async () => {
    const onAuth = (path: string, init: RequestInit = {}) =>
      new Request(`https://auth.aglyn.com${path}`, {
        ...init,
        headers: { 'x-forwarded-host': 'auth.aglyn.com', ...(init.headers as Record<string, string>) },
      })
    const post = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' }
    const answers = [
      protectedResource(onAuth('/api/oauth/metadata/protected-resource')),
      authorizationServer(onAuth('/api/oauth/metadata/authorization-server')),
      await register(onAuth('/api/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })),
      await token(onAuth('/api/oauth/token', post)),
      await revoke(onAuth('/api/oauth/revoke', post)),
      await consent(onAuth('/api/oauth/consent', { method: 'POST', headers: { authorization: 'Bearer id-token' }, body: '{}' })),
    ]
    expect(answers.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404])
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(mockStore.readConnectorClient).not.toHaveBeenCalled()
  })

  describe('9 · one origin', () => {
    const saved = process.env.NEXT_PUBLIC_CONSOLE_URL
    afterEach(() => {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_CONSOLE_URL
      else process.env.NEXT_PUBLIC_CONSOLE_URL = saved
    })

    it('is the configured console URL, whatever Host the request carries, and only then cacheable', async () => {
      process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://app.aglyn.com/'
      const spoofed = new Request('https://evil.example/api/oauth/metadata/authorization-server', {
        headers: { 'x-forwarded-host': 'evil.example', host: 'evil.example' },
      })
      expect(connectorOrigin(spoofed)).toEqual({ origin: 'https://app.aglyn.com', configured: true })
      const response = authorizationServer(spoofed)
      expect((await response.json()).issuer).toBe('https://app.aglyn.com')
      expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    })

    it('without one, is the proxy-reported host and protocol, and is never cached', () => {
      delete process.env.NEXT_PUBLIC_CONSOLE_URL
      const viaProxy = new Request('http://10.0.0.5:3000/api/oauth/metadata/protected-resource', {
        headers: { 'x-forwarded-host': 'console.example.com', 'x-forwarded-proto': 'https' },
      })
      expect(connectorOrigin(viaProxy)).toEqual({ origin: 'https://console.example.com', configured: false })
      expect(protectedResource(viaProxy).headers.get('cache-control')).toBe('no-store')
    })

    it('decides the token endpoint’s resource check', async () => {
      process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://app.aglyn.com'
      mockStore.refreshConnectorTokens.mockResolvedValue({ ok: true, tokens })
      const asked = (resource: string) =>
        token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x', resource }))
      expect((await asked('https://app.aglyn.com/api/mcp')).status).toBe(200)
      expect((await asked(`${ORIGIN.replace('app.aglyn.com', 'evil.example')}/api/mcp`)).status).toBe(400)
    })
  })

  it('10 · an empty state comes back as given', async () => {
    const response = await consentCall({ action: 'deny', query: authorizeQuery({ state: '' }) })
    const url = new URL((await response.json()).redirectTo)
    expect(url.searchParams.has('state')).toBe(true)
    expect(url.searchParams.get('state')).toBe('')
  })

  it('10 · a refused token request is a 429 with invalid_request and Retry-After', async () => {
    mockStore.readConnectorClient.mockResolvedValue(null)
    for (let i = 0; i < 30; i += 1) await token(form({ grant_type: 'refresh_token', client_id: 'aglyn_client_nope', refresh_token: 'x' }))
    const refused = await token(form({ grant_type: 'refresh_token', client_id: 'aglyn_client_nope', refresh_token: 'x' }))
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ error: 'invalid_request' })
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('12 · one client failing at a shared address does not refuse another client there', async () => {
    const OTHER = `aglyn_client_${'B'.repeat(22)}`
    mockStore.readConnectorClient.mockImplementation(async (id: string) => ({ ...CLIENT, clientId: id }))
    mockStore.refreshConnectorTokens.mockImplementation(async ({ clientId }: { clientId: string }) =>
      clientId === CLIENT_ID ? { ok: false, error: 'invalid_grant', description: 'no' } : { ok: true, tokens },
    )
    for (let i = 0; i < 30; i += 1) {
      expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x' }))).status).toBe(400)
    }
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x' }))).status).toBe(429)
    expect((await token(form({ grant_type: 'refresh_token', client_id: OTHER, refresh_token: 'x' }))).status).toBe(200)
  })
})

