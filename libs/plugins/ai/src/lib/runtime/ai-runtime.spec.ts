/**
 * @jest-environment node
 */
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

import { estimateAiBilledUsd } from '../providers/catalog'
import {
  anthropicFailureIsRetryable,
  anthropicProvider,
  buildAnthropicRequestBody,
} from '../providers/anthropic'
import { AI_IMAGE_MAX_BYTES, AI_REQUEST_MAX_IMAGES, type AiMessage } from '../providers/contract'
import {
  AI_UPSTREAM_FAILURE_COPY,
  AiRequestShapeError,
  AiUpstreamError,
  aiModelReadsImages,
  runAiRequest,
  validateAiMessages,
  validateAiSystemBlocks,
  type AiStreamEvent,
} from './ai-runtime'

/**
 * The shared runtime (AGL-2903) over the Anthropic adapter (AGL-2939).
 *
 * Every door used to own a copy of the request shape, the SSE parser and the
 * usage arithmetic, and the two copies had already diverged on caching and
 * thinking. This suite pins the one shape they now share: what goes on the
 * wire, what a stream is turned into, what a refusal and a failure become,
 * and the rule that refuses a per-org byte inside a cached prefix before any
 * request is made. The provider is named on every request so the suite
 * needs no registry; the conformance suite beside the adapters covers the
 * same contract on the second adapter.
 */

/** Every request goes through the Anthropic adapter, named explicitly. */
const buildAiRequestBody = (input: Parameters<typeof buildAnthropicRequestBody>[0]) => {
  validateAiSystemBlocks(input.system)
  return buildAnthropicRequestBody(input)
}

const mockFetch = jest.fn()

const BASE = {
  model: 'claude-sonnet-5',
  system: [{ text: 'You answer questions.' }],
  messages: [{ role: 'user' as const, content: 'Hello' }],
  maxTokens: 256,
  provider: anthropicProvider,
}

/** One SSE body from a list of events, as the provider frames them. */
function sseBody(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}

async function collect(
  iterable: AsyncIterable<AiStreamEvent>,
): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = []
  for await (const event of iterable) out.push(event)
  return out
}

/** The body the mocked fetch was handed, parsed. */
function sentBody(): Record<string, unknown> {
  return JSON.parse(String(mockFetch.mock.calls[0][1].body))
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => {
    throw new Error('unarmed network call')
  })
  global.fetch = mockFetch as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  delete process.env.ANTHROPIC_API_KEY
})

