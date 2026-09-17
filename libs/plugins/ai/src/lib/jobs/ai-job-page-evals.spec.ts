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
 * The page job's evals (AGL-2907): the ten golden briefs in
 * `fixtures/ai-page-briefs.ts`, each replayed pass by pass through the REAL
 * page step, section check, doctrine, plan rules and draft writer. Only the
 * provider is faked, answering each section pass with its golden answer; the
 * listing generator, the inventory reader, the host index, the duplicate
 * module and the machine's registry are stubbed as in the step's own spec.
 *
 * GOLDEN, NOT RECORDED: the answers were written by hand, so these evals hold
 * the step and the rules on answers of a realistic shape and size, never a
 * model's quality. For every brief:
 *
 *  - the plan is one a page job builds, and it keeps the plan rules;
 *  - the page keeps every building rule, carries no main landmark of its own
 *    (the layout's slot is the document's one main) and no raw binding token,
 *    and stays an unpublished draft;
 *  - every section fits the answer ceiling a pass asks for on the balanced
 *    tier — in the provider's tokens, at the ratio measured live (AGL-3042) —
 *    under the element budget the step asks by;
 *  - the credits a page takes, ESTIMATED from the requests the step sent and
 *    the golden answers' sizes, match the figure the developer notes quote.
 *
 * A page that introduces two people fits its passes too (AGL-3042): the
 * section a live About page was cut off on, drawn inside the element budget,
 * and drawn roomier inside the budget the estimate alone would allow, which
 * runs past the ceiling.
 *
 * And one brief whose plan CREATES what its site lacks (AGL-3031): a layout,
 * a reusable component and a saved form, each built first through the REAL
 * layout, form and component steps on their own goldens, then the page, which
 * places what was built.
 *
 * A Free page's repeated items fit their passes written once (AGL-3053): four
 * and six practice areas with a firm's copy, each inside the ceiling written
 * once and past it written out, and every section drawn from them equal to
 * the one written out, node for node apart from ids.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

