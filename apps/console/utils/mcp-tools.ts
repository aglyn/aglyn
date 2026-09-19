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

/**
 * A JSON Schema / OpenAPI fragment, as loosely as the document builder itself
 * types them (`api-v1-openapi.ts`). Declared here rather than imported so this
 * module can be read, and tested, without pulling the builder in behind it.
 */
type Schema = Record<string, unknown>

/**
 * MCP TOOLS, DERIVED FROM THE `/api/v1` OPENAPI DOCUMENT (AGL-3091).
 *
 * The tools are not written down anywhere. They are read out of the same
 * description `/api/v1/openapi.json` publishes, so the surface an agent is
 * handed and the surface a human reads can never disagree, and an operation
 * added to `RESOURCES` arrives as a tool without anyone remembering to add
 * one. Every operation already carries the two things a tool needs — a unique
 * `operationId` and a summary — because the document is graded on it.
 */

/** One MCP tool, and everything needed to execute it against `/api/v1`. */
export interface McpTool {
  /** The operationId, which the document guarantees is unique. */
  readonly name: string
  readonly description: string
  /** JSON Schema for the arguments, as `tools/list` reports it. */
  readonly inputSchema: Schema
  readonly method: string
  /** The path template, e.g. `/v1/datasets/{datasetId}`. */
  readonly path: string
}

const METHODS = new Set(['get', 'post', 'patch', 'put', 'delete'])

/**
 * The request body arrives as ONE `body` object rather than flattened beside
 * the path and query arguments.
 *
 * Flattening reads better in a tool list right up to the first collision — a
 * `limit` query parameter beside a `limit` body field would silently become
 * one argument, and which of the two it reached would depend on the order the
 * properties happened to be merged in. Nesting costs a model one level of
 * indirection and cannot be ambiguous.
 */
export const MCP_BODY_ARGUMENT = 'body'

/** `{a}` in a path template, e.g. `{datasetId}`. */
const PATH_PARAM = /\{([^}]+)\}/g

function describeOperation(operation: Schema): string {
  const summary = typeof operation.summary === 'string' ? operation.summary : ''
  const detail =
    typeof operation.description === 'string' ? operation.description : ''
  // Both, when both exist: the summary names the verb and the description
  // carries the caveats, and a model choosing between tools needs the verb.
  return [summary, detail].filter(Boolean).join('\n\n')
}

/**
 * The arguments schema: path parameters, then query parameters, then the
 * request body under `body`.
 *
 * Path parameters are required because the URL cannot be built without them.
 * Everything else follows what the document says, so a required body field
 * stays required inside `body` rather than being promoted or dropped.
 */
function buildInputSchema(operation: Schema): Schema {
  const properties: Record<string, Schema> = {}
  const required: string[] = []

  const parameters = Array.isArray(operation.parameters)
    ? (operation.parameters as Schema[])
    : []
  for (const parameter of parameters) {
    const name = typeof parameter.name === 'string' ? parameter.name : ''
    if (!name) continue
    const schema = (parameter.schema as Schema) ?? { type: 'string' }
    properties[name] =
      typeof parameter.description === 'string'
        ? { ...schema, description: parameter.description }
        : schema
    if (parameter.in === 'path' || parameter.required === true) required.push(name)
  }

  const bodySchema = (operation.requestBody as Schema)?.content as
    | Record<string, Schema>
    | undefined
  const json = bodySchema?.['application/json']?.schema as Schema | undefined
  if (json) {
    properties[MCP_BODY_ARGUMENT] = {
      ...json,
      description:
        typeof json.description === 'string'
          ? json.description
          : 'The request body.',
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    // Named arguments only. A model that invents one should be told so by the
    // schema rather than have it silently dropped on the way to the handler.
    additionalProperties: false,
  }
}

/**
 * Every operation in the document, as a tool.
 *
 * Nothing is filtered here. The document describes exactly the customer API,
 * so a filter would be a second opinion about what the API is, kept in a
 * second place, free to drift from the first.
 */
export function buildMcpTools(document: Schema): McpTool[] {
  const paths = (document.paths as Record<string, Schema>) ?? {}
  const tools: McpTool[] = []
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(
      operations as Record<string, Schema>,
    )) {
      if (!METHODS.has(method)) continue
      const name = (operation as Schema).operationId
      if (typeof name !== 'string' || !name) continue
      tools.push({
        name,
        description: describeOperation(operation as Schema),
        inputSchema: buildInputSchema(operation as Schema),
        method: method.toUpperCase(),
        path,
      })
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name))
}

/** The arguments a tool call may carry. */
export type McpToolArguments = Record<string, unknown>

/**
 * Build the request `dispatchResource` would have received over HTTP.
 *
 * The path template is filled from the arguments, whatever is left that the
 * schema declared as a parameter becomes the query string, and `body` becomes
 * the JSON body. `segments` drops the leading `v1`, because the route's
 * catch-all is mounted under `/api/v1` and hands the resource dispatcher what
 * follows it.
 *
 * `apiBaseUrl` is the origin joined to the mount — `CUSTOMER_API_MOUNT`, the
 * same constant the published `servers` entry is built from (AGL-3094). It is
 * passed in rather than rebuilt here so there is exactly one answer in the
 * codebase to where the API lives.
 */
export function buildToolRequest(
  tool: McpTool,
  args: McpToolArguments,
  apiBaseUrl: string,
): { request: Request; segments: string[] } {
  const consumed = new Set<string>()
  const path = tool.path.replace(PATH_PARAM, (_, key: string) => {
    consumed.add(key)
    return encodeURIComponent(String(args[key] ?? ''))
  })

  const url = new URL(`${apiBaseUrl.replace(/\/+$/, '')}${path}`)
  const properties =
    ((tool.inputSchema.properties as Record<string, Schema>) ?? {})
  for (const key of Object.keys(properties)) {
    if (key === MCP_BODY_ARGUMENT || consumed.has(key)) continue
    const value = args[key]
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }

  const body = args[MCP_BODY_ARGUMENT]
  const hasBody = body !== undefined && tool.method !== 'GET'
  const request = new Request(url, {
    method: tool.method,
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  })

  const segments = path.split('/').filter(Boolean).slice(1)
  return { request, segments }
}
