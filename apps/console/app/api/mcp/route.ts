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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { ApiErrors, apiJson } from '@aglyn/tenant-data-admin'
import { buildDocsUrl } from '../../../constants/docs-links'
import { authenticateApiV1 } from '../../../utils/api-v1'
import {
  buildCustomerApiOpenApi,
  CUSTOMER_API_MOUNT,
  CUSTOMER_API_VERSION,
} from '../../../utils/api-v1-openapi'
import { dispatchResource } from '../../../utils/api-v1-resources'
import {
  handleMcpMessage,
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from '../../../utils/mcp-protocol'
import { buildMcpTools, buildToolRequest } from '../../../utils/mcp-tools'

/**
 * THE MCP ENDPOINT (AGL-3091).
 *
 * A second transport over `/api/v1`, never a second implementation of it. A
 * tool call is turned back into the request the resource dispatcher would have
 * received over HTTP and handed to `dispatchResource`, so auth, entitlement,
 * plan refusals, scope refusals, rate limiting and the error envelope are the
 * ones the REST API already has. The tools themselves are read out of the
 * published OpenAPI document, so the surface cannot drift from what `/api/v1`
 * says it serves.
 *
 * Auth is the same `Authorization: Bearer aglyn_sk_…` key, verified by the
 * same `authenticateApiV1`, before any message is parsed. `/api/*` is outside
 * the console middleware matcher, so this route carries its own gate exactly
 * as `/v1` does — the console session is never the credential here.
 */
// lockdown-423: via apps/console/utils/api-v1.ts — every tool call is
// authenticated there before it reaches `dispatchResource`, so the verdict runs
// beside the org-doc read exactly as it does for `/v1`. This route adds no
// second door into the same handlers.

export const dynamic = 'force-dynamic'

/** What `initialize` reports, and what a client shows the person approving it. */
const SERVER_NAME = `${PLATFORM_BRAND_NAME} API`

/**
 * A model is handed the API's own JSON, verbatim.
 *
 * The alternative — prose summarizing what came back — would be a second
 * description of the payload, written here, free to disagree with the schema
 * the document publishes. The envelope is already typed and already
 * documented; the honest thing to hand over is the envelope.
 */
async function readOutcome(response: Response) {
  const text = await response.text()
  return { text, isError: !response.ok }
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateApiV1(request)
  if (authenticated instanceof Response) return authenticated
  const context = authenticated.context

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return apiJson(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_ERRORS.parseError, message: 'Invalid JSON' },
      },
      { status: 400, headers: context.headers },
    )
  }

  const origin = new URL(request.url).origin
  const tools = buildMcpTools(
    buildCustomerApiOpenApi({
      origin,
      documentationUrl: buildDocsUrl('/api'),
      brandName: PLATFORM_BRAND_NAME,
    }),
  )

  const deps = {
    tools,
    serverName: SERVER_NAME,
    serverVersion: CUSTOMER_API_VERSION,
    async callTool(name: string, args: Record<string, unknown>) {
      const tool = tools.find((candidate) => candidate.name === name)
      // Unreachable: the handler checks the name against this same list before
      // calling. Answered rather than asserted because a throw here would be
      // reported as a transport failure for what is a naming mistake.
      if (!tool) return { text: `No tool named ${name}`, isError: true }
      const { request: toolRequest, segments } = buildToolRequest(
        tool,
        args,
        `${origin}${CUSTOMER_API_MOUNT}`,
      )
      return readOutcome(await dispatchResource(toolRequest, context, segments))
    },
  }

  // A batch is answered as a batch, and a batch of notifications alone is
  // answered with no body at all — both are the JSON-RPC rules, and a client
  // that sends one is entitled to the matching shape.
  const messages = Array.isArray(payload)
    ? (payload as JsonRpcMessage[])
    : [payload as JsonRpcMessage]
  const responses: JsonRpcResponse[] = []
  for (const message of messages) {
    const response = await handleMcpMessage(message, deps)
    if (response) responses.push(response)
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: context.headers })
  }

  return apiJson(Array.isArray(payload) ? responses : responses[0], {
    headers: {
      ...context.headers,
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    },
  })
}

/**
 * No server-initiated stream. A stateless server has no session to attach one
 * to, and the specification lets a server answer `GET` with 405 to say so —
 * which is a clearer answer to a client than an SSE stream that never emits.
 */
export function GET(): Response {
  return ApiErrors.methodNotAllowed({ headers: { Allow: 'POST' } })
}
