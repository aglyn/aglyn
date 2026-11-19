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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { describeApiV1Resources } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { buildCustomerApiOpenApi } from '../utils/api-v1-openapi'
import {
  MCP_EXCLUDED_OPERATIONS,
  buildMcpTools,
  buildToolRequest,
  MCP_BODY_ARGUMENT,
  missingPathArguments,
} from '../utils/mcp-tools'

/**
 * The tools are DERIVED, so the thing worth asserting is the derivation
 * against the real document rather than against a fixture that agrees with it
 * by construction. `buildCustomerApiOpenApi` is the same builder
 * `/api/v1/openapi.json` serves.
 */
let DOCUMENT: ReturnType<typeof buildCustomerApiOpenApi>
let tools: ReturnType<typeof buildMcpTools>

// The console's boot, which registers the plugins' resources and their
// descriptions (AGL-3080) — the document the route serves.
beforeAll(async () => {
  await registerPluginServerDeclarations()
  DOCUMENT = buildCustomerApiOpenApi(
    {
      origin: 'https://app.example.com',
      documentationUrl: 'https://docs.example.com/api',
      brandName: PLATFORM_BRAND_NAME,
    },
    await describeApiV1Resources(),
  )
  tools = buildMcpTools(DOCUMENT)
})

describe('MCP tools derived from the v1 document (AGL-3091)', () => {

  it('turns every documented operation into exactly one tool, but the named exclusions', () => {
    const operations = Object.values(
      DOCUMENT.paths as Record<string, Record<string, Record<string, unknown>>>,
    ).flatMap((methods) =>
      Object.entries(methods).filter(([method]) =>
        ['get', 'post', 'patch', 'put', 'delete'].includes(method),
      ),
    )
    const ids = operations.map(([, operation]) => operation.operationId as string)
    const excluded = ids.filter((id) => id in MCP_EXCLUDED_OPERATIONS)
    expect(tools).toHaveLength(operations.length - excluded.length)
    expect(operations.length).toBeGreaterThan(50)
    // Every exclusion names an operation that exists, so a rename cannot
    // quietly turn the exclusion into a no-op.
    expect(excluded.sort()).toEqual(Object.keys(MCP_EXCLUDED_OPERATIONS).sort())
  })

  it('leaves the whole OpenAPI document out of tools/list, and says why (AGL-4225)', () => {
    expect(Object.keys(MCP_EXCLUDED_OPERATIONS)).toEqual(['getApiDescription'])
    expect(MCP_EXCLUDED_OPERATIONS.getApiDescription).toMatch(/whole OpenAPI document/)
    expect(tools.map((tool) => tool.name)).not.toContain('getApiDescription')
    // The other three service operations ARE tools.
    for (const name of ['getApiRoot', 'getKeyIdentity', 'getUsage']) {
      expect(tools.map((tool) => tool.name)).toContain(name)
    }
  })

  it('names every tool uniquely, which `tools/call` depends on', () => {
    const names = tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every tool a description a model can choose on', () => {
    expect(tools.filter((tool) => !tool.description.trim())).toEqual([])
  })

  it('requires a path parameter and leaves a query parameter optional', () => {
    const get = tools.find((tool) => tool.name === 'getDataset')
    expect(get?.inputSchema.required).toContain('datasetId')
    const list = tools.find((tool) => tool.name === 'listDatasets')
    const properties = list?.inputSchema.properties as Record<string, unknown>
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['limit', 'cursor']),
    )
    expect(list?.inputSchema.required ?? []).not.toContain('limit')
  })

  it('refuses an argument the operation never declared', () => {
    expect(
      tools.every((tool) => tool.inputSchema.additionalProperties === false),
    ).toBe(true)
  })

  it('nests the request body instead of flattening it into the parameters', () => {
    // Flattening is ambiguous the moment a body field and a query parameter
    // share a name, and which one won would depend on merge order.
    const create = tools.find((tool) => tool.name === 'createDataset')
    const properties = create?.inputSchema.properties as Record<string, unknown>
    expect(properties).toHaveProperty(MCP_BODY_ARGUMENT)
  })
})

