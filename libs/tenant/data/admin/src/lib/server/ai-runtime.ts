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

import { estimateAssistCostUsd, type AssistTokenUsage } from './assist-usage'

/**
 * The one Anthropic runtime every AI door calls (AGL-2903).
 *
 * `/api/assist/chat` and `/api/ai/assist` each carried their own `fetch` to
 * the Messages API, their own SSE parser and their own usage extraction, and
 * a third door would have been a third copy. This module owns the request
 * shape, the stream, the cost figure and the error boundary; a door owns its
 * prompt, its gate ladder and its wire format.
 *
 * Raw `fetch`, by convention: no provider SDK is installed, and the meter
 * prices by model id from `ASSIST_MODEL_RATES_USD`, so nothing an SDK would
 * add is used here.
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
 * may not sit at or before the last `cacheBreakpoint`, and `runAiRequest`
 * refuses the request before a byte leaves the process. The API allows four
 * breakpoints; a fifth is refused the same way.
 *
 * ── Structured output ─────────────────────────────────────────────────────
 *
 * A `tools` entry is sent strict, with additional properties forbidden on
 * its schema, so `tool_use.input` validates against the schema exactly. `tool_choice` stays `auto` — forced tool use is not portable
 * across models — and the caller's system text names the tool it wants.
 * The API delivers `input` as an object; a non-streaming result carries it
 * as is, and a stream assembles it from `input_json_delta` fragments and
 * parses the whole once, at `content_block_stop`. Nothing string-matches the
 * serialized form: models differ in how they escape it.
 *
 * ── Thinking ──────────────────────────────────────────────────────────────
 *
 * `thinking: 'off'` sends `{type:'disabled'}`, `'adaptive'` sends
 * `{type:'adaptive'}`, and an omitted field sends NOTHING, leaving the
 * model's own default in force. The omission is deliberate rather than a
 * gap: Haiku 4.5 rejects `adaptive`, and the copy assistant serves its
 * element mode on Haiku. `effort` maps to `output_config.effort` and is
 * omitted the same way.
 *
 * ── Errors (AGL-2815) ─────────────────────────────────────────────────────
 *
 * Provider error text describes OUR account with the vendor — a key, a rate
 * limit, a balance — and names the vendor to a white-label org's users. It
 * never leaves this module as a message: a non-2xx answer becomes an
 * `AiUpstreamError` carrying the status, whether the failure is retryable
 * and a fixed customer-safe sentence; the provider's body goes to
 * `console.error` beside the request id, where an operator can find it.
 * A `refusal` stop is not an error at all — the tokens were spent and the
 * model answered — so it comes back as a typed `AiRefusal` result.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** The Messages API accepts at most this many `cache_control` markers. */
export const AI_MAX_CACHE_BREAKPOINTS = 4

/** The one sentence a customer may read when the provider fails. */
export const AI_UPSTREAM_FAILURE_COPY = 'The AI request failed — try again.'

/**
 * The acceptable-use rules every generation prompt carries (AGL-2925).
 *
 * ONE constant, appended to each door's STATIC system text — inside the
 * cached prefix on the console chat, ahead of the mode prompt on the copy
 * assistant — so the rules the model is held to are the same at every
 * door and carry no per-org byte. The Free taste is what makes them worth
 * stating: a generated page that nobody paid for is the cheapest phishing
 * kit there is, and the model declining it is the first line, ahead of the
 * abuse-report route and the lockdown key.
 *
 * The categories are the platform's own Acceptable Use Policy, restated in
 * the second person for the model. A decline from the model's safety layer
 * arrives as a `refusal` stop, which the meter counts against the account's
 * daily pause and never against its credits.
 */
