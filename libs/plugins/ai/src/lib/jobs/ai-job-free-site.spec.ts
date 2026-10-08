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
 * A guided start on a new site (AGL-3594).
 *
 * Every new site is born with a published starter home page at `/` (AGL-3497),
 * and on 2026-10-06 a Free workspace's first "Plan my site" was refused on it:
 * the plan put its home page at `/`, the address rule counted the starter as
 * taken, the plan step's answer and re-ask both broke it, and 227 of the
 * workspace's 300 credits went on a plan nobody could use, refused in rule
 * numbers. What is held here:
 *
 *  - THE STARTER HOME: an untouched starter is a page a plan's home replaces,
 *    by the address rule, the duplicate rule and the planner's own turn; an
 *    edited one is the owner's page, its address taken and named;
 *  - THE FREE SITE: a Free site plans one or two pages on its provider's fast
 *    tier, with no thinking, at an outline's ceiling; a plan past the cap is
 *    re-asked once and the plan that comes back is kept;
 *  - THE ARITHMETIC: that plan, its re-ask and the build of two pages at every
 *    answer's ceiling fit the Free taste with room for one retried section, at
 *    the figures `AI_FREE_SITE_WORST_CASE_CREDITS` declares and the developer
 *    notes quote — and a paid five-page plan's one answer comes to at most 90;
 *  - THE FAILURE: a plan our checks still refuse reads as one sentence and an
 *    action, draws no Free credits, and says when trying again cannot work.
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

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import { aiPlanFailureCopy, aiPlanRetryRefusal } from '../model/ai-job-failure-copy'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import type { AiPlanCapabilities } from '../model/ai-plan-capabilities'
import {
  aiHomeScreenIds,
  emptyAiSiteInventory,
  type AiInventoryScreen,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import {
  AI_FREE_SITE_WORST_CASE_CREDITS,
  AI_SITE_FREE_PAGES,
  AI_SITE_PAGES,
  AI_SITE_PLAN_MAX_TOKENS,
  aiFreeSiteCreditEstimate,
  aiFreeSiteSectionsWithin,
  aiSitePagesRefusal,
  aiSitePlanShapeRefusal,
  type AiFreeSiteWorstCase,
} from '../model/ai-site-job'
import { AI_SITE_START_ANSWERS, aiSiteStartRefusal } from '../model/ai-site-start'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { AI_MODEL_CATALOG, AI_STEP_TIERS, aiCatalogEntry, estimateAiBilledUsd } from '../providers/catalog'
import type { AiUsage } from '../providers/contract'
import {
  AI_FREE_PAGE_WORST_CASE_CREDITS,
  validateAiBuildPlan,
} from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { aiPlanSiteLines, aiSitePlanCapabilities, createAiJobPlanStep } from './ai-job-plan-step'
import { aiRunSiteLook } from './ai-job-site-look'
import { AI_SITE_LOOK_TOOL_NAME } from '../model/ai-site-look'

// The reader's pure halves, past the mock that keeps its Admin SDK out.
const { aiStarterHomeCandidate, aiStarterHomeUntouched } = jest.requireActual(
  '../runtime/site-inventory',
) as typeof import('../runtime/site-inventory')

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-10-06T23:28:00.000Z')
const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'free', ownerUid: 'owner-1' }
const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'pro' }

const STARTER: AiInventoryScreen = {
  id: 'scrStarter',
  name: 'Home',
  slug: '/',
  layoutId: 'laySite',
  template: false,
  replaceable: true,
}

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const NEW_SITE: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [STARTER],
}

/** The same site after its owner saved an edit to the starter. */
const EDITED_SITE: AiSiteInventory = {
  ...NEW_SITE,
  screens: [{ ...STARTER, replaceable: undefined }],
}

const LAYOUT_ROWS = NEW_SITE.layouts.map((row) => ({
  id: row.id,
  kind: undefined,
  sourceType: undefined,
  deletedAt: undefined,
}))
const FREE: AiPlanCapabilities = aiPlanCapabilitiesFrom(FREE_ORG, { layout: LAYOUT_ROWS, template: [] })
const PAID: AiPlanCapabilities = aiPlanCapabilitiesFrom(PAID_ORG, { layout: LAYOUT_ROWS, template: [] })

