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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { createHash, randomBytes } from 'node:crypto'
import { MARKETING_PLATFORMS_API_ROUTES } from '../constants'
import type { MarketingProviderId } from '../model/connections'
import { ProviderError, providerRequest, type ProviderHttp } from '../providers/http'
import type { OAuthClient } from './config'

/**
 * OAUTH CONNECT, FOR A DEPLOYMENT THAT REGISTERED THE APPS (AGL-3639).
 *
 * Offered per provider only when its client id and secret are set (see
 * `config.ts`): Mailchimp and Klaviyo as an alternative to the merchant's own
 * API key, Attentive as the only way in. A merchant's API key needs none of
 * this.
 *
 * The state the browser carries is `{connectionId}.{nonce}`. The connection
 * document holds only the nonce's SHA-256, its expiry, who started it and
 * where to send them back; the callback compares, then clears it in the same
 * write that stores the grant, so a state is good once.
 *
 * - **Mailchimp** issues an access token that does not expire, and the
 *   account's API root is read from its metadata endpoint.
 * - **Klaviyo** requires PKCE and issues an hour-long access token with a
 *   refresh token, refreshed before each run that needs it.
 * - **Attentive** issues a token for the install.
 */

export interface OAuthEndpoints {
  authorize: string
  token: string
  /** Scopes asked for, space-separated, or `null` when the provider takes none. */
  scope: string | null
  pkce: boolean
}

export const OAUTH_ENDPOINTS: Readonly<Partial<Record<MarketingProviderId, OAuthEndpoints>>> = {
  mailchimp: {
    authorize: 'https://login.mailchimp.com/oauth2/authorize',
    token: 'https://login.mailchimp.com/oauth2/token',
    scope: null,
    pkce: false,
  },
  klaviyo: {
    authorize: 'https://www.klaviyo.com/oauth/authorize',
    token: 'https://a.klaviyo.com/oauth/token',
    scope: 'accounts:read lists:read lists:write profiles:read profiles:write subscriptions:read subscriptions:write events:write',
    pkce: true,
  },
  attentive: {
    authorize: 'https://ui.attentivemobile.com/integrations/oauth-install',
    token: 'https://api.attentivemobile.com/v1/authorization-codes/tokens',
    scope: 'subscriptions:write events:write ecommerce:write',
    pkce: false,
  },
}

/** Mailchimp's metadata endpoint: which data center a token's account lives in. */
export const MAILCHIMP_METADATA_URL = 'https://login.mailchimp.com/oauth2/metadata'

export const MARKETING_OAUTH_CALLBACK_PATH = `/api/${MARKETING_PLATFORMS_API_ROUTES.oauthCallback}`

/**
 * The redirect address registered on each app: the console's canonical
 * origin plus the callback route. A local request is sent back to itself
 * outside production, so a developer's own app registration works.
 */