export const AI_ACCEPTABLE_USE_BLOCK = `Acceptable use — decline these rather than write them, and say briefly why:
- Pages, emails or copy that harvest credentials, payment details or personal data by deception (phishing, fake sign-in or checkout pages, fake "verify your account" notices).
- Impersonating a real business, brand, public body or person you were not told the user represents — their name, logo, sign-in page or voice — or copy that claims an endorsement, certification or partnership that was not given to you as a fact.
- Content that promotes or sells prohibited goods and services: weapons, illegal drugs, counterfeit goods, malware or deceptive downloads, unlicensed gambling, or adult content involving minors.
- Scams and fraud: fake investment or crypto schemes, advance-fee offers, tech-support scams, fake charities, deceptive "you have won" pages, or copy built to defraud.
- Harassment, threats, or hateful content targeting a person or a group.
- Spam farms: bulk near-duplicate pages or copy whose only purpose is to game search engines or send unsolicited mail.
When a brief is ordinary business content, write it well and do not lecture.`

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

interface AiRequestBase {
  model: string
  system: AiSystemBlock[]
  messages: AiMessage[]
  tools?: AiTool[]
  maxTokens: number
  effort?: AiEffort
  thinking?: AiThinking
  signal?: AbortSignal
}

export interface AiRequest extends AiRequestBase {
  stream: false
}

export interface AiStreamRequest extends AiRequestBase {
  stream: true
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
  usage: AssistTokenUsage
  /** At the serving model's list rates — see `estimateAssistCostUsd`. */
  estCostUsd: number
  stopReason: string | null
}

/**
 * The model declined (`stop_reason: 'refusal'`). Tokens were spent, so the
 * usage is real and the caller meters it; the text is whatever partial
 * answer preceded the stop, usually nothing.
 */
export interface AiRefusal {
  kind: 'refusal'
  text: string
  usage: AssistTokenUsage
  estCostUsd: number
  stopReason: 'refusal'
}

export type AiResult = AiCompletion | AiRefusal

export type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  /**
   * The provider's in-stream `error` event. The stream is still open and
   * ends with `done`, so the caller decides what the reader is told; the
   * provider's own words went to the log, not here.
   */
  | { type: 'error'; retryable: boolean }
  | {
      type: 'done'
      usage: AssistTokenUsage
      estCostUsd: number
      stopReason: string | null
    }

/**
 * A non-2xx answer from the provider. `message` is the fixed customer-safe
 * sentence; the provider's payload is in the log under `requestId`.
 */
export class AiUpstreamError extends Error {
  readonly status: number | null
  /**
   * Whether the provider said "come back later" rather than "this request
   * is wrong": a rate limit or an overload. Everything else — a bad
   * request, an authentication failure, a provider fault — is not, and a
   * caller must not retry it in a loop.
   */
  readonly retryable: boolean
  readonly requestId: string | null

  constructor(status: number | null, retryable: boolean, requestId: string | null) {
    super(AI_UPSTREAM_FAILURE_COPY)
    this.name = 'AiUpstreamError'
    this.status = status
    this.retryable = retryable
    this.requestId = requestId
  }
}

/**
 * A request this runtime refuses to send. Thrown synchronously from
 * `buildAiRequestBody`, before any network is touched, and it names the
 * block at fault: this is a programming error in the caller's prompt
 * assembly, not a condition to handle at runtime.
 */
export class AiRequestShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiRequestShapeError'
  }
}

/**
 * Whether a provider failure is the kind that clears on its own. Matched on
 * the status AND the error type, because the in-stream `error` event has no
 * status to go by.
 */
export function aiFailureIsRetryable(
  status: number | null,
  errorType: string | undefined,
): boolean {
  return (
    status === 429 ||
    status === 529 ||
    errorType === 'rate_limit_error' ||
    errorType === 'overloaded_error'
  )
}

/** Anthropic's `usage` object, in the meter's shape. Missing fields read 0. */
export function aiUsageFrom(usage: unknown): AssistTokenUsage {
  const record = (usage ?? {}) as Record<string, unknown>
  const count = (value: unknown): number => {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }
  return {
    inputTokens: count(record['input_tokens']),
    outputTokens: count(record['output_tokens']),
    cacheReadTokens: count(record['cache_read_input_tokens']),
    cacheWriteTokens: count(record['cache_creation_input_tokens']),
  }
}

/**
 * The Messages API body for a request, with the cache guard applied.
 * Exported so a spec can assert the wire shape without a network.
 */
