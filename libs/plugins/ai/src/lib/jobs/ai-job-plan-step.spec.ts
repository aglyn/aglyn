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

import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_DOCTRINE_SYSTEM_BLOCK } from '../runtime/ai-doctrine'
import { AI_DOCTRINE_RULES } from '../runtime/ai-doctrine-validators'
import {
  AI_JOB_PLAN_INSTRUCTIONS,
  AI_JOB_PLAN_REVIEW_COPY,
  AI_PLAN_REUSE_WINDOW_MS,
  aiJobPlanKey,
  aiJobPlanPrompt,
  aiReusablePlan,
  createAiJobPlanStep,
  runAiJobPlanStep,
  type AiJobPlanCandidate,
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

/**
 * Plans another job of this org already carries under the key the step
 * computes. Empty by default: reuse is a seam like the inventory reader, and
 * a test that is not about reuse says so by leaving it empty.
 */
const mockFindPlans = jest.fn<Promise<AiJobPlanCandidate[]>, [string, string, unknown?]>()

/** The runner under test, with both seams faked unless a test names its own. */
function planStep(deps: Parameters<typeof createAiJobPlanStep>[0] = {}) {
  return createAiJobPlanStep({ findPlansByKey: mockFindPlans, ...deps })
}

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  mockFindPlans.mockReset().mockResolvedValue([])
})

