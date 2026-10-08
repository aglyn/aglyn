/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiProvider, AiProviderRequest, AiResult } from '../providers/contract'
import { aiDevCacheTtl, aiDevReplayMode, aiIsDeployedRuntime, aiLiveBatchWanted } from './ai-dev-env'
import {
  aiCachedPrefixKey,
  aiCanonicalJson,
  aiDevReplayKey,
  aiDevReplayStats,
  aiDevWarmPrefixFirst,
  resetAiDevReplayStats,
  resetAiDevWarmPrefixes,
} from './ai-dev-replay'
import { aiLiveBatchStats, resetAiLiveBatchStats } from './ai-live-batch'
import { runAiRequest } from './ai-runtime'

const LAUNCHER = { AI_EVAL_LIVE_LAUNCHER: 'tools/ai-eval/record-live.mjs' }

describe('which development layers a process runs', () => {
  it('runs none in a deployed server, whatever it was told', () => {
    for (const deployed of [
      { NODE_ENV: 'production' },
      { VERCEL_ENV: 'production' },
      { VERCEL_ENV: 'preview' },
      { K_SERVICE: 'console' },
    ]) {
      const env = { ...deployed, ...LAUNCHER, AGLYN_AI_REPLAY: '1', AGLYN_AI_CACHE_TTL: '1h', AGLYN_LIVE_AI_BATCH: '1' }
      expect(aiIsDeployedRuntime(env)).toBe(true)
      expect(aiDevReplayMode(env)).toBe('off')
      expect(aiDevCacheTtl(env)).toBeUndefined()
      expect(aiLiveBatchWanted(env)).toBe(false)
    }
  })

  it('runs none in a development process that asked for none', () => {
    expect(aiDevReplayMode({ NODE_ENV: 'development' })).toBe('off')
    expect(aiDevCacheTtl({ NODE_ENV: 'development' })).toBeUndefined()
    expect(aiLiveBatchWanted({ NODE_ENV: 'development' })).toBe(false)
  })

  it('replays and asks for the hour under the live-eval launcher, and each can be turned back', () => {
    expect(aiDevReplayMode({ NODE_ENV: 'test', ...LAUNCHER })).toBe('replay')
    expect(aiDevCacheTtl({ NODE_ENV: 'test', ...LAUNCHER })).toBe('1h')
    expect(aiDevReplayMode({ ...LAUNCHER, AGLYN_AI_REPLAY: 'off' })).toBe('off')
    expect(aiDevReplayMode({ ...LAUNCHER, AGLYN_AI_REPLAY: 'refresh' })).toBe('refresh')
    expect(aiDevCacheTtl({ ...LAUNCHER, AGLYN_AI_CACHE_TTL: '5m' })).toBeUndefined()
    expect(aiDevReplayMode({ AGLYN_AI_REPLAY: '1' })).toBe('replay')
  })
})

