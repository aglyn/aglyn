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
  refuseOnAuthOrigin,
} from '../../_lib/connector-oauth-http'

// lockdown-423: exempt — registering a client names no workspace and grants
// nothing; access is decided at consent, which runs the verdict, and every
// call a credential makes passes the v1 authenticator's.

export const dynamic = 'force-dynamic'

/**
 * Registration requests one address may make per window — every request
 * counted. Only abuse should ever meet it: registration is idempotent (an
 * identical one returns the same client and writes nothing new), and Claude
 * registers from a provider's shared addresses on behalf of every customer at
 * once, so the number has to be one no burst of real connects reaches.
 * DISTINCT registrations are bounded elsewhere — every address on the
 * redirect allowlist, the size caps, and each unused client's expiry.
 */
const REGISTRATIONS_PER_WINDOW = 300
const REGISTRATIONS = connectorBudget('oauth-register', REGISTRATIONS_PER_WINDOW, 10 * 60_000)

/**
 * NEW clients one address may create per window, PER SERVER INSTANCE (the
 * budgets here are in memory, so N instances admit N times this).
 *
 * Registration is open to any client and distinct registrations are
 * unbounded in variety, so this — not the request limit — bounds storage.
 * What the code guarantees, per address per instance: at most 20 new clients
 * per 10 minutes, 2,880 a day; a client nobody approves lives 7 days
 * (`CONNECTOR_CLIENT_UNUSED_TTL_MS`) and no repeat registration extends it; a
 * client document is at most about 3 KB (a 60-character name and five
 * 512-character addresses). So one address holds at most about 20,160
 * unapproved clients, roughly 60 MB, through one instance at any time.
 *
 * The unit is RESERVED before the transaction and refunded when the client
 * already existed, so concurrent registrations cannot overrun it. A repeat
 * of an existing registration is never refused by it.
 */
const NEW_CLIENTS_PER_WINDOW = 20
const NEW_CLIENTS = connectorBudget('oauth-register-new', NEW_CLIENTS_PER_WINDOW, 10 * 60_000)

/**
 * Dynamic client registration (RFC 7591), public clients only (AGL-4225).
 *
 * Idempotent: the client id is derived from the name and the redirect
 * addresses, so the same registration answers with the same client. A repeat
 * still answers 201 with the full registration — RFC 7591 §3.2.1 defines
 * exactly one success status, and a client library may hold the server to it;
 * `client_id_issued_at` keeps the first registration's time, which is the
 * honest answer to "when was this client issued".
 *
 * Open to any MCP client. What is kept is a name and the redirect addresses,
 * each held to `CONNECTOR_REDIRECT_POLICY` — https on a real domain, http
 * only on loopback, or an exact app-link callback on the allowlist — so every
 * address is unambiguous; addresses outside it are dropped from the
 * registration, which fails only when none is left. Who may receive a code is not decided here: PKCE binds the
 * code to the sign-in that asked for it, and the consent screen shows the
 * person where it is going. Everything else a client asks for is replaced
 * with what this server does, and the response says what that is.
 */
export async function POST(request: Request): Promise<Response> {
  const elsewhere = refuseOnAuthOrigin(request)
  if (elsewhere) return elsewhere
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
    const reserved = NEW_CLIENTS.reserve(request)
    let client: Awaited<ReturnType<typeof registerConnectorClient>>
    try {
      client = await registerConnectorClient(
        { clientName: validated.clientName, redirectUris: validated.redirectUris },
        Date.now(),
        { mayCreate: reserved },
      )
    } catch (error) {
      if (reserved) NEW_CLIENTS.refund(request)
      throw error
    }
    if (!client) {
      return (
        NEW_CLIENTS.refusal(request) ??
        oauthErrorResponse(429, 'invalid_request', 'Too many new registrations', { 'Retry-After': '60' })
      )
    }
    if (reserved && !client.created) NEW_CLIENTS.refund(request)
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
