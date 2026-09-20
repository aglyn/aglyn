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
const mockReleased = jest.fn()

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
import { AI_EXPERIMENT_NEXT_INCONCLUSIVE } from '../model/ai-experiment'
import {
  AI_EXPERIMENT_EXPLAIN_TOOL_NAME,
  AI_EXPERIMENT_VARIANTS_TOOL_NAME,
} from '../tools/ai-experiment-tool'
import { aiJobAdmissionFor } from './ai-job-admission'
import {
  AI_EXPERIMENT_NO_READER_COPY,
  AI_EXPERIMENT_NO_SUBJECT_COPY,
  AI_EXPERIMENT_NO_TASK_COPY,
  AI_EXPERIMENT_NO_VARIANTS_COPY,
  AI_EXPERIMENT_UNREADABLE_RESULT_COPY,
  aiExperimentAdmissionRefusal,
  registerAiExperimentJob,
  runAiJobExperimentStep,
} from './ai-job-experiment-step'
import { aiJobStepRunnerFor } from './ai-jobs'

/**
 * The `experiment` step (AGL-2914), against a stubbed provider and a stubbed
 * results reader.
 *
 * What it proves: variants are proposed and never written, the copy under
 * test reaches the model and nothing else about the site does, a result's
 * verdict is reached from the figures BEFORE the model is asked anything, and
 * an answer that claims a winner the figures do not support does not reach
 * the person who asked.
 */

const NOW = new Date('2026-09-20T15:00:00.000Z')
const MODEL = 'claude-sonnet-5'
const ORG: Record<string, unknown> = {
  plan: 'business',
  billingStatus: 'active',
  enabledPlugins: ['marketing'],
}

const usage = () => ({ inputTokens: 900, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 })
const called = (name: string, input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name, input }],
  usage: usage(),
  estCostUsd: 0.01,
  stopReason: 'tool_use',
})

function firestoreOf(docs: Record<string, Record<string, unknown>>) {
  const doc = (path: string): any => ({
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
  })
  return {
    collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
  } as unknown as FirebaseFirestore.Firestore
}

const HOSTS = { 'hosts/host-1': { orgId: 'org-1', subdomain: 'acme' } }

/** The arms one test publishes; a spec sets it before a run. */
let rows: Array<Record<string, string | number | null>> = []
let readCalls = 0

const experiments: PluginFigureReader = {
  id: 'marketing.experiments',
  label: 'A/B tests',
  description: 'Every running or finished A/B test on the site.',
  scope: 'site',
  windows: [],
  feature: 'abTesting',
  read: async () => {
    readCalls += 1
    return {
      ok: true,
      table: {
        title: 'A/B tests',
        source: { label: 'A/B testing', path: 'marketing/experiments' },
        period: null,
        columns: [
          { key: 'test', label: 'Test', kind: 'text' },
          { key: 'variant', label: 'Variant', kind: 'text' },
          { key: 'shown', label: 'Shown', kind: 'count' },
          { key: 'conversions', label: 'Conversions', kind: 'count' },
          { key: 'rate', label: 'Conversion rate', kind: 'percent' },
          { key: 'lift', label: 'Lift over the first variant', kind: 'change' },
          { key: 'confidence', label: 'Confidence in the lift', kind: 'percent' },
        ],
        rows,
        omitted: 0,
        notes: ['Figures are totals since each test started; the first variant of a test is its control.'],
      },
    }
  },
}

const row = (
  variant: string,
  shown: number,
  conversions: number,
  lift: number | null = null,
  confidence: number | null = null,
) => ({
  test: 'Checkout button',
  variant,
  shown,
  conversions,
  rate: Math.round((conversions / shown) * 1_000) / 10,
  lift,
  confidence,
})

