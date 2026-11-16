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

// The MCP half of `check:agent-readiness` (AGL-4225), as pure functions over
// source text and a file-existence callback, so `agent-readiness.test.mjs`
// can feed them fixtures.
//
// What it asserts, all from source, none of it over the network:
//
//   1. Every MCP address the platform advertises composes to a route that
//      exists in the console's app tree — directly, or through the exact-path
//      `.well-known` rewrite map the middleware uses.
//   2. Every document that names the issuer or the resource builds it from the
//      ONE origin helper, `connectorOrigin`, and the two OAuth documents build
//      `resource`, `authorization_servers` and `issuer` from the same origin.
//   3. The tenant's `/.well-known/api-catalog` MCP entry is built from the
//      same path helpers on `platformConsoleOrigin()`, so it cannot name an
//      address the console does not serve.
//   4. `integrations/mcp-registry/server.json` names the same endpoint path
//      and the same card name the console's card publishes.
//   5. Every machine path among those addresses is admitted by an all-path
//      WAF bypass on the console project — or is on a NAMED list of paths
//      still owed one, which may only shrink.

/** The console's app router, relative to the repository root. */
export const CONSOLE_APP_DIR = 'apps/console/app'

/**
 * Parse `export const NAME = '…'` and `export const NAME = \`…${OTHER}…\``
 * out of a module with no imports, resolving `${OTHER}` against constants
 * declared earlier in the same file. Anything else is ignored.
 */
export function readPathConstants(source) {
  const constants = {}
  const pattern = /^export const ([A-Z_]+) = (?:'([^']*)'|`([^`]*)`)$/gm
  for (const match of source.matchAll(pattern)) {
    const [, name, plain, template] = match
    if (plain !== undefined) {
      constants[name] = plain
      continue
    }
    const resolved = template.replace(/\$\{([A-Z_]+)\}/g, (whole, ref) =>
      Object.prototype.hasOwnProperty.call(constants, ref) ? constants[ref] : whole,
    )
    // An unresolved reference is left in place and fails the route check
    // loudly, rather than quietly reading as some other path.
    constants[name] = resolved
  }
  return constants
}

/** `CONNECTOR_DISCOVERY_ROUTES`: `[CONSTANT]: '/api/…'` pairs. */
export function readDiscoveryRoutes(source, constants) {
  const block = /export const CONNECTOR_DISCOVERY_ROUTES[^=]*= \{([\s\S]*?)\n\}/.exec(source)
  if (!block) return null
  const routes = {}
  for (const [, ref, target] of block[1].matchAll(/\[([A-Z_]+)\]: '([^']+)'/g)) {
    routes[constants[ref] ?? `<unresolved ${ref}>`] = target
  }
  return routes
}

/**
 * The paths the MCP surface advertises, each with how it is served.
 * `machine` paths are called by programs and must be reachable by one whose
 * User-Agent nobody has heard of; `page` paths are opened in a person's
 * browser, which can answer a challenge.
 */
export function advertisedConnectorPaths(constants) {
  const need = (name) => {
    if (!constants[name]) throw new Error(`connector-discovery.ts no longer declares ${name}`)
    return constants[name]
  }
  return [
    { path: need('CONNECTOR_RESOURCE_PATH'), kind: 'machine', what: 'MCP endpoint' },
    { path: need('MCP_SERVER_CARD_PATH'), kind: 'machine', what: 'MCP server card' },
    { path: need('CONNECTOR_REGISTER_PATH'), kind: 'machine', what: 'client registration' },
    { path: need('CONNECTOR_TOKEN_PATH'), kind: 'machine', what: 'token endpoint' },
    { path: need('CONNECTOR_REVOKE_PATH'), kind: 'machine', what: 'revocation endpoint' },
    { path: need('PROTECTED_RESOURCE_METADATA_PATH'), kind: 'machine', what: 'RFC 9728 document' },
    { path: need('MCP_PROTECTED_RESOURCE_METADATA_PATH'), kind: 'machine', what: 'RFC 9728 document (MCP path)' },
    { path: need('AUTHORIZATION_SERVER_METADATA_PATH'), kind: 'machine', what: 'RFC 8414 document' },
    { path: need('CONNECTOR_AUTHORIZE_PATH'), kind: 'page', what: 'consent page' },
  ]
}

/**
 * The file that answers `path` in the console app tree, or null. A
 * `.well-known` path is answered through the middleware's rewrite map; every
 * other path by its own `route.ts` (an API) or `page.tsx` (a page).
 */
