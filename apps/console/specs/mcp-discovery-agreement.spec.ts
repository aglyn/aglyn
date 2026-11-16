/**
 * @jest-environment node
 *
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

/**
 * Everything the console publishes about its MCP server tells one story
 * (AGL-4225): the 401 challenge, the RFC 9728 and RFC 8414 documents, the
 * MCP Server Card (SEP-2127), `initialize`, the customer OpenAPI document and
 * the REST root. Each is served by a different route and built by a different
 * function, so each pair that must agree is asserted here, as served.
 *
 * And the server card itself, as HTTP: what the extension's discovery
 * document asks of a hosted card (media type, CORS, caching, ETag and 304),
 * and the auth-origin refusal every connector route makes.
 */

const mockAuthenticate = jest.fn()
jest.mock('../utils/api-v1', () => ({
  authenticateApiV1: (...args: unknown[]) => mockAuthenticate(...args),
  chargeApiV1Call: jest.fn(),
}))
jest.mock('../utils/api-v1-resources', () => ({
  describePluginApiV1Resources: async () => [],
  dispatchResource: jest.fn(),
}))

import { ApiErrors } from '@aglyn/tenant-data-admin'
import {
  connectorDiscoveryRoute,
  MCP_SERVER_CARD_MEDIA_TYPE,
  MCP_SERVER_CARD_PATH,
  MCP_SERVER_CARD_SCHEMA,
  mcpServerCardName,
} from '@aglyn/aglyn/app-utils/connector-discovery'
import { API_SCOPES } from '@aglyn/tenant-data-admin/server/api-keys'
import { GET as protectedResource } from '../app/api/oauth/metadata/protected-resource/route'
import { GET as authorizationServer } from '../app/api/oauth/metadata/authorization-server/route'
import { GET as serverCard, OPTIONS as serverCardPreflight, POST as serverCardPost } from '../app/api/mcp/server-card/route'
import { POST as mcp } from '../app/api/mcp/route'
import { buildCustomerApiOpenApi } from '../utils/api-v1-openapi'
import { MCP_SUPPORTED_PROTOCOL_VERSIONS } from '../utils/mcp-protocol'

const ORIGIN = 'https://app.aglyn.com'

const json = async (response: Response) => JSON.parse(await response.text())

async function readAll(origin = ORIGIN) {
  mockAuthenticate.mockResolvedValue(ApiErrors.unauthorized())
  const challenge = await mcp(
    new Request(`${origin}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    }),
  )
  return {
    challenge,
    resource: await json(await protectedResource(new Request(`${origin}/api/oauth/metadata/protected-resource`))),
    server: await json(await authorizationServer(new Request(`${origin}/api/oauth/metadata/authorization-server`))),
    card: await json(serverCard(new Request(`${origin}${MCP_SERVER_CARD_PATH}`))),
    openapi: buildCustomerApiOpenApi(
      { origin, documentationUrl: 'https://docs.example.com/api', brandName: 'Aglyn' },
      [],
    ) as Record<string, any>,
  }
}

describe('the MCP discovery documents agree (AGL-4225)', () => {
  it('name one resource: the challenge, RFC 9728, the card and the OpenAPI document', async () => {
    const { challenge, resource, card, openapi } = await readAll()
    const endpoint = `${ORIGIN}/api/mcp`
    expect(resource.resource).toBe(endpoint)
    expect(card.remotes).toHaveLength(1)
    expect(card.remotes[0]).toMatchObject({ type: 'streamable-http', url: endpoint })
    expect(openapi.info.description).toContain(endpoint)

    // The challenge names a document the middleware actually serves, and
    // that document is the one read above.
    const named = /resource_metadata="([^"]+)"/.exec(challenge.headers.get('www-authenticate') ?? '')?.[1]
    expect(named).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)
    expect(connectorDiscoveryRoute(new URL(named as string).pathname)).toBe('/api/oauth/metadata/protected-resource')
    expect(openapi.info.description).toContain(named)
  })

  it('name one issuer: RFC 9728 points at the server RFC 8414 describes, and every endpoint is on it', async () => {
    const { resource, server, openapi } = await readAll()
    expect(resource.authorization_servers).toEqual([server.issuer])
    for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
      expect(String(server[key]).startsWith(`${server.issuer}/`)).toBe(true)
    }
    const flow = openapi.components.securitySchemes.connector.flows.authorizationCode
    expect(flow.authorizationUrl).toBe(server.authorization_endpoint)
    expect(flow.tokenUrl).toBe(server.token_endpoint)
    // The AS document is where the middleware routes it.
    expect(connectorDiscoveryRoute('/.well-known/oauth-authorization-server')).toBe('/api/oauth/metadata/authorization-server')
    expect(openapi.info.description).toContain(`${server.issuer}/.well-known/oauth-authorization-server`)
  })

  it('declare one scope list, the one every credential is held to', async () => {
    const { resource, server, openapi } = await readAll()
    expect(resource.scopes_supported).toEqual([...API_SCOPES])
    expect(server.scopes_supported).toEqual([...API_SCOPES])
    expect(Object.keys(openapi.components.securitySchemes.connector.flows.authorizationCode.scopes)).toEqual([
      ...API_SCOPES,
    ])
    expect(server.code_challenge_methods_supported).toEqual(['S256'])
  })

  it('point a developer at the same sign-in documentation, and name the server alike', async () => {
    const { resource, server, card } = await readAll()
    expect(resource.resource_documentation).toMatch(/\/api\/authentication#apps-that-sign-in$/)
    expect(server.service_documentation).toBe(resource.resource_documentation)
    expect(resource.resource_name).toBe(card.title)
  })

  it('name the same server as `initialize` does', async () => {
    mockAuthenticate.mockResolvedValue({
      context: { orgId: 'org-1', keyId: 'k', keyName: 'k', scopes: [], org: {}, firestore: {}, headers: {} },
    })
    const answer = await json(
      await mcp(
        new Request(`${ORIGIN}/api/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
        }),
      ),
    )
    const card = await json(serverCard(new Request(`${ORIGIN}${MCP_SERVER_CARD_PATH}`)))
    expect(answer.result.serverInfo).toEqual({ name: card.title, version: card.version })
    expect(card.remotes[0].supportedProtocolVersions).toEqual([...MCP_SUPPORTED_PROTOCOL_VERSIONS])
  })

  it('follow the origin a preview or local console is asked on, all together', async () => {
    const { resource, server, card } = await readAll('http://localhost:4200')
    expect(resource.resource).toBe('http://localhost:4200/api/mcp')
    expect(server.issuer).toBe('http://localhost:4200')
    expect(card.remotes[0].url).toBe('http://localhost:4200/api/mcp')
    expect(card.name).toBe('localhost/mcp')
  })
})