// Each step on the first catalog model of the tier the routing table gives it.
jest.mock('../providers/routing', () => {
  const catalog = jest.requireActual('../providers/catalog')
  return {
    __esModule: true,
    ...jest.requireActual('../providers/routing'),
    aiModelForStep: (kind: string) =>
      catalog.AI_MODEL_CATALOG.find(
        (entry: { tier: string }) => entry.tier === catalog.AI_STEP_TIERS[kind],
      )?.id,
  }
})

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

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiPagePlanRefusal } from '../model/ai-page-job'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { AI_MODEL_CATALOG, AI_STEP_TIERS, estimateAiBilledUsd } from '../providers/catalog'
import type { AiUsage } from '../providers/contract'
import { AI_STEP_NOMINAL_USAGE } from '../providers/model-choice'
import { validateAiBuildPlan, validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import type { generateSeoFields } from '../runtime/seo-fields'
import { aiGenerationMaxTokensWithin } from './ai-job-budget'
import { createAiJobComponentStep } from './ai-job-component-step'
import { createAiJobFormStep } from './ai-job-form-step'
import { createAiJobLayoutStep } from './ai-job-layout-step'
import { expandAiRepeatedItems } from '../runtime/ai-repeated-items'
import {
  AI_PAGE_SECTION_INLINE_LINE,
  AI_PAGE_SECTION_REPEAT_LINE,
  aiEmptyPage,
  aiPageCheckContext,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  aiPageWithSection,
  type AiPageSection,
} from './ai-job-page-sections'
import {
  AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT,
  AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED,
  AI_JOB_PAGE_SECTION_MAX_TOKENS,
  AI_JOB_PAGE_STEP_MINIMUM_MS,
  AI_JOB_PAGE_TOKENS_PER_ELEMENT,
  aiJobPageSectionMaxElements,
  aiJobPageSectionMaxTokens,
  createAiJobPageStep,
} from './ai-job-page-step'
import {
  AI_FREE_PAGE_FIXTURE,
  AI_FREE_PRACTICE_AREAS_FIXTURE,
  AI_PAGE_BRIEF_FIXTURES,
  AI_PAGE_CREATION_FIXTURE,
  AI_TWO_PERSON_PAGE_FIXTURE,
  type AiFreePageFixture,
  type AiGoldenSection,
  type AiPageBriefFixture,
} from './fixtures/ai-page-briefs'
import type { AiJobOutput } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { aiEvalMemoryInventory } from '../runtime/ai-eval-memory-firestore'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-15T22:00:00.000Z')
const HOST = 'host-1'
const STARTER_ORG = { plan: 'starter', billingStatus: 'active' }
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const modelOf = (kind: keyof typeof AI_STEP_TIERS): string =>
  AI_MODEL_CATALOG.find((entry) => entry.tier === AI_STEP_TIERS[kind])?.id as string
const PAGE_MODEL = modelOf('job.page')
const SEO_MODEL = modelOf('job.seo')
/** The listing exchange is the SEO step's own, at its nominal usage. */
const SEO_USAGE = AI_STEP_NOMINAL_USAGE['job.seo']

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

// ── The replay ───────────────────────────────────────────────────────────

interface SentRequest {
  model: string
  maxTokens: number
  system: Array<{ text: string; cacheBreakpoint?: boolean }>
  tools: unknown[]
  messages: Array<{ role: string; content: unknown }>
}

type StoredNode = { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }

interface PageReplay {
  requests: SentRequest[]
  outcome: Awaited<ReturnType<ReturnType<typeof createAiJobPageStep>>>
  screen: Record<string, unknown>
  page: Record<string, StoredNode>
  hostWrites: string[]
}

/** The names the plan step records for the inventory ids a plan references. */
function labelsOf(fixture: AiPageBriefFixture): Record<string, string> {
  const { components, forms, layouts, screens } = fixture.inventory
  return Object.fromEntries(
    [...components, ...forms, ...layouts, ...screens].map((row) => [row.id, row.name]),
  )
}

/** Every pass of one brief's page job: a section pass per golden answer, then the last pass. */
async function replay(
  fixture: AiPageBriefFixture,
  index: number,
  org: Record<string, unknown> = STARTER_ORG,
): Promise<PageReplay> {
  mockDocs.clear()
  mockOwners.clear()
  commits = []
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(fixture.inventory)
  mockOwners.set(HOST, 'org-1')
  mockDocs.set(`hosts/${HOST}`, {
    subdomain: `golden-${index + 1}`,
    displayName: fixture.id,
    screens: Object.fromEntries(fixture.inventory.screens.map((row) => [row.id, row.slug])),
  })
  mockDocs.set('orgs/org-1', org)

  const seoFields = jest.fn(async () => ({
    status: 'ok' as const,
    value: fixture.seo,
    attempts: 1,
    usage: SEO_USAGE,
    estCostUsd: estimateAiBilledUsd(SEO_USAGE, SEO_MODEL),
    model: SEO_MODEL,
    stopReason: 'tool_use',
  }))
  const step = createAiJobPageStep({ seoFields: seoFields as unknown as typeof generateSeoFields })
  const plan: AiJobPlan = {
    ...fixture.plan,
    status: 'confirmed',
    labels: labelsOf(fixture),
    proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
    confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
    confirmedBy: 'uid-1',
  }
  const job = {
    $id: `job-golden-${index + 1}`,
    orgId: 'org-1',
    hostId: HOST,
    kind: 'page',
    status: 'running',
    brief: fixture.brief,
    inputs: { pageType: fixture.pageType },
    steps: [
      { name: 'plan', status: 'done', creditsSpent: 0 },
      { name: 'generate', status: 'running', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan,
    review: null,
  } as unknown as AiJob
  const run = () => step({ job, stepIndex: 1, now: NOW, firestore })

  for (const [pass, answer] of fixture.answers.entries()) {
    mockRunAiRequest.mockResolvedValueOnce({
      kind: 'completion',
      text: '',
      toolUse: [{ name: 'submit_section', input: { tree: JSON.stringify(answer) } }],
      usage: ZERO_USAGE,
      estCostUsd: 0,
      stopReason: 'tool_use',
    })
    const outcome = await run()
    const label = `${fixture.id} pass ${pass + 1}`
    expect([label, outcome.continue, outcome.review, outcome.failure]).toEqual([label, true, undefined, undefined])
  }
  const outcome = await run()
  const screen = mockDocs.get(`hosts/${HOST}/screens/${job.$id}`) ?? {}
  const version = mockDocs.get(`hosts/${HOST}/screens/${job.$id}/versions/${screen['versionId']}`)
  return {
    requests: mockRunAiRequest.mock.calls.map(([request]) => request as SentRequest),
    outcome,
    screen,
    page: (decodeStoredNodes(version?.['nodes']) ?? {}) as Record<string, StoredNode>,
    hostWrites: commits.filter((path) => path === `hosts/${HOST}`),
  }
}

// ── The estimate ─────────────────────────────────────────────────────────

/** Four characters a token: what every figure here is estimated at. */
const tokensOf = (chars: number) => Math.ceil(chars / 4)

/** A section answer as its tool call carries it. */
const answerChars = (answer: AiGoldenSection) => JSON.stringify({ tree: JSON.stringify(answer) }).length

/**
 * An estimate as the provider's tokens, which a pass's ceiling is counted in:
 * scaled by the ratio measured live (AGL-3042).
 */
const realTokensOf = (estimated: number) => Math.ceil(estimated * AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED)

/** The elements a section answer carries: every node but the document wrapper. */
const elementsOf = (answer: AiGoldenSection) => Object.keys(answer.nodes).length - 1

/** One section pass's estimated usage: the cached prefix, what rides after it, and the answer. */
function passUsage(request: SentRequest, answer: AiGoldenSection, first: boolean): AiUsage {
  const lastBreakpoint = request.system.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
  const textOf = (blocks: SentRequest['system']) => blocks.reduce((sum, block) => sum + block.text.length, 0)
  const cached = tokensOf(textOf(request.system.slice(0, lastBreakpoint + 1)) + JSON.stringify(request.tools).length)
  const uncached =
    textOf(request.system.slice(lastBreakpoint + 1)) +
    request.messages.reduce((sum, message) => sum + String(message.content).length, 0)
  return {
    inputTokens: tokensOf(uncached),
    outputTokens: tokensOf(answerChars(answer)),
    // A page's first pass writes the cached prefix; every later pass reads it.
    cacheReadTokens: first ? 0 : cached,
    cacheWriteTokens: first ? cached : 0,
  }
}

/** A page's estimated credits: every pass metered as the machine meters a step, rounded up. */
function creditsOf(requests: readonly SentRequest[], answers: readonly AiGoldenSection[]): number {
  const sections = requests.reduce(
    (sum, request, pass) =>
      sum + assistCreditsFromUsd(estimateAiBilledUsd(passUsage(request, answers[pass], pass === 0), request.model)),
    0,
  )
  return sections + assistCreditsFromUsd(estimateAiBilledUsd(SEO_USAGE, SEO_MODEL))
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the ten golden page briefs', () => {
  const estimates = new Map<string, number>()

  it('span the three ICPs and seven page types, one brief each', () => {
    expect(AI_PAGE_BRIEF_FIXTURES).toHaveLength(10)
    expect(new Set(AI_PAGE_BRIEF_FIXTURES.map((fixture) => fixture.id)).size).toBe(10)
    const count = (icp: AiPageBriefFixture['icp']) =>
      AI_PAGE_BRIEF_FIXTURES.filter((fixture) => fixture.icp === icp).length
    expect([count('agency'), count('multi-brand'), count('small-business')]).toEqual([4, 3, 3])
    expect(new Set(AI_PAGE_BRIEF_FIXTURES.map((fixture) => fixture.pageType)).size).toBe(7)
  })

  it.each(AI_PAGE_BRIEF_FIXTURES.map((fixture, index) => ({ id: fixture.id, fixture, index })))(
    '$id: a plan a page job builds, a draft page that keeps every rule, and sections that fit a pass',
    async ({ fixture, index }) => {
      // The plan: one screen from what the site has, keeping the plan rules.
      expect(aiPagePlanRefusal(fixture.plan)).toBeNull()
      expect(validateAiBuildPlan(fixture.plan, fixture.inventory)).toEqual([])
      const [planned] = fixture.plan.screens
      expect(planned.sections).toHaveLength(fixture.answers.length)
      expect(fixture.inventory.layouts.map((row) => row.id)).toContain(planned.layout)

      const result = await replay(fixture, index)

      // One exchange a section, at the balanced tier's ceiling: no golden
      // answer needed its re-ask, and every one fits what its pass asks for,
      // in the provider's tokens the ceiling is counted in.
      expect(result.requests).toHaveLength(fixture.answers.length)
      const ceiling = aiGenerationMaxTokensWithin({
        budgetMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
        model: PAGE_MODEL,
        cap: AI_JOB_PAGE_SECTION_MAX_TOKENS,
      })
      const maxElements = aiJobPageSectionMaxElements(ceiling)
      result.requests.forEach((request, pass) => {
        const answer = fixture.answers[pass]
        const elements = elementsOf(answer)
        const tokens = tokensOf(answerChars(answer))
        const label = `${fixture.id} section ${pass + 1}`
        expect([label, request.model, request.maxTokens]).toEqual([label, PAGE_MODEL, ceiling])
        expect([
          label,
          realTokensOf(tokens) <= ceiling,
          elements <= maxElements,
          tokens / elements <= AI_JOB_PAGE_TOKENS_PER_ELEMENT,
        ]).toEqual([label, true, true, true])
        expect(String(request.messages[0].content)).toContain(`Keep this section to at most ${maxElements} elements.`)
      })

      // The draft: reported with its weight and its listing, never published.
      expect(result.outcome.review).toBeUndefined()
      expect(result.outcome.failure).toBeUndefined()
      expect(result.outcome.outputs).toEqual([
        expect.objectContaining({
          resource: 'screen',
          label: planned.title,
          load: expect.objectContaining({ totalBytes: expect.any(Number) }),
        }),
      ])
      expect(result.hostWrites).toEqual([])
      expect(result.screen).not.toHaveProperty('publishedAt')
      expect(result.screen['seo']).toEqual(fixture.seo)

      // The page, as stored: every rule, no landmark of its own, no raw token.
      const nodes = result.page
      expect(nodes[CANVAS_ROOT_ELEMENT_ID]?.nodes).toHaveLength(fixture.answers.length)
      const report = validateAiDoctrineTree(
        { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: nodes as never },
        'page',
        aiPageCheckContext(fixture.inventory),
      )
      expect([fixture.id, report.violations]).toEqual([fixture.id, []])
      const mains = Object.keys(nodes).filter(
        (id) => nodes[id].props?.['element'] === 'main' || nodes[id].props?.['component'] === 'main',
      )
      expect([fixture.id, mains]).toEqual([fixture.id, []])
      expect(JSON.stringify(nodes)).not.toContain('{{')

      estimates.set(fixture.id, creditsOf(result.requests, fixture.answers))
    },
  )

  it('estimate the credits a page takes at the figure the developer notes quote, and customer docs quote none', () => {
    expect(estimates.size).toBe(AI_PAGE_BRIEF_FIXTURES.length)
    const sorted = [...estimates.values()].sort((a, b) => a - b)
    // The higher middle value of an even count.
    const median = sorted[Math.floor(sorted.length / 2)]
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([median, notes.includes(`${median} credits per page`)]).toEqual([median, true])
    const customer = readFileSync(
      join(REPO_ROOT, 'apps/docs/docs/building-sites/screens-and-layouts/generate-a-page.md'),
      'utf8',
    )
    expect(customer).not.toMatch(/\d[\d,]*\s+credits/i)
  })
})

/**
 * A two-person introduction fits a pass on the balanced tier (AGL-3042).
 *
 * A live About page asked for its two attorneys — a photo, a name, a role and
 * a short bio each — and the section was cut off at the balanced tier's
 * ceiling on its answer and on its re-ask. The ceiling holds a Free page's
 * wall and stays; what a section is asked to keep under is what makes it fit,
 * counted in the provider's tokens the ceiling is counted in rather than in
 * the estimate.
 */
describe('a two-person introduction fits a pass on the balanced tier (AGL-3042)', () => {
  const FIXTURE = AI_TWO_PERSON_PAGE_FIXTURE
  const ceiling = aiJobPageSectionMaxTokens(PAGE_MODEL)
  const realTokensOfAnswer = (answer: AiGoldenSection) => realTokensOf(tokensOf(answerChars(answer)))

  it('builds the page in one exchange a section, the introduction inside the elements its request asks for and the tokens its ceiling holds', async () => {
    const result = await replay(FIXTURE, AI_PAGE_BRIEF_FIXTURES.length)
    expect(result.requests).toHaveLength(FIXTURE.answers.length)
    expect(result.outcome.review).toBeUndefined()
    expect(result.outcome.failure).toBeUndefined()
    const report = validateAiDoctrineTree(
      { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: result.page as never },
      'page',
      aiPageCheckContext(FIXTURE.inventory),
    )
    expect(report.violations).toEqual([])

    const maxElements = aiJobPageSectionMaxElements(ceiling)
    expect([ceiling, maxElements]).toEqual([1_050, 15])
    expect(String(result.requests[1].messages[0].content)).toContain(`Keep this section to at most ${maxElements} elements.`)
    const [, introduction] = FIXTURE.answers
    // Fifteen elements, 540 estimated tokens: 834 of the provider's.
    expect([elementsOf(introduction), realTokensOfAnswer(introduction)]).toEqual([15, 834])
    expect(elementsOf(introduction)).toBeLessThanOrEqual(maxElements)
    expect(realTokensOfAnswer(introduction)).toBeLessThanOrEqual(ceiling)
  })

  it('runs past the ceiling drawn roomier, inside the elements a budget counted in estimated tokens allows', () => {
    const screen = FIXTURE.plan.screens[0]
    const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId('job-two-person', index))
    const context = aiPageCheckContext(FIXTURE.inventory)
    const hero = aiPageSectionCheck({ page: aiEmptyPage(), sectionIds, index: 0, context, uses: screen.sections[0].uses, inventory: FIXTURE.inventory })({
      tree: JSON.stringify(FIXTURE.answers[0]),
    })
    const page = aiPageWithSection(aiEmptyPage(), hero.value as AiPageSection, sectionIds)
    // A section the page's rules keep, and not one its ceiling holds.
    const roomier = aiPageSectionCheck({ page, sectionIds, index: 1, context, uses: [], inventory: FIXTURE.inventory })({
      tree: JSON.stringify(FIXTURE.roomier),
    })
    expect([roomier.value !== null, roomier.violations]).toEqual([true, []])
    const estimatedBudget = Math.floor(ceiling / AI_JOB_PAGE_TOKENS_PER_ELEMENT)
    expect([estimatedBudget, elementsOf(FIXTURE.roomier), realTokensOfAnswer(FIXTURE.roomier)]).toEqual([23, 20, 1_114])
    expect(elementsOf(FIXTURE.roomier)).toBeLessThanOrEqual(estimatedBudget)
    expect(elementsOf(FIXTURE.roomier)).toBeGreaterThan(aiJobPageSectionMaxElements(ceiling))
    expect(realTokensOfAnswer(FIXTURE.roomier)).toBeGreaterThan(ceiling)
  })

  it.each(['fast', 'balanced', 'deep'] as const)(
    'on the %s tier, a section of the goldens’ largest elements fits its ceiling at its element budget, and not at one more',
    (tier) => {
      const model = AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string
      const tierCeiling = aiJobPageSectionMaxTokens(model)
      const budget = aiJobPageSectionMaxElements(tierCeiling)
      expect(realTokensOf(budget * AI_JOB_PAGE_TOKENS_PER_ELEMENT)).toBeLessThanOrEqual(tierCeiling)
      expect(realTokensOf((budget + 1) * AI_JOB_PAGE_TOKENS_PER_ELEMENT)).toBeGreaterThan(tierCeiling)
      // Counted in the estimate, the budget holds half as much again as the ceiling.
      expect(realTokensOf(Math.floor(tierCeiling / AI_JOB_PAGE_TOKENS_PER_ELEMENT) * AI_JOB_PAGE_TOKENS_PER_ELEMENT)).toBeGreaterThan(
        tierCeiling,
      )
    },
  )

  it('is stated in the developer notes with the figures the code computes', () => {
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    const figure = (value: number) => value.toLocaleString('en-US')
    const budgetOn = (tier: 'fast' | 'balanced' | 'deep') =>
      aiJobPageSectionMaxElements(aiJobPageSectionMaxTokens(AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string))
    const [, introduction] = FIXTURE.answers
    expect(notes).toContain(
      `\`AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT\` (${AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT} real tokens an element, ` +
        `${AI_JOB_PAGE_TOKENS_PER_ELEMENT} × ${AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED.toFixed(4)} rounded up)`,
    )
    expect(notes).toContain(
      `asks for ${budgetOn('fast')} elements on the fast tier, ${budgetOn('balanced')} on the balanced tier and ${budgetOn('deep')} on the deep tier`,
    )
    expect(notes).toContain(
      `is ${figure(tokensOf(answerChars(introduction)))} estimated tokens and ${figure(realTokensOfAnswer(introduction))} real, ` +
        `inside the ${aiJobPageSectionMaxElements(ceiling)} elements and the ${figure(ceiling)} tokens its pass asks for`,
    )
    expect(notes).toContain(
      `in ${elementsOf(FIXTURE.roomier)} elements, inside the ${Math.floor(ceiling / AI_JOB_PAGE_TOKENS_PER_ELEMENT)} an estimate-counted budget allows, ` +
        `at ${figure(realTokensOfAnswer(FIXTURE.roomier))} real tokens`,
    )
    // The budget errs dear for a section of many small elements, and the notes say by how much.
    const cards = AI_FREE_PAGE_FIXTURE.writtenOut[1]
    const perElement = Math.round(realTokensOfAnswer(cards) / elementsOf(cards))
    expect(perElement).toBeLessThan(AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT)
    expect(notes).toContain(
      `practice-area cards written out, each in its Grid item, take ${elementsOf(cards)} elements at ${figure(realTokensOfAnswer(cards))} real tokens: ` +
        `${perElement} real tokens an element, against the ${AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT} the budget counts`,
    )
  })
})

/**
 * A repeated item written once fits a Free section pass (AGL-3053).
 *
 * A live Free About page's four practice areas, drawn card by card with the
 * copy a firm writes, were cut off at the balanced tier's ceiling on their
 * answer and on their re-ask. Written once — one card, with each card's title
 * and summary listed on it — the same cards fit the pass, and six do too. The
 * section the check draws from them is the section written out, node for node
 * apart from ids, held to the same rules and stored the same.
 */
describe('a repeated item written once fits a Free section pass (AGL-3053)', () => {
  const FREE_ORG = { plan: 'free' }
  const FIXTURE = AI_FREE_PRACTICE_AREAS_FIXTURE
  const ceiling = aiJobPageSectionMaxTokens(PAGE_MODEL)
  const realTokensOfAnswer = (answer: AiGoldenSection) => realTokensOf(tokensOf(answerChars(answer)))
  /** The sections a fixture writes once, by their place in the plan. */
  const repeated = (fixture: AiFreePageFixture) =>
    fixture.answers.flatMap((answer, index) => (answer === fixture.writtenOut[index] ? [] : [index]))

  type Node = { nodes?: string[]; [key: string]: unknown }
  /** A tree as its elements in order, every field of each but its id, its parent and its children's ids. */
  const shapeOf = (nodes: Readonly<Record<string, object>>, id: string): unknown => {
    const node = nodes[id] as Node
    return {
      ...Object.fromEntries(Object.entries(node).filter(([key]) => !['$id', 'parentId', 'nodes'].includes(key))),
      nodes: (node.nodes ?? []).filter((child) => nodes[child]).map((child) => shapeOf(nodes, child)),
    }
  }

  it('builds a page of four and six practice areas, each written once and inside its pass’s ceiling', async () => {
    expect(repeated(FIXTURE)).toEqual([1, 2])
    // The copy a firm writes: every summary 20 to 35 words.
    const words = [1, 2].flatMap((index) =>
      Object.values(FIXTURE.answers[index].nodes).flatMap((node) => (node.repeat ?? []).map(([, summary]) => summary.split(/\s+/).length)),
    )
    expect([words.length, Math.min(...words) >= 20, Math.max(...words) <= 35]).toEqual([10, true, true])

    const result = await replay(FIXTURE, AI_PAGE_BRIEF_FIXTURES.length + 1, FREE_ORG)
    expect(result.requests).toHaveLength(FIXTURE.answers.length)
    expect([result.outcome.review, result.outcome.failure]).toEqual([undefined, undefined])
    // Every section is asked for the page built inline, and a section whose plan line shows items is shown how to write one once.
    result.requests.forEach((request, index) => {
      const content = String(request.messages[0].content)
      expect([index, content.includes(AI_PAGE_SECTION_INLINE_LINE), content.includes(AI_PAGE_SECTION_REPEAT_LINE)]).toEqual([
        index,
        true,
        FIXTURE.plan.screens[0].sections[index].items > 0,
      ])
    })
    const report = validateAiDoctrineTree(
      { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: result.page as never },
      'page',
      aiPageCheckContext(FIXTURE.inventory, { reusableComponents: false }),
    )
    expect(report.violations).toEqual([])
    // The page stores ten cards, and no trace of how they were written.
    expect(Object.values(result.page).filter((node) => node.componentId === 'muiCard')).toHaveLength(10)
    expect(JSON.stringify(result.page)).not.toMatch(/\{\{|"repeat"/)

    // Four cards in 10 elements and six in 10, inside the tokens the pass asks for.
    const [, families, businesses] = FIXTURE.answers
    expect([elementsOf(families), realTokensOfAnswer(families), elementsOf(businesses), realTokensOfAnswer(businesses)]).toEqual([
      10, 770, 10, 932,
    ])
    for (const answer of [families, businesses]) expect(realTokensOfAnswer(answer)).toBeLessThanOrEqual(ceiling)
  })

  it('runs past the ceiling with the same cards written out card by card, four and six alike', () => {
    const [, families, businesses] = FIXTURE.writtenOut
    expect([elementsOf(families), realTokensOfAnswer(families), elementsOf(businesses), realTokensOfAnswer(businesses)]).toEqual([
      25, 1_304, 35, 1_830,
    ])
    for (const answer of [families, businesses]) expect(realTokensOfAnswer(answer)).toBeGreaterThan(ceiling)
  })

  it('is stated in the developer notes with the figures the code computes', () => {
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    const figure = (value: number) => value.toLocaleString('en-US')
    const measure = (answer: AiGoldenSection) => [elementsOf(answer), figure(realTokensOfAnswer(answer))]
    const [aboutOnce, aboutTokens] = measure(AI_FREE_PAGE_FIXTURE.answers[1])
    const [aboutOut, aboutOutTokens] = measure(AI_FREE_PAGE_FIXTURE.writtenOut[1])
    expect(notes).toContain(
      `practice areas written once take ${aboutOnce} elements at ${aboutTokens} real tokens, where written out they take ${aboutOut} at ${aboutOutTokens}`,
    )
    const [fourOnce, fourTokens] = measure(FIXTURE.answers[1])
    const [fourOut, fourOutTokens] = measure(FIXTURE.writtenOut[1])
    const [sixOnce, sixTokens] = measure(FIXTURE.answers[2])
    const [sixOut, sixOutTokens] = measure(FIXTURE.writtenOut[2])
    expect(notes).toContain(
      `its four practice areas written once take ${fourOnce} elements at ${fourTokens} real tokens, and ${fourOut} at ${fourOutTokens} written out; ` +
        `its six take ${sixOnce} elements at ${sixTokens} real tokens, and ${sixOut} at ${sixOutTokens} written out`,
    )
  })

  it.each([AI_FREE_PAGE_FIXTURE, AI_FREE_PRACTICE_AREAS_FIXTURE].map((fixture) => [fixture.id, fixture] as const))(
    '%s: draws exactly the section written out, node for node apart from ids, held to the same rules and stored the same',
    (_id, fixture) => {
      const screen = fixture.plan.screens[0]
      const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId('job-once', index))
      const context = aiPageCheckContext(fixture.inventory, { reusableComponents: false })
      let once = aiEmptyPage()
      let full = aiEmptyPage()
      fixture.answers.forEach((answer, index) => {
        const label = `${fixture.id} section ${index + 1}`
        const written = fixture.writtenOut[index]
        if (answer !== written) {
          const drawn = expandAiRepeatedItems(answer, { inline: true, noun: 'section' })
          if (drawn.ok === false) throw new Error(`${label} was not drawn`)
          const tree = drawn.tree as { rootId: string; nodes: Record<string, object> }
          expect([label, shapeOf(tree.nodes, tree.rootId)]).toEqual([label, shapeOf(written.nodes, written.rootId)])
        }
        const check = (page: typeof once, tree: AiGoldenSection) =>
          aiPageSectionCheck({ page, sectionIds, index, context, uses: screen.sections[index].uses, inventory: fixture.inventory })({
            tree: JSON.stringify(tree),
          })
        const fromOnce = check(once, answer)
        const fromFull = check(full, written)
        expect([label, fromOnce.violations, fromFull.violations]).toEqual([label, [], []])
        once = aiPageWithSection(once, fromOnce.value as AiPageSection, sectionIds)
        full = aiPageWithSection(full, fromFull.value as AiPageSection, sectionIds)
      })
      const stored = (page: typeof once) => shapeOf(page as unknown as Record<string, object>, CANVAS_ROOT_ELEMENT_ID)
      expect(stored(once)).toEqual(stored(full))
      expect(validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: once }, 'page', context).violations).toEqual([])
    },
  )
})

