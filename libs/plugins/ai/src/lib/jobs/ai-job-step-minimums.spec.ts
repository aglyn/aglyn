/**
 * @jest-environment node
 */
/**
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
 * Every AI generation step registers the least time it needs (AGL-3035).
 *
 * The console is the one app that runs AI jobs, so this suite registers the
 * plugin as the console does and asks the machine's own registry — never a
 * list kept here — about every step of every kind it runs. A step registered
 * with no least time is started by an inline door and cut off at the door's
 * budget, billed upstream and metered nowhere; the next kind added without
 * one fails here.
 *
 * It holds each least time to the arithmetic that produced it — the worst
 * case of every model call the step may make, at the ceiling it asks on the
 * tier its step kind is served from — and the developer notes' table to the
 * same figures, and it walks a page job through its creations and a scaffold
 * through its units, where each pass needs its own unit's time.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiBuildPlanCreate } from '../model/ai-build-plan'
import { AI_JOB_KINDS, type AiJob, type AiJobKind, type AiJobOutput, type AiJobPlan } from '../model/ai-jobs.types'
import { aiProductsJobInputs } from '../model/ai-products'
import { AI_SITE_PAGES } from '../model/ai-site-job'
import { AI_MODEL_CATALOG, AI_STEP_TIERS, type AiCatalogEntry, type AiStepKind } from '../providers/catalog'
import { AI_ROUTING_TABLE } from '../providers/routing'
import { AI_PRODUCT_COPY_MAX_TOKENS } from '../runtime/ai-products-generation'
import { AI_INVENTORY_LOOKUP_MAX_ROUNDS } from '../tools/ai-inventory-lookup-tool'
import { registerAiConsoleApi } from '../server'
import {
  AI_JOB_ASSUMED_FIRST_TOKEN_MS,
  AI_JOB_INLINE_BUDGET_MS,
  AI_JOB_STEP_MAX_MINIMUM_MS,
  AI_JOB_STEP_OVERHEAD_MS,
  aiGenerationWorstCaseMs,
  aiGenerationWorstCaseOnTierMs,
  aiJobAssumedAnswerMs,
  type AiGenerationShape,
  type AiJobStepBudget,
} from './ai-job-budget'
import { AI_JOB_COMPONENT_STEP_BUDGET } from './ai-job-component-step'
import { AI_JOB_EMAIL_STEP_BUDGETS } from './ai-job-email-step'
import { AI_JOB_FORM_STEP_BUDGET } from './ai-job-form-step'
import { AI_INSIGHT_READS_MS, AI_JOB_INSIGHT_STEP_BUDGET } from './ai-job-insight-budget'
import { AI_JOB_LAYOUT_STEP_BUDGET } from './ai-job-layout-step'
import { AI_JOB_PAGE_SECTION_MAX_TOKENS, AI_JOB_PAGE_SECTION_TOKENS, AI_JOB_PAGE_STEP_BUDGET } from './ai-job-page-budget'
import { AI_JOB_PLAN_STEP_BUDGET } from './ai-job-plan-step'
import {
  AI_JOB_CATALOG_BUDGET,
  AI_JOB_CATEGORIES_BUDGET,
  AI_JOB_PRODUCTS_STEP_BUDGET,
} from './ai-job-products-step'
import { AI_PRODUCT_IMAGE_READ_MS } from './ai-product-image'
import {
  AI_JOB_SEO_STEP_BUDGET,
  AI_SEO_AUDIT_READS_MS,
  AI_SEO_FIXES_MAX_TOKENS,
  AI_SEO_SITE_MAX_TOKENS,
} from './ai-job-seo-budget'
import { AI_JOB_TEMPLATE_STEP_BUDGET } from './ai-job-template-step'
import { AI_JOB_TEXT_STEP_BUDGET } from './ai-job-text-step'
import { AI_JOB_THEME_STEP_BUDGET, AI_THEME_BRAND_BUDGET_MS } from './ai-job-theme-budget'
import { AI_JOB_WORKFLOW_STEP_BUDGET, AI_WORKFLOW_RECORDS_READ_MS } from './ai-job-workflow-step'
import {
  AI_JOB_PLAN_STEP,
  aiJobNextStepMinimumMs,
  aiJobRunnerForStep,
  aiJobStepMinimumMs,
  aiJobStepNames,
} from './ai-jobs'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const NOW = new Date('2026-09-16T15:00:00.000Z')
const TIERS: readonly AiCatalogEntry['tier'][] = ['fast', 'balanced', 'deep']
const modelOn = (tier: AiCatalogEntry['tier']) => AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string
const figure = (value: number) => value.toLocaleString('en-US')

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  registerAiConsoleApi()
})

afterAll(() => jest.restoreAllMocks())

/** Every step of every kind the console registered a runner for, with the least time it registered. */
function registeredSteps(): Array<{ kind: AiJobKind; step: string; minimumMs: number }> {
  return AI_JOB_KINDS.flatMap((kind) =>
    aiJobStepNames(kind)
      .filter((step) => aiJobRunnerForStep(kind, step) !== null)
      .map((step) => ({ kind, step, minimumMs: aiJobStepMinimumMs(kind, step) })),
  )
}

