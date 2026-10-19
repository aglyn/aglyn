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
 * Sites I like (AGL-3975), planned, designed and built by the REAL model from
 * RECORDED pages. `ai-site-inspiration.spec.ts` holds every prompt byte on a
 * double; this one sends six guided starts through the real plan step and
 * the real look — the real prompt, provider, re-ask and plan rules — with the
 * sites read through the `readPage` seam from the three recordings in
 * `fixtures/ai-site-inspiration/`, so no page is fetched:
 *
 *   1. a paid photography start and the portfolio recording;
 *   2. a paid restaurant start and the restaurant recording;
 *   3. a paid business start and the software landing page;
 *   4. a paid start with all three, which the agreement vote decides;
 *   5. a Free start and the restaurant recording: structure only, no features;
 *   6. the control: case 2's brief with no sites.
 *
 * Then cases 2 and 5 are built, page by page, as the site step builds them
 * (`aiSiteUnitJob` → the layout-language page pass), so their pages can be
 * read. Each table reports what a person judges — the order the home
 * follows, the look's pinned dimensions, the features each paid plan placed
 * with Aglyn's own parts — and the spec holds what may never happen: a
 * word, picture, name or address of a recording in any prompt, plan, look or
 * page; a testimonials section on a site with no customer words; features on
 * Free; a pinned dimension the look did not keep.
 *
 * It calls the provider and costs real money (one pass of all three parts
 * came to about $0.35 at list rates, unbatched, on 2026-10-19: $0.16 for the
 * six plans and looks, $0.13 and $0.05 for the two builds), so it runs only
 * when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, and
 * the live launcher's mark so `jest.setup.js` keeps the key read from `.env`:
 *
 *   AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     npx jest -c libs/plugins/ai/jest.config.ts libs/plugins/ai/src/lib/jobs/ai-site-inspiration-live.spec.ts
 *
 * `-t 'cases 1-6'`, `-t 'builds case 2'` and `-t 'builds case 5'` run one
 * part each. Under the launcher a request answered before is replayed from
 * `.cache/ai-replay` for nothing, so a build reads the plan and the look its
 * plan run already paid for. `AGLYN_LIVE_AI_BATCH=0` asks each request at
 * once, at full price, for a part that must end in minutes.
 *
 * THE CAP: `AGLYN_LIVE_AI_CAP_USD` (default 2.50) is the most the round may
 * spend at the provider's list rates, and `AGLYN_LIVE_AI_SPENT_USD` is what
 * the round's earlier runs already spent (their `run.liveProviderUsd`). No
 * request is sent once the two together come within
 * {@link IN_FLIGHT_MARGIN_USD} of the cap, which leaves room for the
 * requests already asked.
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
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({ __esModule: true, dropPluginSiteCache: jest.fn(async () => undefined) }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
  registerAiJobStepPasses: jest.fn(),
  registerAiJobAdmission: jest.fn(),
}))

/** Every model call: the case it was asked for, its tools, its first message and what it used. */
const mockCalls: Array<{ tag: string; tools: string[]; model: string; prompt: string; stopReason: string | null; usage: Record<string, number> }> = []
jest.mock('../runtime/ai-runtime', () => {
  const actual = jest.requireActual('../runtime/ai-runtime')
  return {
    __esModule: true,
    ...actual,
    runAiRequest: async (input: { model: string; tools?: Array<{ name: string }>; messages: Array<{ content: unknown }> }) => {
      const tag = mockCaseTag.getStore() ?? 'untagged'
      mockSpendGuard()
      const result = await actual.runAiRequest(input)
      mockCalls.push({
        tag,
        tools: (input.tools ?? []).map((tool) => tool.name),
        model: input.model,
        prompt: String(input.messages[0]?.content ?? ''),
        stopReason: result.stopReason ?? null,
        usage: result.usage,
      })
      return result
    },
  }
})

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { buildPageMarkdown } from '@aglyn/aglyn/app-utils/page-markdown'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_LAYOUT_FRAME_TOOL } from '../layout-language/ai-layout-language'
import { aiPlanEmbedsFor } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiSitePlanIsHome } from '../model/ai-site-job'
import { aiSiteKind, aiSiteStyleTokens } from '../model/ai-site-kinds'
import { aiSiteSeed, type AiSiteStyle } from '../model/ai-site-look'
import { AI_SITE_START_ANSWERS, aiSiteStartBrief, aiSiteStartInputs, type AiSiteStartAnswers } from '../model/ai-site-start'
import { aiProviderRatesForModel, estimateAiProviderCostUsd } from '../providers/catalog'
import { aiCacheWriteHourSurchargeUsd } from '../providers/cache-write-hour'
import { aiModelForStep } from '../providers/routing'
import { runValidatedGeneration } from '../runtime/ai-doctrine'
import { aiLiveTimeoutMs } from '../runtime/ai-dev-env'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiBuildsWithComponents, aiPlanCapabilitiesFrom } from './ai-job-drafts'
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
import { aiLayoutSitePages } from './ai-job-layout-site-pages'
import { aiLayoutChecks } from './ai-job-layout-step'
import { AI_LAYOUT_LANGUAGE_THINKING, aiLayoutListingContext, aiLayoutPageTargets, aiRunLayoutPage } from './ai-job-page-language'
import { aiPageCheckContext, aiPageLinkablePages, aiPageSectionNodeId } from './ai-job-page-sections'
import { createAiJobPlanStep } from './ai-job-plan-step'
import { aiRunSiteLook } from './ai-job-site-look'
import { aiSiteBuiltRefs, aiSiteJobUnits, aiSiteUnitJob, type AiSiteUnit } from './ai-job-site-step'
import {
  AI_SITE_INSPIRATION_FEATURE_PARTS,
  AI_SITE_INSPIRATION_SECTION_WORDS,
  aiSiteInspirationLookPins,
  createAiSiteInspirationReader,
  type AiSiteInspirationPageReader,
} from './ai-site-inspiration'
import type { AiSiteInspirationFeature, AiSiteInspirationSection } from './ai-site-inspiration-signals'
import {
  AI_INSPIRATION_PORTFOLIO,
  AI_INSPIRATION_RECORDINGS,
  AI_INSPIRATION_RESTAURANT,
  AI_INSPIRATION_SAAS,
  type AiSiteInspirationRecording,
} from './fixtures/ai-site-inspiration-pages'

