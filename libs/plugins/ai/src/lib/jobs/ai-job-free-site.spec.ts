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
 *  - THE ARITHMETIC: that plan and its re-ask at their ceilings, and the
 *    language build of an empty site — its layout, its form, two pages of one
 *    answer each and eight sections — fit the Free taste with room for one
 *    retried page (AGL-3660), at
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
  AI_FREE_SITE_MAX_SECTIONS,
  AI_SITE_FREE_PAGES,
  AI_SITE_HOME_MIN_SECTIONS,
  AI_SITE_MAX_SECTIONS,
  aiFreeSiteWorstCaseCredits,
  AI_SITE_PAGES,
  AI_SITE_PLAN_MAX_TOKENS,
  AI_SITE_THIN_HOME_CODE,
  aiFreeSiteCreditEstimate,
  aiFreeSiteSectionsWithin,
  aiSiteFullPlanSentence,
  AI_SITE_EMPTY_GALLERY_CODE,
  AI_SITE_GALLERY_SENTENCE,
  aiSiteEmptyGalleryViolations,
  aiSiteSectionShowsWork,
  aiSiteHomeMinSections,
  aiSiteThinHomeViolations,
  aiSitePagesRefusal,
  aiSitePlanShapeRefusal,
  type AiFreeSiteWorstCase,
} from '../model/ai-site-job'
import { AI_SITE_START_ANSWERS, aiSiteStartRefusal } from '../model/ai-site-start'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { AI_MODEL_CATALOG, AI_STEP_TIERS, aiCatalogEntry, estimateAiBilledUsd } from '../providers/catalog'
import type { AiUsage } from '../providers/contract'
import { validateAiBuildPlan } from '../runtime/ai-doctrine-validators'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-generation-bounds'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import {
  AI_SITE_STORE_PAGES_SENTENCE,
  aiPlanSiteLines,
  aiSitePlanCapabilities,
  aiSitePlanHomeRule,
  aiSiteEmptyGalleryCheck,
  createAiJobPlanStep,
} from './ai-job-plan-step'
import { aiRunSiteLook } from './ai-job-site-look'
import { AI_SITE_LOOK_TOOL_NAME } from '../model/ai-site-look'
import { generateAiBlogPost } from '../runtime/ai-blog-post-generation'
import { AI_BLOG_POST_TOOL_NAME } from '../tools/ai-blog-post-tool'
import { aiSiteContentPart } from './ai-job-site-content'
import { AI_YOGA_SITE_PLAN_FIRST_ANSWER, AI_YOGA_SITE_PLAN_REDO_ANSWER } from './fixtures/ai-yoga-site-plan-recording'
import { AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER } from './fixtures/ai-slow-roads-site-plan-recording'
import { AI_SITE_BLOG_PAGE_CODE, aiSiteBlogSlug, aiSiteBlogStandInViolations } from '../model/ai-site-job'
import { aiDoctrineScopeFor, aiDoctrineSystemBlocks } from '../runtime/ai-doctrine'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { AI_LAYOUT_FRAME_TOOL, AI_LAYOUT_PAGE_TOOL } from '../layout-language/ai-layout-language'
import { aiModelForStep } from '../providers/routing'
import { AI_STEP_NOMINAL_USAGE } from '../providers/model-choice'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import {
  AI_JOB_PAGE_LANGUAGE_BUDGET,
  AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS,
  AI_LAYOUT_PAGE_KIND,
  AI_LAYOUT_PAGE_THINKING_TOKENS,
  AI_LAYOUT_SECTION_MOST_TOKENS,
  aiLayoutMissingSectionsPrompt,
  aiLayoutPagePrompt,
  aiLayoutPageTargets,
} from './ai-job-page-language'
import {
  AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS,
  AI_LAYOUT_FRAME_KIND,
  aiLayoutFramePrompt,
  aiLayoutFrameTargets,
  aiLayoutNavPages,
  aiLayoutSiteName,
} from './ai-job-layout-language'

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

