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

/**
 * THE INSIGHT STEP'S ANSWER CALL READS THE CACHE, LIVE (AGL-4076).
 *
 * Before AGL-4076, the step's read call sent the read tool alone and its
 * answer call sent the answer tool alone. The provider's cached prefix opens
 * with the tools, so the answer call read none of the system block the read
 * call had just written. Both calls now send both tools. The ledger spec can
 * check that the bytes match (`runtime/ai-prompt-cache.spec.ts`), but not
 * that the provider reads them, so this spec drives the real step: the real
 * routing, prompt, provider, read call and answer call. The figures come from
 * one recorded set, the `insight-roof-traffic-change` eval case's tables,
 * read through the step's own figure-reader seam, so no workspace is read. It
 * passes only when the answer call reads more than 0 tokens from the cache.
 * It prints the run ledger (`liveProviderUsd`) and each call's
 * `cache_read_input_tokens`.
 *
 * It calls the provider and costs real money, about $0.02 at list rates for
 * one read call and one answer call (a re-ask adds about a cent), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, under the
 * live launcher's mark so `jest.setup.js` keeps the key read from `.env`.
 * Both calls must go to the provider unbatched and live, because a replayed
 * or batched read call warms no cache for the answer call:
 *
 *   AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     AGLYN_LIVE_AI_BATCH=0 AGLYN_AI_REPLAY=refresh AGLYN_LIVE_AI_CAP_USD=0.10 \
 *     npx jest -c libs/plugins/ai/jest.config.ts --runInBand libs/plugins/ai/src/lib/jobs/ai-job-insight-cache-live.spec.ts
 *
 * THE CAP: `AGLYN_LIVE_AI_CAP_USD` (default 0.10) is the most the round may
 * spend at the provider's list rates, and `AGLYN_LIVE_AI_SPENT_USD` is what
 * the round's earlier runs already spent (their `run.liveProviderUsd`). No
 * request is sent once the two together come within
 * {@link IN_FLIGHT_MARGIN_USD} of the cap. That margin is about this spec's
 * whole spend, so a $0.10 cap still sends.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: string[]) => ids,
}))

/** Every model call: the tool it named, the tools it sent, what it used, and whether it reached the provider. */
const mockCalls: Array<{
  toolChoice: string | null
  tools: string[]
  prefix: string
  model: string
  stopReason: string | null
  usage: Record<string, number>
  live: boolean
}> = []
jest.mock('../runtime/ai-runtime', () => {
  const actual = jest.requireActual('../runtime/ai-runtime')
  const { aiLiveRunLedger: ledger } = jest.requireActual('../runtime/ai-dev-replay')
  return {
    __esModule: true,
    ...actual,
    runAiRequest: async (input: {
      model: string
      toolChoice?: string
      tools?: Array<{ name: string }>
      system: Array<{ text: string }>
    }) => {
      mockSpendGuard()
      const before = ledger().live
      const result = await actual.runAiRequest(input)
      mockCalls.push({
        toolChoice: input.toolChoice ?? null,
        tools: (input.tools ?? []).map((tool) => tool.name),
        prefix: JSON.stringify([input.tools ?? [], input.system.map((block) => block.text)]),
        model: input.model,
        stopReason: result.stopReason ?? null,
        usage: result.usage,
        live: ledger().live > before,
      })
      return result
    },
  }
})

import {
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureTable,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { AiJob } from '../model/ai-jobs.types'
import { aiDevReplayMode, aiLiveBatchWanted, aiLiveTimeoutMs } from '../runtime/ai-dev-env'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { AI_INSIGHT_ANSWER_TOOL_NAME, AI_INSIGHT_READ_TOOL_NAME } from '../tools/ai-insight-tool'
import { runAiJobInsightStep } from './ai-job-insight-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date('2026-09-16T15:00:00.000Z')

/** The most the round may spend, at the provider's list rates. */
const CAP_USD = Number(process.env['AGLYN_LIVE_AI_CAP_USD'] || '0.1')
/** What the round's earlier runs already spent. */
const SPENT_USD = Number(process.env['AGLYN_LIVE_AI_SPENT_USD'] || '0')
/** Room under the cap for the requests already asked when the guard closes: about this spec's whole spend. */
const IN_FLIGHT_MARGIN_USD = 0.02

/** No request is sent once what the round spent comes within the margin of its cap. */
function mockSpendGuard(): void {
  const spent = SPENT_USD + aiLiveRunLedger().liveProviderUsd
  if (spent + IN_FLIGHT_MARGIN_USD > CAP_USD) {
    throw new Error(`the round's cap: $${spent.toFixed(4)} spent of $${CAP_USD.toFixed(2)}, so no further request is sent`)
  }
}

/** The recorded figure set: the roof traffic case's two tables, each with the reader that returned it. */
const CASE = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../tools/ai-eval/cases/insight/roof-traffic-change.json'), 'utf8'),
) as { brief: string; tables: Array<PluginFigureTable & { reader: string }> }

