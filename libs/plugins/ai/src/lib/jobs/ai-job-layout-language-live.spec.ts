/**
 * @jest-environment node
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
 * Six guided starts' pages and frames designed by the REAL model in the layout
 * language and compiled (AGL-3660): for each brief its Home page, one more
 * page, and its header and footer — through the same prompt, tool, ceiling,
 * re-ask and check the page step and the layout step run. Every page must be
 * built with no refusal, and a run prints a table: each page's calls, output
 * tokens, credits and anything it settled.
 *
 * It calls the provider and costs real money (about $0.50 a run), so it runs
 * only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, and the live
 * launcher's mark so `jest.setup.js` keeps the key read from `.env`:
 *
 *   AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     node --env-file=.env node_modules/jest/bin/jest.js -c libs/plugins/ai/jest.config.ts \
 *     libs/plugins/ai/src/lib/jobs/ai-job-layout-language-live.spec.ts
 *
 * `AGLYN_LIVE_AI_ORG_PLAN=business` builds them on a paid workspace;
 * `AGLYN_LIVE_AI_MODEL` names another catalog model (a Free tier on the fast
 * one, say); `AGLYN_LIVE_AI_OUT=<dir>` writes each compiled page and layout
 * there for `render-layout-shots.mts`.
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

/** Every model call, by the first message of its request. */
const mockCalls: Array<{ prompt: string; stopReason: string | null; usage: Record<string, number> }> = []
jest.mock('../runtime/ai-runtime', () => {
  const actual = jest.requireActual('../runtime/ai-runtime')
  return {
    __esModule: true,
    ...actual,
    runAiRequest: async (input: { messages: Array<{ content: unknown }> }) => {
      const result = await actual.runAiRequest(input)
      mockCalls.push({ prompt: String(input.messages[0]?.content ?? ''), stopReason: result.stopReason ?? null, usage: result.usage })
      return result
    },
  }
})

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_LAYOUT_FRAME_TOOL, AI_LAYOUT_PAGE_TOOL } from '../layout-language/ai-layout-language'
import type { AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiModelForStep } from '../providers/routing'
import { runValidatedGeneration } from '../runtime/ai-doctrine'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { aiBuildsWithComponents } from './ai-job-drafts'
import {
  AI_JOB_LAYOUT_LANGUAGE_BUDGET,
  AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS,
  AI_LAYOUT_FRAME_KIND,
  aiLayoutFrameCheck,
  aiLayoutFramePrompt,
  aiLayoutFrameTargets,
  aiLayoutHomeId,
  aiLayoutNavPages,
  aiLayoutSiteName,
  type AiLayoutFrameBuilt,
} from './ai-job-layout-language'
import { aiLayoutChecks } from './ai-job-layout-step'
import {
  AI_JOB_PAGE_LANGUAGE_BUDGET,
  AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS,
  AI_LAYOUT_FORM_PAGE_INPUT,
  AI_LAYOUT_LANGUAGE_INPUT,
  AI_LAYOUT_PAGE_KIND,
  aiLayoutPageCheck,
  aiLayoutPagePrompt,
  aiLayoutPageTargets,
  type AiLayoutPageBuilt,
} from './ai-job-page-language'
import { aiPageCheckContext, aiPageLinkablePages, aiPageSectionNodeId } from './ai-job-page-sections'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const ORG_PLAN = process.env['AGLYN_LIVE_AI_ORG_PLAN'] === 'business' ? 'business' : 'free'
const MODEL = process.env['AGLYN_LIVE_AI_MODEL'] || null
const OUT = process.env['AGLYN_LIVE_AI_OUT'] || null
const NOW = new Date()
const LAYOUT_ID = 'layout-main'
const FORM_ID = 'form-contact'
const CARD_ID = 'cmp-card'

interface Brief {
  key: string
  name: string
  businessType: string
  audience: string
  city: string
  pages: Array<{ title: string; slug: string; sections: AiBuildPlanScreen['sections'] }>
}

const s = (name: string, items = 0, uses: string[] = []) => ({ name, uses, items })

