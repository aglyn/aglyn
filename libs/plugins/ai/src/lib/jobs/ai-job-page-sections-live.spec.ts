/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * A guided start's Home page, built a section at a time by the REAL model
 * (AGL-3596). Every other section spec feeds a hand-written answer, which is
 * how a production Home page (a dog groomer in Austin, 2026-10-07) was refused
 * for a Grid container's unsized items after its re-ask: the model breaks a
 * different rule each run, and no hand-written tree breaks it the way the
 * model does. This one sends each Home page below through the section pass as
 * the page step makes it — the same prompt, tool, ceiling, cut-off re-ask and
 * check, on the tier the step is served from — on the site a guided start has
 * when it builds Home: its layout and its form built, and its Contact page
 * minted on the plan and built after. It holds every page to being built
 * whole, and prints a table a run: each section's attempts, the output tokens
 * and stop reason of each call, the elements of each answer, the answers it
 * settled, and the findings it stopped on.
 *
 * It calls the provider and costs real money (about $0.40 a run), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set. Run it
 * before promoting a change to the page step, its prompt or the page check.
 * `AGLYN_LIVE_AI_ORG_PLAN=business` builds the same pages on a paid workspace,
 * whose plan places a card component in each section of items, as the plan
 * rules ask of one. `jest.setup.js` scrubs every variable the repo's `.env`
 * holds unless the run carries the live launcher's mark, so a key read from
 * `.env` needs it too:
 *
 *   AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     node --env-file=.env node_modules/jest/bin/jest.js -c libs/plugins/ai/jest.config.ts \
 *     libs/plugins/ai/src/lib/jobs/ai-job-page-sections-live.spec.ts
 *
 * THE CHEAP VERIFICATION LADDER (AGL-3660; docs/AI_JOBS.md, "Verifying a
 * prompt change"). Climb it in order and stop at the first rung that can
 * see the mistake:
 *
 *   1. unit tests — the step's own spec on golden answers, and
 *      `runtime/ai-prompt-cache.spec.ts` for the cached bytes: free;
 *   2. replay — this spec again: under the launcher every request whose
 *      bytes were answered before is replayed from `.cache/ai-replay` for
 *      nothing, and only a CHANGED prompt goes to the provider;
 *   3. one live run per plan (Free, then `AGLYN_LIVE_AI_ORG_PLAN=business`)
 *      for the prompts you changed — read `run.live` in the table: 0 means
 *      nothing new was asked and the run proves nothing;
 *   4. the full live sweep, only before landing: `AGLYN_AI_REPLAY=refresh`
 *      asks every request again, and `AGLYN_LIVE_AI_BATCH=1` sends the round
 *      as one Message Batch at half price (minutes, not seconds).
 */

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
  registerAiJobStepPasses: jest.fn(),
  registerAiJobAdmission: jest.fn(),
}))

/** Each settle that changed an answer, by name (AGL-3596). */
const mockSettles: Record<string, number> = {}
jest.mock('../runtime/ai-doctrine-validators', () => {
  const actual = jest.requireActual('../runtime/ai-doctrine-validators')
  const counted =
    (name: string) =>
    (...args: unknown[]) => {
      const settled = actual[name](...args)
      if (settled !== args[0]) mockSettles[name] = (mockSettles[name] ?? 0) + 1
      return settled
    }
  return {
    __esModule: true,
    ...actual,
    aiSettleGridItems: counted('aiSettleGridItems'),
    aiSettleDisagreeingNodes: counted('aiSettleDisagreeingNodes'),
    aiSettleCutHeadings: counted('aiSettleCutHeadings'),
  }
})

/** Every model call, with the request's first message to tell its page and section apart. */
const mockCalls: Array<{ prompt: string; stopReason: string | null; outputTokens: number }> = []
jest.mock('../runtime/ai-runtime', () => {
  const actual = jest.requireActual('../runtime/ai-runtime')
  return {
    __esModule: true,
    ...actual,
    runAiRequest: async (input: { messages: Array<{ content: unknown }> }) => {
      const result = await actual.runAiRequest(input)
      mockCalls.push({
        prompt: String(input.messages[0]?.content ?? ''),
        stopReason: result.stopReason ?? null,
        outputTokens: Number(result.usage?.outputTokens ?? 0),
      })
      return result
    },
  }
})

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { aiPlanEmbedsFor, type AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiModelForStep } from '../providers/routing'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import {
  aiAnswerTree,
  runValidatedGeneration,
  type AiGenerationCheck,
  type AiValidatedGeneration,
} from '../runtime/ai-doctrine'
import { aiBuildsWithComponents } from './ai-job-drafts'
import { aiJobPageSectionMaxTokens } from './ai-job-page-budget'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_TOOL,
  aiEmptyPage,
  aiPageCheckContext,
  aiPageLinkablePages,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  aiPageSectionPrompt,
  aiPageSectionSmaller,
  aiPageWithSection,
  type AiLinkablePage,
  type AiPageSection,
} from './ai-job-page-sections'
import { aiJobPageSectionMaxElements } from './ai-job-page-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const ORG_PLAN = process.env['AGLYN_LIVE_AI_ORG_PLAN'] === 'business' ? 'business' : 'free'
/**
 * An answer ceiling in place of the served tier's, to measure what a section
 * runs to uncut (`AGLYN_LIVE_AI_MAX_TOKENS=2000`); absent, the step's own.
 */
