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

import { UpstreamServiceError } from '@aglyn/shared-util-errors'

/**
 * The provider contract (AGL-2939): the one shape every AI door speaks, and
 * the one thing an adapter has to implement. The runtime, the gate, the
 * jobs, the doctrine and the usage code import this and never a vendor
 * URL, header or model literal — Anthropic is one adapter behind it, and
 * an OpenAI-compatible endpoint is the second, which is what proves the
 * seam holds.
 *
 * ── Prompt caching, by construction ───────────────────────────────────────
 *
 * `system` is an ordered list of blocks, and caching is a PREFIX match: a
 * breakpoint covers every block before it, and one byte that differs per
 * request anywhere inside that prefix gives every distinct value its own
 * copy of it. The AGL-2352 rule is that no per-org byte may sit inside a
 * cached prefix — a white-label brand name interpolated into a cached block
 * multiplies the prefix count by the number of brands, each written off its
 * own traffic and expired before it is read. So a block marked `volatile`
 * may not sit at or before the last `cacheBreakpoint`, and the runtime
 * refuses the request before a byte leaves the process. A provider with no
 * cache honors the order and ignores the markers.
 *
 * ── Structured output ─────────────────────────────────────────────────────
 *
 * A `tools` entry is sent strict, with additional properties forbidden on
 * its schema, so a tool call's `input` validates against the schema
 * exactly. Tool choice stays automatic — forced tool use is not portable
 * across models — and the caller's system text names the tool it wants. An
 * adapter delivers `input` as an object; a stream assembles it from
 * fragments and parses the whole once, at the block's end. Nothing
 * string-matches the serialized form: models differ in how they escape it.
 * A provider bounds how much strict schema one request may carry, and an
 * adapter declares those bounds as `toolSchemaLimits`: three bounds a vendor
 * publishes and counts, and a fourth, the size of the grammar the schemas
 * compile to, that none publishes and only a live request settles.
 *
 * ── Thinking ──────────────────────────────────────────────────────────────
 *
 * `thinking: 'off'` and `'adaptive'` are sent when the provider has the
 * control; an omitted field sends NOTHING, leaving the model's own default
 * in force. The omission is deliberate rather than a gap: some models
 * reject an explicit setting, and the copy assistant serves its element
 * mode on such a model. `effort` rides the same rule.
 *
 * ── Pictures ──────────────────────────────────────────────────────────────
 *
 * A user turn may carry pictures beside its text (AGL-2916): `content` is
 * then an ordered list of parts, and a turn with nothing but text stays a
 * string, which every adapter passes through as it always has. A picture is
 * base64 bytes of one of `AI_IMAGE_MEDIA_TYPES`, never a URL, so no provider
 * fetches anything on the platform's behalf. The runtime refuses a picture
 * on an assistant turn, a picture for a model whose descriptor does not say
 * `vision`, and a picture past the size or count bounds, all before any
 * network is touched. Each adapter maps the parts onto its vendor's shape.
 */

/**
 * One system block. `cacheBreakpoint` marks the end of a cacheable prefix;
 * `volatile` declares that the text carries a per-request or per-org byte
 * and therefore may never sit inside one.
 */
export interface AiSystemBlock {
  text: string
  cacheBreakpoint?: true
  volatile?: true
}

/** A structured-output tool. `strict` is required, not optional. */
export interface AiTool {
  name: string
  description: string
  /** A JSON schema of `type: 'object'`; `additionalProperties` is forced off. */
  inputSchema: Record<string, unknown>
  strict: true
}

/**
 * How much of a request's strict tools a provider can compile (AGL-3096). A
 * provider that constrains decoding to a tool's schema compiles every strict
 * schema of a request together, before the model runs, and refuses a request
 * whose schemas are past its bounds. That refusal is permanent: the schema is
 * the same on every retry. Each bound is a TOTAL over every strict tool one
 * request sends, as `aiToolSchemaCounts` counts them. A bound left out is one
 * the provider does not state.
 *
 * A provider may also refuse a request whose schemas compile to too large a
 * grammar, which none of the published counts can see: a request counting 1
 * strict tool, 0 optional parameters and 1 union was refused for exactly that
 * (AGL-3096). `compiledSchemaBytes` stands in for it, on live evidence.
 */
