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
 * The page step (AGL-2907), against the REAL doctrine loop, validators,
 * section check, draft writer and plan arithmetic: only the provider (at the
 * runtime's `runAiRequest` seam), the routing table's answer, the inventory
 * reader, the host index, the duplicate module, the listing generator and the
 * machine's registry are stubbed, and Firestore is a double that honors
 * transactions.
 *
 * It holds the two decisions the issue asked for:
 *
 *  - THE TIME BUDGET. A pass is one section, and its worst case — its lookup
 *    rounds, the answer and its re-ask, out of one allowance of the pass's
 *    ceiling, at the rates the budget module assumes (AGL-3036) — fits the
 *    minimum the step registers, which fits the beat's budget and not an
 *    inline door's. A fake clock measures it on every catalog tier.
 *  - AN UNPUBLISHED SCREEN. The draft is a screen and its first version, the
 *    host document is never written, and no address resolves to the draft.
 *
 * And, since AGL-3031, that a plan's layout, forms and components are built
 * first, in the same job, each by the runner of its kind under a job derived
 * from this one, and that the page then places what was built.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()
let mockRouted = 'claude-sonnet-5'

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => mockRouted,
}))

// The reader needs the Admin SDK; its own spec drives it.
jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: (...args: unknown[]) => mockReadInventory(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))

jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))

// The machine is not under test here — only that the step registers with it,
// and which kinds have a runner a page's creations can be built by.
const mockRunners = new Set<string>(['layout', 'form', 'component'])
/** What each kind a creation is built by registers as its least time, told apart by value. */
const mockMinimums: Record<string, number> = { layout: 111_000, form: 122_000, component: 133_000 }
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  registerAiJobStepPasses: jest.fn(),
  aiJobStepRunnerFor: (kind: string) => (mockRunners.has(kind) ? jest.fn() : null),
  aiJobStepRunMinimumMs: (job: { kind: string }) => mockMinimums[job.kind] ?? 0,
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findScreenIdByRoutePath } from '@aglyn/aglyn/app-utils/screen-route'
import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import { AI_BUILD_PLAN_LIMITS } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { AI_MODEL_CATALOG, AI_STEP_TIERS } from '../providers/catalog'
import { AI_DOCTRINE_SYSTEM_BLOCK } from '../runtime/ai-doctrine'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import type { generateSeoFields } from '../runtime/seo-fields'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import {
  AI_JOB_ASSUMED_FIRST_TOKEN_MS,
  AI_JOB_INLINE_BUDGET_MS,
  AI_JOB_STEP_MAX_MINIMUM_MS,
  AI_JOB_STEP_OVERHEAD_MS,
  AI_JOB_SWEEP_BUDGET_MS,
  aiGenerationWorstCaseOnTierMs,
  aiJobAssumedAnswerMs,
  aiJobBudgetTier,
} from './ai-job-budget'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_TOOL,
  aiPageSectionNodeId,
  aiPageSectionSmaller,
} from './ai-job-page-sections'
import {
  AI_JOB_PAGE_CREATION_EMPTY_COPY,
  AI_JOB_PAGE_CREATION_UNAVAILABLE_COPY,
  AI_JOB_PAGE_DELETED_COPY,
  AI_JOB_PAGE_MAX_PASSES,
  AI_JOB_PAGE_SECTION_MAX_TOKENS,
  AI_JOB_PAGE_SECTION_TOKENS,
  AI_JOB_PAGE_STEP_MINIMUM_MS,
  aiJobPageSectionMaxElements,
  aiJobPageSectionMaxTokens,
  aiPageJobAdmission,
  aiPageJobRunMinimumMs,
  aiPageJobUnits,
  createAiJobPageStep,
  runAiJobPageStep,
  registerAiPageJob,
} from './ai-job-page-step'
import type { AiJobStepContext, AiJobStepOutcome } from './ai-job-text-step'
import { registerAiJobStep, registerAiJobStepPasses } from './ai-jobs'
import { AI_PAGE_BRIEF_FIXTURES } from './fixtures/ai-page-briefs'
import {
  AI_INVENTORY_LOOKUP_MAX_ROUNDS,
  AI_INVENTORY_LOOKUP_TOOL_NAME,
  aiInventoryLookupTool,
} from '../tools/ai-inventory-lookup-tool'

const NOW = new Date('2026-09-15T22:00:00.000Z')
const FIXTURE = AI_PAGE_BRIEF_FIXTURES[0]
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 900, outputTokens: 300, cacheReadTokens: 4_200, cacheWriteTokens: 0 }

// ── Firestore double ─────────────────────────────────────────────────────

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    )
}

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? valueAt(data, field) : undefined),
  }
}

type DocTarget = { kind: 'doc'; path: string }
type QueryTarget = { kind: 'query'; get: () => Promise<{ docs: Array<ReturnType<typeof snapshotOf>> }> }

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const query: QueryTarget = {
    kind: 'query',
    get: async () => ({
      docs: [...mockDocs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshotOf),
    }),
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, get: query.get }
}