const MAX_TOKENS = Number(process.env['AGLYN_LIVE_AI_MAX_TOKENS']) || null
const NOW = new Date()
const LAYOUT_ID = 'layout-main'
const FORM_ID = 'form-contact'
const CARD_ID = 'cmp-card'
/** A guided start's two pages, minted on its plan: Home is built first, Contact after it. */
const SITE_PAGES: AiLinkablePage[] = [
  { id: 'planned-home', label: 'Home', slug: '/' },
  { id: 'planned-contact', label: 'Contact', slug: '/contact' },
]

/** Home pages as guided starts plan them: the production dog groomer's plan as it was confirmed, and four more briefs. */
const HOMES: ReadonlyArray<{ businessType: string; audience: string; screen: AiBuildPlanScreen }> = [
  {
    businessType: 'A dog groomer in Austin',
    audience: 'Local dog owners',
    screen: home('Dog Grooming in Austin', 'Professional dog grooming services for Austin pet owners. Learn what we offer.', [
      { name: 'Hero with service overview', uses: [], items: 0 },
      { name: 'Why choose us', uses: [], items: 0 },
      { name: 'Featured services', uses: [], items: 3 },
    ]),
  },
  {
    businessType: 'a family dental practice',
    audience: 'parents booking check-ups for their kids',
    screen: home('Family Dentist for Kids and Parents', 'Gentle check-ups and cleanings for the whole family. Book a visit.', [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Services for every age', uses: [], items: 4 },
      { name: 'Book a visit', uses: [], items: 0 },
    ]),
  },
  {
    businessType: 'a roofing contractor',
    audience: 'homeowners after a storm',
    screen: home('Storm Damage Roof Repair', 'Fast roof inspections and repairs after a storm. Request a free inspection.', [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'What the inspection covers', uses: [], items: 3 },
      { name: 'How it works', uses: [], items: 3 },
    ]),
  },
  {
    businessType: 'a neighborhood café with breakfast and pastries',
    audience: 'locals looking for a morning spot',
    screen: home('Neighborhood Café and Bakery', 'Coffee, breakfast and fresh pastries every morning. See the menu and visit us.', [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Menu highlights', uses: [], items: 4 },
      { name: 'Visit us', uses: [], items: 0 },
    ]),
  },
  {
    businessType: 'a yoga studio with drop-in classes',
    audience: 'beginners nervous about their first class',
    screen: home('Beginner-Friendly Yoga Studio', 'Drop-in yoga classes for every level. Find a class and book your first visit.', [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Classes for beginners', uses: [], items: 3 },
      { name: 'What to expect', uses: [], items: 0 },
    ]),
  },
]

function home(seoTitle: string, seoDescription: string, sections: AiBuildPlanScreen['sections']): AiBuildPlanScreen {
  return {
    id: SITE_PAGES[0].id,
    title: 'Home',
    slug: '/',
    layout: LAYOUT_ID,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle,
    seoDescription,
    // A paid workspace's plan places a component in each section of items, as rule 1 asks of its plan.
    sections: sections.map((section) => (ORG_PLAN === 'business' && section.items ? { ...section, uses: [CARD_ID] } : section)),
    record: null,
  } as unknown as AiBuildPlanScreen
}

/** The site a guided start's Home page is built on: the layout and the form its plan created (and on a paid workspace, its card). */
function builtSite(): AiSiteInventory {
  return {
    ...emptyAiSiteInventory('host-live'),
    layouts: [{ id: LAYOUT_ID, name: 'Main Layout', parentId: null }],
    forms: [{ id: FORM_ID, name: 'Contact Request Form', fields: ['Name', 'Email', 'Phone', 'Message'] }],
    components:
      ORG_PLAN === 'business' ? [{ id: CARD_ID, name: 'Card', props: { title: 'text', summary: 'text' } }] : [],
  }
}

