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
 * Nothing here names a host. Issuer and resource are the console origin the
 * request arrived on, so a preview deployment, localhost and a self-hosted
 * install each describe themselves.
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
