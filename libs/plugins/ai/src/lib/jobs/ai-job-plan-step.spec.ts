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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_INVENTORY_LOOKUP_MAX_ROUNDS,
  AI_INVENTORY_LOOKUP_TOOL_NAME,
  aiInventoryLookupTool,
} from '../tools/ai-inventory-lookup-tool'
import { AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import { AI_MODEL_CATALOG, AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE } from '../providers/routing'
import {
  AI_JOB_ASSUMED_FIRST_TOKEN_MS,
  AI_JOB_INLINE_BUDGET_MS,
  AI_JOB_STEP_MAX_MINIMUM_MS,
  AI_JOB_STEP_OVERHEAD_MS,
  AI_JOB_SWEEP_BUDGET_MS,
  aiGenerationWorstCaseMs,
  aiJobAssumedAnswerMs,
  aiJobBudgetTier,
} from './ai-job-budget'
import type { AiJob } from '../model/ai-jobs.types'
import {
  aiPlanCapabilitiesForJob,
  aiPlanCapabilityLines,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_DOCTRINE_SYSTEM_BLOCK } from '../runtime/ai-doctrine'
import { AI_DOCTRINE_RULES } from '../runtime/ai-doctrine-validators'
import {
  AI_JOB_PLAN_INSTRUCTIONS,
  AI_JOB_PLAN_REVIEW_COPY,
  AI_JOB_PLAN_STEP_MINIMUM_MS,
  AI_JOB_PLAN_SCOPES,
  AI_PLAN_REUSE_WINDOW_MS,
  aiJobPlanKey,
  aiJobPlanMaxTokens,
  aiJobPlanPrompt,
  aiReusablePlan,
  createAiJobPlanStep,
  readAiJobPlanCapabilities,
  runAiJobPlanStep,
  type AiJobPlanCandidate,
  registerAiJobPlan,
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

/** A console resource id: `createResourceUid()`'s nanoid. */
const RESOURCE_ID = /^[A-Za-z0-9_-]{10}$/

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

/**
 * The runner under test, with its seams faked unless a test names its own.
 * What the job may create reads nothing unless a test hands in capabilities:
 * the machine's Firestore handle here is a stand-in.
 */
function planStep(deps: Parameters<typeof createAiJobPlanStep>[0] = {}) {
  return createAiJobPlanStep({
    findPlansByKey: mockFindPlans,
    readCapabilities: async () => null,
    ...deps,
  })
}

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  mockFindPlans.mockReset().mockResolvedValue([])
})

