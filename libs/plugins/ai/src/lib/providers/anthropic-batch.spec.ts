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

import { anthropicProvider } from './anthropic'
import { AiBatchUnfinishedError, AiUpstreamError, type AiProviderRequest, type AiResult } from './contract'

/**
 * The batch wait (AGL-3781): a batch still processing when its wait runs out
 * is canceled and then READ, so the answers it already has come back and only
 * the requests it never reached come back unanswered. Canceling and throwing
 * away the whole batch cost a golden run every grade in it.
 */

const request = (content: string): AiProviderRequest => ({
  apiKey: 'test-key',
  model: 'claude-sonnet-5-5',
  system: [{ text: 'rules', cacheBreakpoint: true }],
  messages: [{ role: 'user', content }],
  maxTokens: 50,
})

const message = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 20 },
})

const textOf = (result: AiResult | Error | undefined) => (result as { text?: string } | undefined)?.text

interface Call {
  url: string
  method: string
}

/** The batch endpoints, answering polls with `statuses` in turn and the results file with `results`. */
function mockBatchApi(statuses: string[], results: Array<Record<string, unknown>> | null): Call[] {
  const calls: Call[] = []
  // The jsdom environment has no `Response`; the adapter reads only these.
  const reply = (text: string) =>
    ({ ok: true, status: 200, headers: new Map(), json: async () => JSON.parse(text), text: async () => text }) as unknown as Response
  const json = (body: unknown) => reply(JSON.stringify(body))
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.endsWith('/v1/messages/batches') && init?.method === 'POST') {
      return json({ id: 'msgbatch_1', processing_status: 'in_progress' })
    }
    if (url.endsWith('/cancel')) return json({ id: 'msgbatch_1', processing_status: 'canceling' })
    if (url.endsWith('/results/msgbatch_1')) {
      return reply((results ?? []).map((line) => JSON.stringify(line)).join('\n'))
    }
    if (url.endsWith('/msgbatch_1')) {
      const status = statuses.shift() ?? 'ended'
      return json({
        id: 'msgbatch_1',
        processing_status: status,
        results_url: status === 'ended' && results ? 'https://api.anthropic.com/results/msgbatch_1' : null,
      })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  return calls
}

describe('the Anthropic batch wait', () => {
  const realFetch = global.fetch
  const completeBatch = anthropicProvider.completeBatch as NonNullable<typeof anthropicProvider.completeBatch>
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  it('reads a batch that ended in time, in request order, and cancels nothing', async () => {
    const calls = mockBatchApi(
      ['ended'],
      [
        { custom_id: 'r1', result: { type: 'succeeded', message: message('second') } },
        { custom_id: 'r0', result: { type: 'succeeded', message: message('first') } },
      ],
    )
    const results = await completeBatch([request('a'), request('b')], { pollMs: 0, timeoutMs: 60_000 })
    expect(results.map(textOf)).toEqual(['first', 'second'])
    expect(calls.some((call) => call.url.endsWith('/cancel'))).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('cancels a batch past its wait, keeps what it answered, and hands back the rest unanswered', async () => {
    const calls = mockBatchApi(
      ['in_progress', 'canceling', 'ended'],
      [
        { custom_id: 'r0', result: { type: 'succeeded', message: message('answered before the cancel') } },
        { custom_id: 'r1', result: { type: 'canceled' } },
        { custom_id: 'r2', result: { type: 'expired' } },
        // r3 is missing from the results altogether.
      ],
    )
    const results = await completeBatch([request('a'), request('b'), request('c'), request('d')], {
      pollMs: 0,
      timeoutMs: 0,
      cancelGraceMs: 60_000,
    })
    expect(textOf(results[0])).toBe('answered before the cancel')
    for (const [index, reason] of [
      [1, 'canceled'],
      [2, 'expired'],
      [3, 'missing'],
    ] as const) {
      expect(results[index]).toBeInstanceOf(AiBatchUnfinishedError)
      expect((results[index] as AiBatchUnfinishedError).reason).toBe(reason)
    }
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1)
    expect(calls.at(-1)?.url).toMatch(/results\/msgbatch_1$/)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('hands every request back unanswered when the cancel never ends', async () => {
    mockBatchApi(Array(50).fill('canceling'), null)
    const results = await completeBatch([request('a'), request('b')], {
      pollMs: 0,
      timeoutMs: 0,
      cancelGraceMs: 0,
    })
    expect(results).toHaveLength(2)
    for (const result of results) expect(result).toBeInstanceOf(AiBatchUnfinishedError)
  })

  it('still fails a request the batch answered with an error, as that request’s own failure', async () => {
    mockBatchApi(['ended'], [{ custom_id: 'r0', result: { type: 'errored', error: { type: 'overloaded_error' } } }])
    const [result] = await completeBatch([request('a')], { pollMs: 0, timeoutMs: 60_000 })
    expect(result).toBeInstanceOf(AiUpstreamError)
    expect(result).not.toBeInstanceOf(AiBatchUnfinishedError)
  })
})