/** The case each request is asked for, kept across the awaits of cases run side by side. */
const mockCaseTag = new AsyncLocalStorage<string>()

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
// A fixed day (AGL-3781): a plan's prompt states today's date, and a date
// that moved every run gave each run new request bytes, so the replay cache
// answered none of them.
const NOW = new Date('2026-10-19T12:00:00Z')

/** The most the round may spend, at the provider's list rates. */
const CAP_USD = Number(process.env['AGLYN_LIVE_AI_CAP_USD'] || '2.5')
/** What the round's earlier runs already spent. */
const SPENT_USD = Number(process.env['AGLYN_LIVE_AI_SPENT_USD'] || '0')
/** Room under the cap for the requests already asked when the guard closes. */
const IN_FLIGHT_MARGIN_USD = 0.35

/** No request is sent once what the round spent comes within the margin of its cap. */
function mockSpendGuard(): void {
  const spent = SPENT_USD + aiLiveRunLedger().liveProviderUsd
  if (spent + IN_FLIGHT_MARGIN_USD > CAP_USD) {
    throw new Error(`the round's cap: $${spent.toFixed(4)} spent of $${CAP_USD.toFixed(2)}, so no further request is sent`)
  }
}

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const PROVISIONED: AiSiteInventory = {
  ...emptyAiSiteInventory('host-live'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scrStarter', name: 'Home', slug: '/', layoutId: 'laySite', template: false, replaceable: true }],
}

interface Case {
  key: string
  /** The case's number in PR #1810's list. */
  n: number
  orgPlan: 'business' | 'free'
  businessName: string
  siteType: string
  audience: string
  kind: string
  sites: readonly AiSiteInspirationRecording[]
}

const RESTAURANT_BRIEF = {
  businessName: 'Casa Brava Cocina',
  siteType: 'a family-run Mexican restaurant in Denver with handmade tortillas, a weekend brunch and a small private room',
  audience: 'locals booking dinner, weekend brunch and small private parties',
  kind: 'restaurant',
} as const

/** The six starts PR #1810 names, invented businesses each, the recordings as the sites they like. */
const CASES: readonly Case[] = [
  {
    key: 'c1-photography',
    n: 1,
    orgPlan: 'business',
    businessName: 'Fern & Field Photography',
    siteType: 'a wedding and family photographer in Asheville who shoots outdoors in natural light',
    audience: 'engaged couples and young families comparing photographers',
    kind: 'photography',
    sites: [AI_INSPIRATION_PORTFOLIO],
  },
  { key: 'c2-restaurant', n: 2, orgPlan: 'business', ...RESTAURANT_BRIEF, sites: [AI_INSPIRATION_RESTAURANT] },
  {
    key: 'c3-business',
    n: 3,
    orgPlan: 'business',
    businessName: 'Tallyworks',
    siteType: 'a software company whose app tracks inventory and reorders for independent craft breweries',
    audience: 'brewery owners and taproom managers who count kegs on clipboards',
    kind: 'business',
    sites: [AI_INSPIRATION_SAAS],
  },
  {
    key: 'c4-all-three',
    n: 4,
    orgPlan: 'business',
    businessName: 'Rise & Ritual Bakehouse',
    siteType: 'a neighborhood bakery and coffee bar in Minneapolis with sourdough, pastries and custom cakes',
    audience: 'neighbors on their morning commute and people ordering a cake for a celebration',
    kind: 'restaurant',
    sites: [AI_INSPIRATION_PORTFOLIO, AI_INSPIRATION_RESTAURANT, AI_INSPIRATION_SAAS],
  },
  { key: 'c5-free-restaurant', n: 5, orgPlan: 'free', ...RESTAURANT_BRIEF, sites: [AI_INSPIRATION_RESTAURANT] },
  { key: 'c6-control', n: 6, orgPlan: 'business', ...RESTAURANT_BRIEF, sites: [] },
]

const orgOf = (entry: Case): Partial<AglynOrgBilling> & { ownerUid: string } => ({ plan: entry.orgPlan, ownerUid: 'owner-1' })
const pagesOf = (entry: Case) => (entry.orgPlan === 'business' ? 5 : 2)

/** Every distinct value a recording would leak: its sentences, names, picture files and alt texts, its address. */
function leaksOf(recording: AiSiteInspirationRecording): string[] {
  const sentences = recording.page.html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.replace(/&amp;/g, '&').trim())
    // A line of five words or more is a sentence of theirs; shorter lines are headings like "Pricing".
    .filter((line) => line.split(/\s+/).length >= 5)
  const pictures = [...recording.page.html.matchAll(/\b(?:src|alt)\s*=\s*"([^"]+)"/g)].map((match) => match[1] as string)
  return [...new Set([...recording.never, ...sentences, ...pictures, recording.url, new URL(recording.url).hostname])]
}