/** Six guided starts, each a Home page and the page the brief most needs, with a Contact page holding the form. */
const BRIEFS: readonly Brief[] = [
  {
    key: 'groomer',
    name: 'Hillside Dog Grooming',
    businessType: 'a dog groomer in Austin',
    audience: 'local dog owners, including nervous and senior dogs',
    city: 'Austin',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero with service overview'), s('Why choose us'), s('Featured services', 3), s('Book a groom')] },
      { title: 'Services', slug: '/services', sections: [s('Services intro'), s('Grooming packages', 4), s('Questions owners ask', 4)] },
    ],
  },
  {
    key: 'dental',
    name: 'Brightside Family Dental',
    businessType: 'a family dental practice',
    audience: 'parents booking check-ups for their kids',
    city: 'Columbus',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Services for every age', 4), s('What a first visit looks like', 3), s('Book a visit')] },
      { title: 'About', slug: '/about', sections: [s('Our practice'), s('What we believe', 3), s('Insurance and payment')] },
    ],
  },
  {
    key: 'roofer',
    name: 'Ridgeline Roofing',
    businessType: 'a roofing contractor',
    audience: 'homeowners after a storm',
    city: 'Tulsa',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('What the inspection covers', 3), s('How it works', 3), s('Request an inspection')] },
      { title: 'Services', slug: '/services', sections: [s('Roofing services'), s('Repair, replacement and gutters', 3), s('Insurance claims help')] },
    ],
  },
  {
    key: 'cafe',
    name: 'Corner Crumb Café',
    businessType: 'a neighborhood café with breakfast and pastries',
    audience: 'locals looking for a morning spot',
    city: 'Portland',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Menu highlights', 4), s('Our story'), s('Visit us')] },
      { title: 'Menu', slug: '/menu', sections: [s('Menu intro'), s('Breakfast', 5), s('Pastries and coffee', 5)] },
    ],
  },
  {
    key: 'yoga',
    name: 'Stillwater Yoga',
    businessType: 'a yoga studio with drop-in classes',
    audience: 'beginners nervous about their first class',
    city: 'Denver',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Classes for beginners', 3), s('What to expect'), s('First class free')] },
      { title: 'Classes', slug: '/classes', sections: [s('Class types', 4), s('Weekly rhythm'), s('Common questions', 4)] },
    ],
  },
  {
    key: 'law',
    name: 'Mercer & Hale Law',
    businessType: 'a small family law firm',
    audience: 'people going through divorce or custody questions',
    city: 'Raleigh',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Practice areas', 4), s('How we work with you', 3), s('Request a consultation')] },
      { title: 'About', slug: '/about', sections: [s('Our firm'), s('Our attorneys', 2), s('Our approach')] },
    ],
  },
]

const planned = (brief: Brief) => [
  ...brief.pages.map((page, index) => ({ id: `${brief.key}-p${index}`, label: page.title, slug: page.slug })),
  { id: `${brief.key}-contact`, label: 'Contact', slug: '/contact' },
]

function inventory(): AiSiteInventory {
  return {
    ...emptyAiSiteInventory('host-live'),
    layouts: [{ id: LAYOUT_ID, name: 'Main Layout', parentId: null }],
    forms: [{ id: FORM_ID, name: 'Contact Request Form', fields: ['Name', 'Email', 'Phone', 'Message'] }],
    components: ORG_PLAN === 'business' ? [{ id: CARD_ID, name: 'Card', props: { title: 'text', summary: 'text' } }] : [],
  }
}