describe('the request shape', () => {
  it('turns ordered blocks into a system array with cache_control on the breakpoints only', () => {
    const body = buildAiRequestBody({
      ...BASE,
      stream: false,
      system: [
        { text: 'static', cacheBreakpoint: true },
        { text: 'per route', cacheBreakpoint: true },
        { text: 'per org', volatile: true },
        { text: 'per request', volatile: true },
      ],
    })
    expect(body.system).toEqual([
      { type: 'text', text: 'static', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'per route', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'per org' },
      { type: 'text', text: 'per request' },
    ])
  })

  it('sends thinking DISABLED and the effort for a chat workload', () => {
    const body = buildAiRequestBody({
      ...BASE,
      stream: true,
      thinking: 'off',
      effort: 'low',
    })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.output_config).toEqual({ effort: 'low' })
    expect(body.stream).toBe(true)
  })

  it('sends adaptive thinking for a generation workload', () => {
    const body = buildAiRequestBody({ ...BASE, stream: false, thinking: 'adaptive' })
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toBeUndefined()
  })

  it('sends NOTHING about thinking or effort when the caller says nothing', () => {
    // Haiku 4.5 rejects `adaptive`, and the copy assistant serves its
    // element mode on Haiku: an omitted field leaves the model default in
    // force rather than guessing one.
    const body = buildAiRequestBody({ ...BASE, stream: false })
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('output_config')
    expect(body).not.toHaveProperty('stream')
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('maps a tool to a strict input_schema with additionalProperties off, and leaves tool_choice on auto', () => {
    const body = buildAiRequestBody({
      ...BASE,
      stream: false,
      tools: [
        {
          name: 'emit_section',
          description: 'Emit the section',
          inputSchema: {
            type: 'object',
            properties: { rootId: { type: 'string' } },
            required: ['rootId'],
          },
          strict: true,
        },
      ],
    })
    expect(body.tools).toEqual([
      {
        name: 'emit_section',
        description: 'Emit the section',
        input_schema: {
          type: 'object',
          properties: { rootId: { type: 'string' } },
          required: ['rootId'],
          additionalProperties: false,
        },
        strict: true,
      },
    ])
    expect(body.tool_choice).toEqual({ type: 'auto' })
  })
})

describe('the cache guard (AGL-2352)', () => {
  it('refuses a block that is both a breakpoint and volatile', () => {
    expect(() =>
      buildAiRequestBody({
        ...BASE,
        stream: false,
        system: [{ text: 'Acme Corp is the brand', cacheBreakpoint: true, volatile: true }],
      }),
    ).toThrow(AiRequestShapeError)
  })

  it('refuses a volatile block that sits BEFORE a later breakpoint — the prefix is what is cached', () => {
    // The subtler shape, and the one the rule exists for: the volatile block
    // carries no marker of its own, but a breakpoint after it caches
    // everything before it, so the per-org byte is inside the prefix anyway.
    expect(() =>
      buildAiRequestBody({
        ...BASE,
        stream: false,
        system: [
          { text: 'static', cacheBreakpoint: true },
          { text: 'Acme Corp', volatile: true },
          { text: 'route', cacheBreakpoint: true },
        ],
      }),
    ).toThrow(/volatile but sits inside the cached prefix/)
  })

  it('accepts a volatile block AFTER the last breakpoint', () => {
    expect(() =>
      buildAiRequestBody({
        ...BASE,
        stream: false,
        system: [
          { text: 'static', cacheBreakpoint: true },
          { text: 'Acme Corp', volatile: true },
        ],
      }),
    ).not.toThrow()
  })

  it('refuses a fifth breakpoint', () => {
    expect(() =>
      buildAiRequestBody({
        ...BASE,
        stream: false,
        system: Array.from({ length: 5 }, (_, index) => ({
          text: `block ${index}`,
          cacheBreakpoint: true as const,
        })),
      }),
    ).toThrow(/5 cache breakpoints/)
  })

  it('refuses before any network is touched', async () => {
    await expect(
      runAiRequest({
        ...BASE,
        stream: false,
        system: [{ text: 'x', cacheBreakpoint: true, volatile: true }],
      }),
    ).rejects.toBeInstanceOf(AiRequestShapeError)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('the picture guard (AGL-2916)', () => {
  /** Four bytes of a JPEG's start, base64. */
  const PICTURE = '/9j/4AAQ'
  const pictureTurn = (part: Record<string, unknown> = {}): AiMessage => ({
    role: 'user',
    content: [
      { type: 'image', mediaType: 'image/jpeg', data: PICTURE, ...part } as never,
      { type: 'text', text: 'Describe this product' },
    ],
  })
  const readsImages = () => true

  it('admits a picture in a user turn for a model that reads pictures, and plain text for any', () => {
    expect(() => validateAiMessages([pictureTurn()], readsImages)).not.toThrow()
    expect(() => validateAiMessages([{ role: 'user', content: 'Hello' }], () => false)).not.toThrow()
  })

  it('asks whether the model reads pictures only when a turn carries one', () => {
    const asked = jest.fn(() => false)
    validateAiMessages([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }], asked)
    expect(asked).not.toHaveBeenCalled()
    expect(() => validateAiMessages([pictureTurn()], asked)).toThrow(AiRequestShapeError)
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['on an assistant turn', { ...pictureTurn(), role: 'assistant' } as AiMessage],
    ['of a type no model is promised to read', pictureTurn({ mediaType: 'image/svg+xml' })],
    ['as a data: URL instead of bare base64', pictureTurn({ data: `data:image/jpeg;base64,${PICTURE}` })],
    ['with no bytes at all', pictureTurn({ data: '' })],
    ['over the size one picture may be', pictureTurn({ data: 'A'.repeat(Math.ceil((AI_IMAGE_MAX_BYTES * 4) / 3) + 8) })],
    ['as a part of a type the contract does not have', { role: 'user', content: [{ type: 'audio' }] } as never],
    ['as an empty list of parts', { role: 'user', content: [] } as never],
  ])('refuses a picture %s', (_why, message) => {
    expect(() => validateAiMessages([message], readsImages)).toThrow(AiRequestShapeError)
  })

  it('refuses more pictures than one request carries', () => {
    const many = Array.from({ length: AI_REQUEST_MAX_IMAGES + 1 }, () => pictureTurn())
    expect(() => validateAiMessages(many, readsImages)).toThrow(/at most/)
  })

  it('reads the provider’s own descriptor, and a model it does not describe reads none', () => {
    expect(aiModelReadsImages(anthropicProvider, 'claude-sonnet-5')).toBe(true)
    expect(aiModelReadsImages(anthropicProvider, 'not-a-model')).toBe(false)
    const blind = {
      ...anthropicProvider,
      models: () =>
        anthropicProvider.models().map((model) => ({
          ...model,
          capabilities: { ...model.capabilities, vision: undefined },
        })),
    }
    expect(aiModelReadsImages(blind, 'claude-sonnet-5')).toBe(false)
  })

  it('refuses a picture for a model that does not read pictures before any network is touched', async () => {
    const blind = {
      ...anthropicProvider,
      models: () =>
        anthropicProvider.models().map((model) => ({
          ...model,
          capabilities: { ...model.capabilities, vision: false },
        })),
    }
    await expect(
      runAiRequest({ ...BASE, provider: blind, messages: [pictureTurn()], stream: false }),
    ).rejects.toThrow(AiRequestShapeError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends the picture as a base64 image block ahead of the text it came with', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'A brass desk lamp.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 800, output_tokens: 12 },
      }),
    })
    await runAiRequest({ ...BASE, messages: [pictureTurn()], stream: false })
    expect(sentBody().messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PICTURE } },
          { type: 'text', text: 'Describe this product' },
        ],
      },
    ])
  })
})