/** What of every recording a text holds, case-insensitively: one leak is a failure. */
function leaksIn(text: string): string[] {
  const lower = text.toLowerCase()
  return AI_INSPIRATION_RECORDINGS.flatMap((recording) => leaksOf(recording).filter((leak) => lower.includes(leak.toLowerCase())))
}

/** The kind of section a planned name reads as, first match wins: for the report, never held. */
const SECTION_KIND_WORDS: ReadonlyArray<[AiSiteInspirationSection, RegExp]> = [
  ['hero', /\bhero\b|welcome|intro|banner/i],
  ['booking', /\bbook|reserv|appointment|schedul/i],
  ['menu', /\bmenu\b|dishes|food and drink/i],
  ['testimonials', /testimonial|\breviews?\b|kind words|what .* say|feedback/i],
  ['events', /\bevent|calendar|upcoming|happening/i],
  ['newsletter', /newsletter|subscribe|sign[- ]?up|mailing list|updates/i],
  ['gallery', /galler(y|ies)|portfolio|photos|pictures|selected work|our work|recent work/i],
  ['pricing', /pricing|prices|\bplans\b|packages|rates|investment/i],
  ['faq', /\bfaq|questions/i],
  ['steps', /how it works|steps|process|what to expect/i],
  ['stats', /numbers|stats|results/i],
  ['logos', /clients|partners|trusted|logos|as seen/i],
  ['about', /about|story|meet|who we are|philosophy|approach/i],
  ['team', /team|staff|chef/i],
  ['features', /services|features|what .* does|what we (do|offer)|offerings|benefits|capabilities|specialt/i],
  ['blog', /blog|posts|journal|articles|news/i],
  ['contact', /contact|get in touch|visit|find us|location|hours|inquir|enquir/i],
  ['cta', /call to action|get started|ready|\bstart\b|cta|closing/i],
]
const sectionKindOf = (name: string): AiSiteInspirationSection | null => SECTION_KIND_WORDS.find(([, words]) => words.test(name))?.[0] ?? null

/** How much of a site's order a home keeps: the longest run of its kinds in order, over the site's count. */
function orderKept(planned: readonly (string | null)[], site: readonly string[]): string {
  const rows = planned.length
  const cols = site.length
  const table = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      table[i][j] = planned[i - 1] && planned[i - 1] === site[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1])
    }
  }
  return `${table[rows][cols]}/${cols}`
}

/** The words a plan section shows for each feature the person's sites offer. */
const FEATURE_WORDS: Readonly<Record<AiSiteInspirationFeature, RegExp>> = {
  booking: /\bbook|reserv|appointment|schedul/i,
  store: /shop|store|product/i,
  blog: /blog|posts|journal|articles|news|stories/i,
  forms: /contact|form|get in touch|inquir|enquir|request/i,
  gallery: /galler(y|ies)|portfolio|photos|pictures|selected work|our work/i,
  events: /\bevent|calendar|upcoming/i,
  menu: /\bmenu\b|dishes/i,
  testimonials: /testimonial|\breviews?\b|what .* say|feedback/i,
  newsletter: /newsletter|subscribe|sign[- ]?up|mailing list|updates/i,
}

/** The seeded home arc's sentence (AGL-3899), which a site's order takes the place of. */
const HOME_ARC = "This site's home tells its story in its own order"

