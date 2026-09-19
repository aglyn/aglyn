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

import { createHash } from 'node:crypto'
import { GmailTransportError, tokenEndpointError } from './gmail-errors'
import { fetchWithBackoff, type TransportDeps } from './http'

/**
 * GOOGLE'S OAUTH ENDPOINTS, AS OUTREACH USES THEM (AGL-2978).
 *
 * Fetch-based, with no `googleapis` dependency: four endpoints and one ID
 * token do not justify a client library's size, and a dependency that talks
 * to Google is one more thing the egress register has to account for.
 *
 * Nothing here reads configuration. The client id and secret, the redirect
 * address and the tokens are all handed in, so this module is as testable
 * with a fake `fetch` as it is safe to import.
 */

export const GOOGLE_OAUTH_ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
} as const

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/**
 * What a mailbox grant asks for.
 *
 * `openid` and `email` identify the account. `gmail.send` sends as the rep.
 * `gmail.readonly` reads the replies and bounces a sequence stops on —
 * `gmail.metadata` would read headers but refuses the `q` search the bounce
 * detection needs.
 */
export const OUTREACH_GOOGLE_SCOPES = [
  'openid',
  'email',
  GMAIL_SEND_SCOPE,
  GMAIL_READONLY_SCOPE,
] as const

/** The two scopes a grant is useless without; `openid`/`email` come back renamed. */
export const OUTREACH_REQUIRED_GRANTED_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE] as const

/** The issuers Google signs ID tokens as. */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

/** The PKCE S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/**
 * The consent address a rep's browser is sent to.
 *
 * `access_type=offline` and `prompt=consent` together are what make Google
 * issue a refresh token on EVERY connect, including a reconnect — without
 * `prompt=consent` a second grant for the same account comes back with an
 * access token only, and the mailbox could not send an hour later.
 */
export function buildGoogleAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  nonce: string
  loginHint?: string | null
}): string {
  const url = new URL(GOOGLE_OAUTH_ENDPOINTS.authorize)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', OUTREACH_GOOGLE_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'false')
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
  return url.toString()
}

/** What the token endpoint answers for a code or a refresh. */
export interface GoogleTokenResponse {
  accessToken: string
  expiresInSeconds: number
  /** Only on a code exchange, and only when Google chose to issue one. */
  refreshToken: string | null
  /** Space-separated, as granted — which may be less than requested. */
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

function readTokenResponse(body: unknown): GoogleTokenResponse {
  const record = (body ?? {}) as Record<string, unknown>
  const accessToken = typeof record['access_token'] === 'string' ? record['access_token'] : ''
  if (!accessToken) {
    throw new GmailTransportError('unexpected', 'Google’s token endpoint answered without an access token.')
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
 * Exchanges an authorization code, with its PKCE verifier.
 *
 * ONE attempt, whatever the caller's policy: a code is single-use, so a retry
 * after an answer that was lost in transit is refused as `invalid_grant` and
 * reads as a dead grant. A failed connect is one click to start again.
 */
export async function exchangeGoogleAuthorizationCode(
  input: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
    codeVerifier: string
  },
  deps: TransportDeps = {},
): Promise<GoogleTokenResponse> {
  const { status, body } = await postForm(
    GOOGLE_OAUTH_ENDPOINTS.token,
    {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    { ...deps, maxAttempts: 1 },
  )
  if (status !== 200) throw tokenEndpointError(status, body)
  return readTokenResponse(body)
}

/** Mints an access token from a refresh token. */
export async function refreshGoogleAccessToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  deps: TransportDeps = {},
): Promise<GoogleTokenResponse> {
  const { status, body } = await postForm(
    GOOGLE_OAUTH_ENDPOINTS.token,
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    },
    deps,
  )
  if (status !== 200) throw tokenEndpointError(status, body)
  return readTokenResponse(body)
}

/**
 * Revokes a token at Google.
 *
 * Revoking a refresh token ends the whole grant — every token Google issued
 * this client for the account — which is what a disconnect means, and why a
 * RECONNECT must never revoke the token it replaces: the new one belongs to
 * the same grant and would die with it.
 *
 * `already-invalid` when Google says the token was already dead, which is
 * the outcome a disconnect wanted all along.
 */
export async function revokeGoogleToken(
  token: string,
  deps: TransportDeps = {},
): Promise<'revoked' | 'already-invalid'> {
  const { status, body } = await postForm(GOOGLE_OAUTH_ENDPOINTS.revoke, { token }, deps)
  if (status === 200) return 'revoked'
  const reason = (body as { error?: unknown } | null)?.error
  if (status === 400 && (reason === 'invalid_token' || reason === 'invalid_grant')) {
    return 'already-invalid'
  }
  throw tokenEndpointError(status, body)
}

/** Whether a granted scope string carries every scope in `required`. */
export function grantedScopesInclude(scope: string, required: readonly string[]): boolean {
  const granted = new Set(String(scope ?? '').split(/\s+/).filter(Boolean))
  return required.every((entry) => granted.has(entry))
}

/** The ID token claims Outreach relies on. */
export interface GoogleIdentity {
  /** Google's stable account id. */
  sub: string
  email: string
}

export type GoogleIdTokenRefusal =
  | 'malformed'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'nonce'
  | 'email-unverified'

/**
 * The identity an ID token asserts, after the checks OpenID Connect requires
 * of a token that arrived from the token endpoint itself.
 *
 * The signature is not re-verified here, on OIDC Core §3.1.3.7's allowance:
 * the token was read off Google's own TLS response to our server's code
 * exchange, never off a browser, so the channel authenticates it. What still
 * has to be checked is that it is ABOUT this exchange: Google issued it
 * (`iss`), to this client (`aud`, and `azp` when there are several
 * audiences), it has not expired, it carries the nonce this connect minted,
 * and the address is one Google verified.
 */
export function readGoogleIdToken(
  idToken: string | null | undefined,
  expected: { clientId: string; nonce: string; nowMs: number },
): { ok: true; identity: GoogleIdentity } | { ok: false; refusal: GoogleIdTokenRefusal } {
  const parts = typeof idToken === 'string' ? idToken.split('.') : []
  if (parts.length !== 3) return { ok: false, refusal: 'malformed' }
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return { ok: false, refusal: 'malformed' }
  }
  if (!claims || typeof claims !== 'object') return { ok: false, refusal: 'malformed' }
  if (!GOOGLE_ISSUERS.has(String(claims['iss']))) return { ok: false, refusal: 'issuer' }
  const audience = claims['aud']
  const audiences = Array.isArray(audience) ? audience.map(String) : [String(audience)]
  if (!audiences.includes(expected.clientId)) return { ok: false, refusal: 'audience' }
  if (audiences.length > 1 && claims['azp'] !== expected.clientId) {
    return { ok: false, refusal: 'audience' }
  }
  const exp = Number(claims['exp'])
  if (!Number.isFinite(exp) || exp * 1000 <= expected.nowMs) return { ok: false, refusal: 'expired' }
  if (typeof claims['nonce'] !== 'string' || claims['nonce'] !== expected.nonce) {
    return { ok: false, refusal: 'nonce' }
  }
  const verified = claims['email_verified']
  if (verified !== true && verified !== 'true') return { ok: false, refusal: 'email-unverified' }
  const sub = typeof claims['sub'] === 'string' ? claims['sub'] : ''
  const email = typeof claims['email'] === 'string' ? claims['email'].trim().toLowerCase() : ''
  if (!sub || !email) return { ok: false, refusal: 'malformed' }
  return { ok: true, identity: { sub, email } }
}