describe('the replay key', () => {
  const request = {
    model: 'claude-sonnet-5',
    system: [{ text: 'rules', cacheBreakpoint: true as const }, { text: 'site', volatile: true as const }],
    messages: [{ role: 'user' as const, content: 'A bakery in Tulsa.' }],
    tools: [{ name: 't', description: 'd', strict: true as const, inputSchema: { type: 'object', properties: {} } }],
    maxTokens: 100,
  }

  it('is the same for the same request, whatever order its objects were built in', () => {
    expect(aiCanonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(aiCanonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
    const reordered = {
      ...request,
      tools: [{ inputSchema: { properties: {}, type: 'object' }, strict: true as const, description: 'd', name: 't' }],
    }
    expect(aiDevReplayKey('anthropic', false, reordered)).toBe(aiDevReplayKey('anthropic', false, request))
  })

  it('changes with one byte of the prompt, the model, the ceiling or the transport', () => {
    const base = aiDevReplayKey('anthropic', false, request)
    expect(aiDevReplayKey('anthropic', false, { ...request, messages: [{ role: 'user', content: 'A bakery in Tulsa!' }] })).not.toBe(base)
    expect(aiDevReplayKey('anthropic', false, { ...request, model: 'claude-sonnet-5-5' })).not.toBe(base)
    expect(aiDevReplayKey('anthropic', false, { ...request, maxTokens: 101 })).not.toBe(base)
    expect(aiDevReplayKey('anthropic', true, request)).not.toBe(base)
  })

  it('keys the cached prefix on the tools and the blocks through the last breakpoint alone', () => {
    const otherSite = { ...request, system: [request.system[0], { text: 'another site', volatile: true as const }] }
    expect(aiCachedPrefixKey(otherSite)).toBe(aiCachedPrefixKey(request))
    expect(aiCachedPrefixKey({ ...request, system: [{ text: 'rules' }] })).toBeNull()
  })
})

describe('the first request over a prefix goes alone', () => {
  beforeEach(() => resetAiDevWarmPrefixes())

  it('holds the others until it has answered, then lets them all go', async () => {
    const order: string[] = []
    let release: () => void = () => undefined
    const first = aiDevWarmPrefixFirst('p', 60_000, async () => {
      order.push('first sent')
      await new Promise<void>((resolve) => (release = resolve))
      order.push('first answered')
      return 1
    })
    const second = aiDevWarmPrefixFirst('p', 60_000, async () => {
      order.push('second sent')
      return 2
    })
    await Promise.resolve()
    expect(order).toEqual(['first sent'])
    release()
    expect(await Promise.all([first, second])).toEqual([1, 2])
    expect(order).toEqual(['first sent', 'first answered', 'second sent'])
  })

  it('holds nothing over a prefix answered within the lifetime, or with no prefix', async () => {
    await aiDevWarmPrefixFirst('p', 60_000, async () => 1)
    const sent: number[] = []
    await Promise.all([1, 2, 3].map((n) => aiDevWarmPrefixFirst('p', 60_000, async () => sent.push(n))))
    expect(sent).toEqual([1, 2, 3])
    expect(await aiDevWarmPrefixFirst(null, 60_000, async () => 'x')).toBe('x')
  })
})

describe('a request through the runtime in a development process', () => {
  const saved = { ...process.env }
  let dir: string
  let calls: AiProviderRequest[]
  let batches: number

  const answer = (text: string): AiResult => ({
    kind: 'completion',
    text,
    toolUse: [],
    usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.001,
    stopReason: 'end_turn',
  })

  const provider: AiProvider = {
    id: 'fake',
    label: 'Fake',
    apiKeyEnv: 'FAKE_KEY',
    readApiKey: () => 'key',
    endpointHost: 'fake.invalid',
    models: () => [],
    complete: async (request) => {
      calls.push(request)
      return answer(`live ${calls.length}`)
    },
    stream: async () => {
      throw new Error('not streamed here')
    },
    completeBatch: async (requests) => {
      batches += 1
      return requests.map((request) => {
        calls.push(request)
        return answer(`batched ${calls.length}`)
      })
    },
  }

  const ask = (content: string) =>
    runAiRequest({
      provider,
      model: 'claude-sonnet-5',
      system: [{ text: 'rules', cacheBreakpoint: true }],
      messages: [{ role: 'user', content }],
      maxTokens: 50,
      stream: false,
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-replay-'))
    calls = []
    batches = 0
    process.env = { ...saved, NODE_ENV: 'test', AGLYN_AI_REPLAY_DIR: dir }
    delete process.env['AI_EVAL_LIVE_LAUNCHER']
    delete process.env['AGLYN_AI_REPLAY']
    delete process.env['AGLYN_AI_CACHE_TTL']
    delete process.env['AGLYN_LIVE_AI_BATCH']
    delete process.env['VERCEL_ENV']
    delete process.env['K_SERVICE']
    resetAiDevReplayStats()
    resetAiDevWarmPrefixes()
    resetAiLiveBatchStats()
  })

  afterEach(() => {
    process.env = saved
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers an identical request from disk, and sends one whose prompt changed', async () => {
    process.env['AGLYN_AI_REPLAY'] = '1'
    expect((await ask('a bakery')).text).toBe('live 1')
    expect((await ask('a bakery')).text).toBe('live 1')
    expect((await ask('a florist')).text).toBe('live 2')
    expect(calls).toHaveLength(2)
    expect(aiDevReplayStats()).toMatchObject({ mode: 'replay', live: 2, replayed: 1 })
  })

  it('sends every request on refresh, recording over the old answer', async () => {
    process.env['AGLYN_AI_REPLAY'] = '1'
    await ask('a bakery')
    process.env['AGLYN_AI_REPLAY'] = 'refresh'
    expect((await ask('a bakery')).text).toBe('live 2')
    process.env['AGLYN_AI_REPLAY'] = '1'
    expect((await ask('a bakery')).text).toBe('live 2')
    expect(calls).toHaveLength(2)
  })

  it('reads and writes nothing when it was not asked to', async () => {
    await ask('a bakery')
    await ask('a bakery')
    expect(calls).toHaveLength(2)
    expect(calls[0].cacheTtl).toBeUndefined()
  })

  it('reads and writes nothing in a deployed server, even when asked', async () => {
    process.env['AGLYN_AI_REPLAY'] = '1'
    process.env['NODE_ENV'] = 'production'
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await ask('a bakery')
    await ask('a bakery')
    expect(calls).toHaveLength(2)
    error.mockRestore()
  })

  it('asks for the hour-long cache under the live launcher', async () => {
    process.env['AI_EVAL_LIVE_LAUNCHER'] = LAUNCHER.AI_EVAL_LIVE_LAUNCHER
    await ask('a bakery')
    expect(calls[0].cacheTtl).toBe('1h')
  })

  it('gathers the requests of a round into one batch, and a re-ask into the next', async () => {
    process.env['AGLYN_LIVE_AI_BATCH'] = '1'
    process.env['AGLYN_LIVE_AI_BATCH_WINDOW_MS'] = '5'
    const round = await Promise.all([ask('one'), ask('two'), ask('three')])
    expect(round.map((result) => result.text)).toEqual(['batched 1', 'batched 2', 'batched 3'])
    await ask('the re-ask')
    expect(batches).toBe(2)
    expect(aiLiveBatchStats()).toEqual({ batches: 2, requests: 4 })
    expect(aiDevReplayStats().live).toBe(4)
  })
})