describe('what a client is told about each tool (AGL-4225)', () => {
  it('names every tool within the 64 characters clients accept', () => {
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(64)
      expect(tool.name).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('titles every tool with its summary', () => {
    for (const tool of tools) expect(tool.title).toBeTruthy()
    expect(tools.find((tool) => tool.name === 'listSites')?.title).toBe('List sites')
  })

  it('marks every tool by its method, and every exception by name with its reason (AGL-4225)', () => {
    // Exhaustive over the real tool list, so a new operation is judged too.
    // POSTs that repeat safely: an upsert, a merge (the source is gone after
    // the first), a conversion that returns the same ids, a publish.
    const idempotentPosts = ['convertLead', 'createLead', 'mergeContact', 'publishSite']
    // What reaches past the workspace's own records, each for the reason the
    // operation states beside its flag: a public website or address, the
    // buyer's inbox, a DNS lookup of a new address's mail domain.
    const openWorld = ['convertLead', 'createContact', 'createLead', 'createSite', 'publishSite', 'updateOrder']
    const counts: Record<string, number> = {}
    for (const tool of tools) {
      counts[tool.method] = (counts[tool.method] ?? 0) + 1
      const expected = {
        title: tool.title,
        readOnlyHint: tool.method === 'GET',
        destructiveHint:
          tool.method === 'PATCH' || tool.method === 'DELETE' || tool.name === 'mergeContact',
        idempotentHint: tool.method !== 'POST' || idempotentPosts.includes(tool.name),
        openWorldHint: openWorld.includes(tool.name),
      }
      expect({ name: tool.name, ...tool.annotations }).toEqual({ name: tool.name, ...expected })
    }
    // Every method the document uses is present, so no branch above is vacuous.
    expect(Object.keys(counts).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST'])
  })

  it('marks a write the operation calls destructive — the contact merge removes a contact', () => {
    expect(tools.find((tool) => tool.name === 'mergeContact')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    })
  })

  it('hands over input schemas with no reference into a document the client never sees', () => {
    // A tool schema travels alone; `#/components/...` would point at nothing.
    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('#/components/')
    }
    const create = tools.find((tool) => tool.name === 'createSite')
    const body = (create?.inputSchema.properties as Record<string, Record<string, unknown>>)[MCP_BODY_ARGUMENT]
    expect(body.type).toBe('object')
    expect(body.properties).toBeDefined()
  })
})

describe('turning a tool call back into a v1 request (AGL-3091)', () => {
  const toolNamed = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (!tool) throw new Error(`no tool ${name}`)
    return tool
  }

  it('fills the path template and drops `v1` from the dispatch segments', () => {
    const { request, segments } = buildToolRequest(
      toolNamed('getDataset'),
      { datasetId: 'ds_1' },
      'https://app.example.com/api',
    )
    expect(request.url).toBe('https://app.example.com/api/v1/datasets/ds_1')
    // `dispatchResource` is handed what follows `/api/v1`, exactly as the
    // catch-all route hands it.
    expect(segments).toEqual(['datasets', 'ds_1'])
  })

  it('escapes a path argument rather than letting it add a segment', () => {
    const { request, segments } = buildToolRequest(
      toolNamed('getDataset'),
      { datasetId: 'a/b' },
      'https://app.example.com/api',
    )
    expect(request.url).toContain('a%2Fb')
    expect(segments).toHaveLength(2)
  })

  it('puts declared query arguments on the query string', () => {
    const { request } = buildToolRequest(
      toolNamed('listDatasets'),
      { limit: 5, cursor: 'abc' },
      'https://app.example.com/api',
    )
    const url = new URL(request.url)
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('cursor')).toBe('abc')
  })

  it('sends the body as JSON on a write', async () => {
    const { request } = buildToolRequest(
      toolNamed('createDataset'),
      { [MCP_BODY_ARGUMENT]: { name: 'Leads' } },
      'https://app.example.com/api',
    )
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ name: 'Leads' })
  })

  it('never puts a body on a GET', () => {
    const { request } = buildToolRequest(
      toolNamed('listDatasets'),
      { [MCP_BODY_ARGUMENT]: { nope: true } },
      'https://app.example.com/api',
    )
    expect(request.body).toBeNull()
  })

  it('names the path arguments a call left out or empty, in path order (AGL-4225)', () => {
    const tool = tools.find((candidate) => candidate.name === 'getProduct')!
    expect(missingPathArguments(tool, {})).toEqual(['siteId', 'productId'])
    expect(missingPathArguments(tool, { siteId: 's', productId: '' })).toEqual(['productId'])
    expect(missingPathArguments(tool, { siteId: 's', productId: 'p' })).toEqual([])
  })
})