/** Each site's order as its line in the block told it, back in the closed set's kinds. */
function toldOrders(prompt: string): AiSiteInspirationSection[][] {
  const kinds = new Map(
    (Object.entries(AI_SITE_INSPIRATION_SECTION_WORDS) as Array<[AiSiteInspirationSection, string]>).map(([kind, words]) => [words, kind]),
  )
  return [...prompt.matchAll(/^Site \d+ sections, top to bottom: (.+)\.$/gm)].map((match) =>
    (match[1] as string).split(', ').flatMap((words) => (kinds.has(words) ? [kinds.get(words) as AiSiteInspirationSection] : [])),
  )
}

const TESTIMONIALS = /testimonial|\breviews?\b|what .* (say|are saying)|kind words|client feedback|guest feedback/i

/** Provider dollars a call came to at list rates, as the run's ledger counts a live one. */
function callUsd(call: (typeof mockCalls)[number]): number {
  const usage = call.usage as never
  return estimateAiProviderCostUsd(usage, call.model) + aiCacheWriteHourSurchargeUsd(usage, aiProviderRatesForModel(call.model))
}

const usdOf = (tag: string, tool?: (tools: string[]) => boolean) =>
  Number(
    mockCalls
      .filter((call) => call.tag === tag && (!tool || tool(call.tools)))
      .reduce((total, call) => total + callUsd(call), 0)
      .toFixed(4),
  )

const isPlanCall = (tools: string[]) => tools.includes('submit_build_plan')

/**
 * The plan with the ids it was kept under made the same on every run: the
 * step mints a fresh id for each page and creation as it keeps a plan, and a
 * page's prompt names them (its own, the pages it may link), so a build run
 * again asked every page anew instead of reading it from the replay cache.
 */
function stableDraftIds(entry: Case, plan: AiJobPlan | null): AiJobPlan | null {
  if (!plan) return null
  const id = (what: string) => createHash('sha256').update(`${entry.key}:${what}`).digest('hex').slice(0, 10)
  return {
    ...plan,
    create: plan.create.map((creation, index) => (creation.id ? { ...creation, id: id(`create:${index}`) } : creation)),
    screens: plan.screens.map((screen, index) => (screen.id ? { ...screen, id: id(`screen:${index}`) } : screen)),
  }
}

interface Planned {
  entry: Case
  job: AiJob
  plan: AiJobPlan | null
  prompt: string
  reads: string[]
  outcome: Record<string, unknown>
}

const PLANS = new Map<string, Promise<Planned>>()

/** A case's plan through the real plan step, its sites read from the recordings; once per process. */
function planOf(entry: Case): Promise<Planned> {
  const known = PLANS.get(entry.key)
  if (known) return known
  const planned = mockCaseTag.run(entry.key, async (): Promise<Planned> => {
    const org = orgOf(entry)
    const answers: AiSiteStartAnswers = {
      // The business details (AGL-3979) left as the defaults hold them: none given.
      ...AI_SITE_START_ANSWERS,
      siteType: entry.siteType,
      audience: entry.audience,
      example: null,
      kind: entry.kind,
      pages: pagesOf(entry),
      submissions: 'inbox',
      welcomeEmail: false,
      ...(entry.sites.length ? { inspiration: entry.sites.map((site) => site.url) } : {}),
    }
    const job = {
      $id: `job-agl3975-${entry.key}`,
      orgId: 'org-live',
      hostId: 'host-live',
      kind: 'site',
      status: 'running',
      brief: aiSiteStartBrief(answers),
      inputs: { ...aiSiteStartInputs(answers), businessName: entry.businessName },
      steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
      outputs: [],
      creditsReserved: 300,
      creditsSpent: 0,
      createdBy: 'owner-1',
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW,
    } as unknown as AiJob
    const reads: string[] = []
    // The seam: a recorded page for each address, never a fetch.
    const readPage: AiSiteInspirationPageReader = async (url) => {
      reads.push(url.toString())
      return AI_INSPIRATION_RECORDINGS.find((recording) => recording.url === url.toString())?.page ?? null
    }
    const capabilities = aiPlanCapabilitiesFrom(org, {
      layout: PROVISIONED.layouts.map((row) => ({ id: row.id, kind: undefined, sourceType: undefined, deletedAt: undefined })),
      template: [],
    })
    const outcome = (await createAiJobPlanStep({
      readInventory: async () => PROVISIONED,
      findPlansByKey: null,
      readCapabilities: async () => capabilities,
      admissionRefusal: async () => null,
      readSiteContext: null,
      readSiteEvents: null,
      readFreeCredits: null,
      // The flag on for this workspace, as it is for a start that shows the field.
      readInspiration: createAiSiteInspirationReader({ released: async () => true, readPage }),
    })({ job, stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org })) as unknown as Record<string, unknown>
    const review = outcome['review'] as { reason?: string } | undefined
    const plan = stableDraftIds(entry, (outcome['plan'] as AiJobPlan | undefined) ?? null)
    const prompt = mockCalls.find((call) => call.tag === entry.key && isPlanCall(call.tools))?.prompt ?? ''
    return { entry, job, plan: plan && (!review || review.reason === 'plan') ? plan : null, prompt, reads, outcome }
  })
  PLANS.set(entry.key, planned)
  return planned
}