const HOME = page('Home', '/', ['hero', 'what we groom', 'why owners trust us', 'reviews', 'book a groom'], {
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

// ── A full home ──────────────────────────────────────────────────────────

/**
 * The shape of the thin plan the local Free yoga start of 2026-10-07 built
 * (AGL-3660): a home of two sections beside a classes page. Written by hand
 * from what that run showed — the plan itself was not kept — so the step's
 * re-ask is proven offline, with no model.
 */
const YOGA_SEO = {
  title: 'Yoga classes in your neighborhood',
  description: 'Gentle, vinyasa and restorative yoga for every level, booked online.',
}
const YOGA_THIN_HOME = page('Home', '/', ['hero', 'book a class'], YOGA_SEO)
const YOGA_FULL_HOME = page(
  'Home',
  '/',
  ['hero', 'classes we teach', 'why practice with us', 'what students say', 'book your first class'],
  YOGA_SEO,
)
const YOGA_CLASSES = page('Classes', '/classes', ['class schedule', 'book a class'], {
  title: 'Yoga class schedule',
  description: 'Every class this week, its level and its teacher, with a booking form.',
})
const YOGA_THIN: AiBuildPlan = { reuse: reuseLayout, create: [], screens: [YOGA_THIN_HOME, YOGA_CLASSES] }
const YOGA_FULL: AiBuildPlan = { reuse: reuseLayout, create: [], screens: [YOGA_FULL_HOME, YOGA_CLASSES] }
const yogaJob = () => siteJob({ businessType: 'a yoga studio' })

describe('a site start’s home page reads as a full website (AGL-3660)', () => {
  it('holds a home to five sections, or to none where the Free wall cannot pay for five beside the other page', () => {
    expect(AI_SITE_HOME_MIN_SECTIONS).toBe(5)
    expect(aiSiteHomeMinSections({ pages: 5, across: null })).toBe(5)
    // A site that keeps its layout: the wall fits 8 across two pages.
    expect(aiSiteHomeMinSections({ pages: 2, across: 8 })).toBe(5)
    expect(aiSiteHomeMinSections({ pages: 2, across: 6 })).toBe(5)
    // A guided start's empty site plans its layout, and the wall fits 4: no
    // minimum, never a lowered one — the live yoga start of 2026-10-08 was
    // told "at least 3" there and was refused for the wall twice.
    expect(aiSiteHomeMinSections({ pages: 2, across: 4 })).toBe(0)
    expect(aiSiteHomeMinSections({ pages: 1, across: 9 })).toBe(5)
    expect(aiSiteHomeMinSections({ pages: 2, across: 0 })).toBe(0)
  })

  it('reads the home rule from the same wall figure the Free sentence quotes', () => {
    const free = aiSitePlanCapabilities(yogaJob(), FREE) as AiPlanCapabilities
    const across = aiFreeSiteSectionsWithin({ layouts: 0, pages: 2, forms: 1 }, FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(aiSitePlanHomeRule(NEW_SITE, free)).toEqual({ min: 5, across })
    // An empty site builds its layout first, and the language wall still fits a full home (AGL-3660).
    const bare = { ...NEW_SITE, layouts: [] }
    const acrossBare = aiFreeSiteSectionsWithin({ layouts: 1, pages: 2, forms: 1 }, FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(aiSitePlanHomeRule(bare, free)).toEqual({ min: 5, across: acrossBare })
    expect(acrossBare).toBe(AI_FREE_SITE_MAX_SECTIONS)
    const paid = aiSitePlanCapabilities(siteJob({ pages: 5 }), PAID)
    expect(aiSitePlanHomeRule(NEW_SITE, paid)).toEqual({ min: 5, across: null })
  })

  it('a full home fits the Free wall beside the other page, so the minimum never forces a wall refusal', () => {
    const free = aiSitePlanCapabilities(yogaJob(), FREE) as AiPlanCapabilities
    expect(codes(YOGA_FULL, NEW_SITE, free)).not.toContain('plan-over-free-wall')
  })

  it('tells a new site’s plan its home is at least five sections — a hero first and a closing call to action — and says nothing where the owner’s home stays', () => {
    const free = aiSitePlanCapabilities(yogaJob(), FREE) as AiPlanCapabilities
    const lines = aiPlanSiteLines(yogaJob(), NEW_SITE, free).join('\n')
    expect(lines).toContain('The home page at / reads as a full website: at least 5 sections — a hero first')
    expect(lines).toContain('a closing call to action or contact band last')
    const paid = aiPlanSiteLines(siteJob({ pages: 5 }), NEW_SITE, aiSitePlanCapabilities(siteJob({ pages: 5 }), PAID)).join('\n')
    expect(paid).toContain('at least 5 sections')
    expect(aiPlanSiteLines(yogaJob(), EDITED_SITE, free).join('\n')).not.toContain('reads as a full website')
  })

  it('asks an EMPTY Free site — a guided start’s, which builds its layout first — for the full home, and re-asks a thin one', async () => {
    const empty = emptyAiSiteInventory('host-1')
    const freeEmpty = aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })
    const free = aiSitePlanCapabilities(yogaJob(), freeEmpty) as AiPlanCapabilities
    const lines = aiPlanSiteLines(yogaJob(), empty, free).join('\n')
    expect(lines).toContain(`and ${AI_FREE_SITE_MAX_SECTIONS} sections across them`)
    expect(lines).toContain('reads as a full website: at least 5 sections')
    mockRunAiRequest.mockReset()
    const onEmpty = (screens: AiBuildPlan['screens']): AiBuildPlan => ({
      reuse: [],
      create: [{ kind: 'layout', name: 'Main layout', why: 'the site has none', duplicateOf: null, fields: ['header', 'navigation', 'footer'] }],
      screens: screens.map((screen) => ({ ...screen, layout: 'new:Main layout' })),
    })
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer(onEmpty([YOGA_THIN_HOME, YOGA_CLASSES])))
      .mockResolvedValueOnce(toolAnswer(onEmpty([YOGA_FULL_HOME, YOGA_CLASSES])))
    const outcome = await planStepFor(FREE_ORG, freeEmpty, yogaJob(), empty)
    const sent = mockRunAiRequest.mock.calls.map((call) => String((call[0] as SentRequest).messages.at(-1)?.content))
    expect(sent[1]).toContain('The home page has 2 sections')
    expect([outcome.review?.findings, (outcome.plan as AiJobPlan | undefined)?.screens[0].sections.length]).toEqual([[], 5])
  })

  describe('a section that shows the work counts its pieces (AGL-3660)', () => {
    // The live Juniper Clay start planned "Works Gallery" with no items, and
    // the Portfolio page showed an inquiry form instead of the work.
    const juniper = (items: number): AiBuildPlan => ({
      reuse: reuseLayout,
      create: [],
      screens: [
        YOGA_FULL_HOME,
        page('Portfolio', '/portfolio', ['Portfolio Hero', 'Works Gallery'], {
          title: 'Portfolio',
          description: 'Selected stoneware.',
        }),
      ].map((screen, index) =>
        index === 1 ? { ...screen, sections: [screen.sections[0], { ...screen.sections[1], items }] } : screen,
      ),
    })

    it('reads which sections show the work, and not an audience of galleries or how a studio works', () => {
      for (const name of ['Works Gallery', 'Featured Works Grid', 'Portfolio', 'The collection', 'Selected work', 'Recent projects']) {
        expect([name, aiSiteSectionShowsWork(name)]).toEqual([name, true])
      }
      for (const name of ['Why Galleries Choose Us', 'How we work', 'Hero', 'Portfolio Hero', 'Exhibitions', 'About Studio']) {
        expect([name, aiSiteSectionShowsWork(name)]).toEqual([name, false])
      }
    })

    it('re-asks a plan whose gallery has fewer than three pieces, and keeps one of three to six', () => {
      const [violation] = aiSiteEmptyGalleryViolations(juniper(0))
      expect(violation?.code).toBe(AI_SITE_EMPTY_GALLERY_CODE)
      expect(violation?.message).toContain('"Works Gallery" on Portfolio shows the work with fewer than 3 pieces')
      expect(violation?.paths).toEqual(['screens[1].sections[1].items'])
      expect(aiSiteEmptyGalleryViolations(juniper(4))).toEqual([])
    })

    it('tells a site plan so, and asks only the first answer again', () => {
      const free = aiSitePlanCapabilities(yogaJob(), FREE) as AiPlanCapabilities
      expect(aiPlanSiteLines(yogaJob(), NEW_SITE, free).join('\n')).toContain(AI_SITE_GALLERY_SENTENCE)
      const check = aiSiteEmptyGalleryCheck()
      expect(check(juniper(0)).map((entry) => entry.code)).toEqual([AI_SITE_EMPTY_GALLERY_CODE])
      expect(check(juniper(0))).toEqual([])
    })
  })

  describe('the sections are a budget to use, never a ceiling to stay under (AGL-3660)', () => {
    // A prod start of 2026-10-08 planned a home of two sections under "at
    // most 8"; Zach: "that didn't mean do as little as possible."
    it('shares the Free wall out as a full website: a home of 5 to 6, the other page 2 to 3, about 7 to 8 in all', () => {
      expect(aiSiteFullPlanSentence({ pages: 2, across: 8, min: 5 })).toBe(
        'The 8 sections are the budget to use, not a ceiling to stay under: plan a full website, never a minimal one: the home page at / with 5 to 6 sections, the other page 2 to 3, about 7 to 8 in total.',
      )
      const empty = emptyAiSiteInventory('host-1')
      const free = aiSitePlanCapabilities(yogaJob(), aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })) as AiPlanCapabilities
      const lines = aiPlanSiteLines(yogaJob(), empty, free).join('\n')
      expect(lines).toContain('are the budget to use, not a ceiling to stay under')
      expect(lines).toContain('the home page at / with 5 to 6 sections, the other page 2 to 3, about 7 to 8 in total')
      expect(lines).not.toContain('at most 8 sections')
    })

    it('asks a paid start for a rich home, never a minimal one', () => {
      const paid = aiPlanSiteLines(siteJob({ pages: 5 }), NEW_SITE, aiSitePlanCapabilities(siteJob({ pages: 5 }), PAID)).join('\n')
      expect(paid).toContain('Plan a full website, never a minimal one: a rich home page of 6 or more sections')
      expect(aiSiteFullPlanSentence({ pages: 5, across: null, min: 0 })).not.toContain('home page')
    })

    it('names no home share where the owner’s home stays or the wall cannot pay for a full one', () => {
      expect(aiSiteFullPlanSentence({ pages: 2, across: 4, min: 0 })).toBe(
        'The 4 sections are the budget to use, not a ceiling to stay under: plan a full website, never a minimal one.',
      )
      expect(aiPlanSiteLines(yogaJob(), EDITED_SITE, aiSitePlanCapabilities(yogaJob(), FREE) as AiPlanCapabilities).join('\n')).not.toContain(
        'the home page at / with',
      )
    })

    it('the wall’s redo asks for the budget, not as few as fit', () => {
      const empty = emptyAiSiteInventory('host-1')
      const free = aiSitePlanCapabilities(yogaJob(), aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })) as AiPlanCapabilities
      const [violation] = validateAiBuildPlan(AI_YOGA_SITE_PLAN_FIRST_ANSWER, empty, null, free).filter(
        (entry) => entry.code === 'plan-over-free-wall',
      )
      expect(violation?.message).toContain(
        `Plan ${AI_FREE_SITE_MAX_SECTIONS - 1} to ${AI_FREE_SITE_MAX_SECTIONS}: the ${AI_FREE_SITE_MAX_SECTIONS} are the budget to use, not a ceiling to stay under.`,
      )
      expect(violation?.message).not.toContain('Plan at most')
    })
  })

  describe('the recorded yoga redo (2026-10-08): told only "plan at most 8", it cut a home of 6 to 4', () => {
    const empty = emptyAiSiteInventory('host-1')
    const freeEmpty = () =>
      aiSitePlanCapabilities(yogaJob(), aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })) as AiPlanCapabilities
    const wall = (plan: AiBuildPlan) =>
      validateAiBuildPlan(plan, empty, null, freeEmpty()).filter((violation) => violation.code === 'plan-over-free-wall')
    /** The redo as it should come back: the home keeps five, Classes gives up one. */
    const fivePlusThree: AiBuildPlan = {
      ...AI_YOGA_SITE_PLAN_REDO_ANSWER,
      screens: [
        {
          ...AI_YOGA_SITE_PLAN_REDO_ANSWER.screens[0],
          sections: [
            ...AI_YOGA_SITE_PLAN_REDO_ANSWER.screens[0].sections.slice(0, 3),
            { name: 'Student Stories', uses: [], items: 0 },
            AI_YOGA_SITE_PLAN_REDO_ANSWER.screens[0].sections[3],
          ],
        },
        {
          ...AI_YOGA_SITE_PLAN_FIRST_ANSWER.screens[1],
          // Classes Hero dropped: Class Schedule, Class Descriptions, Get Started.
          sections: AI_YOGA_SITE_PLAN_FIRST_ANSWER.screens[1].sections.slice(1),
        },
      ],
    }

    it('refuses the first answer — 6 + 4 — on the wall, and the redo names the home’s five and where the rest come from', () => {
      const [violation] = wall(AI_YOGA_SITE_PLAN_FIRST_ANSWER)
      expect(violation?.message).toContain('This plan asks for 10 sections')
      expect(violation?.message).toContain('Keep the home page at / at 5 or more sections, and take the rest from the other page.')
      expect(fivePlusThree.screens.map((screen) => screen.sections.length)).toEqual([5, 3])
      expect(wall(fivePlusThree)).toEqual([])
    })

    it('keeps the home’s five through the plan step: 6 + 4, then 5 + 3', async () => {
      mockRunAiRequest.mockReset()
      mockRunAiRequest.mockResolvedValueOnce(toolAnswer(AI_YOGA_SITE_PLAN_FIRST_ANSWER)).mockResolvedValueOnce(toolAnswer(fivePlusThree))
      const outcome = await planStepFor(FREE_ORG, freeEmpty(), yogaJob(), empty)
      const sent = mockRunAiRequest.mock.calls.map((call) => String((call[0] as SentRequest).messages.at(-1)?.content))
      expect(sent).toHaveLength(2)
      expect(sent[1]).toContain('Keep the home page at / at 5 or more sections')
      expect((outcome.plan as AiJobPlan).screens.map((screen) => screen.sections.length)).toEqual([5, 3])
    })

    it('keeps the recorded 4 + 2 redo rather than stopping the start: it is the loop’s last answer, and a third ask is past the plan’s two', async () => {
      mockRunAiRequest.mockReset()
      mockRunAiRequest
        .mockResolvedValueOnce(toolAnswer(AI_YOGA_SITE_PLAN_FIRST_ANSWER))
        .mockResolvedValueOnce(toolAnswer(AI_YOGA_SITE_PLAN_REDO_ANSWER))
        .mockResolvedValueOnce(toolAnswer(fivePlusThree))
      const outcome = await planStepFor(FREE_ORG, freeEmpty(), yogaJob(), empty)
      expect(mockRunAiRequest).toHaveBeenCalledTimes(AI_GENERATION_MAX_ATTEMPTS)
      expect(outcome.uncredited).toBeUndefined()
      expect((outcome.plan as AiJobPlan).screens.map((screen) => screen.sections.length)).toEqual([4, 2])
    })
  })

  it('names a thin home, and no home where the plan builds none at /', () => {
    expect(aiSiteThinHomeViolations(YOGA_THIN, { min: 5, across: 8 })).toEqual([
      expect.objectContaining({
        code: AI_SITE_THIN_HOME_CODE,
        paths: ['screens[0].sections'],
        message: expect.stringMatching(/^The home page has 2 sections, .* at least 5: a hero first.*Keep the whole plan within 8 sections/),
      }),
    ])
    expect(aiSiteThinHomeViolations(YOGA_FULL, { min: 5, across: 8 })).toEqual([])
    expect(aiSiteThinHomeViolations({ screens: [YOGA_CLASSES] }, { min: 5, across: 8 })).toEqual([])
    expect(aiSiteThinHomeViolations(YOGA_THIN, { min: 5, across: null })[0].message).not.toContain('Keep the whole plan')
  })

  it('re-asks a Free plan whose home is thin once, on the fast tier at the same ceiling, and keeps the full home it gets back', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(YOGA_THIN)).mockResolvedValueOnce(toolAnswer(YOGA_FULL))
    const outcome = await planStepFor(FREE_ORG, FREE, yogaJob())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const [first, second] = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
    expect([first.model, second.model]).toEqual(['claude-haiku-4-5', 'claude-haiku-4-5'])
    expect([first.maxTokens, second.maxTokens]).toEqual([AI_SITE_PLAN_MAX_TOKENS.free, AI_SITE_PLAN_MAX_TOKENS.free])
    expect(String(second.messages.at(-1)?.content)).toContain('The home page has 2 sections')
    const plan = outcome.plan as AiJobPlan
    expect(plan.screens[0].sections.map((section) => section.name)).toEqual(YOGA_FULL_HOME.sections.map((section) => section.name))
    expect(outcome.uncredited).toBeUndefined()
  })

  it('keeps a second answer whose home is still thin rather than stopping the start', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(YOGA_THIN)).mockResolvedValueOnce(toolAnswer(YOGA_THIN))
    const outcome = await planStepFor(FREE_ORG, FREE, yogaJob())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect((outcome.plan as AiJobPlan).screens[0].sections).toHaveLength(2)
    expect(outcome.uncredited).toBeUndefined()
  })

  it('asks nothing again of a first answer whose home is already full', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(YOGA_FULL))
    const outcome = await planStepFor(FREE_ORG, FREE, yogaJob())
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect((outcome.plan as AiJobPlan).screens[0].sections).toHaveLength(5)
  })

  it('holds a paid start’s home to the same five, with no wall to share them out of', async () => {
    mockRunAiRequest.mockReset()
    const thin: AiBuildPlan = { ...TWO_PAGES, screens: [YOGA_THIN_HOME, BOOK, ABOUT, YOGA_CLASSES] }
    const full: AiBuildPlan = { ...TWO_PAGES, screens: [YOGA_FULL_HOME, BOOK, ABOUT, YOGA_CLASSES] }
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(thin)).mockResolvedValueOnce(toolAnswer(full))
    const outcome = await planStepFor(PAID_ORG, PAID, siteJob({ pages: 4 }))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const [, second] = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
    const reask = String(second.messages.at(-1)?.content)
    expect(reask).toContain('The home page has 2 sections')
    expect(reask).not.toContain('Keep the whole plan within')
    expect((outcome.plan as AiJobPlan).screens[0].sections).toHaveLength(5)
  })
})

