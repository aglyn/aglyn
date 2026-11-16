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
  reserveClientPromotion: jest.fn(),
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
        'reserveClientPromotion',
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
import { connectorOrigin, unconfiguredOriginResponse } from '../app/api/_lib/connector-oauth-http'

const ORIGIN = 'https://app.aglyn.com'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const CLIENT_ID = `aglyn_client_${'A'.repeat(22)}`
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const CLIENT = { clientId: CLIENT_ID, clientName: 'Claude', redirectUris: [CLAUDE] }
/** Well-formed secrets: a malformed one is refused before any read. */
const RT = `aglyn_rt_${'r'.repeat(43)}`
const AC = `aglyn_ac_${'c'.repeat(43)}`
const AC2 = `aglyn_ac_${'d'.repeat(43)}`
const UNKNOWN_CLIENT = `aglyn_client_${'N'.repeat(22)}`

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
  mockStore.reserveClientPromotion.mockResolvedValue(true)
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
    const response = await call({ redirect_uris: ['javascript:alert(1)'] })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' })
    expect(mockStore.registerConnectorClient).not.toHaveBeenCalled()
  })

  it('refuses the wrong media type, bad JSON and an oversized body', async () => {
    expect((await call({ redirect_uris: [CLAUDE] }, 'text/plain')).status).toBe(400)
    expect((await call('{nope')).status).toBe(400)
    expect((await call({ redirect_uris: [CLAUDE], client_name: 'x'.repeat(9000) })).status).toBe(413)
  })

  it('answers a repeat registration 201 with the same client and its first issue time', async () => {
    mockStore.registerConnectorClient.mockResolvedValue({ ...CLIENT, issuedAtMs: 1_700_000_000_000, created: false })
    const response = await call({ client_name: 'Claude', redirect_uris: [CLAUDE] })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ client_id: CLIENT_ID, client_id_issued_at: 1_700_000_000 })
  })

  it('registers any MCP client whose addresses pass the policy, web or app or loopback', async () => {
    mockStore.registerConnectorClient.mockImplementation(async (input: { clientName: string; redirectUris: string[] }) => ({
      clientId: CLIENT_ID,
      ...input,
      issuedAtMs: 0,
      created: true,
    }))
    const response = await call({
      client_name: 'Cursor',
      redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/callback', 'http://[::1]:6274/cb', 'https://chatgpt.com/cb'],
    })
    expect(response.status).toBe(201)
    expect((await response.json()).client_name).toBe('Cursor')
  })

  it('bounds NEW clients per address, and never refuses a repeat of an existing one', async () => {
    mockStore.registerConnectorClient.mockImplementation(
      async (_input: unknown, _now: number, options: { mayCreate?: boolean }) =>
        options?.mayCreate === false ? null : { ...CLIENT, issuedAtMs: 0, created: true },
    )
    for (let i = 0; i < 20; i += 1) expect((await call({ redirect_uris: [CLAUDE] })).status).toBe(201)
    const refused = await call({ redirect_uris: [CLAUDE] })
    expect(refused.status).toBe(429)
    expect(mockStore.registerConnectorClient).toHaveBeenLastCalledWith(expect.anything(), expect.any(Number), { mayCreate: false })
    mockStore.registerConnectorClient.mockResolvedValue({ ...CLIENT, issuedAtMs: 0, created: false })
    expect((await call({ redirect_uris: [CLAUDE] })).status).toBe(201)
  })

  it('reserves a new-client unit before the transaction and refunds it when the client existed', async () => {
    // Twenty concurrent NEW registrations, then twenty concurrent repeats:
    // the repeats refund, so they never eat into the budget for new ones.
    mockStore.registerConnectorClient.mockResolvedValue({ ...CLIENT, issuedAtMs: 0, created: false })
    const repeats = await Promise.all(Array.from({ length: 40 }, () => call({ redirect_uris: [CLAUDE] })))
    expect(repeats.every((response) => response.status === 201)).toBe(true)
    let created = 0
    mockStore.registerConnectorClient.mockImplementation(async (_input: unknown, _now: number, options: { mayCreate?: boolean }) => {
      if (options?.mayCreate === false) return null
      created += 1
      return { ...CLIENT, issuedAtMs: 0, created: true }
    })
    const news = await Promise.all(Array.from({ length: 30 }, () => call({ redirect_uris: [CLAUDE] })))
    expect(created).toBe(20)
    expect(news.filter((response) => response.status === 429)).toHaveLength(10)
  })

  it('limits registrations per address only at a rate no burst of real connects reaches', async () => {
    mockStore.registerConnectorClient.mockResolvedValue({ ...CLIENT, issuedAtMs: 0 })
    for (let i = 0; i < 300; i += 1) expect((await call({ redirect_uris: [CLAUDE] })).status).toBe(201)
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
      form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: AC, redirect_uri: CLAUDE, code_verifier: 'v'.repeat(43), resource: `${ORIGIN}/api/mcp` }),
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
    ['no client_id', () => token(form({ grant_type: 'refresh_token', refresh_token: RT })), 400, 'invalid_request'],
    ['a parameter twice', () => token(new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `client_id=${CLIENT_ID}&code=a&code=b` })), 400, 'invalid_request'],
    ['another resource', () => token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT, resource: 'https://evil.example/api/mcp' })), 400, 'invalid_target'],
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
    const response = await token(form({ grant_type: 'refresh_token', client_id: UNKNOWN_CLIENT, refresh_token: RT }))
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

  it.each([
    // The second review's zero-click redirector: a registered phishing page,
    // reached by a request that is wrong before consent.
    ['response_type=token', { response_type: 'token' }],
    ['plain PKCE', { code_challenge_method: 'plain' }],
    ['an unknown scope', { scope: 'openid' }],
    ['another resource', { resource: 'https://evil.com/api/mcp' }],
  ])('shows a pre-consent error (%s) and NEVER answers with an address to follow', async (_label, change) => {
    mockStore.readConnectorClient.mockResolvedValue({ ...CLIENT, redirectUris: ['https://evil.com/phish?step=2'] })
    const query = authorizeQuery({ redirect_uri: 'https://evil.com/phish?step=2', ...change })
    for (const action of ['describe', 'allow']) {
      const response = await consentCall({ action, query, orgId: 'org-1', access: 'view' })
      const body = await response.json()
      expect(response.status).toBe(400)
      expect(body).not.toHaveProperty('redirectTo')
      expect(body).toMatchObject({ reason: 'request_error', returnsTo: { kind: 'web', host: 'evil.com' } })
    }
    expect(mockStore.mintConnectorCode).not.toHaveBeenCalled()
  })

  it('sends a pre-consent error back to the app only on Cancel, with the state untouched', async () => {
    const response = await consentCall({ action: 'deny', query: authorizeQuery({ code_challenge_method: 'plain' }) })
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
    expect(body.app).toEqual({
      name: 'Claude',
      returnsTo: 'claude.ai',
      kind: 'web',
      host: 'claude.ai',
      path: '/api/mcp/auth_callback',
    })
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
      form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: AC, redirect_uri: CLAUDE, code_verifier: 'v'.repeat(43) }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(tokens)

    mockLogOrgActivity.mockRejectedValueOnce(new Error('firestore down'))
    expect((await token(form({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: AC2, redirect_uri: CLAUDE, code_verifier: 'v'.repeat(43) }))).status).toBe(200)
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
        token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT, resource }))
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
    for (let i = 0; i < 30; i += 1) await token(form({ grant_type: 'refresh_token', client_id: UNKNOWN_CLIENT, refresh_token: RT }))
    const refused = await token(form({ grant_type: 'refresh_token', client_id: UNKNOWN_CLIENT, refresh_token: RT }))
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ error: 'invalid_request' })
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  })

})