interface Looked {
  style: AiSiteStyle | null
  inspired: string[]
  pins: Record<string, unknown>
  /** Each pinned dimension the look did not keep, as `dimension: pinned → kept`. */
  unkept: string[]
  prompt: string
  output: string
  failure: string | null
}

const LOOKS = new Map<string, Promise<Looked>>()

/** A case's look through the real look pass, its unit made as the site step makes it; once per process. */
function lookOf(planned: Planned): Promise<Looked> {
  const { entry, job, plan } = planned
  const known = LOOKS.get(entry.key)
  if (known) return known
  const looked = mockCaseTag.run(entry.key, async (): Promise<Looked> => {
    const confirmed = { ...plan, status: 'confirmed' } as AiJobPlan
    const units = aiSiteJobUnits(confirmed, {})
    const theme = units.find((unit) => unit.kind === 'theme') as AiSiteUnit
    const unit = aiSiteUnitJob({ ...job, plan: confirmed }, theme, aiSiteBuiltRefs(units, []))
    let style: AiSiteStyle | null = null
    const before = mockCalls.length
    const outcome = await aiRunSiteLook({ job: unit, stepIndex: 0, now: NOW, firestore: {} as never }, unit, {
      // Each case a customer of its own: drawn apart from no other site.
      others: async () => [],
      save: async (_firestore, input) => {
        style = input.style
        return { write: 'applied', baseName: input.style.base }
      },
    })
    const kind = aiSiteKind(entry.kind)
    const pins = kind
      ? aiSiteInspirationLookPins(confirmed.inspiration ?? null, { kind, seed: aiSiteSeed(String(unit.inputs?.['originJobId'] ?? job.$id)) })
      : {}
    const kept = style as AiSiteStyle | null
    const unkept = Object.entries(pins).flatMap(([dimension, value]) => {
      const actual = kept ? (kept as unknown as Record<string, unknown>)[dimension] : undefined
      return actual === value ? [] : [`${dimension}: ${String(value)} → ${String(actual)}`]
    })
    return {
      style: kept,
      inspired: (outcome.outputs[0]?.proposal?.['inspired'] as string[] | undefined) ?? [],
      pins: pins as Record<string, unknown>,
      unkept,
      prompt: mockCalls.slice(before).find((call) => call.tag === entry.key && !isPlanCall(call.tools))?.prompt ?? '',
      output: JSON.stringify(outcome.outputs),
      failure: outcome.failure ?? (outcome.outputs.length ? null : 'no look'),
    }
  })
  LOOKS.set(entry.key, looked)
  return looked
}

