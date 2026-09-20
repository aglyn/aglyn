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

import { aiModelIdsForProvider, estimateAiBilledUsd, aiCatalogEntry } from './catalog'
import {
  AiUpstreamError,
  aiRawOutputOf,
  aiStoppedAtCeiling,
  aiTokenCount,
  aiToolInputOf,
  type AiMessage,
  type AiModelDescriptor,
  type AiProvider,
  type AiProviderRequest,
  type AiResult,
  type AiStreamEvent,
  type AiToolSchemaLimits,
  type AiToolUse,
  type AiUsage,
} from './contract'

/**
 * The Anthropic adapter (AGL-2903, behind the contract since AGL-2939):
 * the Messages API over raw `fetch`. No provider SDK is installed, and the
 * meter prices by model id from the catalog, so nothing an SDK would add
 * is used here. This file and the catalog are the only places in the
 * plugin that name the vendor's URL, header or model ids.
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

export const ANTHROPIC_PROVIDER_ID = 'anthropic'
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY'
const ANTHROPIC_HOST = 'api.anthropic.com'
const ANTHROPIC_URL = `https://${ANTHROPIC_HOST}/v1/messages`
const ANTHROPIC_VERSION = '2023-06-01'

/** The Messages API accepts at most this many `cache_control` markers. */
export const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 4

/**
 * What the Messages API compiles of one request's strict schemas, as its
 * structured-outputs documentation states the limits: 20 strict tools, 24
 * optional parameters and 16 parameters with union types, each a total over
 * every strict schema the request carries. Past any of them the request is
 * refused with a 400 before the model runs.
 *
 * `compiledSchemaBytes` is not one of those. The API also refuses a request
 * whose schemas compile to too large a grammar — "Simplify your tool schemas
 * or reduce the number of strict tools" — and states no size for it, so this
 * bound is measured rather than read (AGL-3096). Its evidence is two live
 * requests for the automation draft, the largest strict schema anything here
 * sends:
 *
 *  - 8,757 bytes, refused for grammar size (`req_011CfC6Fif9iJvmKPTRgtLdp`,
 *    2026-09-19), with 1 strict tool, 0 optional parameters and 2 unions:
 *    every published count was green;
 *  - 3,807 bytes, served (`req_011CfELn62WVLeaNzwK4TWgb`, 2026-09-20), the
 *    same tool with the guard lifted out of the steps' union and one variant
 *    per set of fields.
 *
 * Everything else the plugin sends is smaller still, the next largest being
 * the theme tool at 2,410 bytes. The bound sits at what has been served, so a
 * schema that grows past it has to be proved live before the bound moves.
 */
export const ANTHROPIC_TOOL_SCHEMA_LIMITS: AiToolSchemaLimits = {
  strictTools: 20,
  optionalParameters: 24,
  unionParameters: 16,
  compiledSchemaBytes: 3_807,
}

/**
 * Whether a provider failure is the kind that clears on its own. Matched on
 * the status AND the error type, because the in-stream `error` event has no
 * status to go by.
 */
export function anthropicFailureIsRetryable(
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
export function anthropicUsageFrom(usage: unknown): AiUsage {
  const record = (usage ?? {}) as Record<string, unknown>
  // Part of `output_tokens`, and carried only where the response breaks them
  // down, so an answer that reports none says nothing rather than zero.
  const details = record['output_tokens_details']
  const thinking =
    details && typeof details === 'object'
      ? (details as Record<string, unknown>)['thinking_tokens']
      : undefined
  return {
    inputTokens: aiTokenCount(record['input_tokens']),
    outputTokens: aiTokenCount(record['output_tokens']),
    cacheReadTokens: aiTokenCount(record['cache_read_input_tokens']),
    cacheWriteTokens: aiTokenCount(record['cache_creation_input_tokens']),
    ...(thinking === undefined ? {} : { thinkingTokens: aiTokenCount(thinking) }),
  }
}

/**
 * The Messages API body for a request. Exported so a spec can assert the
 * wire shape without a network. The cache-prefix rule is enforced by the
 * runtime before the request reaches any adapter; this maps the surviving
 * breakpoints onto `cache_control` and refuses only the count the API
 * itself refuses.
 */
export function buildAnthropicRequestBody(
  input: Omit<AiProviderRequest, 'apiKey' | 'signal'> & { stream: boolean },
): Record<string, unknown> {
  const breakpoints = input.system.filter((block) => block.cacheBreakpoint)
  if (breakpoints.length > ANTHROPIC_MAX_CACHE_BREAKPOINTS) {
    throw new Error(
      `${breakpoints.length} cache breakpoints; the Messages API allows ${ANTHROPIC_MAX_CACHE_BREAKPOINTS}`,
    )
  }
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
  // A model that rejects an explicit thinking setting gets none, whatever
  // the door asked for, and no effort either: effort rides the same rule
  // (see the contract), and the catalog says which models those are.
  const settable = aiCatalogEntry(input.model)?.capabilities.thinking !== false
  const thinking = settable ? input.thinking : undefined
  const effort = settable ? input.effort : undefined
  return {
    model: input.model,
    max_tokens: input.maxTokens,
    ...(input.stream ? { stream: true } : {}),
    ...(thinking === 'off'
      ? { thinking: { type: 'disabled' } }
      : thinking === 'adaptive'
        ? { thinking: { type: 'adaptive' } }
        : {}),
    ...(effort ? { output_config: { effort } } : {}),
    ...(system.length ? { system } : {}),
    messages: input.messages.map((message) => ({
      role: message.role,
      content: anthropicContentOf(message),
    })),
    ...(tools?.length ? { tools, tool_choice: { type: 'auto' } } : {}),
  }
}

/**
 * A turn's content in the Messages API's shape: a text-only turn as the
 * string it is, and a turn with pictures as content blocks in order, each
 * picture a base64 image block (AGL-2916).
 */
function anthropicContentOf(message: AiMessage): string | Array<Record<string, unknown>> {
  if (typeof message.content === 'string') return message.content
  return message.content.map((part) =>
    part.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } }
      : { type: 'text', text: part.text },
  )
}

