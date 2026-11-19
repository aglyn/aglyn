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
 * NO TOOL MAY BE ADVERTISED THAT THE TRANSPORT CANNOT ROUTE (AGL-4225).
 *
 * The first real connection called `getKeyIdentity` and was answered
 * `Unknown endpoint: /v1/me`, while `GET /api/v1/me` with the same token
 * answered 200. Four service tools had been advertised since the MCP server
 * shipped and none had ever been called: the route answered those paths
 * itself, and the MCP endpoint dispatched past it.
 *
 * So this takes the REAL tool list, built from the REAL OpenAPI document with
 * the plugins registered as the console boots them, and calls EVERY tool down
 * the exact code path `/api/mcp` uses — `buildToolRequest`, then
 * `serveApiV1` — against a data layer that holds nothing. What a call answers
 * is not the point (most say "not found": there is no data). What it must
 * never answer is the dispatcher's "Unknown endpoint", or a 405 from a router
 * that does not serve the method the tool was advertised with.
 */

const mockAuthenticate = jest.fn()
jest.mock('../utils/api-v1', () => ({
  ...jest.requireActual('../utils/api-v1'),
  authenticateApiV1: (...args: unknown[]) => mockAuthenticate(...args),
  chargeApiV1Call: async () => ({ refusal: null, headers: {} }),
}))

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { API_SCOPES } from '@aglyn/tenant-data-admin/server/api-keys'
import { describeApiV1Resources } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import type { ApiV1Context } from '../utils/api-v1'
import { buildCustomerApiOpenApi, CUSTOMER_API_MOUNT } from '../utils/api-v1-openapi'
import { serveApiV1 } from '../utils/api-v1-service'
import { POST as mcpPost } from '../app/api/mcp/route'
import { GET as restGet } from '../app/api/v1/[[...route]]/route'
import { buildMcpTools, buildToolRequest, MCP_BODY_ARGUMENT, type McpTool } from '../utils/mcp-tools'

const ORIGIN = 'https://app.example.com'

/** An empty query or document snapshot, whichever the caller reads. */
const EMPTY_SNAPSHOT = {
  exists: false,
  id: 'missing',
  empty: true,
  size: 0,
  docs: [],
  data: () => undefined,
  get: () => undefined,
  forEach: () => undefined,
  docChanges: () => [],
}

/** The site every site-scoped tool names (`minimalArguments` gives it). */
const SITE_ID = 'id-1'
/** The person the connected app acts for, a member of that site. */
const UID = 'user-1'

/**
 * The one document this data layer holds: the site, which the site router
 * reads before it dispatches (AGL-4235). Without it every site tool would be
 * answered "No such site" by the router, and the claim below — that every
 * tool reaches its handler — would be true of none of them.
 */
const SITE_DATA: Record<string, unknown> = {
  displayName: 'Routing check',
  subdomain: 'routing-check',
  memberRoles: { [UID]: 'admin' },
}
const SITE_SNAPSHOT = {
  ...EMPTY_SNAPSHOT,
  exists: true,
  id: SITE_ID,
  data: () => SITE_DATA,
  get: (field: string) => SITE_DATA[field],
}

/**
 * A Firestore that holds nothing but the site: every chain
 * (`collection().doc().get()`, `where().orderBy().limit().get()`,
 * `count().get()`) resolves to an empty snapshot, `hosts/{SITE_ID}` excepted,
 * and every write resolves. Not thenable itself, so an `await` on a reference
 * does not hang.
 */
