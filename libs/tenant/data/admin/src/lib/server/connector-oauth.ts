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
 * A person adds the MCP endpoint to an MCP client — Claude, ChatGPT, Cursor,
 * VS Code or any other — signs in to the console, picks a workspace and
 * allows it; the client then calls `/api/v1` through `/api/mcp` with a
 * credential nobody copied. This is OAuth 2.1 with PKCE, public clients
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
 *  - A code is useless without the PKCE verifier of the sign-in that asked
 *    for it, and goes only to an address the client registered under
 *    {@link CONNECTOR_REDIRECT_POLICY}. Registration is open to any client,
 *    so the CONSENT SCREEN is the control on who gets access: it shows what
 *    the app calls itself and, unmissably, where the code is going.
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
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { type PlatformHostInputs, platformHostInputs } from '@aglyn/aglyn/app-utils/first-party-hosts'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
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
 * A registration's life until it is first USED — until a person approves it
 * on the consent screen. Registration is open to anyone and its variety is
 * unbounded, so a client nobody ever approves is kept for a week, not for the
 * idle life above: long enough that a client which cached its id is not
 * dead-ended by a person who approves days later, and short enough that the
 * storage junk registrations hold is bounded by the creation rate times seven
 * days (see the register route).
 */
export const CONNECTOR_CLIENT_UNUSED_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
 * WHICH addresses a code may be delivered to. The one policy, for any MCP
 * client — Claude, ChatGPT, Cursor, VS Code, an inspector — that registers.
 *
 *  - `https://` on a real domain name: no IP literal, no trailing dot, no
 *    user info, no fragment. A web client's callback.
 *  - `http://` ONLY on loopback (`localhost`, `127.0.0.1`, `[::1]`), any
 *    port (RFC 8252 §7.3): how a native or desktop client receives a code on
 *    the person's own machine. The port is ignored when matching, since the
 *    client picks it at sign-in time.
 *  - An app-link callback ONLY when it is on
 *    {@link CONNECTOR_APP_CALLBACKS}, compared as the whole string. An open
 *    rule for private-use schemes cannot be made safe: the scheme decides
 *    which program the operating system hands the address to, and
 *    `ms-appinstaller:`, `itms-services:`, `x-safari-https:`,
 *    `shortcuts://run-shortcut`, or an editor's own install or clone link
 *    would all be launched from our origin with attacker-chosen arguments.
 *
 * Registration is open, so this policy is NOT what keeps a code out of the
 * wrong hands; PKCE binds a code to whoever started the sign-in, and the
 * consent screen shows the person exactly where they are being sent. What the
 * policy does guarantee is that every address is unambiguous: it must be in
 * the canonical form the URL parser prints, so the string checked here is the
 * string a browser navigates to and every later comparison is plain equality.
 */
export const CONNECTOR_REDIRECT_POLICY = Object.freeze({
  loopbackHosts: Object.freeze(['localhost', '127.0.0.1', '[::1]']),
})

/**
 * App-link callbacks a native client may register, each an EXACT address —
 * no query or path variation. An entry is added only on a client vendor's
 * request and against its own published documentation, because it names a
 * program the operating system will launch from our origin.
 *
 * Empty: no MCP client vendor's own documentation names an app-link OAuth
 * callback that could be verified for this list. Native clients use a
 * loopback address instead, which every major one supports.
 */
export const CONNECTOR_APP_CALLBACKS: readonly string[] = Object.freeze([])

/** Longest redirect address accepted, in characters. */
export const MAX_REDIRECT_URI_LENGTH = 512

/** A domain name as a person reads it: dotted labels and an alphabetic TLD. */
const DOMAIN_NAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * The hosts a person reads as THIS PLATFORM — its workspace domain and every
 * subdomain of it (the console, the auth origin, every workspace), the
 * configured console and docs hosts, the marketing home, and the tenant apex
 * and every site under it. A code may never be "sent to" one of them: the
 * consent screen would show an address the person trusts as ours, for a
 * client a stranger registered. Read from the same configuration the rest of
 * the platform reads (`platformHostInputs`, `TENANT_APEX`), never spelled.
 */