describe('the plan step', () => {
  it('registers itself as the plan step every planned kind runs first', () => {
    expect(registerAiJobPlanStep).toHaveBeenCalledWith(runAiJobPlanStep)
  })

  it('reads the site through the machine’s handle and proposes a plan the doctrine held, for review', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN))
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
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
        // The digest the next identical request would find this plan by.
        key: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
    })
    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request).toMatchObject({
      model: 'routed-model',
      tools: [AI_BUILD_PLAN_TOOL, aiInventoryLookupTool()],
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
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore, modelFor })
    expect(modelFor).toHaveBeenCalledWith('job.plan')
    expect(mockRunAiRequest.mock.calls[0][0]).toMatchObject({ model: 'picked-model' })
    expect(outcome.model).toBe('picked-model')
  })

  it('stops for review with the rules named when the re-ask still breaks one, and keeps no plan', async () => {
    const unlaid: AiBuildPlan = { ...PLAN, screens: [{ ...PLAN.screens[0], layout: null }] }
    mockRunAiRequest
      .mockResolvedValueOnce(planAnswer(unlaid))
      .mockResolvedValueOnce(planAnswer(unlaid))
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
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
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
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
    const outcome = await planStep()({
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
      planStep({ readInventory: reader })({ job: job(), stepIndex: 0, now: NOW, firestore }),
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

/**
 * Identical-brief plan reuse (AGL-2937). A plan is the dearest step of a job
 * and the one most often asked for twice — the same brief run again in a
 * sitting, a job resubmitted after a refused reservation, two members
 * starting the same work — so a request that would have been sent the same
 * bytes to the same model keeps the first answer instead of buying it again.
 *
 * What the tests hold: that the key is the whole REQUEST, that a reuse spends
 * nothing (which is what makes the machine release the reservation and meter
 * no credit), that it is still the member's to confirm, and that the window
 * and the statuses shut the door on a plan that should not be handed on.
 */

function candidate(patch: Partial<AiJobPlanCandidate> = {}): AiJobPlanCandidate {
  return {
    jobId: 'job-earlier',
    status: 'needs_review',
    plan: {
      ...PLAN,
      status: 'proposed',
      labels: {},
      proposedAt: new Date(NOW.getTime() - 60_000) as never,
      confirmedAt: null,
      confirmedBy: null,
      key: 'the-key',
    },
    ...patch,
  }
}

describe('aiJobPlanKey', () => {
  const base = {
    job: { kind: 'page' as const, hostId: 'host-1' },
    prompt: 'Job kind: page\nBrief: A pricing page.',
    model: 'routed-model',
    system: [{ text: 'Doctrine.' }, { text: 'Site inventory: one component.' }],
  }

  it('is the same digest for the same request, and a different one for every part of it', () => {
    expect(aiJobPlanKey(base)).toBe(aiJobPlanKey(base))
    expect(aiJobPlanKey(base)).toMatch(/^[0-9a-f]{64}$/)
    const differs = [
      { ...base, job: { ...base.job, kind: 'template' as const } },
      { ...base, job: { ...base.job, hostId: 'host-2' } },
      { ...base, prompt: `${base.prompt} ` },
      { ...base, model: 'other-model' },
      // The rendered inventory is part of the prompt, so a site that gained a
      // component since is a different request and asks the model again.
      { ...base, system: [base.system[0], { text: 'Site inventory: two components.' }] },
    ]
    for (const input of differs) expect(aiJobPlanKey(input)).not.toBe(aiJobPlanKey(base))
  })

  it('cannot be collided by moving characters across the parts it hashes', () => {
    expect(aiJobPlanKey({ ...base, model: 'a', prompt: 'bc' })).not.toBe(
      aiJobPlanKey({ ...base, model: 'ab', prompt: 'c' }),
    )
  })
})

describe('aiReusablePlan', () => {
  const context = { jobId: 'job-1', now: NOW }

  it('takes the newest plan of another job, proposed or already confirmed', () => {
    const older = candidate({ jobId: 'job-old' })
    const newer = candidate({
      jobId: 'job-new',
      status: 'done',
      plan: {
        ...candidate().plan,
        status: 'confirmed',
        proposedAt: new Date(NOW.getTime() - 10_000) as never,
      },
    })
    expect(aiReusablePlan([older, newer], context)?.jobId).toBe('job-new')
  })

  it('refuses this job’s own plan, a canceled or failed job’s, and a plan past the window', () => {
    expect(aiReusablePlan([candidate({ jobId: 'job-1' })], context)).toBeNull()
    expect(aiReusablePlan([candidate({ status: 'canceled' })], context)).toBeNull()
    expect(aiReusablePlan([candidate({ status: 'failed' })], context)).toBeNull()
    const stale = candidate({
      plan: {
        ...candidate().plan,
        proposedAt: new Date(NOW.getTime() - AI_PLAN_REUSE_WINDOW_MS - 1) as never,
      },
    })
    expect(aiReusablePlan([stale], context)).toBeNull()
  })

  it('refuses a plan that is not the job’s answer yet, and one with no instant at all', () => {
    const superseded = candidate({
      plan: { ...candidate().plan, status: 'superseded' as never },
    })
    expect(aiReusablePlan([superseded], context)).toBeNull()
    expect(
      aiReusablePlan([candidate({ plan: { ...candidate().plan, proposedAt: null as never } })], context),
    ).toBeNull()
  })
})

describe('the plan step — reuse', () => {
  it('keeps an identical brief’s plan, spends nothing, and still asks the member to confirm', async () => {
    mockFindPlans.mockResolvedValue([candidate()])
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(outcome.estCostUsd).toBe(0)
    // Proposed to THIS member, whatever the last one did with theirs, and
    // labelled from the inventory this job read.
    expect(outcome.plan).toMatchObject({
      status: 'proposed',
      reusedFrom: 'job-earlier',
      proposedAt: NOW,
      confirmedAt: null,
      confirmedBy: null,
      labels: { 'lay-site': 'Site layout', 'cmp-card': 'Service card' },
    })
    expect(outcome.review).toEqual({
      reason: 'plan',
      message: AI_JOB_PLAN_REVIEW_COPY,
      findings: [],
    })
  })

  it('looks the plan up by the key this request would have been sent under', async () => {
    mockFindPlans.mockResolvedValue([])
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN))
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    const [orgId, key, handle] = mockFindPlans.mock.calls[0]
    expect(orgId).toBe('org-1')
    expect(handle).toBe(firestore)
    // The key the step searched by is the key it then stored, so the next
    // identical request finds this one.
    expect(outcome.plan?.key).toBe(key)
  })

  it('asks the model when nothing matches, and never reuses a job that was canceled', async () => {
    mockFindPlans.mockResolvedValue([candidate({ status: 'canceled' })])
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN))
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.plan?.reusedFrom).toBeUndefined()
  })

  it('asks the model when reuse is turned off, and reads no jobs for it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN))
    await planStep({ findPlansByKey: null })({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockFindPlans).not.toHaveBeenCalled()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
  })
})
