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

import { aiCatalogEntry, aiModelIdsForProvider, estimateAiBilledUsd } from './catalog'
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
 * The OpenAI-compatible adapter (AGL-2939): `POST {base}/chat/completions`
 * against whatever endpoint `AI_OPENAI_COMPAT_BASE_URL` names — a vendor,
 * a gateway, a self-hosted model server — with the key in
 * `AI_OPENAI_COMPAT_API_KEY`. The second adapter behind the contract, and
 * the proof that the runtime, the gate, the jobs and the meter never
 * depended on the first vendor's wire shape.
 *
 * What the mapping gives up, stated rather than hidden: the endpoint has
 * no explicit cache breakpoints, so the ordered system blocks become one
 * system message in order (the runtime's prefix rule still holds, so the
 * order is cache-friendly for an endpoint that caches prefixes on its own),
 * and `cacheReadTokens` is whatever `prompt_tokens_details.cached_tokens`
 * reports. A `content_filter` finish is the endpoint's decline and becomes
 * an `AiRefusal`, the way a refusal stop does on the other adapter.
 */

export const OPENAI_COMPATIBLE_PROVIDER_ID = 'openai-compatible'
export const OPENAI_COMPAT_BASE_URL_ENV = 'AI_OPENAI_COMPAT_BASE_URL'
export const OPENAI_COMPAT_API_KEY_ENV = 'AI_OPENAI_COMPAT_API_KEY'

/** The configured base, with any trailing slash and `/chat/completions` stripped. */
export function openAiCompatibleBaseUrl(): string | null {
  const raw = process.env[OPENAI_COMPAT_BASE_URL_ENV]?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

/** The host the endpoint is reached at, for the subprocessor inventory. */
export function openAiCompatibleHost(): string {
  const base = openAiCompatibleBaseUrl()
  if (!base) return ''
  try {
    return new URL(base).host
  } catch {
    return ''
  }
}

export function openAiCompatibleFailureIsRetryable(status: number | null): boolean {
  return status === 429 || status === 503 || status === 529
}

/** The endpoint's `usage` object, in the meter's shape. Missing fields read 0. */
export function openAiCompatibleUsageFrom(usage: unknown): AiUsage {
  const record = (usage ?? {}) as Record<string, unknown>
  const details = (record['prompt_tokens_details'] ?? {}) as Record<string, unknown>
  const prompt = aiTokenCount(record['prompt_tokens'])
  const cached = Math.min(aiTokenCount(details['cached_tokens']), prompt)
  return {
    // The endpoint counts cached tokens inside `prompt_tokens`; the meter
    // prices them apart, so they are split out here.
    inputTokens: prompt - cached,
    outputTokens: aiTokenCount(record['completion_tokens']),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  }
}

/** The chat-completions body. Exported so a spec can assert the wire shape. */
export function buildOpenAiCompatibleRequestBody(
  input: Omit<AiProviderRequest, 'apiKey' | 'signal'> & { stream: boolean },
): Record<string, unknown> {
  const system = input.system.map((block) => block.text).join('\n\n')
  const tools = input.tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.inputSchema, additionalProperties: false },
      strict: true,
    },
  }))
  return {
    model: input.model,
    max_tokens: input.maxTokens,
    ...(input.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
  }
}

function requestIdOf(response: Response): string | null {
  return response.headers?.get?.('x-request-id') ?? null
}

async function send(input: AiProviderRequest, stream: boolean): Promise<Response> {
  const base = openAiCompatibleBaseUrl()
  if (!base) {
    // Every door gates on the provider being configured before it gets
    // here, so this is a wiring fault rather than a customer path.
    throw new Error(`${OPENAI_COMPAT_BASE_URL_ENV} is not set`)
  }
  const body = buildOpenAiCompatibleRequestBody({ ...input, stream })
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(input.signal ? { signal: input.signal } : {}),
  })
  if (!response.ok || (stream && !response.body)) {
    const requestId = requestIdOf(response)
    const payload = (await response.json().catch(() => null)) as {
      error?: { type?: string; message?: string; code?: string }
    } | null
    console.error('ai upstream error', {
      provider: OPENAI_COMPATIBLE_PROVIDER_ID,
      status: response.status,
      requestId,
      model: input.model,
      error: payload?.error ?? null,
    })
    throw new AiUpstreamError(
      response.status,
      openAiCompatibleFailureIsRetryable(response.status),
      requestId,
    )
  }
  return response
}