export interface AiToolSchemaLimits {
  /** The most strict tools one request may send. */
  strictTools?: number
  /** The most properties, across every strict schema, left out of their object's `required`. */
  optionalParameters?: number
  /** The most schemas, across every strict schema, that are a union: an `anyOf` or `oneOf`, or a list of types. */
  unionParameters?: number
  /**
   * The most bytes of schema a request's grammar may be compiled from, as
   * `aiToolSchemaCompiledBytes` measures them.
   *
   * Unlike the bounds above, this one is EMPIRICAL. A provider refuses a
   * request whose compiled grammar is too large without publishing the size,
   * so the number here is not read off a vendor's page: it is the largest a
   * live request has been watched to carry, and every number above it is
   * unknown rather than safe. Raising it on an offline measurement alone
   * puts the guard back where it could not see the break.
   */
  compiledSchemaBytes?: number
}

/** A request's strict tools, counted on the measures `AiToolSchemaLimits` bounds. */
export type AiToolSchemaCounts = Required<AiToolSchemaLimits>

/**
 * One schema as a grammar compiler reads it: every local `$ref` written out
 * at each place it is used, and every description, title and `$defs` dropped,
 * since none of them constrains a single token. A schema that refers to
 * itself is written out once around and then left as the reference it is.
 */
function compiledForm(node: unknown, root: Record<string, unknown>, resolving: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((entry) => compiledForm(entry, root, resolving))
  if (!isSchemaObject(node)) return node
  const ref = node['$ref']
  if (typeof ref === 'string') {
    if (resolving.has(ref)) return { $ref: ref }
    return compiledForm(localSchemaAt(root, ref), root, new Set([...resolving, ref]))
  }
  const written: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'description' || key === 'title' || key === '$defs') continue
    written[key] = compiledForm(value, root, resolving)
  }
  return written
}

/**
 * The bytes of schema a request's grammar is compiled from, over all its
 * strict tools. It is a stand-in for the size of the grammar itself, which
 * nothing outside the provider can measure, and it errs toward more: a `$ref`
 * counts at each place it is used, because a compiler that writes it out
 * there pays for it there.
 */