describe('the plan step', () => {
  it('registers the plan step every planned kind runs first, with the least time a plan needs', () => {
    registerAiJobPlan()
    expect(registerAiJobPlanStep).toHaveBeenCalledWith(runAiJobPlanStep, {
      minimumMs: AI_JOB_PLAN_STEP_MINIMUM_MS,
    })
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
        // The draft the creation becomes is named as the plan is kept (AGL-3079).
        create: [{ ...PLAN.create[0], id: expect.stringMatching(RESOURCE_ID) }],
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
      // A plan's finding keeps the entry it names (AGL-3078); a plan has no nodes to outline.
      findings: [{ rule: 2, code: 'plan-screen-without-layout', message: expect.any(String), paths: ['screens[0].layout'] }],
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

describe('the time budget: no inline door starts a plan, and the beat can (AGL-3026, AGL-3036)', () => {
  const modelOn = (tier: 'fast' | 'balanced' | 'deep') => AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string

  it('registers a minimum past an inline door’s budget and inside what a beat can give a step', () => {
    expect(AI_JOB_PLAN_STEP_MINIMUM_MS).toBeGreaterThan(AI_JOB_INLINE_BUDGET_MS)
    expect(AI_JOB_PLAN_STEP_MINIMUM_MS).toBeLessThanOrEqual(AI_JOB_STEP_MAX_MINIMUM_MS)
    expect(AI_JOB_STEP_MAX_MINIMUM_MS).toBeLessThanOrEqual(AI_JOB_SWEEP_BUDGET_MS)
  })

  it('is a plan’s lookup rounds, answer and re-ask on the tier the step is served from, at the most of the routing ceiling a beat can start', () => {
    const route = AI_ROUTING_TABLE['job.plan']
    const served = modelOn(AI_STEP_TIERS['job.plan'])
    const ceiling = aiJobPlanMaxTokens(served)
    // The whole routing ceiling could never start: counting both lookup
    // rounds, its worst case is past what a beat can give a step.
    expect(aiGenerationWorstCaseMs({ model: served, maxTokens: route.maxTokens })).toBeGreaterThan(AI_JOB_STEP_MAX_MINIMUM_MS)
    expect(ceiling).toBeLessThan(route.maxTokens)
    expect(AI_JOB_PLAN_STEP_MINIMUM_MS).toBe(aiGenerationWorstCaseMs({ model: served, maxTokens: ceiling }))
    expect(aiGenerationWorstCaseMs({ model: served, maxTokens: ceiling + 1 })).toBeGreaterThan(AI_JOB_STEP_MAX_MINIMUM_MS)
    // It stays above what the live Free plan measured (AGL-3024: 3,954
    // output tokens on the balanced tier): the ceiling cuts off no plan a live
    // run has answered.
    expect(ceiling).toBeGreaterThan(3_954)
  })

  it('is stated in the developer notes with the figures the code computes', () => {
    // Read as prose: a sentence the notes wrap across lines still says it.
    const notes = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    const figure = (value: number) => value.toLocaleString('en-US')
    const route = AI_ROUTING_TABLE['job.plan']
    const tier = AI_STEP_TIERS['job.plan']
    const served = modelOn(tier)
    const wait = `4 × ${AI_JOB_ASSUMED_FIRST_TOKEN_MS / 1_000} s`
    const overhead = `${AI_JOB_STEP_OVERHEAD_MS / 1_000} s`
    expect(notes).toContain(
      `At the routing table's ${figure(route.maxTokens)} tokens on the ${tier} tier that is ${wait} + 2 × ` +
        `${figure(aiJobAssumedAnswerMs(route.maxTokens, tier))} ms + ${overhead} = ` +
        `${figure(aiGenerationWorstCaseMs({ model: served, maxTokens: route.maxTokens }))} ms`,
    )
    expect(notes).toContain(
      `so the ${tier} tier asks for ${figure(aiJobPlanMaxTokens(served))} tokens: ${wait} + 2 × ` +
        `${figure(aiJobAssumedAnswerMs(aiJobPlanMaxTokens(served), tier))} ms + ${overhead} = ${figure(AI_JOB_PLAN_STEP_MINIMUM_MS)} ms`,
    )
    expect(notes).toContain(`\`AI_JOB_SWEEP_BUDGET_MS\` (${AI_JOB_SWEEP_BUDGET_MS / 1_000} s)`)
    expect(notes).toContain(
      `The fast tier asks for ${figure(aiJobPlanMaxTokens(modelOn('fast')))} tokens and the deep tier for ${figure(aiJobPlanMaxTokens(modelOn('deep')))}`,
    )
  })

  it.each(['fast', 'balanced', 'deep'] as const)(
    'on the %s tier, a plan that looks records up twice, breaks a rule and is re-asked finishes inside the minimum on a fake clock',
    async (tier) => {
      const model = modelOn(tier)
      expect(aiJobBudgetTier(model)).toBe(tier)
      const ceiling = aiJobPlanMaxTokens(model)
      expect(ceiling).toBeGreaterThan(0)
      expect(ceiling).toBeLessThanOrEqual(AI_ROUTING_TABLE['job.plan'].maxTokens)

      // Every exchange is charged what the budget module assumes a provider
      // takes: a start, then the output it answers with. Each lookup round
      // asks for a card by name; each answer runs to all it was asked for.
      let clock = 0
      const LOOKUP_OUTPUT = 60
      const unlaid: AiBuildPlan = { ...PLAN, screens: [{ ...PLAN.screens[0], layout: null }] }
      mockRunAiRequest.mockImplementation(async (request: { maxTokens: number }) => {
        const call = mockRunAiRequest.mock.calls.length
        if (call <= AI_INVENTORY_LOOKUP_MAX_ROUNDS) {
          clock += AI_JOB_ASSUMED_FIRST_TOKEN_MS + aiJobAssumedAnswerMs(LOOKUP_OUTPUT, tier)
          return {
            kind: 'completion',
            text: '',
            toolUse: [{ name: AI_INVENTORY_LOOKUP_TOOL_NAME, input: { kind: 'components', query: 'price' } }],
            usage: { ...USAGE, outputTokens: LOOKUP_OUTPUT },
            estCostUsd: 0.001,
            stopReason: 'tool_use',
          }
        }
        clock += AI_JOB_ASSUMED_FIRST_TOKEN_MS + aiJobAssumedAnswerMs(request.maxTokens, tier)
        return {
          ...planAnswer(call === AI_INVENTORY_LOOKUP_MAX_ROUNDS + 1 ? unlaid : PLAN),
          usage: { ...USAGE, outputTokens: request.maxTokens },
        }
      })
      const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore, modelFor: () => model })

      // Both lookup rounds, then an answer that broke a rule, then its re-ask
      // on what is left of the plan's allowance.
      expect(mockRunAiRequest).toHaveBeenCalledTimes(AI_INVENTORY_LOOKUP_MAX_ROUNDS + 2)
      expect(mockRunAiRequest.mock.calls.map(([request]) => request.maxTokens)).toEqual([
        ceiling,
        ceiling,
        ceiling,
        ceiling - 2 * LOOKUP_OUTPUT,
      ])
      for (const [request] of mockRunAiRequest.mock.calls) {
        expect(request).toMatchObject({ model, thinking: 'adaptive' })
      }
      expect(outcome.review?.reason).toBe('plan')
      expect(clock + AI_JOB_STEP_OVERHEAD_MS).toBeLessThanOrEqual(AI_JOB_PLAN_STEP_MINIMUM_MS)
    },
  )
})

/**
 * What the job may create on its site (AGL-3030): a Free workspace keeps no
 * reusable components and no saved forms, and its one shared layout is the
 * site's already.
 */
const FREE: AiPlanCapabilities = {
  reusableComponents: false,
  create: {
    ...aiUnrestrictedPlanCapabilities().create,
    component: { allowed: false, left: 0, reason: "this workspace's plan does not include reusable components" },
    form: { allowed: false, left: 0, reason: "this workspace's plan does not include saved forms" },
  },
}

/** PLAN, built the way a Free workspace can build it: the tiers drawn in their section. */
const INLINE_PLAN: AiBuildPlan = {
  ...PLAN,
  create: [],
  screens: [{ ...PLAN.screens[0], sections: [{ name: 'hero', uses: [], items: 0 }, { name: 'tiers', uses: [], items: 3 }] }],
}

describe('the plan step — what the job may create (AGL-3030)', () => {
  it('tells the plan what a page job may create here in the user turn, never in a cached block', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(INLINE_PLAN))
    const readCapabilities = jest.fn(async () => FREE)
    await planStep({ readCapabilities })({
      job: job(),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: { plan: 'free' },
    })
    expect(readCapabilities).toHaveBeenCalledWith({ job: job(), org: { plan: 'free' }, firestore })
    const [request] = mockRunAiRequest.mock.calls[0]
    const told = aiPlanCapabilitiesForJob(FREE, AI_JOB_PLAN_SCOPES.page)
    expect(request.messages[0].content).toBe(aiJobPlanPrompt(job(), told))
    expect(request.messages[0].content).toContain('- component: no, because this workspace\'s plan does not include reusable components')
    expect(request.messages[0].content).toContain('- template: no, because a page job does not build one')
    // The cached prefix is the platform's: nothing of this workspace rides in it.
    expect(request.system.slice(0, 2)).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      { ...AI_JOB_PLAN_INSTRUCTIONS[0], cacheBreakpoint: true },
    ])
    for (const line of aiPlanCapabilityLines(told)) {
      expect(request.system.map((block: { text: string }) => block.text).join('\n')).not.toContain(line)
    }
  })

  it('asks once more for a creation the workspace cannot make, and keeps the plan the re-ask builds inline', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(PLAN)).mockResolvedValueOnce(planAnswer(INLINE_PLAN))
    const outcome = await planStep({ readCapabilities: async () => FREE })({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reask = mockRunAiRequest.mock.calls[1][0].messages.at(-1).content as string
    expect(reask).toContain(`Rule 7 (${AI_DOCTRINE_RULES[7]}): The plan creates a component named "Price table"`)
    expect(outcome.review).toEqual({ reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] })
    expect(outcome.plan).toMatchObject({ create: [], screens: [{ sections: INLINE_PLAN.screens[0].sections }] })
  })

  it('asks a Free plan that splits a list into one-item sections for one repeated section, and keeps the section the re-ask plans (AGL-3071)', async () => {
    const split: AiBuildPlan = {
      ...INLINE_PLAN,
      screens: [
        {
          ...INLINE_PLAN.screens[0],
          sections: [
            { name: 'hero', uses: [], items: 0 },
            { name: 'tier: basic', uses: [], items: 1 },
            { name: 'tier: standard', uses: [], items: 1 },
            { name: 'tier: premium', uses: [], items: 1 },
          ],
        },
      ],
    }
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(split)).mockResolvedValueOnce(planAnswer(INLINE_PLAN))
    const outcome = await planStep({ readCapabilities: async () => FREE })({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const [first] = mockRunAiRequest.mock.calls[0]
    expect(first.messages[0].content).toContain(
      "This workspace keeps no reusable components or saved forms: draw a list's repeated items in one section, and a form as a Form element holding its Form Fields.",
    )
    const reask = mockRunAiRequest.mock.calls[1][0].messages.at(-1).content as string
    expect(reask).toContain(
      `Rule 1 (${AI_DOCTRINE_RULES[1]}): The sections "tier: basic", "tier: standard" and "tier: premium" each show one item of the same kind, so they are one list split apart. Plan them as one section whose 3 items repeat: {"name":"tiers","uses":[],"items":3}. (at screens[0].sections[1], screens[0].sections[2], screens[0].sections[3])`,
    )
    expect(outcome.review).toEqual({ reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] })
    expect(outcome.plan).toMatchObject({ screens: [{ sections: [{ name: 'hero', uses: [], items: 0 }, { name: 'tiers', uses: [], items: 3 }] }] })
  })

  it('asks once more for a page plan of two pages, in the page job’s own sentence', async () => {
    const twoPages: AiBuildPlan = { ...INLINE_PLAN, screens: [INLINE_PLAN.screens[0], { ...INLINE_PLAN.screens[0], slug: '/pricing-2' }] }
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(twoPages)).mockResolvedValueOnce(planAnswer(INLINE_PLAN))
    const outcome = await planStep({ readCapabilities: async () => FREE })({ job: job(), stepIndex: 0, now: NOW, firestore })
    const reask = mockRunAiRequest.mock.calls[1][0].messages.at(-1).content as string
    expect(reask).toContain('This plan builds 2 pages, and a page job builds one.')
    expect(outcome.review?.reason).toBe('plan')
  })

  it('refuses a plan the confirm door would refuse before any member sees it: the job fails with the door’s sentence and keeps no plan', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(INLINE_PLAN))
    const admissionRefusal = jest.fn(async () => ({
      status: 403 as const,
      error: 'Your plan includes 5 screens — upgrade in Billing for more',
    }))
    const outcome = await planStep({ admissionRefusal, readCapabilities: async () => FREE })({
      job: job(),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: { plan: 'free' },
    })
    // The door is asked as the resume door asks it: the plan, the job's site, inputs and creator.
    expect(admissionRefusal).toHaveBeenCalledWith('page', {
      firestore,
      orgId: 'org-1',
      hostId: 'host-1',
      inputs: { tone: 'plain' },
      org: { plan: 'free' },
      plan: expect.objectContaining({ status: 'proposed', screens: INLINE_PLAN.screens }),
      uid: 'uid-1',
    })
    expect(outcome.failure).toBe('Your plan includes 5 screens — upgrade in Billing for more')
    expect(outcome.plan).toBeUndefined()
    expect(outcome.review).toBeUndefined()
    // What the plan spent is on the bill all the same.
    expect(outcome).toMatchObject({ usage: USAGE, estCostUsd: 0.0105 })
  })

  it('holds a reused plan to the same door, and spends nothing on it', async () => {
    mockFindPlans.mockResolvedValue([candidate()])
    const outcome = await planStep({
      admissionRefusal: async () => ({ status: 400, error: 'This plan builds 2 pages, and a page job builds one.' }),
    })({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ failure: 'This plan builds 2 pages, and a page job builds one.', estCostUsd: 0 })
    expect(outcome.plan).toBeUndefined()
  })

  it('keeps the plan when the door cannot answer, since the resume door asks again before anything is built', async () => {
    mockRunAiRequest.mockResolvedValueOnce(planAnswer(INLINE_PLAN))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const outcome = await planStep({
      readCapabilities: async () => FREE,
      admissionRefusal: async () => {
        throw new Error('firestore unavailable')
      },
    })({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.review?.reason).toBe('plan')
  })

  it('reads no capabilities for a job with no site, and restricts nothing for it', async () => {
    expect(await readAiJobPlanCapabilities({ job: job({ hostId: null }), org: null, firestore })).toBeNull()
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

  it('tells a template job what its fields are, and charges no other kind for it (AGL-3143 §11)', () => {
    const template = aiJobPlanPrompt(job({ kind: 'template', inputs: { subject: 'author' } }))
    // The subject's own catalog, so the planner promises only what the page
    // fills and `aiPlanTemplateTokenViolations` can hold the build to it.
    expect(template).toContain("The template's fields are the binding tokens its page shows")
    expect(template).toContain('{{author.name}}')
    expect(template).toContain('{{author.bio}}')

    // ⛔ The line rides the job's OWN turn, never the plan tool's cached
    // `fields` description. Written there it cost 40 tokens of the shared
    // prefix, which is one credit of the Free page's 300-credit wall and takes
    // the room it keeps for a re-asked section from 45 to 44.
    expect(aiJobPlanPrompt(job())).not.toContain('binding tokens')
    expect(aiJobPlanPrompt(job({ kind: 'layout', inputs: {} }))).not.toContain('binding tokens')
    // A template job whose subject never arrived is told nothing it cannot use.
    expect(aiJobPlanPrompt(job({ kind: 'template', inputs: {} }))).not.toContain('binding tokens')
    expect(aiJobPlanPrompt(job({ kind: 'template', inputs: { subject: 'nonsense' } }))).not.toContain(
      'binding tokens',
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

  it('names the reused plan’s drafts afresh, so this job never finds the earlier job’s drafts as its own (AGL-3079)', async () => {
    const earlier = candidate()
    earlier.plan = { ...earlier.plan, create: earlier.plan.create.map((entry) => ({ ...entry, id: 'earlierDrf' })) }
    mockFindPlans.mockResolvedValue([earlier])
    const outcome = await planStep()({ job: job(), stepIndex: 0, now: NOW, firestore })
    expect(outcome.plan?.reusedFrom).toBe('job-earlier')
    expect(outcome.plan?.create.map((entry) => entry.id)).toEqual([expect.stringMatching(RESOURCE_ID)])
    expect(outcome.plan?.create[0].id).not.toBe('earlierDrf')
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
