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

import {
  aiBilledRatesForModel,
  aiDefaultModelFor,
  aiCatalogEntry,
  aiProviderRatesForModel,
  estimateAiBilledUsd,
} from './catalog'
import { AI_CACHE_WRITE_HOUR_FACTOR, aiCacheWriteHourSum, aiCacheWriteHourSurchargeUsd } from './cache-write-hour'
import { anthropicResultFrom, anthropicUsageFrom, buildAnthropicRequestBody } from './anthropic'
import { aiCacheMarkerTtls, type AiMessage, type AiSystemBlock, type AiTool } from './contract'

const TOOL: AiTool = {
  name: 'submit',
  description: 'Submit.',
  strict: true,
  inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
}

function body(model: string, extra: Record<string, unknown> = {}) {
  return buildAnthropicRequestBody({
    model,
    maxTokens: 100,
    system: [{ text: 'rules', cacheBreakpoint: true }, { text: 'site', volatile: true }],
    messages: [{ role: 'user', content: 'brief' }],
    tools: [TOOL],
    stream: false,
    ...extra,
  } as never)
}

describe('the Messages API body for the models that refuse disabled thinking (AGL-3660)', () => {
  it('says thinking off as disabled to every model that takes it', () => {
    expect(body('claude-sonnet-5', { thinking: 'off' })['thinking']).toEqual({ type: 'disabled' })
  })

  it('says thinking off to Claude Sonnet 5.5 as between_tools, with no other field', () => {
    const sent = body('claude-sonnet-5-5', { thinking: 'off' })
    expect(sent['thinking']).toEqual({ type: 'between_tools' })
    expect(sent['output_config']).toBeUndefined()
  })

  it('leaves thinking out for Claude Opus 5.5, which cannot turn it off, and names effort high', () => {
    const sent = body('claude-opus-5-5', { thinking: 'off' })
    expect(sent['thinking']).toBeUndefined()
    expect(sent['output_config']).toEqual({ effort: 'high' })
  })

  it("keeps a request's own effort on Claude Opus 5.5", () => {
    expect(body('claude-opus-5-5', { effort: 'low' })['output_config']).toEqual({ effort: 'low' })
  })

  it('never forces a tool a request does not name, on any model', () => {
    for (const model of ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      expect([model, body(model)['tool_choice']]).toEqual([model, { type: 'auto' }])
    }
  })

  it('serves the balanced tier from Claude Sonnet 5.5 and leaves the deep default where it was', () => {
    expect(aiDefaultModelFor('anthropic', 'balanced')).toBe('claude-sonnet-5-5')
    expect(aiDefaultModelFor('anthropic', 'deep')).toBe('claude-opus-5')
    expect(aiCatalogEntry('claude-sonnet-5-5')?.tier).toBe('balanced')
    expect(aiCatalogEntry('claude-opus-5-5')?.tier).toBe('deep')
  })
})