describe('a paid blog start plans no page that stands in for its blog (AGL-3660)', () => {
  const empty = emptyAiSiteInventory('host-1')
  const paidEmpty = aiPlanCapabilitiesFrom(PAID_ORG, { layout: [], template: [] })
  const blogJob = (org: 'paid' | 'free' = 'paid') =>
    siteJob({
      businessType: 'Slow Roads, a personal travel blog about long train journeys through Europe, written by one person',
      businessName: 'Slow Roads',
      siteKind: 'blog',
      pages: org === 'paid' ? 4 : 2,
    })
  /**
   * The recorded plan as its redo should come back: the Articles page traded
   * for a Routes page (a paid start builds four to eight), and the home's
   * closing band linking the contact page, as the live redo wrote it.
   */
  const [recordedHome, , ...recordedRest] = AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER.screens
  const withoutArticles: AiBuildPlan = {
    ...AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER,
    screens: [
      {
        ...recordedHome,
        sections: recordedHome.sections.map((section, index) =>
          index === recordedHome.sections.length - 1 ? { ...section, name: 'Closing call to action linking to the contact page' } : section,
        ),
      },
      {
        ...recordedRest[0],
        title: 'Routes',
        slug: '/routes',
        seoTitle: 'Routes | Slow Roads',
        seoDescription: 'The long train routes through Europe that Slow Roads rides, and what each one is like.',
        sections: [
          { name: 'Routes introduction', uses: [], items: 0 },
          { name: 'Route cards', uses: [], items: 4 },
        ],
      },
      ...recordedRest,
    ],
  }

  it('names the recorded Articles page as standing in for the blog, and nothing in a plan without it', () => {
    expect(aiSiteBlogStandInViolations(AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER)).toEqual([
      expect.objectContaining({
        code: AI_SITE_BLOG_PAGE_CODE,
        paths: ['screens[1]'],
        message: expect.stringContaining('"Articles" at /articles stands in for the blog'),
      }),
    ])
    expect(aiSiteBlogStandInViolations(withoutArticles)).toEqual([])
    // By name or by address; the home page never does.
    const journal = { ...withoutArticles.screens[1], title: 'Journal', slug: '/notes' }
    const atPosts = { ...withoutArticles.screens[1], title: 'Reading', slug: '/posts/2026' }
    expect(aiSiteBlogStandInViolations({ screens: [journal, atPosts] })[0].paths).toEqual(['screens[0]', 'screens[1]'])
    expect(aiSiteBlogStandInViolations({ screens: [{ ...withoutArticles.screens[0], title: 'Home: a travel blog' }] })).toEqual([])
    // The blog answers at /blog beside the plan without it, and at the next free address beside one with a page there.
    expect(aiSiteBlogSlug(withoutArticles.screens)).toBe('blog')
    expect(aiSiteBlogSlug([...withoutArticles.screens, { ...journal, slug: '/blog' }])).toBe('posts')
  })

  it('tells a paid blog start’s plan the blog is written and linked, and tells a Free one — which writes no posts — nothing', () => {
    const paidLines = aiPlanSiteLines(blogJob(), empty, aiSitePlanCapabilities(blogJob(), paidEmpty)).join('\n')
    expect(paidLines).toContain("This site's blog is written for it with its first posts at /blog, and the header links it.")
    const free = aiSitePlanCapabilities(blogJob('free'), aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] }))
    expect(aiPlanSiteLines(blogJob('free'), empty, free).join('\n')).not.toContain('first posts at /blog')
    expect(aiPlanSiteLines(siteJob({ pages: 4 }), empty, aiSitePlanCapabilities(siteJob({ pages: 4 }), paidEmpty)).join('\n')).not.toContain('first posts at /blog')
  })

  it('tells a paid store start’s plan the platform adds its account, cart and policy pages beside its own, and a Free one nothing (AGL-3676)', () => {
    const storeJob = (org: 'paid' | 'free') => siteJob({ businessType: 'Ember & Oak, hand-poured candles', siteKind: 'store', pages: org === 'paid' ? 6 : 2 })
    const paid = aiPlanSiteLines(storeJob('paid'), empty, aiSitePlanCapabilities(storeJob('paid'), paidEmpty))
    expect(paid).toContain(AI_SITE_STORE_PAGES_SENTENCE)
    expect(AI_SITE_STORE_PAGES_SENTENCE).toMatch(/do not count toward this plan's pages/)
    const free = aiSitePlanCapabilities(storeJob('free'), aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] }))
    expect(aiPlanSiteLines(storeJob('free'), empty, free)).not.toContain(AI_SITE_STORE_PAGES_SENTENCE)
    expect(aiPlanSiteLines(blogJob(), empty, aiSitePlanCapabilities(blogJob(), paidEmpty))).not.toContain(AI_SITE_STORE_PAGES_SENTENCE)
  })

  it('re-asks the recorded first answer for its Articles page through the plan step, and keeps the plan that comes back without it', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer(AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER)).mockResolvedValueOnce(toolAnswer(withoutArticles))
    const outcome = await planStepFor(PAID_ORG, paidEmpty, blogJob(), empty)
    const sent = mockRunAiRequest.mock.calls.map((call) => String((call[0] as SentRequest).messages.at(-1)?.content))
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('"Articles" at /articles stands in for the blog')
    expect([outcome.review?.findings, outcome.failure, (outcome.plan as AiJobPlan | undefined)?.screens.map((screen) => screen.slug)]).toEqual([[], undefined, ['/', '/routes', '/about', '/contact']])
  })

  it('keeps a second answer that still holds the page rather than stopping the start', async () => {
    mockRunAiRequest.mockReset()
    // The redo mends the home's closing band (rule 3, its own finding) and keeps Articles.
    const keptArticles: AiBuildPlan = {
      ...AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER,
      screens: [withoutArticles.screens[0], ...AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER.screens.slice(1)],
    }
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer(AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER))
      .mockResolvedValueOnce(toolAnswer(keptArticles))
    const outcome = await planStepFor(PAID_ORG, paidEmpty, blogJob(), empty)
    expect(mockRunAiRequest).toHaveBeenCalledTimes(AI_GENERATION_MAX_ATTEMPTS)
    expect(outcome.uncredited).toBeUndefined()
    expect((outcome.plan as AiJobPlan).screens.map((screen) => screen.slug)).toContain('/articles')
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

/**
 * What the layout language's live runs metered (AGL-3660), the floors the
 * build's figures are never priced under: the dearest page of the
 * 2026-10-07 business layout eval (re-asked, 32 to 45 credits), the largest
 * frame answer it wrote, and the layout and form steps of the local Free
 * yoga guided starts: layout 23 on both, and the form at the dearer of its
 * two, 29 on 2026-10-08 (28 on 2026-10-07).
 */
const MEASURED_LANGUAGE = { pageMostCredits: 45, frameMostOutputTokens: 583, layoutCredits: 23, formCredits: 29 } as const

/** One exchange, metered as the machine meters a step: billed, in credits, rounded up. */
const creditsOf = (usage: AiUsage, model: string) => assistCreditsFromUsd(usd(usage, model))

/** A language request as the doctrine sends it: its cached prefix with its tools, and its turn. */
function languageRequest(
  instructions: readonly AiSystemBlock[],
  kind: string,
  tool: unknown,
  inventory: AiSiteInventory,
  turn: string,
): SentRequest {
  return {
    model: '',
    maxTokens: 0,
    system: aiDoctrineSystemBlocks(inventory, { instructions, scope: aiDoctrineScopeFor(kind) }),
    tools: [tool, aiInventoryLookupTool()],
    messages: [{ role: 'user', content: turn }],
  }
}

/**
 * The language build's figures on an EMPTY site, as a guided start builds it
 * (AGL-3660), from the requests as they stand:
 *
 *  - page: a page's answer before its sections — its prefix written, its turn,
 *    and the WHOLE thinking room its ceiling keeps, on the page step's model;
 *  - section: one section at the most a section is written in;
 *  - retry: the dearest page asked again — its prefix read, its turn and the
 *    follow-up's, its thinking room and a full page of sections;
 *  - layout: the frame's prefix written and its turn, its answer at the most
 *    a live frame wrote, never under the live layout step;
 *  - form: the live guided start's form step.
 */
function languageBuildCredits(): Pick<AiFreeSiteWorstCase, 'layout' | 'form' | 'page' | 'section' | 'retry'> {
  const inventory = emptyAiSiteInventory('host-1')
  const job = yogaJob()
  const plan = { ...YOGA_FULL, status: 'confirmed' } as unknown as AiJobPlan
  const targets = aiLayoutPageTargets({ job, inventory, own: ['scrHome'] })
  const base = aiLayoutPagePrompt({ job, plan, screen: YOGA_FULL_HOME, targets, reusableComponents: false })
  const pageRequest = languageRequest(AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS, AI_LAYOUT_PAGE_KIND, AI_LAYOUT_PAGE_TOOL, inventory, base)
  const pageModel = aiModelForStep('job.page')
  const page = spans(pageRequest)
  const page_ = creditsOf(
    { inputTokens: realTokens(page.uncached), outputTokens: AI_LAYOUT_PAGE_THINKING_TOKENS, cacheReadTokens: 0, cacheWriteTokens: realTokens(page.cached) },
    pageModel,
  )
  const section = creditsOf({ inputTokens: 0, outputTokens: AI_LAYOUT_SECTION_MOST_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 }, pageModel)
  const followUp = aiLayoutMissingSectionsPrompt({ base, screen: YOGA_FULL_HOME, missing: YOGA_FULL_HOME.sections.map((_, index) => index) })
  const retry = creditsOf(
    {
      inputTokens: realTokens(page.uncached + followUp.length),
      outputTokens: AI_LAYOUT_PAGE_THINKING_TOKENS + AI_SITE_MAX_SECTIONS * AI_LAYOUT_SECTION_MOST_TOKENS,
      cacheReadTokens: realTokens(page.cached),
      cacheWriteTokens: 0,
    },
    pageModel,
  )
  const frameTurn = aiLayoutFramePrompt({
    job,
    siteName: aiLayoutSiteName(job),
    pages: aiLayoutNavPages(job, inventory),
    targets: aiLayoutFrameTargets(job, inventory),
  })
  const frame = spans(languageRequest(AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS, AI_LAYOUT_FRAME_KIND, AI_LAYOUT_FRAME_TOOL, inventory, frameTurn))
  const layout = Math.max(
    creditsOf(
      {
        inputTokens: realTokens(frame.uncached),
        outputTokens: MEASURED_LANGUAGE.frameMostOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: realTokens(frame.cached),
      },
      aiModelForStep('job.layout'),
    ),
    MEASURED_LANGUAGE.layoutCredits,
  )
  return { layout, form: MEASURED_LANGUAGE.formCredits, page: page_, section, retry }
}

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

  it('derives the Free site’s worst case — the plan and its re-ask at the outline ceiling, the look, and the language build — at the figures the wall declares', async () => {
    const requests = await freeSiteRequests()
    expect(requests).toHaveLength(2)
    const plan = planCredits(requests)
    const derived: AiFreeSiteWorstCase = {
      plan,
      look: await lookCredits(),
      ...languageBuildCredits(),
      listing: creditsOf(AI_STEP_NOMINAL_USAGE['job.seo'], aiModelForStep('job.seo')),
    }
    expect(derived).toEqual(AI_FREE_SITE_WORST_CASE_CREDITS)
  })

  it('prices a page as ONE answer: its whole thinking room, and every section at the most a section is written in, inside its ceiling', () => {
    const model = aiModelForStep('job.page')
    // A full page's sections and the thinking room fit the answer's ceiling, so pricing them never overstates what one answer can spend.
    expect(AI_LAYOUT_PAGE_THINKING_TOKENS + AI_SITE_MAX_SECTIONS * AI_LAYOUT_SECTION_MOST_TOKENS).toBeLessThanOrEqual(
      AI_JOB_PAGE_LANGUAGE_BUDGET.maxTokens(model),
    )
    const credits = AI_FREE_SITE_WORST_CASE_CREDITS
    // Never under a page the live runs metered: the dearest, re-asked, was 45 (2026-10-07).
    expect(credits.page + AI_SITE_MAX_SECTIONS * credits.section).toBeGreaterThanOrEqual(MEASURED_LANGUAGE.pageMostCredits)
    // Never under the live guided start's layout and form steps (2026-10-07).
    expect(credits.layout).toBeGreaterThanOrEqual(MEASURED_LANGUAGE.layoutCredits)
    expect(credits.form).toBeGreaterThanOrEqual(MEASURED_LANGUAGE.formCredits)
  })

  it('fits an EMPTY Free site — its layout, its form, two pages, a full home and room for one retried page — inside the wall, at the figures the notes quote', () => {
    const pages = AI_SITE_FREE_PAGES.max
    for (const layouts of [0, 1]) {
      const sections = aiFreeSiteSectionsWithin({ layouts, pages, forms: 1 }, FREE_AI_TASTE_CREDITS_PER_MONTH)
      expect(sections).toBe(AI_FREE_SITE_MAX_SECTIONS)
      expect(aiFreeSiteWorstCaseCredits({ layouts, pages, forms: 1 }, sections)).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH)
      // A full home of five beside the other page, which keeps at least one.
      expect(sections - (pages - 1)).toBeGreaterThanOrEqual(AI_SITE_HOME_MIN_SECTIONS)
    }
    const total = aiFreeSiteWorstCaseCredits({ layouts: 1, pages, forms: 1 }, AI_FREE_SITE_MAX_SECTIONS)
    const credits = AI_FREE_SITE_WORST_CASE_CREDITS
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([credits.plan, notes.includes(`a Free site's plan comes to at most ${credits.plan} credits`)]).toEqual([credits.plan, true])
    expect([total, notes.includes(`fits ${AI_FREE_SITE_MAX_SECTIONS} sections across its two pages, at most ${total} credits`)]).toEqual([total, true])
  })

  it('passes an empty Free site’s yoga plan — its layout and form created, a home of five and a page of two or three — on the wall, and refuses one past eight', () => {
    const empty = emptyAiSiteInventory('host-1')
    const free = aiSitePlanCapabilities(yogaJob(), aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] })) as AiPlanCapabilities
    const create: AiBuildPlan['create'] = [
      { kind: 'layout', name: 'Main layout', why: 'the site has none', duplicateOf: null, fields: ['header', 'navigation', 'footer'] },
      { kind: 'form', name: 'Book a class', why: 'the site has no form', duplicateOf: null, fields: ['Name', 'Email', 'Class'] },
    ]
    const home = { ...YOGA_FULL_HOME, layout: 'new:Main layout' }
    const classes = (sections: string[]) => ({
      ...page('Classes', '/classes', sections, { title: 'Yoga class schedule', description: 'Every class this week, booked online.' }),
      layout: 'new:Main layout',
    })
    const withForm = (screen: AiBuildPlan['screens'][number]) => ({
      ...screen,
      sections: screen.sections.map((section, index) => (index === screen.sections.length - 1 ? { ...section, uses: ['new:Book a class'] } : section)),
    })
    for (const other of [['class schedule', 'book a class'], ['class schedule', 'teachers', 'book a class']]) {
      const plan: AiBuildPlan = { reuse: [], create, screens: [home, withForm(classes(other))] }
      expect(codes(plan, empty, free)).not.toContain('plan-over-free-wall')
    }
    const nine: AiBuildPlan = { reuse: [], create, screens: [home, withForm(classes(['schedule', 'teachers', 'prices', 'book a class']))] }
    expect(codes(nine, empty, free)).toContain('plan-over-free-wall')
    // And the plan's turn asks that empty site for the full home.
    expect(aiPlanSiteLines(yogaJob(), empty, free).join('\n')).toContain('at least 5 sections')
  })

  it('quotes the dialog and holds the door to the WHOLE worst case — layout, form, the sections the plan may hold and the retry — inside the wall (AGL-3660)', () => {
    const credits = AI_FREE_SITE_WORST_CASE_CREDITS
    for (const pages of [1, 2]) {
      const creations = { layouts: 1, pages, forms: 1 }
      const sections = aiFreeSiteSectionsWithin(creations, FREE_AI_TASTE_CREDITS_PER_MONTH)
      expect(aiFreeSiteCreditEstimate(pages)).toBe(aiFreeSiteWorstCaseCredits(creations, sections))
      // Nothing the job may spend is left out: the layout, the form and the retry are in it.
      expect(aiFreeSiteCreditEstimate(pages)).toBeGreaterThanOrEqual(
        aiFreeSiteWorstCaseCredits({ layouts: 0, pages, forms: 0 }, sections) + credits.layout + credits.form,
      )
      expect(aiFreeSiteCreditEstimate(pages)).toBeLessThanOrEqual(FREE_AI_TASTE_CREDITS_PER_MONTH)
    }
    // The two-page figure is the one the notes quote for the wall.
    expect(aiFreeSiteCreditEstimate(2)).toBe(aiFreeSiteWorstCaseCredits({ layouts: 1, pages: 2, forms: 1 }, AI_FREE_SITE_MAX_SECTIONS))
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

  it('writes a Free blog no first posts and a Free store no products: one post at its worst needs more than the wall leaves (AGL-3676)', async () => {
    // A post at its worst on the model a Free site runs on: its answer at the
    // post's own ceiling, writing its cached prefix, and its one re-ask
    // reading it — the two exchanges the wall counts for the plan, too.
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue({ ...toolAnswer({}), toolUse: [{ name: AI_BLOG_POST_TOOL_NAME, input: {} }] })
    const fast = AI_MODEL_CATALOG.find((entry) => entry.tier === 'fast')?.id as string
    await generateAiBlogPost({ brief: siteJob().brief, merchantWords: siteJob().brief, earlierTitles: [], index: 1, total: 3, model: fast })
    const requests = mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)
    expect(requests.map((request) => request.model)).toEqual([fast, fast])
    const post = assistCreditsFromUsd(
      requests.reduce((sum, request, index) => {
        const { cached, uncached } = spans(request)
        return (
          sum +
          usd(
            {
              inputTokens: realTokens(uncached),
              outputTokens: request.maxTokens,
              cacheReadTokens: index === 0 ? 0 : realTokens(cached),
              cacheWriteTokens: index === 0 ? realTokens(cached) : 0,
            },
            request.model,
          )
        )
      }, 0),
    )
    // What a guided start's two-page Free site leaves — its site created
    // empty, so it builds its layout and its form first — once its sections
    // take all the cap allows, its retried page's room held back as the wall
    // holds it (AGL-3660).
    const pages = AI_SITE_FREE_PAGES.max
    const sections = aiFreeSiteSectionsWithin({ layouts: 1, pages, forms: 1 }, FREE_AI_TASTE_CREDITS_PER_MONTH)
    const left = FREE_AI_TASTE_CREDITS_PER_MONTH - aiFreeSiteWorstCaseCredits({ layouts: 1, pages, forms: 1 }, sections)
    expect({ post, left, fits: post <= left }).toEqual({ post, left, fits: false })
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect([post, notes.includes(`its re-ask — is ${post}, so a Free blog writes no first posts`)]).toEqual([post, true])
    // So the guided start owes a Free blog and a Free store no part of their own.
    expect(aiSiteContentPart({ siteKind: 'blog' }, true)).toBeNull()
    expect(aiSiteContentPart({ siteKind: 'store' }, true)).toBeNull()
    expect(aiSiteContentPart({ siteKind: 'blog' }, false)).toBe('posts')
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