export function aiToolSchemaCompiledBytes(tools: readonly AiTool[]): number {
  return tools.reduce(
    (bytes, tool) => bytes + JSON.stringify(compiledForm(tool.inputSchema, tool.inputSchema, new Set())).length,
    0,
  )
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The schema a local `$ref` (`#/…`) points at, or `undefined`. */
function localSchemaAt(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  return ref
    .slice(2)
    .split('/')
    .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((node, key) => (isSchemaObject(node) ? node[key] : undefined), root)
}

function countSchema(
  node: unknown,
  root: Record<string, unknown>,
  counts: AiToolSchemaCounts,
  resolving: ReadonlySet<string>,
): void {
  if (!isSchemaObject(node)) return
  if (Array.isArray(node['anyOf']) || Array.isArray(node['oneOf']) || Array.isArray(node['type'])) {
    counts.unionParameters += 1
  }
  const ref = node['$ref']
  if (typeof ref === 'string' && !resolving.has(ref)) {
    countSchema(localSchemaAt(root, ref), root, counts, new Set([...resolving, ref]))
  }
  const properties = node['properties']
  if (isSchemaObject(properties)) {
    const required = Array.isArray(node['required']) ? node['required'] : []
    for (const [key, property] of Object.entries(properties)) {
      if (!required.includes(key)) counts.optionalParameters += 1
      countSchema(property, root, counts, resolving)
    }
  }
  const items = node['items']
  for (const item of Array.isArray(items) ? items : [items]) countSchema(item, root, counts, resolving)
  for (const key of ['anyOf', 'allOf', 'oneOf']) {
    const branches = node[key]
    if (Array.isArray(branches)) for (const branch of branches) countSchema(branch, root, counts, resolving)
  }
}

/**
 * The strict tools of one request, counted on each measure a provider bounds.
 * Every tool the contract sends is strict. Each schema is walked whole: every
 * property, every `items`, every branch of an `anyOf`, `allOf` or `oneOf`, and
 * a local `$ref` at each place it is used. A union nested in an array's items
 * or in another union's branch counts on its own, as it does for a provider
 * that compiles it; a `$ref` counted where it is used errs toward more.
 */
export function aiToolSchemaCounts(tools: readonly AiTool[]): AiToolSchemaCounts {
  const counts: AiToolSchemaCounts = {
    strictTools: tools.length,
    optionalParameters: 0,
    unionParameters: 0,
    compiledSchemaBytes: aiToolSchemaCompiledBytes(tools),
  }
  for (const tool of tools) countSchema(tool.inputSchema, tool.inputSchema, counts, new Set())
  return counts
}

/**
 * Each bound, as one, as many, and where its number comes from — a published
 * bound reads as the provider's own, a measured one as what has been proved.
 */
const TOOL_SCHEMA_MEASURES: ReadonlyArray<[keyof AiToolSchemaLimits, string, string, string]> = [
  ['strictTools', 'strict tool', 'strict tools', 'the provider compiles'],
  ['optionalParameters', 'optional parameter', 'optional parameters', 'the provider compiles'],
  ['unionParameters', 'union-typed parameter', 'union-typed parameters', 'the provider compiles'],
  ['compiledSchemaBytes', 'byte of compiled schema', 'bytes of compiled schema', 'a live request has proved'],
]

/** Each bound a request's tools are past, as a sentence; empty when every one holds. */
export function aiToolSchemaBreaches(
  tools: readonly AiTool[],
  limits: AiToolSchemaLimits | undefined,
): string[] {
  if (!limits) return []
  const counts = aiToolSchemaCounts(tools)
  return TOOL_SCHEMA_MEASURES.flatMap(([measure, one, many, source]) => {
    const limit = limits[measure]
    const count = counts[measure]
    return limit !== undefined && count > limit
      ? [`${count} ${count === 1 ? one : many} in one request, over the ${limit} ${source}`]
      : []
  })
}

export type AiEffort = 'low' | 'medium' | 'high'
export type AiThinking = 'off' | 'adaptive'

/**
 * The picture formats a request may carry (AGL-2916): the four every model
 * the catalog marks as reading images accepts. A door converts anything else
 * — an AVIF, an SVG — before it attaches the picture, or attaches none.
 */
export const AI_IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type AiImageMediaType = (typeof AI_IMAGE_MEDIA_TYPES)[number]

/**
 * The largest picture one part may carry, in decoded bytes: the ceiling the
 * providers behind the contract accept for one image. A door that attaches a
 * picture resizes it far below this; the runtime refuses anything above it
 * before a byte leaves the process, rather than letting the provider do it
 * after the request was paid for in time.
 */
export const AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** The most pictures one request may carry. */
export const AI_REQUEST_MAX_IMAGES = 8

/** Text in a message made of parts. */
export interface AiTextPart {
  type: 'text'
  text: string
}

/**
 * A picture in a message (AGL-2916): its bytes, base64-encoded, and their
 * format. Only a USER turn carries one, and only to a model whose descriptor
 * says it reads images; the runtime refuses any other request before a byte
 * leaves the process, so a door cannot send a picture by accident to a model
 * that would reject it, or to a turn the model wrote.
 */
export interface AiImagePart {
  type: 'image'
  mediaType: AiImageMediaType
  /** The picture's bytes, base64-encoded, with no `data:` prefix. */
  data: string
}

export type AiMessagePart = AiTextPart | AiImagePart

export interface AiMessage {
  role: 'user' | 'assistant'
  /**
   * The turn's text, or its parts in order — text and pictures — for a door
   * that shows the model an image. A door with nothing but text sends a
   * string, which every adapter passes through as it always has.
   */
  content: string | readonly AiMessagePart[]
}

/** A message's text: its parts' text joined, with every picture left out. */
export function aiMessageText(message: Pick<AiMessage, 'content'>): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part): part is AiTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
}

/** Every picture a list of messages carries, in order. */
export function aiMessageImages(messages: readonly Pick<AiMessage, 'content'>[]): AiImagePart[] {
  return messages.flatMap((message) =>
    typeof message.content === 'string'
      ? []
      : message.content.filter((part): part is AiImagePart => part.type === 'image'),
  )
}

/** The decoded size of a base64 string, without decoding it. */
export function aiBase64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

