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
 * A Free workspace builds its first page (AGL-3030).
 *
 * The Free plan keeps no reusable components and no saved forms, and its AI
 * allowance is a 300-credit wall. A page it describes has to be buildable the
 * one way it can build — the repeated items drawn where they repeat, the form
 * carried by the page — and has to fit that wall end to end: the plan, every
 * section pass, and the listing.
 *
 * What is held here:
 *
 *  - the Free golden page (`AI_FREE_PAGE_FIXTURE`) replays through the REAL
 *    plan step and page step on a Free org: the plan is kept under the Free
 *    workspace's capabilities, every pass is kept by the page's own checks,
 *    and the draft carries its inline form and cards — while the whole
 *    doctrine, which a paid workspace keeps, refuses the same plan and page;
 *  - THE ARITHMETIC: the plan at the tokens measured live on a Free workspace,
 *    grown with the prompt as it grows now, plus every section pass at its
 *    answer ceiling, plus the listing, fits the Free taste — and so does the
 *    same page on a site with no layout yet, whose job builds the one layout
 *    the Free plan includes first (AGL-3031), at the layout generation
 *    measured live. The developer notes quote both figures. A doctrine or
 *    plan change that pushes a Free page past the wall is red here. So is a
 *    section ceiling the wall cannot hold: the ceiling it is measured at is
 *    close to the largest that holds, far short of what a roomy two-person
 *    introduction needs, which is why such a section is asked for smaller
 *    rather than given more (AGL-3042);
 *  - a recording of the Free-shaped eval brief, when a live run has left one
 *    (`AI_EVAL_LIVE=1 AI_EVAL_CASES=page-free-law-firm-about npm run
 *    eval:ai-live`), built its page and fits the wall at the credits it
 *    actually metered. A recording that stopped, answered its plan alone or
 *    ran no page pass proves nothing about the wall and is red here
 *    (AGL-3040). Recordings are never committed, so CI holds the arithmetic,
 *    and the first live recording's shape, alone.
 */

const mockRunAiRequest = jest.fn()

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

// The readers are handed in; these modules only need not reach an Admin SDK.
jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => 'org-1',
}))
jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assistCreditsFromUsd } from '@aglyn/aglyn/app-utils/assist-credits'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import { aiDoctrineSystemBlocks, aiDoctrineTreeTool } from '../runtime/ai-doctrine'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { AI_JOB_LAYOUT_INSTRUCTIONS } from './ai-job-layout-step'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, aiPlanCapabilityLines } from '../model/ai-plan-capabilities'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { AI_MODEL_CATALOG, AI_STEP_TIERS, estimateAiBilledUsd } from '../providers/catalog'
import type { AiUsage } from '../providers/contract'
import { AI_STEP_NOMINAL_USAGE } from '../providers/model-choice'
import {
  AI_FREE_PAGE_WORST_CASE_CREDITS,
  aiFreePageSectionsWithin,
  validateAiBuildPlan,
  validateAiDoctrineTree,
  type AiFreePageWorstCase,
} from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import type { AiEvalCandidate, AiEvalRecording } from '../runtime/ai-eval'
import type { generateSeoFields } from '../runtime/seo-fields'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { AI_PAGE_SECTION_INLINE_LINE, AI_PAGE_SECTION_REPEAT_LINE, aiPageCheckContext } from './ai-job-page-sections'
import { AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED, createAiJobPageStep } from './ai-job-page-step'
import { AI_JOB_PLAN_REVIEW_COPY, AI_JOB_PLAN_SCOPES, createAiJobPlanStep } from './ai-job-plan-step'
import { AI_FREE_PAGE_BUILT_PLAN, AI_FREE_PAGE_STOPPED_RECORDING } from './fixtures/ai-free-page-recording'
import { AI_FREE_PAGE_FIXTURE, AI_TWO_PERSON_PAGE_FIXTURE } from './fixtures/ai-page-briefs'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-16T13:00:00.000Z')
const FIXTURE = AI_FREE_PAGE_FIXTURE
const HOST = FIXTURE.inventory.hostId
const FREE_ORG: Partial<AglynOrgBilling> = { plan: 'free' }
/** The eval brief of the same shape, which a live run records end to end. */
const EVAL_CASE_ID = 'page-free-law-firm-about'

const modelOf = (kind: keyof typeof AI_STEP_TIERS): string =>
  AI_MODEL_CATALOG.find((entry) => entry.tier === AI_STEP_TIERS[kind])?.id as string
