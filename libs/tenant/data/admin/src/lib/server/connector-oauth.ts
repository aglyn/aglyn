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

/**
 * CONNECTOR SIGN-IN, THE PURE HALF (AGL-4225).
 *
 * A person adds the MCP endpoint to Claude, signs in to the console, picks a
 * workspace and allows it; Claude then calls `/api/v1` through `/api/mcp` with
 * a credential nobody copied. This is OAuth 2.1 with PKCE, public clients
 * only, and everything in this file is a rule about it that needs no store:
 * which redirect addresses may receive a code, the PKCE check, what a
 * registration may carry, which access a person may choose, the shape of the
 * credentials and of the discovery documents.
 *
 * The storage half is `connector-oauth-store.ts`. The routes are thin and live
 * in the console under `app/api/oauth/*` and `app/oauth/authorize`.
 *
 * Two properties the whole design leans on, stated once:
 *
 *  - A code goes ONLY to an address on {@link CONNECTOR_REDIRECT_ALLOWLIST}.
 *    Registration is unauthenticated, so the client's own list is not a
 *    control; the allowlist is. A stranger can register a client, but the
 *    code it obtains can only be delivered to Claude or to the person's own
 *    machine.
 *  - No secret is stored. Codes, access and refresh tokens are kept as their
 *    SHA-256, the document id IS the hash (the `apiKeys` pattern), and the
 *    raw value exists only in the response that hands it out.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  CONNECTOR_AUTHORIZE_PATH,
  CONNECTOR_REGISTER_PATH,
  CONNECTOR_REVOKE_PATH,
  CONNECTOR_TOKEN_PATH,
  connectorResourceFor,
} from '@aglyn/aglyn/app-utils/connector-discovery'
import { API_SCOPES, type ApiScope, isApiScope, normalizeScopes } from './api-keys'

// ── Credentials ─────────────────────────────────────────────────────────────

/**
 * Hourly access token. Its own prefix, never `aglyn_sk_`: the docs and the
 * secret scanners know that one as a long-lived organization key, and a
 * scanner that finds one of these in a log should report a short-lived
 * credential, not a key to rotate.
 */
export const CONNECTOR_ACCESS_TOKEN_PREFIX = 'aglyn_at_'
/** Refresh token. Single use: every exchange returns a new one. */
export const CONNECTOR_REFRESH_TOKEN_PREFIX = 'aglyn_rt_'
/** Authorization code. Single use, minutes long. */
export const CONNECTOR_CODE_PREFIX = 'aglyn_ac_'
/** Public client id. Not a secret: it is sent in the clear on the consent URL. */
export const CONNECTOR_CLIENT_ID_PREFIX = 'aglyn_client_'
/**
 * A connection's public id — what Settings shows and Disconnect names, and
 * the `keyId` a connector's calls carry through `/api/v1`. Distinct from
 * `key_…` so a key id and a connection id can never be confused.
 */
export const CONNECTOR_GRANT_ID_PREFIX = 'grant_'

/** Access token life. Returned as `expires_in`. */
export const CONNECTOR_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
/**
 * Code life. Within OAuth 2.1's "short", and long enough for a slow redirect;
 * the person never sees it, because it is minted when they press Allow and
 * delivered by the same navigation.
 */
export const CONNECTOR_CODE_TTL_MS = 5 * 60 * 1000
/**
 * Refresh token life, SLIDING: each refresh issues a new token with a fresh
 * window. A connection used at least once in this window never asks the
 * person to sign in again; one left idle longer has to be connected afresh.
 */
export const CONNECTOR_REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
/**
 * An unused registration's life. Registration is unauthenticated, so a client
 * nobody uses must not live forever. Every code exchange and refresh pushes
 * it on in the same transaction that issues the refresh token, and it is a
 * day LONGER than a refresh token's life — so a client always outlives every
 * refresh token issued to it, by construction rather than by a later touch.
 */
export const CONNECTOR_CLIENT_IDLE_TTL_MS = CONNECTOR_REFRESH_TOKEN_TTL_MS + 24 * 60 * 60 * 1000

/**
 * How long a just-rotated refresh token may come back without ending the
 * connection. A client whose refresh answer was lost in transit retries with
 * the token it still holds; inside this window that retry is refused
 * (`invalid_grant`) and the connection survives. Later reuse still ends it,
 * because by then the token has been held by someone it should not have.
 */
