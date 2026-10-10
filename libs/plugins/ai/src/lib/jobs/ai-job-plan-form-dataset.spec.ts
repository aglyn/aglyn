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
 * A form's dataset in the plan (AGL-3616; Zach, 2026-10-10: Aglyn AI's forms
 * write to its datasets): the plan tool's `writesTo`, how the plan keeps it,
 * how it is settled in code, what it costs, and a replay of the food bank's
 * recorded first answer with its sign-up form writing to a dataset.
 */

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => {
  const catalog = jest.requireActual('../providers/catalog')
  return {
    __esModule: true,
    ...jest.requireActual('../providers/routing'),
    aiModelForStep: (kind: string) =>
      catalog.AI_MODEL_CATALOG.find((entry: { tier: string }) => entry.tier === catalog.AI_STEP_TIERS[kind])?.id,
  }
})

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))
jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOBS_COLLECTION: 'aiJobs',
  registerAiJobStep: jest.fn(),
  registerAiJobPlanStep: jest.fn(),
}))

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  AI_BUILD_PLAN_RECORDS_TOOL,
  AI_BUILD_PLAN_TOOL,
  aiPlanFormDatasetNames,
  parseAiBuildPlan,
  type AiBuildPlan,
  type AiBuildPlanCreate,
} from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, type AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_SITE_PASS_CREDITS, aiPlanCreditEstimate, aiPlanCreditRange, aiSitePlanShapeRefusal } from '../model/ai-site-job'
import { aiDoctrinePlanCheck } from '../runtime/ai-doctrine'
import { AI_TYPED_LIST_MIN_ITEMS, aiSettlePlanDatasets, aiSettlePlanFormDatasets } from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import {
  AI_JOB_PLAN_SCOPES,
  AI_SITE_FORM_DATASET_SENTENCE,
  aiJobPlanPrompt,
  aiSiteDatasetSentence,
  aiSitePlanCapabilities,
  createAiJobPlanStep,
} from './ai-job-plan-step'
import { AI_FOOD_BANK_SITE_PLAN_FIRST_ANSWER as FOOD_BANK } from './fixtures/ai-dataset-site-plan-recordings'

const NOW = new Date('2026-10-10T06:32:00.000Z')
const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'business' }

const NEW_SITE: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scrStarter', name: 'Home', slug: '/', layoutId: 'laySite', template: false, replaceable: true }],
}
const PAID: AiPlanCapabilities = aiPlanCapabilitiesFrom(PAID_ORG, {
  layout: [{ id: 'laySite', kind: undefined, sourceType: undefined, deletedAt: undefined }],
  template: [],
})

function siteJob(businessType: string, pages: number): AiJob {
  return {
    $id: 'job-live',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: `A ${pages}-page website for ${businessType}.`,
    inputs: { businessType, pages, submissions: 'inbox', welcomeEmail: false },
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 120,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

const SITE_PAID = aiSitePlanCapabilities(
  siteJob('a nonprofit food bank', FOOD_BANK.screens.length),
  aiPlanCapabilitiesForJob(PAID, AI_JOB_PLAN_SCOPES.site ?? null),
) as AiPlanCapabilities
const NO_DATASETS: AiPlanCapabilities = {
  ...SITE_PAID,
  create: { ...SITE_PAID.create, dataset: { allowed: false, left: 0, reason: 'datasets need Starter' } },
}

const SIGN_UPS = 'Volunteer sign-ups'

/** The food bank's recorded first answer, its Get involved form writing each sign-up to a dataset of its own. */
const FOOD_BANK_WRITING: AiBuildPlan = {
  ...FOOD_BANK,
  create: [
    ...FOOD_BANK.create.map((entry) => (entry.kind === 'form' ? { ...entry, writesTo: `new:${SIGN_UPS}` } : entry)),
    {
      kind: 'dataset',
      name: SIGN_UPS,
      why: 'Each volunteer sign-up is kept as a record the team works through.',
      duplicateOf: null,
      fields: ['fullName', 'email', 'phone', 'interest', 'message'],
    },
  ],
}

const createProps = (tool: typeof AI_BUILD_PLAN_TOOL) => {
  const create = (tool.inputSchema['properties'] as Record<string, { items: Record<string, unknown> }>)['create']
  return { required: create.items['required'] as string[], properties: create.items['properties'] as Record<string, unknown> }
}
const datasetNames = (plan: AiBuildPlan) => plan.create.filter((entry) => entry.kind === 'dataset').map((entry) => entry.name)
const form = (plan: AiBuildPlan) => plan.create.find((entry) => entry.kind === 'form') as AiBuildPlanCreate
const uses = (plan: AiBuildPlan) => plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses))

