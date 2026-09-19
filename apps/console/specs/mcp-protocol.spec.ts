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

import {
  handleMcpMessage,
  isNotification,
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  type McpHandlerDeps,
} from '../utils/mcp-protocol'

/**
 * The wire shape, asserted directly. This server writes the protocol out
 * rather than taking the reference SDK — see the header of `mcp-protocol.ts`
 * for why — so the envelope a real client reads is what these pin.
 */
const TOOL = {
  name: 'listDatasets',
  description: 'List datasets',
  inputSchema: { type: 'object', properties: {} },
  method: 'GET',
  path: '/v1/datasets',
}

function deps(overrides: Partial<McpHandlerDeps> = {}): McpHandlerDeps {
  return {
    tools: [TOOL],
    serverName: 'Test API',
    serverVersion: 'v1',
    callTool: async () => ({ text: '{"object":"list"}', isError: false }),
    ...overrides,
  }
}

describe('the MCP handshake (AGL-3091)', () => {
  it('answers initialize with a version, a capability and an identity', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      deps(),
    )
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        // Tools only. A capability declared but not served is a promise a
        // client will call and be refused on.
        capabilities: { tools: {} },
        serverInfo: { name: 'Test API', version: 'v1' },
      },
    })
  })

  it('answers the initialized notification with nothing at all', async () => {
    expect(
      await handleMcpMessage(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        deps(),
      ),
    ).toBeNull()
  })

  it('answers ping, and stays silent when ping is a notification', async () => {
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', id: 'p', method: 'ping' }, deps()),
    ).toEqual({ jsonrpc: '2.0', id: 'p', result: {} })
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'ping' }, deps()),
    ).toBeNull()
  })

  it('reads a message with no id as a notification', () => {
    expect(isNotification({ jsonrpc: '2.0', method: 'ping' })).toBe(true)
    // `null` is a real id, not an absent one.
    expect(isNotification({ jsonrpc: '2.0', id: null, method: 'ping' })).toBe(false)
  })
})

describe('tools over the wire (AGL-3091)', () => {
  it('lists a tool with the three fields a client reads', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      deps(),
    )
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'listDatasets',
            description: 'List datasets',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    })
  })

  it('calls a tool and hands back the API’s own envelope', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'listDatasets', arguments: { limit: 5 } },
      },
      deps(),
    )
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [{ type: 'text', text: '{"object":"list"}' }],
        isError: false,
      },
    })
  })

  it('reports an API refusal as a TOOL error, not a transport one', async () => {
    // The call reached the server and ran. A JSON-RPC error would tell the
    // model the request never happened, and it would retry the wrong thing.
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'listDatasets' },
      },
      deps({
        callTool: async () => ({
          text: '{"error":{"code":"insufficient_scope"}}',
          isError: true,
        }),
      }),
    )
    expect(response).toMatchObject({ result: { isError: true } })
    expect(response).not.toHaveProperty('error')
  })

  it('refuses a tool it does not have as method-not-found', async () => {
    const response = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'deleteEverything' },
      },
      deps(),
    )
    expect(response).toMatchObject({
      error: { code: JSON_RPC_ERRORS.methodNotFound },
    })
  })

  it('does not run a tool call that names nothing', async () => {
    const callTool = jest.fn()
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: {} },
      deps({ callTool }),
    )
    expect(response).toMatchObject({
      error: { code: JSON_RPC_ERRORS.invalidParams },
    })
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe('malformed traffic (AGL-3091)', () => {
  it('refuses a message that is not JSON-RPC 2.0', async () => {
    expect(
      await handleMcpMessage({ id: 7, method: 'ping' }, deps()),
    ).toMatchObject({ error: { code: JSON_RPC_ERRORS.invalidRequest } })
  })

  it('refuses an unsupported method', async () => {
    expect(
      await handleMcpMessage(
        { jsonrpc: '2.0', id: 8, method: 'resources/list' },
        deps(),
      ),
    ).toMatchObject({ error: { code: JSON_RPC_ERRORS.methodNotFound } })
  })

  it('stays silent on a malformed NOTIFICATION, which may never be answered', async () => {
    expect(await handleMcpMessage({ method: 'ping' }, deps())).toBeNull()
    expect(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'resources/list' }, deps()),
    ).toBeNull()
  })
})
