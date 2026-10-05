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

import { GmailTransportError } from './gmail-errors'
import { fetchWithBackoff, type TransportDeps } from './http'
import { microsoftTokenEndpointError } from './microsoft-errors'

/**
 * MICROSOFT'S IDENTITY PLATFORM, AS OUTREACH USES IT (AGL-3489).
 *
 * The authorization code flow with PKCE against a Microsoft Entra app
 * registration, for a Microsoft 365 (Exchange Online) mailbox. Fetch-based
 * and configuration-free like `google-oauth.ts`: the client id and secret,
 * the tenant, the redirect address and the tokens are all handed in.
 *
 * Delegated permissions, all of them consented by the rep on the consent
 * screen (or for the tenant by its administrator):
 *
 * - `Mail.Send` — sends as the rep.
 * - `Mail.ReadWrite` — reads the replies and bounces a sequence stops on,
 *   and writes the draft a step is sent from, which is what gives a send
 *   the ids the next step and the sync need.
 * - `User.Read` — the account's address and id, at connect.
 * - `offline_access` — the refresh token the runtime sends with later.
 * - `openid`, `email`, `profile` — the ID token naming the account.
 *
 * Microsoft has no endpoint that revokes one app's refresh token: a grant
 * ends when the rep or the tenant administrator removes the app, or the
 * token goes unused for its lifetime. Disconnecting deletes the stored
 * grant, and says so.
 */

export const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com'
export const MICROSOFT_GRAPH_RESOURCE = 'https://graph.microsoft.com'

export const GRAPH_MAIL_SEND_SCOPE = `${MICROSOFT_GRAPH_RESOURCE}/Mail.Send`
export const GRAPH_MAIL_READWRITE_SCOPE = `${MICROSOFT_GRAPH_RESOURCE}/Mail.ReadWrite`
export const GRAPH_USER_READ_SCOPE = `${MICROSOFT_GRAPH_RESOURCE}/User.Read`

/** What a Microsoft mailbox grant asks for. See the module comment. */
export const OUTREACH_MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  GRAPH_USER_READ_SCOPE,
  GRAPH_MAIL_SEND_SCOPE,
  GRAPH_MAIL_READWRITE_SCOPE,
] as const

/** The permissions a grant is useless without, by their short names. */
export const OUTREACH_MICROSOFT_REQUIRED_SCOPES = ['mail.send', 'mail.readwrite'] as const

/**
 * The tenant segment of the endpoints: `common` (any work, school or
 * personal account), `organizations` (work and school only), or one tenant's
 * id or domain. Anything else is not a tenant this module will address.
 */
export function isMicrosoftTenant(value: string): boolean {
  return /^(common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i.test(
    value,
  )
}

export function microsoftOAuthEndpoints(tenant: string): { authorize: string; token: string } {
  const base = `${MICROSOFT_LOGIN_ORIGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0`
  return { authorize: `${base}/authorize`, token: `${base}/token` }
}

/**
 * The consent address a rep's browser is sent to. `prompt=select_account`
 * lets a rep signed in to several Microsoft accounts choose the mailbox's;
 * Microsoft issues a refresh token on every code exchange that asked for
 * `offline_access`, so no consent prompt is forced.
 */
export function buildMicrosoftAuthorizationUrl(input: {
  clientId: string
  tenant: string
  redirectUri: string
  state: string
  codeChallenge: string
  nonce: string
  loginHint?: string | null
}): string {
  const url = new URL(microsoftOAuthEndpoints(input.tenant).authorize)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', OUTREACH_MICROSOFT_SCOPES.join(' '))
  url.searchParams.set('prompt', 'select_account')
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
  return url.toString()
}

export interface MicrosoftTokenResponse {
  accessToken: string
  expiresInSeconds: number
  /**
   * Issued on a code exchange, and again on most refreshes: Microsoft
   * rotates refresh tokens, and the newest one is the one to keep.
   */
  refreshToken: string | null
  /** Space-separated, as granted. */
  scope: string
  idToken: string | null
}

async function postForm(
  url: string,
  form: Record<string, string>,
  deps: TransportDeps,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchWithBackoff(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    },
    deps,
  )
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

function readTokenResponse(body: unknown): MicrosoftTokenResponse {
  const record = (body ?? {}) as Record<string, unknown>
  const accessToken = typeof record['access_token'] === 'string' ? record['access_token'] : ''
  if (!accessToken) {
    throw new GmailTransportError('unexpected', 'Microsoft’s token endpoint answered without an access token.')
  }
  const expires = Number(record['expires_in'])
  return {
    accessToken,
    expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : 3600,
    refreshToken: typeof record['refresh_token'] === 'string' && record['refresh_token'] ? record['refresh_token'] : null,
    scope: typeof record['scope'] === 'string' ? record['scope'] : '',
    idToken: typeof record['id_token'] === 'string' && record['id_token'] ? record['id_token'] : null,
  }
}

/**
 * Exchanges an authorization code with its PKCE verifier. One attempt: a
 * code is single-use, as at Google.
 */
export async function exchangeMicrosoftAuthorizationCode(
  input: {
    clientId: string
    clientSecret: string
    tenant: string
    code: string
    redirectUri: string
    codeVerifier: string
  },
  deps: TransportDeps = {},
): Promise<MicrosoftTokenResponse> {
  const { status, body } = await postForm(
    microsoftOAuthEndpoints(input.tenant).token,
    {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      scope: OUTREACH_MICROSOFT_SCOPES.join(' '),
    },
    { ...deps, maxAttempts: 1 },
  )
  if (status !== 200) throw microsoftTokenEndpointError(status, body)
  return readTokenResponse(body)
}

/** Mints an access token for Graph from a refresh token. */
export async function refreshMicrosoftAccessToken(
  input: { clientId: string; clientSecret: string; tenant: string; refreshToken: string },
  deps: TransportDeps = {},
): Promise<MicrosoftTokenResponse> {
  const { status, body } = await postForm(
    microsoftOAuthEndpoints(input.tenant).token,
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      scope: OUTREACH_MICROSOFT_SCOPES.join(' '),
    },
    deps,
  )
  if (status !== 200) throw microsoftTokenEndpointError(status, body)
  return readTokenResponse(body)
}