const PAGE_MODEL = modelOf('job.page')
const PLAN_MODEL = modelOf('job.plan')
const SEO_MODEL = modelOf('job.seo')
const LAYOUT_MODEL = modelOf('job.layout')

/** The Free workspace's capabilities on the fixture's site: its one layout already there. */
const FREE = aiPlanCapabilitiesFrom(FREE_ORG, {
  layout: FIXTURE.inventory.layouts.map((row) => ({
    id: row.id,
    kind: undefined,
    sourceType: undefined,
    deletedAt: undefined,
  })),
  template: [],
})

interface SentRequest {
  model: string
  maxTokens: number
  system: Array<{ text: string; cacheBreakpoint?: boolean; volatile?: boolean }>
  tools: unknown[]
  messages: Array<{ role: string; content: unknown }>
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

const toolAnswer = (name: string, input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name, input }],
  usage: ZERO_USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
})

function job(): AiJob {
  return {
    $id: 'job-free-page',
    orgId: 'org-1',
    hostId: HOST,
    kind: 'page',
    status: 'running',
    brief: FIXTURE.brief,
    inputs: { pageType: FIXTURE.pageType },
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
  } as unknown as AiJob
}

interface FreeReplay {
  planRequest: SentRequest
  planOutcome: Awaited<ReturnType<ReturnType<typeof createAiJobPlanStep>>>
  passRequests: SentRequest[]
  outcomes: Array<Awaited<ReturnType<ReturnType<typeof createAiJobPageStep>>>>
  page: Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>
}

/**
 * The Free job end to end: its plan, confirmed, then every pass of its page.
 * A pass given a `refused` answer answers with it first, is re-asked, and
 * answers the re-ask with the golden answer.
 */