/** What a plan's home and pages read as, for the table. */
function planReport(planned: Planned, looked: Looked | null) {
  const { entry, plan, prompt } = planned
  const inspiration = plan?.inspiration ?? null
  const home = plan?.screens.find((screen) => aiSitePlanIsHome(screen)) ?? null
  const homeKinds = (home?.sections ?? []).map((section) => sectionKindOf(section.name))
  const allSections = (plan?.screens ?? []).flatMap((screen) => screen.sections.map((section) => ({ page: screen.title, name: section.name })))
  const promptFeatures = (Object.keys(AI_SITE_INSPIRATION_FEATURE_PARTS) as AiSiteInspirationFeature[]).filter((feature) =>
    prompt.includes(`- ${feature}: `),
  )
  // The plan's own words, without the signals it keeps beside them.
  const planWords = plan ? JSON.stringify({ ...plan, inspiration: undefined }) : ''
  return {
    case: entry.n,
    key: entry.key,
    orgPlan: entry.orgPlan,
    sites: entry.sites.map((site) => new URL(site.url).hostname),
    read: planned.reads.length,
    planned: Boolean(plan),
    findings: ((planned.outcome['review'] as { findings?: Array<{ code: string; message: string }> } | undefined)?.findings ?? []).map(
      (finding) => `${finding.code}: ${finding.message}`,
    ),
    block: prompt.includes('<inspiration-structure>'),
    blockLines: prompt.includes('<inspiration-structure>')
      ? prompt.slice(prompt.indexOf('<inspiration-structure>'), prompt.indexOf('</inspiration-structure>') + 25).split('\n')
      : [],
    promptFeatures,
    signals: (inspiration?.sites ?? []).map((site) => ({ sections: site.sections.join(' > '), features: site.features.join(', ') })),
    // Whether the seeded home arc (AGL-3899) was stated: never beside a site's order.
    arc: prompt.includes(HOME_ARC),
    home: (home?.sections ?? []).map((section) => section.name),
    homeKinds: homeKinds.map((kind) => kind ?? '?').join(' > '),
    // The order each site's line told the plan, and how much of it the home keeps, in order.
    orderKept: toldOrders(prompt).map((told) => `${told.join(' > ')}: ${orderKept(homeKinds, told)}`),
    pages: (plan?.screens ?? []).map((screen) => `${screen.slug} ${screen.title}: ${screen.sections.map((section) => section.name).join(' | ')}`),
    creates: (plan?.create ?? []).map((creation) => `${creation.kind} ${creation.name}`),
    // Each feature the block told a paid plan, and the sections that place it.
    featuresPlanned: Object.fromEntries(
      promptFeatures.map((feature) => [
        feature,
        allSections.filter((section) => FEATURE_WORDS[feature].test(section.name)).map((section) => `${section.page}: ${section.name}`),
      ]),
    ),
    // Every section that reads as a feature, told or not: what a Free plan or the control planned on its own.
    featureSections: allSections
      .filter((section) => (Object.keys(FEATURE_WORDS) as AiSiteInspirationFeature[]).some((feature) => FEATURE_WORDS[feature].test(section.name)))
      .map((section) => `${section.page}: ${section.name}`),
    testimonials: allSections.filter((section) => TESTIMONIALS.test(section.name)).map((section) => `${section.page}: ${section.name}`),
    leaks: [...new Set([...leaksIn(prompt), ...leaksIn(planWords), ...(looked ? [...leaksIn(looked.prompt), ...leaksIn(looked.output)] : [])])],
    look: looked
      ? {
          failure: looked.failure,
          inspired: looked.inspired,
          pins: looked.pins,
          unkept: looked.unkept,
          style: looked.style
            ? {
                base: looked.style.base,
                brand: looked.style.brand,
                hue: looked.style.hue,
                accent: looked.style.accent,
                fonts: looked.style.fonts,
                corners: looked.style.corners,
                buttons: looked.style.buttons,
                cards: looked.style.cards,
                header: looked.style.header,
                headerAlign: looked.style.headerAlign,
                rhythm: looked.style.rhythm,
                density: looked.style.density,
                ground: looked.style.ground,
                motion: looked.style.motion,
              }
            : null,
        }
      : null,
    planUsd: usdOf(entry.key, isPlanCall),
    lookUsd: usdOf(entry.key, (tools) => !isPlanCall(tools)),
  }
}

interface Built {
  name: string
  status: string
  attempts: number
  findings: string[]
  items: string[]
  dropped: string[]
  testimonials: string[]
  leaks: string[]
  markdown: string
  /** Every line of copy a node shows, its cards' included, which the page's Markdown leaves out. */
  words: string[]
}

/** Each distinct line of copy the compiled nodes show: a prop's words, never an id, an address or a style. */
function wordsOf(nodes: unknown): string[] {
  const words = new Set<string>()
  const visit = (value: unknown, key: string) => {
    if (typeof value === 'string') {
      const text = value.trim()
      if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) && !/^(https?:|\/|#|\{)/.test(text) && !/^(sx|className|style|src|href|id)$/.test(key)) words.add(text)
      return
    }
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key))
    if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) visit(child, name)
  }
  for (const node of Object.values((nodes ?? {}) as Record<string, { props?: unknown }>)) visit(node?.props ?? null, 'props')
  return [...words]
}

/** A planned page, built as the site step builds a page unit: its derived job, then the layout-language pass. */
async function buildPage(entry: Case, site: AiJob, unit: AiSiteUnit, built: ReturnType<typeof aiSiteBuiltRefs>, inventory: AiSiteInventory): Promise<Built> {
  const job = aiSiteUnitJob(site, unit, built)
  const plan = job.plan as AiJobPlan
  const screen = plan.screens[0]
  const reusableComponents = aiBuildsWithComponents(orgOf(entry))
  const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId(job.$id, index))
  const { linkablePages } = aiPageLinkablePages(inventory, aiLayoutSitePages(job.inputs), [screen.id])
  const checked = {
    ...aiPageCheckContext(inventory, {
      reusableComponents,
      sections: screen.sections.map((section) => section.name),
      embeds: aiPlanEmbedsFor(plan, { slug: screen.slug }),
      linkablePages,
    }),
    codeBuilt: true,
    repeatsCompiled: true,
  }
  const targets = aiLayoutPageTargets({ job, inventory, own: [screen.id] })
  const context = aiLayoutListingContext(checked, targets)
  const result = await aiRunLayoutPage({ job, plan, screen, sectionIds, targets, context, reusableComponents, inventory, model: aiModelForStep('job.page') })
  const markdown = result.status === 'ok' ? buildPageMarkdown({ nodes: result.value.nodes as never, rootId: CANVAS_ROOT_ELEMENT_ID }) : ''
  return {
    name: `${screen.slug} ${screen.title}`,
    status: result.status,
    attempts: result.attempts,
    findings:
      result.status === 'needs_input'
        ? ((result as unknown as { violations?: Array<{ code: string; message: string }> }).violations ?? []).map((violation) => `${violation.code}: ${violation.message}`)
        : [],
    items: result.status === 'ok' ? screen.sections.map((section, index) => `${section.name} ${result.value.items[index] ?? 0}/${section.items}`) : [],
    dropped: result.status === 'ok' ? result.value.dropped : [],
    testimonials: [...markdown.split('\n'), ...(result.status === 'ok' ? wordsOf(result.value.nodes) : [])].filter((line) => TESTIMONIALS.test(line)),
    leaks: leaksIn(`${markdown}\n${result.status === 'ok' ? JSON.stringify(result.value.nodes) : ''}`),
    markdown,
    words: result.status === 'ok' ? wordsOf(result.value.nodes) : [],
  }
}

