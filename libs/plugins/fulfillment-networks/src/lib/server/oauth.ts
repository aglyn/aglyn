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

import { PLATFORM_BRAND_NAME, platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { createHash, randomBytes } from 'node:crypto'
import { FULFILLMENT_NETWORKS_API_ROUTES } from '../constants'
import type { NetworkProviderId } from '../model/networks'
import { ProviderError, providerRequest, type ProviderHttp } from '../providers/http'
import type { AmazonApp, FulfillmentNetworksConfig, ShipbobApp } from './config'

/**
 * CONNECTING A NETWORK (AGL-3634): the merchant signs in at the network and
 * grants this deployment's app access; neither network has an API key a
 * merchant could paste instead.
 *
 * The state the browser carries is `{connectionId}.{nonce}`. The connection
 * document holds only the nonce's SHA-256, its expiry, who started it and
 * where to send them back; the callback compares, then clears it before
 * anything else, so a state is good once.
 *
 * - **ShipBob** (OpenID Connect): the consent page posts the code back as a
 *   form (`response_mode=form_post`); `offline_access` yields a refresh
 *   token, and an access token lasts an hour. The grant creates a channel
 *   named for the platform in the merchant's ShipBob account.
 * - **Amazon** (Selling Partner API website authorization): the seller
 *   consents in Seller Central, which redirects back with
 *   `spapi_oauth_code` and `selling_partner_id`; Login with Amazon trades the
 *   code for a refresh token that does not expire and hour-long access
 *   tokens.
 */

export const SHIPBOB_AUTH = {
  live: { authorize: 'https://auth.shipbob.com/connect/authorize', token: 'https://auth.shipbob.com/connect/token' },
  sandbox: {
    authorize: 'https://authstage.shipbob.com/connect/authorize',
    token: 'https://authstage.shipbob.com/connect/token',
  },
} as const

export const SHIPBOB_SCOPES = [
  'channels_read',
  'orders_read',
  'orders_write',
  'products_read',
  'inventory_read',
  'fulfillments_read',
  'webhooks_read',
  'webhooks_write',
  'offline_access',
].join(' ')

/** Login with Amazon's token endpoint, for every region. */
export const AMAZON_LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

/** Seller Central's consent page, per SP-API region. */
export const AMAZON_CONSENT_HOSTS = {
  na: 'https://sellercentral.amazon.com',
  eu: 'https://sellercentral-europe.amazon.com',
  fe: 'https://sellercentral.amazon.co.jp',
} as const

export const NETWORK_OAUTH_CALLBACK_PATH = `/api/${FULFILLMENT_NETWORKS_API_ROUTES.oauthCallback}`

/** The console address a path of this plugin answers on, or `null` when the deployment has none. */
export function consoleAddress(path: string, requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return `${url.origin}${path}`
      }
    } catch {
      // Not a URL: the canonical origin below.
    }
  }
  try {
    const url = new URL(platformConsoleOrigin())
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${path}` : null
  } catch {
    return null
  }
}

/** The redirect address registered on both apps. */
export const networkOAuthRedirectUri = (requestUrl: string): string | null =>
  consoleAddress(NETWORK_OAUTH_CALLBACK_PATH, requestUrl)

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const base64Url = (bytes: Buffer): string =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A fresh single-use secret: an OAuth nonce, or a webhook address token. */
export const newSecret = (): string => base64Url(randomBytes(24))

const STATE = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{16,64})$/

/** Splits a state the callback received, or `null` for one this module did not mint. */
export function readOAuthState(state: string | null): { connectionId: string; nonce: string } | null {
  const match = STATE.exec(String(state ?? ''))
  return match ? { connectionId: match[1], nonce: match[2] } : null
}

/** The network's consent page the member's browser is sent to. */
export function networkAuthorizeUrl(input: {
  provider: NetworkProviderId
  config: FulfillmentNetworksConfig
  redirectUri: string
  connectionId: string
  nonce: string
}): string {
  const state = `${input.connectionId}.${input.nonce}`
  if (input.provider === 'shipbob') {
    const app = input.config.shipbob as ShipbobApp
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: SHIPBOB_SCOPES,
      state,
      nonce: input.nonce,
      integration_name: PLATFORM_BRAND_NAME,
    })
    return `${(app.sandbox ? SHIPBOB_AUTH.sandbox : SHIPBOB_AUTH.live).authorize}?${params.toString()}`
  }
  const app = input.config.amazon as AmazonApp
  const params = new URLSearchParams({ application_id: app.applicationId, state, redirect_uri: input.redirectUri })
  if (app.draft) params.set('version', 'beta')
  return `${AMAZON_CONSENT_HOSTS[app.region]}/apps/authorize/consent?${params.toString()}`
}

/** What a code exchange or a refresh answers with. */
export interface NetworkGrant {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
}

async function tokenRequest(
  http: ProviderHttp,
  provider: NetworkProviderId,
  config: FulfillmentNetworksConfig,
  form: Record<string, string>,
  nowMs: number,
): Promise<NetworkGrant> {
  const app = provider === 'shipbob' ? config.shipbob : config.amazon
  if (!app) throw new ProviderError('auth', 'This deployment no longer has the app this connection was made with')
  const url =
    provider === 'shipbob' ? ((app as ShipbobApp).sandbox ? SHIPBOB_AUTH.sandbox : SHIPBOB_AUTH.live).token : AMAZON_LWA_TOKEN_URL
  const body = new URLSearchParams({ ...form, client_id: app.clientId, client_secret: app.clientSecret })
  const answer = await providerRequest(http, {
    provider: provider === 'shipbob' ? 'ShipBob' : 'Amazon',
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  const accessToken = typeof answer?.access_token === 'string' ? answer.access_token : ''
  if (!accessToken) throw new ProviderError('auth', 'The network did not issue an access token')
  const expiresIn = Number(answer?.expires_in)
  return {
    accessToken,
    refreshToken: typeof answer?.refresh_token === 'string' ? answer.refresh_token : null,
    expiresAtMs: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
  }
}

/** Trades the code the network sent back for a grant. */
export function exchangeNetworkCode(input: {
  http: ProviderHttp
  provider: NetworkProviderId
  config: FulfillmentNetworksConfig
  code: string
  redirectUri: string
  nowMs: number
}): Promise<NetworkGrant> {
  return tokenRequest(
    input.http,
    input.provider,
    input.config,
    { grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri },
    input.nowMs,
  )
}

/** Trades a refresh token for a fresh access token. */
export function refreshNetworkGrant(input: {
  http: ProviderHttp
  provider: NetworkProviderId
  config: FulfillmentNetworksConfig
  refreshToken: string
  nowMs: number
}): Promise<NetworkGrant> {
  return tokenRequest(
    input.http,
    input.provider,
    input.config,
    { grant_type: 'refresh_token', refresh_token: input.refreshToken },
    input.nowMs,
  )
}

/** A console path a member may be sent back to: same-origin and absolute, nothing else. */
export function safeReturnTo(value: unknown): string {
  const path = typeof value === 'string' ? value.trim() : ''
  return /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]{0,400}$/.test(path) && !path.includes('\\') ? path : '/'
}
