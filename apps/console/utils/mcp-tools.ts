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

/**
 * What a client may assume about a tool before calling it (MCP
 * `ToolAnnotations`). Hints, not guarantees — the API's own scope and plan
 * checks are what actually decide.
 */
export interface McpToolAnnotations {
  /**
   * The tool's human name, repeated from the tool's own `title` (AGL-4225).
   * MCP's `ToolAnnotations` defines `title` too, and the Claude directory reads
   * it from here; the top-level field is the current specification's.
   */
  readonly title: string
  /** A GET: reads and changes nothing. */
  readonly readOnlyHint: boolean
  /**
   * MCP defines `false` as "only adds". So it is `true` for anything that can
   * overwrite or remove what is there — PATCH, PUT, DELETE, or a write the
   * operation marks `x-destructive` — and `false` only for a POST that
   * creates. Meaningless on a read, where it is `false`.
   */
  readonly destructiveHint: boolean
  /**
   * Calling again with the same arguments changes nothing further. True for
   * every GET, PATCH and DELETE by their method, and for a POST the operation
   * marks `x-idempotent` (an upsert, a conversion, a publish); false for a
   * create, which would make a second record.
   */
  readonly idempotentHint: boolean
  /**
   * The call reaches beyond the workspace's own records — the operation marks
   * `x-open-world` with its reason (a public website, a buyer's email, a
   * lookup outside). False for everything that only reads or writes the
   * workspace's own data.
   */
  readonly openWorldHint: boolean
}

/** One MCP tool, and everything needed to execute it against `/api/v1`. */
export interface McpTool {
  /** The operationId, which the document guarantees is unique. */
  readonly name: string
  /** The operation's summary — what a client shows a person. */
  readonly title: string
  readonly description: string
  readonly annotations: McpToolAnnotations
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

/**
 * The tool's description: what the operation's own description says, then the
 * public docs page for it (AGL-4225).
 *
 * Not the summary: that is the tool's `title`, shown beside the description,
 * and repeating it as the first line made every description open by restating
 * its own name.
 */
function describeOperation(operation: Schema): string {
  const detail =
    typeof operation.description === 'string' ? operation.description.trim() : ''
  const docs = (operation.externalDocs as Schema | undefined)?.url
  return [detail, typeof docs === 'string' && docs ? `Docs: ${docs}` : '']
    .filter(Boolean)
    .join('\n\n')
}

/** `#/components/schemas/<Name>`, the only form of `$ref` the document uses. */
const SCHEMA_REF = /^#\/components\/schemas\/(.+)$/

/**
 * `schema` with every `$ref` to a named schema replaced by the schema itself.
 *
 * A tool's input schema is handed to a client on its own, with no
 * `components` beside it, so a `$ref` that pointed into the document would
 * point at nothing — and a client that validates tool schemas can refuse the
 * whole list for one unresolvable reference. Inlined rather than moved into
 * `$defs` because inlining asks nothing of the client's JSON Schema support.
 * A schema that refers back to itself is cut off at the repeat as an
 * unconstrained object rather than expanded forever.
 */
function inlineRefs(schema: unknown, named: Record<string, Schema>, trail: readonly string[] = []): unknown {
  if (Array.isArray(schema)) return schema.map((item) => inlineRefs(item, named, trail))
  if (!schema || typeof schema !== 'object') return schema
  const record = schema as Schema
  const ref = typeof record.$ref === 'string' ? SCHEMA_REF.exec(record.$ref) : null
  if (ref) {
    const name = ref[1]
    const target = named[name]
    if (!target || trail.includes(name)) return { type: 'object' }
    const { $ref: _ref, ...siblings } = record
    return { ...(inlineRefs(target, named, [...trail, name]) as Schema), ...siblings }
  }
  const out: Schema = {}
  for (const [key, value] of Object.entries(record)) out[key] = inlineRefs(value, named, trail)
  return out
}

/**
 * The arguments schema: path parameters, then query parameters, then the
 * request body under `body`.
 *
 * Path parameters are required because the URL cannot be built without them.
 * Everything else follows what the document says, so a required body field
 * stays required inside `body` rather than being promoted or dropped.
 */
function buildInputSchema(operation: Schema, named: Record<string, Schema>): Schema {
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

  const requestBody = operation.requestBody as Schema | undefined
  const bodySchema = requestBody?.content as Record<string, Schema> | undefined
  const json = bodySchema?.['application/json']?.schema as Schema | undefined
  if (json) {
    properties[MCP_BODY_ARGUMENT] = {
      ...json,
      description:
        typeof json.description === 'string'
          ? json.description
          : 'The request body.',
    }
    // A body the operation requires is a required argument, so a client is
    // told before it calls rather than by the 400 after (AGL-4225).
    if (requestBody?.required === true) required.push(MCP_BODY_ARGUMENT)
  }

  return {
    type: 'object',
    properties: inlineRefs(properties, named) as Record<string, Schema>,
    ...(required.length ? { required } : {}),
    // Named arguments only. A model that invents one should be told so by the
    // schema rather than have it silently dropped on the way to the handler.
    additionalProperties: false,
  }
}

/**
 * Operations deliberately NOT offered as tools, each with its reason. The one
 * exception to "every operation is a tool"; adding to it is a decision, and
 * `mcp-tools.spec.ts` pins the list.
 */
export const MCP_EXCLUDED_OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  /*
    `/v1/openapi.json` returns the whole OpenAPI document — every schema of
    every operation, hundreds of kilobytes — into the model's context. A model
    connected over MCP already holds the same information in a usable form:
    each tool's own input schema and description, from `tools/list`. The
    document stays public at its URL for a client that wants it (AGL-4225).
  */
  getApiDescription: 'returns the whole OpenAPI document; tools/list already carries each operation',
})