/**
 * How each step generates, as its module computes its time: the budget it
 * registers, the routing row it is served by, and the shape of its one
 * generation a run — every generation step but the plan's, whose kind is
 * every planned kind's.
 */
interface StepTime {
  /** The row's name in the developer notes. */
  row: string
  kind: AiJobKind | null
  routing: AiStepKind
  budget: AiJobStepBudget
  /** The ceiling the step's time is computed from: the routing table's, or the step's own. */
  ceiling: number
  /** The most a faster tier may ask. */
  cap: number
  shape: Required<AiGenerationShape>
}

const shape = (patch: AiGenerationShape = {}): Required<AiGenerationShape> => ({
  attempts: 2,
  lookups: AI_INVENTORY_LOOKUP_MAX_ROUNDS,
  ownReadsMs: 0,
  ...patch,
})

const routed = (routing: AiStepKind) => AI_ROUTING_TABLE[routing].maxTokens

const STEP_TIMES: readonly StepTime[] = [
  { row: '`plan`', kind: null, routing: 'job.plan', budget: AI_JOB_PLAN_STEP_BUDGET, ceiling: routed('job.plan'), cap: routed('job.plan'), shape: shape() },
  { row: '`component`', kind: 'component', routing: 'job.component', budget: AI_JOB_COMPONENT_STEP_BUDGET, ceiling: routed('job.component'), cap: routed('job.component'), shape: shape() },
  { row: '`layout`', kind: 'layout', routing: 'job.layout', budget: AI_JOB_LAYOUT_STEP_BUDGET, ceiling: routed('job.layout'), cap: routed('job.layout'), shape: shape() },
  { row: '`template`', kind: 'template', routing: 'job.template', budget: AI_JOB_TEMPLATE_STEP_BUDGET, ceiling: routed('job.template'), cap: routed('job.template'), shape: shape() },
  { row: '`form`', kind: 'form', routing: 'job.form', budget: AI_JOB_FORM_STEP_BUDGET, ceiling: routed('job.form'), cap: routed('job.form'), shape: shape() },
  { row: '`email`', kind: 'email', routing: 'job.email', budget: AI_JOB_EMAIL_STEP_BUDGETS['job.email'], ceiling: routed('job.email'), cap: routed('job.email'), shape: shape() },
  { row: '`campaign`', kind: 'campaign', routing: 'job.campaign', budget: AI_JOB_EMAIL_STEP_BUDGETS['job.campaign'], ceiling: routed('job.campaign'), cap: routed('job.campaign'), shape: shape() },
  {
    row: '`page`, a section pass',
    kind: 'page',
    routing: 'job.page',
    budget: AI_JOB_PAGE_STEP_BUDGET,
    ceiling: AI_JOB_PAGE_SECTION_TOKENS,
    cap: AI_JOB_PAGE_SECTION_MAX_TOKENS,
    shape: shape(),
  },
  {
    row: '`theme`',
    kind: 'theme',
    routing: 'job.theme',
    budget: AI_JOB_THEME_STEP_BUDGET,
    ceiling: routed('job.theme'),
    cap: routed('job.theme'),
    shape: shape({ lookups: 0, ownReadsMs: AI_THEME_BRAND_BUDGET_MS }),
  },
  {
    row: '`seo`, a batch of fixes',
    kind: 'seo',
    routing: 'job.seo',
    budget: AI_JOB_SEO_STEP_BUDGET,
    ceiling: Math.max(routed('job.seo'), AI_SEO_SITE_MAX_TOKENS, AI_SEO_FIXES_MAX_TOKENS),
    cap: Math.max(routed('job.seo'), AI_SEO_SITE_MAX_TOKENS, AI_SEO_FIXES_MAX_TOKENS),
    shape: shape({ lookups: 0, ownReadsMs: AI_SEO_AUDIT_READS_MS }),
  },
  {
    row: '`insight`',
    kind: 'insight',
    routing: 'job.insight',
    budget: AI_JOB_INSIGHT_STEP_BUDGET,
    ceiling: routed('job.insight'),
    cap: routed('job.insight'),
    shape: shape({ lookups: 1, ownReadsMs: AI_INSIGHT_READS_MS }),
  },
  {
    row: '`products`, a product’s copy',
    kind: 'products',
    routing: 'job.products',
    budget: AI_JOB_PRODUCTS_STEP_BUDGET,
    ceiling: AI_PRODUCT_COPY_MAX_TOKENS,
    cap: AI_PRODUCT_COPY_MAX_TOKENS,
    shape: shape({ lookups: 0, ownReadsMs: AI_PRODUCT_IMAGE_READ_MS }),
  },
  {
    row: '`text`',
    kind: 'text',
    routing: 'job.text',
    budget: AI_JOB_TEXT_STEP_BUDGET,
    ceiling: routed('job.text'),
    cap: routed('job.text'),
    shape: shape({ attempts: 1, lookups: 0 }),
  },
  {
    row: '`workflow`',
    kind: 'workflow',
    routing: 'job.workflow',
    budget: AI_JOB_WORKFLOW_STEP_BUDGET,
    ceiling: routed('job.workflow'),
    cap: routed('job.workflow'),
    shape: shape({ lookups: 0, ownReadsMs: AI_WORKFLOW_RECORDS_READ_MS }),
  },
]