describe('the plan tool says which dataset a form writes to', () => {
  it('only where the job may bind a dataset: the plain tool, a Free plan’s, is unchanged', () => {
    expect(createProps(AI_BUILD_PLAN_TOOL).properties['writesTo']).toBeUndefined()
    expect(createProps(AI_BUILD_PLAN_TOOL).required).not.toContain('writesTo')
    const records = createProps(AI_BUILD_PLAN_RECORDS_TOOL)
    expect(records.required).toContain('writesTo')
    expect(records.properties['writesTo']).toMatchObject({ anyOf: [{ type: 'string' }, { type: 'null' }] })
  })

  it('is kept on a form that names one, and on nothing else', () => {
    const parsed = parseAiBuildPlan({
      reuse: [],
      create: [
        { kind: 'form', name: 'Sign-up', why: 'w', duplicateOf: null, fields: ['email'], writesTo: 'new:Volunteers' },
        { kind: 'form', name: 'Contact', why: 'w', duplicateOf: null, fields: ['email'], writesTo: null },
        { kind: 'dataset', name: 'Volunteers', why: 'w', duplicateOf: null, fields: ['Email'], writesTo: 'new:Other' },
      ],
      screens: [],
    })
    if (parsed.ok === false) throw new Error(parsed.error)
    expect(parsed.plan.create[0]).toMatchObject({ writesTo: 'new:Volunteers' })
    expect(parsed.plan.create[1]).not.toHaveProperty('writesTo')
    expect(parsed.plan.create[2]).not.toHaveProperty('writesTo')
    expect(aiPlanFormDatasetNames(parsed.plan)).toEqual(new Set(['volunteers']))
  })
})

describe('a form’s dataset, settled in code', () => {
  const base: AiBuildPlan = {
    reuse: [],
    create: [
      { kind: 'form', name: 'RSVP', why: 'w', duplicateOf: null, fields: ['fullName', 'guests'], writesTo: 'new:Attendees' },
      { kind: 'dataset', name: 'Attendees', why: 'w', duplicateOf: null, fields: ['fullName', 'guests'] },
    ],
    screens: [
      {
        title: 'Home',
        slug: '/',
        layout: null,
        template: null,
        duplicateOf: null,
        nav: true,
        seoTitle: 'Home',
        seoDescription: 'Home',
        record: null,
        sections: [
          { name: 'rsvp', uses: ['new:RSVP'], items: 0 },
          { name: 'who is coming', uses: ['new:Attendees'], items: 6 },
        ],
      },
    ],
  }

  it('lists a form’s dataset on no page: its records are the people who sent it', () => {
    const settled = aiSettlePlanFormDatasets(base, NEW_SITE, SITE_PAID)
    expect(form(settled).writesTo).toBe('new:Attendees')
    expect(uses(settled)).toEqual(['new:RSVP'])
    expect(settled.screens[0].sections[1].items).toBeLessThan(AI_TYPED_LIST_MIN_ITEMS)
  })

  it('drops a writesTo that names nothing it can write to, so the form is the form it always was', () => {
    const nowhere = { ...base, create: [{ ...base.create[0], writesTo: 'new:Guests' }, base.create[1]] }
    expect(form(aiSettlePlanFormDatasets(nowhere, NEW_SITE, SITE_PAID))).not.toHaveProperty('writesTo')
    const unknownId = { ...base, create: [{ ...base.create[0], writesTo: 'dsNope' }] }
    expect(form(aiSettlePlanFormDatasets(unknownId, NEW_SITE, SITE_PAID))).not.toHaveProperty('writesTo')
  })

  it('drops it where this job may create no dataset (the Free taste)', () => {
    const settled = aiSettlePlanFormDatasets(base, NEW_SITE, NO_DATASETS)
    expect(form(settled)).not.toHaveProperty('writesTo')
  })

  it('keeps a dataset the site already has, and gives one named by its name its id', () => {
    const site = { ...NEW_SITE, datasets: [{ id: 'dsGuests', name: 'Guest list', fields: ['Name'] }] }
    const byId = { ...base, create: [{ ...base.create[0], writesTo: 'dsGuests' }] }
    expect(aiSettlePlanFormDatasets(byId, site, NO_DATASETS)).toBe(byId)
    const byName = { ...base, create: [{ ...base.create[0], writesTo: 'Guest list' }] }
    expect(form(aiSettlePlanFormDatasets(byName, site, NO_DATASETS)).writesTo).toBe('dsGuests')
  })

  it('accepts a build’s dataset item', () => {
    const build: AiBuildPlan = {
      ...base,
      create: [{ ...base.create[0], writesTo: 'new:Attendees' }],
      items: [{ slot: 'i0', op: 'dataset', name: 'Attendees', why: 'w', dependsOn: [], degrade: 'omit', args: { name: 'Attendees', fields: ['Full name'] } }],
    }
    expect(form(aiSettlePlanFormDatasets(build, NEW_SITE, NO_DATASETS)).writesTo).toBe('new:Attendees')
  })

  it('leaves a plan with no form’s dataset exactly as it was', () => {
    const plain = { ...base, create: [{ ...base.create[0], writesTo: undefined }, base.create[1]] }
    expect(aiSettlePlanFormDatasets(plain, NEW_SITE, SITE_PAID)).toBe(plain)
  })

  it('counts a form’s dataset as no pass: it is designed from the plan with no model', () => {
    const without = { ...base, create: [base.create[0]] }
    expect(aiPlanCreditEstimate(base)).toBe(aiPlanCreditEstimate(without))
    expect(aiPlanCreditRange(base)).toEqual(aiPlanCreditRange(without))
    // The same dataset with no form writing to it is a pass of its own.
    const listed = { ...base, create: [{ ...base.create[0], writesTo: undefined }, base.create[1]] }
    expect(aiPlanCreditEstimate(listed)).toBe(aiPlanCreditEstimate(without) + AI_SITE_PASS_CREDITS)
  })
})