/** The provider's request id, when it sent one — the log's join key. */
function requestIdOf(response: Response): string | null {
  return response.headers?.get?.('request-id') ?? null
}

async function send(
  input: AiProviderRequest,
  stream: boolean,
): Promise<Response> {
  const body = buildAnthropicRequestBody({ ...input, stream })
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(input.signal ? { signal: input.signal } : {}),
  })
  if (!response.ok || (stream && !response.body)) {
    const requestId = requestIdOf(response)
    const payload = (await response.json().catch(() => null)) as {
      error?: { type?: string; message?: string }
    } | null
    console.error('ai upstream error', {
      provider: ANTHROPIC_PROVIDER_ID,
      status: response.status,
      requestId,
      model: input.model,
      error: payload?.error ?? null,
    })
    throw new AiUpstreamError(
      response.status,
      anthropicFailureIsRetryable(response.status, payload?.error?.type),
      requestId,
    )
  }
  return response
}

async function complete(input: AiProviderRequest): Promise<AiResult> {
  const response = await send(input, false)
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
      input: aiToolInputOf(block['input']),
    }))
  const usage = anthropicUsageFrom(payload?.usage)
  const estCostUsd = estimateAiBilledUsd(usage, input.model)
  const stopReason =
    typeof payload?.stop_reason === 'string' && payload.stop_reason
      ? payload.stop_reason
      : null
  if (stopReason === 'refusal') {
    return { kind: 'refusal', text, usage, estCostUsd, stopReason }
  }
  return {
    kind: 'completion',
    text,
    toolUse,
    usage,
    estCostUsd,
    stopReason,
    // The blocks as the provider answered them, for a call its ceiling cut
    // off (AGL-3143): `toolUse` holds only what still parsed out of them.
    ...(aiStoppedAtCeiling(stopReason) ? { rawOutput: aiRawOutputOf(blocks) } : {}),
  }
}

async function stream(input: AiProviderRequest): Promise<AsyncIterable<AiStreamEvent>> {
  const response = await send(input, true)
  return streamEvents(
    response.body as ReadableStream<Uint8Array>,
    input.model,
    requestIdOf(response),
  )
}

/**
 * Anthropic's SSE stream as contract events. Usage is taken from
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
  const usage: AiUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  let stopReason: string | null = null
  /** Tool-use blocks in flight, by content index; input arrives in pieces. */
  const tools = new Map<number, { name: string; json: string }>()
  /**
   * What each tool call was actually written in, in the order its block
   * opened (AGL-3143). The `tool` events below carry only as much of these
   * as `aiToolInputOf` could still parse, so for a call the ceiling cut off
   * this is the one place the emitted bytes survive.
   */
  const written: string[] = []
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
            const start = anthropicUsageFrom(
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
              written.push(tool.json)
              yield { type: 'tool', name: tool.name, input: aiToolInputOf(tool.json) }
            }
            break
          }
          case 'message_delta': {
            const delta = anthropicUsageFrom(event['usage'])
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
              provider: ANTHROPIC_PROVIDER_ID,
              requestId,
              model,
              error: error ?? null,
            })
            yield { type: 'error', retryable: anthropicFailureIsRetryable(null, error?.type) }
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
  // A message the ceiling ends mid-block never reaches that block's stop
  // event, so what it had written is still held in flight.
  for (const tool of tools.values()) written.push(tool.json)
  yield {
    type: 'done',
    usage,
    estCostUsd: estimateAiBilledUsd(usage, model),
    stopReason,
    // What the model emitted into its tool calls, for a stream its ceiling
    // cut off (AGL-3143): the `tool` events carry only what parsed out.
    ...(aiStoppedAtCeiling(stopReason) ? { rawOutput: aiRawOutputOf(written.join('')) } : {}),
  }
}

export const anthropicProvider: AiProvider = {
  id: ANTHROPIC_PROVIDER_ID,
  label: 'Anthropic',
  apiKeyEnv: ANTHROPIC_API_KEY_ENV,
  readApiKey: () => process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  endpointHost: ANTHROPIC_HOST,
  toolSchemaLimits: ANTHROPIC_TOOL_SCHEMA_LIMITS,
  models(): readonly AiModelDescriptor[] {
    return aiModelIdsForProvider(ANTHROPIC_PROVIDER_ID)
      .map((id) => aiCatalogEntry(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  },
  complete,
  stream,
}
