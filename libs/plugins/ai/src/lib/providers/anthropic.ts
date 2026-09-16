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
  aiTokenCount,
  aiToolInputOf,
  type AiModelDescriptor,
  type AiProvider,
  type AiProviderRequest,
  type AiResult,
  type AiStreamEvent,
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
  return {
    inputTokens: aiTokenCount(record['input_tokens']),
    outputTokens: aiTokenCount(record['output_tokens']),
    cacheReadTokens: aiTokenCount(record['cache_read_input_tokens']),
    cacheWriteTokens: aiTokenCount(record['cache_creation_input_tokens']),
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
      content: message.content,
    })),
    ...(tools?.length ? { tools, tool_choice: { type: 'auto' } } : {}),
  }
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
  return { kind: 'completion', text, toolUse, usage, estCostUsd, stopReason }
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
  yield {
    type: 'done',
    usage,
    estCostUsd: estimateAiBilledUsd(usage, model),
    stopReason,
  }
}

export const anthropicProvider: AiProvider = {
  id: ANTHROPIC_PROVIDER_ID,
  label: 'Anthropic',
  apiKeyEnv: ANTHROPIC_API_KEY_ENV,
  readApiKey: () => process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  endpointHost: ANTHROPIC_HOST,
  models(): readonly AiModelDescriptor[] {
    return aiModelIdsForProvider(ANTHROPIC_PROVIDER_ID)
      .map((id) => aiCatalogEntry(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  },
  complete,
  stream,
}