/** The header and footer of a plan that creates its own layout, as the layout step builds it. */
async function buildFrame(site: AiJob, unit: AiSiteUnit, built: ReturnType<typeof aiSiteBuiltRefs>, inventory: AiSiteInventory): Promise<Built> {
  const job = aiSiteUnitJob(site, unit, built)
  const siteName = aiLayoutSiteName(job)
  const pages = aiLayoutNavPages(job, inventory)
  const targets = aiLayoutFrameTargets(job, inventory)
  const model = aiModelForStep('job.layout')
  const result = await runValidatedGeneration<AiLayoutFrameBuilt>(AI_LAYOUT_FRAME_KIND, {
    step: 'job.layout',
    model,
    instructions: AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS,
    inventory,
    messages: [{ role: 'user', content: aiLayoutFramePrompt({ job, siteName, pages, targets }) }],
    tool: AI_LAYOUT_FRAME_TOOL,
    maxTokens: AI_JOB_LAYOUT_LANGUAGE_BUDGET.maxTokens(model),
    ...AI_LAYOUT_LANGUAGE_THINKING,
    check: aiLayoutFrameCheck({
      ...aiSiteStyleTokens(job.inputs),
      siteName,
      homeId: aiLayoutHomeId(pages, inventory),
      pages,
      targets,
      extend: aiLayoutChecks(inventory, job.plan as AiJobPlan, job.brief),
    }),
  })
  const markdown = result.status === 'ok' ? buildPageMarkdown({ nodes: result.value.nodes as never, rootId: result.value.rootId }) : ''
  return {
    name: 'header+footer',
    status: result.status,
    attempts: result.attempts,
    findings: [],
    items: [],
    dropped: [],
    testimonials: [],
    leaks: leaksIn(`${markdown}\n${result.status === 'ok' ? JSON.stringify(result.value.nodes) : ''}`),
    markdown,
    words: result.status === 'ok' ? wordsOf(result.value.nodes) : [],
  }
}

/**
 * A case built whole (AGL-3975): its plan and look (replayed when the plan
 * run asked them), the records its creations would write standing in as
 * built — the form and any component by id, as a page unit is told them —
 * and every planned page built side by side, with the header and footer
 * where the plan made its own layout. A dataset the plan lists is not
 * written here, so a section that would list one is built as written copy.
 */
async function buildCase(entry: Case) {
  const planned = await planOf(entry)
  if (!planned.plan) throw new Error(`case ${entry.n} has no plan to build`)
  const looked = await lookOf(planned)
  const confirmed = { ...planned.plan, status: 'confirmed' } as AiJobPlan
  const units = aiSiteJobUnits(confirmed, {})
  const outputs: AiJobOutput[] = [
    { resource: 'theme', id: 'look', label: 'Your look', hostId: 'host-live', proposal: { style: looked.style } } as unknown as AiJobOutput,
  ]
  const inventory: AiSiteInventory = { ...PROVISIONED, layouts: [...PROVISIONED.layouts], forms: [], components: [] }
  for (const unit of units) {
    const creation = unit.creation
    if (!creation || !['layout', 'form', 'component'].includes(unit.kind)) continue
    const id = `built-${unit.slot}`
    outputs.push({ resource: unit.resource, id, label: creation.name, hostId: 'host-live' } as AiJobOutput)
    const names = creation.fields.map((field) => field.split(':')[0]?.trim() ?? field)
    if (unit.kind === 'layout') inventory.layouts.push({ id, name: creation.name, parentId: null })
    if (unit.kind === 'form') inventory.forms.push({ id, name: creation.name, fields: names })
    if (unit.kind === 'component') {
      inventory.components.push({
        id,
        name: creation.name,
        props: Object.fromEntries(creation.fields.map((field) => [field.split(':')[0]?.trim() ?? field, field.split(':')[1]?.trim() || 'text'])),
      })
    }
  }
  const site = { ...planned.job, plan: confirmed, outputs } as AiJob
  const built = aiSiteBuiltRefs(units, outputs)
  const before = aiLiveRunLedger().liveProviderUsd
  const results = await mockCaseTag.run(`${entry.key}-build`, () =>
    Promise.all([
      ...units.filter((unit) => unit.kind === 'layout').map((unit) => buildFrame(site, unit, built, inventory)),
      ...units
        .filter((unit) => unit.kind === 'page' && unit.screen && !unit.screen.record)
        .map((unit) => buildPage(entry, site, unit, built, inventory)),
    ]),
  )
  return {
    case: entry.n,
    key: entry.key,
    orgPlan: entry.orgPlan,
    look: looked.style ? { base: looked.style.base, fonts: looked.style.fonts, buttons: looked.style.buttons, headerAlign: looked.style.headerAlign, motion: looked.style.motion } : null,
    // Record templates are a dataset's pages: not built here.
    skipped: units.filter((unit) => unit.kind === 'page' && unit.screen?.record).map((unit) => unit.label),
    built: `${results.filter((result) => result.status === 'ok').length}/${results.length}`,
    buildUsd: Number((aiLiveRunLedger().liveProviderUsd - before).toFixed(4)),
    pages: results,
  }
}

