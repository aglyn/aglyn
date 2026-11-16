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
  CONNECTOR_APP_CALLBACKS,
  CONNECTOR_REDIRECT_POLICY,
  CONNECTOR_VIEW_SCOPES,
  connectorAccessOptions,
  constantTimeEqual,
  describeConnectorAccess,
  describeRedirectTarget,
  generateConnectorAccessToken,
  deriveConnectorClientId,
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
    expect(isConnectorClientIdFormat(deriveConnectorClientId('Claude', [CLAUDE]))).toBe(true)
    expect(isConnectorGrantIdFormat(generateConnectorGrantId())).toBe(true)
    expect(isConnectorGrantIdFormat('key_abcdefghijkl')).toBe(false)
  })

  it('derives a client id from the registration: same input, same id; anything different, a different one', () => {
    const local = 'http://localhost:33418/callback'
    const id = deriveConnectorClientId('Claude', [CLAUDE, local])
    expect(deriveConnectorClientId('Claude', [local, CLAUDE])).toBe(id)
    expect(deriveConnectorClientId('Claude', [CLAUDE, local, CLAUDE])).toBe(id)
    expect(deriveConnectorClientId('Claude Code', [CLAUDE, local])).not.toBe(id)
    expect(deriveConnectorClientId('Claude', [CLAUDE])).not.toBe(id)
    expect(deriveConnectorClientId('Claude', [CLAUDE, 'http://localhost:33419/callback'])).not.toBe(id)
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

describe('redirect addresses: the open policy', () => {
  it('is ONE policy: https domains, loopback hosts, and an exact app-callback list that starts empty', () => {
    expect(CONNECTOR_REDIRECT_POLICY.loopbackHosts).toEqual(['localhost', '127.0.0.1', '[::1]'])
    expect(CONNECTOR_APP_CALLBACKS).toEqual([])
  })

  it.each([
    // The second review's inputs: each launches a program, or reaches the
    // web through one, with arguments the registrant chose.
    ['Safari via x-safari-https', 'x-safari-https://evil.com/cb'],
    ['Chrome via googlechromes', 'googlechromes://evil.com/cb'],
    ['the Windows app installer', 'ms-appinstaller://?source=https://evil.com/app.msix'],
    ['an iOS enterprise install', 'itms-services://?action=download-manifest&url=https://evil.com/m.plist'],
    ['an SMB share', 'smb://evil.com/share'],
    ['a Shortcuts run', 'shortcuts://run-shortcut?name=x'],
    ['a VS Code clone link', 'vscode://vscode.git/clone?url=https://evil.com/repo.git'],
    ['a Cursor MCP install link', 'cursor://anysphere.cursor-deeplink/mcp/install?config=e30='],
    // Ordinary app links are refused too, until one is on the exact list.
    ['Cursor’s app-link callback', 'cursor://anysphere.cursor-mcp/oauth/callback'],
    ['a VS Code auth link', 'vscode://vscode.github-authentication/did-authenticate'],
    ['a reverse-domain scheme', 'com.example.app:/oauth2redirect'],
  ])('refuses the app link %s', (_label, uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false)
  })

  it.each([
    ['Claude', CLAUDE],
    ['ChatGPT-style web callback', 'https://chatgpt.com/connector_platform_oauth_redirect'],
    ['a web callback with a query', 'https://app.example.com/oauth/callback?client=1'],
    ['a deep domain', 'https://a.b.example.co.uk/cb'],
    ['a punycode domain', 'https://xn--bcher-kva.example/cb'],
    ['localhost with a port', 'http://localhost:33418/callback'],
    ['localhost without a port', 'http://localhost/callback'],
    ['127.0.0.1', 'http://127.0.0.1:8080/oauth/callback'],
    ['IPv6 loopback', 'http://[::1]:6274/oauth/callback'],
    ['Cursor’s loopback callback', 'http://localhost:8787/callback'],
    ['an https callback on a non-default port', 'https://app.example.com:8443/cb'],
  ])('admits %s', (_label, uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true)
  })

  it.each([
    // user info and authority confusion
    ['user info', 'https://user@example.com/cb'],
    ['user info hiding the real host', 'https://example.com@evil.example/cb'],
    ['a password', 'https://a:b@example.com/cb'],
    ['loopback with user info', 'http://user@localhost:3000/callback'],
    // fragments
    ['a fragment', `${CLAUDE}#x`],
    ['an empty fragment', `${CLAUDE}#`],
    ['loopback with a fragment', 'http://localhost:3000/callback#x'],
    // case and canonical form
    ['an upper-case host', 'https://Example.com/cb'],
    ['an upper-case scheme', 'HTTPS://example.com/cb'],
    ['an upper-case loopback', 'http://LOCALHOST:3000/callback'],
    ['a dot segment', 'https://example.com/a/../cb'],
    ['a default port spelled out', 'https://example.com:443/cb'],
    ['no path', 'https://example.com'],
    ['a loopback with no path', 'http://localhost:3000'],
    // trailing dots
    ['a trailing-dot host', 'https://example.com./cb'],
    ['a trailing-dot loopback', 'http://localhost./cb'],
    // IP literals, every spelling
    ['https on an IPv4 literal', 'https://93.184.216.34/cb'],
    ['https on loopback', 'https://127.0.0.1/cb'],
    ['https on an IPv6 literal', 'https://[2001:db8::1]/cb'],
    ['a hex IPv4', 'http://0x7f000001/cb'],
    ['an octal IPv4', 'http://0177.0.0.1/cb'],
    ['a short IPv4', 'http://127.1/cb'],
    ['an IPv4-mapped IPv6 loopback', 'http://[::ffff:127.0.0.1]/cb'],
    ['another 127/8 address', 'http://127.0.0.2/cb'],
    ['the unspecified address', 'http://0.0.0.0/cb'],
    // plain http off loopback, and look-alikes
    ['http on the web', 'http://example.com/cb'],
    ['http on a loopback look-alike', 'http://localhost.evil.example/callback'],
    ['http on a loopback prefix', 'http://127.0.0.1.evil.example/cb'],
    ['a bare name', 'https://intranet/cb'],
    ['a numeric TLD', 'https://example.123/cb'],
    // backslashes, control characters, whitespace
    ['a backslash authority', 'https:\\\\evil.example/cb'],
    ['a backslash in the path', 'https://example.com\\@evil.example/cb'],
    ['a tab', 'https://exam\tple.com/cb'],
    ['a newline', 'https://example.com/cb\n'],
    ['a carriage return', 'https://example.com/\rcb'],
    ['a NUL', 'https://example.com/cb\u0000'],
    ['a C1 control', 'https://example.com/cb\u0085'],
    ['a leading space', ' https://example.com/cb'],
    ['an inner space', 'https://example.com/c b'],
    // encoded characters in the authority
    ['an encoded host character', 'https://ex%61mple.com/cb'],
    ['an encoded dot', 'https://example%2Ecom/cb'],
    ['an encoded loopback', 'http://local%68ost/cb'],
    // dangerous and web-handled schemes, including nested
    ['javascript:', 'javascript:alert(1)'],
    ['javascript with slashes', 'javascript://example.com/%0Aalert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['file:', 'file:///etc/passwd'],
    ['blob:', 'blob:https://example.com/uuid'],
    ['about:', 'about:blank'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['ws:', 'ws://example.com/cb'],
    ['wss:', 'wss://example.com/cb'],
    ['ftp:', 'ftp://example.com/cb'],
    ['view-source:', 'view-source:https://example.com/'],
    ['intent:', 'intent://cb#Intent;scheme=x;end'],
    ['mailto:', 'mailto:someone@example.com'],
    ['an opaque app link carrying a scheme', 'myapp:javascript:alert(1)'],
    ['an opaque app link', 'myapp:cb'],
    ['a one-letter scheme', 'c://cb'],
    ['a scheme with an underscore', 'my_app://cb'],
    ['a scheme starting with a digit', '1app://cb'],
    // limits
    ['an absurd length', `https://example.com/${'a'.repeat(600)}`],
    ['nothing', ''],
    ['not a string', 42],
  ])('refuses %s', (_label, uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false)
  })

  it('matches exactly, except that a loopback port is the client’s to choose', () => {
    expect(redirectUriMatches(CLAUDE, CLAUDE)).toBe(true)
    expect(redirectUriMatches('http://localhost:1111/callback', 'http://localhost:2222/callback')).toBe(true)
    expect(redirectUriMatches('http://[::1]:1/cb', 'http://[::1]:2/cb')).toBe(true)
    expect(redirectUriMatches('http://localhost:1111/callback', 'http://localhost:1111/other')).toBe(false)
    expect(redirectUriMatches('http://localhost:1111/callback', 'http://127.0.0.1:1111/callback')).toBe(false)
    expect(redirectUriMatches('http://localhost/cb?a=1', 'http://localhost:9/cb?a=2')).toBe(false)
    expect(redirectUriMatches('https://example.com/cb', 'https://example.com:8443/cb')).toBe(false)
    expect(redirectUriMatches(CLAUDE, 'https://claude.com/api/mcp/auth_callback')).toBe(false)
  })

  it('accepts only an address both allowed and registered', () => {
    expect(matchRegisteredRedirect([CLAUDE], CLAUDE)).toBe(CLAUDE)
    expect(matchRegisteredRedirect(['http://localhost:1/cb'], 'http://localhost:5/cb')).toBe('http://localhost:5/cb')
    expect(matchRegisteredRedirect([CLAUDE], 'https://claude.com/api/mcp/auth_callback')).toBeNull()
    expect(matchRegisteredRedirect(['https://example.com/cb'], 'https://example.com/cb/')).toBeNull()
    // A registration can only ever hold allowed addresses, but the check holds anyway.
    expect(matchRegisteredRedirect(['javascript:alert(1)'], 'javascript:alert(1)')).toBeNull()
  })

  it('names the destination from the address alone: host, port and path; or this computer', () => {
    expect(describeRedirectTarget(CLAUDE)).toEqual({
      kind: 'web',
      label: 'claude.ai',
      host: 'claude.ai',
      path: '/api/mcp/auth_callback',
    })
    expect(describeRedirectTarget('https://login.bank.example.evil.com:8443/phish?step=2')).toEqual({
      kind: 'web',
      label: 'login.bank.example.evil.com:8443',
      host: 'login.bank.example.evil.com',
      port: '8443',
      path: '/phish?step=2',
    })
    expect(describeRedirectTarget('http://127.0.0.1:9/cb')).toEqual({ kind: 'loopback', label: 'this computer' })
    expect(describeRedirectTarget('http://[::1]:9/cb')).toEqual({ kind: 'loopback', label: 'this computer' })
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

  it('drops addresses the policy refuses and keeps the rest — Cursor’s three-address registration', () => {
    expect(
      validateClientRegistration({
        client_name: 'Cursor',
        redirect_uris: [
          'cursor://anysphere.cursor-mcp/oauth/callback',
          'https://cursor.com/agents/mcp/oauth/callback',
          'http://localhost:8787/callback',
        ],
      }),
    ).toEqual({
      ok: true,
      clientName: 'Cursor',
      redirectUris: ['https://cursor.com/agents/mcp/oauth/callback', 'http://localhost:8787/callback'],
    })
  })

  it('refuses a registration with no usable address as invalid_redirect_uri', () => {
    expect(
      validateClientRegistration({ redirect_uris: ['javascript:alert(1)', 'ms-appinstaller://?source=x'] }),
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

  it.each([
    ['the platform name', 'Aglyn'],
    ['the platform name in another case', 'AGLYN'],
    ['the platform name as a word', 'Official Aglyn Connector'],
    ['the platform name in full-width letters', '\uFF21\uFF47\uFF4C\uFF59\uFF4E Sync'],
    ['the neutral label', 'Unnamed app'],
    ['the neutral label among words', 'My unnamed app'],
  ])('refuses %s as an app name', (_label, name) => {
    expect(validateClientRegistration({ client_name: name, redirect_uris: [CLAUDE] })).toMatchObject({
      ok: false,
      error: 'invalid_client_metadata',
    })
  })

  it('does not refuse a name that only contains the platform name inside a word', () => {
    expect(validateClientRegistration({ client_name: 'Paglynx', redirect_uris: [CLAUDE] })).toMatchObject({ ok: true })
  })

  it.each([
    ['only punctuation', '!!! ---'],
    ['only Braille blanks', '\u2800\u2800\u2800'],
    ['only Hangul fillers', '\u3164\u115F\u1160\uFFA0'],
    ['only quotation marks', '“”«»‘’'],
    ['only zero-width characters', '\u200b\u200d\ufeff'],
  ])('falls back to the neutral label for a name of %s', (_label, name) => {
    expect(validateClientRegistration({ client_name: name, redirect_uris: [CLAUDE] })).toMatchObject({
      ok: true,
      clientName: 'Unnamed app',
    })
  })

  it('strips every quotation mark and NFKC-folds compatibility forms', () => {
    expect(sanitizeClientName('“Claude” «Pro» ‘x’ „y‟ "z" \'w\' `v`')).toBe('Claude Pro x y z w v')
    expect(sanitizeClientName('\uFF23\uFF55\uFF52\uFF53\uFF4F\uFF52')).toBe('Cursor')
    expect(sanitizeClientName('ﬁle tool')).toBe('file tool')
  })

  it('makes a name safe to show, and names the nameless', () => {
    expect(sanitizeClientName('  Claude\u0000‮ Code \n ')).toBe('Claude Code')
    expect(sanitizeClientName('x'.repeat(200))).toHaveLength(60)
    // Bidi overrides and isolates, zero-width characters, line breaks.
    expect(sanitizeClientName('Good‮App⁦x⁩')).toBe('Good App x')
    expect(sanitizeClientName('A​B‍C﻿D')).toBe('A B C D')
    expect(sanitizeClientName('Line one\nline two three')).toBe('Line one line two three')
    // Stacked combining marks are cut to two.
    expect(sanitizeClientName('q́̂̃̄̅')).toBe('q́̂')
    // The cap never splits a surrogate pair.
    expect(Array.from(sanitizeClientName('\u{20000}'.repeat(70)))).toHaveLength(60)
    // A name of pictures alone has no letter or digit to read.
    expect(sanitizeClientName('\u{1F600}\u{1F600}')).toBe('Unnamed app')
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

  it('narrows both to the areas the client asked about', () => {
    const asked = ['contacts:read', 'contacts:write'] as const
    expect(scopesForAccess('view', [...asked])).toEqual(['contacts:read'])
    expect(scopesForAccess('change', [...asked])).toEqual(['contacts:read', 'contacts:write'])
  })

  it('always offers "View only", first, however the request is written', () => {
    expect(connectorAccessOptions(null)).toEqual(['view', 'change'])
    expect(connectorAccessOptions(['contacts:read'])).toEqual(['view'])
    // The second review's input: a write-only request used to remove View only.
    expect(connectorAccessOptions(['contacts:write'])).toEqual(['view', 'change'])
    expect(scopesForAccess('view', ['contacts:write'])).toEqual(['contacts:read'])
    expect(scopesForAccess('change', ['contacts:write'])).toEqual(['contacts:read', 'contacts:write'])
    expect(scopesForAccess('view', ['crm:write', 'sites:publish'])).toEqual(['sites:read', 'crm:read'])
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
  const client = { clientId: deriveConnectorClientId('Claude', [CLAUDE]), clientName: 'Claude', redirectUris: [CLAUDE] }
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
