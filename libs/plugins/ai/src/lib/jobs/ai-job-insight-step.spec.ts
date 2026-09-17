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

const mockRunAiRequest = jest.fn()
const mockReleased = jest.fn(async (ids: string[]) => ids)

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: (ids: string[]) => mockReleased(ids),
}))

import {
  registerPluginFigureReader,
  type PluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_INSIGHTS_COLLECTION, type AiInsightRecord } from '../model/ai-insight'
import { AI_INSIGHT_ANSWER_TOOL_NAME, AI_INSIGHT_READ_TOOL_NAME } from '../tools/ai-insight-tool'
import {
  AI_INSIGHT_NO_READERS_COPY,
  AI_JOB_INSIGHT_SYSTEM,
  aiInsightAdmissionRefusal,
  runAiJobInsightStep,
} from './ai-job-insight-step'

/**
 * The insight step (AGL-2915), end to end against a stubbed provider: the
 * model chooses among the readers this job may read and never names anything
 * else, the tables are read through the owners' readers, an insight whose
 * numbers are not in the rows it cites is left out, and the answer is written
 * apart from the job with no figure on the job's own output.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')
const MODEL = 'claude-sonnet-5'
const PRO: Record<string, unknown> = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['commerce', 'forms'] }

const usage = (output: number) => ({ inputTokens: 1_000, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 })
const called = (name: string, input: unknown, output = 100) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name, input }],
  usage: usage(output),
  estCostUsd: 0.01,
  stopReason: 'tool_use',
})

interface Written {
  path: string
  value: Record<string, unknown>
}

function firestoreOf(docs: Record<string, Record<string, unknown>>, writes: Written[]) {
  const doc = (path: string): any => ({
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    set: async (value: Record<string, unknown>) => {
      writes.push({ path, value })
    },
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
  })
  return { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) } as unknown as FirebaseFirestore.Firestore
}

const traffic: PluginFigureReader = {
  id: 'traffic.summary',
  label: 'Traffic',
  description: 'Page views over the window.',
  scope: 'site',
  windows: [7, 14, 30, 90],
  plugin: null,
  read: async ({ days }) => ({
    ok: true,
    table: {
      title: 'Traffic',
      source: { label: 'Analytics', path: 'analytics' },
      period: { from: '2026-09-03', to: '2026-09-16', days },
      columns: [
        { key: 'figure', label: 'Figure', kind: 'text' },
        { key: 'current', label: 'This window', kind: 'count' },
        { key: 'change', label: 'Change', kind: 'change' },
      ],
      rows: [{ figure: 'Page views', current: 1_204, change: 14.7 }],
      omitted: 0,
      notes: [],
    },
  }),
}

const sales: PluginFigureReader = {
  id: 'commerce.sales',
  label: 'Sales',
  description: 'Revenue and orders.',
  scope: 'site',
  windows: [7, 14, 30, 90],
  feature: 'commerceAnalytics',
  read: jest.fn(async () => ({ ok: false as const, status: 400 as const, error: 'unused' })),
}

const job = (patch: Partial<AiJob> = {}): AiJob =>
  ({
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'insight',
    status: 'running',
    brief: 'Did our traffic go up?',
    inputs: { surface: 'analytics', days: 14 },
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    ...patch,
  }) as AiJob

const hostDocs = { 'hosts/host-1': { orgId: 'org-1', subdomain: 'acme' } }

async function run(patch: Partial<AiJob> = {}, org: Record<string, unknown> = PRO) {
  const writes: Written[] = []
  const outcome = await runAiJobInsightStep({
    job: job(patch),
    stepIndex: 0,
    now: NOW,
    firestore: firestoreOf(hostDocs, writes),
    org,
    modelFor: () => MODEL,
  })
  return { outcome, writes }
}

beforeAll(() => {
  // The step logs what it left out and what an owner refused; neither is under test.
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterAll(() => jest.restoreAllMocks())

beforeEach(() => {
  resetPluginServicesForTests()
  registerPluginFigureReader(traffic, { pluginId: 'ai' })
  registerPluginFigureReader(sales, { pluginId: 'commerce' })
  mockRunAiRequest.mockReset()
  mockReleased.mockClear()
})

describe('asking', () => {
  it('lets the model choose among the readers offered, reads them, and keeps only what traces', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(
        called(AI_INSIGHT_READ_TOOL_NAME, {
          reads: [
            { reader: 'traffic.summary', days: 14, params: [] },
            // Never offered: not a reader of this plugin set, so never read.
            { reader: 'crm.contacts', days: 14, params: [] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        called(
          AI_INSIGHT_ANSWER_TOOL_NAME,
          {
            insights: [
              { text: 'Page views rose 14.7% to 1,204.', cites: [{ table: 't1', rows: [0] }] },
              { text: 'Page views rose by 154.', cites: [{ table: 't1', rows: [0] }] },
            ],
            gap: 'These figures do not say where visitors came from.',
          },
          300,
        ),
      )
    const { outcome, writes } = await run()

    // The read call offers what this workspace may read here, and no more:
    // Pro carries `commerceAnalytics`, and both plugins are on.
    const readRequest = mockRunAiRequest.mock.calls[0][0]
    expect(readRequest.tools.map((tool: { name: string }) => tool.name)).toEqual([AI_INSIGHT_READ_TOOL_NAME])
    expect(readRequest.messages[0].content).toContain('- commerce.sales — Sales')
    expect(readRequest.messages[0].content).toContain('- traffic.summary — Traffic')
    expect(readRequest.system).toEqual(AI_JOB_INSIGHT_SYSTEM)
    // The answer call carries the table the reader returned, cited by handle.
    const answerRequest = mockRunAiRequest.mock.calls[1][0]
    expect(answerRequest.messages[0].content).toContain('t1 · Traffic (Analytics)')
    expect(answerRequest.messages[0].content).toContain('0: Page views | 1,204 | +14.7%')

    const record = writes.find((write) => write.path === `orgs/org-1/${AI_INSIGHTS_COLLECTION}/job-1`)?.value as unknown as
      | (AiInsightRecord & { expiresAt: unknown })
      | undefined
    expect(record?.insights.map((insight) => insight.text)).toEqual(['Page views rose 14.7% to 1,204.'])
    expect(record?.left).toBe(1)
    expect(record?.gap).toBe('These figures do not say where visitors came from.')
    expect(record?.expiresAt).toBe(NOW)

    // The job's own output names the answer and holds no figure.
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'insight', id: 'job-1', hostSubdomain: 'acme' }),
    ])
    expect(outcome.outputs[0]).not.toHaveProperty('proposal')
    expect(JSON.stringify(outcome.outputs)).not.toContain('1,204')
    expect(outcome.usage).toEqual({ inputTokens: 2_000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(outcome.failure).toBeUndefined()
  })

  it('asks once more when nothing traces, and keeps what the second answer traces', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(called(AI_INSIGHT_READ_TOOL_NAME, { reads: [{ reader: 'traffic.summary', days: 14, params: [] }] }))
      .mockResolvedValueOnce(
        called(AI_INSIGHT_ANSWER_TOOL_NAME, { insights: [{ text: 'Traffic doubled to 2,408.', cites: [{ table: 't1', rows: [0] }] }], gap: null }),
      )
      .mockResolvedValueOnce(
        called(AI_INSIGHT_ANSWER_TOOL_NAME, { insights: [{ text: 'Page views rose 14.7%.', cites: [{ table: 't1', rows: [0] }] }], gap: null }),
      )
    const { writes } = await run()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(3)
    expect(mockRunAiRequest.mock.calls[2][0].messages.at(-1).content).toContain('insight-number-untraced:2,408')
    const record = writes[0].value as unknown as AiInsightRecord
    expect(record.insights.map((insight) => insight.text)).toEqual(['Page views rose 14.7%.'])
  })

  it('reads the surface’s defaults when the model names no reader it may read', async () => {
    mockRunAiRequest
      .mockResolvedValueOnce(called(AI_INSIGHT_READ_TOOL_NAME, { reads: [{ reader: 'orders.raw', days: 14, params: [] }] }))
      .mockResolvedValueOnce(called(AI_INSIGHT_ANSWER_TOOL_NAME, { insights: [], gap: 'The figures do not cover orders.' }))
    const { outcome, writes } = await run()
    expect(mockRunAiRequest.mock.calls[1][0].messages[0].content).toContain('t1 · Traffic')
    expect((writes[0].value as unknown as AiInsightRecord).insights).toEqual([])
    expect(outcome.outputs[0].note).toBe('The figures did not answer this question.')
  })

  it('offers no reader the plan does not sell, and stops before any call when there is none', async () => {
    resetPluginServicesForTests()
    registerPluginFigureReader(sales, { pluginId: 'commerce' })
    const { outcome } = await run({}, { plan: 'free', enabledPlugins: ['commerce'] })
    expect(outcome.failure).toBe(AI_INSIGHT_NO_READERS_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('passes a decline on as a refusal, with what it spent', async () => {
    mockRunAiRequest.mockResolvedValueOnce({ kind: 'refusal', text: '', usage: usage(5), estCostUsd: 0.001, stopReason: 'refusal' })
    const { outcome, writes } = await run()
    expect(outcome.refused).toBe(true)
    expect(outcome.usage.outputTokens).toBe(5)
    expect(writes).toEqual([])
  })

  it('refuses a site of another workspace before anything is read', async () => {
    const writes: Written[] = []
    const outcome = await runAiJobInsightStep({
      job: job({ hostId: 'host-9' }),
      stepIndex: 0,
      now: NOW,
      firestore: firestoreOf({ 'hosts/host-9': { orgId: 'org-2' } }, writes),
      org: PRO,
      modelFor: () => MODEL,
    })
    expect(outcome.failure).toMatch(/Open the site/)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('the weekly digest', () => {
  it('makes no read call: code reads the digest’s readers', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      called(AI_INSIGHT_ANSWER_TOOL_NAME, { insights: [{ text: 'Page views rose 14.7%.', cites: [{ table: 't1', rows: [0] }] }], gap: null }),
    )
    const { writes } = await run({ inputs: { surface: 'digest', week: '2026-W38' }, brief: 'Weekly insights for Acme' })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(mockRunAiRequest.mock.calls[0][0].tools[0].name).toBe(AI_INSIGHT_ANSWER_TOOL_NAME)
    const record = writes[0].value as unknown as AiInsightRecord
    expect(record).toMatchObject({ surface: 'digest', week: '2026-W38', days: 7, question: 'Weekly insights for Acme' })
  })
})

describe('admission', () => {
  const context = (inputs: Record<string, unknown>, hostId: string | null = 'host-1') => ({
    firestore: firestoreOf(hostDocs, []),
    orgId: 'org-1',
    hostId,
    inputs,
    org: PRO,
    uid: 'uid-1',
  })

  it('admits a question from a page that reports figures, on a site of the workspace', async () => {
    expect(await aiInsightAdmissionRefusal(context({ surface: 'analytics', days: 14 }))).toBeNull()
  })

  it('refuses a digest at the door, a site-less analytics question and an unknown site', async () => {
    expect(await aiInsightAdmissionRefusal(context({ surface: 'digest' }))).toMatchObject({ status: 400 })
    expect(await aiInsightAdmissionRefusal(context({ surface: 'analytics' }, null))).toMatchObject({ status: 400 })
    expect(await aiInsightAdmissionRefusal(context({ surface: 'analytics' }, 'host-404'))).toMatchObject({ status: 404 })
  })

  it('refuses a surface with nothing to read', async () => {
    expect(await aiInsightAdmissionRefusal(context({ surface: 'datasets' }))).toMatchObject({
      status: 403,
      error: AI_INSIGHT_NO_READERS_COPY,
    })
  })
})