/**
 * Whether a granted scope string carries every permission Sequences needs.
 * Microsoft lists Graph permissions by their short names (`Mail.Send`) or in
 * full (`https://graph.microsoft.com/Mail.Send`), and either counts.
 */
export function microsoftScopesInclude(scope: string, required: readonly string[] = OUTREACH_MICROSOFT_REQUIRED_SCOPES): boolean {
  const granted = new Set(
    String(scope ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((entry) => entry.replace(`${MICROSOFT_GRAPH_RESOURCE}/`, '').toLowerCase()),
  )
  return required.every((entry) => granted.has(entry.toLowerCase()))
}

/** The ID token claims Outreach relies on. */
export interface MicrosoftIdentity {
  /** `<tid>:<oid>` — the account's stable id, unique across tenants. */
  sub: string
  /** The directory object id: what Graph's `/me` answers as `id`. */
  oid: string
  tid: string
  /** The sign-in name, lowercased; the mailbox address comes from Graph. */
  username: string
}

export type MicrosoftIdTokenRefusal = 'malformed' | 'issuer' | 'audience' | 'expired' | 'nonce'

const ISSUER = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/i

/**
 * The identity an ID token asserts, after the checks OpenID Connect requires
 * of a token read off the token endpoint's own TLS response (OIDC Core
 * §3.1.3.7, as for Google): issued by Microsoft for the tenant it names, to
 * this app, unexpired, and carrying this connect's nonce.
 */
export function readMicrosoftIdToken(
  idToken: string | null | undefined,
  expected: { clientId: string; nonce: string; nowMs: number },
): { ok: true; identity: MicrosoftIdentity } | { ok: false; refusal: MicrosoftIdTokenRefusal } {
  const parts = typeof idToken === 'string' ? idToken.split('.') : []
  if (parts.length !== 3) return { ok: false, refusal: 'malformed' }
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return { ok: false, refusal: 'malformed' }
  }
  if (!claims || typeof claims !== 'object') return { ok: false, refusal: 'malformed' }
  const tid = typeof claims['tid'] === 'string' ? claims['tid'].toLowerCase() : ''
  const issuer = ISSUER.exec(String(claims['iss'] ?? ''))
  if (!issuer || !tid || issuer[1].toLowerCase() !== tid) return { ok: false, refusal: 'issuer' }
  if (claims['aud'] !== expected.clientId) return { ok: false, refusal: 'audience' }
  const exp = Number(claims['exp'])
  if (!Number.isFinite(exp) || exp * 1000 <= expected.nowMs) return { ok: false, refusal: 'expired' }
  if (typeof claims['nonce'] !== 'string' || claims['nonce'] !== expected.nonce) {
    return { ok: false, refusal: 'nonce' }
  }
  const oid = typeof claims['oid'] === 'string' ? claims['oid'].toLowerCase() : ''
  const username = String(claims['preferred_username'] ?? claims['email'] ?? '').trim().toLowerCase()
  if (!oid) return { ok: false, refusal: 'malformed' }
  return { ok: true, identity: { sub: `${tid}:${oid}`, oid, tid, username } }
}