describe('every step the console runs registers the least time it needs (AGL-3035)', () => {
  it('fails on a step of any registered kind that registered none, or more than a beat can give it', () => {
    const steps = registeredSteps()
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.filter(({ minimumMs }) => !(minimumMs > 0))).toEqual([])
    expect(steps.filter(({ minimumMs }) => minimumMs > AI_JOB_STEP_MAX_MINIMUM_MS)).toEqual([])
    // Every kind with a step module beside the machine is among them.
    for (const kind of ['text', 'theme', 'seo', 'component', 'layout', 'template', 'form', 'page', 'email', 'campaign', 'site', 'workflow', 'insight', 'products'] as const) {
      expect([kind, steps.some((entry) => entry.kind === kind)]).toEqual([kind, true])
    }
  })

  it('leaves every step for the beat but the one whose worst case at its ceiling fits an inline door, proven by the helper', () => {
    const inline = registeredSteps().filter(({ minimumMs }) => minimumMs <= AI_JOB_INLINE_BUDGET_MS)
    expect(inline.map(({ kind, step }) => `${kind}/${step}`)).toEqual(['text/draft'])
    // The text step's one request at the routing ceiling on its own tier is what fits.
    const tier = AI_STEP_TIERS['job.text']
    expect(AI_JOB_TEXT_STEP_BUDGET.maxTokens(modelOn(tier))).toBe(AI_ROUTING_TABLE['job.text'].maxTokens)
    expect(aiJobStepMinimumMs('text', 'draft')).toBe(
      aiGenerationWorstCaseOnTierMs({ tier, maxTokens: AI_ROUTING_TABLE['job.text'].maxTokens, attempts: 1, lookups: 0 }),
    )
  })

  it.each(STEP_TIMES.map((entry) => [entry.row, entry]))(
    '%s registers its generation’s worst case at the ceiling it asks on its served tier, and fits every tier inside it',
    (_row, entry) => {
      const time = entry as StepTime
      const tier = AI_STEP_TIERS[time.routing]
      const served = time.budget.maxTokens(modelOn(tier))
      const registered = time.kind ? aiJobStepMinimumMs(time.kind, aiJobStepNames(time.kind).at(-1) as string) : aiJobStepMinimumMs('page', AI_JOB_PLAN_STEP)
      expect(registered).toBe(time.budget.minimumMs)
      expect(time.budget.minimumMs).toBe(aiGenerationWorstCaseOnTierMs({ tier, maxTokens: served, ...time.shape }))
      // The served tier asks its whole ceiling, or the most of it a beat can start.
      expect(
        served === time.ceiling ||
          aiGenerationWorstCaseOnTierMs({ tier, maxTokens: served + 1, ...time.shape }) > AI_JOB_STEP_MAX_MINIMUM_MS,
      ).toBe(true)
      for (const model of AI_MODEL_CATALOG) {
        const ceiling = time.budget.maxTokens(model.id)
        expect([model.id, ceiling > 0, ceiling <= time.cap]).toEqual([model.id, true, true])
        expect([model.id, aiGenerationWorstCaseMs({ model: model.id, maxTokens: ceiling, ...time.shape }) <= time.budget.minimumMs]).toEqual([
          model.id,
          true,
        ])
      }
    },
  )

  it('states every step’s least time in the developer notes with the figures the code computes', () => {
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    for (const time of STEP_TIMES) {
      const tier = AI_STEP_TIERS[time.routing]
      const served = time.budget.maxTokens(modelOn(tier))
      const { attempts, lookups, ownReadsMs } = time.shape
      const arithmetic =
        `${attempts + lookups} × ${AI_JOB_ASSUMED_FIRST_TOKEN_MS / 1_000} s + ${attempts} × ` +
        `${figure(aiJobAssumedAnswerMs(served, tier))} ms + ${AI_JOB_STEP_OVERHEAD_MS / 1_000} s` +
        `${ownReadsMs ? ` + ${ownReadsMs / 1_000} s` : ''} = ${figure(time.budget.minimumMs)} ms`
      const row =
        `| ${time.row} | ${tier} | ${lookups} | ` +
        `${TIERS.map((each) => figure(time.budget.maxTokens(modelOn(each)))).join(' / ')} | ${arithmetic} |`
      expect([time.row, notes.includes(row)]).toEqual([time.row, true])
    }
  })
})

