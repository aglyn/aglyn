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

import { createHash } from 'node:crypto'
import { MCP_SERVER_CARD_MEDIA_TYPE } from '@aglyn/aglyn/app-utils/connector-discovery'
import { ApiErrors } from '@aglyn/tenant-data-admin'
import { connectorOrigin, refuseOnAuthOrigin, unconfiguredOriginResponse } from '../../_lib/connector-oauth-http'
import { buildDocsUrl } from '../../../../constants/docs-links'
import { buildMcpServerCard } from '../../../../utils/mcp-server-card'

// lockdown-423: exempt — a public, static description of the MCP endpoint
// (SEP-2127), fetched with no caller identity; it reads no workspace and acts
// for none.

export const dynamic = 'force-dynamic'

/**
 * `GET /api/mcp/server-card` — the MCP Server Card (SEP-2127, AGL-4225).
 *
 * `<streamable-http-url>/server-card` is the location the extension reserves,
 * so a client holding only the endpoint's address can find its description by
 * appending one segment. The tenant's `/.well-known/api-catalog` names it as
 * the MCP entry's `service-desc`.
 *
 * Open wherever the endpoint itself is open, previews included: the card
 * describes how to connect and issues nothing. Closed on the auth origin, which
 * serves no part of the API (AGL-3090).
 *
 * The extension's `docs/discovery.md` asks for wide-open CORS (the card is
 * public metadata), caching headers, an `ETag` and a `304` on a matching
 * `If-None-Match`. The card is cacheable only when the origin cannot vary by
 * request — the same rule the OAuth discovery documents follow.
 */
export function GET(request: Request): Response {
  const refused = refuseOnAuthOrigin(request)
  if (refused) return refused
  const origin = connectorOrigin(request)
  if (!origin) return unconfiguredOriginResponse()

  const body = JSON.stringify(
    buildMcpServerCard({ origin: origin.origin, documentationUrl: buildDocsUrl('/api#mcp') }),
    null,
    2,
  )
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
  const headers: Record<string, string> = {
    ...SERVER_CARD_CORS_HEADERS,
    'Cache-Control': origin.configured ? 'public, max-age=3600' : 'no-store',
    ETag: etag,
  }
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'Content-Type': `${MCP_SERVER_CARD_MEDIA_TYPE}; charset=utf-8` },
  })
}

export function OPTIONS(request: Request): Response {
  return refuseOnAuthOrigin(request) ?? new Response(null, { status: 204, headers: SERVER_CARD_CORS_HEADERS })
}

/** Anything but GET is a wrong method on a document, not a missing path. */
export function POST(request: Request): Response {
  return (
    refuseOnAuthOrigin(request) ??
    ApiErrors.methodNotAllowed({ headers: { Allow: 'GET, OPTIONS', ...SERVER_CARD_CORS_HEADERS } })
  )
}

/** The CORS headers `docs/discovery.md` gives for a hosted card. */
const SERVER_CARD_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
}

/** RFC 9110 §13.1.2: weak comparison, and `*` matches any current representation. */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((entry) => entry.trim().replace(/^W\//, ''))
    .some((entry) => entry === '*' || entry === etag)
}
