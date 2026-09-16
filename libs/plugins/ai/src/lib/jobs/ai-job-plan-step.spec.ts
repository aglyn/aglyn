/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The plan step (AGL-2935), against the REAL doctrine loop and validators:
 * only the provider (at the runtime's `runAiRequest` seam), the routing
 * table's answer, the inventory reader and the machine's registry are
 * stubbed. So a plan the step proposes is one the doctrine actually held,
 * and a plan it stops on is one the doctrine actually refused twice.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

// The reader needs the Admin SDK; its own spec drives it.
jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: (...args: unknown[]) => mockReadInventory(...args),
}))

// The machine is not under test here — only that the step registers with it.
// The step registers while it is being imported, so the double is made here.
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobPlanStep: jest.fn(),
}))

import { AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_DOCTRINE_SYSTEM_BLOCK } from '../runtime/ai-doctrine'
import { AI_DOCTRINE_RULES } from '../runtime/ai-doctrine-validators'
import {
  AI_JOB_PLAN_INSTRUCTIONS,
  AI_JOB_PLAN_REVIEW_COPY,
  aiJobPlanPrompt,
  createAiJobPlanStep,
  runAiJobPlanStep,
} from './ai-job-plan-step'
import { registerAiJobPlanStep } from './ai-jobs'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const firestore = { handle: 'the machine’s' } as unknown as FirebaseFirestore.Firestore

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  components: [{ id: 'cmp-card', name: 'Service card', props: { title: 'text' } }],
  layouts: [{ id: 'lay-site', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }],
}

const PLAN: AiBuildPlan = {
  reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'the site chrome' }],
  create: [
    {
      kind: 'component',
      name: 'Price table',
      why: 'Nothing on the site lists prices.',
      duplicateOf: null,
      fields: ['tier:text'],
    },
  ],
  screens: [
    {
      title: 'Pricing',
      slug: '/pricing',
      layout: 'lay-site',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Roof repair pricing',
      seoDescription: 'What a roof repair costs, in three tiers.',
      sections: [
        { name: 'hero', uses: [], items: 0 },
        { name: 'tiers', uses: ['new:Price table', 'cmp-card'], items: 0 },
      ],
    },
  ],
}

const USAGE = { inputTokens: 2_000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 }

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'page',
    status: 'running',
    brief: 'A pricing page for three roof repair tiers.',
    inputs: { tone: 'plain' },
    steps: [
      { name: 'plan', status: 'running', creditsSpent: 0 },
      { name: 'generate', status: 'pending', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 100,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    ...patch,
  } as AiJob
}

function planAnswer(plan: AiBuildPlan) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input: plan }],
    usage: USAGE,
    estCostUsd: 0.0105,
    stopReason: 'tool_use',
  }
}

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
})

describe('the plan step', () => {
  it('registers itself as the plan step every planned kind runs first', () => {
    expect(registerAiJobPlanStep).toHaveBeenCalledWith(runAiJobPlanStep)
  })

  it('reads the site through the machine’s handle and proposes a plan the doctrine held, for review', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN))
    const outcome = await createAiJobPlanStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockReadInventory).toHaveBeenCalledWith('org-1', 'host-1', { firestore })
    expect(outcome).toEqual({
      outputs: [],
      usage: USAGE,
      estCostUsd: 0.0105,
      model: 'routed-model',
      stopReason: 'tool_use',
      plan: {
        ...PLAN,
        status: 'proposed',
        labels: { 'lay-site': 'Site layout', 'cmp-card': 'Service card' },
        proposedAt: NOW,
        confirmedAt: null,
        confirmedBy: null,
      },
      review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
    })
    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request).toMatchObject({
      model: 'routed-model',
      tools: [AI_BUILD_PLAN_TOOL],
      thinking: 'adaptive',
      stream: false,
      messages: [{ role: 'user', content: aiJobPlanPrompt(job()) }],
    })
    expect(request.system).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      { ...AI_JOB_PLAN_INSTRUCTIONS[0], cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
  })

  it('runs on the model the machine resolves for job.plan, and reports that model', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN))
    const modelFor = jest.fn(() => 'picked-model')
    const outcome = await createAiJobPlanStep()({ job: job(), stepIndex: 0, now: NOW, firestore, modelFor })
    expect(modelFor).toHaveBeenCalledWith('job.plan')
    expect(mockRunAiRequest.mock.calls[0][0]).toMatchObject({ model: 'picked-model' })
    expect(outcome.model).toBe('picked-model')
  })

  it('stops for review with the rules named when the re-ask still breaks one, and keeps no plan', async () => {
    const unlaid: AiBuildPlan = { ...PLAN, screens: [{ ...PLAN.screens[0], layout: null }] }
    mockRunAiRequest
      .mockResolvedValueOnce(planAnswer(unlaid))
      .mockResolvedValueOnce(planAnswer(unlaid))
    const outcome = await createAiJobPlanStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.plan).toBeUndefined()
    expect(outcome.usage.inputTokens).toBe(4_000)
    expect(outcome.estCostUsd).toBe(0.021)
    expect(outcome.review).toEqual({
      reason: 'doctrine',
      message: expect.stringContaining(`Rule 2 (${AI_DOCTRINE_RULES[2]})`),
      findings: [{ rule: 2, code: 'plan-screen-without-layout', message: expect.any(String) }],
    })
  })

  it('reports a declined brief as refused, with no plan and nothing to review', async () => {
    mockRunAiRequest.mockResolvedValueOnce({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0.001,
      stopReason: 'refusal',
    })
    const outcome = await createAiJobPlanStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(outcome).toMatchObject({ refused: true, outputs: [], estCostUsd: 0.001 })
    expect(outcome.plan).toBeUndefined()
    expect(outcome.review).toBeUndefined()
  })

  it('plans an org-level job without a site, and never reads an inventory for it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      planAnswer({
        reuse: [],
        create: [
          {
            kind: 'dataset',
            name: 'Price list',
            why: 'Nothing holds prices yet.',
            duplicateOf: null,
            fields: ['tier'],
          },
        ],
        screens: [],
      }),
    )
    const outcome = await createAiJobPlanStep()({
      job: job({ hostId: null, kind: 'component' }),
      stepIndex: 0,
      now: NOW,
      firestore,
    })
    expect(mockReadInventory).not.toHaveBeenCalled()
    expect(outcome.review?.reason).toBe('plan')
    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request.system[request.system.length - 1].text).toContain('none was read')
  })

  it('reads through a reader it was handed, and lets a scope refusal stop the step before any request', async () => {
    const reader = jest
      .fn()
      .mockRejectedValue(new Error('host host-1 is not a site of the workspace that asked'))
    await expect(
      createAiJobPlanStep({ readInventory: reader })({ job: job(), stepIndex: 0, now: NOW, firestore }),
    ).rejects.toThrow('not a site of the workspace')
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})

describe('aiJobPlanPrompt', () => {
  it('states the kind, the brief and the scalar inputs, and cuts a brief at its ceiling', () => {
    expect(aiJobPlanPrompt(job())).toBe(
      'Job kind: page\nBrief: A pricing page for three roof repair tiers.\ntone: plain',
    )
    expect(aiJobPlanPrompt(job({ brief: 'x'.repeat(5_000), inputs: {} }))).toHaveLength(
      'Job kind: page\nBrief: '.length + 4_000,
    )
  })
})