const page = (
  title: string,
  slug: string,
  sections: string[],
  seo: { title: string; description: string },
): AiBuildPlan['screens'][number] => ({
  title,
  slug,
  layout: 'laySite',
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: seo.title,
  seoDescription: seo.description,
  sections: sections.map((name) => ({ name, uses: [], items: 0 })),
})

const HOME = page('Home', '/', ['hero', 'what we groom', 'reviews'], {
  title: 'Dog grooming in your neighborhood',
  description: 'Baths, trims and nail care for dogs of every size, booked online in a minute.',
})
const BOOK = page('Book a groom', '/book', ['services and prices', 'booking times'], {
  title: 'Book a dog groom',
  description: 'Pick a service and a time, and we confirm your groom by email.',
})
const ABOUT = page('About us', '/about', ['our story'], {
  title: 'About our groomers',
  description: 'Who grooms your dog, and how we keep every visit calm.',
})

const reuseLayout: AiBuildPlan['reuse'] = [{ kind: 'layout', id: 'laySite', purpose: 'the site header and footer' }]
const TWO_PAGES: AiBuildPlan = { reuse: reuseLayout, create: [], screens: [HOME, BOOK] }
const THREE_PAGES: AiBuildPlan = { reuse: reuseLayout, create: [], screens: [HOME, BOOK, ABOUT] }

function siteJob(inputs: Record<string, unknown> = {}): AiJob {
  return {
    $id: 'job-site',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: 'A 2-page website for a neighborhood dog groomer that takes bookings.',
    inputs: { businessType: 'a neighborhood dog groomer', pages: 2, welcomeEmail: false, ...inputs },
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const toolAnswer = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_TOOL.name, input }],
  usage: ZERO_USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
})

const codes = (plan: AiBuildPlan, inventory: AiSiteInventory, capabilities: AiPlanCapabilities | null) =>
  validateAiBuildPlan(plan, inventory, null, capabilities).map((violation) => violation.code)

interface SentRequest {
  model: string
  maxTokens: number
  thinking?: string
  system: Array<{ text: string; cacheBreakpoint?: boolean; volatile?: boolean }>
  tools: unknown[]
  messages: Array<{ role: string; content: unknown }>
}

async function planStepFor(
  org: Partial<AglynOrgBilling>,
  capabilities: AiPlanCapabilities,
  job: AiJob,
  inventory: AiSiteInventory = NEW_SITE,
  seed: Record<string, Record<string, unknown>> = {},
) {
  return createAiJobPlanStep({
    readInventory: async () => inventory,
    findPlansByKey: null,
    readCapabilities: async () => capabilities,
    admissionRefusal: async () => null,
  })({ job, stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore(seed).firestore, org })
}

// ── The starter home ─────────────────────────────────────────────────────