export const CONNECTOR_REFRESH_REUSE_GRACE_MS = 30_000

/** Admin-SDK-only collections, deny-all in the rules. */
export const CONNECTOR_CLIENTS_COLLECTION = 'oauthClients'
export const CONNECTOR_CODES_COLLECTION = 'oauthCodes'
export const CONNECTOR_GRANTS_COLLECTION = 'oauthGrants'
export const CONNECTOR_ACCESS_TOKENS_COLLECTION = 'oauthAccessTokens'
export const CONNECTOR_REFRESH_TOKENS_COLLECTION = 'oauthRefreshTokens'

/** 32 random bytes, base64url, after the prefix: 43 characters exactly. */
const SECRET_BODY = /^[A-Za-z0-9_-]{43}$/

function generateSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

export const generateConnectorAccessToken = () => generateSecret(CONNECTOR_ACCESS_TOKEN_PREFIX)
export const generateConnectorRefreshToken = () => generateSecret(CONNECTOR_REFRESH_TOKEN_PREFIX)
export const generateConnectorCode = () => generateSecret(CONNECTOR_CODE_PREFIX)

/**
 * The client id for a registration, DERIVED from what it registers: the
 * display name and the redirect addresses, sorted. An identical registration
 * therefore gets the same id and the same document, so a client that
 * registers on every connect — Claude, from shared addresses — cannot grow
 * the store or spend a budget meant for strangers.
 *
 * Safe because a public client's id is not a secret and was never a proof of
 * who registered: every code and token is bound to PKCE and to its own
 * single-use secret, not to the id. It also means an id's name cannot be
 * changed after the fact: a different name is a different id. 132 bits of
 * SHA-256, in the same 22-character shape random ids had.
 */
export function deriveConnectorClientId(clientName: string, redirectUris: readonly string[]): string {
  const normalized = JSON.stringify(['v1', clientName, [...new Set(redirectUris)].sort()])
  return `${CONNECTOR_CLIENT_ID_PREFIX}${createHash('sha256').update(normalized, 'utf8').digest('base64url').slice(0, 22)}`
}

export function generateConnectorGrantId(): string {
  return `${CONNECTOR_GRANT_ID_PREFIX}${randomBytes(12).toString('base64url')}`
}

function hasSecretShape(token: unknown, prefix: string): token is string {
  return (
    typeof token === 'string' &&
    token.startsWith(prefix) &&
    SECRET_BODY.test(token.slice(prefix.length))
  )
}

/**
 * The cheap reject before a lookup, exactly as `isValidApiKeyFormat` is for a
 * key: a string that cannot be one of ours costs no read, and the pre-auth
 * budget charges only the lookups this lets through.
 */
export const isConnectorAccessTokenFormat = (token: unknown): token is string =>
  hasSecretShape(token, CONNECTOR_ACCESS_TOKEN_PREFIX)
export const isConnectorRefreshTokenFormat = (token: unknown): token is string =>
  hasSecretShape(token, CONNECTOR_REFRESH_TOKEN_PREFIX)
export const isConnectorCodeFormat = (token: unknown): token is string =>
  hasSecretShape(token, CONNECTOR_CODE_PREFIX)

export function isConnectorClientIdFormat(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(CONNECTOR_CLIENT_ID_PREFIX) &&
    /^[A-Za-z0-9_-]{22}$/.test(value.slice(CONNECTOR_CLIENT_ID_PREFIX.length))
  )
}

export function isConnectorGrantIdFormat(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(CONNECTOR_GRANT_ID_PREFIX) &&
    /^[A-Za-z0-9_-]{16}$/.test(value.slice(CONNECTOR_GRANT_ID_PREFIX.length))
  )
}

/** SHA-256 hex of a code or token: its document id, and the only form stored. */
export function hashConnectorSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/**
 * Equality that takes the same time whatever the inputs share.
 *
 * Both sides are hashed first so `timingSafeEqual` always compares two
 * 32-byte buffers — it throws on unequal lengths, and a length check in front
 * of it would itself leak the length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest()
  const right = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(left, right)
}

// ── PKCE (RFC 7636, S256 only) ──────────────────────────────────────────────

/** An S256 challenge is the base64url SHA-256 of the verifier: 43 characters. */
export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** RFC 7636 §4.1: 43–128 unreserved characters. */
export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value)
}

