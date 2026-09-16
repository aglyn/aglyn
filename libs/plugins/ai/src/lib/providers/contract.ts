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
 *
 * ── Thinking ──────────────────────────────────────────────────────────────
 *
 * `thinking: 'off'` and `'adaptive'` are sent when the provider has the
 * control; an omitted field sends NOTHING, leaving the model's own default
 * in force. The omission is deliberate rather than a gap: some models
 * reject an explicit setting, and the copy assistant serves its element
 * mode on such a model. `effort` rides the same rule.
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

export type AiEffort = 'low' | 'medium' | 'high'
export type AiThinking = 'off' | 'adaptive'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
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
  /** At the serving model's list rates — see the model catalog. */
  estCostUsd: number
  stopReason: string | null
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
    }

/** What a provider says about one of its models; the catalog carries the rates. */
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
