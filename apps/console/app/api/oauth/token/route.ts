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
  refuseOnAuthOrigin,
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
 * FAILED token requests per window. Only failures are counted — a client
 * refreshing on schedule must never be refused by its own traffic — and a
 * guess at a code or a refresh token is a failure.
 *
 * Kept per address AND per registered client. Claude calls from a provider's
 * shared addresses, so a per-address bucket alone would let one tenant's
 * misbehaving connection refuse every other tenant's refresh. A failure made
 * with a REGISTERED client id is charged to that client's own bucket at the
 * address; one with no client, an unknown client or a malformed request is
 * charged to the address. A request naming a REGISTERED client draws only
 * on that client's bucket; the address bucket refuses only requests that
 * carry no registered client id. An invented id is charged to the address
 * once its lookup finds nothing, so inventing ids buys nothing.
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
/**
 * Client ids this instance has seen resolve to a registration, briefly. A
 * request naming one is judged by its OWN (address, client) bucket without
 * first asking the address bucket, which a stranger's failures at the same
 * shared address may have spent. Memory only and bounded; a client not seen
 * here yet is looked up once the address bucket allows it.
 */
const REGISTERED_MEMORY_LIMIT = 5_000
const REGISTERED_MEMORY_TTL_MS = 10 * 60_000
const recentlyRegistered = new Map<string, number>()

function rememberRegistered(clientId: string, now = Date.now()): void {
  recentlyRegistered.delete(clientId)
  recentlyRegistered.set(clientId, now + REGISTERED_MEMORY_TTL_MS)
  while (recentlyRegistered.size > REGISTERED_MEMORY_LIMIT) {
    const oldest = recentlyRegistered.keys().next().value
    if (oldest === undefined) break
    recentlyRegistered.delete(oldest)
  }
}

function recallsRegistered(clientId: string, now = Date.now()): boolean {
  const until = recentlyRegistered.get(clientId)
  if (until === undefined) return false
  if (until > now) return true
  recentlyRegistered.delete(clientId)
  return false
}

export async function POST(request: Request): Promise<Response> {
  const elsewhere = refuseOnAuthOrigin(request)
  if (elsewhere) return elsewhere
  /**
   * Which bucket a failure is charged to: the (address, client) bucket once
   * the client is known to be registered, the address bucket until then. So
   * a malformed body, a duplicated parameter or an unknown client spends
   * only the address bucket — which refuses only requests that carry no
   * registered client id — and can never lock out another client.
   */
  let chargeTo: string | undefined
  const fail = (status: number, error: string, description?: string) => {
    FAILURES.charge(request, chargeTo)
    return oauthErrorResponse(status, error, description)
  }

  const form = await readConnectorForm(request, MAX_TOKEN_REQUEST_BYTES)
  if (!form.ok) {
    const refused = FAILURES.refusal(request)
    if (refused) return refused
    FAILURES.charge(request)
    return form.response
  }
  const { params, duplicated } = form
  const named = isConnectorClientIdFormat(params.client_id) ? params.client_id : null

  // Before any read: a client this instance knows is judged by its own
  // bucket alone; anything else by the address bucket, so an unknown id
  // cannot buy a lookup once the address has spent its failures.
  if (named && recallsRegistered(named)) {
    const refused = FAILURES.refusal(request, named)
    if (refused) return refused
  } else {
    const refused = FAILURES.refusal(request)
    if (refused) return refused
  }

  try {
    // The client is resolved FIRST, so every later failure is charged to it.
    const client = named ? await readConnectorClient(named) : null
    if (client) {
      rememberRegistered(client.clientId)
      chargeTo = client.clientId
      const refused = FAILURES.refusal(request, client.clientId)
      if (refused) return refused
    }
    if (duplicated.length) return fail(400, 'invalid_request', 'A parameter was sent more than once')
    if (!params.client_id) return fail(400, 'invalid_request', 'client_id is required')
    if (!client) return fail(401, 'invalid_client', 'The client is not registered')

    const { origin } = connectorOrigin(request)
    if (params.resource && params.resource !== connectorResourceFor(origin)) {
      return fail(400, 'invalid_target', 'resource must be this server’s MCP endpoint')
    }

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