/** `BASE64URL(SHA256(ASCII(code_verifier)))`. */
export function pkceS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** True when `verifier` answers `challenge`. Malformed input is simply false. */
export function verifyPkceS256(verifier: unknown, challenge: unknown): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false
  return constantTimeEqual(pkceS256Challenge(verifier), challenge)
}

// ── Redirect addresses ──────────────────────────────────────────────────────

/**
 * EVERY address a code may be delivered to. The one list.
 *
 * `exact` entries are compared as whole strings. A loopback entry admits
 * `http://<host>[:<port>]/<path>` on the named hosts, which is how a desktop
 * client (Claude Code) receives a code on the person's own machine (RFC 8252
 * §7.3); the port is the client's to choose at sign-in time, so it is ignored
 * when an authorize request is matched against the registration.
 *
 * Adding a client to this list is a security decision, not a configuration
 * change: it names a party that will hold a credential into every workspace
 * whose member connects it.
 */
export const CONNECTOR_REDIRECT_ALLOWLIST = Object.freeze({
  exact: Object.freeze([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
  ]),
  loopbackHosts: Object.freeze(['localhost', '127.0.0.1']),
})

/** Longest redirect address accepted, in characters. */
export const MAX_REDIRECT_URI_LENGTH = 512

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** A loopback address on the allowlist, parsed; `null` for anything else. */
function parseLoopback(value: string): URL | null {
  const url = parseUrl(value)
  if (!url || url.protocol !== 'http:') return null
  if (!CONNECTOR_REDIRECT_ALLOWLIST.loopbackHosts.includes(url.hostname)) return null
  return url
}

/**
 * May a code ever be delivered to `uri`?
 *
 * The value must be in its CANONICAL form — exactly what the URL parser would
 * print — so every later comparison can be plain string equality and no
 * parser difference between us and a browser can make two spellings of one
 * address disagree. No fragment (RFC 6749 §3.1.2) and no user info.
 */
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || !uri || uri.length > MAX_REDIRECT_URI_LENGTH) return false
  if (CONNECTOR_REDIRECT_ALLOWLIST.exact.includes(uri)) return true
  const url = parseLoopback(uri)
  if (!url) return false
  if (url.href !== uri) return false
  if (url.hash || uri.includes('#')) return false
  if (url.username || url.password) return false
  return true
}

/**
 * Does the address presented at sign-in match one the client registered?
 *
 * Exact string match, with the one exception RFC 8252 §7.3 makes: two
 * loopback addresses that differ only in port are the same address.
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true
  const a = parseLoopback(registered)
  const b = parseLoopback(presented)
  if (!a || !b) return false
  return (
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    !a.hash &&
    !b.hash
  )
}

/** `presented` when it is allowed AND registered by this client; otherwise `null`. */
export function matchRegisteredRedirect(
  registered: readonly string[],
  presented: unknown,
): string | null {
  if (!isAllowedRedirectUri(presented)) return null
  return registered.some((uri) => redirectUriMatches(uri, presented)) ? presented : null
}

/**
 * Where a code is being sent, as a person reads it on the consent screen:
 * the host, and whether that host is this computer.
 */
export function describeRedirectTarget(uri: string): { host: string; local: boolean } {
  const url = parseUrl(uri)
  if (!url) return { host: '', local: false }
  return {
    host: url.hostname,
    local: CONNECTOR_REDIRECT_ALLOWLIST.loopbackHosts.includes(url.hostname),
  }
}

// ── Registration (RFC 7591) ─────────────────────────────────────────────────

/** Largest registration body read, in bytes. A real one is a few hundred. */
export const MAX_REGISTRATION_BYTES = 8 * 1024
/** Most redirect addresses one registration may carry. */
export const MAX_REDIRECT_URIS = 5
/** Longest app name kept, in characters. */
export const MAX_CLIENT_NAME_LENGTH = 80
/** Shown when a client registers without naming itself. */
export const UNNAMED_CLIENT = 'Unnamed app'

/**
 * Flat rather than a discriminated union: `strictNullChecks` is off repo-wide,
 * and narrowing on a boolean literal does not survive it.
 */
export interface RegistrationResult {
  ok: boolean
  clientName?: string
  redirectUris?: string[]
  error?: 'invalid_redirect_uri' | 'invalid_client_metadata'
  description?: string
}

/**
 * The display name, made safe to put on a consent screen: control and
 * formatting characters removed, whitespace collapsed, length capped. It is
 * self-asserted and stays so — the screen also names the host the code goes
 * back to, which is the part the allowlist makes true.
 */
