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
import { INVENTORY_SYNC_API_ROUTES } from '../constants'
import { BRIGHTPEARL_OAUTH_BASE, safeApiDomain } from '../providers/brightpearl'
import { ProviderError, providerRequest, type ProviderHttp } from '../providers/http'
import type { BrightpearlAppConfig } from './config'

/**
 * CONNECTING BRIGHTPEARL (AGL-3642): the merchant names their Brightpearl
 * account code, signs in at Brightpearl and grants this deployment's app
 * access. The grant answers the account's own datacenter (`api_domain`),
 * an access token that lasts a week and a refresh token.
 *
 * The state the browser carries is `{connectionId}.{nonce}`. The connection
 * document holds only the nonce's SHA-256, its expiry, who started it, the
 * account code and where to send them back; the callback compares, then
 * clears it before anything else, so a state is good once.
 */

export const INVENTORY_OAUTH_CALLBACK_PATH = `/api/${INVENTORY_SYNC_API_ROUTES.oauthCallback}`

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

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const base64Url = (bytes: Buffer): string =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A fresh single-use secret for an OAuth state. */
export const newSecret = (): string => base64Url(randomBytes(24))

const STATE = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{16,64})$/

/** Splits a state the callback received, or `null` for one this module did not mint. */
export function readOAuthState(state: string | null): { connectionId: string; nonce: string } | null {
  const match = STATE.exec(String(state ?? ''))
  return match ? { connectionId: match[1], nonce: match[2] } : null
}

/** A Brightpearl account code as the merchant types it: letters, digits, hyphens. */
export function readAccountCode(value: unknown): string | null {
  const code = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(code) ? code : null
}

/** Brightpearl's consent page for one account. */
export function brightpearlAuthorizeUrl(input: {
  app: BrightpearlAppConfig
  accountCode: string
  redirectUri: string
  connectionId: string
  nonce: string
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.app.appRef,
    redirect_uri: input.redirectUri,
    state: `${input.connectionId}.${input.nonce}`,
  })
  return `${BRIGHTPEARL_OAUTH_BASE}/authorize/${encodeURIComponent(input.accountCode)}?${params.toString()}`
}

/** What a code exchange or a refresh answers with. */
export interface BrightpearlGrant {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
  apiDomain: string
}

async function tokenRequest(
  http: ProviderHttp,
  app: BrightpearlAppConfig,
  accountCode: string,
  form: Record<string, string>,
  nowMs: number,
): Promise<BrightpearlGrant> {
  const body = new URLSearchParams({
    ...form,
    client_id: app.appRef,
    ...(app.clientSecret ? { client_secret: app.clientSecret } : {}),
  })
  const answer = await providerRequest(http, {
    provider: 'Brightpearl',
    method: 'POST',
    url: `${BRIGHTPEARL_OAUTH_BASE}/token/${encodeURIComponent(accountCode)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  const accessToken = typeof answer?.access_token === 'string' ? answer.access_token : ''
  const apiDomain = safeApiDomain(answer?.api_domain)
  if (!accessToken || !apiDomain) throw new ProviderError('auth', 'Brightpearl did not issue a usable grant')
  const expiresIn = Number(answer?.expires_in)
  return {
    accessToken,
    refreshToken: typeof answer?.refresh_token === 'string' ? answer.refresh_token : null,
    expiresAtMs: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
    apiDomain,
  }
}

/** Trades the code Brightpearl sent back for a grant. */
export function exchangeBrightpearlCode(input: {
  http: ProviderHttp
  app: BrightpearlAppConfig
  accountCode: string
  code: string
  redirectUri: string
  nowMs: number
}): Promise<BrightpearlGrant> {
  return tokenRequest(
    input.http,
    input.app,
    input.accountCode,
    { grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri },
    input.nowMs,
  )
}

/** Trades a refresh token for a fresh access token. */
export function refreshBrightpearlGrant(input: {
  http: ProviderHttp
  app: BrightpearlAppConfig
  accountCode: string
  refreshToken: string
  nowMs: number
}): Promise<BrightpearlGrant> {
  return tokenRequest(
    input.http,
    input.app,
    input.accountCode,
    { grant_type: 'refresh_token', refresh_token: input.refreshToken },
    input.nowMs,
  )
}

/** A console path a member may be sent back to: same-origin and absolute, nothing else. */
export function safeReturnTo(value: unknown): string {
  const path = typeof value === 'string' ? value.trim() : ''
  return /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]{0,400}$/.test(path) && !path.includes('\\') ? path : '/'
}