function setAt(data: Record<string, unknown>, dotted: string, value: unknown) {
  const keys = dotted.split('.')
  let cursor = data
  for (const key of keys.slice(0, -1)) {
    cursor[key] = { ...((cursor[key] as Record<string, unknown>) ?? {}) }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

let commits: string[] = []

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = []
    const result = await fn({
      get: async (target: DocTarget | QueryTarget) =>
        target.kind === 'query' ? target.get() : snapshotOf(target.path),
      create: (ref: DocTarget, data: Record<string, unknown>) =>
        writes.push(() => {
          if (mockDocs.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: ${ref.path}`)
          mockDocs.set(ref.path, data)
          commits.push(ref.path)
        }),
      update: (ref: DocTarget, patch: Record<string, unknown>) =>
        writes.push(() => {
          const next = { ...(mockDocs.get(ref.path) ?? {}) }
          for (const [key, value] of Object.entries(patch)) setAt(next, key, value)
          mockDocs.set(ref.path, next)
          commits.push(ref.path)
        }),
    })
    for (const write of writes) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── Fixtures ─────────────────────────────────────────────────────────────

const PLAN: AiJobPlan = {
  ...FIXTURE.plan,
  status: 'confirmed',
  labels: {},
  proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
  confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
  confirmedBy: 'uid-1',
}
const SCREEN = PLAN.screens[0]
const SECTION_IDS = SCREEN.sections.map((_, index) => aiPageSectionNodeId('job-1', index))
const DRAFT = 'hosts/host-1/screens/job-1'

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'page',
    status: 'running',
    brief: FIXTURE.brief,
    inputs: { pageType: FIXTURE.pageType },
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 3 },
      { name: 'generate', status: 'running', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 3,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: PLAN,
    review: null,
    ...patch,
  } as AiJob
}

function sectionAnswer(tree: unknown, usage = USAGE) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'submit_section', input: { tree: JSON.stringify(tree) } }],
    usage,
    estCostUsd: 0.01,
    stopReason: 'tool_use',
  }
}

const seoFields = jest.fn() as jest.MockedFunction<typeof generateSeoFields>
const duplicate = jest.fn() as unknown as jest.MockedFunction<typeof duplicateResource>
const step = () => createAiJobPageStep({ seoFields, duplicate })
const context = (patch: Partial<AiJob> = {}, extra: Record<string, unknown> = {}) => ({
  job: job(patch),
  stepIndex: 1,
  now: NOW,
  firestore,
  ...extra,
})

/** Run a pass for every section of the fixture, replaying its golden answers. */
async function buildSections(): Promise<void> {
  for (const answer of FIXTURE.answers) {
    mockRunAiRequest.mockResolvedValueOnce(sectionAnswer(answer))
    const outcome = await step()(context())
    expect(outcome).toMatchObject({ continue: true, outputs: [] })
  }
}

const storedPage = () => {
  const screen = mockDocs.get(DRAFT)
  const version = mockDocs.get(`${DRAFT}/versions/${screen?.['versionId']}`)
  return decodeStoredNodes(version?.['nodes']) as Record<string, { nodes?: string[] }>
}

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(FIXTURE.inventory)
  seoFields.mockReset()
  duplicate.mockReset()
  mockDocs.clear()
  mockOwners.clear()
  commits = []
  mockRouted = 'claude-sonnet-5'
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', { subdomain: 'acme', displayName: 'Acme Roofing', screens: { 'scr-home': '/', 'scr-contact': 'contact' } })
  mockDocs.set('orgs/org-1', STARTER_ORG)
})

describe('the page step’s registration', () => {
  it('registers the page runner with the least time a pass needs, and the admission both doors ask', async () => {
    registerAiPageJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('page', runAiJobPageStep, {
      minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
      minimumMsFor: aiPageJobRunMinimumMs,
    })
    const ask = (patch: Record<string, unknown> = {}) =>
      aiJobAdmissionRefusal('page', { firestore, orgId: 'org-1', hostId: 'host-1', inputs: {}, org: STARTER_ORG, ...patch })
    expect(await ask({ hostId: null })).toEqual({ status: 400, error: 'Open the site the page is for before starting the job' })
    expect(await ask({ inputs: { pageType: 'homepage' } })).toEqual({
      status: 400,
      error: 'pageType must be one of landing, about, pricing, contact, blogIndex, product, service, event',
    })
    expect(await ask({ inputs: { pageType: 'landing' } })).toBeNull()
    expect(registerAiJobStepPasses).toHaveBeenCalledWith('page', AI_JOB_PAGE_MAX_PASSES)
    // At confirmation, a plan that creates what a page job builds is admitted
    // where the workspace may make it (AGL-3031)…
    const card = { kind: 'component' as const, name: 'Price tier', why: 'Three tiers repeat.', duplicateOf: null, fields: [] }
    const creating = { ...PLAN, create: [card] }
    expect(await ask({ plan: creating })).toBeNull()
    // …refused where it may not, in a sentence naming the creation and why…
    expect(await ask({ plan: creating, org: {} })).toEqual({
      status: 403,
      error: 'This page cannot be built as planned: it creates the component “Price tier”, because this workspace\'s plan does not include reusable components. Describe the page again.',
    })
    // …refused where nothing here builds it…
    mockRunners.delete('component')
    expect(await ask({ plan: creating })).toEqual({ status: 400, error: AI_JOB_PAGE_CREATION_UNAVAILABLE_COPY })
    mockRunners.add('component')
    // …and a creation a page job does not build is someone else's, named with where it is made.
    const template = { ...PLAN, create: [{ ...card, kind: 'template' as const, name: 'Service page' }] }
    expect(await ask({ plan: template })).toEqual({ status: 400, error: expect.stringContaining('template “Service page” in the Templates library') })
    expect(await ask({ plan: PLAN })).toBeNull()
    expect(aiPageJobAdmission).toBeInstanceOf(Function)
  })

  it('bounds its passes by every creation and section a plan may hold, and the last pass', () => {
    expect(AI_JOB_PAGE_MAX_PASSES).toBe(AI_BUILD_PLAN_LIMITS.create + AI_BUILD_PLAN_LIMITS.sections + 1)
  })
})

describe('the time budget: a pass fits the least time it registers, and that fits the beat', () => {
  const modelOn = (tier: 'fast' | 'balanced' | 'deep') => AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string

  it('registers a minimum inside what a beat can give a step and past an inline door’s budget, so passes run on the beat', () => {
    expect(AI_JOB_PAGE_STEP_MINIMUM_MS).toBeLessThanOrEqual(AI_JOB_STEP_MAX_MINIMUM_MS)
    expect(AI_JOB_STEP_MAX_MINIMUM_MS).toBeLessThanOrEqual(AI_JOB_SWEEP_BUDGET_MS)
    expect(AI_JOB_PAGE_STEP_MINIMUM_MS).toBeGreaterThan(AI_JOB_INLINE_BUDGET_MS)
  })

  it('is a section’s lookup rounds, its answer and its re-ask at the served tier’s section ceiling (AGL-3036)', () => {
    const served = modelOn(AI_STEP_TIERS['job.page'])
    expect(AI_JOB_PAGE_STEP_MINIMUM_MS).toBe(
      aiGenerationWorstCaseOnTierMs({ tier: AI_STEP_TIERS['job.page'], maxTokens: AI_JOB_PAGE_SECTION_TOKENS }),
    )
    expect(aiJobPageSectionMaxTokens(served)).toBe(AI_JOB_PAGE_SECTION_TOKENS)
    // A faster tier asks more in the same time, never past the most a section may run to.
    expect(aiJobPageSectionMaxTokens(modelOn('fast'))).toBeGreaterThan(AI_JOB_PAGE_SECTION_TOKENS)
    expect(aiJobPageSectionMaxTokens(modelOn('fast'))).toBeLessThanOrEqual(AI_JOB_PAGE_SECTION_MAX_TOKENS)
  })

  it('is stated in the developer notes with the figures the code computes', () => {
    const notes = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    const figure = (value: number) => value.toLocaleString('en-US')
    const served = AI_STEP_TIERS['job.page']
    expect(notes).toContain(
      `\`AI_JOB_PAGE_SECTION_TOKENS\` (${figure(AI_JOB_PAGE_SECTION_TOKENS)} tokens) on the ${served} tier, ` +
        `4 × ${AI_JOB_ASSUMED_FIRST_TOKEN_MS / 1_000} s + 2 × ${figure(aiJobAssumedAnswerMs(AI_JOB_PAGE_SECTION_TOKENS, served))} ms + ` +
        `${AI_JOB_STEP_OVERHEAD_MS / 1_000} s = ${figure(AI_JOB_PAGE_STEP_MINIMUM_MS)} ms`,
    )
    expect(notes).toContain(
      `${figure(aiJobPageSectionMaxTokens(modelOn('fast')))} tokens on the fast tier, ` +
        `${figure(aiJobPageSectionMaxTokens(modelOn('balanced')))} on the balanced tier and ` +
        `${figure(aiJobPageSectionMaxTokens(modelOn('deep')))} on the deep tier`,
    )
  })

  it.each(['fast', 'balanced', 'deep'] as const)(
    'on the %s tier, a section that looks records up twice, breaks a rule and is re-asked finishes inside the minimum on a fake clock',
    async (tier) => {
      const model = modelOn(tier)
      expect(aiJobBudgetTier(model)).toBe(tier)
      const ceiling = aiJobPageSectionMaxTokens(model)
      expect(ceiling).toBeGreaterThan(0)

      // The clock charges every exchange what the budget module assumes a
      // provider takes: a start, then the output it answers with. Each lookup
      // round asks for a card by name; each answer runs to all it was asked for.
      let clock = 0
      const LOOKUP_OUTPUT = 60
      const broken = { rootId: 'root', nodes: { root: { componentId: 'div', nodes: ['s'] }, s: { componentId: 'section', props: { element: 'section' }, nodes: ['p'] }, p: { componentId: 'muiTypography', props: { variant: 'body1', children: 'No heading at all.' } } } }
      mockRunAiRequest.mockImplementation(async (request: { maxTokens: number }) => {
        const call = mockRunAiRequest.mock.calls.length
        if (call <= AI_INVENTORY_LOOKUP_MAX_ROUNDS) {
          clock += AI_JOB_ASSUMED_FIRST_TOKEN_MS + aiJobAssumedAnswerMs(LOOKUP_OUTPUT, tier)
          return {
            kind: 'completion',
            text: '',
            toolUse: [{ name: AI_INVENTORY_LOOKUP_TOOL_NAME, input: { kind: 'components', query: 'card' } }],
            usage: { ...USAGE, outputTokens: LOOKUP_OUTPUT },
            estCostUsd: 0.001,
            stopReason: 'tool_use',
          }
        }
        clock += AI_JOB_ASSUMED_FIRST_TOKEN_MS + aiJobAssumedAnswerMs(request.maxTokens, tier)
        const tree = call === AI_INVENTORY_LOOKUP_MAX_ROUNDS + 1 ? broken : FIXTURE.answers[0]
        return sectionAnswer(tree, { ...USAGE, outputTokens: request.maxTokens })
      })
      const modelFor = (kind: string) => (kind === 'job.page' ? model : undefined)
      const outcome = await step()(context({}, { modelFor }))

      // Both lookup rounds, then an answer that broke a rule, then its re-ask
      // on what is left of the pass's allowance.
      expect(mockRunAiRequest).toHaveBeenCalledTimes(AI_INVENTORY_LOOKUP_MAX_ROUNDS + 2)
      expect(mockRunAiRequest.mock.calls.map(([request]) => request.maxTokens)).toEqual([
        ceiling,
        ceiling,
        ceiling,
        ceiling - 2 * LOOKUP_OUTPUT,
      ])
      for (const [request] of mockRunAiRequest.mock.calls) {
        expect(request).toMatchObject({ model, thinking: 'off' })
      }
      expect(outcome).toMatchObject({ continue: true })
      expect(clock + AI_JOB_STEP_OVERHEAD_MS).toBeLessThanOrEqual(AI_JOB_PAGE_STEP_MINIMUM_MS)
      // The request asks the section to stay under what that ceiling holds.
      const prompt = mockRunAiRequest.mock.calls[0][0].messages[0].content as string
      expect(prompt).toContain(`Keep this section to at most ${aiJobPageSectionMaxElements(ceiling)} elements.`)
    },
  )
})

describe('the passes', () => {
  it('builds the first section under the page’s rules and writes an unpublished draft screen', async () => {
    mockRunAiRequest.mockResolvedValueOnce(sectionAnswer(FIXTURE.answers[0]))
    const before = JSON.stringify(mockDocs.get('hosts/host-1'))
    const outcome = await step()(context())
    expect(outcome).toEqual({ outputs: [], usage: USAGE, estCostUsd: 0.01, model: 'claude-sonnet-5', stopReason: 'tool_use', continue: true })

    const [request] = mockRunAiRequest.mock.calls[0]
    expect(request).toMatchObject({
      tools: [AI_PAGE_SECTION_TOOL, aiInventoryLookupTool()],
      thinking: 'off',
      stream: false,
    })
    expect(request.system).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      AI_JOB_PAGE_INSTRUCTIONS[0],
      { text: AI_PALETTE_CATALOG.screen, cacheBreakpoint: true },
      expect.objectContaining({ volatile: true }),
    ])
    expect(() => validateAiSystemBlocks(request.system)).not.toThrow()
    expect(request.messages[0].content).toContain('Nothing is built yet: this section holds the page’s h1.')

    const versionId = mockDocs.get(DRAFT)?.['versionId']
    expect([...commits].sort()).toEqual([DRAFT, `${DRAFT}/versions/${versionId}`].sort())
    expect(JSON.stringify(mockDocs.get('hosts/host-1'))).toBe(before)
    expect(mockDocs.get(DRAFT)).toMatchObject({ displayName: SCREEN.title, slug: 'spring-roof-inspection' })
    expect(mockDocs.get(DRAFT)).not.toHaveProperty('publishedAt')
    expect(storedPage()[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual([SECTION_IDS[0]])
    expect(mockDocs.get(`${DRAFT}/versions/${versionId}`)).toMatchObject({ screenId: 'job-1', layoutId: 'lay-site' })
    const routes = mockDocs.get('hosts/host-1')?.['screens'] as Record<string, string>
    expect(findScreenIdByRoutePath(routes, 'spring-roof-inspection')).not.toBe('job-1')
  })

  it('adds each later section to the stored version in the plan’s order, asking with references only', async () => {
    await buildSections()
    expect(storedPage()[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(SECTION_IDS)
    const last = mockRunAiRequest.mock.calls[SECTION_IDS.length - 1][0].messages[0].content as string
    expect(last).toContain(`Build section ${SECTION_IDS.length} of ${SECTION_IDS.length}`)
    expect(last).toContain('Already built, above it: 1. hero; 2. what the inspection covers; 3. customer quotes.')
    // No section's content ever rides in a later request.
    expect(last).not.toContain('Lifted, cracked or missing shingles')
    // Only the first pass created anything; the host document was never written.
    expect(commits.filter((path) => path === 'hosts/host-1')).toEqual([])
  })

  it('holds the whole page, writes its listing and reports the draft with its weight and a navigation proposal', async () => {
    await buildSections()
    mockRunAiRequest.mockReset()
    seoFields.mockResolvedValueOnce({
      status: 'ok',
      value: { title: 'Spring Roof Inspections in Springfield', description: 'A licensed roofer checks shingles, flashing and gutters.' },
      attempts: 1,
      usage: { inputTokens: 700, outputTokens: 80, cacheReadTokens: 900, cacheWriteTokens: 0 },
      effort: null,
      estCostUsd: 0.001,
      model: 'claude-haiku-4-5',
      stopReason: 'tool_use',
    })
    const withNav = { ...PLAN, screens: [{ ...SCREEN, nav: true }] }
    const outcome = await step()(context({ plan: withNav }))
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(seoFields).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: 'screen', name: SCREEN.title, path: '/spring-roof-inspection' },
        brand: 'Acme Roofing',
        fields: ['title', 'description'],
        otherTitles: FIXTURE.inventory.screens.map((row) => row.name),
        text: expect.stringContaining('Spring roof inspections in Springfield'),
      }),
    )
    expect(outcome).toMatchObject({
      estCostUsd: 0.001,
      model: 'claude-haiku-4-5',
      outputs: [
        {
          resource: 'screen',
          id: 'job-1',
          versionId: mockDocs.get(DRAFT)?.['versionId'],
          hostId: 'host-1',
          hostSubdomain: 'acme',
          label: SCREEN.title,
          load: expect.objectContaining({ pageBytes: expect.any(Number) }),
          proposal: { navigation: { label: SCREEN.title, slug: 'spring-roof-inspection' } },
        },
      ],
    })
    expect(outcome.continue).toBeUndefined()
    expect(mockDocs.get(DRAFT)?.['seo']).toEqual({
      title: 'Spring Roof Inspections in Springfield',
      description: 'A licensed roofer checks shingles, flashing and gutters.',
    })
  })

  it('writes the plan’s listing, held to the editor’s lengths, when the listing cannot be written', async () => {
    await buildSections()
    const long = { ...PLAN, screens: [{ ...SCREEN, seoTitle: 'Spring roof inspections for homes across Springfield, Riverton and Oak Hill', seoDescription: SCREEN.seoDescription }] }
    seoFields.mockResolvedValueOnce({ status: 'needs_input', violations: [], message: 'no', attempts: 2, usage: USAGE, estCostUsd: 0.002, effort: null, model: 'claude-haiku-4-5', stopReason: 'tool_use' })
    await step()(context({ plan: long }))
    const seo = mockDocs.get(DRAFT)?.['seo'] as { title: string; description: string }
    expect(seo.title.length).toBeLessThanOrEqual(SCREEN_SEO_TEXT_GUIDANCE.title)
    expect(seo.title).toBe('Spring roof inspections for homes across Springfield,')
    expect(seo.description).toBe(SCREEN.seoDescription)
  })

  it('asks for no listing when the SEO model cannot answer inside the pass, and writes the plan’s', async () => {
    await buildSections()
    const outcome = await step()(context({}, { modelFor: (kind: string) => (kind === 'job.seo' ? 'a-model-no-catalog-lists' : undefined) }))
    expect(seoFields).not.toHaveBeenCalled()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(mockDocs.get(DRAFT)?.['seo']).toEqual({ title: SCREEN.seoTitle, description: SCREEN.seoDescription })
  })

  it('gives a pass that builds a creation the time the creation’s own step needs, and a section pass a section’s (AGL-3035)', () => {
    // A creation's step keeps the ceiling it keeps as a job of its own kind,
    // and its lookup rounds, answer and re-ask at that ceiling are far past a
    // section's time: a pass that builds one starts only with its step's time.
    const creating: AiJobPlan = {
      ...PLAN,
      create: [
        { kind: 'component', name: 'Price tier', why: 'Three tiers repeat.', duplicateOf: null, fields: ['tier:text'] },
        { kind: 'layout', name: 'Site frame', why: 'The site has no layout.', duplicateOf: null, fields: [] },
        { kind: 'form', name: 'Quote request', why: 'The site has no form.', duplicateOf: null, fields: ['email'] },
      ],
    }
    const built: Record<string, AiJobOutput> = {
      layout: { resource: 'layout', id: 'job-1-c1', versionId: 'v-frame', hostId: 'host-1', label: 'Site frame' },
      form: { resource: 'form', id: 'job-1-c2', versionId: null, hostId: 'host-1', label: 'Quote request' },
      component: { resource: 'reusableComponent', id: 'job-1-c0', versionId: null, hostId: 'host-1', label: 'Price tier' },
    }
    const next = (outputs: AiJobOutput[]) => aiPageJobRunMinimumMs(job({ plan: creating, outputs }))
    expect(next([])).toBe(mockMinimums['layout'])
    expect(next([built['layout']])).toBe(mockMinimums['form'])
    expect(next([built['layout'], built['form']])).toBe(mockMinimums['component'])
    expect(next([built['layout'], built['form'], built['component']])).toBe(AI_JOB_PAGE_STEP_MINIMUM_MS)
    // A page whose plan creates nothing, and a job with no plan to build, need a section pass's.
    expect(aiPageJobRunMinimumMs(job())).toBe(AI_JOB_PAGE_STEP_MINIMUM_MS)
    expect(aiPageJobRunMinimumMs(job({ plan: { ...PLAN, status: 'proposed' } }))).toBe(AI_JOB_PAGE_STEP_MINIMUM_MS)
  })
})

