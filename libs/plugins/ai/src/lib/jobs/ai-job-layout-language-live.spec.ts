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
 * Twelve guided starts' looks, pages and frames designed by the REAL model and
 * compiled (AGL-3660): for each brief its look (the base theme and the site's
 * own choices over it), its Home page, one more page, its Contact page, and
 * its header and footer — through the same prompt, tool, ceiling, re-ask and
 * check the look, the page step and the layout step run. The briefs span ten
 * kinds of site, and two of them are one brief run twice, which must still
 * come out as two different looks. Every page must be built with no refusal,
 * and a run prints a table: each page's calls, output tokens, credits and
 * anything it settled, and each look's tokens and credits.
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

/**
 * The platform's base themes as the themes plugin lists them, read from its
 * source by path (one plugin's spec never imports another plugin): the look
 * is offered them by name and description, as the server offers them.
 */
jest.mock('@aglyn/aglyn/plugin-manager/plugin-theme-presets', () => {
  const { readFileSync } = jest.requireActual('node:fs')
  const { join } = jest.requireActual('node:path')
  const text = readFileSync(join(__dirname, '../../../../themes/src/lib/presets/index.ts'), 'utf8') as string
  const presets = [...text.matchAll(/id: `\$\{BUNDLE_ID\}\.([a-z0-9-]+)`,\s*name: '([^']+)',\s*description: '([^']+)'/g)].map(
    (match) => ({ id: `theme-presets.${match[1]}`, name: match[2], description: match[3], theme: {} }),
  )
  return { __esModule: true, listServerThemePresets: () => presets }
})
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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_LAYOUT_FRAME_TOOL } from '../layout-language/ai-layout-language'
import type { AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiSiteKindFor, aiSiteStyleTokens } from '../model/ai-site-kinds'
import type { AiSiteStyle } from '../model/ai-site-look'
import { aiRunSiteLook } from './ai-job-site-look'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiResolveLayoutPictures } from '../layout-language/ai-layout-pictures'
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
  AI_LAYOUT_FORM_PAGE_INPUT,
  AI_LAYOUT_LANGUAGE_INPUT,
  aiLayoutPagePrompt,
  aiLayoutPageTargets,
  aiRunLayoutPage,
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

/** Twelve guided starts, each a Home page and the page the brief most needs, with a Contact page holding the form. */
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
  {
    key: 'portfolio',
    name: 'Mara Okafor Illustration',
    businessType: 'an illustrator portfolio for picture books and editorial work',
    audience: 'art directors and publishers',
    city: 'Chicago',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Statement'), s('Selected work', 6), s('Clients and press', 4), s('Commission me')] },
      { title: 'Work', slug: '/work', sections: [s('Picture books', 4), s('Editorial', 4), s('Process')] },
    ],
  },
  {
    key: 'blog',
    name: 'Salt & Season',
    businessType: 'a food blog about weeknight cooking',
    audience: 'busy home cooks',
    city: 'Minneapolis',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Welcome'), s('Latest recipes', 4), s('Topics', 5), s('Get new recipes')] },
      { title: 'Articles', slug: '/articles', sections: [s('Articles intro'), s('Featured articles', 6), s('Browse by topic', 5)] },
    ],
  },
  {
    key: 'store',
    name: 'Wick & Grain',
    businessType: 'an online store for hand-poured soy candles',
    audience: 'people buying gifts',
    city: 'Asheville',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Bestsellers', 4), s('How we make them', 3), s('Gift sets')] },
      { title: 'Shop', slug: '/shop', sections: [s('Shop intro'), s('Collections', 6), s('Care and shipping', 4)] },
    ],
  },
  {
    key: 'towing',
    name: 'Rapid Hook Towing',
    businessType: 'a 24-hour towing and roadside assistance company',
    audience: 'drivers stranded on the highway',
    city: 'Phoenix',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Services', 4), s('Why drivers call us', 3), s('Call for a tow')] },
      { title: 'Services', slug: '/services', sections: [s('Roadside services', 5), s('Service area'), s('Common questions', 4)] },
    ],
  },
  {
    key: 'therapist',
    name: 'Quiet Harbor Counseling',
    businessType: 'a licensed counselor for anxiety and life transitions',
    audience: 'adults looking for their first therapist',
    city: 'Seattle',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Welcome'), s('How I can help', 3), s('What a first session is like', 3), s('Book a free consultation')] },
      { title: 'Approach', slug: '/approach', sections: [s('My approach'), s('Areas of focus', 4), s('Questions people ask', 4)] },
    ],
  },
  {
    key: 'photographer',
    name: 'Juniper Lane Photography',
    businessType: 'a wedding and portrait photographer',
    audience: 'engaged couples',
    city: 'Nashville',
    pages: [
      { title: 'Home', slug: '/', sections: [s('Hero'), s('Galleries', 4), s('About me'), s('Check your date')] },
      { title: 'Galleries', slug: '/galleries', sections: [s('Weddings', 4), s('Portraits', 4), s('What to expect', 3)] },
    ],
  },
]