export function sanitizeClientName(value: unknown): string {
  if (typeof value !== 'string') return UNNAMED_CLIENT
  const cleaned = value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CLIENT_NAME_LENGTH)
    .trim()
  return cleaned || UNNAMED_CLIENT
}

/**
 * Validate a registration request.
 *
 * Only two fields are kept: the name and the redirect addresses. Everything
 * else a client may ask for (`grant_types`, `response_types`,
 * `token_endpoint_auth_method`, a `scope`) is REPLACED with what this server
 * does, as RFC 7591 §3.2.1 allows, and the response says so — a client asking
 * for `client_secret_post` is told `none` rather than refused, because there
 * is no secret to issue and refusing would only stop a client that could
 * have worked.
 */
export function validateClientRegistration(body: unknown): RegistrationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_client_metadata', description: 'The body must be a JSON object' }
  }
  const record = body as Record<string, unknown>
  const uris = record.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris is required' }
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description: `At most ${MAX_REDIRECT_URIS} redirect_uris are accepted`,
    }
  }
  const redirectUris: string[] = []
  for (const uri of uris) {
    if (!isAllowedRedirectUri(uri)) {
      return {
        ok: false,
        error: 'invalid_redirect_uri',
        description: 'A redirect_uri is not one this server delivers codes to',
      }
    }
    if (!redirectUris.includes(uri)) redirectUris.push(uri)
  }
  return { ok: true, clientName: sanitizeClientName(record.client_name), redirectUris }
}

// ── Access ──────────────────────────────────────────────────────────────────

/** What a person chooses on the consent screen. */
export type ConnectorAccessLevel = 'view' | 'change'

/** Every `:read` scope, in `API_SCOPES` order: "View only". */
export const CONNECTOR_VIEW_SCOPES: readonly ApiScope[] = API_SCOPES.filter((scope) =>
  scope.endsWith(':read'),
)

/**
 * The scopes a client asked for, or `null` when it named none (no
 * narrowing).
 *
 * Unknown values are ignored rather than refused — RFC 6749 §3.3 lets the
 * server grant less than was asked, and a client that adds a value we do not
 * define should still be able to connect. A request that named scopes and
 * NONE of them are ours is refused, because granting anything then would be
 * granting what was not asked for.
 */
export function parseRequestedScopes(
  scope: unknown,
): { ok: true; scopes: ApiScope[] | null } | { ok: false } {
  if (scope === undefined || scope === null || scope === '') return { ok: true, scopes: null }
  if (typeof scope !== 'string' || scope.length > 2048) return { ok: false }
  const named = scope.split(' ').filter(Boolean)
  if (named.length === 0) return { ok: true, scopes: null }
  const known = normalizeScopes(named.filter(isApiScope))
  return known.length ? { ok: true, scopes: known } : { ok: false }
}

/** The scopes an access level grants, narrowed to what was requested. */
export function scopesForAccess(
  level: ConnectorAccessLevel,
  requested: readonly ApiScope[] | null,
): ApiScope[] {
  const base = level === 'view' ? CONNECTOR_VIEW_SCOPES : API_SCOPES
  return base.filter((scope) => !requested || requested.includes(scope))
}

/**
 * Which of the two choices the screen offers. "View and make changes" is
 * offered only when it would grant more than "View only"; "View only" only
 * when it would grant something.
 */
export function connectorAccessOptions(requested: readonly ApiScope[] | null): ConnectorAccessLevel[] {
  const view = scopesForAccess('view', requested)
  const change = scopesForAccess('change', requested)
  const options: ConnectorAccessLevel[] = []
  if (view.length) options.push('view')
  if (change.length > view.length) options.push('change')
  return options
}

/** The level a set of scopes amounts to, for the Connected apps list. */
export function accessLevelOf(scopes: readonly string[]): ConnectorAccessLevel {
  return scopes.every((scope) => scope.endsWith(':read')) ? 'view' : 'change'
}

/**
 * Every scope in plain words, grouped by area — what the consent screen says
 * an app will be able to do. A `Record` over `ApiScope`, so a scope added to
 * `API_SCOPES` without words here does not compile: a person must never be
 * asked to approve a power the screen does not describe.
 */
