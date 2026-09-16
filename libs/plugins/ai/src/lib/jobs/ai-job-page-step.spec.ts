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
 *  - THE TIME BUDGET. A pass is one section, and its worst case — the answer
 *    and its re-ask, each at the pass's ceiling, at the rates the budget
 *    module assumes — fits the minimum the step registers, which fits the
 *    beat's budget and not an inline door's. A fake clock measures it on
 *    every catalog tier.
 *  - AN UNPUBLISHED SCREEN. The draft is a screen and its first version, the
 *    host document is never written, and no address resolves to the draft.
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

// The machine is not under test here — only that the step registers with it.
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findScreenIdByRoutePath } from '@aglyn/aglyn/app-utils/screen-route'
import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { AI_MODEL_CATALOG } from '../providers/catalog'
import { AI_DOCTRINE_SYSTEM_BLOCK } from '../runtime/ai-doctrine'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import type { generateSeoFields } from '../runtime/seo-fields'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import {
  AI_JOB_ASSUMED_FIRST_TOKEN_MS,
  AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND,
  AI_JOB_STEP_OVERHEAD_MS,
  aiGenerationMaxTokensWithin,
  aiJobBudgetTier,
} from './ai-job-budget'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_TOOL,
  aiPageSectionNodeId,
} from './ai-job-page-sections'
import {
  AI_JOB_PAGE_DELETED_COPY,
  AI_JOB_PAGE_SECTION_MAX_TOKENS,
  AI_JOB_PAGE_STEP_MINIMUM_MS,
  AI_JOB_PAGE_TOKENS_PER_ELEMENT,
  aiPageJobAdmission,
  createAiJobPageStep,
  runAiJobPageStep,
} from './ai-job-page-step'
import { registerAiJobStep } from './ai-jobs'
import { AI_PAGE_BRIEF_FIXTURES } from './fixtures/ai-page-briefs'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-15T22:00:00.000Z')
const FIXTURE = AI_PAGE_BRIEF_FIXTURES[0]
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const USAGE = { inputTokens: 900, outputTokens: 300, cacheReadTokens: 4_200, cacheWriteTokens: 0 }

/** A budget constant as the machine declares it, read from its source so the machine is not loaded. */
function machineConstant(name: string): number {
  const match = new RegExp(`export const ${name} = ([\\d_]+)`).exec(readFileSync(join(__dirname, 'ai-jobs.ts'), 'utf8'))
  if (!match) throw new Error(`ai-jobs.ts declares no ${name}`)
  return Number(match[1].replace(/_/g, ''))
}

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
  it('registers as the page runner with the least time a pass needs, and the admission both doors ask', async () => {
    expect(registerAiJobStep).toHaveBeenCalledWith('page', runAiJobPageStep, { minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS })
    const ask = (patch: Record<string, unknown> = {}) =>
      aiJobAdmissionRefusal('page', { firestore, orgId: 'org-1', hostId: 'host-1', inputs: {}, org: STARTER_ORG, ...patch })
    expect(await ask({ hostId: null })).toEqual({ status: 400, error: 'Open the site the page is for before starting the job' })
    expect(await ask({ inputs: { pageType: 'homepage' } })).toEqual({
      status: 400,
      error: 'pageType must be one of landing, about, pricing, contact, blogIndex, product, service, event',
    })
    expect(await ask({ inputs: { pageType: 'landing' } })).toBeNull()
    // At confirmation, a plan that creates what the site does not have is refused before anything runs.
    const creating = { ...PLAN, create: [{ kind: 'component', name: 'Service card', why: 'Three cards repeat.', duplicateOf: null, fields: [] }] }
    expect(await ask({ plan: creating })).toEqual({ status: 400, error: expect.stringContaining('component “Service card” on the Components page') })
    expect(await ask({ plan: PLAN })).toBeNull()
    expect(aiPageJobAdmission).toBeInstanceOf(Function)
  })
})

describe('the time budget: a pass fits the least time it registers, and that fits the beat', () => {
  it('registers a minimum inside the beat’s budget and past an inline door’s, so passes run on the beat', () => {
    expect(AI_JOB_PAGE_STEP_MINIMUM_MS).toBeLessThanOrEqual(machineConstant('AI_JOB_SWEEP_BUDGET_MS'))
    expect(AI_JOB_PAGE_STEP_MINIMUM_MS).toBeGreaterThan(machineConstant('AI_JOB_INLINE_BUDGET_MS'))
  })

  it.each(['fast', 'balanced', 'deep'] as const)(
    'on the %s tier, a section answered and re-asked at the pass’s ceiling finishes inside the minimum on a fake clock',
    async (tier) => {
      const model = AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string
      expect(aiJobBudgetTier(model)).toBe(tier)
      const ceiling = aiGenerationMaxTokensWithin({ budgetMs: AI_JOB_PAGE_STEP_MINIMUM_MS, model, cap: AI_JOB_PAGE_SECTION_MAX_TOKENS })
      expect(ceiling).toBeGreaterThan(0)

      // The clock charges every exchange what the budget module assumes a
      // provider takes: a start, then the answer at the full ceiling.
      let clock = 0
      const broken = { rootId: 'root', nodes: { root: { componentId: 'div', nodes: ['s'] }, s: { componentId: 'section', props: { element: 'section' }, nodes: ['p'] }, p: { componentId: 'muiTypography', props: { variant: 'body1', children: 'No heading at all.' } } } }
      mockRunAiRequest.mockImplementation(async (request: { maxTokens: number }) => {
        clock += AI_JOB_ASSUMED_FIRST_TOKEN_MS + Math.ceil((request.maxTokens / AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND[tier]) * 1_000)
        const tree = mockRunAiRequest.mock.calls.length === 1 ? broken : FIXTURE.answers[0]
        return sectionAnswer(tree, { ...USAGE, outputTokens: request.maxTokens })
      })
      const modelFor = (kind: string) => (kind === 'job.page' ? model : undefined)
      const outcome = await step()(context({}, { modelFor }))

      // The first answer broke a rule, so this pass took its re-ask too.
      expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
      for (const [request] of mockRunAiRequest.mock.calls) {
        expect(request).toMatchObject({ model, maxTokens: ceiling, thinking: 'off' })
      }
      expect(outcome).toMatchObject({ continue: true })
      expect(clock + AI_JOB_STEP_OVERHEAD_MS).toBeLessThanOrEqual(AI_JOB_PAGE_STEP_MINIMUM_MS)
      // The request asks the section to stay under what that ceiling holds.
      const prompt = mockRunAiRequest.mock.calls[0][0].messages[0].content as string
      expect(prompt).toContain(`Keep this section to at most ${Math.floor(ceiling / AI_JOB_PAGE_TOKENS_PER_ELEMENT)} elements.`)
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
    const creating = { ...PLAN, create: [{ kind: 'form' as const, name: 'Quote request', why: 'No form yet.', duplicateOf: null, fields: [] }] }
    expect(await step()(context({ plan: creating }))).toMatchObject({ failure: expect.stringContaining('form “Quote request” on the Forms page'), usage: AI_JOB_ZERO_USAGE })

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