describe('a guided start takes over the untouched starter home, and plans around an edited one', () => {
  it('reads the starter as replaceable only while the marker names it at / and its one version is the provisioned one', () => {
    const host = { defaultHomeScreenId: 'scrStarter', screens: { scrStarter: '/' } }
    const rows = [{ id: 'scrStarter', template: false }]
    expect(aiStarterHomeCandidate(host, rows)).toBe('scrStarter')
    // The owner published a home of their own: the marker is gone (AGL-3478).
    expect(aiStarterHomeCandidate({ screens: { scrStarter: '/' } }, rows)).toBeNull()
    // Something else answers `/` now.
    expect(aiStarterHomeCandidate({ ...host, screens: { scrStarter: '/old-home' } }, rows)).toBeNull()
    expect(aiStarterHomeCandidate(host, [])).toBeNull()
    expect(aiStarterHomeUntouched('v1', ['v1'])).toBe(true)
    // An edit saved in the editor is a second version, published or not.
    expect(aiStarterHomeUntouched('v1', ['v1', 'v2'])).toBe(false)
    expect(aiStarterHomeUntouched('v2', ['v1'])).toBe(false)
    expect(aiStarterHomeUntouched('', [])).toBe(false)
  })

  it('lets a plan put its home page at / over an untouched starter, without asking it to duplicate the starter', () => {
    expect(codes(TWO_PAGES, NEW_SITE, PAID)).toEqual([])
  })

  it('keeps an edited starter’s address taken, and names the address in the refusal so the re-ask can move off it', () => {
    const violations = validateAiBuildPlan(TWO_PAGES, EDITED_SITE, null, PAID)
    const taken = violations.find((violation) => violation.code === 'plan-slug-taken')
    expect(taken?.message).toBe(
      'A page reuses an address the site or the plan already uses (/). Give each page its own slug.',
    )
    expect(violations.map((violation) => violation.code)).toContain('plan-missed-duplicate')
    // Planned around it, the same pages pass.
    const around: AiBuildPlan = {
      ...TWO_PAGES,
      screens: [page('Services', '/services', ['what we groom'], { title: 'Grooming services', description: 'Baths, trims and nail care for dogs of every size.' }), BOOK],
    }
    expect(codes(around, EDITED_SITE, PAID)).toEqual([])
  })

  it('tells a site plan which pages exist and which one its home page replaces — or that the home page stays', () => {
    const replace = aiPlanSiteLines({ kind: 'site' }, NEW_SITE, null).join('\n')
    expect(replace).toContain(
      '- Home at /: the starter home page the site was created with. Plan this site\'s home page at / and it replaces this one.',
    )
    const keep = aiPlanSiteLines({ kind: 'site' }, EDITED_SITE, null).join('\n')
    expect(keep).toContain('- Home at /')
    expect(keep).toContain("The home page at / is the owner's own and stays: give every page you plan another address.")
    // A page job's turn, whose length the Free page's wall is proven at, is untouched.
    expect(aiPlanSiteLines({ kind: 'page' }, NEW_SITE, null)).toEqual([])
  })

  it('sends a link with nowhere to go to the page that replaces the starter, once the site has one', () => {
    const drafted: AiSiteInventory = {
      ...NEW_SITE,
      screens: [STARTER, { id: 'scrAiHome', name: 'Home', slug: '/', layoutId: 'laySite', template: false }],
    }
    expect(aiHomeScreenIds(drafted)).toEqual(['scrAiHome'])
    expect(aiHomeScreenIds(NEW_SITE)).toEqual(['scrStarter'])
  })
})

// ── The Free site ────────────────────────────────────────────────────────

