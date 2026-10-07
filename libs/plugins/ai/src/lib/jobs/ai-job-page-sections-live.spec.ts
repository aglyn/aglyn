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
 * check, on the tier the step is served from — and holds every section to a
 * pass the page check keeps, on the site a guided start has built by then:
 * its layout and its form.
 *
 * It calls the provider and costs real money (about $0.25 a run), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set. Run it
 * before promoting a change to the page step, its prompt or the page check.
 * `jest.setup.js` scrubs every variable the repo's `.env` holds unless the run
 * carries the live launcher's mark, so a key read from `.env` needs it too:
 *
 *   AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     node --env-file=.env node_modules/jest/bin/jest.js -c libs/plugins/ai/jest.config.ts \
 *     libs/plugins/ai/src/lib/jobs/ai-job-page-sections-live.spec.ts
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
/** The answers whose Grid items the section check settled rather than refused (AGL-3596). */
const mockSettled = { count: 0 }
jest.mock('../runtime/ai-doctrine-validators', () => {
  const actual = jest.requireActual('../runtime/ai-doctrine-validators')
  return {
    __esModule: true,
    ...actual,
    aiSettleGridItems: (...args: Parameters<typeof actual.aiSettleGridItems>) => {
      const settled = actual.aiSettleGridItems(...args)
      if (settled !== args[0]) mockSettled.count += 1
      return settled
    },
  }
})

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { aiPlanEmbedsFor, type AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiModelForStep } from '../providers/routing'
import { runValidatedGeneration, type AiGenerationCheck } from '../runtime/ai-doctrine'
import { aiBuildsWithComponents } from './ai-job-drafts'
import { aiJobPageSectionMaxTokens } from './ai-job-page-budget'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_TOOL,
  aiEmptyPage,
  aiPageCheckContext,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  aiPageSectionPrompt,
  aiPageSectionSmaller,
  aiPageWithSection,
  type AiPageSection,
} from './ai-job-page-sections'
import { aiJobPageSectionMaxElements } from './ai-job-page-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date()
const LAYOUT_ID = 'layout-main'
const FORM_ID = 'form-contact'
const CONTACT_ID = 'screen-contact'

/**
 * Home pages as guided starts plan them: the production dog groomer's plan as
 * it was confirmed, and two more briefs. Each is built on a Free workspace, as
 * a guided start's new account is, which draws its repeats inline.
 */
const HOMES: ReadonlyArray<{ businessType: string; audience: string; plan: 'business' | 'free'; screen: AiBuildPlanScreen }> = [
  {
    businessType: 'A dog groomer in Austin',
    audience: 'Local dog owners',
    plan: 'free',
    screen: home('Dog Grooming in Austin', 'Professional dog grooming services for Austin pet owners. Learn what we offer.', [
      { name: 'Hero with service overview', uses: [], items: 0 },
      { name: 'Why choose us', uses: [], items: 0 },
      { name: 'Featured services', uses: [], items: 3 },
    ]),
  },
  {
    businessType: 'a family dental practice',
    audience: 'parents booking check-ups for their kids',
    plan: 'free',
    screen: home('Family Dentist for Kids and Parents', 'Gentle check-ups and cleanings for the whole family. Book a visit.', [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Services for every age', uses: [], items: 4 },
      { name: 'Book a visit', uses: [], items: 0 },
    ]),
  },
  {
    businessType: 'a roofing contractor',
    audience: 'homeowners after a storm',
    plan: 'free',
    screen: home('Storm Damage Roof Repair', 'Fast roof inspections and repairs after a storm. Request a free inspection.', [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'What the inspection covers', uses: [], items: 3 },
      { name: 'How it works', uses: [], items: 3 },
    ]),
  },
]

function home(seoTitle: string, seoDescription: string, sections: AiBuildPlanScreen['sections']): AiBuildPlanScreen {
  return {
    title: 'Home',
    slug: '/',
    layout: LAYOUT_ID,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle,
    seoDescription,
    sections,
    record: null,
  } as unknown as AiBuildPlanScreen
}

/**
 * The site a guided start's Home page is built on: the layout and the form its
 * plan created, and its Contact page, which the production start built first.
 */
function builtSite(): AiSiteInventory {
  return {
    ...emptyAiSiteInventory('host-live'),
    layouts: [{ id: LAYOUT_ID, name: 'Main Layout', parentId: null }],
    forms: [{ id: FORM_ID, name: 'Contact Request Form', fields: ['Name', 'Email', 'Phone', 'Message'] }],
    screens: [{ id: CONTACT_ID, name: 'Contact', slug: '/contact', layoutId: LAYOUT_ID, template: false }],
  }
}

