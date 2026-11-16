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

/*==========================================
 * WHERE A CONNECTOR FINDS THE CONSOLE'S SIGN-IN (AGL-4225).
 *
 * An MCP client that is handed `<console>/api/mcp` and answered 401 reads the
 * protected-resource document the challenge names (RFC 9728), then the
 * authorization-server document (RFC 8414), and from there registers, sends
 * the person to the consent page and trades the code for credentials.
 *
 * Every address in that walk is here, in one module with no imports, because
 * the edge middleware has to know the three discovery documents by exact path
 * (it 404s the rest of `/.well-known/*`) and must not pull the server-side
 * credential code into the edge bundle to learn them. The documents
 * themselves are built by `connector-oauth.ts` in the data layer, from these
 * same constants.
 *
 * Nothing here names a host: these are paths, and the functions below take
 * the origin as an argument. Which origin is decided in ONE place, the
 * console's `connectorOrigin` — the configured console URL
 * (`NEXT_PUBLIC_CONSOLE_URL`) when it is set, and only otherwise the host the
 * deployment's proxy reports. A request header cannot choose the issuer of a
 * deployment that has configured its console URL.
 *==========================================*/

/** The MCP endpoint, which is the protected resource. */
export const CONNECTOR_RESOURCE_PATH = '/api/mcp'

/** The consent page a person is sent to. A console page, behind sign-in. */
export const CONNECTOR_AUTHORIZE_PATH = '/oauth/authorize'

/** Dynamic client registration (RFC 7591). */
export const CONNECTOR_REGISTER_PATH = '/api/oauth/register'

/** Code and refresh exchange. */
export const CONNECTOR_TOKEN_PATH = '/api/oauth/token'

/** Revocation (RFC 7009). */
export const CONNECTOR_REVOKE_PATH = '/api/oauth/revoke'

/** RFC 9728 §3: the document for the server as a whole. */
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

/**
 * RFC 9728 §3.1: the document for one resource, at the well-known prefix
 * followed by the resource's path. What the 401 challenge names.
 */
export const MCP_PROTECTED_RESOURCE_METADATA_PATH = `${PROTECTED_RESOURCE_METADATA_PATH}${CONNECTOR_RESOURCE_PATH}`

/** RFC 8414 §3. The issuer has no path, so neither does this. */
export const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'

/**
 * The MCP Server Card: a static description of the MCP endpoint that a client
 * or a registry can read BEFORE connecting — where it is, which transport,
 * which protocol revisions.
 *
 * SEP-2127 (MCP Server Cards, Final, Extensions Track) reserves
 * `<streamable-http-url>/server-card` as the recommended location, and its
 * discovery document advises against `.well-known` for cards, so this sits
 * under the endpoint it describes rather than beside the OAuth documents.
 * https://modelcontextprotocol.io/seps/2127-mcp-server-cards
 */
export const MCP_SERVER_CARD_PATH = `${CONNECTOR_RESOURCE_PATH}/server-card`

/** The card's media type, per the extension's `docs/discovery.md`. */
export const MCP_SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json'

/**
 * The `$schema` a card must carry. The extension's schema pins this exact
 * URL (versioned by the `v1` segment, not by date).
 */
export const MCP_SERVER_CARD_SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'

/**
 * The three discovery documents the console serves, by EXACT path, and the
 * route handler each is rewritten to. Exactly these: any other path under
 * `/.well-known/` still answers 404, which is the posture the namespace is
 * held to (AGL-3016).
 */
export const CONNECTOR_DISCOVERY_ROUTES: Readonly<Record<string, string>> = {
  [PROTECTED_RESOURCE_METADATA_PATH]: '/api/oauth/metadata/protected-resource',
  [MCP_PROTECTED_RESOURCE_METADATA_PATH]: '/api/oauth/metadata/protected-resource',
  [AUTHORIZATION_SERVER_METADATA_PATH]: '/api/oauth/metadata/authorization-server',
}

/** The route handler serving `pathname`, or `null` when it is not one of the three. */
export function connectorDiscoveryRoute(pathname: string): string | null {
  return Object.prototype.hasOwnProperty.call(CONNECTOR_DISCOVERY_ROUTES, pathname)
    ? CONNECTOR_DISCOVERY_ROUTES[pathname]
    : null
}

/** The resource identifier for the MCP endpoint on `origin`. */
export function connectorResourceFor(origin: string): string {
  return `${origin}${CONNECTOR_RESOURCE_PATH}`
}

/** What a 401 from the MCP endpoint names, so a client can begin the walk. */
export function connectorResourceMetadataUrl(origin: string): string {
  return `${origin}${MCP_PROTECTED_RESOURCE_METADATA_PATH}`
}

/** The authorization server's own document (RFC 8414) on `origin`. */
export function connectorAuthorizationServerMetadataUrl(origin: string): string {
  return `${origin}${AUTHORIZATION_SERVER_METADATA_PATH}`
}

/** The MCP Server Card (SEP-2127) on `origin`. */
export function mcpServerCardUrl(origin: string): string {
  return `${origin}${MCP_SERVER_CARD_PATH}`
}

/**
 * The card's `name`: reverse-DNS of the host that serves the endpoint, then
 * `/mcp`. The card schema (and the MCP Registry's `server.json`) require
 * `namespace/name` matching `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, and a
 * reverse-DNS namespace is the one a registry can verify against the domain,
 * so a self-hosted console names itself rather than borrowing ours.
 * `app.aglyn.com` → `com.aglyn.app/mcp`.
 */
export function mcpServerCardName(origin: string): string {
  let host = ''
  try {
    host = new URL(origin).hostname
  } catch {
    host = ''
  }
  const namespace = host
    .split('.')
    .filter(Boolean)
    .reverse()
    .join('.')
    .replace(/[^a-zA-Z0-9.-]/g, '-')
  return `${namespace || 'local'}/mcp`
}