describe('a Free workspace’s site start is one or two pages', () => {
  it('holds a Free workspace to its band at every door, and a paid one to the band it always had', () => {
    expect(AI_SITE_FREE_PAGES).toEqual({ min: 1, max: 2 })
    expect([aiSitePagesRefusal(2, true), aiSitePagesRefusal(1, true), aiSitePagesRefusal(5, false)]).toEqual([null, null, null])
    expect(aiSitePagesRefusal(3, true)).toMatch(/builds 1 or 2 pages/)
    expect(aiSitePagesRefusal(2, false)).toBe(`A site is planned with ${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max} pages.`)
    expect(aiSitePlanShapeRefusal(THREE_PAGES, { freeTaste: true })).toMatch(/Free workspace's site scaffold builds 1 to 2/)
    expect(aiSitePlanShapeRefusal(TWO_PAGES, { freeTaste: true })).toBeNull()
    expect(aiSitePlanShapeRefusal(TWO_PAGES)).toMatch(/a site scaffold builds 4 to 8/)
    const answers = { ...AI_SITE_START_ANSWERS, siteType: 'a dog groomer' }
    expect(aiSiteStartRefusal({ ...answers, pages: 2 }, { freeTaste: true })).toBeNull()
    expect(aiSiteStartRefusal({ ...answers, pages: 5 }, { freeTaste: true })).toBe('A site is planned with 1 to 2 pages.')
    expect(aiSiteStartRefusal({ ...answers, pages: 5 })).toBeNull()
  })

  it('caps the plan at the pages asked for within the band, and changes no theme', () => {
    const capped = aiSitePlanCapabilities({ kind: 'site', inputs: { pages: 1 } }, FREE)
    expect(capped?.freeSitePages).toBe(1)
    expect(aiSitePlanCapabilities({ kind: 'site', inputs: { pages: 9 } }, FREE)?.freeSitePages).toBe(2)
    expect(capped?.create['theme-change'].allowed).toBe(false)
    // A paid workspace's and a page job's capabilities pass through.
    // A paid site start plans no theme change either: its look is a unit of its own (AGL-3660).
    expect(aiSitePlanCapabilities({ kind: 'site', inputs: { pages: 5 } }, PAID)?.create['theme-change'].allowed).toBe(false)
    expect(aiSitePlanCapabilities({ kind: 'page', inputs: {} }, FREE)).toBe(FREE)
  })

  // A site start builds no component, so a paid plan draws its repeated items
  // in their sections, as a Free one does (AGL-3660): held to rule 1, every
  // paid plan in the live business eval was refused.
  it('plans a paid site start with no reusable component, as it builds none', () => {
    const paid = aiSitePlanCapabilities({ kind: 'site', inputs: { pages: 5 } }, PAID)
    expect(paid?.reusableComponents).toBe(false)
    expect(paid?.create.component.allowed).toBe(false)
    expect(aiSitePlanCapabilities({ kind: 'site', inputs: { pages: 2 } }, FREE)?.reusableComponents).toBe(false)
  })

  it('refuses a Free site plan past its page cap on the Free wall, naming the cap', () => {
    const capped = aiSitePlanCapabilities({ kind: 'site', inputs: { pages: 2 } }, FREE)
    expect(codes(THREE_PAGES, NEW_SITE, capped)).toContain('plan-over-free-wall')
    expect(codes(TWO_PAGES, NEW_SITE, capped)).toEqual([])
    const message = validateAiBuildPlan(THREE_PAGES, NEW_SITE, null, capped).find(
      (violation) => violation.code === 'plan-over-free-wall',
    )?.message
    expect(message).toBe(
      "This plan builds 3 pages, and a Free workspace's site start builds at most 2. Plan the home page and the one page the brief most needs.",
    )
  })

  it('plans on the fast tier with no thinking at the outline ceiling, re-asks a plan past the cap once with the cap named, and keeps the two pages it gets back', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(THREE_PAGES)).mockResolvedValueOnce(toolAnswer(TWO_PAGES))
    const outcome = await planStepFor(FREE_ORG, FREE, siteJob())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const [first, second] = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
    expect(aiCatalogEntry(first.model)?.tier).toBe('fast')
    expect(first.model).toBe('claude-haiku-4-5')
    expect(first.thinking).toBe('off')
    expect(first.maxTokens).toBe(AI_SITE_PLAN_MAX_TOKENS.free)
    const turn = String(first.messages[0].content)
    expect(turn).toContain('Plan this site\'s home page at / and it replaces this one.')
    expect(turn).toContain('This is a Free workspace: plan at most 2 pages — the home page at / and the one page the brief most needs, such as services, booking or contact')
    expect(turn).toContain('- theme change: no, because a site start designs its own look before its pages')
    expect(String(second.messages.at(-1)?.content)).toContain("a Free workspace's site start builds at most 2")
    expect((outcome.plan as AiJobPlan).screens.map((screen) => screen.slug)).toEqual(['/', '/book'])
    expect(outcome.uncredited).toBeUndefined()
  })

  it('leaves a paid site plan on its own model, without thinking, at the paid outline ceiling', async () => {
    mockRunAiRequest.mockReset()
    const five: AiBuildPlan = {
      ...TWO_PAGES,
      screens: [HOME, BOOK, ABOUT, page('Prices', '/prices', ['price list'], { title: 'Grooming prices', description: 'What each groom costs.' }), page('Visit', '/visit', ['opening hours'], { title: 'Contact the groomers', description: 'Ask us anything about your dog’s groom.' })],
    }
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(five))
    const outcome = await planStepFor(PAID_ORG, PAID, siteJob({ pages: 5 }))
    const [request] = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
    expect(request.model).toBe('claude-sonnet-5-5')
    expect(request.thinking).toBe('off')
    expect(request.maxTokens).toBe(AI_SITE_PLAN_MAX_TOKENS.paid)
    expect(String(request.messages[0].content)).not.toContain('Free workspace')
    expect((outcome.plan as AiJobPlan).screens).toHaveLength(5)
  })
})