export function marketingOAuthRedirectUri(requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return `${url.origin}${MARKETING_OAUTH_CALLBACK_PATH}`
      }
    } catch {
      // Not a URL: the canonical origin below.
    }
  }
  try {
    const url = new URL(platformConsoleOrigin())
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${MARKETING_OAUTH_CALLBACK_PATH}` : null
  } catch {
    return null
  }
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const base64Url = (bytes: Buffer): string => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A fresh nonce and, for a PKCE provider, a verifier. */
export function newOAuthSecrets(pkce: boolean): { nonce: string; verifier: string | null } {
  return { nonce: base64Url(randomBytes(24)), verifier: pkce ? base64Url(randomBytes(48)) : null }
}

/** The PKCE challenge for a verifier (S256). */
export const pkceChallenge = (verifier: string): string => base64Url(createHash('sha256').update(verifier).digest())

const STATE = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{16,64})$/

/** Splits a state the callback received, or `null` for one this module did not mint. */
export function readOAuthState(state: string | null): { connectionId: string; nonce: string } | null {
  const match = STATE.exec(String(state ?? ''))
  return match ? { connectionId: match[1], nonce: match[2] } : null
}

/** The consent page address the member's browser is sent to. */
export function authorizeUrl(input: {
  provider: MarketingProviderId
  client: OAuthClient
  redirectUri: string
  connectionId: string
  nonce: string
  verifier: string | null
}): string {
  const endpoints = OAUTH_ENDPOINTS[input.provider]
  if (!endpoints) throw new Error(`${input.provider} has no OAuth connect`)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.client.clientId,
    redirect_uri: input.redirectUri,
    state: `${input.connectionId}.${input.nonce}`,
  })
  if (endpoints.scope) params.set('scope', endpoints.scope)
  if (endpoints.pkce && input.verifier) {
    params.set('code_challenge_method', 'S256')
    params.set('code_challenge', pkceChallenge(input.verifier))
  }
  return `${endpoints.authorize}?${params.toString()}`
}

/** What a code exchange or a refresh answers with. */
export interface OAuthGrant {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
  /** The account's API root, for Mailchimp. */
  apiBase: string | null
  accountName: string | null
}

const PROVIDER_LABEL: Record<MarketingProviderId, string> = {
  mailchimp: 'Mailchimp',
  klaviyo: 'Klaviyo',
  omnisend: 'Omnisend',
  attentive: 'Attentive',
}

async function tokenRequest(
  http: ProviderHttp,
  provider: MarketingProviderId,
  client: OAuthClient,
  form: Record<string, string>,
  nowMs: number,
): Promise<OAuthGrant> {
  const endpoints = OAUTH_ENDPOINTS[provider]
  if (!endpoints) throw new ProviderError('invalid', `${PROVIDER_LABEL[provider]} has no OAuth connect`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }
  const body = new URLSearchParams(form)
  if (provider === 'klaviyo') {
    // Klaviyo authenticates the client with Basic; the others in the form.
    headers['Authorization'] = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`
  } else {
    body.set('client_id', client.clientId)
    body.set('client_secret', client.clientSecret)
  }
  const answer = await providerRequest(http, {
    provider: PROVIDER_LABEL[provider],
    method: 'POST',
    url: endpoints.token,
    headers,
    body: body.toString(),
  })
  const accessToken = typeof answer?.access_token === 'string' ? answer.access_token : ''
  if (!accessToken) throw new ProviderError('auth', `${PROVIDER_LABEL[provider]} did not issue an access token`)
  const expiresIn = Number(answer?.expires_in)
  return {
    accessToken,
    refreshToken: typeof answer?.refresh_token === 'string' ? answer.refresh_token : null,
    expiresAtMs: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
    apiBase: null,
    accountName: null,
  }
}

/** Exchanges the code the provider sent back for a grant. */
export async function exchangeOAuthCode(input: {
  http: ProviderHttp
  provider: MarketingProviderId
  client: OAuthClient
  code: string
  redirectUri: string
  verifier: string | null
  nowMs: number
}): Promise<OAuthGrant> {
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  }
  if (input.verifier) form['code_verifier'] = input.verifier
  const grant = await tokenRequest(input.http, input.provider, input.client, form, input.nowMs)
  if (input.provider === 'mailchimp') {
    const metadata = await providerRequest(input.http, {
      provider: 'Mailchimp',
      method: 'GET',
      url: MAILCHIMP_METADATA_URL,
      headers: { Authorization: `OAuth ${grant.accessToken}`, Accept: 'application/json' },
    })
    const endpoint = typeof metadata?.api_endpoint === 'string' ? metadata.api_endpoint : ''
    if (!/^https:\/\/[a-z]{2}\d{1,3}\.api\.mailchimp\.com$/.test(endpoint)) {
      throw new ProviderError('auth', 'Mailchimp did not say which data center the account is in')
    }
    grant.apiBase = `${endpoint}/3.0`
    grant.accountName = typeof metadata?.accountname === 'string' ? metadata.accountname : null
  }
  return grant
}

/** Trades a refresh token for a new grant (Klaviyo). */
export async function refreshOAuthGrant(input: {
  http: ProviderHttp
  provider: MarketingProviderId
  client: OAuthClient
  refreshToken: string
  nowMs: number
}): Promise<OAuthGrant> {
  return tokenRequest(
    input.http,
    input.provider,
    input.client,
    { grant_type: 'refresh_token', refresh_token: input.refreshToken },
    input.nowMs,
  )
}

/** A console path a member may be sent back to: same-origin and absolute, nothing else. */
export function safeReturnTo(value: unknown): string {
  const path = typeof value === 'string' ? value.trim() : ''
  return /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]{0,400}$/.test(path) && !path.includes('\\') ? path : '/'
}