// ── A step whose passes differ ────────────────────────────────────────────

const creation = (kind: AiBuildPlanCreate['kind'], name: string): AiBuildPlanCreate => ({
  kind,
  name,
  why: `${name} is missing.`,
  duplicateOf: null,
  fields: [],
})

const screen = (index: number): AiJobPlan['screens'][number] => ({
  title: `Page ${index}`,
  slug: `page-${index}`,
  layout: null,
  template: null,
  duplicateOf: null,
  nav: index === 0,
  seoTitle: `Page ${index}`,
  seoDescription: `Page ${index} of the site`,
  sections: [{ name: 'hero', uses: [], items: 0 }],
})

function plannedJob(kind: AiJobKind, plan: Partial<AiJobPlan>, patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind,
    status: 'queued',
    brief: 'A site for a dog groomer',
    inputs: {},
    steps: [
      { name: AI_JOB_PLAN_STEP, status: 'done', creditsSpent: 0 },
      { name: 'generate', status: 'pending', creditsSpent: 0 },
    ],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: {
      reuse: [],
      create: [],
      screens: [],
      status: 'confirmed',
      labels: {},
      proposedAt: NOW,
      confirmedAt: NOW,
      confirmedBy: 'uid-1',
      ...plan,
    },
    ...patch,
  } as unknown as AiJob
}

const built = (resource: AiJobOutput['resource'], id: string): AiJobOutput => ({ resource, id, hostId: 'host-1', label: id })