const describeLive = LIVE ? describe : describe.skip

describeLive('Sites I like, from recorded pages, by the real model (AGL-3975)', () => {
  jest.setTimeout(aiLiveTimeoutMs(15 * 60_000))

  // The run's ledger prints however the run ended (AGL-3781): a run that
  // threw before its table still spent what the ledger counts.
  afterAll(() => {
    console.log(`run: ${JSON.stringify({ ...aiLiveRunLedger(), spentBefore: SPENT_USD, capUsd: CAP_USD })}`)
  })

  it('plans and looks cases 1-6: the order followed, the look pinned, features on paid only, nothing of theirs', async () => {
    const plans = await Promise.all(CASES.map((entry) => planOf(entry)))
    const looks = await Promise.all(plans.map((planned) => (planned.plan ? lookOf(planned) : Promise.resolve(null))))
    const results = plans.map((planned, index) => planReport(planned, looks[index]))
    // The whole table, every run, so a red run shows every case's outcome.
    console.log(JSON.stringify({ run: aiLiveRunLedger(), results }, null, 1))

    expect(results.filter((result) => !result.planned).map((result) => [result.key, result.findings])).toEqual([])
    // The block goes to every start that names sites, and to no other.
    expect(results.map((result) => [result.key, result.block])).toEqual(CASES.map((entry) => [entry.key, entry.sites.length > 0]))
    // Features reach a paid plan only, and the Free start reads one site.
    expect(results.find((result) => result.key === 'c5-free-restaurant')).toMatchObject({ read: 1, promptFeatures: [] })
    // And only the parts this start can build: a restaurant drafts no events and sells no sign-up.
    expect(results.find((result) => result.key === 'c2-restaurant')?.promptFeatures).toEqual(['booking', 'forms', 'gallery', 'menu'])
    // A site's order takes the seeded arc's place; the control keeps its arc.
    expect(results.map((result) => [result.key, result.arc])).toEqual(CASES.map((entry) => [entry.key, entry.sites.length === 0]))
    expect(results.find((result) => result.key === 'c4-all-three')?.read).toBe(3)
    // Nothing of a recording in any prompt, plan or look.
    expect(results.map((result) => [result.key, result.leaks])).toEqual(CASES.map((entry) => [entry.key, []]))
    // No testimonials section on a site with no customer words, whatever the sites it likes show.
    expect(results.map((result) => [result.key, result.testimonials])).toEqual(CASES.map((entry) => [entry.key, []]))
    // Every look designed, and every dimension the sites pin kept.
    expect(results.map((result) => [result.key, result.look?.failure ?? null, result.look?.unkept ?? []])).toEqual(
      CASES.map((entry) => [entry.key, null, []]),
    )
    expect(results.find((result) => result.key === 'c6-control')?.look?.inspired).toEqual([])
  })

  it('builds case 2 whole, a paid restaurant: every page built, the features in Aglyn’s parts, nothing of theirs', async () => {
    const result = await buildCase(CASES.find((entry) => entry.key === 'c2-restaurant') as Case)
    console.log(JSON.stringify({ run: aiLiveRunLedger(), result }, null, 1))
    expect(result.pages.filter((page) => page.status !== 'ok').map((page) => [page.name, page.findings])).toEqual([])
    expect(result.pages.flatMap((page) => page.leaks)).toEqual([])
  })

  it('builds case 5 whole, a Free restaurant: every page built, nothing of theirs', async () => {
    const result = await buildCase(CASES.find((entry) => entry.key === 'c5-free-restaurant') as Case)
    console.log(JSON.stringify({ run: aiLiveRunLedger(), result }, null, 1))
    expect(result.pages.filter((page) => page.status !== 'ok').map((page) => [page.name, page.findings])).toEqual([])
    expect(result.pages.flatMap((page) => page.leaks)).toEqual([])
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