function siteJob(entry: (typeof HOMES)[number], index: number): AiJob {
  const plan: AiJobPlan = {
    // What the scaffold built is planned against as records the site has (`aiSiteUnitJob`).
    reuse: [
      { kind: 'layout', id: LAYOUT_ID, purpose: 'the layout this site’s pages are built on' },
      { kind: 'form', id: FORM_ID, purpose: 'the form this site’s pages are built on' },
      ...(ORG_PLAN === 'business' ? [{ kind: 'component', id: CARD_ID, purpose: 'the card this site’s pages are built on' }] : []),
    ],
    create: [],
    screens: [entry.screen],
    status: 'confirmed',
    labels: { [LAYOUT_ID]: 'Main Layout', [FORM_ID]: 'Contact Request Form', [CARD_ID]: 'Card' },
    proposedAt: NOW,
    confirmedAt: NOW,
    confirmedBy: 'owner-1',
  } as unknown as AiJobPlan
  return {
    $id: `job-live-page-${index}`,
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'page',
    status: 'running',
    brief: `A 2-page website for ${entry.businessType}. It is for ${entry.audience}. Build the page “Home” of this site, at /.`,
    inputs: { pages: 2, businessType: entry.businessType, audience: entry.audience, starter: 'business', sitePages: SITE_PAGES },
    plan,
    steps: [],
    outputs: [],
    creditsReserved: 300,
    creditsSpent: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

const LINK_ELEMENTS = new Set(['muiButton', 'muiScreenLink'])

interface SectionResult {
  section: string
  status: string
  /** Each answer the check read: its elements and the findings it was refused for, if any. */
  answers: Array<{ elements: number; refused: string[] }>
  /** Each model call: its output tokens and why it stopped. */
  calls: Array<{ outputTokens: number; stopReason: string | null }>
  /** Links that named no destination and were sent to the site's one other page. */
  linksSettled: number
  findings: string[]
  estCostUsd: number
}

/**
 * WHAT WRITES A SECTION, the one seam to swap (AGL-3596). The harness owns the
 * site, the plan, the page built so far and the table; a writer is handed one
 * section to build and the check the page step holds it to, and answers with
 * the generation's outcome. `rawTreeSectionWriter` is the page step's own:
 * the model draws a flat node map through `submit_section`. A different
 * section writer (a compiled layout language, AGL-3660) is pointed at by
 * replacing `SECTION_WRITER`, and every figure in the table stays comparable:
 * each answer it hands the check is recorded, and each model call it makes
 * through `runAiRequest` is counted against the section whose request it carried.
 */
export interface AiLiveSectionInput {
  job: AiJob
  plan: AiJobPlan
  screen: AiBuildPlanScreen
  index: number
  inventory: AiSiteInventory
  reusableComponents: boolean
  linkablePages: AiLinkablePage[]
  /** The check the page step holds the section to, which records each answer it reads. */
  check: AiGenerationCheck<AiPageSection>
}

export interface AiLiveSectionWriter {
  /** The first message of the section's request, by which its model calls are told apart. */
  prompt(input: AiLiveSectionInput): string
  write(input: AiLiveSectionInput, prompt: string): Promise<AiValidatedGeneration<AiPageSection>>
}

/** The page step's section pass: the same prompt, tool, ceiling, cut-off re-ask and check. */
export const rawTreeSectionWriter: AiLiveSectionWriter = {
  prompt: (input) => {
    const maxElements = aiJobPageSectionMaxElements(aiJobPageSectionMaxTokens(aiModelForStep('job.page')))
    const { job, plan, screen, index, reusableComponents, linkablePages } = input
    return aiPageSectionPrompt({ job, plan, screen, index, maxElements, reusableComponents, record: null, linkablePages })
  },
  write: (input, prompt) => {
    const model = aiModelForStep('job.page')
    const maxElements = aiJobPageSectionMaxElements(aiJobPageSectionMaxTokens(model))
    return runValidatedGeneration<AiPageSection>('page-section', {
      step: 'job.page',
      model,
      instructions: AI_JOB_PAGE_INSTRUCTIONS,
      inventory: input.inventory,
      messages: [{ role: 'user', content: prompt }],
      tool: AI_PAGE_SECTION_TOOL,
      maxTokens: MAX_TOKENS ?? aiJobPageSectionMaxTokens(model),
      cutOff: { noun: 'section', smaller: aiPageSectionSmaller({ maxElements, reusableComponents: input.reusableComponents }) },
      thinking: 'off',
      check: input.check,
    })
  },
}

/** The section writer this run measures. */
const SECTION_WRITER: AiLiveSectionWriter = rawTreeSectionWriter

/** Every section of one Home page, a pass each, as the page step runs them. */
async function buildHome(entry: (typeof HOMES)[number], index: number): Promise<SectionResult[]> {
  const job = siteJob(entry, index)
  const plan = job.plan as AiJobPlan
  const screen = entry.screen
  const inventory = builtSite()
  const org: Partial<AglynOrgBilling> = { plan: ORG_PLAN }
  const reusableComponents = aiBuildsWithComponents(org)
  const sectionIds = screen.sections.map((_, position) => aiPageSectionNodeId(job.$id, position))
  const { linkablePages, linkTarget } = aiPageLinkablePages(inventory, SITE_PAGES, [screen.id])
  const context = aiPageCheckContext(inventory, {
    reusableComponents,
    sections: screen.sections.map((section) => section.name),
    embeds: aiPlanEmbedsFor(plan, { slug: screen.slug }),
    linkablePages,
  })
  let page = aiEmptyPage()
  const results: SectionResult[] = []
  for (let position = 0; position < screen.sections.length; position += 1) {
    const answers: SectionResult['answers'] = []
    let linksSettled = 0
    const check = aiPageSectionCheck({
      page,
      sectionIds,
      index: position,
      context,
      section: screen.sections[position],
      inventory,
      linkTarget,
    })
    const recorded: AiGenerationCheck<AiPageSection> = (answer) => {
      const checked = check(answer)
      const raw = aiAnswerTree(answer) as { nodes?: Record<string, { componentId?: string; props?: Record<string, unknown> }> }
      const nodes = Object.values(raw?.nodes ?? {})
      answers.push({ elements: nodes.length, refused: checked.violations.map((violation) => violation.code) })
      if (checked.value && !checked.violations.length) {
        linksSettled += nodes.filter(
          (node) =>
            LINK_ELEMENTS.has(String(node.componentId)) &&
            !node.props?.['screenId'] &&
            !node.props?.['href'] &&
            !node.props?.['scrollTo'],
        ).length
      }
      return checked
    }
    const input: AiLiveSectionInput = { job, plan, screen, index: position, inventory, reusableComponents, linkablePages, check: recorded }
    const prompt = SECTION_WRITER.prompt(input)
    const before = mockCalls.length
    const result = await SECTION_WRITER.write(input, prompt)
    results.push({
      section: `${entry.businessType} / ${screen.sections[position].name}`,
      status: result.status,
      answers,
      // Pages run side by side, so a section's calls are the ones that carried its own request.
      calls: mockCalls
        .slice(before)
        .filter((call) => call.prompt === prompt)
        .map(({ outputTokens, stopReason }) => ({ outputTokens, stopReason })),
      linksSettled,
      findings: result.status === 'needs_input' ? result.violations.map((violation) => violation.code) : [],
      estCostUsd: result.estCostUsd,
    })
    // A section that does not pass parks the page step, and the passes after it
    // would be checked against a page without it, so the page ends there.
    if (result.status !== 'ok') break
    page = aiPageWithSection(page, result.value, sectionIds)
  }
  return results
}

const describeLive = LIVE ? describe : describe.skip

describeLive("a guided start's Home page from the real model, a section a pass", () => {
  jest.setTimeout(10 * 60_000)

  it('builds every Home page whole', async () => {
    const pages = await Promise.all(HOMES.map(buildHome))
    const results = pages.flat()
    const calls = results.flatMap((result) => result.calls)
    const table = {
      // Live against replayed (AGL-3660): a run with live 0 asked nothing new.
      run: aiLiveRunLedger(),
      orgPlan: ORG_PLAN,
      estCostUsd: Number(results.reduce((sum, result) => sum + result.estCostUsd, 0).toFixed(4)),
      pagesBuilt: pages.filter((sections, index) => sections.length === HOMES[index].screen.sections.length && sections.every((s) => s.status === 'ok')).length,
      sectionsPassed: `${results.filter((result) => result.status === 'ok').length}/${results.length}`,
      cutOffs: calls.filter((call) => call.stopReason === 'max_tokens').length,
      calls: calls.length,
      settles: { ...mockSettles, links: results.reduce((sum, result) => sum + result.linksSettled, 0) },
      outputTokens: calls.map((call) => call.outputTokens).sort((a, b) => a - b),
      finalRefusals: results.flatMap((result) => result.findings),
      results,
    }
    // The whole table, every run, so a red run shows every section's outcome.
    console.log(JSON.stringify(table, null, 1))
    expect(table.pagesBuilt).toBe(HOMES.length)
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