describe('a pass needs the time of the step its unit is handed to (AGL-3035)', () => {
  it('gives a page job’s creation passes their own step’s time, and its section passes a section’s', () => {
    const job = plannedJob('page', {
      create: [creation('component', 'Price tier'), creation('layout', 'Site frame'), creation('form', 'Quote request')],
      screens: [screen(0)],
    })
    const next = (outputs: AiJobOutput[]) => aiJobNextStepMinimumMs({ ...job, outputs })
    const layout = built('layout', 'job-1-c1')
    const form = built('form', 'job-1-c2')
    const component = built('reusableComponent', 'job-1-c0')
    // The layout, then the form, then the component, then the page's sections.
    expect(next([])).toBe(aiJobStepMinimumMs('layout', 'generate'))
    expect(next([layout])).toBe(aiJobStepMinimumMs('form', 'generate'))
    expect(next([layout, form])).toBe(aiJobStepMinimumMs('component', 'generate'))
    expect(next([layout, form, component])).toBe(aiJobStepMinimumMs('page', 'generate'))
    expect(aiJobStepMinimumMs('layout', 'generate')).toBeGreaterThan(aiJobStepMinimumMs('page', 'generate'))
    // The plan step before them is the plan's own.
    expect(aiJobNextStepMinimumMs({ ...job, steps: [{ ...job.steps[0], status: 'pending' }, job.steps[1]] })).toBe(
      aiJobStepMinimumMs('page', AI_JOB_PLAN_STEP),
    )
  })

  it('gives a scaffold’s palette, layout, form, pages and welcome email each the time of the step that builds it', () => {
    const job = plannedJob(
      'site',
      {
        create: [creation('theme-change', 'Palette'), creation('layout', 'Site frame'), creation('form', 'Contact')],
        screens: Array.from({ length: AI_SITE_PAGES.min }, (_, index) => screen(index)),
      },
      { inputs: { businessType: 'dog groomer', pages: AI_SITE_PAGES.min, welcomeEmail: true } },
    )
    const units: Array<[AiJobKind, AiJobOutput]> = [
      ['theme', built('theme', 'proposal')],
      ['layout', built('layout', 'job-1-l')],
      ['form', built('form', 'job-1-f')],
      ...Array.from({ length: AI_SITE_PAGES.min }, (_, index): [AiJobKind, AiJobOutput] => ['page', built('screen', `job-1-p${index}`)]),
      ['email', built('emailScreen', 'job-1-e')],
    ]
    const outputs: AiJobOutput[] = []
    for (const [kind, output] of units) {
      expect([kind, aiJobNextStepMinimumMs({ ...job, outputs: [...outputs] })]).toEqual([kind, aiJobStepMinimumMs(kind, 'generate')])
      outputs.push(output)
    }
    // A scaffold with nothing left to build spends nothing; a page pass's time covers it.
    expect(aiJobNextStepMinimumMs({ ...job, outputs })).toBe(aiJobStepMinimumMs('site', 'generate'))
    expect(aiJobStepMinimumMs('site', 'generate')).toBe(aiJobStepMinimumMs('page', 'generate'))
  })

  it('gives a products job’s catalog and categories passes their own time, above the copy the step registers', () => {
    const job = (inputs: Record<string, string>): AiJob =>
      ({
        ...plannedJob('products', {}, { inputs }),
        plan: undefined,
        steps: [{ name: 'generate', status: 'pending', creditsSpent: 0 }],
      }) as unknown as AiJob
    expect(aiJobNextStepMinimumMs(job(aiProductsJobInputs({ target: 'bulk', productIds: ['a', 'b'] })))).toBe(
      aiJobStepMinimumMs('products', 'generate'),
    )
    expect(aiJobNextStepMinimumMs(job(aiProductsJobInputs({ target: 'catalog' })))).toBe(AI_JOB_CATALOG_BUDGET.minimumMs)
    expect(aiJobNextStepMinimumMs(job(aiProductsJobInputs({ target: 'categories' })))).toBe(
      AI_JOB_CATEGORIES_BUDGET.minimumMs,
    )
    expect(AI_JOB_CATEGORIES_BUDGET.minimumMs).toBeGreaterThan(aiJobStepMinimumMs('products', 'generate'))
    expect(AI_JOB_CATALOG_BUDGET.minimumMs).toBeGreaterThan(AI_JOB_CATEGORIES_BUDGET.minimumMs)
  })
})