const SCOPE_WORDS: Record<ApiScope, { area: string; words: string }> = {
  'datasets:read': { area: 'Datasets', words: 'See your datasets and their records' },
  'datasets:write': { area: 'Datasets', words: 'Add, edit and delete datasets and their records' },
  'contacts:read': { area: 'Contacts', words: 'See your contacts' },
  'contacts:write': { area: 'Contacts', words: 'Add, edit, merge and delete contacts' },
  'sites:read': { area: 'Sites', words: 'See your sites' },
  'sites:publish': { area: 'Sites', words: 'Publish your sites, so changes show on the live pages right away' },
  'sites:write': { area: 'Sites', words: 'Create new sites' },
  'forms:read': { area: 'Form submissions', words: 'See your form submissions — what visitors sent through your forms' },
  'forms:write': { area: 'Form submissions', words: 'Mark form submissions read and delete them' },
  'orders:read': { area: 'Orders', words: 'See your store orders' },
  'orders:write': { area: 'Orders', words: 'Mark orders shipped and add tracking numbers' },
  'products:read': { area: 'Products', words: 'See your products, prices and stock' },
  'bookings:read': { area: 'Bookings', words: 'See your bookings' },
  'media:read': { area: 'Media', words: 'See your media files' },
  'media:write': { area: 'Media', words: 'Upload media files' },
  'crm:read': {
    area: 'CRM',
    words: 'See your companies, pipelines, deals, tasks, activities, leads and email templates',
  },
  'crm:write': {
    area: 'CRM',
    words:
      'Add, edit and delete companies, deals, tasks and email templates; log and delete activities; add, edit and convert leads',
  },
}

/** One scope in plain words, e.g. for a published description of the scopes. */
export function connectorScopeWords(scope: ApiScope): string {
  return SCOPE_WORDS[scope].words
}

export interface ConnectorAccessArea {
  area: string
  abilities: string[]
}

/** `scopes` as the consent screen lists them, in `API_SCOPES` order. */
export function describeConnectorAccess(scopes: readonly string[]): ConnectorAccessArea[] {
  const areas: ConnectorAccessArea[] = []
  for (const scope of API_SCOPES) {
    if (!scopes.includes(scope)) continue
    const { area, words } = SCOPE_WORDS[scope]
    const existing = areas.find((entry) => entry.area === area)
    if (existing) existing.abilities.push(words)
    else areas.push({ area, abilities: [words] })
  }
  return areas
}

// ── The authorization request ───────────────────────────────────────────────

/** Longest `state` accepted. It is returned untouched, so it is bounded. */
export const MAX_STATE_LENGTH = 1024

/** The parameters the consent page forwards, as received. */
export interface AuthorizeParams {
  readonly client_id?: string | null
  readonly redirect_uri?: string | null
  readonly response_type?: string | null
  readonly code_challenge?: string | null
  readonly code_challenge_method?: string | null
  readonly state?: string | null
  readonly scope?: string | null
  readonly resource?: string | null
}