describe('the Messages API body for Claude Haiku 5.5, the fast default (AGL-3781)', () => {
  it('serves the fast tier from Claude Haiku 5.5, which caches a prefix from 512 tokens', () => {
    expect(aiDefaultModelFor('anthropic', 'fast')).toBe('claude-haiku-5-5')
    expect(aiCatalogEntry('claude-haiku-5-5')).toMatchObject({ tier: 'fast', cacheMinTokens: 512 })
  })

  it('says thinking off as disabled with the effort the row asks, which the model accepts up to high', () => {
    const sent = body('claude-haiku-5-5', { thinking: 'off', effort: 'low' })
    expect(sent['thinking']).toEqual({ type: 'disabled' })
    expect(sent['output_config']).toEqual({ effort: 'low' })
  })

  it('sends nothing a model of its line refuses: no budget, sampling parameter, prefill or fallback', () => {
    for (const extra of [{}, { thinking: 'adaptive' }, { thinking: 'off', effort: 'medium' }]) {
      const sent = body('claude-haiku-5-5', extra)
      expect(sent['thinking'] && 'budget_tokens' in (sent['thinking'] as object)).toBeFalsy()
      for (const field of ['temperature', 'top_p', 'top_k', 'fallbacks']) expect([field, field in sent]).toEqual([field, false])
      const messages = sent['messages'] as Array<{ role: string }>
      expect(messages[messages.length - 1].role).toBe('user')
    }
  })

  it('reads the answer by block type, past an empty thinking block, and a refusal as a refusal', () => {
    const answer = anthropicResultFrom(
      {
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'tool_use', name: 'submit', input: { a: 'x' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      'claude-haiku-5-5',
    )
    expect(answer.kind === 'completion' && answer.toolUse).toEqual([{ name: 'submit', input: { a: 'x' } }])
    expect(answer.text).toBe('')
    const refused = anthropicResultFrom(
      { content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage: { input_tokens: 10, output_tokens: 0 } },
      'claude-haiku-5-5',
    )
    expect(refused.kind).toBe('refusal')
  })
})

describe('the cache lifetime a request asks for', () => {
  it('asks for the default five minutes on every breakpoint unless told otherwise', () => {
    const system = body('claude-sonnet-5')['system'] as Array<Record<string, unknown>>
    expect(system[0]['cache_control']).toEqual({ type: 'ephemeral' })
    expect(system[1]['cache_control']).toBeUndefined()
  })

  it('asks for the hour on every shared breakpoint when the request does', () => {
    const system = body('claude-sonnet-5', { cacheTtl: '1h' })['system'] as Array<Record<string, unknown>>
    expect(system[0]['cache_control']).toEqual({ type: 'ephemeral', ttl: '1h' })
  })
})

/** Every `cache_control` of a wire body in the API's prefix order (tools, system, messages), `null`-free. */
function wireMarkers(sent: Record<string, unknown>): Array<Record<string, unknown>> {
  const tools = (sent['tools'] ?? []) as Array<Record<string, unknown>>
  const system = (sent['system'] ?? []) as Array<Record<string, unknown>>
  const messages = sent['messages'] as Array<{ content: unknown }>
  const blocks = messages.flatMap((turn) => (Array.isArray(turn.content) ? (turn.content as Array<Record<string, unknown>>) : []))
  return [...tools, ...system, ...blocks]
    .map((block) => block['cache_control'] as Record<string, unknown> | undefined)
    .filter((mark): mark is Record<string, unknown> => Boolean(mark))
}

const HOUR = { type: 'ephemeral', ttl: '1h' }
const FIVE_MINUTES = { type: 'ephemeral' }

describe('each job’s own markers keep five minutes, the shared prompt the route’s hour (AGL-4050)', () => {
  const PLAN_SYSTEM: AiSystemBlock[] = [
    { text: 'doctrine', cacheBreakpoint: true },
    { text: 'plan rules', cacheBreakpoint: true },
    { text: 'Acme Roofing, a roofer', cacheBreakpoint: true, site: true },
    { text: 'inventory', volatile: true },
  ]
  const turns: AiMessage[] = [
    { role: 'user', content: 'brief' },
    { role: 'assistant', content: 'Called look_up_site_inventory.' },
    { role: 'user', content: 'the lookup answer' },
  ]

  it('sends the shared markers at the hour and the site’s block and the conversation at five minutes', () => {
    const sent = body('claude-sonnet-5-5', { system: PLAN_SYSTEM, messages: turns, cacheConversation: true, cacheTtl: '1h' })
    const system = sent['system'] as Array<Record<string, unknown>>
    expect(system.map((block) => block['cache_control'] ?? null)).toEqual([HOUR, HOUR, FIVE_MINUTES, null])
    expect(wireMarkers(sent)).toEqual([HOUR, HOUR, FIVE_MINUTES, FIVE_MINUTES])
  })

  it('keeps every marker at five minutes on a route that asks for no hour, as before', () => {
    const sent = body('claude-sonnet-5-5', { system: PLAN_SYSTEM, messages: turns, cacheConversation: true })
    expect(wireMarkers(sent)).toEqual([FIVE_MINUTES, FIVE_MINUTES, FIVE_MINUTES, FIVE_MINUTES])
  })

  it('changes only cache_control: the same bytes with the hour and without it', () => {
    const strip = (sent: Record<string, unknown>) =>
      JSON.stringify(sent, (key, value) => (key === 'cache_control' ? undefined : value))
    const request = { system: PLAN_SYSTEM, messages: turns, cacheConversation: true }
    expect(strip(body('claude-sonnet-5-5', { ...request, cacheTtl: '1h' }))).toBe(strip(body('claude-sonnet-5-5', request)))
  })

  it('downgrades a shared marker that would follow a five-minute one, which the API refuses', () => {
    // The runtime refuses this order before an adapter sees it (a site's
    // block closes the cached span); the adapter holds the rule on its own.
    const system: AiSystemBlock[] = [
      { text: 'doctrine', cacheBreakpoint: true },
      { text: 'Acme Roofing', cacheBreakpoint: true, site: true },
      { text: 'rules after the site', cacheBreakpoint: true },
    ]
    const sent = body('claude-sonnet-5-5', { system, cacheTtl: '1h' })
    expect(wireMarkers(sent)).toEqual([HOUR, FIVE_MINUTES, FIVE_MINUTES])
  })

  it('never sends an hour-long marker after a five-minute one, for any order of markers', () => {
    const kinds: Array<AiSystemBlock | null> = [
      null,
      { text: 'shared', cacheBreakpoint: true },
      { text: 'site', cacheBreakpoint: true, site: true },
      { text: 'plain' },
    ]
    let checked = 0
    for (const a of kinds) for (const b of kinds) for (const c of kinds) {
      const system = [a, b, c].filter((block): block is AiSystemBlock => block !== null)
      for (const cacheConversation of [false, true]) {
        for (const cacheTtl of [undefined, '1h'] as const) {
          const request = { system, messages: turns, cacheConversation, ...(cacheTtl ? { cacheTtl } : {}) }
          const marks = wireMarkers(body('claude-sonnet-5-5', request)).map((mark) => (mark['ttl'] === '1h' ? '1h' : '5m'))
          const firstShort = marks.indexOf('5m')
          expect([request, firstShort < 0 ? [] : marks.slice(firstShort).filter((ttl) => ttl === '1h')]).toEqual([request, []])
          // Every shared marker ahead of the first job marker keeps the route's lifetime.
          const ttls = aiCacheMarkerTtls(request)
          const firstJob = system.findIndex((block) => block.site && block.cacheBreakpoint)
          system.forEach((block, index) => {
            if (block.cacheBreakpoint && !block.site && (firstJob < 0 || index < firstJob)) {
              expect([request, index, ttls.system[index]]).toEqual([request, index, cacheTtl ?? '5m'])
            }
          })
          checked += 1
        }
      }
    }
    expect(checked).toBe(4 * 4 * 4 * 2 * 2)
  })
})

describe('an hour-long cache write is priced at twice the input (AGL-3830)', () => {
  const model = 'claude-sonnet-5-5'
  const usage = {
    input_tokens: 600,
    output_tokens: 900,
    cache_read_input_tokens: 2_000,
    cache_creation_input_tokens: 3_000,
    cache_creation: { ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 2_000 },
  }

  it('reads the hour-long share of the writes, inside the total, and nothing where there is none', () => {
    expect(anthropicUsageFrom(usage)).toEqual({
      inputTokens: 600,
      outputTokens: 900,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 3_000,
      cacheWriteHourTokens: 2_000,
    })
    const fiveMinutes = { ...usage, cache_creation: { ephemeral_5m_input_tokens: 3_000, ephemeral_1h_input_tokens: 0 } }
    expect(anthropicUsageFrom(fiveMinutes)).not.toHaveProperty('cacheWriteHourTokens')
    expect(anthropicUsageFrom({ input_tokens: 1 })).not.toHaveProperty('cacheWriteHourTokens')
  })

  it('bills each hour-long token the difference between 2x and the table’s 1.25x input', () => {
    for (const rates of [aiBilledRatesForModel(model), aiProviderRatesForModel(model)]) {
      const surcharge = aiCacheWriteHourSurchargeUsd({ cacheWriteHourTokens: 1_000_000 }, rates)
      expect(surcharge).toBeCloseTo(rates.inputPerToken * 1_000_000 * (AI_CACHE_WRITE_HOUR_FACTOR - 1.25), 6)
      expect(rates.cacheWritePerToken + surcharge / 1_000_000).toBeCloseTo(rates.inputPerToken * 2, 12)
    }
    expect(aiCacheWriteHourSurchargeUsd({}, aiBilledRatesForModel(model))).toBe(0)
  })

  it('draws the surcharge on the answer it came with', () => {
    const answer = anthropicResultFrom({ content: [], stop_reason: 'end_turn', usage }, model)
    const fiveMinute = estimateAiBilledUsd(anthropicUsageFrom(usage), model)
    expect(answer.estCostUsd).toBeCloseTo(
      fiveMinute + aiCacheWriteHourSurchargeUsd({ cacheWriteHourTokens: 2_000 }, aiBilledRatesForModel(model)),
      6,
    )
    expect(answer.estCostUsd).toBeGreaterThan(fiveMinute)
  })

  it('adds two exchanges’ hour-long writes, and leaves the field out where neither had one', () => {
    expect(aiCacheWriteHourSum({ cacheWriteHourTokens: 5 }, {})).toEqual({ cacheWriteHourTokens: 5 })
    expect(aiCacheWriteHourSum({ cacheWriteHourTokens: 5 }, { cacheWriteHourTokens: 7 })).toEqual({ cacheWriteHourTokens: 12 })
    expect(aiCacheWriteHourSum({}, {})).toEqual({})
  })
})

describe('a request that caches its conversation (AGL-3809)', () => {
  const turns = [
    { role: 'user', content: 'brief' },
    { role: 'assistant', content: 'Called look_up_site_inventory.' },
    { role: 'user', content: 'the lookup answer' },
  ]

  it('sends turns as strings and marks none of them unless asked', () => {
    const sent = body('claude-sonnet-5-5', { messages: turns })['messages'] as Array<Record<string, unknown>>
    expect(sent.map((turn) => turn['content'])).toEqual(['brief', 'Called look_up_site_inventory.', 'the lookup answer'])
  })

  it('marks the last block of the last turn alone, at five minutes while the system keeps the hour (AGL-4050)', () => {
    const sent = body('claude-sonnet-5-5', { messages: turns, cacheConversation: true, cacheTtl: '1h' })
    const messages = sent['messages'] as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages.map((turn) => turn.content.map((block) => block['cache_control'] ?? null))).toEqual([
      [null],
      [null],
      [{ type: 'ephemeral' }],
    ])
    expect((sent['system'] as Array<Record<string, unknown>>)[0]['cache_control']).toEqual({ type: 'ephemeral', ttl: '1h' })
  })

  it('renders a turn the same bytes on the call that marked it and on the next, where it is no longer last', () => {
    const strip = (turn: { content: Array<Record<string, unknown>> }) =>
      JSON.stringify(turn.content, (key, value) => (key === 'cache_control' ? undefined : value))
    const first = body('claude-sonnet-5-5', { messages: turns.slice(0, 1), cacheConversation: true })
    const next = body('claude-sonnet-5-5', { messages: turns, cacheConversation: true })
    const firstTurns = first['messages'] as Array<{ content: Array<Record<string, unknown>> }>
    const nextTurns = next['messages'] as Array<{ content: Array<Record<string, unknown>> }>
    expect(strip(nextTurns[0])).toBe(strip(firstTurns[0]))
    expect(JSON.stringify(next['system'])).toBe(JSON.stringify(first['system']))
    expect(JSON.stringify(next['tools'])).toBe(JSON.stringify(first['tools']))
  })

  it('counts the conversation’s breakpoint against the four the API allows', () => {
    const system = [1, 2, 3, 4].map((n) => ({ text: `rules ${n}`, cacheBreakpoint: true }))
    expect(() => body('claude-sonnet-5-5', { system, cacheConversation: true })).toThrow(/5 cache breakpoints/)
    expect(() => body('claude-sonnet-5-5', { system: system.slice(1), cacheConversation: true })).not.toThrow()
  })
})

describe('an answer read off the wire or out of a batch', () => {
  const answer = {
    content: [{ type: 'tool_use', name: 'submit', input: { a: 'x' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }

  it('reads the tool call and the usage', () => {
    const result = anthropicResultFrom(answer, 'claude-sonnet-5')
    expect(result.kind).toBe('completion')
    expect(result.kind === 'completion' && result.toolUse).toEqual([{ name: 'submit', input: { a: 'x' } }])
    expect(result.usage.outputTokens).toBe(1000)
  })

  it("prices a batch's answer at half", () => {
    const full = anthropicResultFrom(answer, 'claude-sonnet-5').estCostUsd
    expect(anthropicResultFrom(answer, 'claude-sonnet-5', 0.5).estCostUsd).toBeCloseTo(full / 2, 6)
  })
})

describe('a request that names the tool it is for (AGL-4076)', () => {
  const OTHER: AiTool = { ...TOOL, name: 'read' }
  const named = (model: string, extra: Record<string, unknown> = {}) =>
    body(model, { tools: [OTHER, TOOL], toolChoice: 'submit', thinking: 'off', ...extra })

  it('is forced on a model that takes a forced choice, with thinking sent off', () => {
    for (const model of ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-4-6']) {
      const sent = named(model)
      expect([model, sent['tool_choice'], sent['thinking']]).toEqual([model, { type: 'tool', name: 'submit' }, { type: 'disabled' }])
    }
  })

  it('stays automatic on Claude Sonnet 5.5 and Claude Opus 5.5, which refuse a forced choice', () => {
    for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']) {
      expect([model, named(model)['tool_choice']]).toEqual([model, { type: 'auto' }])
    }
  })

  it('stays automatic where the request thinks, which a forced choice cannot', () => {
    expect(named('claude-opus-5', { thinking: 'adaptive' })['tool_choice']).toEqual({ type: 'auto' })
    expect(named('claude-opus-5', { thinking: undefined })['tool_choice']).toEqual({ type: 'auto' })
  })

  it('stays automatic for a name the request sends no tool for', () => {
    expect(named('claude-opus-5', { toolChoice: 'missing' })['tool_choice']).toEqual({ type: 'auto' })
  })

  it('sends the same tools whichever it names, so the prefix the provider caches is the same bytes', () => {
    const read = named('claude-sonnet-5-5', { toolChoice: 'read' })
    const answer = named('claude-sonnet-5-5', { toolChoice: 'submit' })
    expect(JSON.stringify([read['tools'], read['system']])).toBe(JSON.stringify([answer['tools'], answer['system']]))
  })
})
