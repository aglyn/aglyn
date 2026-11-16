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

/**
 * The rules of connector sign-in that need no store (AGL-4225): where a code
 * may go, PKCE, what a registration keeps, which access a person can choose,
 * the order an authorization request is judged in, and the two discovery
 * documents.
 */

import { createHash } from 'node:crypto'
import { API_SCOPES } from './api-keys'
import {
  accessLevelOf,
  buildAuthorizationServerMetadata,
  buildAuthorizeRedirect,
  buildProtectedResourceMetadata,
  CONNECTOR_ACCESS_TOKEN_PREFIX,
  CONNECTOR_REDIRECT_ALLOWLIST,
  CONNECTOR_VIEW_SCOPES,
  connectorAccessOptions,
  constantTimeEqual,
  describeConnectorAccess,
  describeRedirectTarget,
  generateConnectorAccessToken,
  generateConnectorClientId,
  generateConnectorCode,
  generateConnectorGrantId,
  generateConnectorRefreshToken,
  isAllowedRedirectUri,
  isConnectorAccessTokenFormat,
  isConnectorClientIdFormat,
  isConnectorCodeFormat,
  isConnectorGrantIdFormat,
  isConnectorRefreshTokenFormat,
  matchRegisteredRedirect,
  parseRequestedScopes,
  pkceS256Challenge,
  readCappedBody,
  redirectUriMatches,
  sanitizeClientName,
  scopesForAccess,
  validateAuthorizeRequest,
  validateClientRegistration,
  verifyPkceS256,
} from './connector-oauth'

jest.mock('./firebase-admin', () => ({ firebaseAdmin: {} }))

const ORIGIN = 'https://app.example.com'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'

describe('credentials', () => {
  it('mints each kind with its own prefix, and none is an API key', () => {
    const minted = [
      generateConnectorAccessToken(),
      generateConnectorRefreshToken(),
      generateConnectorCode(),
    ]
    for (const token of minted) expect(token.startsWith('aglyn_sk_')).toBe(false)
    expect(isConnectorAccessTokenFormat(minted[0])).toBe(true)
    expect(isConnectorRefreshTokenFormat(minted[1])).toBe(true)
    expect(isConnectorCodeFormat(minted[2])).toBe(true)
    // A refresh token is not an access token, and the reverse.
    expect(isConnectorAccessTokenFormat(minted[1])).toBe(false)
    expect(isConnectorRefreshTokenFormat(minted[0])).toBe(false)
    expect(new Set(minted.map((token) => token.slice(9))).size).toBe(3)
  })

  it('rejects junk before any lookup', () => {
    for (const junk of ['', 'aglyn_at_', `${CONNECTOR_ACCESS_TOKEN_PREFIX}short`, `${CONNECTOR_ACCESS_TOKEN_PREFIX}${'a'.repeat(44)}`, 42, null]) {
      expect(isConnectorAccessTokenFormat(junk)).toBe(false)
    }
  })

  it('mints client and connection ids in their own shapes', () => {
    expect(isConnectorClientIdFormat(generateConnectorClientId())).toBe(true)
    expect(isConnectorGrantIdFormat(generateConnectorGrantId())).toBe(true)
    expect(isConnectorGrantIdFormat('key_abcdefghijkl')).toBe(false)
  })

  it('compares in constant time without throwing on unequal lengths', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', 'x')).toBe(false)
  })
})