export function routeFileFor(path, discoveryRoutes, exists) {
  const target = discoveryRoutes[path] ?? (path.startsWith('/.well-known/') ? null : path)
  if (!target) return null
  for (const file of ['route.ts', 'page.tsx']) {
    const candidate = `${CONSOLE_APP_DIR}${target}/${file}`
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Source-level agreement: each route that names the issuer or the resource
 * takes its origin from `connectorOrigin(request)`, and the two OAuth
 * builders derive `resource`, `authorization_servers` and `issuer` from the
 * one origin they are handed. Returns a list of problems.
 */
export function originAgreementProblems({ routeSources, builderSource }) {
  const problems = []
  for (const [file, source] of Object.entries(routeSources)) {
    if (!/\bconnectorOrigin\(request\)/.test(source)) {
      problems.push(`${file} does not take its origin from connectorOrigin(request)`)
    }
  }
  const expectations = [
    [/resource: connectorResourceFor\(origin\)/, 'RFC 9728 `resource` is not connectorResourceFor(origin)'],
    [/authorization_servers: \[origin\]/, 'RFC 9728 `authorization_servers` is not [origin]'],
    [/issuer: origin,/, 'RFC 8414 `issuer` is not the origin'],
    [/authorization_endpoint: `\$\{origin\}\$\{CONNECTOR_AUTHORIZE_PATH\}`/, 'RFC 8414 `authorization_endpoint` is not on the issuer'],
    [/token_endpoint: `\$\{origin\}\$\{CONNECTOR_TOKEN_PATH\}`/, 'RFC 8414 `token_endpoint` is not on the issuer'],
    [/scopes_supported: \[\.\.\.API_SCOPES\][\s\S]*scopes_supported: \[\.\.\.API_SCOPES\]/, 'the two documents do not both declare scopes_supported from API_SCOPES'],
  ]
  for (const [pattern, message] of expectations) {
    if (!pattern.test(builderSource)) problems.push(message)
  }
  return problems
}

/**
 * The tenant catalog's MCP entry, from source: built on
 * `platformConsoleOrigin()` with the shared helpers, so its addresses are the
 * console's own.
 */
export function catalogProblems(source) {
  const problems = []
  if (!/const CONSOLE_ORIGIN = platformConsoleOrigin\(\)/.test(source)) {
    problems.push('the catalog does not take the console origin from platformConsoleOrigin()')
  }
  for (const helper of [
    'connectorResourceFor',
    'mcpServerCardUrl',
    'connectorResourceMetadataUrl',
    'connectorAuthorizationServerMetadataUrl',
  ]) {
    if (!new RegExp(`\\b${helper}\\(CONSOLE_ORIGIN\\)`).test(source)) {
      problems.push(`the catalog's MCP entry does not use ${helper}(CONSOLE_ORIGIN)`)
    }
  }
  if (/\/api\/(mcp|oauth)\b|\/\.well-known\/oauth-/.test(source)) {
    problems.push('the catalog spells an MCP path literally instead of using the helpers')
  }
  return problems
}

/** `app.aglyn.com` → `com.aglyn.app/mcp`, the console's `mcpServerCardName`. */
export function expectedCardName(url) {
  const host = new URL(url).hostname
  return `${host.split('.').filter(Boolean).reverse().join('.')}/mcp`
}

/** The registry entry agrees with the card the console serves. */
export function registryEntryProblems(entry, constants) {
  const problems = []
  if (!/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/[^/]+\/server\.schema\.json$/.test(entry.$schema ?? '')) {
    problems.push('server.json $schema is not an MCP Registry server schema')
  }
  const remotes = Array.isArray(entry.remotes) ? entry.remotes : []
  if (remotes.length !== 1 || remotes[0].type !== 'streamable-http') {
    problems.push('server.json must name exactly one streamable-http remote')
    return problems
  }
  const url = new URL(remotes[0].url)
  if (url.pathname !== constants.CONNECTOR_RESOURCE_PATH) {
    problems.push(`server.json remote path ${url.pathname} is not ${constants.CONNECTOR_RESOURCE_PATH}`)
  }
  if (entry.name !== expectedCardName(remotes[0].url)) {
    problems.push(`server.json name ${entry.name} is not the card's ${expectedCardName(remotes[0].url)}`)
  }
  if (typeof entry.description !== 'string' || entry.description.length > 100) {
    problems.push('server.json description must be 1–100 characters')
  }
  return problems
}
