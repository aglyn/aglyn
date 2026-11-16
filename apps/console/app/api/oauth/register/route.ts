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
  MAX_REGISTRATION_BYTES,
  NO_STORE_HEADERS,
  oauthErrorResponse,
  readCappedBody,
  registerConnectorClient,
  validateClientRegistration,
} from '@aglyn/tenant-data-admin'
import {
  connectorBudget,
  connectorPreflight,
} from '../../_lib/connector-oauth-http'

// lockdown-423: exempt — registering a client names no workspace and grants
// nothing; access is decided at consent, which runs the verdict, and every
// call a credential makes passes the v1 authenticator's.

export const dynamic = 'force-dynamic'

/**
 * Registrations one address may make per window. Every registration is a
 * stored document written for an unauthenticated caller, so every request is
 * counted, not only failures. A client registers once per connection, so a
 * person connecting a handful of apps never comes near it.
 */
const REGISTRATIONS = connectorBudget('oauth-register', 20, 10 * 60_000)

/**
 * Dynamic client registration (RFC 7591), public clients only (AGL-4225).
 *
 * What is kept is a name and the redirect addresses, and every address must
 * be on `CONNECTOR_REDIRECT_ALLOWLIST` — so registering is open, but a client
 * registered by anyone can only ever have a code delivered to Claude or to
 * the person's own machine. Everything else a client asks for is replaced
 * with what this server does, and the response says what that is.
 */
export async function POST(request: Request): Promise<Response> {
  const refused = REGISTRATIONS.refusal(request)
  if (refused) return refused
  REGISTRATIONS.charge(request)

  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') {
    return oauthErrorResponse(400, 'invalid_client_metadata', 'The body must be application/json')
  }
  const text = await readCappedBody(request, MAX_REGISTRATION_BYTES)
  if (text === null) return oauthErrorResponse(413, 'invalid_client_metadata', 'The body is too large')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return oauthErrorResponse(400, 'invalid_client_metadata', 'The body is not valid JSON')
  }

  const validated = validateClientRegistration(body)
  if (!validated.ok) return oauthErrorResponse(400, validated.error, validated.description)

  try {
    const client = await registerConnectorClient({
      clientName: validated.clientName,
      redirectUris: validated.redirectUris,
    })
    return Response.json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(client.issuedAtMs / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { status: 201, headers: { ...NO_STORE_HEADERS, ...CONNECTOR_CORS_HEADERS } },
    )
  } catch (error) {
    console.error('oauth register failed', error instanceof Error ? error.name : 'unknown')
    return oauthErrorResponse(500, 'server_error')
  }
}

export function OPTIONS(): Response {
  return connectorPreflight()
}