describe('when a pass stops', () => {
  it('asks once more, then stops for review, when a section still breaks the page’s rules, and writes nothing', async () => {
    const noHeading = { rootId: 'root', nodes: { root: { componentId: 'div', nodes: ['s'] }, s: { componentId: 'section', props: { element: 'section' }, nodes: ['p'] }, p: { componentId: 'muiTypography', props: { variant: 'body1', children: 'No heading at all.' } } } }
    mockRunAiRequest.mockResolvedValueOnce(sectionAnswer(noHeading)).mockResolvedValueOnce(sectionAnswer(noHeading))
    const outcome = await step()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome.review).toEqual(expect.objectContaining({ reason: 'doctrine', findings: [expect.objectContaining({ rule: 11, code: 'missing-h1' })] }))
    expect(outcome.continue).toBeUndefined()
    expect(commits).toEqual([])
  })

  /**
   * A tool call cut off at its ceiling (AGL-3042): the provider stops on
   * `max_tokens`, and the input it hands over is what had arrived — a `tree`
   * cut mid-string, or nothing at all.
   */
  const cutOffAnswer = (input: Record<string, unknown>, outputTokens: number) => ({
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'submit_section', input }],
    usage: { ...USAGE, outputTokens },
    estCostUsd: 0.02,
    stopReason: 'max_tokens',
  })
  const CUT_TREE = { tree: '{"rootId":"root","nodes":{"root":{"componentId":"div","nodes":["a1"]},"a1":{"componentId":"section","props":{"elem' }
  const TOO_LARGE = 'This section was too large to build in one pass. Try again, or describe it smaller.'

  it('asks a section cut off at its ceiling for a smaller one, naming what shrinks it, and keeps the re-ask that fits (AGL-3042)', async () => {
    const ceiling = aiJobPageSectionMaxTokens('claude-sonnet-5')
    mockRunAiRequest
      .mockResolvedValueOnce(cutOffAnswer(CUT_TREE, ceiling))
      .mockResolvedValueOnce(sectionAnswer(FIXTURE.answers[0]))
    const outcome = await step()(context())
    expect(outcome).toMatchObject({ continue: true, stopReason: 'tool_use', usage: { outputTokens: ceiling + USAGE.outputTokens } })

    const [first, reask] = mockRunAiRequest.mock.calls.map(([request]) => request)
    // The re-ask is asked for the whole ceiling: the cut answer spent one of the two.
    expect([first.maxTokens, reask.maxTokens]).toEqual([ceiling, ceiling])
    const text = String(reask.messages.at(-1)?.content)
    expect(text).toBe(
      [
        'Your page-section was not used: it ran past the size one answer may have, and was cut off before it was whole.',
        aiPageSectionSmaller({ maxElements: aiJobPageSectionMaxElements(ceiling), reusableComponents: true }),
        '',
        'Answer again with submit_section: the whole page-section, smaller than the one that was cut off.',
      ].join('\n'),
    )
    expect(text).toContain('at most 15;')
    expect(text).not.toContain('could not be used as a section')
    expect(storedPage()[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual([SECTION_IDS[0]])
  })

  it('stops a section cut off on its answer and its re-ask for review as too large, not as unreadable, and writes nothing (AGL-3042)', async () => {
    const ceiling = aiJobPageSectionMaxTokens('claude-sonnet-5')
    mockRunAiRequest
      .mockResolvedValueOnce(cutOffAnswer(CUT_TREE, ceiling))
      .mockResolvedValueOnce(cutOffAnswer({}, ceiling))
    const outcome = await step()(context())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome).toMatchObject({ stopReason: 'max_tokens', usage: { outputTokens: 2 * ceiling } })
    expect(outcome.review).toEqual({
      reason: 'doctrine',
      message: TOO_LARGE,
      findings: [{ rule: null, code: 'answer-cut-off', message: TOO_LARGE }],
    })
    expect(outcome.continue).toBeUndefined()
    expect(commits).toEqual([])
  })

  it('reports a declined brief as refused, and writes nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce({ kind: 'refusal', text: '', usage: USAGE, estCostUsd: 0.001, stopReason: 'refusal' })
    expect(await step()(context())).toMatchObject({ refused: true, outputs: [] })
    expect(commits).toEqual([])
  })

  it('stops for the member, spending nothing, when the site has no screen to spare', async () => {
    mockDocs.set('orgs/org-1', {})
    for (let index = 0; index < 5; index += 1) mockDocs.set(`hosts/host-1/screens/scr-${index}`, { displayName: `Page ${index}` })
    const outcome = await step()(context())
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      outputs: [],
      usage: AI_JOB_ZERO_USAGE,
      estCostUsd: 0,
      model: 'claude-sonnet-5',
      stopReason: null,
      review: { reason: 'limit', message: 'Your plan includes 5 screens — upgrade in Billing for more', findings: [] },
    })
  })

  it('fails, spending nothing, for a plan a page job cannot build, and for a draft a member deleted', async () => {
    const creating = { ...PLAN, create: [{ kind: 'dataset' as const, name: 'Price list', why: 'No data yet.', duplicateOf: null, fields: [] }] }
    expect(await step()(context({ plan: creating }))).toMatchObject({ failure: expect.stringContaining('dataset “Price list” on the Datasets page'), usage: AI_JOB_ZERO_USAGE })

    mockRunAiRequest.mockResolvedValueOnce(sectionAnswer(FIXTURE.answers[0]))
    await step()(context())
    mockDocs.set(DRAFT, { ...mockDocs.get(DRAFT), deletedAt: NOW })
    mockRunAiRequest.mockReset()
    expect(await step()(context())).toMatchObject({ failure: AI_JOB_PAGE_DELETED_COPY, usage: AI_JOB_ZERO_USAGE })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('starts from a copy of the screen the plan names, generating nothing', async () => {
    duplicate.mockResolvedValueOnce({ ok: true, id: 'scr-copy', versionId: 'v-copy', name: 'Home copy' })
    const outcome = await step()(context({ plan: { ...PLAN, screens: [{ ...SCREEN, duplicateOf: 'scr-home' }] } }))
    expect(duplicate).toHaveBeenCalledWith('screen', expect.objectContaining({ hostId: 'host-1', sourceId: 'scr-home', uid: 'uid-1' }))
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.outputs).toEqual([
      { resource: 'screen', id: 'scr-copy', versionId: 'v-copy', hostId: 'host-1', hostSubdomain: 'acme', label: 'Home copy' },
    ])
  })
})

