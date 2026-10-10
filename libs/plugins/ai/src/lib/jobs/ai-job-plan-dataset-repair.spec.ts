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
 * A plan past the datasets a site start makes is settled in code, never
 * re-asked (AGL-3616). The live site-plan eval of 2026-10-10 on #1362 refused
 * two paid briefs that each planned four datasets, one of them testimonials:
 * the dental practice four times over for the fourth dataset, and the food
 * bank, whose re-ask named a section "Page header" and was refused for that.
 * Replayed here from their recorded first answers.
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
import { AI_BUILD_PLAN_RECORDS_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, type AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { AI_SITE_DATASETS_MAX, aiSitePlanShapeRefusal } from '../model/ai-site-job'
import { aiDoctrinePlanCheck } from '../runtime/ai-doctrine'
import { AI_TYPED_LIST_MIN_ITEMS, aiSettlePlanDatasets } from '../runtime/ai-doctrine-validators'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { AI_JOB_PLAN_SCOPES, aiJobPlanPrompt, aiSiteDatasetSentence, aiSitePlanCapabilities, createAiJobPlanStep } from './ai-job-plan-step'
import { AI_DENTAL_SITE_PLAN_FIRST_ANSWER as DENTAL, AI_FOOD_BANK_SITE_PLAN_FIRST_ANSWER as FOOD_BANK } from './fixtures/ai-dataset-site-plan-recordings'

const NOW = new Date('2026-10-10T06:32:00.000Z')
const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'business' }

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
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
  siteJob('a family dental practice', DENTAL.screens.length),
  aiPlanCapabilitiesForJob(PAID, AI_JOB_PLAN_SCOPES.site ?? null),
) as AiPlanCapabilities

const datasetNames = (plan: AiBuildPlan) => plan.create.filter((entry) => entry.kind === 'dataset').map((entry) => entry.name)
const uses = (plan: AiBuildPlan) => plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses))

const toolAnswer = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_BUILD_PLAN_RECORDS_TOOL.name, input }],
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0,
  stopReason: 'tool_use',
})

describe.each([
  ['a family dental practice', DENTAL, ['Dental services', 'Team members', 'Visit questions']],
  ['a nonprofit food bank', FOOD_BANK, ['Programs', 'Volunteer roles', 'FAQs']],
])('the live %s plan (2026-10-10)', (businessType, recorded, kept) => {
  it('as the model wrote it, creates four datasets, one of testimonials, which a scaffold refuses', () => {
    expect(datasetNames(recorded)).toHaveLength(4)
    expect(datasetNames(recorded).some((name) => /testimonial/i.test(name))).toBe(true)
    expect(aiSitePlanShapeRefusal(recorded)).toContain(`creates at most ${AI_SITE_DATASETS_MAX}`)
  })

  it('is settled in code to the three the most sections list, the testimonials let go and written out on their pages', () => {
    const settled = aiSettlePlanDatasets(recorded, SITE_PAID)
    expect(datasetNames(settled)).toEqual(kept)
    expect(uses(settled).some((ref) => /testimonial/i.test(ref))).toBe(false)
    // The testimonials section stays, its items written out, fewer than rule 8 binds.
    const section = settled.screens.flatMap((screen) => screen.sections).find((one) => /testimonial/i.test(one.name))
    expect(section?.items).toBeLessThan(AI_TYPED_LIST_MIN_ITEMS)
    expect(aiSitePlanShapeRefusal(settled)).toBeNull()
  })

  it('passes the plan check on its first answer: no re-ask, so no re-ask can break another rule', () => {
    const result = aiDoctrinePlanCheck(NEW_SITE, null, SITE_PAID)(recorded as never)
    expect(result.violations.map((violation) => violation.code)).toEqual([])
    expect(datasetNames(result.value as AiBuildPlan)).toEqual(kept)
  })

  it('is kept by the plan step with one request', async () => {
    mockRunAiRequest.mockReset()
    mockRunAiRequest.mockResolvedValue(toolAnswer(recorded))
    const outcome = await createAiJobPlanStep({
      readInventory: async () => NEW_SITE,
      findPlansByKey: null,
      readCapabilities: async () => PAID,
      admissionRefusal: async () => null,
      readSiteContext: null,
    })({ job: siteJob(businessType, recorded.screens.length), stepIndex: 0, now: NOW, firestore: aiEvalMemoryFirestore({}).firestore, org: PAID_ORG })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(outcome.uncredited).toBeUndefined()
    expect(outcome.review).toMatchObject({ reason: 'plan', findings: [] })
    expect(datasetNames(outcome.plan as AiBuildPlan)).toEqual(kept)
  })
})

describe('what a site plan is told about datasets', () => {
  it('states the cap plainly, the lists a dataset is for, and never reviews', () => {
    const prompt = aiJobPlanPrompt(siteJob('a family dental practice', 5), SITE_PAID, NEW_SITE)
    expect(prompt).toContain(aiSiteDatasetSentence(AI_SITE_DATASETS_MAX))
    expect(aiSiteDatasetSentence(3)).toContain('at most 3 datasets, and only for a list of 4 or more similar items')
    expect(aiSiteDatasetSentence(3)).toContain('never reviews or testimonials')
    // Starter's two.
    expect(aiSiteDatasetSentence(2)).toContain('at most 2 datasets')
  })

  it('settles nothing under the cap, and nothing where the job may create no dataset', () => {
    const three = { ...DENTAL, create: DENTAL.create.filter((entry) => !/testimonial/i.test(entry.name)) }
    expect(aiSettlePlanDatasets(three, SITE_PAID)).toBe(three)
    const none = { ...SITE_PAID, create: { ...SITE_PAID.create, dataset: { allowed: false, left: 0, reason: 'no' } } }
    expect(aiSettlePlanDatasets(DENTAL, none)).toBe(DENTAL)
  })

  it('turns a record template of a dataset let go into a page of its own', () => {
    const plan: AiBuildPlan = {
      ...DENTAL,
      screens: [...DENTAL.screens, { ...DENTAL.screens[1], title: 'Review', slug: '/review', record: { dataset: 'new:Patient testimonials', base: 'reviews' } }],
    }
    const settled = aiSettlePlanDatasets(plan, SITE_PAID)
    expect(settled.screens[settled.screens.length - 1].record).toBeNull()
  })
})
