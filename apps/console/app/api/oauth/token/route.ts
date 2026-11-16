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

import { connectorResourceFor } from '@aglyn/aglyn/app-utils/connector-discovery'
import {
  CONNECTOR_CORS_HEADERS,
  exchangeConnectorCode,
  isConnectorClientIdFormat,
  isConnectorCodeFormat,
  isConnectorRefreshTokenFormat,
  logOrgActivity,
  NO_STORE_HEADERS,
  oauthErrorResponse,
  readConnectorClient,
  refreshConnectorTokens,
} from '@aglyn/tenant-data-admin'
import {
  connectorBudget,
  connectorOrigin,
  connectorPreflight,
  readConnectorForm,
  recordWithoutFailing,
  refuseWhereSignInIsNotServed,
  unconfiguredOriginResponse,
} from '../../_lib/connector-oauth-http'

// lockdown-423: exempt — an OAuth endpoint answers in OAuth's own errors. A
// lock is refused at refresh as `temporarily_unavailable` (503, with a retry
// time) and at a code exchange as `invalid_grant`: both run
// `checkConnectorLiveness` with the lockdown verdict on
// (libs/tenant/data/admin/src/lib/server/connector-oauth-store.ts), and every
// call the issued credential makes passes the v1 authenticator's 423.

export const dynamic = 'force-dynamic'

/** Largest token request read. A real one is a few hundred bytes. */
const MAX_TOKEN_REQUEST_BYTES = 4 * 1024

/**
 * Lookups one address may cause per minute — every read this endpoint makes
 * on a caller's behalf (the client, the code or refresh token). It exists
 * ONLY to bound read amplification, so it is generous: a provider's shared
 * address carries every one of its users' refreshes.
 */
const LOOKUPS_PER_MINUTE = 600
const LOOKUPS = connectorBudget('oauth-token-lookups', LOOKUPS_PER_MINUTE, 60_000)

/**
 * Secrets that resolved to NOTHING, per address per minute: guesses. Only
 * those are counted, and the count only decides how a further guess is
 * answered (429 instead of 400). A code or refresh token that RESOLVES and is
 * bound to the client named is never refused by it — a client id is public
 * and deterministic, so failures charged to it, or to an address another
 * site can make a browser post from, would let anyone disconnect anyone.
 */
const GUESSES = connectorBudget('oauth-token-guesses', 30, 60_000)

/**
 * The token endpoint (AGL-4225): `authorization_code` with PKCE, and
 * `refresh_token` with rotation. Public clients, so the client proves itself
 * with the PKCE verifier and the single-use code, not a secret.
 *
 * Every answer is `Cache-Control: no-store`, and no error carries the code,
 * the token or the verifier it was given — each description is a constant.
 */
export async function POST(request: Request): Promise<Response> {
  const elsewhere = refuseWhereSignInIsNotServed(request)
  if (elsewhere) return elsewhere
  const resolved = connectorOrigin(request)
  if (!resolved) return unconfiguredOriginResponse()

  const form = await readConnectorForm(request, MAX_TOKEN_REQUEST_BYTES)
  if (!form.ok) return form.response
  const { params, duplicated } = form
  if (duplicated.length) return oauthErrorResponse(400, 'invalid_request', 'A parameter was sent more than once')
  if (!params.client_id) return oauthErrorResponse(400, 'invalid_request', 'client_id is required')
  if (params.grant_type !== 'authorization_code' && params.grant_type !== 'refresh_token') {
    return oauthErrorResponse(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
  }
  const secret = params.grant_type === 'authorization_code' ? params.code : params.refresh_token
  if (params.grant_type === 'authorization_code' && (!params.code || !params.redirect_uri || !params.code_verifier)) {
    return oauthErrorResponse(400, 'invalid_request', 'code, redirect_uri and code_verifier are required')
  }
  if (params.grant_type === 'refresh_token' && !params.refresh_token) {
    return oauthErrorResponse(400, 'invalid_request', 'refresh_token is required')
  }
  // Malformed ids and secrets are refused without a read.
  const wellFormed =
    isConnectorClientIdFormat(params.client_id) &&
    (params.grant_type === 'authorization_code' ? isConnectorCodeFormat(secret) : isConnectorRefreshTokenFormat(secret))
  if (!wellFormed) {
    return oauthErrorResponse(
      isConnectorClientIdFormat(params.client_id) ? 400 : 401,
      isConnectorClientIdFormat(params.client_id) ? 'invalid_grant' : 'invalid_client',
      isConnectorClientIdFormat(params.client_id) ? 'The credential is not valid' : 'The client is not registered',
    )
  }
  if (params.resource && params.resource !== connectorResourceFor(resolved.origin)) {
    return oauthErrorResponse(400, 'invalid_target', 'resource must be this server’s MCP endpoint')
  }

  // Up to two reads from here (the client, then the secret), each bounded.
  const lookupRefused = LOOKUPS.refusal(request)
  if (lookupRefused) return lookupRefused
  const guessed = (status: number, error: string, description: string) => {
    const already = GUESSES.refusal(request)
    GUESSES.charge(request)
    return already ?? oauthErrorResponse(status, error, description)
  }

  try {
    LOOKUPS.charge(request)
    const client = await readConnectorClient(params.client_id)
    if (!client) return guessed(401, 'invalid_client', 'The client is not registered')

    LOOKUPS.charge(request)
    const result =
      params.grant_type === 'authorization_code'
        ? await exchangeConnectorCode({
            code: params.code,
            clientId: params.client_id,
            redirectUri: params.redirect_uri,
            codeVerifier: params.code_verifier,
            resource: params.resource,
          })
        : await refreshConnectorTokens({
            refreshToken: params.refresh_token,
            clientId: params.client_id,
            scope: params.scope,
          })

    if (!result.ok) {
      // A lock: try again later. Never charged, and never a dead credential —
      // `invalid_grant` would make the client discard its refresh token.
      if (result.error === 'temporarily_unavailable') {
        return oauthErrorResponse(503, 'temporarily_unavailable', result.description, {
          'Retry-After': String(result.retryAfterSec ?? 60),
        })
      }
      if (result.unknown) return guessed(400, result.error ?? 'invalid_grant', result.description ?? 'Not valid')
      return oauthErrorResponse(400, result.error ?? 'invalid_grant', result.description)
    }

    // The exchange is committed: the code is spent and the tokens exist.
    // Nothing after this line may stop them reaching the client.
    const connected = result.connected
    if (connected) {
      await recordWithoutFailing(() =>
        logOrgActivity(
          connected.orgId,
          { uid: connected.uid, email: connected.email },
          'Connected an app',
          { type: 'org', id: connected.grantId, name: connected.clientName },
        ),
      )
    }
    return Response.json(result.tokens, { headers: { ...NO_STORE_HEADERS, ...CONNECTOR_CORS_HEADERS } })
  } catch (error) {
    // The message only: an Error from a transaction can carry the document
    // path, and a document path here is a token hash.
    console.error('oauth token failed', error instanceof Error ? error.name : 'unknown')
    return oauthErrorResponse(500, 'server_error')
  }
}

export function OPTIONS(): Response {
  return connectorPreflight()
}
