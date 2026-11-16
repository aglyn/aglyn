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

// node --test tools/scripts/lib/agent-readiness.test.mjs
//
// The MCP half of `check:agent-readiness` (AGL-4225) on fixtures: each check
// passes the shape the source has today and fails each way it can break.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  advertisedConnectorPaths,
  catalogProblems,
  expectedCardName,
  originAgreementProblems,
  readDiscoveryRoutes,
  readPathConstants,
  registryEntryProblems,
  routeFileFor,
} from './agent-readiness.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const DISCOVERY = `
export const CONNECTOR_RESOURCE_PATH = '/api/mcp'
export const CONNECTOR_AUTHORIZE_PATH = '/oauth/authorize'
export const CONNECTOR_REGISTER_PATH = '/api/oauth/register'
export const CONNECTOR_TOKEN_PATH = '/api/oauth/token'
export const CONNECTOR_REVOKE_PATH = '/api/oauth/revoke'
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'
export const MCP_PROTECTED_RESOURCE_METADATA_PATH = \`\${PROTECTED_RESOURCE_METADATA_PATH}\${CONNECTOR_RESOURCE_PATH}\`
export const AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'
export const MCP_SERVER_CARD_PATH = \`\${CONNECTOR_RESOURCE_PATH}/server-card\`
export const CONNECTOR_DISCOVERY_ROUTES: Readonly<Record<string, string>> = {
  [PROTECTED_RESOURCE_METADATA_PATH]: '/api/oauth/metadata/protected-resource',
  [MCP_PROTECTED_RESOURCE_METADATA_PATH]: '/api/oauth/metadata/protected-resource',
  [AUTHORIZATION_SERVER_METADATA_PATH]: '/api/oauth/metadata/authorization-server',
}
`

const ROUTE_FILES = new Set([
  'apps/console/app/api/mcp/route.ts',
  'apps/console/app/api/mcp/server-card/route.ts',
  'apps/console/app/api/oauth/register/route.ts',
  'apps/console/app/api/oauth/token/route.ts',
  'apps/console/app/api/oauth/revoke/route.ts',
  'apps/console/app/api/oauth/metadata/protected-resource/route.ts',
  'apps/console/app/api/oauth/metadata/authorization-server/route.ts',
  'apps/console/app/oauth/authorize/page.tsx',
])

test('resolves template constants against earlier ones', () => {
  const constants = readPathConstants(DISCOVERY)
  assert.equal(constants.MCP_PROTECTED_RESOURCE_METADATA_PATH, '/.well-known/oauth-protected-resource/api/mcp')
  assert.equal(constants.MCP_SERVER_CARD_PATH, '/api/mcp/server-card')
})

test('every advertised address composes to a route, .well-known through the rewrite map', () => {
  const constants = readPathConstants(DISCOVERY)
  const routes = readDiscoveryRoutes(DISCOVERY, constants)
  for (const { path } of advertisedConnectorPaths(constants)) {
    assert.ok(routeFileFor(path, routes, (file) => ROUTE_FILES.has(file)), path)
  }
})

test('a missing route file, or a .well-known path outside the map, composes to nothing', () => {
  const constants = readPathConstants(DISCOVERY)
  const routes = readDiscoveryRoutes(DISCOVERY, constants)
  const without = (gone) => (file) => ROUTE_FILES.has(file) && file !== gone
  assert.equal(routeFileFor('/api/mcp/server-card', routes, without('apps/console/app/api/mcp/server-card/route.ts')), null)
  assert.equal(routeFileFor('/.well-known/openid-configuration', routes, () => true), null)
})

test('a renamed constant is a loud failure, not a skipped address', () => {
  const constants = readPathConstants(DISCOVERY.replace('MCP_SERVER_CARD_PATH', 'SOMETHING_ELSE'))
  assert.throws(() => advertisedConnectorPaths(constants), /MCP_SERVER_CARD_PATH/)
})

test('the real source passes every MCP check', () => {
  const read = (file) => readFileSync(join(REPO_ROOT, file), 'utf8')
  const source = read('libs/aglyn/src/lib/app-utils/connector-discovery.ts')
  const constants = readPathConstants(source)
  assert.ok(readDiscoveryRoutes(source, constants))
  assert.deepEqual(
    originAgreementProblems({
      routeSources: {
        mcp: read('apps/console/app/api/mcp/route.ts'),
        card: read('apps/console/app/api/mcp/server-card/route.ts'),
      },
      builderSource: read('libs/tenant/data/admin/src/lib/server/connector-oauth.ts'),
    }),
    [],
  )
  assert.deepEqual(catalogProblems(read('apps/tenant/app/api/api-catalog/route.ts')), [])
  assert.deepEqual(registryEntryProblems(JSON.parse(read('integrations/mcp-registry/server.json')), constants), [])
})

test('a route that reads its own origin, or a builder with a second issuer, is named', () => {
  const problems = originAgreementProblems({
    routeSources: { 'x/route.ts': 'const origin = new URL(request.url).origin' },
    builderSource: 'issuer: process.env.ISSUER,',
  })
  assert.ok(problems.some((problem) => problem.includes('x/route.ts')))
  assert.ok(problems.some((problem) => problem.includes('`issuer`')))
  assert.ok(problems.some((problem) => problem.includes('`resource`')))
})

test('a catalog that hard-codes the MCP address, or another origin, is named', () => {
  const problems = catalogProblems(
    "const CONSOLE_ORIGIN = 'https://app.aglyn.com'\nurl: `${CONSOLE_ORIGIN}/api/mcp`,",
  )
  assert.ok(problems.some((problem) => problem.includes('platformConsoleOrigin')))
  assert.ok(problems.some((problem) => problem.includes('literally')))
  assert.ok(problems.some((problem) => problem.includes('mcpServerCardUrl')))
})

test('a registry entry on the wrong path, under another name, or too long is named', () => {
  const constants = readPathConstants(DISCOVERY)
  const good = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: 'com.aglyn.app/mcp',
    description: 'Short.',
    remotes: [{ type: 'streamable-http', url: 'https://app.aglyn.com/api/mcp' }],
  }
  assert.deepEqual(registryEntryProblems(good, constants), [])
  assert.equal(registryEntryProblems({ ...good, remotes: [{ type: 'streamable-http', url: 'https://app.aglyn.com/mcp' }] }, constants).length, 1)
  assert.equal(registryEntryProblems({ ...good, name: 'com.aglyn/mcp' }, constants).length, 1)
  assert.equal(registryEntryProblems({ ...good, description: 'x'.repeat(101) }, constants).length, 1)
  assert.equal(registryEntryProblems({ ...good, remotes: [] }, constants).length, 1)
})

test('the card name is the reversed host', () => {
  assert.equal(expectedCardName('https://app.aglyn.com/api/mcp'), 'com.aglyn.app/mcp')
})