export function isPlatformHost(hostname: string, inputs: PlatformHostInputs = platformHostInputs()): boolean {
  const host = hostname.toLowerCase()
  const hostOfUrl = (value: string | null | undefined) => {
    try {
      return value ? new URL(value).hostname.toLowerCase() : ''
    } catch {
      return ''
    }
  }
  const apexes = [inputs.workspaceDomain, inputs.tenantDomain || TENANT_APEX]
    .map((value) => String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
  const home = hostOfUrl(inputs.homeUrl)
  const exact = [hostOfUrl(inputs.consoleUrl), hostOfUrl(inputs.docsUrl), home, home ? `www.${home.replace(/^www\./, '')}` : '']
    .filter(Boolean)
  return exact.includes(host) || apexes.some((apex) => host === apex || host.endsWith(`.${apex}`))
}

/** The kind of address, once it has passed the policy. */
type RedirectKind = 'web' | 'loopback' | 'app'

/** Classify `uri` under the policy, or `null` when a code may not go there. */
function classifyRedirect(uri: unknown): { kind: RedirectKind; url: URL } | null {
  if (typeof uri !== 'string' || !uri || uri.length > MAX_REDIRECT_URI_LENGTH) return null
  // Nothing a parser would silently drop or reinterpret: control characters,
  // whitespace, backslashes. The canonical-form check below would catch most;
  // refusing them first means none can reach it.
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000- \u007f-\u009f\\]/.test(uri)) return null
  if (uri.includes('#')) return null
  const url = parseUrl(uri)
  if (!url || url.href !== uri) return null
  if (url.username || url.password || url.hash) return null
  if (CONNECTOR_APP_CALLBACKS.includes(uri)) return { kind: 'app', url }
  if (url.protocol === 'https:') {
    if (!DOMAIN_NAME.test(url.hostname) || isPlatformHost(url.hostname)) return null
    return { kind: 'web', url }
  }
  if (url.protocol === 'http:') {
    if (!CONNECTOR_REDIRECT_POLICY.loopbackHosts.includes(url.hostname)) return null
    return { kind: 'loopback', url }
  }
  return null
}

/** May a code ever be delivered to `uri`? */
export function isAllowedRedirectUri(uri: unknown): uri is string {
  return classifyRedirect(uri) !== null
}

/**
 * Does the address presented at sign-in match one the client registered?
 *
 * Exact string match, with the one exception RFC 8252 §7.3 makes: two
 * loopback addresses that differ only in port are the same address.
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true
  const a = classifyRedirect(registered)
  const b = classifyRedirect(presented)
  if (a?.kind !== 'loopback' || b?.kind !== 'loopback') return false
  return a.url.hostname === b.url.hostname && a.url.pathname === b.url.pathname && a.url.search === b.url.search
}

/** `presented` when it is allowed AND registered by this client; otherwise `null`. */
export function matchRegisteredRedirect(
  registered: readonly string[],
  presented: unknown,
): string | null {
  if (!isAllowedRedirectUri(presented)) return null
  return registered.some((uri) => redirectUriMatches(uri, presented)) ? presented : null
}

/** Where a code goes, as the consent screen and Connected apps name it. */
export interface RedirectTarget {
  /** A website, an app link on the allowlist, or this computer. */
  kind: RedirectKind
  /**
   * One line naming it: the host (with its port when not the default) for a
   * website, the whole address for an app link, `this computer` for loopback.
   */
  label: string
  /** For a website: the host, in full. */
  host?: string
  /** For a website: the port, when the address names one. */
  port?: string
  /** For a website: the path and query the code is delivered to. */
  path?: string
}

/**
 * Where a code is being sent, in the terms a person can check, derived from
 * the address alone and never from anything the client says about itself.
 */
export function describeRedirectTarget(uri: string): RedirectTarget {
  const classified = classifyRedirect(uri)
  if (!classified) return { kind: 'web', label: '' }
  const { kind, url } = classified
  if (kind === 'loopback') return { kind, label: 'this computer' }
  if (kind === 'app') return { kind, label: url.href }
  return {
    kind,
    label: url.port ? `${url.hostname}:${url.port}` : url.hostname,
    host: url.hostname,
    ...(url.port ? { port: url.port } : {}),
    path: `${url.pathname}${url.search}`,
  }
}

// ── Registration (RFC 7591) ─────────────────────────────────────────────────

/** Largest registration body read, in bytes. A real one is a few hundred. */
export const MAX_REGISTRATION_BYTES = 8 * 1024
/** Most redirect addresses one registration may carry. */
export const MAX_REDIRECT_URIS = 5
/** Longest app name kept, in characters. */
export const MAX_CLIENT_NAME_LENGTH = 60
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
 * Code points that render as nothing — Braille blank, the Hangul fillers,
 * Mongolian vowel separator and the like — which would let a "name" be
 * empty to the eye while not empty to a test for emptiness.
 */