// ── The arithmetic ───────────────────────────────────────────────────────

/**
 * MEASURED, not estimated: the failed Free site plan of 2026-10-06 (org
 * IuH0x_G1kT, job f0UzIs7Lcl) on claude-sonnet-5 — 2,201 input tokens, 4,343
 * written to the cache and 4,343 read from it, 13,491 output; 227 credits. Its
 * input is the floor for a plan's request now; its output, almost all of it
 * thinking, is what the outline ceiling replaces.
 */
const MEASURED_SITE_PLAN = {
  model: 'claude-sonnet-5',
  usage: { inputTokens: 2_201, outputTokens: 13_491, cacheReadTokens: 4_343, cacheWriteTokens: 4_343 },
  credits: 227,
} as const

/** Real tokens per four characters, as the Free page's proof measured them (`ai-job-free-page.spec.ts`). */
const REAL_TOKENS_PER_ESTIMATED = Math.max(4_059 / 2_825, 6_649 / 4_310)
const realTokens = (chars: number) => Math.ceil((chars / 4) * REAL_TOKENS_PER_ESTIMATED)
const textOf = (blocks: SentRequest['system']) => blocks.reduce((sum, block) => sum + block.text.length, 0)

function spans(request: SentRequest): { cached: number; uncached: number } {
  const last = request.system.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
  return {
    cached: textOf(request.system.slice(0, last + 1)) + JSON.stringify(request.tools).length,
    uncached:
      textOf(request.system.slice(last + 1)) +
      request.messages.reduce((sum, message) => sum + String(message.content).length, 0),
  }
}

const usd = (usage: AiUsage, model: string) => estimateAiBilledUsd(usage, model)

/**
 * A plan's requests at their worst: each answered at its ceiling, the first
 * writing the cached prefix and every later one paying for it as plain input
 * — the fast tier caches only past 4,096 tokens, so its read discount is not
 * counted on — each never under what the measured plan sent.
 */
function planCredits(requests: SentRequest[]): number {
  const total = requests.reduce((sum, request, index) => {
    const { cached, uncached } = spans(request)
    const prefix = Math.max(realTokens(cached), MEASURED_SITE_PLAN.usage.cacheWriteTokens)
    const input = Math.max(realTokens(uncached), MEASURED_SITE_PLAN.usage.inputTokens)
    return (
      sum +
      usd(
        {
          inputTokens: input + (index === 0 ? 0 : prefix),
          outputTokens: request.maxTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: index === 0 ? prefix : 0,
        },
        request.model,
      )
    )
  }, 0)
  return assistCreditsFromUsd(total)
}

/**
 * The look's one request at its worst (AGL-3660): its answer at its ceiling,
 * writing its cached prefix. It is never re-asked — an answer it cannot use
 * leaves the kind and the seed to choose — so one exchange is all it spends.
 */
async function lookCredits(): Promise<number> {
  mockRunAiRequest.mockReset()
  mockRunAiRequest.mockResolvedValueOnce({ ...toolAnswer({}), toolUse: [{ name: AI_SITE_LOOK_TOOL_NAME, input: {} }] })
  const job = { ...siteJob(), kind: 'theme', inputs: { ...siteJob().inputs, originJobId: 'job-site' } } as AiJob
  await aiRunSiteLook(
    { job, stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: FREE_ORG },
    job,
    { save: async () => ({ write: 'applied', baseName: 'Minimal' }) },
  )
  const [request] = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
  const { cached, uncached } = spans(request)
  const derived = assistCreditsFromUsd(
    usd(
      { inputTokens: realTokens(uncached), outputTokens: request.maxTokens, cacheReadTokens: 0, cacheWriteTokens: realTokens(cached) },
      request.model,
    ),
  )
  // Never under what a real look spent: the live eval's look that wrote the
  // cache came to 7 credits on 2026-10-07; the rest read it, at 4.
  return Math.max(derived, MEASURED_SITE_LOOK_CREDITS)
}