describe('PKCE (S256 only)', () => {
  // RFC 7636 Appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

  it('matches the RFC 7636 test vector', () => {
    expect(pkceS256Challenge(verifier)).toBe(challenge)
    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it('refuses a wrong verifier, a plain challenge, and malformed input', () => {
    expect(verifyPkceS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false)
    // `plain` would send the verifier itself as the challenge.
    expect(verifyPkceS256(verifier, verifier)).toBe(false)
    expect(verifyPkceS256('short', challenge)).toBe(false)
    expect(verifyPkceS256(undefined, challenge)).toBe(false)
    expect(verifyPkceS256(verifier, undefined)).toBe(false)
  })
})

describe('redirect addresses', () => {
  it('is ONE list: Claude’s two callbacks and loopback', () => {
    expect(CONNECTOR_REDIRECT_ALLOWLIST.exact).toEqual([
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
    ])
    expect(CONNECTOR_REDIRECT_ALLOWLIST.loopbackHosts).toEqual(['localhost', '127.0.0.1'])
  })

  it.each([
    ['claude.ai', CLAUDE],
    ['claude.com', 'https://claude.com/api/mcp/auth_callback'],
    ['localhost with a port', 'http://localhost:33418/callback'],
    ['localhost without a port', 'http://localhost/callback'],
    ['127.0.0.1', 'http://127.0.0.1:8080/oauth/callback'],
  ])('admits %s', (_label, uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true)
  })

  it.each([
    ['another https host', 'https://evil.example/api/mcp/auth_callback'],
    ['a claude look-alike', 'https://claude.ai.evil.example/api/mcp/auth_callback'],
    ['Claude over http', 'http://claude.ai/api/mcp/auth_callback'],
    ['Claude with a query', `${CLAUDE}?next=https://evil.example`],
    ['Claude with a fragment', `${CLAUDE}#x`],
    ['Claude on another path', 'https://claude.ai/api/mcp/auth_callback/../x'],
    ['loopback over https', 'https://localhost:3000/callback'],
    ['loopback with user info', 'http://user@localhost:3000/callback'],
    ['loopback with a fragment', 'http://localhost:3000/callback#x'],
    ['a non-canonical loopback spelling', 'http://LOCALHOST:3000/callback'],
    ['a loopback with no path', 'http://localhost:3000'],
    ['a loopback look-alike host', 'http://localhost.evil.example/callback'],
    ['IPv6 loopback', 'http://[::1]:3000/callback'],
    ['a custom scheme', 'claude://callback'],
    ['javascript:', 'javascript:alert(1)'],
    ['an absurd length', `http://localhost/${'a'.repeat(600)}`],
    ['nothing', ''],
  ])('refuses %s', (_label, uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false)
  })

  it('matches exactly, except that a loopback port is the client’s to choose', () => {
    expect(redirectUriMatches(CLAUDE, CLAUDE)).toBe(true)
    expect(redirectUriMatches('http://localhost:1111/callback', 'http://localhost:2222/callback')).toBe(true)
    expect(redirectUriMatches('http://localhost:1111/callback', 'http://localhost:1111/other')).toBe(false)
    expect(redirectUriMatches('http://localhost:1111/callback', 'http://127.0.0.1:1111/callback')).toBe(false)
    expect(redirectUriMatches('http://localhost/cb?a=1', 'http://localhost:9/cb?a=2')).toBe(false)
    expect(redirectUriMatches(CLAUDE, 'https://claude.com/api/mcp/auth_callback')).toBe(false)
  })

  it('accepts only an address both allowed and registered', () => {
    expect(matchRegisteredRedirect([CLAUDE], CLAUDE)).toBe(CLAUDE)
    expect(matchRegisteredRedirect(['http://localhost:1/cb'], 'http://localhost:5/cb')).toBe('http://localhost:5/cb')
    expect(matchRegisteredRedirect([CLAUDE], 'https://claude.com/api/mcp/auth_callback')).toBeNull()
    expect(matchRegisteredRedirect(['https://evil.example/cb'], 'https://evil.example/cb')).toBeNull()
  })

  it('names the host a code goes back to, and whether it is this computer', () => {
    expect(describeRedirectTarget(CLAUDE)).toEqual({ host: 'claude.ai', local: false })
    expect(describeRedirectTarget('http://127.0.0.1:9/cb')).toEqual({ host: '127.0.0.1', local: true })
  })
})