const job = (patch: Partial<AiJob> = {}): AiJob =>
  ({
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'experiment',
    status: 'running',
    brief: 'Test the checkout button copy.',
    inputs: {},
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

const run = (patch: Partial<AiJob> = {}, org: Record<string, unknown> = ORG) =>
  runAiJobExperimentStep({
    job: job(patch),
    stepIndex: 0,
    now: NOW,
    firestore: firestoreOf(HOSTS),
    org,
    modelFor: () => MODEL,
  })

/** The user turn of the last request the step made. */
const lastPrompt = (): string => {
  const call = mockRunAiRequest.mock.calls.at(-1)?.[0] as { messages: Array<{ content: string }> }
  return call.messages.map((message) => message.content).join('\n')
}

beforeAll(() => {
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterAll(() => jest.restoreAllMocks())

beforeEach(() => {
  resetPluginServicesForTests()
  registerPluginFigureReader(experiments, { pluginId: 'marketing' })
  mockRunAiRequest.mockReset()
  mockReleased.mockReset()
  mockReleased.mockImplementation(async (ids: string[]) => ids)
  rows = []
  readCalls = 0
})

describe('variants', () => {
  const inputs = {
    task: 'variants',
    target: 'screen',
    subject: 'Pay now\nYour order is ready to place.',
    goal: 'completed checkouts',
  }

  const proposal = {
    goal: 'More completed checkouts',
    variants: [
      { name: 'As it stands', headline: 'Pay now', body: 'Your order is ready to place.', rationale: 'The copy on the page.' },
      { name: 'Plainer', headline: 'Complete order', body: 'Your order is ready to place.', rationale: 'Says what the button does.' },
    ],
  }

  it('proposes copy, writes nothing, and says so on the output', async () => {
    mockRunAiRequest.mockResolvedValueOnce(called(AI_EXPERIMENT_VARIANTS_TOOL_NAME, proposal))
    const outcome = await run({ inputs })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.outputs).toHaveLength(1)
    const output = outcome.outputs[0]
    expect(output.resource).toBe('experiment')
    expect(output.versionId).toBeNull()
    expect(output.proposal?.['task']).toBe('variants')
    expect(output.proposal?.['variants']).toHaveLength(2)
    expect(output.note).toContain('nothing has been changed on the site')
  })

  it('sends the copy under test and nothing it read itself', async () => {
    mockRunAiRequest.mockResolvedValueOnce(called(AI_EXPERIMENT_VARIANTS_TOOL_NAME, proposal))
    await run({ inputs })
    const prompt = lastPrompt()
    expect(prompt).toContain('Pay now')
    expect(prompt).toContain('completed checkouts')
    // No figures are read for a variants job at all.
    expect(readCalls).toBe(0)
  })

  it('asks once more when nothing usable came back, and fails rather than proposing one variant', async () => {
    const thin = { goal: 'x', variants: [{ name: 'Only', headline: 'Pay now', body: '', rationale: '' }] }
    mockRunAiRequest.mockResolvedValue(called(AI_EXPERIMENT_VARIANTS_TOOL_NAME, thin))
    const outcome = await run({ inputs })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.outputs).toEqual([])
    expect(outcome.failure).toBe(AI_EXPERIMENT_NO_VARIANTS_COPY)
  })

  it('stops for a person rather than the provider when there is no copy to vary', async () => {
    const outcome = await run({ inputs: { task: 'variants', target: 'screen' } })
    expect(outcome.failure).toBe(AI_EXPERIMENT_NO_SUBJECT_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.estCostUsd).toBe(0)
  })
})

describe('explaining a result', () => {
  const inputs = { task: 'explain', test: 'Checkout button' }

  const explanation = (patch: Record<string, unknown> = {}) => ({
    headline: 'Both buttons converted at about the same rate.',
    points: ['Pay now converted 206 of 4,120.'],
    winner: '',
    next: '',
    ...patch,
  })

  it('DOES NOT DECLARE A WINNER when the figures do not support one', async () => {
    rows = [row('Pay now', 4_120, 206), row('Complete order', 4_090, 217, 6.1, 71.4)]
    mockRunAiRequest.mockResolvedValueOnce(
      called(
        AI_EXPERIMENT_EXPLAIN_TOOL_NAME,
        explanation({
          points: ['Complete order is the clear winner.', 'Pay now converted 206 of 4,120.'],
          winner: 'Complete order',
          next: 'Roll Complete order out to everyone.',
        }),
      ),
    )
    const outcome = await run({ inputs })
    const proposal = outcome.outputs[0].proposal as Record<string, unknown>
    expect(proposal['verdict']).toBe('inconclusive')
    expect(proposal['winnerId']).toBeNull()
    expect(proposal['points']).toEqual(['Pay now converted 206 of 4,120.'])
    expect(proposal['next']).toBe(AI_EXPERIMENT_NEXT_INCONCLUSIVE)
  })

  it('tells the model the verdict before it writes a word, and forbids the claim', async () => {
    rows = [row('Pay now', 4_120, 206), row('Complete order', 4_090, 217, 6.1, 71.4)]
    mockRunAiRequest.mockResolvedValueOnce(called(AI_EXPERIMENT_EXPLAIN_TOOL_NAME, explanation()))
    await run({ inputs })
    const prompt = lastPrompt()
    expect(prompt).toContain('VERDICT: THERE IS NO WINNER')
    expect(prompt).toContain('Name no winner')
    // The figures reached it as the reader published them.
    expect(prompt).toContain('shown 4120, converted 206')
  })

  it('keeps the winner where the figures do support one', async () => {
    rows = [row('Pay now', 6_200, 372), row('Complete order', 6_180, 470, 26.7, 99.7)]
    mockRunAiRequest.mockResolvedValueOnce(
      called(
        AI_EXPERIMENT_EXPLAIN_TOOL_NAME,
        explanation({
          headline: 'Complete order converted better than Pay now.',
          points: ['It converted 470 of 6,180.'],
          winner: 'Complete order',
          next: 'Finish the test on Complete order.',
        }),
      ),
    )
    const outcome = await run({ inputs })
    const proposal = outcome.outputs[0].proposal as Record<string, unknown>
    expect(proposal['verdict']).toBe('winner')
    expect(proposal['winnerId']).toBe('Complete order')
    expect(proposal['next']).toBe('Finish the test on Complete order.')
    expect(lastPrompt()).toContain('VERDICT: Complete order is ahead')
  })

  it('spends nothing on a test with nothing to compare', async () => {
    rows = [row('Pay now', 4_120, 206)]
    const outcome = await run({ inputs })
    expect(outcome.failure).toBe(AI_EXPERIMENT_UNREADABLE_RESULT_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(readCalls).toBe(1)
  })

  it('refuses where A/B testing is not this workspace’s to read', async () => {
    rows = [row('Pay now', 4_120, 206), row('Complete order', 4_090, 217, 6.1, 71.4)]
    const outcome = await run({ inputs }, { plan: 'free', billingStatus: 'active', enabledPlugins: ['marketing'] })
    expect(outcome.failure).toBe(AI_EXPERIMENT_NO_READER_COPY)
    expect(readCalls).toBe(0)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('admission', () => {
  const context = (inputs: Record<string, unknown>, org: Record<string, unknown> = ORG) => ({
    firestore: firestoreOf(HOSTS),
    orgId: 'org-1',
    hostId: 'host-1',
    inputs,
    org,
    uid: 'uid-1',
  })

  it('refuses a job that names no task', async () => {
    expect(await aiExperimentAdmissionRefusal(context({}))).toEqual({
      status: 400,
      error: AI_EXPERIMENT_NO_TASK_COPY,
    })
  })

  it('refuses a workspace whose plan has no A/B testing', async () => {
    const refusal = await aiExperimentAdmissionRefusal(
      context({ task: 'variants' }, { plan: 'free', billingStatus: 'active', enabledPlugins: ['marketing'] }),
    )
    expect(refusal).toEqual({ status: 403, error: AI_EXPERIMENT_NO_READER_COPY })
  })

  it('refuses a site of another workspace', async () => {
    const refusal = await aiExperimentAdmissionRefusal({
      ...context({ task: 'explain' }),
      firestore: firestoreOf({ 'hosts/host-1': { orgId: 'org-9' } }),
    })
    expect(refusal).toEqual({ status: 404, error: 'Unknown site' })
  })

  it('admits a Business workspace with the site’s marketing on', async () => {
    expect(await aiExperimentAdmissionRefusal(context({ task: 'variants' }))).toBeNull()
  })
})

describe('registration', () => {
  it('registers the runner and the admission as a call, not an import', () => {
    registerAiExperimentJob()
    expect(aiJobStepRunnerFor('experiment')).toBe(runAiJobExperimentStep)
    expect(aiJobAdmissionFor('experiment')).toBe(aiExperimentAdmissionRefusal)
  })
})