export const AUTHORIZE_PARAM_NAMES = [
  'client_id',
  'redirect_uri',
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const

/** The registration an authorize request is checked against. */
export interface RegisteredConnectorClient {
  clientId: string
  clientName: string
  redirectUris: string[]
}

/** A request that passed: everything a code will be bound to. */
export interface ValidAuthorizeRequest {
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  requestedScopes: ApiScope[] | null
  resource: string | null
}

export type AuthorizeValidation =
  /** Shown on the page and NEVER redirected: the address is not trusted yet. */
  | { kind: 'fatal'; reason: 'unknown_client' | 'invalid_redirect_uri' | 'invalid_request' }
  /** Sent back to the (now trusted) redirect address with `error=`. */
  | { kind: 'redirect'; redirectUri: string; state: string | null; error: string; description: string }
  | { kind: 'ok'; request: ValidAuthorizeRequest }

/**
 * Check an authorization request, in the order RFC 6749 §4.1.2.1 requires.
 *
 * The client and the redirect address come FIRST and fail without a
 * redirect: until both are known good, sending the browser anywhere would
 * make this page an open redirector. Every later problem is reported to the
 * client at its own address, with `state` echoed so it can match the answer.
 *
 * `duplicated` names parameters that appeared more than once in the query,
 * which §3.1 forbids; a duplicated client id or address is fatal for the same
 * reason the missing ones are.
 */
export function validateAuthorizeRequest(
  params: AuthorizeParams,
  context: { origin: string; client: RegisteredConnectorClient | null; duplicated?: readonly string[] },
): AuthorizeValidation {
  const duplicated = new Set(context.duplicated ?? [])
  const client = context.client
  if (!client || duplicated.has('client_id') || params.client_id !== client.clientId) {
    return { kind: 'fatal', reason: 'unknown_client' }
  }
  if (duplicated.has('redirect_uri')) return { kind: 'fatal', reason: 'invalid_redirect_uri' }
  const redirectUri = matchRegisteredRedirect(client.redirectUris, params.redirect_uri)
  if (!redirectUri) return { kind: 'fatal', reason: 'invalid_redirect_uri' }

  const rawState = params.state ?? null
  const stateOk = rawState === null || (typeof rawState === 'string' && rawState.length <= MAX_STATE_LENGTH)
  // Returned exactly as sent — an empty `state=` comes back empty, not dropped.
  const state = stateOk ? rawState : null
  const refuse = (error: string, description: string): AuthorizeValidation => ({
    kind: 'redirect',
    redirectUri,
    state,
    error,
    description,
  })

  if (duplicated.size) return refuse('invalid_request', 'A parameter was sent more than once')
  if (!stateOk) return refuse('invalid_request', 'state is too long')
  if (params.response_type !== 'code') {
    return refuse('unsupported_response_type', 'Only response_type=code is supported')
  }
  if (params.code_challenge_method !== 'S256' || !isValidCodeChallenge(params.code_challenge)) {
    return refuse('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }
  const requested = parseRequestedScopes(params.scope)
  if (!requested.ok) return refuse('invalid_scope', 'None of the requested scopes exist')
  const resource = params.resource ?? null
  if (resource !== null && resource !== '' && resource !== connectorResourceFor(context.origin)) {
    return refuse('invalid_target', 'resource must be this server’s MCP endpoint')
  }

  return {
    kind: 'ok',
    request: {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      codeChallenge: params.code_challenge as string,
      state,
      requestedScopes: requested.scopes,
      resource: resource || null,
    },
  }
}

/**
 * The address the browser is sent to with the answer. Parameters are added
 * to whatever query the registered address already carries, `state` is
 * returned exactly as it arrived, and `iss` names this server (RFC 9207) so a
 * client talking to several cannot be handed a code meant for another.
 */
export function buildAuthorizeRedirect(
  redirectUri: string,
  answer: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(answer)) {
    if (value !== null && value !== undefined) url.searchParams.set(name, value)
  }
  return url.href
}

// ── Discovery documents ─────────────────────────────────────────────────────

/** RFC 9728: what the MCP endpoint is, and who issues credentials for it. */
export function buildProtectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: connectorResourceFor(origin),
    authorization_servers: [origin],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ['header'],
  }
}

/**
 * RFC 8414: how to sign in. No `client_id_metadata_document_supported`:
 * honouring a metadata document would mean fetching a URL a stranger chose,
 * from the server, on an unauthenticated request.
 */
export function buildAuthorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${CONNECTOR_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${CONNECTOR_TOKEN_PATH}`,
    registration_endpoint: `${origin}${CONNECTOR_REGISTER_PATH}`,
    revocation_endpoint: `${origin}${CONNECTOR_REVOKE_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...API_SCOPES],
    authorization_response_iss_parameter_supported: true,
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/**
 * CORS for the endpoints a browser-based client calls directly: discovery,
 * registration, token and revocation. Any origin, and nothing that would make
 * that dangerous — no credentials are allowed, so a browser never attaches a
 * cookie, and none of these endpoints reads one. The consent page and its
 * route are NOT on this list: they are the console's own.
 */
export const CONNECTOR_CORS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '600',
})

/** RFC 6749 §5.1: a response carrying a credential is never cached. */
export const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
})

/**
 * An OAuth error in the standard shape: `error`, and a description that
 * names the rule broken. Never a code, a token or a verifier — the
 * description is a constant chosen by the caller, not an echo of input.
 */
export function oauthErrorResponse(
  status: number,
  error: string,
  description?: string,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { ...NO_STORE_HEADERS, ...CONNECTOR_CORS_HEADERS, ...headers } },
  )
}

/**
 * Read at most `maxBytes` of a request body, or `null` when it is longer.
 *
 * Counted while streaming, so an oversized body is abandoned at the cap
 * rather than buffered whole first — a `Content-Length` header is a claim,
 * and a chunked body carries none.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}