async function replay(refused: Readonly<Record<number, unknown>> = {}): Promise<FreeReplay> {
  mockRunAiRequest.mockReset()
  const site = aiEvalMemoryFirestore({
    'orgs/org-1': FREE_ORG,
    [`hosts/${HOST}`]: {
      subdomain: 'brightwater',
      displayName: 'Brightwater Law',
      screens: Object.fromEntries(FIXTURE.inventory.screens.map((row) => [row.id, row.slug])),
    },
  })
  const readInventory = jest.fn(async () => FIXTURE.inventory)

  mockRunAiRequest.mockResolvedValueOnce(toolAnswer(AI_BUILD_PLAN_TOOL.name, FIXTURE.plan))
  const planStep = createAiJobPlanStep({
    readInventory,
    findPlansByKey: null,
    readCapabilities: async () => FREE,
    admissionRefusal: async () => null,
  })
  const planOutcome = await planStep({
    job: job(),
    stepIndex: 0,
    now: NOW,
    firestore: site.firestore,
    org: FREE_ORG,
  })
  const planRequest = mockRunAiRequest.mock.calls[0][0] as SentRequest

  const seoFields = jest.fn(async () => ({
    status: 'ok' as const,
    value: FIXTURE.seo,
    attempts: 1,
    usage: AI_STEP_NOMINAL_USAGE['job.seo'],
    estCostUsd: estimateAiBilledUsd(AI_STEP_NOMINAL_USAGE['job.seo'], SEO_MODEL),
    model: SEO_MODEL,
    stopReason: 'tool_use',
  }))
  const pageStep = createAiJobPageStep({
    readInventory,
    seoFields: seoFields as unknown as typeof generateSeoFields,
  })
  const confirmed = {
    ...job(),
    plan: {
      ...(planOutcome.plan as AiJobPlan),
      status: 'confirmed',
      confirmedAt: NOW,
      confirmedBy: 'uid-1',
    },
  } as unknown as AiJob
  const outcomes: FreeReplay['outcomes'] = []
  for (const [pass, answer] of FIXTURE.answers.entries()) {
    if (refused[pass]) mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_section', { tree: JSON.stringify(refused[pass]) }))
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_section', { tree: JSON.stringify(answer) }))
    outcomes.push(await pageStep({ job: confirmed, stepIndex: 1, now: NOW, firestore: site.firestore }))
  }
  outcomes.push(await pageStep({ job: confirmed, stepIndex: 1, now: NOW, firestore: site.firestore }))
  const screen = site.docs.get(`hosts/${HOST}/screens/${confirmed.$id}`) ?? {}
  const version = site.docs.get(`hosts/${HOST}/screens/${confirmed.$id}/versions/${String(screen['versionId'])}`)
  return {
    planRequest,
    planOutcome,
    passRequests: mockRunAiRequest.mock.calls.slice(1).map(([request]) => request as SentRequest),
    outcomes,
    page: (decodeStoredNodes(version?.['nodes']) ?? {}) as FreeReplay['page'],
  }
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a Free workspace builds its first page', () => {
  it('is told it keeps no reusable components or saved forms, and what it may still create', () => {
    expect(FREE.reusableComponents).toBe(false)
    expect(FREE.create.component).toMatchObject({ allowed: false, reason: expect.stringContaining('reusable components') })
    expect(FREE.create.form).toMatchObject({ allowed: false, reason: expect.stringContaining('saved forms') })
    // The one shared layout the Free plan includes is already the site's.
    expect(FREE.create.layout).toMatchObject({ allowed: false, left: 0 })
    expect(FREE.create.template).toMatchObject({ allowed: true, left: 10 })
  })

  it('keeps the Free plan under the Free workspace’s capabilities, which the whole doctrine refuses', async () => {
    expect(validateAiBuildPlan(FIXTURE.plan, FIXTURE.inventory, null, FREE)).toEqual([])
    // A paid workspace keeps the component and saved-form doctrine.
    expect(validateAiBuildPlan(FIXTURE.plan, FIXTURE.inventory).map((violation) => violation.code)).toEqual([
      'plan-repeated-items',
      'plan-form-not-placed',
    ])

    const { planOutcome, planRequest } = await replay()
    expect(planOutcome.review).toEqual({ reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] })
    expect(planOutcome.failure).toBeUndefined()
    // What the page job may create here, as the plan step was told it: the
    // workspace's capabilities, narrowed to what a page job builds.
    const prompt = String(planRequest.messages[0].content)
    for (const line of aiPlanCapabilityLines(aiPlanCapabilitiesForJob(FREE, AI_JOB_PLAN_SCOPES.page))) {
      expect(prompt).toContain(line)
    }
  })

  it('builds the page inline: every pass kept by the page’s own checks, the cards drawn where they repeat, the form carried with its fields', async () => {
    const { outcomes, passRequests, page } = await replay()
    expect(outcomes.slice(0, -1).map((outcome) => [outcome.continue, outcome.review, outcome.failure])).toEqual(
      FIXTURE.answers.map(() => [true, undefined, undefined]),
    )
    const last = outcomes[outcomes.length - 1]
    expect(last.review).toBeUndefined()
    expect(last.outputs).toEqual([expect.objectContaining({ resource: 'screen', label: FIXTURE.plan.screens[0].title })])
    // Every section request says the page is built inline.
    for (const request of passRequests) expect(String(request.messages[0].content)).toContain(AI_PAGE_SECTION_INLINE_LINE)

    const tree = { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page as never }
    expect(validateAiDoctrineTree(tree, 'page', aiPageCheckContext(FIXTURE.inventory, { reusableComponents: false })).violations).toEqual([])
    // The same page, held to the doctrine a paid workspace keeps, is refused for exactly that.
    expect(
      validateAiDoctrineTree(tree, 'page', aiPageCheckContext(FIXTURE.inventory)).violations.map(
        (violation) => [violation.rule, violation.code],
      ),
    ).toEqual([
      [1, 'repeated-subtree'],
      [3, 'inline-form'],
    ])

    // The form a Free site's submit route collects: no formId, a name, and a field for each answer.
    const forms = Object.values(page).filter((node) => node.componentId === 'form')
    expect(forms).toHaveLength(1)
    expect(forms[0].props).toEqual({ formName: 'Consultation request', submitLabel: 'Request a consultation' })
    const fields = (forms[0].nodes ?? []).map((id) => page[id])
    expect(fields.map((node) => [node.componentId, node.props?.['fieldName']])).toEqual([
      ['formField', 'name'],
      ['formField', 'email'],
      ['formField', 'phone'],
      ['formField', 'matter'],
    ])
    expect(Object.values(page).filter((node) => node.componentId === 'reusableInstance')).toEqual([])

    // The practice areas were answered written once (AGL-3053), and the draft holds
    // every card drawn with its own copy, with no trace of how it was written.
    const written = FIXTURE.answers[1].nodes['b5'].repeat ?? []
    expect(written).toHaveLength(4)
    const cards = Object.values(page).filter((node) => node.componentId === 'muiCard')
    expect(cards.map((card) => (page[(card.nodes ?? [])[0]].nodes ?? []).map((id) => page[id].props?.['children']))).toEqual(written)
    expect(JSON.stringify(page)).not.toMatch(/\{\{|"repeat"/)
  })

  it('plans the four practice areas as one section whose items repeat when a first answer splits them, and builds it from one item written once (AGL-3071)', async () => {
    const [hero, areas, ...rest] = FIXTURE.plan.screens[0].sections
    const titles = (FIXTURE.answers[1].nodes['b5'].repeat ?? []).map(([title]) => String(title).toLowerCase())
    expect([areas.name, areas.items, titles.length]).toEqual(['practice areas', 4, 4])
    // How a live Free plan split the brief's four practice areas: a section of one item each.
    const split = {
      ...FIXTURE.plan,
      screens: [{ ...FIXTURE.plan.screens[0], sections: [hero, ...titles.map((title) => ({ name: `practice area: ${title}`, uses: [], items: 1 })), ...rest] }],
    }
    mockRunAiRequest.mockReset()
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer(AI_BUILD_PLAN_TOOL.name, split))
      .mockResolvedValueOnce(toolAnswer(AI_BUILD_PLAN_TOOL.name, FIXTURE.plan))
    const planOutcome = await createAiJobPlanStep({
      readInventory: async () => FIXTURE.inventory,
      findPlansByKey: null,
      readCapabilities: async () => FREE,
      admissionRefusal: async () => null,
    })({ job: job(), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: FREE_ORG })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(String(mockRunAiRequest.mock.calls[1][0].messages.at(-1).content)).toContain(
      `Plan them as one section whose 4 items repeat: {"name":"practice areas","uses":[],"items":4}.`,
    )
    expect((planOutcome.plan as AiJobPlan).screens[0].sections).toEqual(FIXTURE.plan.screens[0].sections)

    // The kept plan's practice areas section is asked for its item written once, and the page draws four cards from it.
    const { passRequests, page } = await replay()
    expect(passRequests.map((request) => String(request.messages[0].content).includes(AI_PAGE_SECTION_REPEAT_LINE))).toEqual([
      false,
      true,
      false,
      false,
    ])
    expect(Object.values(page).filter((node) => node.componentId === 'muiCard')).toHaveLength(4)
  })
})

