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
import { connectorResourceMetadataUrl } from '@aglyn/aglyn/app-utils/connector-discovery'
import { ApiErrors, apiJson, readCappedBody, withResponseHeaders } from '@aglyn/tenant-data-admin'
import { connectorOrigin, refuseOnAuthOrigin, unconfiguredOriginResponse } from '../_lib/connector-oauth-http'
import { buildDocsUrl } from '../../../constants/docs-links'
import {
  API_BILLING_UNITS_HEADER,
  apiRequestBodyBytes,
  authenticateApiV1,
  chargeApiRequestSize,
  chargeApiV1Call,
} from '../../../utils/api-v1'
import {
  buildCustomerApiOpenApi,
  CUSTOMER_API_MOUNT,
  CUSTOMER_API_VERSION,
} from '../../../utils/api-v1-openapi'
import { describePluginApiV1Resources } from '../../../utils/api-v1-resources'
import { serveApiV1 } from '../../../utils/api-v1-service'
import {
  handleMcpMessage,
  JSON_RPC_ERRORS,
  MCP_SERVER_TITLE,
  type JsonRpcMessage,
  negotiateProtocolVersion,
  type JsonRpcResponse,
} from '../../../utils/mcp-protocol'
import { buildMcpTools, buildToolRequest, missingPathArguments } from '../../../utils/mcp-tools'

/**
 * THE MCP ENDPOINT (AGL-3091).
 *
 * A second transport over `/api/v1`, never a second implementation of it. A
 * tool call is turned back into the request the resource dispatcher would have
 * received over HTTP and handed to `serveApiV1`, so auth, entitlement,
 * plan refusals, scope refusals, rate limiting and the error envelope are the
 * ones the REST API already has. The tools themselves are read out of the
 * published OpenAPI document, so the surface cannot drift from what `/api/v1`
 * says it serves.
 *
 * Auth is an `Authorization: Bearer` credential — an `aglyn_sk_…` key, or
 * the hourly `aglyn_at_…` token an app such as Claude gets by signing in
 * (AGL-4225) — verified by the same `authenticateApiV1`, before any message
 * is parsed. `/api/*` is outside the console middleware matcher, so this
 * route carries its own gate exactly as `/v1` does — the console session is
 * never the credential here.
 *
 * A 401 names where sign-in is described (RFC 9728 §5.1): that challenge is
 * how a client that was handed only this URL finds out it can sign in, and
 * which server to ask. `/api/v1` answers its 401 unchanged.
 */
// lockdown-423: via apps/console/utils/api-v1.ts — every tool call is
// authenticated there before it reaches `serveApiV1`, so the verdict runs
// beside the org-doc read exactly as it does for `/v1`. This route adds no
// second door into the same handlers.

export const dynamic = 'force-dynamic'

/**
 * What `initialize` reports, and what a client shows the person approving it.
 * The same value the server card (`./server-card`) publishes as its `title`.
 */
const SERVER_NAME = MCP_SERVER_TITLE

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

/**
 * The largest request read, in bytes. A tool call can carry a file upload as
 * base64 — the `/v1` media create takes one — so this sits just above what
 * the hosting platform itself accepts (4.5 MB on Vercel) and exists for the
 * deployments without that ceiling.
 */
const MCP_MAX_BODY_BYTES = 6 * 1024 * 1024

/**
 * The most messages one JSON-RPC batch may carry. Every `tools/call` in a
 * batch is charged as a request of its own (see `callTool`), so this bounds
 * how much work one HTTP request can queue, not what it is billed.
 */
const MCP_MAX_BATCH = 20

/**
 * The challenge a 401 carries, so a client can discover sign-in. Only the
 * 401: a 403 or a 429 is about a credential that WAS recognised, and sending
 * the client off to sign in again would not help it.
 */
function withSignInChallenge(response: Response, origin: string): Response {
  if (response.status !== 401) return response
  return withResponseHeaders(response, {
    'WWW-Authenticate': `Bearer resource_metadata="${connectorResourceMetadataUrl(origin)}"`,
  })
}

/**
 * CORS for a browser-based MCP client — an inspector, a web IDE. Any origin,
 * because the endpoint is authenticated by a bearer credential in a header
 * and by nothing a browser attaches on its own: no cookie is read here, and
 * credentialed requests are never allowed. The 401's `WWW-Authenticate` and
 * the negotiated `MCP-Protocol-Version` are exposed so such a client can
 * read them; the rate-limit headers so it can pace itself.
 */
const MCP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers':
    'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-RateLimit-Scope, X-Workspace-RateLimit-Limit, X-Workspace-RateLimit-Remaining, X-Workspace-RateLimit-Reset, X-Api-Billing-Units',
  'Access-Control-Max-Age': '600',
}

