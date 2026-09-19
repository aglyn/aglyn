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
import { buildCustomerApiOpenApi } from '../utils/api-v1-openapi'
import {
  buildMcpTools,
  buildToolRequest,
  MCP_BODY_ARGUMENT,
} from '../utils/mcp-tools'

/**
 * The tools are DERIVED, so the thing worth asserting is the derivation
 * against the real document rather than against a fixture that agrees with it
 * by construction. `buildCustomerApiOpenApi` is the same builder
 * `/api/v1/openapi.json` serves.
 */
const DOCUMENT = buildCustomerApiOpenApi({
  origin: 'https://app.example.com',
  documentationUrl: 'https://docs.example.com/api',
  brandName: PLATFORM_BRAND_NAME,
})

describe('MCP tools derived from the v1 document (AGL-3091)', () => {
  const tools = buildMcpTools(DOCUMENT)

  it('turns every documented operation into exactly one tool', () => {
    const operations = Object.values(
      DOCUMENT.paths as Record<string, Record<string, unknown>>,
    ).flatMap((methods) =>
      Object.entries(methods).filter(([method]) =>
        ['get', 'post', 'patch', 'put', 'delete'].includes(method),
      ),
    )
    expect(tools).toHaveLength(operations.length)
    expect(operations.length).toBeGreaterThan(50)
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

describe('turning a tool call back into a v1 request (AGL-3091)', () => {
  const tools = buildMcpTools(DOCUMENT)
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
})