describe('GET /api/mcp/server-card (SEP-2127)', () => {
  const get = (headers: Record<string, string> = {}, origin = ORIGIN) =>
    serverCard(new Request(`${origin}${MCP_SERVER_CARD_PATH}`, { headers }))

  it('is the card the extension schema describes', async () => {
    const card = await json(get())
    expect(card.$schema).toBe(MCP_SERVER_CARD_SCHEMA)
    expect(card.$schema).toBe('https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json')
    // Required: $schema, name, version, description.
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/)
    expect(card.name).toBe('com.aglyn.app/mcp')
    expect(typeof card.version).toBe('string')
    expect(card.description.length).toBeGreaterThan(0)
    expect(card.description.length).toBeLessThanOrEqual(100)
    expect(card.title.length).toBeLessThanOrEqual(100)
    expect(card.websiteUrl).toMatch(/\/api#mcp$/)
    // No primitives, no capabilities, nothing secret.
    expect(card).not.toHaveProperty('tools')
    expect(card).not.toHaveProperty('capabilities')
    expect(JSON.stringify(card)).not.toMatch(/aglyn_(sk|at|rt)_[A-Za-z0-9]/)
  })

  it('describes the API key as an optional header, so a client without one signs in', async () => {
    const [header] = (await json(get())).remotes[0].headers
    expect(header).toMatchObject({ name: 'Authorization', isRequired: false, isSecret: true, value: 'Bearer {api_key}' })
    expect(header.variables.api_key).toMatchObject({ isRequired: false, isSecret: true })
  })

  it('serves its media type, open CORS, caching and an ETag', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(`${MCP_SERVER_CARD_MEDIA_TYPE}; charset=utf-8`)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-expose-headers')).toBe('ETag')
    expect(response.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]+"$/)
  })

  it('answers 304 to a matching If-None-Match, weak or strong, and to *', async () => {
    const etag = (await get()).headers.get('etag') as string
    expect((await get({ 'if-none-match': etag })).status).toBe(304)
    expect((await get({ 'if-none-match': `"other", W/${etag}` })).status).toBe(304)
    expect((await get({ 'if-none-match': '*' })).status).toBe(304)
    const miss = await get({ 'if-none-match': '"other"' })
    expect(miss.status).toBe(200)
  })

  it('is cacheable only where the origin cannot vary by request', async () => {
    // Tests run with no console URL configured, so the origin is the
    // request's and the card must not be shared between hosts.
    expect((await get()).headers.get('cache-control')).toBe('no-store')
  })

  it('404s on the auth origin, which serves no part of the API', async () => {
    expect((await get({}, 'https://auth.aglyn.com')).status).toBe(404)
    expect(serverCardPreflight(new Request(`https://auth.aglyn.com${MCP_SERVER_CARD_PATH}`, { method: 'OPTIONS' })).status).toBe(404)
  })

  it('answers a preflight, and a wrong method as a wrong method', async () => {
    const preflight = serverCardPreflight(new Request(`${ORIGIN}${MCP_SERVER_CARD_PATH}`, { method: 'OPTIONS' }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    const wrong = serverCardPost(new Request(`${ORIGIN}${MCP_SERVER_CARD_PATH}`, { method: 'POST' }))
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET, OPTIONS')
  })
})

describe('mcpServerCardName', () => {
  it('reverses the host into a namespace the schema and a registry accept', () => {
    expect(mcpServerCardName('https://app.aglyn.com')).toBe('com.aglyn.app/mcp')
    expect(mcpServerCardName('https://console.example.co.uk:8443')).toBe('uk.co.example.console/mcp')
    expect(mcpServerCardName('not a url')).toBe('local/mcp')
  })
})