/**
 * The roofer's brief again under another job (AGL-3660): the same words and
 * the same kind, and a different seed, so the run shows two looks from one
 * brief side by side.
 */
const TWINS: readonly Brief[] = [{ ...(BRIEFS.find((brief) => brief.key === 'roofer') as Brief), key: 'roofer-twin' }]
/** `AGLYN_LIVE_AI_BRIEFS=roofer,towing` runs only those briefs. */
const ONLY = (process.env['AGLYN_LIVE_AI_BRIEFS'] ?? '').split(',').map((key) => key.trim()).filter(Boolean)
const ALL_BRIEFS: readonly Brief[] = [...BRIEFS, ...TWINS].filter((brief) => !ONLY.length || ONLY.includes(brief.key))

/** Each brief's kind, as the guided start suggests it from what the site is for. */
const kindOf = (brief: Brief) => aiSiteKindFor(brief.businessType).id

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

/** Each brief's look, once designed, which its pages and frame are built in (AGL-3660). */
const LOOKS = new Map<string, AiSiteStyle | null>()

function job(brief: Brief, kind: 'page' | 'layout', id: string, screen: AiBuildPlanScreen | null): AiJob {
  const look = LOOKS.get(brief.key)
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
      siteKind: kindOf(brief),
      ...(look ? { siteStyle: { headerAlign: look.headerAlign, rhythm: look.rhythm } } : {}),
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
  dropped: string[]
  /** Each section's planned items and the items it shows, as `shown/planned` (AGL-3660). */
  items?: string[]
}

function record(name: string, prompt: string, before: number, result: { status: string; estCostUsd: number; attempts: number } & Record<string, unknown>): Result {
  const calls = mockCalls.slice(before).filter((call) => call.prompt.startsWith(prompt))
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
    // What the last answer's gaps took out (`ai-layout-gaps.ts`), as text, for the run's report.
    dropped: result.status === 'ok' ? ((result['value'] as { dropped?: string[] })?.dropped ?? []) : [],
  }
}

/**
 * Every brief's Contact page, which holds the site's form: where a model is
 * most tempted to write a phone number, an address or the hours the brief
 * never gave, or a link's reference into its copy.
 */
const CONTACT_PAGE: Brief['pages'][number] = {
  title: 'Contact',
  slug: '/contact',
  sections: [s('Get in touch'), s('Send a message'), s('Other ways to reach us')],
}