function emptyFirestore(): FirebaseFirestore.Firestore {
  const at = (path: readonly string[]): unknown =>
    new Proxy(function chain() {}, {
      get(_target, key) {
        if (key === 'then') return undefined
        if (key === 'get') {
          const isSite = path.join('/') === `collection/hosts/doc/${SITE_ID}`
          return async () => (isSite ? SITE_SNAPSHOT : EMPTY_SNAPSHOT)
        }
        if (key === 'getAll') return async () => []
        if (key === 'count') return () => ({ get: async () => ({ data: () => ({ count: 0 }) }) })
        if (key === 'runTransaction') {
          // A transaction reads what the store holds: `tx.get(ref)` answers
          // what `ref.get()` answers, the site included, so a writer that
          // reads the site in its transaction finds it as the router did.
          type Readable = { get(): Promise<unknown> }
          const tx = {
            get: (ref: Readable) => ref.get(),
            getAll: (...refs: unknown[]) =>
              Promise.all(
                refs
                  .filter((ref): ref is Readable => typeof (ref as Readable)?.get === 'function')
                  .map((ref) => ref.get()),
              ),
            set: () => tx,
            update: () => tx,
            create: () => tx,
            delete: () => tx,
          }
          return async (fn: (tx: unknown) => unknown) => fn(tx)
        }
        if (['set', 'update', 'delete', 'create', 'commit', 'add'].includes(String(key))) {
          return async () => at(path)
        }
        if (key === 'id') return 'generated-id'
        if (key === 'path') return 'orgs/org-1'
        return at([...path, String(key)])
      },
      apply(_target, _this, args: unknown[]) {
        return at([...path, ...args.filter((arg): arg is string => typeof arg === 'string')])
      },
    })
  return at([]) as FirebaseFirestore.Firestore
}

/** The smallest arguments the tool's own schema accepts. */
function minimalArguments(tool: McpTool): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { enum?: unknown[]; type?: unknown }>
    required?: string[]
  }
  const args: Record<string, unknown> = {}
  for (const name of schema.required ?? []) {
    const property = schema.properties?.[name] ?? {}
    if (name === MCP_BODY_ARGUMENT) args[name] = {}
    else if (Array.isArray(property.enum) && property.enum.length) args[name] = property.enum[0]
    else if (property.type === 'integer' || property.type === 'number') args[name] = 1
    else args[name] = 'id-1'
  }
  return args
}

let tools: McpTool[]

beforeAll(async () => {
  await registerPluginServerDeclarations()
  tools = buildMcpTools(
    buildCustomerApiOpenApi(
      { origin: ORIGIN, documentationUrl: 'https://docs.example.com/api', brandName: PLATFORM_BRAND_NAME },
      await describeApiV1Resources(),
    ),
  )
})

