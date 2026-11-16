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

import {
  CONNECTOR_CORS_HEADERS,
  NO_STORE_HEADERS,
  oauthErrorResponse,
  readConnectorClient,
  revokeConnectorToken,
} from '@aglyn/tenant-data-admin'
import {
  connectorBudget,
  connectorPreflight,
  readConnectorForm,
  refuseOnAuthOrigin,
} from '../../_lib/connector-oauth-http'

// lockdown-423: exempt — revoking can only take access away, and a locked
// workspace must still be able to end a connection.

export const dynamic = 'force-dynamic'

const MAX_REVOKE_REQUEST_BYTES = 4 * 1024

/** Revocation requests one address may make per window, all counted. */
const REVOCATIONS = connectorBudget('oauth-revoke', 60, 60_000)

/**
 * Token revocation (RFC 7009, AGL-4225). A refresh token ends its whole
 * connection; an access token ends only itself.
 *
 * The answer is 200 whether or not the token existed, was malformed, or
 * belonged to another client (§2.2): what is revoked is decided, but what
 * exists is never disclosed. The client must name itself, and only its own
 * tokens are touched.
 */
export async function POST(request: Request): Promise<Response> {
  const elsewhere = refuseOnAuthOrigin(request)
  if (elsewhere) return elsewhere
  const refused = REVOCATIONS.refusal(request)
  if (refused) return refused
  REVOCATIONS.charge(request)

  const form = await readConnectorForm(request, MAX_REVOKE_REQUEST_BYTES)
  if (!form.ok) return form.response
  const { params, duplicated } = form
  if (duplicated.length) return oauthErrorResponse(400, 'invalid_request', 'A parameter was sent more than once')
  if (!params.token) return oauthErrorResponse(400, 'invalid_request', 'token is required')

  try {
    const client = await readConnectorClient(params.client_id)
    if (!client) return oauthErrorResponse(401, 'invalid_client', 'The client is not registered')
    await revokeConnectorToken({ token: params.token, clientId: client.clientId })
    return new Response(null, { status: 200, headers: { ...NO_STORE_HEADERS, ...CONNECTOR_CORS_HEADERS } })
  } catch (error) {
    console.error('oauth revoke failed', error instanceof Error ? error.name : 'unknown')
    return oauthErrorResponse(500, 'server_error')
  }
}

export function OPTIONS(): Response {
  return connectorPreflight()
}