export function OPTIONS(request: Request): Response {
  return refuseOnAuthOrigin(request) ?? new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

export async function POST(request: Request): Promise<Response> {
  const elsewhere = refuseOnAuthOrigin(request)
  if (elsewhere) return elsewhere
  return withResponseHeaders(await answer(request), MCP_CORS_HEADERS)
}

async function answer(request: Request): Promise<Response> {
  const resolved = connectorOrigin(request)
  if (!resolved) return unconfiguredOriginResponse()
  const { origin } = resolved
  const authenticated = await authenticateApiV1(request)
  if (authenticated instanceof Response) return withSignInChallenge(authenticated, origin)
  const context = authenticated.context
  const refuse = (status: number, code: number, message: string) =>
    apiJson({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers: context.headers })

  const text = await readCappedBody(request, MCP_MAX_BODY_BYTES)
  if (text === null) return refuse(413, JSON_RPC_ERRORS.invalidRequest, 'Request too large')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return refuse(400, JSON_RPC_ERRORS.parseError, 'Invalid JSON')
  }
  if (Array.isArray(payload) && (payload.length === 0 || payload.length > MCP_MAX_BATCH)) {
    return refuse(400, JSON_RPC_ERRORS.invalidRequest, `A batch carries 1 to ${MCP_MAX_BATCH} messages`)
  }

  const tools = buildMcpTools(
    buildCustomerApiOpenApi(
      {
        origin,
        documentationUrl: buildDocsUrl('/api'),
        brandName: PLATFORM_BRAND_NAME,
      },
      await describePluginApiV1Resources(),
    ),
  )

  let callsMade = 0
  let latestHeaders: Record<string, string> = context.headers
  // Billed units across this POST (AGL-4227). The POST was counted once by
  // `authenticateApiV1`, and protocol messages (`initialize`, `tools/list`,
  // `ping`, notifications) are never size-weighted. A `tools/call` is
  // weighed by the request it dispatches and the response it gets, like the
  // REST call it is: its first unit is the one already charged for it — the
  // POST's for the first call, `chargeApiV1Call`'s for each after it
  // (AGL-4225) — and the units past that are added by size.
  let billedUnits = 1
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
      // The request's own charge pays for its first tool call; every later
      // one in a batch is charged as a request of its own, and one the budget
      // no longer covers is refused by itself, with the API's own 429 body,
      // rather than run silently past the limit (AGL-4225).
      callsMade += 1
      if (callsMade > 1) {
        const charged = await chargeApiV1Call(context)
        // The response reports the budget as it stands after the LAST charge.
        latestHeaders = charged.headers
        if (charged.refusal) return readOutcome(charged.refusal)
      }
      // A missing path argument would misroute rather than fail; refuse it by
      // name, in the API's own envelope, before anything is dispatched.
      const missing = missingPathArguments(tool, args)
      if (missing.length > 0) {
        return readOutcome(
          ApiErrors.badRequest({
            message: `Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
            headers: context.headers,
          }),
        )
      }
      const { request: toolRequest, segments } = buildToolRequest(
        tool,
        args,
        `${origin}${CUSTOMER_API_MOUNT}`,
      )
      const requestBytes = await apiRequestBodyBytes(toolRequest)
      // The same function the `/api/v1` route answers with, service paths
      // included (AGL-4225): a tool is a path that route serves.
      const outcome = await readOutcome(await serveApiV1(toolRequest, context, segments))
      const units = chargeApiRequestSize(
        context,
        requestBytes,
        new TextEncoder().encode(outcome.text).byteLength,
        1,
      )
      // The POST's own unit stands for the first call's; every later call's
      // first unit was charged above, so each adds its whole size.
      billedUnits += callsMade === 1 ? units - 1 : units
      return outcome
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

  const unitsHeader = { [API_BILLING_UNITS_HEADER]: String(billedUnits) }
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: { ...latestHeaders, ...unitsHeader } })
  }

  return apiJson(Array.isArray(payload) ? responses : responses[0], {
    headers: {
      ...latestHeaders,
      ...unitsHeader,
      'MCP-Protocol-Version': answeredVersion(messages, request),
    },
  })
}

/**
 * The revision this answer is in: what `initialize` negotiated when the
 * request is one, otherwise what the client says it speaks in its
 * `MCP-Protocol-Version` header, held to the revisions this server serves.
 */
function answeredVersion(messages: readonly JsonRpcMessage[], request: Request): string {
  const initialize = messages.find((message) => message?.method === 'initialize')
  if (initialize) {
    return negotiateProtocolVersion((initialize.params as { protocolVersion?: unknown } | undefined)?.protocolVersion)
  }
  return negotiateProtocolVersion(request.headers.get('mcp-protocol-version'))
}

/**
 * No server-initiated stream. A stateless server has no session to attach one
 * to, and the specification lets a server answer `GET` with 405 to say so —
 * which is a clearer answer to a client than an SSE stream that never emits.
 */
export function GET(request: Request): Response {
  return (
    refuseOnAuthOrigin(request) ??
    ApiErrors.methodNotAllowed({ headers: { Allow: 'POST', ...MCP_CORS_HEADERS } })
  )
}