/** The dearest look the live eval measured (AGL-3660). */
const MEASURED_SITE_LOOK_CREDITS = 7

async function freeSiteRequests(): Promise<SentRequest[]> {
  mockRunAiRequest.mockReset()
  mockRunAiRequest.mockResolvedValueOnce(toolAnswer(THREE_PAGES)).mockResolvedValueOnce(toolAnswer(TWO_PAGES))
  await planStepFor(FREE_ORG, FREE, siteJob())
  return mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
}

describe('a Free two-page site fits the Free taste, end to end', () => {
  it('measures the plan that failed at what its usage bills, so the floor it sets is the real one', () => {
    expect(assistCreditsFromUsd(usd(MEASURED_SITE_PLAN.usage, MEASURED_SITE_PLAN.model))).toBe(MEASURED_SITE_PLAN.credits)
  })

  it('derives the Free site plan’s worst case — its answer and its re-ask at the outline ceiling — at the figure the wall declares', async () => {
    const requests = await freeSiteRequests()
    expect(requests).toHaveLength(2)
    const plan = planCredits(requests)
    const derived: AiFreeSiteWorstCase = { ...AI_FREE_PAGE_WORST_CASE_CREDITS, plan, look: await lookCredits() }
    expect(derived).toEqual(AI_FREE_SITE_WORST_CASE_CREDITS)
    // The build's exchanges are the Free page's, which its own proof holds.
    expect({
      layout: AI_FREE_SITE_WORST_CASE_CREDITS.layout,
      firstSection: AI_FREE_SITE_WORST_CASE_CREDITS.firstSection,
      laterSection: AI_FREE_SITE_WORST_CASE_CREDITS.laterSection,
      listing: AI_FREE_SITE_WORST_CASE_CREDITS.listing,
    }).toEqual({
      layout: AI_FREE_PAGE_WORST_CASE_CREDITS.layout,
      firstSection: AI_FREE_PAGE_WORST_CASE_CREDITS.firstSection,
      laterSection: AI_FREE_PAGE_WORST_CASE_CREDITS.laterSection,
      listing: AI_FREE_PAGE_WORST_CASE_CREDITS.listing,
    })
  })

  it('fits the plan, two pages’ listings and every section the cap allows inside the wall, with room for one retried section, at the figures the notes quote', () => {
    const credits = AI_FREE_SITE_WORST_CASE_CREDITS
    const pages = AI_SITE_FREE_PAGES.max
    for (const layouts of [0, 1]) {
      const sections = aiFreeSiteSectionsWithin({ layouts, pages }, FREE_AI_TASTE_CREDITS_PER_MONTH)
      const total =
        credits.plan +
        credits.look +
        layouts * credits.layout +
        pages * (credits.listing + credits.firstSection) +
        (sections - pages) * credits.laterSection
      expect(total).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH - credits.firstSection)
      // A plan the cap admits has a section a page to build.
      expect(sections).toBeGreaterThanOrEqual(pages * 2)
    }
    const sections = aiFreeSiteSectionsWithin({ layouts: 0, pages }, FREE_AI_TASTE_CREDITS_PER_MONTH)
    const total =
      credits.plan +
      credits.look +
      pages * (credits.listing + credits.firstSection) +
      (sections - pages) * credits.laterSection
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([credits.plan, notes.includes(`a Free site's plan comes to at most ${credits.plan} credits`)]).toEqual([credits.plan, true])
    expect([sections, total, notes.includes(`fits ${sections} sections across its two pages, at most ${total} credits`)]).toEqual([
      sections,
      total,
      true,
    ])
  })

  it('quotes the dialog an estimate from the same figures, inside the wall', () => {
    const credits = AI_FREE_SITE_WORST_CASE_CREDITS
    expect(aiFreeSiteCreditEstimate(2)).toBe(credits.plan + credits.look + 2 * (credits.listing + credits.firstSection) + 2 * 2 * credits.laterSection)
    expect(aiFreeSiteCreditEstimate(2)).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(aiFreeSiteCreditEstimate(1)).toBeLessThan(aiFreeSiteCreditEstimate(2))
  })

  it('brings a paid five-page plan’s one answer to at most 90 credits, from the 227 the failed plan spent', async () => {
    mockRunAiRequest.mockReset()
    // Only the first request's size matters here: what it sends and its ceiling.
    mockRunAiRequest.mockResolvedValue(toolAnswer(TWO_PAGES))
    await planStepFor(PAID_ORG, PAID, siteJob({ pages: 5 }))
    const [request] = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
    const credits = planCredits([request])
    expect(credits).toBeLessThanOrEqual(90)
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([credits, notes.includes(`a site plan's one answer comes to at most ${credits} credits`)]).toEqual([credits, true])
  })
})