export function buildAiRequestBody(
  input: AiRequestBase & { stream: boolean },
): Record<string, unknown> {
  const breakpoints = input.system.filter((block) => block.cacheBreakpoint)
  if (breakpoints.length > AI_MAX_CACHE_BREAKPOINTS) {
    throw new AiRequestShapeError(
      `${breakpoints.length} cache breakpoints; the Messages API allows ${AI_MAX_CACHE_BREAKPOINTS}`,
    )
  }
  // Caching is a prefix match, so the LAST breakpoint decides what is
  // cached, and every block at or before it is inside the cached prefix. A
  // volatile block anywhere in that span — including one that is itself
  // the breakpoint — puts a per-request byte into the prefix (AGL-2352).
  const lastBreakpoint = input.system.reduce(
    (last, block, index) => (block.cacheBreakpoint ? index : last),
    -1,
  )
  input.system.forEach((block, index) => {
    if (block.volatile && index <= lastBreakpoint) {
      throw new AiRequestShapeError(
        `system block ${index} is volatile but sits inside the cached prefix (last breakpoint at block ${lastBreakpoint})`,
      )
    }
  })

  const system = input.system.map((block) => ({
    type: 'text',
    text: block.text,
    ...(block.cacheBreakpoint ? { cache_control: { type: 'ephemeral' } } : {}),
  }))

  const tools = input.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.inputSchema, additionalProperties: false },
    strict: true,
  }))

  return {
    model: input.model,
    max_tokens: input.maxTokens,
    ...(input.stream ? { stream: true } : {}),
    ...(input.thinking === 'off'
      ? { thinking: { type: 'disabled' } }
      : input.thinking === 'adaptive'
        ? { thinking: { type: 'adaptive' } }
        : {}),
    ...(input.effort ? { output_config: { effort: input.effort } } : {}),
    ...(system.length ? { system } : {}),
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(tools?.length ? { tools, tool_choice: { type: 'auto' } } : {}),
  }
}

/** The provider's request id, when it sent one — the log's join key. */
function requestIdOf(response: Response): string | null {
  return response.headers?.get?.('request-id') ?? null
}

/**
 * `tool_use.input` as an object. The API sends an object; a string is
 * parsed as JSON for the one shape a stream assembles by hand.
 */
function toolInputOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return value.trim() ? (JSON.parse(value) as Record<string, unknown>) : {}
  }
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Send one request to the Messages API.
 *
 * Streaming: resolves once the provider has ACCEPTED the request — after
 * the headers, before the first token — with an iterator of simplified
 * events the caller wraps in its own wire format. A non-2xx answer rejects
 * with `AiUpstreamError` before the iterator exists, so a door can still
 * send a plain error status and hand back its reservation.
 *
 * Non-streaming: resolves with the parsed result, a `refusal` stop typed as
 * `AiRefusal` rather than thrown.
 */
export async function runAiRequest(
  input: AiStreamRequest,
): Promise<AsyncIterable<AiStreamEvent>>
export async function runAiRequest(input: AiRequest): Promise<AiResult>
export async function runAiRequest(
  input: AiRequest | AiStreamRequest,
): Promise<AsyncIterable<AiStreamEvent> | AiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Every door gates on the key before it gets here (501, or the docs
    // fallback), so this is a wiring fault rather than a customer path.
    throw new Error('ANTHROPIC_API_KEY is not set')
  }
  const body = buildAiRequestBody(input)
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(input.signal ? { signal: input.signal } : {}),
  })

  if (!response.ok || (input.stream && !response.body)) {
    const requestId = requestIdOf(response)
    const payload = (await response.json().catch(() => null)) as {
      error?: { type?: string; message?: string }
    } | null
    console.error('ai upstream error', {
      status: response.status,
      requestId,
      model: input.model,
      error: payload?.error ?? null,
    })
    throw new AiUpstreamError(
      response.status,
      aiFailureIsRetryable(response.status, payload?.error?.type),
      requestId,
    )
  }

  if (input.stream) {
    return streamEvents(response.body as ReadableStream<Uint8Array>, input.model, requestIdOf(response))
  }

  const payload = (await response.json()) as {
    content?: Array<Record<string, unknown>>
    stop_reason?: unknown
    usage?: unknown
  }
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  const text = blocks
    .filter((block) => block?.['type'] === 'text')
    .map((block) => String(block['text'] ?? ''))
    .join('')
  const toolUse: AiToolUse[] = blocks
    .filter((block) => block?.['type'] === 'tool_use')
    .map((block) => ({
      name: String(block['name'] ?? ''),
      input: toolInputOf(block['input']),
    }))
  const usage = aiUsageFrom(payload?.usage)
  const estCostUsd = estimateAssistCostUsd(usage, input.model)
  const stopReason =
    typeof payload?.stop_reason === 'string' && payload.stop_reason
      ? payload.stop_reason
      : null
  if (stopReason === 'refusal') {
    return { kind: 'refusal', text, usage, estCostUsd, stopReason }
  }
  return { kind: 'completion', text, toolUse, usage, estCostUsd, stopReason }
}

