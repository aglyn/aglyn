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

/**
 * Provider conformance (AGL-2939): the SAME assertions run against every
 * adapter over recorded fixtures — a completion with a tool call and cache
 * usage, a stream that assembles a tool from fragments and closes with
 * usage, a decline that becomes a refusal rather than an exception, an
 * in-stream fault, and the two kinds of non-2xx answer. An adapter that
 * passes here can stand behind every door; the doors never see which one
 * did.
 *
 * The fixtures are the vendors' documented wire shapes, recorded rather
 * than fetched, so the suite runs without a key and without a network.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { resetPluginServicesForTests } from '@aglyn/aglyn'
import { anthropicProvider, anthropicUsageFrom, buildAnthropicRequestBody } from './anthropic'
import { estimateAiBilledUsd } from './catalog'
import {
  AI_RAW_OUTPUT_MAX_CHARS,
  AI_UPSTREAM_FAILURE_COPY,
  AiUpstreamError,
  aiRawOutputOf,
  aiStoppedAtCeiling,
  type AiProvider,
  type AiProviderRequest,
  type AiStreamEvent,
} from './contract'
import {
  buildOpenAiCompatibleRequestBody,
  openAiCompatibleProvider,
} from './openai-compatible'
import { registerAiProvider } from './registry'
import { aiModelForStep, resolveAiRoute } from './routing'

interface Fixture {
  status: number
  headers: Record<string, string>
  body?: unknown
  events?: unknown[]
}

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', `${name}.json`), 'utf8'))

/** One SSE body from a list of events, as the provider frames them. */
function sseBody(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const data = typeof event === 'string' ? event : JSON.stringify(event)
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }
      controller.close()
    },
  })
}

/** A `fetch` answering one recorded fixture. */
function armFetch(fx: Fixture): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: fx.status >= 200 && fx.status < 300,
    status: fx.status,
    headers: new Headers(fx.headers),
    body: fx.events ? sseBody(fx.events) : null,
    json: async () => fx.body,
  })
  global.fetch = mock as unknown as typeof fetch
  return mock
}

async function collect(iterable: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = []
  for await (const event of iterable) out.push(event)
  return out
}

interface Subject {
  provider: AiProvider
  prefix: string
  model: string
  /** What the adapter reports as cache writes: the second vendor has none. */
  cacheWriteTokens: number
  env: Record<string, string>
  requestIdHeader: string
  assertShape: (body: Record<string, unknown>, stream: boolean) => void
  /** The user turn of a request that carries a picture, as the vendor takes it. */
  pictureTurn: unknown
  /** That same answer with the vendor's own "stopped at the ceiling" word on it. */
  atCeiling: (body: unknown) => unknown
  /**
   * That vendor's SSE for a message the ceiling cut off while it was writing
   * a second tool call: the first call is delivered whole, and `json` is as
   * much of the second as the model got out before the ceiling.
   */
  cutOffStream: (json: string) => unknown[]
}

/** Four bytes of a JPEG's start, base64: a picture's shape, not a picture. */
const PICTURE = '/9j/4AAQ'

/** The call that finished, ahead of the one the ceiling cut off. */
const FIRST_CALL = '{"rootId":"n1","nodes":{}}'