// eslint-disable-next-line no-misleading-character-class -- each code point is listed on its own, on purpose
const BLANK_RENDERING = /[\u{2800}\u{3164}\u{115F}\u{1160}\u{FFA0}\u{180E}\u{17B4}\u{17B5}\u{2061}-\u{2064}\u{34F}]/gu

/** Every quotation mark, so a name cannot open or close a quotation around itself. */
const QUOTES = /["'`«»‘-‟‹›❛-❞⹂〝-〟＂＇\p{Pi}\p{Pf}]/gu

/**
 * Cyrillic, Greek and Armenian letters that read as Latin ones, folded to the
 * Latin letter for the reserved-name test only (the name itself is never
 * rewritten). Enough to catch a whole-word look-alike of the brand in a
 * single non-Latin script; a name that MIXES Latin with Cyrillic or Greek is
 * refused outright by {@link mixesScripts}.
 */
const CONFUSABLE_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a', в: 'b', с: 'c', е: 'e', һ: 'h', і: 'i', ј: 'j', к: 'k', ӏ: 'l', м: 'm', н: 'h', о: 'o', р: 'p',
  ԛ: 'q', ѕ: 's', т: 't', у: 'y', х: 'x', ԍ: 'g', ԁ: 'd', ԝ: 'w', ь: 'b', ү: 'y', ո: 'n', ս: 'u', ց: 'g',
  հ: 'h', օ: 'o', α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u',
  χ: 'x', γ: 'y', ϲ: 'c', ϳ: 'j', ℓ: 'l',
}

/**
 * A name reduced to what it reads as: compatibility-folded, accents removed,
 * look-alike letters folded to Latin, lower-cased, and everything that is not
 * a letter or digit dropped — so `Aglyn's`, `A g l y n`, `AglynAI` and a
 * Cyrillic `Аglyn` all contain `aglyn`.
 */
function readsAs(value: string): string {
  return Array.from(value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase())
    .map((char) => CONFUSABLE_TO_LATIN[char] ?? char)
    .join('')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** The words a name may not contain anywhere: ours, and the neutral fallback. */
function reservedNameWords(): string[] {
  return [PLATFORM_BRAND_NAME, UNNAMED_CLIENT].map(readsAs).filter(Boolean)
}

/** True when a name mixes Latin letters with Cyrillic or Greek ones — a homoglyph's tell. */
function mixesScripts(name: string): boolean {
  const latin = /\p{Script=Latin}/u.test(name)
  return latin && (/\p{Script=Cyrillic}/u.test(name) || /\p{Script=Greek}/u.test(name))
}

/**
 * The display name, made safe to show (AGL-4225). It is self-asserted and
 * stays so; the consent screen shows it as the app's own label for itself,
 * under the address the code goes to, which is the part a person can check.
 *
 * NFKC-normalized (so full-width and compatibility forms read as their plain
 * letters), with controls, format characters (bidi overrides and isolates,
 * zero-width joiners), line breaks, private-use, unassigned and lone
 * surrogate code points, blank-rendering characters and every quotation mark
 * removed, stacked accents cut to two, whitespace collapsed and the length
 * capped. A name left with no letter or digit becomes {@link UNNAMED_CLIENT}.
 * Whether a name is ACCEPTABLE is {@link isReservedClientName}'s question.
 */
export function sanitizeClientName(value: unknown): string {
  return cleanClientName(value) || UNNAMED_CLIENT
}

/** {@link sanitizeClientName} without the fallback: `''` when nothing usable is left. */
function cleanClientName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .normalize('NFKC')
    // Default-ignorable code points — variation selectors (`A\uFE0Fglyn`,
    // `Ag\u{E0100}lyn`), Mongolian free variation selectors, joiners — are
    // invisible by definition, so they are removed rather than spaced.
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(BLANK_RENDERING, ' ')
    .replace(QUOTES, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  // Capped by code point, so the cap cannot split a surrogate pair.
  const capped = Array.from(cleaned).slice(0, MAX_CLIENT_NAME_LENGTH).join('').trim()
  return /[\p{L}\p{N}]/u.test(capped) ? capped : ''
}

/**
 * True when a sanitized name may not be registered: it mixes Latin letters
 * with Cyrillic or Greek ones, or what it reads as (`readsAs`) contains this
 * platform's brand name or the neutral fallback label ANYWHERE — `AglynAI`,
 * `Aglyn's Assistant`, `Unnamed app`. An app may not present itself as the
 * platform, nor as "no name".
 */
export function isReservedClientName(name: string): boolean {
  if (mixesScripts(name)) return true
  const folded = readsAs(name)
  return reservedNameWords().some((word) => folded.includes(word))
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
  // Addresses the policy refuses are DROPPED, not fatal, and the response
  // lists only what was kept (RFC 7591 §3.2.1 lets the server replace
  // metadata). A client such as Cursor registers an app link, a web callback
  // and a loopback address together and signs in at whichever is kept; the
  // registration fails only when nothing usable is left.
  const redirectUris: string[] = []
  for (const uri of uris) {
    if (isAllowedRedirectUri(uri) && !redirectUris.includes(uri)) redirectUris.push(uri)
  }
  if (!redirectUris.length) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description:
        'No redirect_uri is one this server delivers codes to: use https on a domain name, or http on a loopback address',
    }
  }
  // A name that cleans to nothing falls back to the neutral label; a name
  // that IS or contains our brand or that label is refused outright.
  const cleaned = cleanClientName(record.client_name)
  if (cleaned && isReservedClientName(cleaned)) {
    return {
      ok: false,
      error: 'invalid_client_metadata',
      description: 'client_name may not use this platform’s name or the name given to unnamed apps',
    }
  }
  return { ok: true, clientName: cleaned || UNNAMED_CLIENT, redirectUris }
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
/** The area a scope belongs to: `contacts` for `contacts:write`. */
const areaOf = (scope: string) => scope.slice(0, scope.indexOf(':'))