// ── The arithmetic ───────────────────────────────────────────────────────

/**
 * MEASURED, not estimated: the page plan and the layout generation of the
 * first live document run on a Free workspace (AGL-3024, part 1; test-org,
 * 2026-09-16), each beside the cached prefix the ledger in
 * `runtime/ai-prompt-cache.spec.ts` gave the same request at the time, in
 * characters over four. Real tokens run above that estimate, and the ratio
 * the two measurements give is what every estimate here is scaled by — the
 * higher of the two, so the arithmetic errs dear.
 */
const MEASURED = {
  model: 'claude-sonnet-5',
  plan: {
    usage: { inputTokens: 1_366, outputTokens: 3_954, cacheReadTokens: 4_059, cacheWriteTokens: 4_059 },
    ledgerPrefixTokens: 2_825,
  },
  layout: {
    usage: { inputTokens: 1_709, outputTokens: 2_057, cacheReadTokens: 6_649, cacheWriteTokens: 6_649 },
    ledgerPrefixTokens: 4_310,
  },
} as const

const REAL_TOKENS_PER_ESTIMATED = Math.max(
  MEASURED.plan.usage.cacheReadTokens / MEASURED.plan.ledgerPrefixTokens,
  MEASURED.layout.usage.cacheReadTokens / MEASURED.layout.ledgerPrefixTokens,
)

/** Characters as real tokens: four a token, scaled by what the live run measured. */
const realTokens = (chars: number) => Math.ceil((chars / 4) * REAL_TOKENS_PER_ESTIMATED)

const textOf = (blocks: SentRequest['system']) => blocks.reduce((sum, block) => sum + block.text.length, 0)

/** A request split where its cache is keyed: the prefix with its tools, and what rides after it. */
function spans(request: SentRequest): { cached: number; uncached: number } {
  const last = request.system.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
  return {
    cached: textOf(request.system.slice(0, last + 1)) + JSON.stringify(request.tools).length,
    uncached:
      textOf(request.system.slice(last + 1)) +
      request.messages.reduce((sum, message) => sum + String(message.content).length, 0),
  }
}

/** One exchange, metered as the machine meters a step: billed, in credits, rounded up. */
const creditsOf = (usage: AiUsage, model: string) => assistCreditsFromUsd(estimateAiBilledUsd(usage, model))

interface FreePageArithmetic {
  plan: number
  passes: number[]
  listing: number
  total: number
  /** Each exchange at its worst, as the plan rules hold a Free plan's sections to it (AGL-3070). */
  worstCase: AiFreePageWorstCase
  /** The most sections a Free page fits at every pass's answer ceiling. */
  sectionsWithin: number
  /** The one layout a Free plan includes, built first on a site with none (AGL-3031). */
  layout: number
  totalWithLayout: number
  sectionsWithinWithLayout: number
}