const SUBJECTS: Subject[] = [
  {
    provider: anthropicProvider,
    prefix: 'anthropic',
    model: 'claude-haiku-4-5',
    cacheWriteTokens: 50,
    env: { ANTHROPIC_API_KEY: 'sk-test' },
    requestIdHeader: 'request-id',
    pictureTurn: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PICTURE } },
        { type: 'text', text: 'Describe this product' },
      ],
    },
    assertShape: (body, stream) => {
      expect(body['system']).toEqual([{ type: 'text', text: 'You build sections.' }])
      expect(body['tools']).toEqual([
        expect.objectContaining({
          name: 'emit_section',
          strict: true,
          input_schema: expect.objectContaining({ additionalProperties: false }),
        }),
      ])
      expect(body['tool_choice']).toEqual({ type: 'auto' })
      if (stream) expect(body['stream']).toBe(true)
      else expect(body).not.toHaveProperty('stream')
    },
    atCeiling: (body) => ({ ...(body as Record<string, unknown>), stop_reason: 'max_tokens' }),
    // The second block never reaches its stop event: the message ends at the
    // ceiling with that call still open.
    cutOffStream: (json) => [
      { type: 'message_start', message: { usage: { input_tokens: 900 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_c1', name: 'emit_section', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: FIRST_CALL },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_c2', name: 'emit_section', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: json },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens' },
        usage: { output_tokens: 4000 },
      },
      { type: 'message_stop' },
    ],
  },
  {
    provider: openAiCompatibleProvider,
    prefix: 'openai-compatible',
    model: 'gpt-5-mini',
    cacheWriteTokens: 0,
    env: {
      AI_OPENAI_COMPAT_BASE_URL: 'https://llm.example.test/v1/',
      AI_OPENAI_COMPAT_API_KEY: 'sk-compat',
    },
    requestIdHeader: 'x-request-id',
    pictureTurn: {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PICTURE}` } },
        { type: 'text', text: 'Describe this product' },
      ],
    },
    assertShape: (body, stream) => {
      const messages = body['messages'] as Array<{ role: string; content: string }>
      expect(messages[0]).toEqual({ role: 'system', content: 'You build sections.' })
      expect(messages[1]).toEqual({ role: 'user', content: 'A hero section' })
      expect(body['tools']).toEqual([
        {
          type: 'function',
          function: expect.objectContaining({
            name: 'emit_section',
            strict: true,
            parameters: expect.objectContaining({ additionalProperties: false }),
          }),
        },
      ])
      expect(body['tool_choice']).toBe('auto')
      if (stream) {
        expect(body['stream']).toBe(true)
        expect(body['stream_options']).toEqual({ include_usage: true })
      } else expect(body).not.toHaveProperty('stream')
    },
    // The endpoint's own word, which the adapter maps onto `max_tokens`.
    atCeiling: (body) => {
      const payload = body as { choices: Array<Record<string, unknown>> }
      return { ...payload, choices: [{ ...payload.choices[0], finish_reason: 'length' }] }
    },
    cutOffStream: (json) => [
      {
        id: 'chatcmpl-c',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_c1',
                  type: 'function',
                  function: { name: 'emit_section', arguments: FIRST_CALL },
                },
                {
                  index: 1,
                  id: 'call_c2',
                  type: 'function',
                  function: { name: 'emit_section', arguments: json },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      { id: 'chatcmpl-c', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
      {
        id: 'chatcmpl-c',
        choices: [],
        usage: { prompt_tokens: 900, completion_tokens: 4000 },
      },
      '[DONE]',
    ],
  },
]

const request = (subject: Subject): AiProviderRequest => ({
  model: subject.model,
  apiKey: 'sk-test',
  system: [{ text: 'You build sections.' }],
  messages: [{ role: 'user', content: 'A hero section' }],
  maxTokens: 512,
  tools: [
    {
      name: 'emit_section',
      description: 'Emit the section',
      inputSchema: { type: 'object', properties: { rootId: { type: 'string' } } },
      strict: true,
    },
  ],
})

const usageOf = (subject: Subject, outputTokens: number) => ({
  inputTokens: 900,
  outputTokens,
  cacheReadTokens: 400,
  cacheWriteTokens: subject.cacheWriteTokens,
})

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  for (const subject of SUBJECTS) for (const key of Object.keys(subject.env)) delete process.env[key]
})

describe.each(SUBJECTS)('$prefix adapter conforms to the provider contract', (subject) => {
  beforeEach(() => {
    Object.assign(process.env, subject.env)
  })

  it('reads its own key, and has none when its environment is unset', () => {
    expect(subject.provider.readApiKey()).toBe(subject.env[subject.provider.apiKeyEnv])
    for (const key of Object.keys(subject.env)) delete process.env[key]
    expect(subject.provider.readApiKey()).toBeUndefined()
  })

  it('describes itself: an id, a key variable, a host, and the catalog models it serves', () => {
    expect(subject.provider.id).toBe(subject.prefix)
    expect(subject.provider.apiKeyEnv).toBeTruthy()
    expect(subject.provider.endpointHost).toBeTruthy()
    const models = subject.provider.models()
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((model) => model.provider === subject.prefix)).toBe(true)
    expect(models.map((model) => model.id)).toContain(subject.model)
  })

  it('describes every model it serves as reading pictures, which its vendor documents', () => {
    // A descriptor that leaves `vision` out reads as a model that takes no
    // picture, and the runtime then refuses to send it one (AGL-2916).
    expect(subject.provider.models().filter((model) => model.capabilities.vision !== true)).toEqual([])
  })

  it('carries a picture in a user turn as bytes in its own shape, never as a URL to fetch', async () => {
    const mock = armFetch(fixture(`${subject.prefix}-completion`))
    await subject.provider.complete({
      ...request(subject),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mediaType: 'image/jpeg', data: PICTURE },
            { type: 'text', text: 'Describe this product' },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'A brass lamp.' }] },
        { role: 'user', content: 'Shorter, please' },
      ],
    })
    const body = JSON.parse(String(mock.mock.calls[0][1].body)) as Record<string, unknown>
    const messages = body['messages'] as unknown[]
    const turns = subject.prefix === 'openai-compatible' ? messages.slice(1) : messages
    expect(turns).toEqual([
      subject.pictureTurn,
      // An assistant turn made of parts is its text, and a text turn stays a string.
      subject.prefix === 'openai-compatible'
        ? { role: 'assistant', content: 'A brass lamp.' }
        : { role: 'assistant', content: [{ type: 'text', text: 'A brass lamp.' }] },
      { role: 'user', content: 'Shorter, please' },
    ])
  })

  it('sends the contract request in its own wire shape, with the key', async () => {
    const mock = armFetch(fixture(`${subject.prefix}-completion`))
    await subject.provider.complete(request(subject))
    const [url, init] = mock.mock.calls[0]
    expect(String(url)).toContain(subject.provider.endpointHost)
    expect(init.method).toBe('POST')
    expect(JSON.stringify(init.headers)).toContain('sk-test')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body['model']).toBe(subject.model)
    expect(body['max_tokens']).toBe(512)
    subject.assertShape(body, false)
  })

  it('completes: text joined, tool inputs as OBJECTS, usage split by cache, cost at the model’s rates', async () => {
    armFetch(fixture(`${subject.prefix}-completion`))
    const result = await subject.provider.complete(request(subject))
    expect(result.kind).toBe('completion')
    if (result.kind !== 'completion') throw new Error('unreachable')
    expect(result.text).toBe('Here is the section.')
    expect(result.toolUse).toEqual([
      { name: 'emit_section', input: { rootId: 'n1', nodes: { n1: { componentId: 'muiStack' } } } },
    ])
    expect(result.stopReason).toBe('tool_use')
    expect(result.usage).toEqual(usageOf(subject, 120))
    expect(result.estCostUsd).toBe(estimateAiBilledUsd(result.usage, subject.model))
    expect(result.estCostUsd).toBeGreaterThan(0)
  })

  it('keeps what it wrote when the ceiling cut the call off, and keeps nothing when it did not (AGL-3143)', async () => {
    const served = fixture(`${subject.prefix}-completion`)
    armFetch(served)
    expect(await subject.provider.complete(request(subject))).not.toHaveProperty('rawOutput')

    armFetch({ ...served, body: subject.atCeiling(served.body) })
    const cut = await subject.provider.complete(request(subject))
    if (cut.kind !== 'completion') throw new Error('unreachable')
    expect(cut.stopReason).toBe('max_tokens')
    // The bytes the parsed `toolUse` input is only as much of as still read:
    // without them a runaway string and a decoding stall look the same.
    expect(cut.rawOutput).toContain('emit_section')
    expect(cut.rawOutput).toContain('muiStack')
  })

  it('types a decline as a refusal result, never as an exception, with the tokens it cost', async () => {
    armFetch(fixture(`${subject.prefix}-refusal`))
    const result = await subject.provider.complete(request(subject))
    expect(result).toMatchObject({
      kind: 'refusal',
      stopReason: 'refusal',
      text: '',
      usage: { inputTokens: 40, outputTokens: 1 },
    })
    expect(result.estCostUsd).toBeGreaterThan(0)
  })

  it('streams: re-emits deltas, assembles a tool from fragments, closes with usage and cost', async () => {
    const mock = armFetch(fixture(`${subject.prefix}-stream`))
    const events = await collect(await subject.provider.stream(request(subject)))
    expect(events).toEqual([
      { type: 'delta', text: 'Open the screen, ' },
      { type: 'delta', text: 'then press Publish.' },
      { type: 'tool', name: 'emit_section', input: { rootId: 'n1', nodes: {} } },
      {
        type: 'done',
        stopReason: 'tool_use',
        usage: usageOf(subject, 42),
        estCostUsd: estimateAiBilledUsd(usageOf(subject, 42), subject.model),
      },
    ])
    subject.assertShape(JSON.parse(String(mock.mock.calls[0][1].body)), true)
  })

  it('streams: keeps the bytes a cut-off tool call was written in, and none when the stop was clean (AGL-3143)', async () => {
    // A stream that ended on its own: the parsed input says everything its
    // fragments did, so there is nothing the trace does not already have.
    armFetch(fixture(`${subject.prefix}-stream`))
    const whole = await collect(await subject.provider.stream(request(subject)))
    expect(whole[whole.length - 1]).not.toHaveProperty('rawOutput')

    // Cut mid-string, where nothing of the second call parses: it reaches a
    // reader with an empty input or not at all, so without these fragments a
    // runaway string and a decoding stall both read as 4,000 output tokens
    // against an answer that holds one small section.
    const partial = '{"rootId":"n2","nodes":{"n2":{"props":{"title":"A headline that ran'
    armFetch({ status: 200, headers: {}, events: subject.cutOffStream(partial) })
    const cut = await collect(await subject.provider.stream(request(subject)))
    const done = cut[cut.length - 1]
    if (done.type !== 'done') throw new Error('unreachable')
    expect(done.stopReason).toBe('max_tokens')
    // Both calls: the one that closed, and the one the ceiling left open.
    expect(done.rawOutput).toBe(`${FIRST_CALL}${partial}`)
  })

  it('streams: cuts a runaway tool call at the bound and marks it (AGL-3143)', async () => {
    const runaway = `{"rootId":"${'n'.repeat(AI_RAW_OUTPUT_MAX_CHARS)}`
    armFetch({ status: 200, headers: {}, events: subject.cutOffStream(runaway) })
    const events = await collect(await subject.provider.stream(request(subject)))
    const done = events[events.length - 1]
    if (done.type !== 'done') throw new Error('unreachable')
    // A trace of a runaway string would otherwise be as long as the string
    // that ran away; the ellipsis says a reader is seeing part of it.
    expect(done.rawOutput).toHaveLength(AI_RAW_OUTPUT_MAX_CHARS + 1)
    expect(done.rawOutput?.endsWith('…')).toBe(true)
  })

  it('relays an in-stream fault as a typed, retryable event and still closes with done', async () => {
    armFetch(fixture(`${subject.prefix}-stream-error`))
    const events = await collect(await subject.provider.stream(request(subject)))
    expect(events.find((event) => event.type === 'error')).toEqual({
      type: 'error',
      retryable: true,
    })
    expect(events[events.length - 1]).toMatchObject({ type: 'done' })
    // The vendor's words went to the log, not into the events.
    expect(JSON.stringify(events)).not.toMatch(/Overloaded|overloaded/)
  })

  it('cancels the upstream body when the consumer stops early', async () => {
    let cancelled = false
    const encoder = new TextEncoder()
    // The first event that carries TEXT on each adapter's stream.
    const chunk = fixture(`${subject.prefix}-stream`).events?.find((event) =>
      JSON.stringify(event).includes('Open the screen'),
    )
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      },
      cancel() {
        cancelled = true
      },
    })
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body }) as never
    const iterable = await subject.provider.stream(request(subject))
    for await (const event of iterable) {
      if (event.type === 'delta') break
    }
    expect(cancelled).toBe(true)
  })

  it('maps a rate limit to a RETRYABLE AiUpstreamError with the request id and the fixed copy', async () => {
    armFetch(fixture(`${subject.prefix}-rate-limited`))
    const error = await subject.provider.complete(request(subject)).catch((e) => e)
    expect(error).toBeInstanceOf(AiUpstreamError)
    expect(error).toMatchObject({
      status: 429,
      retryable: true,
      message: AI_UPSTREAM_FAILURE_COPY,
    })
    expect(error.requestId).toBeTruthy()
    expect(error.message).not.toMatch(/rate limit|Anthropic|gpt/i)
    expect(console.error).toHaveBeenCalledWith(
      'ai upstream error',
      expect.objectContaining({ provider: subject.prefix, status: 429 }),
    )
  })

  it('maps a bad request to a NON-retryable AiUpstreamError that never quotes the vendor', async () => {
    armFetch(fixture(`${subject.prefix}-bad-request`))
    const error = await subject.provider.stream(request(subject)).catch((e) => e)
    expect(error).toBeInstanceOf(AiUpstreamError)
    expect(error).toMatchObject({ status: 400, retryable: false })
    expect(error.message).not.toMatch(/credit balance|API key|Anthropic|sk-/)
  })
})