describe('a non-streaming request', () => {
  it('posts to the Messages API with the key and version headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'request-id': 'req_1' }),
      json: async () => ({
        content: [{ type: 'text', text: 'Hi' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    })
    await runAiRequest({ ...BASE, stream: false })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    })
    expect(sentBody().model).toBe('claude-sonnet-5')
  })

  it('returns the text, the tool inputs as OBJECTS, the usage and the cost at the serving model’s rates', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          { type: 'text', text: 'Here is ' },
          { type: 'text', text: 'the section.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'emit_section',
            input: { rootId: 'n1', nodes: { n1: { componentId: 'muiStack' } } },
          },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 900,
          output_tokens: 120,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 50,
        },
      }),
    })
    const result = await runAiRequest({ ...BASE, model: 'claude-haiku-4-5', stream: false })
    expect(result.kind).toBe('completion')
    if (result.kind !== 'completion') throw new Error('unreachable')
    expect(result.text).toBe('Here is the section.')
    expect(result.toolUse).toEqual([
      {
        name: 'emit_section',
        input: { rootId: 'n1', nodes: { n1: { componentId: 'muiStack' } } },
      },
    ])
    expect(result.stopReason).toBe('tool_use')
    expect(result.usage).toEqual({
      inputTokens: 900,
      outputTokens: 120,
      cacheReadTokens: 400,
      cacheWriteTokens: 50,
    })
    // Haiku rates, because that is the model the request named — a runtime
    // that priced every door at Sonnet would report the wrong margin.
    expect(result.estCostUsd).toBe(
      estimateAiBilledUsd(result.usage, 'claude-haiku-4-5'),
    )
    expect(result.estCostUsd).not.toBe(
      estimateAiBilledUsd(result.usage, 'claude-sonnet-5'),
    )
  })

  it('types a refusal as a result, never as an exception', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber' },
        usage: { input_tokens: 40, output_tokens: 1 },
      }),
    })
    const result = await runAiRequest({ ...BASE, stream: false })
    expect(result).toMatchObject({
      kind: 'refusal',
      stopReason: 'refusal',
      text: '',
      usage: { inputTokens: 40, outputTokens: 1 },
    })
    // Tokens were spent, so the cost is real and the caller meters it.
    expect(result.estCostUsd).toBeGreaterThan(0)
  })
})

