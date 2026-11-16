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
  buildProtectedResourceMetadata,
  CONNECTOR_CORS_HEADERS,
} from '@aglyn/tenant-data-admin'
import {
  connectorOrigin,
  connectorPreflight,
  discoveryCacheControl,
  refuseWhereSignInIsNotServed,
  unconfiguredOriginResponse,
} from '../../../_lib/connector-oauth-http'

// lockdown-423: exempt — a public discovery document (RFC 9728) fetched with
// no caller identity; it describes the MCP endpoint and acts for no
// workspace.

export const dynamic = 'force-dynamic'

/**
 * `/.well-known/oauth-protected-resource` and
 * `/.well-known/oauth-protected-resource/api/mcp`, rewritten here by
 * `middleware.ts` (AGL-4225). One document for both: the console protects
 * exactly one resource, so the server-wide document and the per-resource one
 * say the same thing.
 */
export function GET(request: Request): Response {
  const refused = refuseWhereSignInIsNotServed(request)
  if (refused) return refused
  const origin = connectorOrigin(request)
  if (!origin) return unconfiguredOriginResponse()
  return Response.json(buildProtectedResourceMetadata(origin.origin), {
    headers: { ...CONNECTOR_CORS_HEADERS, 'Cache-Control': discoveryCacheControl(origin) },
  })
}

export function OPTIONS(): Response {
  return connectorPreflight()
}