describe('every advertised MCP tool routes (AGL-4225)', () => {
  it('builds the real tool list', () => {
    expect(tools.length).toBeGreaterThan(60)
  })

  it('answers every tool, called through POST /api/mcp, from a handler: never "Unknown endpoint", never a 405', async () => {
    const context: ApiV1Context = {
      orgId: 'org-1',
      keyId: 'grant_1',
      keyName: 'Routing check',
      credential: 'connected_app',
      uid: UID,
      // Every scope, so a scope refusal cannot stand in for routing.
      scopes: [...API_SCOPES],
      // The workspace owns the site every site tool names.
      org: { plan: 'pro', hosts: { [SITE_ID]: true } } as ApiV1Context['org'],
      firestore: emptyFirestore(),
      headers: {},
    }
    mockAuthenticate.mockResolvedValue({ context })
    const unrouted: string[] = []
    const refusedAtTheSite: string[] = []
    let reached = 0
    for (const tool of tools) {
      let text: string
      try {
        const response = await mcpPost(
          new Request(`${ORIGIN}/api/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer aglyn_at_x' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: tool.name, arguments: minimalArguments(tool) },
            }),
          }),
        )
        const answer = await response.json()
        text = answer.error ? `jsonrpc ${answer.error.message}` : String(answer.result?.content?.[0]?.text ?? '')
      } catch {
        // A throw from inside a handler means the call REACHED one; the empty
        // data layer is what failed. Routing is what this spec measures.
        reached += 1
        continue
      }
      reached += 1
      if (/Unknown endpoint|method_not_allowed|No tool named/.test(text)) {
        unrouted.push(`${tool.name} ${tool.method} ${tool.path} → ${text.slice(0, 120)}`)
      }
      // The site router let it through to the handler (AGL-4235).
      if (tool.path.includes('{siteId}') && /No such site/.test(text)) {
        refusedAtTheSite.push(`${tool.name} ${tool.method} ${tool.path}`)
      }
    }
    expect(unrouted).toEqual([])
    expect(refusedAtTheSite).toEqual([])
    expect(reached).toBe(tools.length)
  })

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const response = await mcpPost(
      new Request(`${ORIGIN}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer aglyn_at_x' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
    )
    return (await response.json()).result as { content: { text: string }[]; isError: boolean }
  }

  it('refuses a site-scoped call with no site by name, instead of misrouting it', async () => {
    mockAuthenticate.mockResolvedValue({
      context: {
        orgId: 'org-1', keyId: 'grant_1', keyName: 'x', credential: 'connected_app',
        scopes: [...API_SCOPES], org: { plan: 'pro' }, firestore: emptyFirestore(), headers: {},
      },
    })
    // The first real session called these with no arguments and was told
    // "No such site": `/v1/sites//orders` read as site `orders`.
    for (const name of ['listFormSubmissions', 'listOrders', 'listProducts', 'listBookings']) {
      const result = await callTool(name, {})
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: { type: 'bad_request', message: 'Missing required argument: siteId' },
      })
      expect((await callTool(name, { siteId: '  ' })).content[0].text).toMatch(/Missing required argument: siteId/)
    }
    expect((await callTool('getProduct', {})).content[0].text).toMatch(/Missing required arguments: siteId, productId/)
  })

  it('tells a model, on every site-scoped tool, that the site is required and where its id comes from', () => {
    const siteScoped = tools.filter((tool) => tool.path.includes('{siteId}'))
    expect(siteScoped.length).toBeGreaterThan(10)
    for (const tool of siteScoped) {
      const schema = tool.inputSchema as { required?: string[]; properties: Record<string, { description?: string }> }
      expect(schema.required).toContain('siteId')
      expect(schema.properties.siteId.description).toMatch(/^Required\..*`listSites`/)
    }
  })

  it('answers each service tool with the bytes GET /api/v1 answers', async () => {
    const context = {
      orgId: 'org-1', keyId: 'grant_1', keyName: 'Claude', credential: 'connected_app' as const,
      scopes: [...API_SCOPES], org: { plan: 'pro' }, firestore: emptyFirestore(), headers: {},
    }
    mockAuthenticate.mockResolvedValue({ context })
    const rest = async (route: string[]) =>
      (await restGet(new Request(`${ORIGIN}/api/v1/${route.join('/')}`), { params: Promise.resolve({ route }) })).text()
    expect((await callTool('getKeyIdentity', {})).content[0].text).toBe(await rest(['me']))
    expect((await callTool('getApiRoot', {})).content[0].text).toBe(await rest([]))
    expect((await callTool('getUsage', {})).content[0].text).toBe(await rest(['usage']))
  })

  it('still serves the OpenAPI document over REST without a key, and spends no authentication', async () => {
    mockAuthenticate.mockClear()
    const response = await restGet(new Request(`${ORIGIN}/api/v1/openapi.json`), {
      params: Promise.resolve({ route: ['openapi.json'] }),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).openapi).toBe('3.1.0')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(mockAuthenticate).not.toHaveBeenCalled()
  })

  it('answers the three service tools with what /api/v1 answers', async () => {
    const context: ApiV1Context = {
      orgId: 'org-1',
      keyId: 'grant_1',
      keyName: 'Claude',
      credential: 'connected_app',
      scopes: ['sites:read'],
      org: { plan: 'pro' } as ApiV1Context['org'],
      firestore: emptyFirestore(),
      headers: { 'X-RateLimit-Limit': '120' },
    }
    const call = async (name: string) => {
      const tool = tools.find((candidate) => candidate.name === name) as McpTool
      const { request, segments } = buildToolRequest(tool, {}, `${ORIGIN}${CUSTOMER_API_MOUNT}`)
      return serveApiV1(request, context, segments)
    }

    const me = await call('getKeyIdentity')
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({
      object: 'connected_app',
      org: 'org-1',
      name: 'Claude',
      scopes: ['sites:read'],
    })
    expect(me.headers.get('X-RateLimit-Limit')).toBe('120')

    const root = await call('getApiRoot')
    expect(root.status).toBe(200)
    expect(await root.json()).toMatchObject({ object: 'api', version: 'v1', mcp: '/api/mcp' })

    const usage = await call('getUsage')
    expect(await usage.text()).not.toMatch(/Unknown endpoint/)
  })
})