describe('a streaming request', () => {
  it('re-emits text deltas, assembles a tool block from its fragments, and closes with usage and cost', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'request-id': 'req_2' }),
      body: sseBody([
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 900,
              cache_read_input_tokens: 400,
              cache_creation_input_tokens: 50,
            },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Open the screen, ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'then press Publish.' } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'emit_section', input: {} },
        },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"rootId":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"n1","nodes":{}}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
        { type: 'message_stop' },
      ]),
    })
    const events = await collect(await runAiRequest({ ...BASE, stream: true }))
    expect(events).toEqual([
      { type: 'delta', text: 'Open the screen, ' },
      { type: 'delta', text: 'then press Publish.' },
      { type: 'tool', name: 'emit_section', input: { rootId: 'n1', nodes: {} } },
      {
        type: 'done',
        stopReason: 'tool_use',
        usage: {
          inputTokens: 900,
          outputTokens: 42,
          cacheReadTokens: 400,
          cacheWriteTokens: 50,
        },
        estCostUsd: estimateAiBilledUsd(
          { inputTokens: 900, outputTokens: 42, cacheReadTokens: 400, cacheWriteTokens: 50 },
          'claude-sonnet-5',
        ),
      },
    ])
    expect(sentBody().stream).toBe(true)
  })

  it('relays an in-stream provider error as a typed event and still closes with done', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody([
        { type: 'message_start', message: { usage: { input_tokens: 900 } } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ]),
    })
    const events = await collect(await runAiRequest({ ...BASE, stream: true }))
    expect(events[0]).toEqual({ type: 'error', retryable: true })
    expect(events[1]).toMatchObject({ type: 'done', stopReason: null })
    // The provider's words went to the log, not into the event.
    expect(JSON.stringify(events)).not.toContain('Overloaded')
  })

  it('classifies a provider fault mid-stream as NOT retryable', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody([
        { type: 'error', error: { type: 'api_error', message: 'Internal server error' } },
      ]),
    })
    const events = await collect(await runAiRequest({ ...BASE, stream: true }))
    expect(events[0]).toEqual({ type: 'error', retryable: false })
  })

  it('cancels the upstream body when the consumer stops early', async () => {
    let cancelled = false
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } })}\n\n`,
          ),
        )
      },
      cancel() {
        cancelled = true
      },
    })
    mockFetch.mockResolvedValue({ ok: true, status: 200, body })
    const iterable = await runAiRequest({ ...BASE, stream: true })
    for await (const event of iterable) {
      if (event.type === 'delta') break
    }
    expect(cancelled).toBe(true)
  })
})

describe('the error boundary (AGL-2815)', () => {
  it('turns a non-2xx answer into AiUpstreamError with the status, the verdict and the fixed copy', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'request-id': 'req_3' }),
      body: null,
      json: async () => ({
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low to access the Anthropic API.',
        },
      }),
    })
    const error = await runAiRequest({ ...BASE, stream: true }).catch((e) => e)
    expect(error).toBeInstanceOf(AiUpstreamError)
    expect(error).toMatchObject({
      status: 400,
      retryable: false,
      requestId: 'req_3',
      message: AI_UPSTREAM_FAILURE_COPY,
    })
    expect(error.message).not.toMatch(/credit balance|Anthropic/)
    // …and the provider's payload went to the log, keyed by the request id.
    expect(console.error).toHaveBeenCalledWith(
      'ai upstream error',
      expect.objectContaining({
        status: 400,
        requestId: 'req_3',
        error: expect.objectContaining({ type: 'invalid_request_error' }),
      }),
    )
  })

  it.each([
    [429, undefined, true],
    [529, undefined, true],
    [500, 'api_error', false],
    [null, 'rate_limit_error', true],
    [null, 'overloaded_error', true],
    [null, 'api_error', false],
    [400, 'invalid_request_error', false],
  ])('status %s / type %s → retryable %s', (status, type, retryable) => {
    expect(anthropicFailureIsRetryable(status, type)).toBe(retryable)
  })

  it('marks an overloaded provider retryable', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 529,
      body: null,
      json: async () => ({ error: { type: 'overloaded_error', message: 'Overloaded' } }),
    })
    await expect(runAiRequest({ ...BASE, stream: false })).rejects.toMatchObject({
      status: 529,
      retryable: true,
    })
  })

  it('refuses to run without a key rather than sending an unauthenticated request', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(runAiRequest({ ...BASE, stream: false })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