/**
 * Every operation in the document, as a tool — except the few named in
 * {@link MCP_EXCLUDED_OPERATIONS}.
 *
 * Nothing else is filtered here. The document describes exactly the customer
 * API, so a filter would be a second opinion about what the API is, kept in a
 * second place, free to drift from the first.
 */
export function buildMcpTools(document: Schema): McpTool[] {
  const paths = (document.paths as Record<string, Schema>) ?? {}
  const named =
    (((document.components as Schema | undefined)?.schemas as Record<string, Schema>) ?? {})
  const tools: McpTool[] = []
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(
      operations as Record<string, Schema>,
    )) {
      if (!METHODS.has(method)) continue
      const name = (operation as Schema).operationId
      if (typeof name !== 'string' || !name) continue
      if (Object.prototype.hasOwnProperty.call(MCP_EXCLUDED_OPERATIONS, name)) continue
      const summary = (operation as Schema).summary
      const title = typeof summary === 'string' && summary ? summary : name
      tools.push({
        name,
        title,
        description: describeOperation(operation as Schema),
        annotations: {
          title,
          readOnlyHint: method === 'get',
          destructiveHint:
            method === 'patch' ||
            method === 'put' ||
            method === 'delete' ||
            (method !== 'get' && (operation as Schema)['x-destructive'] === true),
          idempotentHint:
            method !== 'post' || (operation as Schema)['x-idempotent'] === true,
          openWorldHint: (operation as Schema)['x-open-world'] === true,
        },
        inputSchema: buildInputSchema(operation as Schema, named),
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
 * The path arguments a call left out or left empty, in path order.
 *
 * A missing one cannot be left to the API to refuse, because it is not
 * refused — it MISROUTES. `/v1/sites/{siteId}/orders` with no `siteId` builds
 * `/v1/sites//orders`, whose segments read as site `orders`, and the call is
 * answered "No such site" about a site the model never named (AGL-4225, the
 * first real session). The MCP endpoint refuses it by name instead.
 */
export function missingPathArguments(tool: McpTool, args: McpToolArguments): string[] {
  const missing: string[] = []
  for (const [, key] of tool.path.matchAll(PATH_PARAM)) {
    const value = args[key]
    if (value === undefined || value === null || String(value).trim() === '') missing.push(key)
  }
  return missing
}

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