/** A reader that answers with its recorded table, whatever window it is asked for. */
function recordedReader(id: string, label: string, description: string): PluginFigureReader {
  const recorded = CASE.tables.find((table) => table.reader === id)
  if (!recorded) throw new Error(`the recorded case has no ${id} table`)
  const table: PluginFigureTable = {
    title: recorded.title,
    source: recorded.source,
    period: recorded.period,
    columns: recorded.columns,
    rows: recorded.rows,
    omitted: recorded.omitted,
    notes: recorded.notes,
  }
  return {
    id,
    label,
    description,
    scope: 'site',
    windows: [7, 14, 30, 90],
    plugin: null,
    read: async () => ({ ok: true, table }),
  }
}

/** The documents the step reads (the site, its business profile and memory) and the answer it writes. */
function firestoreOf(docs: Record<string, Record<string, unknown>>) {
  const doc = (path: string): unknown => ({
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    set: async () => undefined,
    collection: (name: string) => ({
      doc: (id: string) => doc(`${path}/${name}/${id}`),
      limit: () => ({ get: async () => ({ docs: [] }) }),
    }),
  })
  return { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) } as unknown as FirebaseFirestore.Firestore
}

const job: AiJob = {
  $id: 'job-insight-cache',
  orgId: 'org-insight-cache',
  hostId: 'host-insight-cache',
  kind: 'insight',
  status: 'running',
  brief: CASE.brief,
  inputs: { surface: 'analytics', days: 14 },
  steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
  outputs: [],
  creditsReserved: 0,
  creditsSpent: 0,
  createdBy: 'uid-insight-cache',
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: NOW,
} as unknown as AiJob

const describeLive = LIVE ? describe : describe.skip

describeLive('the insight step’s answer call reads the cache, by the real model (AGL-4076)', () => {
  jest.setTimeout(aiLiveTimeoutMs(3 * 60_000))

  // The run's ledger prints however the run ended: a run that threw still spent what the ledger counts.
  afterAll(() => {
    console.log(`run: ${JSON.stringify({ ...aiLiveRunLedger(), spentBefore: SPENT_USD, capUsd: CAP_USD })}`)
  })

  beforeAll(() => {
    resetPluginServicesForTests()
    registerPluginFigureReader(recordedReader('traffic.summary', 'Traffic', 'Page views and visitors over the window, against the window before.'), {
      pluginId: 'ai',
    })
    registerPluginFigureReader(recordedReader('traffic.pages', 'Top pages', 'The pages viewed most over the window, with their change.'), {
      pluginId: 'ai',
    })
  })

  it('reads the prefix the read call wrote: the answer call’s cache_read_input_tokens is above 0', async () => {
    // A batched or replayed read call warms no cache for the answer call to read, and a
    // run outside the launcher's replay layer counts no spend, so the cap could not hold.
    expect({ batched: aiLiveBatchWanted(), ledger: aiDevReplayMode() !== 'off' }).toEqual({ batched: false, ledger: true })
    const outcome = await runAiJobInsightStep({
      job,
      stepIndex: 0,
      now: NOW,
      firestore: firestoreOf({ [`hosts/${job.hostId}`]: { orgId: job.orgId, subdomain: 'roof-insight-cache' } }),
      org: { plan: 'pro', billingStatus: 'active', enabledPlugins: [] },
    })
    const calls = mockCalls.map((call, index) => ({
      call: index + 1,
      toolChoice: call.toolChoice,
      model: call.model,
      live: call.live,
      stopReason: call.stopReason,
      cache_read_input_tokens: call.usage['cacheReadTokens'] ?? 0,
      cache_creation_input_tokens: call.usage['cacheWriteTokens'] ?? 0,
      input_tokens: call.usage['inputTokens'] ?? 0,
      output_tokens: call.usage['outputTokens'] ?? 0,
    }))
    console.log(JSON.stringify({ run: aiLiveRunLedger(), calls, failure: outcome.failure ?? null }, null, 1))

    const [read, ...answers] = mockCalls
    expect(read?.toolChoice).toBe(AI_INSIGHT_READ_TOOL_NAME)
    expect(answers.length).toBeGreaterThan(0)
    expect(answers.every((call) => call.toolChoice === AI_INSIGHT_ANSWER_TOOL_NAME)).toBe(true)
    // Every call reached the provider in this run, so the cache it reads is the one the read call wrote now.
    expect(mockCalls.map((call) => call.live)).toEqual(mockCalls.map(() => true))
    // One prefix: the same tools in the same order and the same system blocks on every call.
    expect(new Set(mockCalls.map((call) => call.prefix)).size).toBe(1)
    expect(read?.tools).toEqual([AI_INSIGHT_READ_TOOL_NAME, AI_INSIGHT_ANSWER_TOOL_NAME])
    // The fix: the answer call reads the cache.
    expect(answers[0]?.usage['cacheReadTokens'] ?? 0).toBeGreaterThan(0)
    // And the step still answers.
    expect(outcome.failure ?? null).toBeNull()
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