describe('second review (AGL-4225)', () => {
  const tokens = {
    access_token: `aglyn_at_${'a'.repeat(43)}`,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: `aglyn_rt_${'r'.repeat(43)}`,
    scope: 'contacts:read',
  }

  describe('11 · one origin, by deployment', () => {
    const saved = { ...process.env }
    afterEach(() => {
      for (const key of ['NEXT_PUBLIC_CONSOLE_URL', 'VERCEL_ENV']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    })
    const spoofed = () =>
      new Request('https://acme.aglyn.com/api/oauth/metadata/authorization-server', {
        headers: { 'x-forwarded-host': 'acme.aglyn.com' },
      })

    it('a production build without a console URL uses the canonical console origin, never the host', () => {
      delete process.env.NEXT_PUBLIC_CONSOLE_URL
      expect(connectorOrigin(spoofed(), { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toEqual({
        origin: 'https://app.aglyn.com',
        configured: true,
      })
      expect(connectorOrigin(spoofed(), { NODE_ENV: 'production', VERCEL_ENV: 'production' } as NodeJS.ProcessEnv).origin).toBe(
        'https://app.aglyn.com',
      )
    })

    it('a configured console URL wins everywhere', () => {
      process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com'
      expect(connectorOrigin(spoofed(), { NODE_ENV: 'production' } as NodeJS.ProcessEnv).origin).toBe('https://console.example.com')
      expect(connectorOrigin(spoofed(), { NODE_ENV: 'development' } as NodeJS.ProcessEnv).origin).toBe('https://console.example.com')
    })

    it('local development and a Vercel preview read the host the request was addressed to', () => {
      delete process.env.NEXT_PUBLIC_CONSOLE_URL
      expect(connectorOrigin(spoofed(), { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual({
        origin: 'https://acme.aglyn.com',
        configured: false,
      })
      expect(
        connectorOrigin(spoofed(), { NODE_ENV: 'production', VERCEL_ENV: 'preview' } as NodeJS.ProcessEnv).configured,
      ).toBe(false)
    })
  })
})

describe('third review (AGL-4225)', () => {
  const tokens = {
    access_token: `aglyn_at_${'a'.repeat(43)}`,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: `aglyn_rt_${'n'.repeat(43)}`,
    scope: 'contacts:read',
  }
  const VICTIM_RT = `aglyn_rt_${'v'.repeat(43)}`
  const junk = (i: number) => `aglyn_rt_${String(i).padStart(43, 'j')}`

  afterEach(() => jest.restoreAllMocks())

  it('N2 · the victim’s refresh succeeds after 30 junk posts naming its client id, and 11 minutes later', async () => {
    mockStore.readConnectorClient.mockResolvedValue(CLIENT)
    mockStore.refreshConnectorTokens.mockImplementation(async ({ refreshToken }: { refreshToken: string }) =>
      refreshToken === VICTIM_RT
        ? { ok: true, tokens }
        : { ok: false, error: 'invalid_grant', description: 'The refresh token is not valid', unknown: true },
    )
    // A hostile page posts from the victim's own address, naming its public client id.
    for (let i = 0; i < 30; i += 1) {
      expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: junk(i) }))).status).toBe(400)
    }
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: junk(99) }))).status).toBe(429)
    // The real client's refresh resolves, so no failure budget refuses it.
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: VICTIM_RT }))).status).toBe(200)
    // Eleven minutes after its last call — longer than any instance memory —
    // with the junk still being posted.
    const later = Date.now() + 11 * 60_000
    jest.spyOn(Date, 'now').mockReturnValue(later)
    for (let i = 0; i < 31; i += 1) await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: junk(i) }))
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: VICTIM_RT }))).status).toBe(200)
  })

  it('N2 · a malformed secret is refused without a read; a well-formed one is looked up under a generous ceiling', async () => {
    mockStore.readConnectorClient.mockResolvedValue(CLIENT)
    const before = mockStore.readConnectorClient.mock.calls.length
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: 'x' }))).status).toBe(400)
    expect(mockStore.readConnectorClient.mock.calls.length).toBe(before)
    expect(mockStore.refreshConnectorTokens).not.toHaveBeenCalled()
    // 600 reads a minute: 300 requests of two reads each, then refused.
    mockStore.refreshConnectorTokens.mockResolvedValue({ ok: true, tokens })
    for (let i = 0; i < 300; i += 1) {
      expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT }))).status).toBe(200)
    }
    expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT }))).status).toBe(429)
  })

  it('N2 · a refusal for any reason but an unknown secret is never counted', async () => {
    mockStore.readConnectorClient.mockResolvedValue(CLIENT)
    mockStore.refreshConnectorTokens.mockResolvedValue({ ok: false, error: 'invalid_grant', description: 'already used' })
    for (let i = 0; i < 40; i += 1) {
      expect((await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT }))).status).toBe(400)
    }
  })

  it('N3 · a lock answers 503 temporarily_unavailable with Retry-After, and is never counted', async () => {
    mockStore.readConnectorClient.mockResolvedValue(CLIENT)
    mockStore.refreshConnectorTokens.mockResolvedValue({
      ok: false,
      error: 'temporarily_unavailable',
      description: 'The workspace is locked; try again later',
      retryAfterSec: 300,
    })
    for (let i = 0; i < 35; i += 1) {
      const response = await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT }))
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('300')
      expect(await response.json()).toEqual({
        error: 'temporarily_unavailable',
        error_description: 'The workspace is locked; try again later',
      })
    }
  })

  it('N6d · a self-hosted build without a console URL fails closed, naming no one else’s console', () => {
    delete process.env.NEXT_PUBLIC_CONSOLE_URL
    const request = new Request('https://console.example.com/x')
    expect(connectorOrigin(request, { NODE_ENV: 'production', AGLYN_STANDALONE: '1' } as NodeJS.ProcessEnv)).toBeNull()
    const answer = unconfiguredOriginResponse()
    expect(answer.status).toBe(503)
  })

  it('N6f · a preview deployment issues nothing: discovery, register, consent and token answer 404', async () => {
    const saved = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = 'preview'
    try {
      const statuses = [
        protectedResource(new Request(`${ORIGIN}/x`)).status,
        authorizationServer(new Request(`${ORIGIN}/x`)).status,
        (await register(new Request(`${ORIGIN}/api/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status,
        (await token(form({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: RT }))).status,
        (await consentCall({ action: 'describe', query: authorizeQuery() })).status,
      ]
      expect(statuses).toEqual([404, 404, 404, 404, 404])
      expect(mockStore.readConnectorClient).not.toHaveBeenCalled()
      process.env.CONNECTOR_SIGN_IN_ON_PREVIEW = '1'
      expect(protectedResource(new Request(`${ORIGIN}/x`)).status).toBe(200)
    } finally {
      if (saved === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = saved
      delete process.env.CONNECTOR_SIGN_IN_ON_PREVIEW
    }
  })

  it('N6e · an account may approve 30 times per window, and may not bring more new clients to life than allowed', async () => {
    // An account no earlier test has approved with: the allowance is per account.
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-busy', email: 'busy@example.com', email_verified: true })
    mockStore.mintConnectorCode.mockResolvedValue('aglyn_ac_minted')
    mockStore.reserveClientPromotion.mockResolvedValue(true)
    for (let i = 0; i < 30; i += 1) {
      expect((await consentCall({ action: 'allow', query: authorizeQuery(), orgId: 'org-1', access: 'view' })).status).toBe(200)
    }
    const throttled = await consentCall({ action: 'allow', query: authorizeQuery(), orgId: 'org-1', access: 'view' })
    expect(throttled.status).toBe(429)
  })

  it('N6e · refuses an approval that would promote one client too many today', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-promoter', email: 'p@example.com', email_verified: true })
    mockStore.reserveClientPromotion.mockResolvedValue(false)
    const refused = await consentCall({ action: 'allow', query: authorizeQuery(), orgId: 'org-1', access: 'view' })
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ reason: 'promotion_limit' })
    expect(mockStore.mintConnectorCode).not.toHaveBeenCalled()
  })
})