describe('registration', () => {
  it('keeps a name and the addresses, and nothing else', () => {
    const result = validateClientRegistration({
      client_name: 'Claude',
      redirect_uris: [CLAUDE, CLAUDE],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['client_credentials'],
      jwks_uri: 'https://evil.example/jwks',
    })
    expect(result).toEqual({ ok: true, clientName: 'Claude', redirectUris: [CLAUDE] })
  })

  it('refuses an address off the list as invalid_redirect_uri', () => {
    expect(
      validateClientRegistration({ redirect_uris: [CLAUDE, 'https://evil.example/cb'] }),
    ).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateClientRegistration({ redirect_uris: [] })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateClientRegistration({})).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(
      validateClientRegistration({ redirect_uris: Array.from({ length: 6 }, (_, i) => `http://localhost/${i}`) }),
    ).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
  })

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', [], 3]) {
      expect(validateClientRegistration(body)).toMatchObject({ ok: false, error: 'invalid_client_metadata' })
    }
  })

  it('makes a name safe to show, and names the nameless', () => {
    expect(sanitizeClientName('  Claude\u0000‮ Code \n ')).toBe('Claude Code')
    expect(sanitizeClientName('x'.repeat(200))).toHaveLength(80)
    expect(sanitizeClientName(undefined)).toBe('Unnamed app')
    expect(sanitizeClientName('​')).toBe('Unnamed app')
  })
})

describe('access', () => {
  it('"View only" is every read scope, "View and make changes" is every scope', () => {
    expect(CONNECTOR_VIEW_SCOPES.every((scope) => scope.endsWith(':read'))).toBe(true)
    expect(scopesForAccess('view', null)).toEqual(CONNECTOR_VIEW_SCOPES)
    expect(scopesForAccess('change', null)).toEqual([...API_SCOPES])
  })

  it('narrows both to what the client asked for', () => {
    const asked = ['contacts:read', 'contacts:write'] as const
    expect(scopesForAccess('view', [...asked])).toEqual(['contacts:read'])
    expect(scopesForAccess('change', [...asked])).toEqual(['contacts:read', 'contacts:write'])
  })

  it('offers a choice only when it is a real one', () => {
    expect(connectorAccessOptions(null)).toEqual(['view', 'change'])
    expect(connectorAccessOptions(['contacts:read'])).toEqual(['view'])
    expect(connectorAccessOptions(['contacts:write'])).toEqual(['change'])
  })

  it('ignores unknown scopes, and refuses a request that names only unknown ones', () => {
    expect(parseRequestedScopes(undefined)).toEqual({ ok: true, scopes: null })
    expect(parseRequestedScopes('contacts:read offline_access')).toEqual({ ok: true, scopes: ['contacts:read'] })
    expect(parseRequestedScopes('openid profile')).toEqual({ ok: false })
  })

  it('describes every scope in plain words, grouped by area', () => {
    const described = describeConnectorAccess([...API_SCOPES])
    const abilities = described.flatMap((area) => area.abilities)
    expect(abilities).toHaveLength(API_SCOPES.length)
    // No customer-facing jargon.
    for (const words of [...abilities, ...described.map((area) => area.area)]) {
      expect(words).not.toMatch(/oauth|scope|token|grant|:read|:write/i)
    }
    expect(described[0].area).toBe('Datasets')
  })

  it('reads a set of scopes back as an access level', () => {
    expect(accessLevelOf(['contacts:read', 'sites:read'])).toBe('view')
    expect(accessLevelOf(['contacts:read', 'contacts:write'])).toBe('change')
  })
})