describe('a call cut off at its ceiling (AGL-3143)', () => {
  it('reads the contract’s word and a provider’s own for the same stop', () => {
    expect([aiStoppedAtCeiling('max_tokens'), aiStoppedAtCeiling('length')]).toEqual([true, true])
    expect([aiStoppedAtCeiling('tool_use'), aiStoppedAtCeiling('end_turn'), aiStoppedAtCeiling(null)]).toEqual([
      false,
      false,
      false,
    ])
  })

  it('keeps text as text, serializes anything else, and cuts a runaway one at the bound', () => {
    expect(aiRawOutputOf('{"steps":[')).toBe('{"steps":[')
    expect(aiRawOutputOf([{ type: 'tool_use', input: {} }])).toBe('[{"type":"tool_use","input":{}}]')
    expect(aiRawOutputOf(undefined)).toBe('')
    // A trace of a runaway string would otherwise be as long as the output
    // that ran away; the ellipsis says a reader is seeing part of it.
    const cut = aiRawOutputOf('x'.repeat(AI_RAW_OUTPUT_MAX_CHARS + 500))
    expect(cut).toHaveLength(AI_RAW_OUTPUT_MAX_CHARS + 1)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('the two wire shapes, side by side', () => {
  const input = {
    model: 'x',
    system: [
      { text: 'static', cacheBreakpoint: true as const },
      { text: 'per org', volatile: true as const },
    ],
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 10,
    thinking: 'off' as const,
    stream: false,
  }

  it('the caching adapter marks breakpoints; the other keeps the order and drops the markers', () => {
    const anthropic = buildAnthropicRequestBody({ ...input, model: 'claude-sonnet-5' })
    expect(anthropic['system']).toEqual([
      { type: 'text', text: 'static', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'per org' },
    ])
    expect(anthropic['thinking']).toEqual({ type: 'disabled' })
    const compat = buildOpenAiCompatibleRequestBody({ ...input, model: 'gpt-5' })
    expect((compat['messages'] as Array<{ content: string }>)[0].content).toBe('static\n\nper org')
    expect(compat).not.toHaveProperty('thinking')
  })

  it('a model that rejects an explicit thinking setting is sent none, whatever the door asked', () => {
    const body = buildAnthropicRequestBody({ ...input, model: 'claude-haiku-4-5', thinking: 'adaptive' })
    expect(body).not.toHaveProperty('thinking')
  })

  it('nor an effort, which rides the same rule, while a model that takes one is sent it', () => {
    const haiku = buildAnthropicRequestBody({ ...input, model: 'claude-haiku-4-5', effort: 'low' as const })
    expect(haiku).not.toHaveProperty('output_config')
    const sonnet = buildAnthropicRequestBody({ ...input, model: 'claude-sonnet-5', effort: 'low' as const })
    expect(sonnet['output_config']).toEqual({ effort: 'low' })
  })
})

describe('the routing table (AGL-2937)', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    setRegisteringPluginId(undefined)
    delete process.env['AI_PROVIDER']
    delete process.env['AI_DEFAULT_MODEL']
    delete process.env['ASSIST_MODEL']
  })

  it('seeds the first-party adapters when nothing registered, the first of them by default', () => {
    expect(resolveAiRoute('assist.chat')).toEqual({
      provider: anthropicProvider,
      model: 'claude-sonnet-5',
    })
    // The element copy step runs on the fast tier.
    expect(aiModelForStep('copy.element')).toBe('claude-haiku-4-5')
    // Seeded ONCE: a provider an adopter registered first is not displaced.
    resetPluginServicesForTests()
    registerAiProvider(openAiCompatibleProvider, { pluginId: 'acme-llm' })
    expect(resolveAiRoute('assist.chat')?.provider.id).toBe('openai-compatible')
  })

  it('AI_PROVIDER picks the provider; a second plugin’s provider is as eligible as the first', () => {
    registerAiProvider(anthropicProvider)
    registerAiProvider(openAiCompatibleProvider, { pluginId: 'acme-llm' })
    process.env['AI_PROVIDER'] = 'openai-compatible'
    expect(resolveAiRoute('assist.chat')?.provider.id).toBe('openai-compatible')
    expect(aiModelForStep('assist.chat')).toBe('gpt-5')
    expect(aiModelForStep('copy.element')).toBe('gpt-5-mini')
  })

  it('ASSIST_MODEL overrides the assistant alone and AI_DEFAULT_MODEL every step, only on the served provider', () => {
    registerAiProvider(anthropicProvider)
    process.env['AI_DEFAULT_MODEL'] = 'claude-opus-5'
    process.env['ASSIST_MODEL'] = 'claude-sonnet-4-6'
    expect(aiModelForStep('assist.chat')).toBe('claude-sonnet-4-6')
    expect(aiModelForStep('job.text')).toBe('claude-opus-5')
    // A model the provider does not serve is ignored, not sent.
    process.env['ASSIST_MODEL'] = 'gpt-5'
    expect(aiModelForStep('assist.chat')).toBe('claude-opus-5')
  })

  it('the org’s settings choose the provider and the model per step, ahead of the environment', () => {
    registerAiProvider(anthropicProvider)
    registerAiProvider(openAiCompatibleProvider)
    process.env['AI_DEFAULT_MODEL'] = 'claude-opus-5'
    const settings = { provider: 'openai-compatible', jobTextModel: 'gpt-5-mini' }
    expect(resolveAiRoute('job.text', settings)).toEqual({
      provider: openAiCompatibleProvider,
      model: 'gpt-5-mini',
    })
    // `platform` defers to the environment; an unregistered choice falls back too.
    expect(aiModelForStep('job.text', { provider: 'platform' })).toBe('claude-opus-5')
    expect(resolveAiRoute('job.text', { provider: 'nope' })?.provider.id).toBe('anthropic')
  })
})

describe('where a generation’s output went (AGL-3143)', () => {
  // The figure that separates the shapes a small answer against a spent
  // ceiling comes in. Thinking is drawn from the same ceiling as the answer,
  // so a model that thought its budget away and answered correctly and
  // briefly reads exactly like one whose runaway string was discarded — and
  // only this tells them apart, on every answer rather than only on the ones
  // that reach the ceiling.
  it('keeps how much of the output the model spent thinking, inside the output tokens and never beside them', () => {
    const usage = anthropicUsageFrom({
      input_tokens: 374,
      output_tokens: 4008,
      cache_read_input_tokens: 4293,
      cache_creation_input_tokens: 0,
      output_tokens_details: { thinking_tokens: 3698 },
    })
    expect(usage).toEqual({
      inputTokens: 374,
      outputTokens: 4008,
      cacheReadTokens: 4293,
      cacheWriteTokens: 0,
      thinkingTokens: 3698,
    })
    // Inside `output_tokens`: pricing the four reported figures must not
    // charge the thinking twice.
    expect(estimateAiBilledUsd(usage, 'claude-sonnet-5')).toBe(
      estimateAiBilledUsd({ ...usage, thinkingTokens: undefined }, 'claude-sonnet-5'),
    )
  })

  it('says nothing rather than zero where the answer reported no breakdown', () => {
    expect(anthropicUsageFrom({ input_tokens: 10, output_tokens: 20 })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })
})