function job(brief: Brief, kind: 'page' | 'layout', id: string, screen: AiBuildPlanScreen | null): AiJob {
  const plan = {
    reuse: [{ kind: 'form', id: FORM_ID, purpose: 'the form this site’s pages are built on' }],
    create: kind === 'layout' ? [{ kind: 'layout', name: 'Main Layout', why: 'header and footer', duplicateOf: null, fields: ['header', 'nav', 'main', 'footer'] }] : [],
    screens: screen ? [screen] : [],
    status: 'confirmed',
    labels: { [FORM_ID]: 'Contact Request Form' },
  } as unknown as AiJobPlan
  return {
    $id: id,
    orgId: 'org-live',
    hostId: 'host-live',
    kind,
    status: 'running',
    brief: [
      `A ${planned(brief).length}-page website for ${brief.businessType} called ${brief.name}. It is for ${brief.audience}.`,
      `Site — name: ${brief.name}; business: ${brief.businessType}; for: ${brief.audience}; city: ${brief.city}.`,
      screen ? `Build the page “${screen.title}” of this site, at ${screen.slug}.` : 'Build the layout “Main Layout”.',
    ].join('\n'),
    inputs: {
      businessName: brief.name,
      businessType: brief.businessType,
      audience: brief.audience,
      city: brief.city,
      sitePages: planned(brief),
      [AI_LAYOUT_LANGUAGE_INPUT]: true,
      [AI_LAYOUT_FORM_PAGE_INPUT]: `${brief.key}-contact`,
    },
    plan,
    steps: [],
    outputs: [],
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

interface Result {
  name: string
  status: string
  calls: number
  attempts: number
  outputTokens: number[]
  cutOffs: number
  estCostUsd: number
  credits: number
  findings: string[]
  settled: number
}

function record(name: string, prompt: string, before: number, result: { status: string; estCostUsd: number; attempts: number } & Record<string, unknown>): Result {
  const calls = mockCalls.slice(before).filter((call) => call.prompt === prompt)
  return {
    name,
    status: result.status,
    calls: calls.length,
    attempts: result.attempts,
    outputTokens: calls.map((call) => Number(call.usage['outputTokens'] ?? 0)),
    cutOffs: calls.filter((call) => call.stopReason === 'max_tokens').length,
    estCostUsd: result.estCostUsd,
    credits: assistCreditsFromUsd(result.estCostUsd),
    findings:
      result.status === 'needs_input'
        ? ((result['violations'] as Array<{ code: string; message: string }>) ?? []).map((violation) => `${violation.code}: ${violation.message}`)
        : [],
    settled: result.status === 'ok' ? (((result['value'] as { settled?: unknown[] })?.settled ?? []).length) : 0,
  }
}

async function buildPage(brief: Brief, index: number): Promise<Result> {
  const page = brief.pages[index]
  const screen = {
    id: `${brief.key}-p${index}`,
    title: page.title,
    slug: page.slug,
    layout: LAYOUT_ID,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: page.title,
    seoDescription: page.title,
    sections: page.sections.map((section) => (ORG_PLAN === 'business' && section.items ? { ...section, uses: [CARD_ID] } : section)),
    record: null,
  } as unknown as AiBuildPlanScreen
  const unit = job(brief, 'page', `job-live-${brief.key}-p${index}`, screen)
  const site = inventory()
  const reusableComponents = aiBuildsWithComponents({ plan: ORG_PLAN } as Partial<AglynOrgBilling>)
  const sectionIds = screen.sections.map((_, position) => aiPageSectionNodeId(unit.$id, position))
  const { linkablePages } = aiPageLinkablePages(site, planned(brief), [screen.id])
  const context = {
    ...aiPageCheckContext(site, { reusableComponents, sections: screen.sections.map((section) => section.name), linkablePages }),
    codeBuilt: true,
  }
  const targets = aiLayoutPageTargets({ job: unit, inventory: site, own: [screen.id] })
  const prompt = aiLayoutPagePrompt({ job: unit, plan: unit.plan as AiJobPlan, screen, targets, reusableComponents })
  const model = MODEL ?? aiModelForStep('job.page')
  const before = mockCalls.length
  const result = await runValidatedGeneration<AiLayoutPageBuilt>(AI_LAYOUT_PAGE_KIND, {
    step: 'job.page',
    model,
    instructions: AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS,
    inventory: site,
    messages: [{ role: 'user', content: prompt }],
    tool: AI_LAYOUT_PAGE_TOOL,
    maxTokens: AI_JOB_PAGE_LANGUAGE_BUDGET.maxTokens(model),
    cutOff: { noun: 'page', smaller: 'Write shorter copy, and fewer items in each group.' },
    thinking: 'off',
    check: aiLayoutPageCheck({ screen, sectionIds, targets, context, reusableComponents }),
  })
  if (OUT && result.status === 'needs_input') {
    writeFileSync(join(OUT, `${brief.key}-${page.title.toLowerCase()}.refused.json`), JSON.stringify(result.answer, null, 1))
  }
  if (OUT && result.status === 'ok') {
    writeFileSync(join(OUT, `${brief.key}-${page.title.toLowerCase()}.json`), JSON.stringify({ name: `${brief.key}-${page.title}`, nodes: result.value.nodes }, null, 1))
  }
  return record(`${brief.key} / ${page.title}`, prompt, before, result as never)
}

async function buildFrame(brief: Brief): Promise<Result> {
  const unit = job(brief, 'layout', `job-live-${brief.key}-layout`, null)
  const site = inventory()
  const siteName = aiLayoutSiteName(unit)
  const pages = aiLayoutNavPages(unit, site)
  const targets = aiLayoutFrameTargets(unit, site)
  const prompt = aiLayoutFramePrompt({ job: unit, siteName, pages, targets })
  const model = MODEL ?? aiModelForStep('job.layout')
  const before = mockCalls.length
  const result = await runValidatedGeneration<AiLayoutFrameBuilt>(AI_LAYOUT_FRAME_KIND, {
    step: 'job.layout',
    model,
    instructions: AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS,
    inventory: site,
    messages: [{ role: 'user', content: prompt }],
    tool: AI_LAYOUT_FRAME_TOOL,
    maxTokens: AI_JOB_LAYOUT_LANGUAGE_BUDGET.maxTokens(model),
    thinking: 'off',
    check: aiLayoutFrameCheck({
      siteName,
      homeId: aiLayoutHomeId(pages, site),
      pages,
      targets,
      extend: aiLayoutChecks(site, unit.plan as AiJobPlan, unit.brief),
    }),
  })
  if (OUT && result.status === 'ok') {
    writeFileSync(join(OUT, `${brief.key}-layout.json`), JSON.stringify({ name: `${brief.key}-layout`, rootId: result.value.rootId, nodes: result.value.nodes }, null, 1))
  }
  return record(`${brief.key} / header+footer`, prompt, before, result as never)
}

const describeLive = LIVE ? describe : describe.skip

describeLive('six guided starts designed by the real model in the layout language', () => {
  jest.setTimeout(15 * 60_000)

  it('builds every page and every header and footer with no refusal', async () => {
    if (OUT) mkdirSync(OUT, { recursive: true })
    const results = await Promise.all(
      BRIEFS.flatMap((brief) => [buildPage(brief, 0), buildPage(brief, 1), buildFrame(brief)]),
    )
    const pages = results.filter((result) => !result.name.endsWith('header+footer'))
    const frames = results.filter((result) => result.name.endsWith('header+footer'))
    const sum = (list: Result[], pick: (result: Result) => number) => list.reduce((total, result) => total + pick(result), 0)
    const table = {
      orgPlan: ORG_PLAN,
      model: MODEL ?? aiModelForStep('job.page'),
      pagesBuilt: `${pages.filter((result) => result.status === 'ok').length}/${pages.length}`,
      framesBuilt: `${frames.filter((result) => result.status === 'ok').length}/${frames.length}`,
      firstTry: `${results.filter((result) => result.attempts === 1 && result.status === 'ok').length}/${results.length}`,
      cutOffs: sum(results, (result) => result.cutOffs),
      estCostUsd: Number(sum(results, (result) => result.estCostUsd).toFixed(4)),
      creditsPerPage: pages.map((result) => result.credits),
      creditsPerFrame: frames.map((result) => result.credits),
      outputTokensPerPage: pages.map((result) => result.outputTokens),
      outputTokensPerFrame: frames.map((result) => result.outputTokens),
      results,
    }
    console.log(JSON.stringify(table, null, 1))
    expect(results.filter((result) => result.status !== 'ok').map((result) => [result.name, result.findings])).toEqual([])
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