function arithmetic(result: FreeReplay): FreePageArithmetic {
  // The plan at what it measured live, grown with the prompt as it stands now:
  // the cached prefix by what it has grown since, the user turn by the
  // capability lines the live run had not yet been sent.
  const plan = spans(result.planRequest)
  const planPrefix = Math.max(
    Math.ceil(MEASURED.plan.usage.cacheReadTokens * (plan.cached / 4 / MEASURED.plan.ledgerPrefixTokens)),
    realTokens(plan.cached),
  )
  const planUsage: AiUsage = {
    inputTokens: Math.max(
      MEASURED.plan.usage.inputTokens +
        realTokens(aiPlanCapabilityLines(aiPlanCapabilitiesForJob(FREE, AI_JOB_PLAN_SCOPES.page)).join('\n').length),
      realTokens(plan.uncached),
    ),
    outputTokens: MEASURED.plan.usage.outputTokens,
    cacheReadTokens: planPrefix,
    cacheWriteTokens: planPrefix,
  }
  // Every section pass answered at its ceiling, the first writing the cache.
  const passes = result.passRequests.map((request, pass) => {
    const { cached, uncached } = spans(request)
    return creditsOf(
      {
        inputTokens: realTokens(uncached),
        outputTokens: request.maxTokens,
        cacheReadTokens: pass === 0 ? 0 : realTokens(cached),
        cacheWriteTokens: pass === 0 ? realTokens(cached) : 0,
      },
      request.model,
    )
  })
  const listing = creditsOf(AI_STEP_NOMINAL_USAGE['job.seo'], SEO_MODEL)
  const planCredits = creditsOf(planUsage, PLAN_MODEL)
  const total = planCredits + passes.reduce((sum, credits) => sum + credits, 0) + listing
  const later = Math.max(...passes.slice(1))
  // The layout the page job builds first on a site with none, at the layout
  // generation measured live, its cached prefix grown as the layout step's
  // request has grown since: the doctrine, its instructions, the layout
  // palette and the tools, as the ledger measures that request.
  const layoutPrefixChars =
    textOf(
      aiDoctrineSystemBlocks(FIXTURE.inventory, { instructions: AI_JOB_LAYOUT_INSTRUCTIONS, surface: 'layout' }).filter(
        (block) => !block.volatile,
      ),
    ) + JSON.stringify([aiDoctrineTreeTool('layout'), aiInventoryLookupTool()]).length
  const layoutPrefix = Math.max(
    Math.ceil(MEASURED.layout.usage.cacheReadTokens * (layoutPrefixChars / 4 / MEASURED.layout.ledgerPrefixTokens)),
    realTokens(layoutPrefixChars),
  )
  const layout = creditsOf(
    { ...MEASURED.layout.usage, cacheReadTokens: layoutPrefix, cacheWriteTokens: layoutPrefix },
    LAYOUT_MODEL,
  )
  const totalWithLayout = total + layout
  // The sections a Free page fits, by the derivation the plan rules cap a Free plan with.
  const worstCase: AiFreePageWorstCase = { plan: planCredits, layout, firstSection: passes[0], laterSection: later, listing }
  const sectionsWithin = aiFreePageSectionsWithin({ layouts: 0 }, worstCase)
  const sectionsWithinWithLayout = aiFreePageSectionsWithin({ layouts: 1 }, worstCase)
  return {
    plan: planCredits,
    passes,
    listing,
    total,
    worstCase,
    sectionsWithin,
    layout,
    totalWithLayout,
    sectionsWithinWithLayout,
  }
}