/**
 * Anthropic's SSE stream as simplified events. Usage is taken from
 * `message_start` (input and cache figures) and `message_delta` (the
 * output count, and any cumulative input figures a newer API sends); the
 * `done` event carries whatever was known when the body ended, so a stream
 * cut short still meters what it cost.
 */
async function* streamEvents(
  body: ReadableStream<Uint8Array>,
  model: string,
  requestId: string | null,
): AsyncGenerator<AiStreamEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  const usage: AssistTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  let stopReason: string | null = null
  /** Tool-use blocks in flight, by content index; input arrives in pieces. */
  const tools = new Map<number, { name: string; json: string }>()
  let buffer = ''
  let drained = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        drained = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(line.slice('data: '.length))
        } catch {
          continue
        }
        const index = Number(event['index'])
        switch (event['type']) {
          case 'message_start': {
            const start = aiUsageFrom(
              (event['message'] as { usage?: unknown } | undefined)?.usage,
            )
            usage.inputTokens = start.inputTokens
            usage.cacheReadTokens = start.cacheReadTokens
            usage.cacheWriteTokens = start.cacheWriteTokens
            break
          }
          case 'content_block_start': {
            const block = event['content_block'] as
              | { type?: string; name?: string }
              | undefined
            if (block?.type === 'tool_use') {
              tools.set(index, { name: String(block.name ?? ''), json: '' })
            }
            break
          }
          case 'content_block_delta': {
            const delta = event['delta'] as
              | { type?: string; text?: string; partial_json?: string }
              | undefined
            if (delta?.type === 'text_delta' && delta.text) {
              yield { type: 'delta', text: delta.text }
            } else if (delta?.type === 'input_json_delta') {
              const tool = tools.get(index)
              if (tool) tool.json += delta.partial_json ?? ''
            }
            break
          }
          case 'content_block_stop': {
            const tool = tools.get(index)
            if (tool) {
              tools.delete(index)
              yield { type: 'tool', name: tool.name, input: toolInputOf(tool.json) }
            }
            break
          }
          case 'message_delta': {
            const delta = aiUsageFrom(event['usage'])
            usage.outputTokens = delta.outputTokens || usage.outputTokens
            usage.inputTokens = delta.inputTokens || usage.inputTokens
            usage.cacheReadTokens = delta.cacheReadTokens || usage.cacheReadTokens
            usage.cacheWriteTokens = delta.cacheWriteTokens || usage.cacheWriteTokens
            const reason = (event['delta'] as { stop_reason?: unknown } | undefined)
              ?.stop_reason
            if (typeof reason === 'string' && reason) stopReason = reason
            break
          }
          case 'error': {
            const error = event['error'] as
              | { type?: string; message?: string }
              | undefined
            console.error('ai upstream stream error', {
              requestId,
              model,
              error: error ?? null,
            })
            yield { type: 'error', retryable: aiFailureIsRetryable(null, error?.type) }
            break
          }
          default:
            break
        }
      }
    }
  } finally {
    // A consumer that stops iterating early — a client that hung up — must
    // not leave the provider generating into a socket nobody reads: cancel
    // tells the upstream to stop, and the tokens it has already produced are
    // the only ones billed.
    if (!drained) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  yield {
    type: 'done',
    usage,
    estCostUsd: estimateAssistCostUsd(usage, model),
    stopReason,
  }
}