/** What every door hands the runtime; `provider` and `model` resolve there. */
export interface AiRequestBase {
  model: string
  system: AiSystemBlock[]
  messages: AiMessage[]
  tools?: AiTool[]
  maxTokens: number
  effort?: AiEffort
  thinking?: AiThinking
  signal?: AbortSignal
}

/** The request an adapter receives: the runtime has already validated it. */
export interface AiProviderRequest extends AiRequestBase {
  /** The provider's own key, resolved by the runtime from the environment or the org's setting. */
  apiKey: string
}

/**
 * Token usage in the meter's shape. Cache reads and writes are separate
 * because they are priced separately; a provider with no cache reports 0.
 */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface AiToolUse {
  name: string
  input: Record<string, unknown>
}

/** A completed, non-streaming answer. */
export interface AiCompletion {
  kind: 'completion'
  /** Every text block, joined. */
  text: string
  toolUse: AiToolUse[]
  usage: AiUsage
  /**
   * The exchange at the serving model's BILLED rates — what a customer's
   * credits are drawn from, and never a margin's cost side (AGL-3015). What
   * the same exchange cost us is `estimateAiProviderCostUsd`, recorded by
   * the meter; a result travels no further than the credit path, so it
   * carries the one figure that path needs.
   */
  estCostUsd: number
  stopReason: string | null
  /**
   * WHERE THE OUTPUT WENT (AGL-3143). The provider's own output for this
   * call, as it answered it, kept ONLY when the call stopped at its ceiling
   * and cut to `AI_RAW_OUTPUT_MAX_CHARS`.
   *
   * A tool call truncated mid-answer reaches `toolUse` as whatever the
   * provider could still parse, and the parsed input alone cannot say where
   * the tokens went: a runaway string the partial parse discarded and a
   * decoding stall that wrote nothing usable both leave a small input
   * against a spent ceiling. This is what tells them apart. These are the
   * model's own words, so they belong to the trace alone: never to a reader,
   * and never to a log, which carries the figures that separate the two
   * shapes — `outputTokens`, `parsedChars`, `rawChars`.
   */
  rawOutput?: string
}

/**
 * Whether a model call stopped because it reached the output ceiling it was
 * asked for (AGL-3042). `max_tokens` is the contract's word, and the
 * OpenAI-compatible adapter maps its endpoint's `length` onto it; `length` is
 * read as well, for an adapter that passes its provider's own word through.
 */
export function aiStoppedAtCeiling(stopReason: string | null): boolean {
  return stopReason === 'max_tokens' || stopReason === 'length'
}

/** The most characters of raw output a call cut off at its ceiling keeps. */
export const AI_RAW_OUTPUT_MAX_CHARS = 20_000

/**
 * A cut-off call's output as the trace keeps it: what the provider answered,
 * serialized where it is not already text, and cut to the bound with an
 * ellipsis so a reader can tell a cut trace from a short answer.
 */
export function aiRawOutputOf(output: unknown): string {
  const text = typeof output === 'string' ? output : (JSON.stringify(output) ?? '')
  return text.length > AI_RAW_OUTPUT_MAX_CHARS ? `${text.slice(0, AI_RAW_OUTPUT_MAX_CHARS)}…` : text
}

/**
 * The model declined. Tokens were spent, so the usage is real and the
 * caller meters it; the text is whatever partial answer preceded the stop,
 * usually nothing. Every adapter maps its provider's own decline signal —
 * a refusal stop, a content filter — onto this one kind.
 */
export interface AiRefusal {
  kind: 'refusal'
  text: string
  usage: AiUsage
  estCostUsd: number
  stopReason: 'refusal'
}

export type AiResult = AiCompletion | AiRefusal

export type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  /**
   * The provider's in-stream error. The stream is still open and ends with
   * `done`, so the caller decides what the reader is told; the provider's
   * own words went to the log, not here.
   */
  | { type: 'error'; retryable: boolean }
  | {
      type: 'done'
      usage: AiUsage
      estCostUsd: number
      stopReason: string | null
      /**
       * WHERE THE OUTPUT WENT, for a stream (AGL-3143): the bytes the
       * stream's tool calls were written in, kept ONLY when the stream
       * stopped at its ceiling and cut to `AI_RAW_OUTPUT_MAX_CHARS`. The
       * streaming counterpart of `AiCompletion.rawOutput`.
       *
       * A `tool` event carries what `aiToolInputOf` could still parse, which
       * for a call cut mid-answer is a prefix of the object or nothing at
       * all; the fragments those events were assembled from are the only
       * record of what the model actually emitted, and without them a
       * runaway string and a decoding stall look identical from the
       * outside. These are the model's own words, so they belong to the
       * trace alone: never to a reader, and never to a log, which carries
       * the figures that separate the two shapes.
       */
      rawOutput?: string
    }