function siteJob(entry: (typeof HOMES)[number], index: number): AiJob {
  const plan: AiJobPlan = {
    // What the scaffold built is planned against as records the site has (`aiSiteUnitJob`).
    reuse: [
      { kind: 'layout', id: LAYOUT_ID, purpose: 'the layout this site’s pages are built on' },
      { kind: 'form', id: FORM_ID, purpose: 'the form this site’s pages are built on' },
    ],
    create: [],
    screens: [entry.screen],
    status: 'confirmed',
    labels: { [LAYOUT_ID]: 'Main Layout', [FORM_ID]: 'Contact Request Form' },
    proposedAt: NOW,
    confirmedAt: NOW,
    confirmedBy: 'owner-1',
  } as unknown as AiJobPlan
  return {
    $id: `job-live-page-${index}`,
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'site',
    status: 'running',
    brief: `A 2-page website for ${entry.businessType}. It is for ${entry.audience}. Build the page “Home” of this site, at /.`,
    inputs: { pages: 2, businessType: entry.businessType, audience: entry.audience, starter: 'business' },
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

interface SectionResult {
  section: string
  status: string
  /** The findings of each attempt the check refused, by code. */
  refusedAttempts: string[][]
  findings: string[]
  estCostUsd: number
}

/** Every section of one Home page, a pass each, as the page step runs them. */
async function buildHome(entry: (typeof HOMES)[number], index: number): Promise<SectionResult[]> {
  const job = siteJob(entry, index)
  const plan = job.plan as AiJobPlan
  const screen = entry.screen
  const inventory = builtSite()
  const org: Partial<AglynOrgBilling> = { plan: entry.plan }
  const reusableComponents = aiBuildsWithComponents(org)
  const sectionIds = screen.sections.map((_, position) => aiPageSectionNodeId(job.$id, position))
  const context = aiPageCheckContext(inventory, {
    reusableComponents,
    sections: screen.sections.map((section) => section.name),
    embeds: aiPlanEmbedsFor(plan, { slug: screen.slug }),
  })
  const model = aiModelForStep('job.page')
  const maxTokens = aiJobPageSectionMaxTokens(model)
  const maxElements = aiJobPageSectionMaxElements(maxTokens)
  let page = aiEmptyPage()
  const results: SectionResult[] = []
  for (let position = 0; position < screen.sections.length; position += 1) {
    const refusedAttempts: string[][] = []
    const check = aiPageSectionCheck({ page, sectionIds, index: position, context, section: screen.sections[position], inventory })
    const recorded: AiGenerationCheck<AiPageSection> = (answer) => {
      const checked = check(answer)
      if (checked.violations.length) refusedAttempts.push(checked.violations.map((violation) => violation.code))
      return checked
    }
    const result = await runValidatedGeneration<AiPageSection>('page-section', {
      step: 'job.page',
      model,
      instructions: AI_JOB_PAGE_INSTRUCTIONS,
      inventory,
      messages: [
        {
          role: 'user',
          content: aiPageSectionPrompt({ job, plan, screen, index: position, maxElements, reusableComponents, record: null }),
        },
      ],
      tool: AI_PAGE_SECTION_TOOL,
      maxTokens,
      cutOff: { noun: 'section', smaller: aiPageSectionSmaller({ maxElements, reusableComponents }) },
      thinking: 'off',
      check: recorded,
    })
    results.push({
      section: `${entry.businessType} / ${screen.sections[position].name}`,
      status: result.status,
      refusedAttempts,
      findings:
        result.status === 'needs_input' ? result.violations.map((violation) => `${violation.code}: ${violation.message}`) : [],
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

  it('passes the page check on every section of every Home page', async () => {
    const results = (await Promise.all(HOMES.map(buildHome))).flat()
    const cost = results.reduce((sum, result) => sum + result.estCostUsd, 0)
    // The whole table, every run, so a red run shows every section's outcome.
    console.log(JSON.stringify({ estCostUsd: Number(cost.toFixed(4)), gridItemsSettled: mockSettled.count, results }, null, 1))
    expect(results.filter((result) => result.status !== 'ok')).toEqual([])
    expect(results).toHaveLength(HOMES.reduce((sum, entry) => sum + entry.screen.sections.length, 0))
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