describe('one Free page fits the Free taste, end to end', () => {
  it('runs the plan and every pass on the models the routing table gives them, the plan on the one measured live', async () => {
    const result = await replay()
    expect(result.planRequest.model).toBe(PLAN_MODEL)
    expect(PLAN_MODEL).toBe(MEASURED.model)
    expect(result.passRequests.map((request) => request.model)).toEqual(FIXTURE.answers.map(() => PAGE_MODEL))
  })

  it('scales every estimate by the ratio the page step counts a section’s element budget in (AGL-3042)', () => {
    // One measurement, read the same way in both places: a section asked to
    // keep under more elements than its ceiling holds is cut off live.
    expect(AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED).toBe(REAL_TOKENS_PER_ESTIMATED)
  })

  it('holds the wall at no section ceiling large enough for a roomier two-person introduction, so the ceiling stays and the section is asked for smaller (AGL-3042)', async () => {
    const result = await replay()
    const at = (ceiling: number) =>
      arithmetic({ ...result, passRequests: result.passRequests.map((request) => ({ ...request, maxTokens: ceiling })) })
    // The room the arithmetic keeps: more of the wall left than its largest pass, which a re-asked section spends again.
    const holds = (figures: FreePageArithmetic) =>
      FREE_AI_TASTE_CREDITS_PER_MONTH - figures.totalWithLayout > Math.max(...figures.passes)
    const [first] = result.passRequests
    expect(holds(at(first.maxTokens))).toBe(true)
    let most = first.maxTokens
    while (holds(at(most + 1))) most += 1
    const past = at(most + 1)

    const { roomier } = AI_TWO_PERSON_PAGE_FIXTURE
    const roomierTokens = Math.ceil(
      Math.ceil(JSON.stringify({ tree: JSON.stringify(roomier) }).length / 4) * AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED,
    )
    expect(most).toBeLessThan(roomierTokens)

    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    const figure = (value: number) => value.toLocaleString('en-US')
    expect(notes).toContain(
      `past ${figure(most)} tokens the first section pass costs ${Math.max(...past.passes)} credits, and the Free page that builds its layout first leaves ${FREE_AI_TASTE_CREDITS_PER_MONTH - past.totalWithLayout} of the ${FREE_AI_TASTE_CREDITS_PER_MONTH}`,
    )
    expect(notes).toContain(`needs ${figure(roomierTokens)} real tokens, so no ceiling the wall holds fits it`)
  })

  it('re-asks a section refused for rule 12 within the room the wall keeps, whichever Grid shape its re-ask names (AGL-3078)', async () => {
    const figures = arithmetic(await replay())
    const most = Math.max(...figures.passes)
    expect(FREE_AI_TASTE_CREDITS_PER_MONTH - figures.totalWithLayout).toBeGreaterThan(most)
    type Nodes = Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }>
    // The practice areas written once: b5 the item, b6 their h2, b7 the row holding the item, b8 the column Stack holding both.
    const shapes: Array<[string, (nodes: Nodes) => void]> = [
      ['A Grid lays out columns only as a container', (nodes) => (nodes['b7'] = { ...nodes['b7'], props: { ariaLabel: 'Practice areas' } })],
      ['A Grid lays out rows and has no "column" direction', (nodes) => (nodes['b8'] = { ...nodes['b8'], componentId: 'muiGrid' })],
      [
        'this one sits in a Box',
        (nodes) => {
          nodes['b7'] = { ...nodes['b7'], nodes: ['b-box'] }
          nodes['b-box'] = { componentId: 'muiBox', nodes: ['b5'] }
        },
      ],
      ['is the text "True", not true', (nodes) => (nodes['b7'] = { ...nodes['b7'], props: { container: 'True', spacing: 3 } })],
    ]
    const reasked: Array<[string, boolean, boolean]> = []
    let dearest = 0
    for (const [reason, edit] of shapes) {
      const refused = structuredClone(FIXTURE.answers[1])
      edit(refused.nodes as never)
      const { passRequests, outcomes } = await replay({ 1: refused })
      // The pass is re-asked once, and its golden answer builds the page.
      const [reask, ...others] = passRequests.filter((request) => request.messages.length > 1)
      expect([others, outcomes.slice(0, -1).every((outcome) => outcome.continue === true)]).toEqual([[], true])
      // Priced as the arithmetic prices a later pass: its prefix read, its answer at the ceiling.
      const { cached, uncached } = spans(reask)
      const credits = creditsOf(
        { inputTokens: realTokens(uncached), outputTokens: reask.maxTokens, cacheReadTokens: realTokens(cached), cacheWriteTokens: 0 },
        reask.model,
      )
      reasked.push([reason, String(reask.messages.at(-1)?.content).includes(reason), credits <= most])
      dearest = Math.max(dearest, credits)
    }
    // Each re-ask says what its own shape needs, and costs no more than the pass the room is kept for.
    expect(reasked).toEqual(shapes.map(([reason]) => [reason, true, true]))
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toContain(`a section re-asked for any of them costs at most ${dearest} credits, less than the ${most} of the largest pass`)
  })

  it('fits the plan, every section at its answer ceiling and the listing inside the wall, at the figure the developer notes quote', async () => {
    const figures = arithmetic(await replay())
    expect(figures.total).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH)
    // A page that fits only by a credit or two is not a page a member can
    // count on: a re-asked section spends about one more pass.
    expect(FREE_AI_TASTE_CREDITS_PER_MONTH - figures.total).toBeGreaterThan(Math.max(...figures.passes))
    expect(figures.sectionsWithin).toBeGreaterThanOrEqual(FIXTURE.answers.length)
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([figures, notes.includes(`at most ${figures.total} credits of the ${FREE_AI_TASTE_CREDITS_PER_MONTH}`)]).toEqual([
      figures,
      true,
    ])
    expect([figures.sectionsWithin, notes.includes(`fits ${figures.sectionsWithin} sections`)]).toEqual([
      figures.sectionsWithin,
      true,
    ])
  })

  it('fits the same page on a site with no layout yet, whose job builds the one layout the Free plan includes first (AGL-3031)', async () => {
    const figures = arithmetic(await replay())
    expect(LAYOUT_MODEL).toBe(MEASURED.model)
    expect(figures.totalWithLayout).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(FREE_AI_TASTE_CREDITS_PER_MONTH - figures.totalWithLayout).toBeGreaterThan(Math.max(...figures.passes))
    expect(figures.sectionsWithinWithLayout).toBeGreaterThanOrEqual(FIXTURE.answers.length)
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([
      figures.totalWithLayout,
      notes.includes(`creates its layout first comes to at most ${figures.totalWithLayout} credits`),
      notes.includes(`fits ${figures.sectionsWithinWithLayout} sections with its layout`),
    ]).toEqual([figures.totalWithLayout, true, true])
  })

  it('fits the wall at the credits a live recording of the Free brief metered, when one has been recorded', () => {
    const dir = join(REPO_ROOT, 'tools', 'ai-eval', 'recordings', 'page')
    const recordings = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.startsWith(`${EVAL_CASE_ID}.`) && name.endsWith('.json'))
          .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as AiEvalRecording)
      : []
    for (const recording of recordings) {
      const metered = meteredCredits(recording.candidate)
      expect([recording.candidate.model, unbuiltPage(recording.candidate), metered <= FREE_AI_TASTE_CREDITS_PER_MONTH]).toEqual([
        recording.candidate.model,
        [],
        true,
      ])
    }
  })

  it('caps a Free plan’s sections from the very figures the wall is proven with, so the cap and the proof cannot drift (AGL-3070)', async () => {
    const figures = arithmetic(await replay())
    expect(figures.worstCase).toEqual(AI_FREE_PAGE_WORST_CASE_CREDITS)
    expect([aiFreePageSectionsWithin({ layouts: 0 }), aiFreePageSectionsWithin({ layouts: 1 })]).toEqual([
      figures.sectionsWithin,
      figures.sectionsWithinWithLayout,
    ])
    // Each page of a plan brings its own listing; past the wall, not even one section fits.
    expect(aiFreePageSectionsWithin({ layouts: 1, pages: 2 })).toBe(
      1 + Math.floor((FREE_AI_TASTE_CREDITS_PER_MONTH - figures.plan - figures.layout - 2 * figures.listing - figures.passes[0]) / Math.max(...figures.passes.slice(1))),
    )
    expect(aiFreePageSectionsWithin({ layouts: 5 })).toBe(0)
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toContain(
      `a Free plan asks for at most ${figures.sectionsWithin} sections, or ${figures.sectionsWithinWithLayout} when its job creates the layout first`,
    )
  })

  it('refuses the live Free plan’s eight sections beside its layout and keeps the six the wall fits, re-asked through the real plan step (AGL-3070)', async () => {
    const bare: AiSiteInventory = { ...FIXTURE.inventory, layouts: [] }
    const FREE_NO_LAYOUT = aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })
    expect([FREE_NO_LAYOUT.freeTaste, FREE_NO_LAYOUT.create.layout]).toEqual([true, { allowed: true, left: 1, reason: null }])
    const [hero, areas, work, form] = FIXTURE.plan.screens[0].sections
    const withLayout = (sections: AiBuildPlan['screens'][number]['sections']): AiBuildPlan => ({
      reuse: [],
      create: [{ kind: 'layout', name: 'Site layout', why: 'The site has no layout yet.', duplicateOf: null, fields: [] }],
      screens: [{ ...FIXTURE.plan.screens[0], layout: 'new:Site layout', sections }],
    })
    const six = withLayout([hero, { name: 'who we are', uses: [], items: 0 }, areas, work, { name: 'our values', uses: [], items: 0 }, form])
    const seven = withLayout([...six.screens[0].sections.slice(0, 5), { name: 'fees', uses: [], items: 0 }, form])
    const codes = (plan: AiBuildPlan, inventory: AiSiteInventory, capabilities: typeof FREE) =>
      validateAiBuildPlan(plan, inventory, null, capabilities).map((violation) => violation.code)
    expect(codes(six, bare, FREE_NO_LAYOUT)).toEqual([])
    expect(codes(seven, bare, FREE_NO_LAYOUT)).toEqual(['plan-over-free-wall'])
    expect(codes(AI_FREE_PAGE_BUILT_PLAN, bare, FREE_NO_LAYOUT)).toEqual(['plan-split-list', 'plan-over-free-wall'])
    // A site with its layout already fits nine, and a paid workspace is held to no wall.
    const nine = { ...FIXTURE.plan, screens: [{ ...FIXTURE.plan.screens[0], sections: [...seven.screens[0].sections.slice(0, 6), { name: 'our team', uses: [], items: 0 }, { name: 'questions', uses: [], items: 0 }, form] }] }
    const ten = { ...nine, screens: [{ ...nine.screens[0], sections: [...nine.screens[0].sections.slice(0, 8), { name: 'offices', uses: [], items: 0 }, form] }] }
    expect([codes(nine, FIXTURE.inventory, FREE), codes(ten, FIXTURE.inventory, FREE)]).toEqual([[], ['plan-over-free-wall']])
    expect(validateAiBuildPlan(AI_FREE_PAGE_BUILT_PLAN, bare, null, { ...FREE_NO_LAYOUT, freeTaste: undefined }).map((violation) => violation.code)).toEqual(['plan-split-list'])

    mockRunAiRequest.mockReset()
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer(AI_BUILD_PLAN_TOOL.name, AI_FREE_PAGE_BUILT_PLAN))
      .mockResolvedValueOnce(toolAnswer(AI_BUILD_PLAN_TOOL.name, six))
    const outcome = await createAiJobPlanStep({
      readInventory: async () => bare,
      findPlansByKey: null,
      readCapabilities: async () => FREE_NO_LAYOUT,
      admissionRefusal: async () => null,
    })({ job: job(), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: FREE_ORG })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(String(mockRunAiRequest.mock.calls[1][0].messages.at(-1).content)).toContain(
      `- This plan asks for 8 sections, and a Free page that creates its layout fits ${aiFreePageSectionsWithin({ layouts: 1 })} in the ${FREE_AI_TASTE_CREDITS_PER_MONTH} AI credits a Free workspace has a month. Plan at most ${aiFreePageSectionsWithin({ layouts: 1 })}: draw a list's repeated items in one section, and leave out a section the brief does not ask for. (at screens[0].sections)`,
    )
    expect(outcome.review).toEqual({ reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] })
    expect((outcome.plan as AiJobPlan).screens[0].sections).toHaveLength(6)
  })

  it('takes nothing about the wall from a recording that did not build its page, as the first live one did not (AGL-3040)', () => {
    const { candidate } = AI_FREE_PAGE_STOPPED_RECORDING
    // It metered its plan well inside the wall, and that proves nothing: the
    // page it was recorded to measure was never built.
    expect(meteredCredits(candidate)).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(unbuiltPage(candidate)).toEqual([candidate.note, 'answered scope plan', 'ran no job.page pass'])
    // Any one of the three is enough to prove nothing.
    const [plan] = candidate.steps ?? []
    const built: AiEvalCandidate = { ...candidate, scope: 'full', note: undefined, steps: [plan, { ...plan, step: 'job.page' }] }
    expect(unbuiltPage(built)).toEqual([])
    expect(unbuiltPage({ ...built, note: candidate.note })).toEqual([candidate.note])
    expect(unbuiltPage({ ...built, scope: 'plan' })).toEqual(['answered scope plan'])
    expect(unbuiltPage({ ...built, steps: candidate.steps })).toEqual(['ran no job.page pass'])
  })
})

/** What a recording metered, every exchange as the machine meters a step. */
function meteredCredits(candidate: AiEvalCandidate): number {
  return (candidate.steps ?? []).reduce((sum, step) => sum + step.credits, 0)
}

/**
 * Why a recording of the Free brief proves nothing about the wall (AGL-3040);
 * empty when it built its page. Only a built page measures what a page costs:
 * a recording that stopped, or answered its plan alone, or never ran a page
 * pass metered less than a page and fits any wall.
 */
function unbuiltPage(candidate: AiEvalCandidate): string[] {
  return [
    ...(candidate.note?.startsWith('stopped:') ? [candidate.note] : []),
    ...((candidate.scope ?? 'full') === 'full' ? [] : [`answered scope ${candidate.scope}`]),
    ...((candidate.steps ?? []).some((step) => step.step === 'job.page') ? [] : ['ran no job.page pass']),
  ]
}