/** A brief's page by its index; -1 is its Contact page. */
async function buildPage(brief: Brief, index: number): Promise<Result> {
  const page = index === -1 ? CONTACT_PAGE : brief.pages[index]
  const screen = {
    id: index === -1 ? `${brief.key}-contact` : `${brief.key}-p${index}`,
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
  const unit = job(brief, 'page', `job-live-${screen.id}`, screen)
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
  let attempt = 0
  // The page step's own pass: one answer, its re-ask, and a follow-up for a section left out.
  const result = await aiRunLayoutPage({
    job: unit,
    plan: unit.plan as AiJobPlan,
    screen,
    sectionIds,
    targets,
    context,
    reusableComponents,
    inventory: site,
    model,
    observe: (check) => (answer) => {
      attempt += 1
      const checked = check(answer)
      if (OUT) writeFileSync(join(OUT, `${brief.key}-${page.title.toLowerCase()}.answer-${attempt}.json`), JSON.stringify(answer, null, 1))
      if (OUT && checked.violations.length) {
        writeFileSync(
          join(OUT, `${brief.key}-${page.title.toLowerCase()}.refused-${attempt}.json`),
          JSON.stringify({ answer, violations: checked.violations }, null, 1),
        )
      }
      return checked
    },
  })
  if (OUT && result.status === 'needs_input') {
    writeFileSync(join(OUT, `${brief.key}-${page.title.toLowerCase()}.refused.json`), JSON.stringify(result.answer, null, 1))
  }
  if (OUT && result.status === 'ok') {
    // The page step fills each picture slot with a photo the site serves itself, after the check.
    const nodes = await aiResolveLayoutPictures(result.value.nodes, {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      sectionIds,
      sectionNames: screen.sections.map((section) => section.name),
      seed: `${unit.$id}:${screen.id}`,
    })
    writeFileSync(join(OUT, `${brief.key}-${page.title.toLowerCase()}.json`), JSON.stringify({ name: `${brief.key}-${page.title}`, nodes }, null, 1))
  }
  const recorded = record(`${brief.key} / ${page.title}`, prompt, before, result as never)
  if (result.status === 'ok') {
    recorded.items = screen.sections.map((section, index) => `${result.value.items[index] ?? 0}/${section.items}`)
  }
  return recorded
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
      ...aiSiteStyleTokens(unit.inputs),
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

interface LookResult extends Result {
  style: AiSiteStyle | null
}

/** A brief's look: the real look pass, saved nowhere but here. */
async function buildLook(brief: Brief): Promise<LookResult> {
  const unit = { ...job(brief, 'layout', `job-live-${brief.key}`, null), kind: 'theme' } as AiJob
  let style: AiSiteStyle | null = null
  const before = mockCalls.length
  const outcome = await aiRunSiteLook(
    { job: unit, stepIndex: 0, now: NOW, firestore: {} as never, ...(MODEL ? { modelFor: () => MODEL } : {}) },
    unit,
    {
      // Each brief a customer of its own: drawn apart from no other site.
      others: async () => [],
      save: async (_firestore, input) => {
        style = input.style
        return { write: 'applied', baseName: input.style.base }
      },
    },
  )
  // The looks run side by side: this brief's call is the one that names this business and this seed.
  const calls = mockCalls
    .slice(before)
    .filter((call) => call.prompt.startsWith('Kind of site:') && call.prompt.includes(`Design seed: ${unit.$id.slice(-6)}.`))
  return {
    name: `${brief.key} / look`,
    status: outcome.outputs.length ? 'ok' : outcome.refused ? 'refused' : 'failed',
    calls: calls.length,
    attempts: calls.length,
    outputTokens: calls.map((call) => Number(call.usage['outputTokens'] ?? 0)),
    cutOffs: calls.filter((call) => call.stopReason === 'max_tokens').length,
    estCostUsd: outcome.estCostUsd,
    credits: assistCreditsFromUsd(outcome.estCostUsd),
    findings: outcome.failure ? [outcome.failure] : [],
    settled: 0,
    dropped: [],
    style,
  }
}

const describeLive = LIVE ? describe : describe.skip

describeLive('six guided starts designed by the real model in the layout language', () => {
  jest.setTimeout(15 * 60_000)

  it('builds every page and every header and footer with no refusal', async () => {
    if (OUT) mkdirSync(OUT, { recursive: true })
    const looks = await Promise.all(ALL_BRIEFS.map((brief) => buildLook(brief)))
    ALL_BRIEFS.forEach((brief, index) => LOOKS.set(brief.key, looks[index].style))
    const built = await Promise.all(
      ALL_BRIEFS.flatMap((brief) => [buildPage(brief, 0), buildPage(brief, 1), buildPage(brief, -1), buildFrame(brief)]),
    )
    const results: Result[] = [...looks, ...built]
    const pages = built.filter((result) => !result.name.endsWith('header+footer'))
    const frames = built.filter((result) => result.name.endsWith('header+footer'))
    if (OUT) {
      // Each brief as one site for `render-layout-shots.mts`: its frame, its Home and its look.
      for (const [index, brief] of ALL_BRIEFS.entries()) {
        const read = (file: string) => {
          try {
            return JSON.parse(readFileSync(join(OUT, file), 'utf8')) as { nodes: unknown }
          } catch {
            return null
          }
        }
        const frame = read(`${brief.key}-layout.json`)
        const home = read(`${brief.key}-home.json`)
        if (!frame || !home) continue
        writeFileSync(
          join(OUT, `${brief.key}-site.json`),
          JSON.stringify({ name: brief.name, kind: kindOf(brief), nodes: frame.nodes, page: home.nodes, style: looks[index].style }, null, 1),
        )
      }
    }
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
      creditsPerLook: looks.map((result) => result.credits),
      itemsPerSection: Object.fromEntries(pages.map((result) => [result.name, (result.items ?? []).join(' ')])),
      looks: looks.map((result, index) => {
        const style = result.style as AiSiteStyle | null
        return {
          brief: ALL_BRIEFS[index].key,
          kind: kindOf(ALL_BRIEFS[index]),
          base: style?.base,
          hue: style?.hue,
          accent: style?.accent,
          fonts: style?.fonts,
          corners: style?.corners,
          buttons: style?.buttons,
          cards: style?.cards,
          fields: style?.fields,
          eyebrow: style?.eyebrow,
          header: style?.header,
          headerAlign: style?.headerAlign,
          rhythm: style?.rhythm,
          ground: style?.ground,
        }
      }),
      outputTokensPerPage: pages.map((result) => result.outputTokens),
      outputTokensPerFrame: frames.map((result) => result.outputTokens),
      results,
    }
    console.log(JSON.stringify(table, null, 1))
    expect(results.filter((result) => result.status !== 'ok').map((result) => [result.name, result.findings])).toEqual([])
    // One brief run twice is two looks, never one.
    const twin = looks[ALL_BRIEFS.findIndex((brief) => brief.key === 'roofer-twin')].style
    const roofer = looks[ALL_BRIEFS.findIndex((brief) => brief.key === 'roofer')].style
    expect(twin && roofer && JSON.stringify({ ...twin, seed: 0 }) !== JSON.stringify({ ...roofer, seed: 0 })).toBe(true)
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
