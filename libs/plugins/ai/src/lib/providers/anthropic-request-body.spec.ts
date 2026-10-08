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

  it('moves no tier default: the comparison models are listed, not routed to', () => {
    expect(aiDefaultModelFor('anthropic', 'balanced')).toBe('claude-sonnet-5')
    expect(aiDefaultModelFor('anthropic', 'deep')).toBe('claude-opus-5')
    expect(aiCatalogEntry('claude-sonnet-5-5')?.tier).toBe('balanced')
    expect(aiCatalogEntry('claude-opus-5-5')?.tier).toBe('deep')
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