describe('the authorization request', () => {
  const client = { clientId: generateConnectorClientId(), clientName: 'Claude', redirectUris: [CLAUDE] }
  const good = {
    client_id: client.clientId,
    redirect_uri: CLAUDE,
    response_type: 'code',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'opaque-state-123',
  }
  const judge = (params: Record<string, string | undefined>, extra: { duplicated?: string[] } = {}) =>
    validateAuthorizeRequest(params, { origin: ORIGIN, client, ...extra })

  it('passes a good request and keeps everything a code is bound to', () => {
    expect(judge(good)).toEqual({
      kind: 'ok',
      request: {
        clientId: client.clientId,
        clientName: 'Claude',
        redirectUri: CLAUDE,
        codeChallenge: good.code_challenge,
        state: 'opaque-state-123',
        requestedScopes: null,
        resource: null,
      },
    })
  })

  it('never redirects for an unknown client or an unregistered address', () => {
    expect(validateAuthorizeRequest(good, { origin: ORIGIN, client: null })).toEqual({
      kind: 'fatal',
      reason: 'unknown_client',
    })
    expect(judge({ ...good, redirect_uri: 'https://evil.example/cb' })).toEqual({
      kind: 'fatal',
      reason: 'invalid_redirect_uri',
    })
    expect(judge({ ...good, redirect_uri: undefined })).toEqual({ kind: 'fatal', reason: 'invalid_redirect_uri' })
    expect(judge(good, { duplicated: ['redirect_uri'] })).toEqual({ kind: 'fatal', reason: 'invalid_redirect_uri' })
    expect(judge(good, { duplicated: ['client_id'] })).toEqual({ kind: 'fatal', reason: 'unknown_client' })
  })

  it.each([
    ['response_type', { response_type: 'token' }, 'unsupported_response_type'],
    ['no PKCE', { code_challenge: undefined }, 'invalid_request'],
    ['plain PKCE', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['a malformed challenge', { code_challenge: 'short' }, 'invalid_request'],
    ['only unknown scopes', { scope: 'openid' }, 'invalid_scope'],
    ['another resource', { resource: 'https://evil.example/api/mcp' }, 'invalid_target'],
  ])('redirects %s back with an error and the state untouched', (_label, change, error) => {
    expect(judge({ ...good, ...change })).toMatchObject({
      kind: 'redirect',
      redirectUri: CLAUDE,
      state: 'opaque-state-123',
      error,
    })
  })

  it('accepts this server’s own MCP endpoint as the resource', () => {
    expect(judge({ ...good, resource: `${ORIGIN}/api/mcp` })).toMatchObject({
      kind: 'ok',
      request: { resource: `${ORIGIN}/api/mcp` },
    })
  })

  it('refuses an over-long state without echoing it', () => {
    expect(judge({ ...good, state: 'x'.repeat(1025) })).toMatchObject({
      kind: 'redirect',
      state: null,
      error: 'invalid_request',
    })
  })

  it('builds the answer onto the address, keeping its own query and the state byte for byte', () => {
    const state = 'a b&c=d/é'
    const href = buildAuthorizeRedirect('http://localhost:9/cb?keep=1', { code: 'c', state, iss: ORIGIN, unused: null })
    const url = new URL(href)
    expect(url.searchParams.get('keep')).toBe('1')
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('iss')).toBe(ORIGIN)
    expect(url.searchParams.has('unused')).toBe(false)
  })
})

describe('discovery documents', () => {
  it('names the MCP endpoint as the resource and this origin as its one issuer', () => {
    expect(buildProtectedResourceMetadata(ORIGIN)).toEqual({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: [...API_SCOPES],
      bearer_methods_supported: ['header'],
    })
  })

  it('describes a PKCE-only public-client server with no metadata-document fetching', () => {
    const document = buildAuthorizationServerMetadata(ORIGIN)
    expect(document).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      revocation_endpoint: `${ORIGIN}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...API_SCOPES],
    })
    expect(document).not.toHaveProperty('client_id_metadata_document_supported')
  })
})

describe('readCappedBody', () => {
  it('reads a body under the cap and abandons one over it', async () => {
    const small = new Request('https://x', { method: 'POST', body: 'a=1' })
    expect(await readCappedBody(small, 10)).toBe('a=1')
    const big = new Request('https://x', { method: 'POST', body: 'x'.repeat(11) })
    expect(await readCappedBody(big, 10)).toBeNull()
  })

  it('trusts a declared length only to refuse early', async () => {
    const declared = new Request('https://x', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': '99999' },
    })
    expect(await readCappedBody(declared, 10)).toBeNull()
  })
})

it('hashes the way the store keys documents', () => {
  const token = generateConnectorAccessToken()
  expect(createHash('sha256').update(token).digest('hex')).toHaveLength(64)
})