describe('the live food bank plan (2026-10-10), its sign-up form writing to a dataset', () => {
  it('keeps the form’s dataset within the cap, ahead of a list fewer sections show, and never a testimonial', () => {
    const settled = aiSettlePlanDatasets(aiSettlePlanFormDatasets(FOOD_BANK_WRITING, NEW_SITE, SITE_PAID), SITE_PAID)
    expect(datasetNames(settled)).toEqual(['Programs', 'FAQs', SIGN_UPS])
    expect(form(settled).writesTo).toBe(`new:${SIGN_UPS}`)
    expect(aiSitePlanShapeRefusal(settled)).toBeNull()
  })

  it('lets go of the form’s binding where the cap lets go of its dataset', () => {
    const one = { ...SITE_PAID, datasetsMax: 1 }
    const settled = aiSettlePlanDatasets(FOOD_BANK_WRITING, one)
    expect(datasetNames(settled)).toEqual(['Programs'])
    expect(form(settled)).not.toHaveProperty('writesTo')
  })

  it('passes the plan check on its first answer', () => {
    const result = aiDoctrinePlanCheck(NEW_SITE, null, SITE_PAID)(FOOD_BANK_WRITING as never)
    expect(result.violations.map((violation) => violation.code)).toEqual([])
    expect(form(result.value as AiBuildPlan).writesTo).toBe(`new:${SIGN_UPS}`)
    expect(uses(result.value as AiBuildPlan)).not.toContain(`new:${SIGN_UPS}`)
  })

  it('is kept by the plan step with one request', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue({
      kind: 'completion',
      text: '',
      toolUse: [{ name: AI_BUILD_PLAN_RECORDS_TOOL.name, input: FOOD_BANK_WRITING }],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      estCostUsd: 0,
      stopReason: 'tool_use',
    })
    const outcome = await createAiJobPlanStep({
      readInventory: async () => NEW_SITE,
      findPlansByKey: null,
      readCapabilities: async () => PAID,
      admissionRefusal: async () => null,
      readSiteContext: null,
    })({
      job: siteJob('a nonprofit food bank', FOOD_BANK.screens.length),
      stepIndex: 0,
      now: NOW,
      firestore: aiEvalMemoryFirestore({}).firestore,
      org: PAID_ORG,
    })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.review).toMatchObject({ reason: 'plan', findings: [] })
    const plan = outcome.plan as AiBuildPlan
    expect(form(plan).writesTo).toBe(`new:${SIGN_UPS}`)
    expect(datasetNames(plan)).toContain(SIGN_UPS)
  })
})

describe('what a site plan is told about a form’s dataset', () => {
  it('rides in the dataset sentence a paid plan is told, and nowhere else', () => {
    expect(aiSiteDatasetSentence(3)).toContain(AI_SITE_FORM_DATASET_SENTENCE)
    expect(AI_SITE_FORM_DATASET_SENTENCE).toContain("set the form's writesTo to new:<the dataset's name>")
    expect(AI_SITE_FORM_DATASET_SENTENCE).toContain('no section lists it')
    const prompt = aiJobPlanPrompt(siteJob('a nonprofit food bank', 5), SITE_PAID, NEW_SITE)
    expect(prompt).toContain(AI_SITE_FORM_DATASET_SENTENCE)
    expect(aiJobPlanPrompt(siteJob('a nonprofit food bank', 5), NO_DATASETS, NEW_SITE)).not.toContain('writesTo')
  })
})