/** `finish_reason` → the contract's stop reason; a filter is a refusal. */
function stopReasonOf(finish: unknown): string | null {
  if (typeof finish !== 'string' || !finish) return null
  if (finish === 'content_filter') return 'refusal'
  if (finish === 'stop') return 'end_turn'
  if (finish === 'length') return 'max_tokens'
  if (finish === 'tool_calls') return 'tool_use'
  return finish
}

async function complete(input: AiProviderRequest): Promise<AiResult> {
  const response = await send(input, false)
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown
        tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }>
      }
      finish_reason?: unknown
    }>
    usage?: unknown
  }
  const choice = payload?.choices?.[0]
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
  const toolUse: AiToolUse[] = (choice?.message?.tool_calls ?? []).map((call) => ({
    name: String(call?.function?.name ?? ''),
    input: aiToolInputOf(call?.function?.arguments),
  }))
  const usage = openAiCompatibleUsageFrom(payload?.usage)
  const estCostUsd = estimateAiBilledUsd(usage, input.model)
  const stopReason = stopReasonOf(choice?.finish_reason)
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
 * The endpoint's SSE stream as contract events: `choices[0].delta.content`
 * is text; `delta.tool_calls[i].function.arguments` arrive in pieces and
 * are parsed once at the end of the stream; the final chunk carries
 * `usage` when `stream_options.include_usage` was sent, and `[DONE]` ends
 * the body.
 */
async function* streamEvents(
  body: ReadableStream<Uint8Array>,
  model: string,
  requestId: string | null,
): AsyncGenerator<AiStreamEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let usage: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let stopReason: string | null = null
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
        const data = line.slice('data: '.length).trim()
        if (data === '[DONE]') continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        if (event['error']) {
          const error = event['error'] as { type?: string; message?: string; code?: unknown }
          console.error('ai upstream stream error', {
            provider: OPENAI_COMPATIBLE_PROVIDER_ID,
            requestId,
            model,
            error,
          })
          yield {
            type: 'error',
            retryable: openAiCompatibleFailureIsRetryable(
              typeof error.code === 'number' ? error.code : null,
            ),
          }
          continue
        }
        if (event['usage']) usage = openAiCompatibleUsageFrom(event['usage'])
        const choice = (event['choices'] as Array<Record<string, unknown>> | undefined)?.[0]
        if (!choice) continue
        const delta = choice['delta'] as
          | { content?: unknown; tool_calls?: Array<Record<string, unknown>> }
          | undefined
        if (typeof delta?.content === 'string' && delta.content) {
          yield { type: 'delta', text: delta.content }
        }
        for (const call of delta?.tool_calls ?? []) {
          const index = Number(call['index'] ?? 0)
          const fn = (call['function'] ?? {}) as { name?: unknown; arguments?: unknown }
          const inFlight = tools.get(index) ?? { name: '', json: '' }
          if (typeof fn.name === 'string' && fn.name) inFlight.name = fn.name
          if (typeof fn.arguments === 'string') inFlight.json += fn.arguments
          tools.set(index, inFlight)
        }
        const finish = stopReasonOf(choice['finish_reason'])
        if (finish) stopReason = finish
      }
    }
  } finally {
    if (!drained) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  for (const [, tool] of [...tools.entries()].sort((a, b) => a[0] - b[0])) {
    yield { type: 'tool', name: tool.name, input: aiToolInputOf(tool.json) }
  }
  yield {
    type: 'done',
    usage,
    estCostUsd: estimateAiBilledUsd(usage, model),
    stopReason,
  }
}

export const openAiCompatibleProvider: AiProvider = {
  id: OPENAI_COMPATIBLE_PROVIDER_ID,
  label: 'OpenAI-compatible endpoint',
  apiKeyEnv: OPENAI_COMPAT_API_KEY_ENV,
  // Ready only with both halves: a key with no endpoint has nowhere to go.
  readApiKey: () =>
    openAiCompatibleBaseUrl() ? process.env.AI_OPENAI_COMPAT_API_KEY?.trim() || undefined : undefined,
  get endpointHost() {
    return openAiCompatibleHost()
  },
  models(): readonly AiModelDescriptor[] {
    return aiModelIdsForProvider(OPENAI_COMPATIBLE_PROVIDER_ID)
      .map((id) => aiCatalogEntry(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  },
  complete,
  stream,
}