/** What a provider says about one of its models; the catalog carries both rates. */
export interface AiModelDescriptor {
  id: string
  /** The provider id the model is served by. */
  provider: string
  label: string
  capabilities: {
    streaming: boolean
    tools: boolean
    /** Whether the provider accepts an explicit `thinking` setting for this model. */
    thinking: boolean
    /** Whether the provider caches a system prefix for this model. */
    promptCache: boolean
    /**
     * Whether the model reads a picture in a user turn (AGL-2916). Absent
     * reads as no, so a provider registered before the field existed is never
     * sent an image it did not say it can read.
     */
    vision?: boolean
  }
}

/** The one sentence a customer may read when a provider fails. */
export const AI_UPSTREAM_FAILURE_COPY = 'The AI request failed — try again.'

/**
 * A non-2xx answer from the provider. `message` is the fixed customer-safe
 * sentence; the provider's payload is in the log under `requestId`.
 */
export class AiUpstreamError extends UpstreamServiceError {
  override readonly name = 'AiUpstreamError'

  constructor(status: number | null, retryable: boolean, requestId: string | null) {
    super(AI_UPSTREAM_FAILURE_COPY, { status, retryable, requestId })
  }
}

/**
 * A request the runtime refuses to send. Thrown synchronously before any
 * network is touched, and it names the block at fault: this is a
 * programming error in the caller's prompt assembly, not a condition to
 * handle at runtime.
 */
export class AiRequestShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiRequestShapeError'
  }
}

/**
 * A provider: one vendor's wire protocol behind the contract. `id` is the
 * routing key (`anthropic`, `openai-compatible`); `models` is what the
 * provider can serve; `complete` and `stream` are the two shapes every door
 * uses. An adapter maps its vendor's errors onto `AiUpstreamError` and its
 * declines onto `AiRefusal`, and reports usage in the meter's shape.
 */
export interface AiProvider {
  readonly id: string
  readonly label: string
  /** The environment variable that carries this provider's key, for operator messages. */
  readonly apiKeyEnv: string
  /**
   * The key from the server environment, or `undefined` when the provider
   * is not configured to answer. Each adapter reads its own variable by
   * name in its own module, so every key read is one the key-exposure
   * guard can see (AGL-2240) and no door names a vendor's variable.
   */
  readApiKey(): string | undefined
  /** The host the provider is reached at, for the subprocessor inventory. */
  readonly endpointHost: string
  /**
   * How much of one request's strict tools this provider compiles, where it
   * states a bound. The doors never read it: a spec holds every tool set a
   * door sends to every registered provider's limits, so a schema a provider
   * would refuse is red before it ships rather than a 400 on every request.
   */
  readonly toolSchemaLimits?: AiToolSchemaLimits
  models(): readonly AiModelDescriptor[]
  complete(request: AiProviderRequest): Promise<AiResult>
  /**
   * Resolves once the provider has ACCEPTED the request — after the
   * headers, before the first token — with an iterator of events. A non-2xx
   * answer rejects with `AiUpstreamError` before the iterator exists, so a
   * door can still send a plain error status and hand back its reservation.
   */
  stream(request: AiProviderRequest): Promise<AsyncIterable<AiStreamEvent>>
}

/** A count off the wire: finite, non-negative, whole; anything else is 0. */
export function aiTokenCount(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/**
 * A tool call's `input` as an object. A provider sends an object or, for
 * the one shape a stream assembles by hand, a JSON string.
 *
 * A string that does not parse to an object is an EMPTY input, not a throw.
 * The case that produces one is a stream cut off mid-call by the output
 * ceiling, and a throw there would end the stream before its `done` event —
 * the event that carries the usage a door must meter for tokens already
 * spent. An empty input is one every door's own validation refuses.
 */
export function aiToolInputOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    if (!value.trim()) return {}
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
