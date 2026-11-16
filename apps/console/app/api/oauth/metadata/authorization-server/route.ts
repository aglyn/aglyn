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
  buildAuthorizationServerMetadata,
  CONNECTOR_CORS_HEADERS,
} from '@aglyn/tenant-data-admin'
import {
  connectorOrigin,
  connectorPreflight,
  discoveryCacheControl,
  refuseOnAuthOrigin,
} from '../../../_lib/connector-oauth-http'

// lockdown-423: exempt — a public discovery document (RFC 8414) fetched with
// no caller identity; it names the sign-in endpoints and acts for no
// workspace.

export const dynamic = 'force-dynamic'

/**
 * `/.well-known/oauth-authorization-server`, rewritten here by
 * `middleware.ts` (AGL-4225). The issuer is `connectorOrigin` — the
 * configured console URL, or the proxy-reported host where none is set — and
 * the auth origin is refused, because it is not the issuer.
 */
export function GET(request: Request): Response {
  const refused = refuseOnAuthOrigin(request)
  if (refused) return refused
  const origin = connectorOrigin(request)
  return Response.json(buildAuthorizationServerMetadata(origin.origin), {
    headers: { ...CONNECTOR_CORS_HEADERS, 'Cache-Control': discoveryCacheControl(origin) },
  })
}

export function OPTIONS(): Response {
  return connectorPreflight()
}