describe('what the plan creates comes first (AGL-3031)', () => {
  /** The plan the fixture's site needs when it has no layout, card or form yet. */
  const CREATING: AiJobPlan = {
    ...PLAN,
    reuse: PLAN.reuse.filter((entry) => entry.kind !== 'layout'),
    create: [
      { kind: 'component', name: 'Price tier', why: 'Three tiers repeat.', duplicateOf: null, fields: ['tier:text'] },
      { kind: 'layout', name: 'Site frame', why: 'The site has no layout.', duplicateOf: null, fields: [] },
      { kind: 'form', name: 'Quote request', why: 'The site has no form.', duplicateOf: null, fields: ['email'] },
    ],
    screens: [{ ...SCREEN, layout: 'new:Site frame' }],
  }
  const UNIT_OUTPUTS: Record<string, AiJobOutput> = {
    layout: { resource: 'layout', id: 'job-1-c1', versionId: 'v-frame', hostId: 'host-1', label: 'Site frame' },
    form: { resource: 'form', id: 'job-1-c2', versionId: null, hostId: 'host-1', label: 'Quote request' },
    component: { resource: 'reusableComponent', id: 'job-1-c0', versionId: null, hostId: 'host-1', label: 'Price tier' },
  }
  const spend: AiJobStepOutcome = { outputs: [], usage: USAGE, estCostUsd: 0.02, model: 'claude-sonnet-5', stopReason: 'tool_use' }

  function unitRunners(patch: Partial<Record<string, (context: AiJobStepContext) => Promise<AiJobStepOutcome>>> = {}) {
    const runners = {
      layout: jest.fn(async () => ({ ...spend, outputs: [UNIT_OUTPUTS['layout']] })),
      form: jest.fn(async () => ({ ...spend, outputs: [UNIT_OUTPUTS['form']] })),
      component: jest.fn(async () => ({ ...spend, outputs: [UNIT_OUTPUTS['component']] })),
      ...patch,
    }
    return {
      runners,
      runnerFor: (kind: string) => (runners as Record<string, unknown>)[kind] as never,
    }
  }

  it('builds the layout, then the form, then the component, one a pass, each under a job of its own kind', async () => {
    expect(aiPageJobUnits(CREATING).map((unit) => [unit.kind, unit.slot, unit.label])).toEqual([
      ['layout', 'c1', 'Site frame'],
      ['form', 'c2', 'Quote request'],
      ['component', 'c0', 'Price tier'],
    ])
    const { runners, runnerFor } = unitRunners()
    const page = createAiJobPageStep({ seoFields, duplicate, runnerFor })
    let outputs: AiJobOutput[] = []
    for (const kind of ['layout', 'form', 'component']) {
      const outcome = await page(context({ plan: CREATING, outputs }))
      expect([kind, outcome.continue, outcome.outputs]).toEqual([kind, true, [UNIT_OUTPUTS[kind]]])
      // What the creation spent is this pass's spend, and no model of the page's was asked.
      expect(outcome).toMatchObject({ usage: USAGE, estCostUsd: 0.02 })
      outputs = [...outputs, ...outcome.outputs]
    }
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    const [layoutContext] = runners.layout.mock.calls[0] as unknown as [AiJobStepContext]
    expect(layoutContext.job).toMatchObject({
      $id: 'job-1-c1',
      kind: 'layout',
      steps: [],
      outputs: [],
      plan: { status: 'confirmed', create: [CREATING.create[1]], screens: [] },
    })
    // A creation is told the plan's reuse, less what the page's sections place themselves.
    const placed = new Set(SCREEN.sections.flatMap((section) => section.uses))
    expect(layoutContext.job.plan?.reuse).toEqual(CREATING.reuse.filter((entry) => !placed.has(entry.id)))
    const [componentContext] = runners.component.mock.calls[0] as unknown as [AiJobStepContext]
    expect(componentContext.job).toMatchObject({ $id: 'job-1-c0', kind: 'component', plan: { create: [CREATING.create[0]] } })
    expect(componentContext.job.brief).toContain('Build the component “Price tier”: Three tiers repeat.')
  })

  it('then builds the page on the plan resolved to what was built: the new layout named, the new records reused', async () => {
    const { runnerFor } = unitRunners()
    // The site's inventory lists what the creations built, as the reader would.
    mockReadInventory.mockResolvedValue({
      ...FIXTURE.inventory,
      layouts: [...FIXTURE.inventory.layouts, { id: 'job-1-c1', name: 'Site frame', parentId: null }],
    })
    mockRunAiRequest.mockResolvedValueOnce(sectionAnswer(FIXTURE.answers[0]))
    const outputs = [UNIT_OUTPUTS['layout'], UNIT_OUTPUTS['form'], UNIT_OUTPUTS['component']]
    const outcome = await createAiJobPageStep({ seoFields, duplicate, runnerFor })(context({ plan: CREATING, outputs }))
    expect(outcome).toMatchObject({ continue: true, outputs: [] })
    const [request] = mockRunAiRequest.mock.calls[0]
    const prompt = String(request.messages[0].content)
    expect(prompt).toContain('- reuse the layout job-1-c1 ("Site frame")')
    expect(prompt).toContain('- reuse the component job-1-c0 ("Price tier")')
    expect(prompt).not.toContain('- create the')
    // The draft renders inside the layout the job built.
    const screen = mockDocs.get(DRAFT)
    expect(mockDocs.get(`${DRAFT}/versions/${screen?.['versionId']}`)).toMatchObject({ layoutId: 'job-1-c1' })
  })

  it('waits on a creation that stopped for a person, and fails on one that reported nothing or has no runner', async () => {
    const review = { reason: 'limit' as const, message: 'Your plan includes 1 shared layouts — upgrade in Billing for more', findings: [] }
    const stopped = unitRunners({ layout: jest.fn(async () => ({ ...spend, review })) })
    const waiting = await createAiJobPageStep({ seoFields, duplicate, runnerFor: stopped.runnerFor })(context({ plan: CREATING }))
    expect(waiting).toMatchObject({ review, outputs: [] })
    expect(waiting.continue).toBeUndefined()

    const empty = unitRunners({ layout: jest.fn(async () => spend) })
    expect(await createAiJobPageStep({ seoFields, duplicate, runnerFor: empty.runnerFor })(context({ plan: CREATING }))).toMatchObject({
      failure: AI_JOB_PAGE_CREATION_EMPTY_COPY,
      usage: USAGE,
    })

    const none = createAiJobPageStep({ seoFields, duplicate, runnerFor: () => null })
    expect(await none(context({ plan: CREATING }))).toMatchObject({
      failure: AI_JOB_PAGE_CREATION_UNAVAILABLE_COPY,
      usage: AI_JOB_ZERO_USAGE,
    })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })
})