// ── The failure ──────────────────────────────────────────────────────────

describe('a plan our checks still refuse', () => {
  it('reads as one plain sentence and one action, never a rule number', () => {
    expect(aiPlanFailureCopy({ kind: 'site', codes: ['plan-over-free-wall', 'plan-slug-taken'], refunded: true })).toBe(
      "We couldn't fit this plan into your Free AI credits, and it did not use any of your AI credits. Try fewer pages, or upgrade for more.",
    )
    expect(aiPlanFailureCopy({ kind: 'site', codes: ['plan-slug-taken'], refunded: true })).toBe(
      'Something went wrong planning your site, and it did not use any of your AI credits. Try again.',
    )
    expect(aiPlanFailureCopy({ kind: 'site', codes: ['plan-slug-taken'], refunded: false })).toBe(
      'Something went wrong planning your site. Try again.',
    )
  })

  it('says when trying again cannot work: the Free allowance left is under a plan’s worst case', () => {
    expect(aiPlanRetryRefusal({ creditsLeft: 73, planCredits: 40 })).toBeNull()
    expect(aiPlanRetryRefusal({ creditsLeft: 12, planCredits: 40 })).toBe(
      'You have 12 AI credits left this month, and a plan needs up to 40. Your credits refresh next month, or upgrade for more.',
    )
  })

  it('on the Free taste: stops with the sentence, keeps the rules for staff, asks for its credits back, and disables Try again when the allowance cannot cover a plan', async () => {
    const edited: AiBuildPlan = { ...TWO_PAGES, screens: [HOME, { ...BOOK, slug: '/' }] }
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(edited)).mockResolvedValueOnce(toolAnswer(edited))
    const spent = 290 * 0.001
    const outcome = await planStepFor(FREE_ORG, FREE, siteJob(), NEW_SITE, {
      'users/owner-1/aiUsage/2026-10': { estCostUsd: spent },
    })
    expect(outcome.plan).toBeUndefined()
    expect(outcome.uncredited).toBe(true)
    expect(outcome.review).toMatchObject({
      reason: 'doctrine',
      // Whether the credits came back is the job's to say (refundedCredits), not this sentence.
      message: 'Something went wrong planning your site. Try again.',
      detail: expect.stringContaining('Rule 10'),
      retryRefusal: `You have 10 AI credits left this month, and a plan needs up to ${AI_FREE_SITE_WORST_CASE_CREDITS.plan}. Your credits refresh next month, or upgrade for more.`,
    })
    expect(outcome.review?.message).not.toMatch(/Rule|rule/)
    // With the allowance a new workspace has, Try again stays on.
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(edited)).mockResolvedValueOnce(toolAnswer(edited))
    const fresh = await planStepFor(FREE_ORG, FREE, siteJob())
    expect(fresh.review?.retryRefusal).toBeUndefined()
  })
})

// Each catalog id this suite names is one the catalog still carries.
it('names models the catalog carries', () => {
  expect(AI_MODEL_CATALOG.map((entry) => entry.id)).toEqual(expect.arrayContaining(['claude-haiku-4-5', 'claude-sonnet-5']))
  expect(AI_STEP_TIERS['job.plan']).toBe('balanced')
})
