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

import { aiDefaultModelFor, aiCatalogEntry } from './catalog'
import { anthropicResultFrom, buildAnthropicRequestBody } from './anthropic'
import type { AiTool } from './contract'

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

  it('never forces a tool on any model', () => {
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

  it('asks for the hour on every breakpoint when the request does', () => {
    const system = body('claude-sonnet-5', { cacheTtl: '1h' })['system'] as Array<Record<string, unknown>>
    expect(system[0]['cache_control']).toEqual({ type: 'ephemeral', ttl: '1h' })
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

  it('marks the last block of the last turn alone, at the system breakpoints’ lifetime', () => {
    const sent = body('claude-sonnet-5-5', { messages: turns, cacheConversation: true, cacheTtl: '1h' })['messages'] as Array<{
      content: Array<Record<string, unknown>>
    }>
    expect(sent.map((turn) => turn.content.map((block) => block['cache_control'] ?? null))).toEqual([
      [null],
      [null],
      [{ type: 'ephemeral', ttl: '1h' }],
    ])
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