describe('a golden page whose plan creates what its site lacks (AGL-3031)', () => {
  const FIXTURE = AI_PAGE_CREATION_FIXTURE
  const HOST_ID = FIXTURE.inventory.hostId
  const golden = <T,>(path: string): T => JSON.parse(readFileSync(join(__dirname, path), 'utf8')) as T
  const COMPONENT = golden<{ answer: { tree: unknown; props: unknown[] } }>(`goldens/${FIXTURE.componentGolden}.json`)
  const FORM = golden<Record<string, { answer: { tree: unknown; routing: unknown; cannotCollect: unknown } }>>(
    'fixtures/ai-job-form-goldens.json',
  )[FIXTURE.formGolden]

  /** The site's inventory as the reader would list it now: the fixture's, and every draft the job built. */
  const inventoryNow = (): AiSiteInventory => aiEvalMemoryInventory(FIXTURE.inventory, mockDocs)

  const answer = (name: string, input: unknown) => ({
    kind: 'completion',
    text: '',
    toolUse: [{ name, input }],
    usage: ZERO_USAGE,
    estCostUsd: 0,
    stopReason: 'tool_use',
  })

  it('builds the layout, the form and the component first, then a page that places them, all unpublished', async () => {
    mockDocs.clear()
    mockOwners.clear()
    commits = []
    mockOwners.set(HOST_ID, 'org-1')
    mockDocs.set(`hosts/${HOST_ID}`, {
      subdomain: 'harbor-new',
      displayName: 'Harbor Roofing',
      screens: Object.fromEntries(FIXTURE.inventory.screens.map((row) => [row.id, row.slug])),
    })
    mockDocs.set('orgs/org-1', STARTER_ORG)
    mockReadInventory.mockReset().mockImplementation(async () => inventoryNow())
    const sections = [...FIXTURE.answers]
    mockRunAiRequest.mockReset().mockImplementation(async (request: SentRequest) => {
      const tool = (request.tools[0] as { name: string }).name
      if (tool === 'submit_layout') return answer(tool, { tree: JSON.stringify(FIXTURE.layout) })
      if (tool === 'submit_form') return answer(tool, { ...FORM.answer, tree: JSON.stringify(FORM.answer.tree) })
      if (tool === 'submit_component') return answer(tool, { tree: JSON.stringify(COMPONENT.answer.tree), props: COMPONENT.answer.props })
      if (tool === 'submit_section') return answer(tool, { tree: JSON.stringify(sections.shift()) })
      throw new Error(`no golden answers ${tool}`)
    })
    const readers = { readInventory: mockReadInventory as never }
    const runners: Record<string, ReturnType<typeof createAiJobPageStep>> = {
      layout: createAiJobLayoutStep(readers),
      form: createAiJobFormStep(readers),
      component: createAiJobComponentStep(readers),
    }
    const seoFields = jest.fn(async () => ({
      status: 'ok' as const,
      value: FIXTURE.seo,
      attempts: 1,
      usage: SEO_USAGE,
      estCostUsd: estimateAiBilledUsd(SEO_USAGE, SEO_MODEL),
      model: SEO_MODEL,
      stopReason: 'tool_use',
    }))
    const step = createAiJobPageStep({
      ...readers,
      seoFields: seoFields as unknown as typeof generateSeoFields,
      runnerFor: (kind) => runners[kind] ?? null,
    })
    // The plan a page job keeps and confirms: its creations are ones it builds.
    expect(aiPagePlanRefusal(FIXTURE.plan)).toBeNull()
    expect(validateAiBuildPlan(FIXTURE.plan, FIXTURE.inventory)).toEqual([])
    const plan: AiJobPlan = {
      ...FIXTURE.plan,
      status: 'confirmed',
      labels: { 'scr-about': 'About' },
      proposedAt: NOW as unknown as AiJobPlan['proposedAt'],
      confirmedAt: NOW as unknown as AiJobPlan['confirmedAt'],
      confirmedBy: 'uid-1',
    }
    let outputs: AiJobOutput[] = []
    const passes: Array<{ continue?: boolean; outputs: AiJobOutput[] }> = []
    for (let pass = 0; pass < 12; pass += 1) {
      const outcome = await step({
        job: {
          $id: FIXTURE.jobId,
          orgId: 'org-1',
          hostId: HOST_ID,
          kind: 'page',
          status: 'running',
          brief: FIXTURE.brief,
          inputs: { pageType: FIXTURE.pageType },
          steps: [],
          outputs,
          creditsReserved: 0,
          creditsSpent: 0,
          createdBy: 'uid-1',
          createdAt: NOW,
          updatedAt: NOW,
          expiresAt: NOW,
          plan,
          review: null,
        } as unknown as AiJob,
        stepIndex: 1,
        now: NOW,
        firestore,
      })
      expect([pass, outcome.review, outcome.failure]).toEqual([pass, undefined, undefined])
      passes.push(outcome)
      outputs = [...outputs, ...outcome.outputs]
      if (!outcome.continue) break
    }

    // One pass a creation, one a section, and the last: every creation built before the page.
    expect(passes).toHaveLength(3 + FIXTURE.answers.length + 1)
    expect(outputs.map((output) => [output.resource, output.id])).toEqual([
      ['layout', `${FIXTURE.jobId}-c1`],
      ['form', `${FIXTURE.jobId}-c2`],
      ['reusableComponent', `${FIXTURE.jobId}-c0`],
      ['screen', FIXTURE.jobId],
    ])
    // What each draft asks the member to fill (AGL-3056): the card's defaults on
    // the card; on the page, the names its quotes leave in brackets, and the
    // role every card leaves to the card's default, said once for three cards.
    expect(outputs.map((output) => [output.resource, output.note ?? null])).toEqual([
      ['layout', null],
      ['form', expect.not.stringContaining('square brackets')],
      [
        'reusableComponent',
        'Before you publish, replace the facts in square brackets, which the brief did not give: [What the customer said about working with you], [Customer name] and [Role or company].',
      ],
      [
        'screen',
        'Before you publish, replace the facts in square brackets, which the brief did not give: [customer name]. The "Testimonial card" component on this page shows [Role or company] until you replace it.',
      ],
    ])
    // Each creation is the draft its own step writes, under the job's slot.
    expect(mockDocs.get(`hosts/${HOST_ID}/layouts/${FIXTURE.jobId}-c1`)).toMatchObject({ displayName: 'Harbor Roofing site' })
    expect(mockDocs.get(`hosts/${HOST_ID}/forms/${FIXTURE.jobId}-c2`)).toMatchObject({ displayName: 'Roof quote request' })
    expect(mockDocs.get(`hosts/${HOST_ID}/components/${FIXTURE.jobId}-c0`)).toMatchObject({ displayName: 'Testimonial card' })

    // The page renders inside the new layout, places the new card and binds the new form.
    const screen = mockDocs.get(`hosts/${HOST_ID}/screens/${FIXTURE.jobId}`) ?? {}
    const version = mockDocs.get(`hosts/${HOST_ID}/screens/${FIXTURE.jobId}/versions/${screen['versionId']}`)
    expect(version).toMatchObject({ layoutId: `${FIXTURE.jobId}-c1` })
    const nodes = (decodeStoredNodes(version?.['nodes']) ?? {}) as Record<string, StoredNode>
    const cards = Object.values(nodes).filter((node) => node.componentId === 'reusableInstance')
    expect(cards.map((node) => node.props?.['refId'])).toEqual([0, 1, 2].map(() => `${FIXTURE.jobId}-c0`))
    expect(Object.values(nodes).filter((node) => node.componentId === 'form').map((node) => node.props?.['formId'])).toEqual([
      `${FIXTURE.jobId}-c2`,
    ])
    const report = validateAiDoctrineTree(
      { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: nodes as never },
      'page',
      aiPageCheckContext(inventoryNow()),
    )
    expect(report.violations).toEqual([])
    // Nothing published: no host document written, no publish stamp on any draft.
    expect(commits.filter((path) => path === `hosts/${HOST_ID}`)).toEqual([])
    for (const [path, data] of mockDocs) {
      if (path.startsWith(`hosts/${HOST_ID}/`)) expect([path, data['publishedAt']]).toEqual([path, undefined])
    }
  })
})
