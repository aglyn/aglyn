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
 *    tier, under the element measure the step asks by;
 *  - the credits a page takes, ESTIMATED from the requests the step sent and
 *    the golden answers' sizes, match the figure the developer notes quote.
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

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiPagePlanRefusal } from '../model/ai-page-job'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { AI_MODEL_CATALOG, AI_STEP_TIERS, estimateAiCostUsd } from '../providers/catalog'
import type { AiUsage } from '../providers/contract'
import { AI_STEP_NOMINAL_USAGE } from '../providers/model-choice'
import { validateAiBuildPlan, validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import type { generateSeoFields } from '../runtime/seo-fields'
import { aiGenerationMaxTokensWithin } from './ai-job-budget'
import { aiPageCheckContext } from './ai-job-page-sections'
import {
  AI_JOB_PAGE_SECTION_MAX_TOKENS,
  AI_JOB_PAGE_STEP_MINIMUM_MS,
  AI_JOB_PAGE_TOKENS_PER_ELEMENT,
  createAiJobPageStep,
} from './ai-job-page-step'
import {
  AI_PAGE_BRIEF_FIXTURES,
  type AiGoldenSection,
  type AiPageBriefFixture,
} from './fixtures/ai-page-briefs'

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
async function replay(fixture: AiPageBriefFixture, index: number): Promise<PageReplay> {
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
  mockDocs.set('orgs/org-1', STARTER_ORG)

  const seoFields = jest.fn(async () => ({
    status: 'ok' as const,
    value: fixture.seo,
    attempts: 1,
    usage: SEO_USAGE,
    estCostUsd: estimateAiCostUsd(SEO_USAGE, SEO_MODEL),
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
      sum + assistCreditsFromUsd(estimateAiCostUsd(passUsage(request, answers[pass], pass === 0), request.model)),
    0,
  )
  return sections + assistCreditsFromUsd(estimateAiCostUsd(SEO_USAGE, SEO_MODEL))
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
      // answer needed its re-ask, and every one fits what its pass asks for.
      expect(result.requests).toHaveLength(fixture.answers.length)
      const ceiling = aiGenerationMaxTokensWithin({
        budgetMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
        model: PAGE_MODEL,
        cap: AI_JOB_PAGE_SECTION_MAX_TOKENS,
      })
      const maxElements = Math.floor(ceiling / AI_JOB_PAGE_TOKENS_PER_ELEMENT)
      result.requests.forEach((request, pass) => {
        const answer = fixture.answers[pass]
        const elements = Object.keys(answer.nodes).length - 1
        const tokens = tokensOf(answerChars(answer))
        const label = `${fixture.id} section ${pass + 1}`
        expect([label, request.model, request.maxTokens]).toEqual([label, PAGE_MODEL, ceiling])
        expect([
          label,
          tokens <= ceiling,
          elements <= maxElements,
          tokens / elements <= AI_JOB_PAGE_TOKENS_PER_ELEMENT,
        ]).toEqual([label, true, true, true])
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
 * The accessibility audit is a RECORDED fixture, not a run: rendering ten
 * pages through the component bundles takes minutes, so
 * `tools/scripts/record-ai-page-axe.mts` renders and audits them offline and
 * writes what it found. These hold the recording to the goldens it claims —
 * a changed golden answer changes its fingerprint, and a stale recording is
 * a failure here rather than a quiet, meaningless pass.
 */
describe('the recorded accessibility audit of the golden pages', () => {
  const recorded = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/ai-page-axe.generated.json'), 'utf8'),
  ) as {
    axeVersion: string
    rulesOff: string[]
    pages: Array<{
      id: string
      answers: string
      markupChars: number
      violations: Array<{ id: string; impact: string | null; help: string; nodes: number }>
    }>
  }

  /** The fingerprint the recorder writes, computed the same way it computes it. */
  const fingerprint = (fixture: AiPageBriefFixture): string =>
    createHash('sha256').update(JSON.stringify(fixture.answers)).digest('hex').slice(0, 16)

  it('covers every golden brief, and was recorded from the answers they hold now', () => {
    expect(recorded.pages.map((page) => page.id)).toEqual(
      AI_PAGE_BRIEF_FIXTURES.map((fixture) => fixture.id),
    )
    const stale = AI_PAGE_BRIEF_FIXTURES.filter(
      (fixture, index) => recorded.pages[index]?.answers !== fingerprint(fixture),
    ).map((fixture) => fixture.id)
    // Re-record with: node tools/scripts/record-ai-page-axe.mts
    expect(stale).toEqual([])
    expect(recorded.pages.every((page) => page.markupChars > 0)).toBe(true)
  })

  it('finds no serious or critical violation on any golden page', () => {
    const serious = recorded.pages.flatMap((page) =>
      page.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => `${page.id}: ${violation.id}`),
    )
    expect(serious).toEqual([])
  })

  it('names in the developer notes what it measured and what it could not', () => {
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toContain(`axe-core ${recorded.axeVersion}`)
    // A rule the recorder turned off is a gap the notes own, not a silence.
    for (const rule of recorded.rulesOff) expect(notes).toContain(rule)
    // Lighthouse's accessibility category is axe underneath, but no Lighthouse
    // run happens here and the notes must not imply one.
    expect(notes).not.toMatch(/lighthouse/i)
  })
})
