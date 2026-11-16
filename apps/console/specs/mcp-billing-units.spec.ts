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
 * `/api/mcp` bills a tool call by its size, and a protocol message by none
 * (AGL-4227). The POST is counted once by `authenticateApiV1`; `initialize`,
 * `tools/list`, `ping` and notifications are never weighed; a `tools/call` is
 * weighed by the request it dispatches and the response it gets, like the
 * REST call it is — the first one standing on the POST's unit, each after it
 * charged in full.
 */

const mockCharges: Array<{ requestBytes: number; responseBytes: number; alreadyCharged: number }> = []

jest.mock('../utils/api-v1', () => {
  const { apiRequestBillingUnits } = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  )
  return {
    __esModule: true,
    API_BILLING_UNITS_HEADER: 'X-Api-Billing-Units',
    apiRequestBodyBytes: async () => 0,
    authenticateApiV1: async () => ({
      context: { orgId: 'org-1', keyId: 'k', scopes: ['datasets:read'], headers: {}, org: {}, firestore: {} },
    }),
    // The connector's per-call charge (AGL-4225): every tool call after the
    // first is charged its first unit here, allowed.
    chargeApiV1Call: async () => ({ refusal: null, headers: {} }),
    chargeApiRequestSize: (_ctx: unknown, requestBytes: number, responseBytes: number, alreadyCharged = 1) => {
      mockCharges.push({ requestBytes, responseBytes, alreadyCharged })
      return apiRequestBillingUnits(requestBytes, responseBytes)
    },
  }
})

jest.mock('../utils/api-v1-resources', () => ({
  __esModule: true,
  describePluginApiV1Resources: async () =>
    jest.requireActual('../../../libs/plugins/data/src/lib/server/api-v1/openapi').DATASETS_API_V1_DESCRIPTION
      ? [jest.requireActual('../../../libs/plugins/data/src/lib/server/api-v1/openapi').DATASETS_API_V1_DESCRIPTION]
      : [],
  // A list answer of about 600 KB: three units.
  dispatchResource: async () => new Response(JSON.stringify({ object: 'list', data: 'x'.repeat(600 * 1024) })),
}))

import { POST } from '../app/api/mcp/route'

const rpc = (body: unknown) =>
  POST(
    new Request('https://app.aglyn.com/api/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  mockCharges.length = 0
})

describe('AGL-4227 · MCP billing units', () => {
  it('never weighs a protocol message', async () => {
    const response = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'ping' },
    ])
    expect(mockCharges).toEqual([])
    expect(response.headers.get('X-Api-Billing-Units')).toBe('1')
  })

  it('weighs a tool call by its response, on the unit the POST already counted', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'listDatasets', arguments: {} },
    })
    expect(mockCharges).toHaveLength(1)
    expect(mockCharges[0].alreadyCharged).toBe(1)
    expect(mockCharges[0].responseBytes).toBeGreaterThan(600 * 1024)
    expect(response.headers.get('X-Api-Billing-Units')).toBe('3')
  })

  it('charges every tool call after the first in full: its first unit by the per-call charge, the rest by size', async () => {
    const response = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'listDatasets', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'listDatasets', arguments: {} } },
    ])
    expect(mockCharges.map((charge) => charge.alreadyCharged)).toEqual([1, 1])
    expect(response.headers.get('X-Api-Billing-Units')).toBe('6')
  })
})
