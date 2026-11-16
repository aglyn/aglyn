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
  logOrgActivity,
  NO_STORE_HEADERS,
  oauthErrorResponse,
  readConnectorClient,
  refreshConnectorTokens,
} from '@aglyn/tenant-data-admin'
import {
  connectorBudget,
  connectorPreflight,
  readConnectorForm,
} from '../../_lib/connector-oauth-http'

// lockdown-423: exempt — an OAuth endpoint answers in OAuth's own errors, so
// a lock is refused here as `invalid_grant`: the exchange and the refresh
// both run `checkConnectorLiveness` with the lockdown verdict on
// (libs/tenant/data/admin/src/lib/server/connector-oauth-store.ts), and every
// call the issued credential makes passes the v1 authenticator's 423.

export const dynamic = 'force-dynamic'

/** Largest token request read. A real one is a few hundred bytes. */
const MAX_TOKEN_REQUEST_BYTES = 4 * 1024

/**
 * FAILED token requests one address may make per window. Only failures are
 * counted — a client refreshing on schedule must never be refused by its own
 * traffic — and a guess at a code or a refresh token is a failure.
 */
const FAILURES = connectorBudget('oauth-token-failures', 30, 60_000)

/**
 * The token endpoint (AGL-4225): `authorization_code` with PKCE, and
 * `refresh_token` with rotation. Public clients, so the client proves itself
 * with the PKCE verifier and the single-use code, not a secret.
 *
 * Every answer is `Cache-Control: no-store`, and no error carries the code,
 * the token or the verifier it was given — each description is a constant.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = FAILURES.refusal(request)
  if (refused) return refused
  const fail = (status: number, error: string, description?: string) => {
    FAILURES.charge(request)
    return oauthErrorResponse(status, error, description)
  }

  const form = await readConnectorForm(request, MAX_TOKEN_REQUEST_BYTES)
  if (!form.ok) {
    FAILURES.charge(request)
    return form.response
  }
  const { params, duplicated } = form
  if (duplicated.length) return fail(400, 'invalid_request', 'A parameter was sent more than once')

  const origin = new URL(request.url).origin
  if (params.resource && params.resource !== connectorResourceFor(origin)) {
    return fail(400, 'invalid_target', 'resource must be this server’s MCP endpoint')
  }
  if (!params.client_id) return fail(400, 'invalid_request', 'client_id is required')

  try {
    const client = await readConnectorClient(params.client_id)
    if (!client) return fail(401, 'invalid_client', 'The client is not registered')

    if (params.grant_type === 'authorization_code') {
      if (!params.code || !params.redirect_uri || !params.code_verifier) {
        return fail(400, 'invalid_request', 'code, redirect_uri and code_verifier are required')
      }
      const result = await exchangeConnectorCode({
        code: params.code,
        clientId: params.client_id,
        redirectUri: params.redirect_uri,
        codeVerifier: params.code_verifier,
        resource: params.resource,
      })
      if (!result.ok) return fail(400, result.error, result.description)
      if (result.connected) {
        await logOrgActivity(
          result.connected.orgId,
          { uid: result.connected.uid, email: result.connected.email },
          'Connected an app',
          { type: 'org', id: result.connected.grantId, name: result.connected.clientName },
        )
      }
      return Response.json(result.tokens, { headers: { ...NO_STORE_HEADERS, ...CONNECTOR_CORS_HEADERS } })
    }

    if (params.grant_type === 'refresh_token') {
      if (!params.refresh_token) return fail(400, 'invalid_request', 'refresh_token is required')
      const result = await refreshConnectorTokens({
        refreshToken: params.refresh_token,
        clientId: params.client_id,
        scope: params.scope,
      })
      if (!result.ok) return fail(400, result.error, result.description)
      return Response.json(result.tokens, { headers: { ...NO_STORE_HEADERS, ...CONNECTOR_CORS_HEADERS } })
    }

    return fail(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
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
