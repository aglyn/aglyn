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

import type { McpTool } from './mcp-tools'

/**
 * THE MCP WIRE PROTOCOL, STATELESS (AGL-3091).
 *
 * MCP is JSON-RPC 2.0, and the Streamable HTTP transport is that carried over
 * a POST. The specification allows a server to answer a request with a single
 * JSON object instead of opening an SSE stream, and a server that holds no
 * session between calls is the shape this belongs in: the route is serverless,
 * so there is no instance for a session to live on, and every call already
 * carries the one piece of state that matters — the API key.
 *
 * Written out rather than taken from the reference SDK, and the reason is the
 * checkout rather than the protocol. `node_modules` is one directory shared by
 * the main checkout and every agent worktree beside it, so installing a
 * dependency mutates the tree other sessions are mid-build against; a
 * dependency that cannot be installed here cannot be verified here either. The
 * surface below is `initialize`, `tools/list`, `tools/call` and `ping`, and
 * every one of them is asserted against the wire shape in
 * `specs/mcp-protocol.spec.ts`.
 */

/** The protocol revision this server implements. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** JSON-RPC 2.0 error codes, plus nothing of our own. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

export interface JsonRpcMessage {
  readonly jsonrpc?: unknown
  readonly id?: string | number | null
  readonly method?: unknown
  readonly params?: unknown
}

export type JsonRpcResult = { jsonrpc: '2.0'; id: string | number | null; result: unknown }
export type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string }
}
export type JsonRpcResponse = JsonRpcResult | JsonRpcFailure

/** What a tool call produced, in the shape `tools/call` reports it. */
export interface McpToolOutcome {
  /** Serialized result — the API's own JSON envelope, verbatim. */
  readonly text: string
  /** A refusal from the API is a tool error, never a transport error. */
  readonly isError: boolean
}

export interface McpHandlerDeps {
  readonly tools: readonly McpTool[]
  readonly serverName: string
  readonly serverVersion: string
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolOutcome>
}

const ok = (id: string | number | null, result: unknown): JsonRpcResult => ({
  jsonrpc: '2.0',
  id,
  result,
})
const fail = (
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcFailure => ({ jsonrpc: '2.0', id, error: { code, message } })

/** A message with no `id` is a NOTIFICATION and is answered with nothing. */
export function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined
}

/**
 * Answer one JSON-RPC message, or `null` for a notification.
 *
 * A tool that throws is reported as a tool error rather than a transport one:
 * the call reached the server and the server ran it, so `isError` on the
 * result is the truthful frame, and a model can read it and try something
 * else. A JSON-RPC error would say the request never happened.
 */
export async function handleMcpMessage(
  message: JsonRpcMessage,
  deps: McpHandlerDeps,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null

  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isNotification(message)
      ? null
      : fail(id, JSON_RPC_ERRORS.invalidRequest, 'Not a JSON-RPC 2.0 request')
  }

  switch (message.method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        // Tools only. Declaring a capability this server does not serve would
        // have a client call it and be refused for a reason it cannot act on.
        capabilities: { tools: {} },
        serverInfo: { name: deps.serverName, version: deps.serverVersion },
      })

    case 'notifications/initialized':
      return null

    case 'ping':
      return isNotification(message) ? null : ok(id, {})

    case 'tools/list':
      return ok(id, {
        tools: deps.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      })

    case 'tools/call': {
      const params = (message.params ?? {}) as {
        name?: unknown
        arguments?: unknown
      }
      if (typeof params.name !== 'string') {
        return fail(id, JSON_RPC_ERRORS.invalidParams, 'A tool name is required')
      }
      if (!deps.tools.some((tool) => tool.name === params.name)) {
        // Method-not-found, deliberately: the tool is not part of this
        // server's surface, which is a different fact from a call that ran
        // and was refused.
        return fail(
          id,
          JSON_RPC_ERRORS.methodNotFound,
          `No tool named ${params.name}`,
        )
      }
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {}
      const outcome = await deps.callTool(params.name, args)
      return ok(id, {
        content: [{ type: 'text', text: outcome.text }],
        isError: outcome.isError,
      })
    }

    default:
      return isNotification(message)
        ? null
        : fail(
            id,
            JSON_RPC_ERRORS.methodNotFound,
            `Unsupported method ${message.method}`,
          )
  }
}