/**
 * The scopes an access level grants for what was requested (AGL-4225).
 *
 * "View only" is the `:read` scope of every AREA the client asked about —
 * a request for `contacts:write` alone still offers viewing contacts — or
 * every `:read` scope when it asked for nothing in particular. It never
 * depends on the client asking for reads, so a client cannot take the
 * choice away.
 *
 * "View and make changes" is what was asked for plus that view: a client
 * that may change contacts may also see them. Every `API_SCOPES` entry when
 * nothing in particular was asked for.
 */
export function scopesForAccess(
  level: ConnectorAccessLevel,
  requested: readonly ApiScope[] | null,
): ApiScope[] {
  if (!requested) return level === 'view' ? [...CONNECTOR_VIEW_SCOPES] : [...API_SCOPES]
  const areas = new Set(requested.map(areaOf))
  const view = CONNECTOR_VIEW_SCOPES.filter((scope) => areas.has(areaOf(scope)))
  if (level === 'view') return view
  return API_SCOPES.filter((scope) => view.includes(scope) || requested.includes(scope))
}

/**
 * Which choices the screen offers. "View only" ALWAYS, first, and it is the
 * default; "View and make changes" only when it would grant more.
 */
export function connectorAccessOptions(requested: readonly ApiScope[] | null): ConnectorAccessLevel[] {
  const view = scopesForAccess('view', requested)
  const change = scopesForAccess('change', requested)
  return change.length > view.length ? ['view', 'change'] : ['view']
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

/**
 * Optional human-facing members of the two discovery documents. Passed in
 * rather than derived, because the docs origin is the operator's
 * configuration and this layer does not read it.
 */
export interface ConnectorDiscoveryDocs {
  /** Where a developer reads how to connect (the docs page for sign-in). */
  documentationUrl?: string
  /** What the resource is called, for a client to show (RFC 9728 `resource_name`). */
  resourceName?: string
}

/**
 * RFC 9728: what the MCP endpoint is, and who issues credentials for it.
 *
 * `resource_name` and `resource_documentation` are RFC 9728 §2 members,
 * omitted rather than emitted empty when the caller has none.
 */
export function buildProtectedResourceMetadata(
  origin: string,
  docs: ConnectorDiscoveryDocs = {},
): Record<string, unknown> {
  return {
    resource: connectorResourceFor(origin),
    authorization_servers: [origin],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ['header'],
    ...(docs.resourceName ? { resource_name: docs.resourceName } : {}),
    ...(docs.documentationUrl ? { resource_documentation: docs.documentationUrl } : {}),
  }
}

/**
 * RFC 8414: how to sign in. No `client_id_metadata_document_supported`:
 * honouring a metadata document would mean fetching a URL a stranger chose,
 * from the server, on an unauthenticated request.
 */
export function buildAuthorizationServerMetadata(
  origin: string,
  docs: ConnectorDiscoveryDocs = {},
): Record<string, unknown> {
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
    // RFC 8414 §2: human-readable documentation for developers.
    ...(docs.documentationUrl ? { service_documentation: docs.documentationUrl } : {}),
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
